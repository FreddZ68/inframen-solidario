require('dotenv').config({ path: '.env' });
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { leerActividadesDocx, norm: normWord } = require('./lib/importar-word');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

const app = express();
// Si publicas el sistema detrás de un proxy (Render, Railway, Nginx...), pon TRUST_PROXY=1 en el .env para que el servidor vea la IP real de cada
// dispositivo. En una red local o sin proxy déjalo sin definir (si lo activas sin proxy, la IP se podría falsificar).
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
}));
app.use(express.static(path.join(__dirname, 'public')));

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT) || 3306,   // TiDB Cloud usa 4000
  // TiDB Cloud (y la mayoría de bases en la nube) exigen conexión segura (TLS)
  ssl: (process.env.DB_SSL === 'true' || /tidbcloud\.com$/i.test(process.env.DB_HOST || ''))
    ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
});

/* ================== Constantes y validaciones ================== */
const DOMINIO = '@clases.edu.sv';
// Máximo de estudiantes activos por sección (se puede cambiar con MAX_ESTUDIANTES_SECCION en .env)
const MAX_POR_SECCION = Number(process.env.MAX_ESTUDIANTES_SECCION) || 50;
async function ocupadosSeccion(db, seccionId, excluirAlumnoId = 0) {
  const [[r]] = await db.query(`SELECT COUNT(*) AS n FROM alumno_seccion a JOIN usuarios x ON x.id = a.alumno_id
    WHERE a.seccion_id = ? AND x.activo = TRUE AND x.id <> ?`, [seccionId, excluirAlumnoId]);
  return Number(r.n);
}
// Horas que se suman solas cuando un estudiante queda con asistencia "Justificado" (permiso) en un día (HORAS_PERMISO en .env)
const HORAS_PERMISO = Number(process.env.HORAS_PERMISO) || 2;

// Archivos de los proyectos (Word, PDF, Excel...). Se guardan en disco; cambia la carpeta con UPLOADS_DIR en .env
const CARPETA_ARCHIVOS = path.join(process.env.UPLOADS_DIR || path.join(__dirname, 'uploads'), 'proyectos');
fs.mkdirSync(CARPETA_ARCHIVOS, { recursive: true });
const MAX_ARCHIVO = (Number(process.env.MAX_ARCHIVO_MB) || 10) * 1024 * 1024;
const MAX_ARCHIVOS_PROYECTO = 30;
// Máximo de horas por registro (perfil del estudiante). Esas horas llevan origen = 'perfil' y no cuentan para el límite semanal de la carga masiva.
const MAX_HORAS_REGISTRO = 40;
const EXT_ARCHIVO = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'odp', 'png', 'jpg', 'jpeg', 'zip']);
const ROLES = ['administrador', 'docente', 'alumno'];
const ESTADOS = ['presente', 'tarde', 'falto', 'permiso'];

const RE_NIE = /^\d{8}$/;                       // alumnos: exactamente 8 números
const RE_CODIGO = /^\d{1,15}$/;                 // admin y docente: de 1 a 15 números
const RE_NOMBRE = /^\p{L}+(?: \p{L}+)+$/u;      // solo letras y espacios, mínimo nombre y apellido
const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const limpiarNombre = s => String(s || '').replace(/\s+/g, ' ').trim();
const limpiarTexto = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
const fechaOk = f => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f))) return false;
  const d = new Date(f + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === f;
};
// Fecha de hoy (AAAA-MM-DD) en la zona horaria de la institución (ZONA_HORARIA en .env; por defecto El Salvador), sin depender de la hora del servidor
const hoyApp = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.ZONA_HORARIA || 'America/El_Salvador' }).format(new Date());
const hoyStr = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const idOk = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

const pinNuevo = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

// PIN visible para el administrador: se guarda CIFRADO (AES-256-GCM) con PIN_KEY. El login usa solo el hash de bcrypt.
const PIN_KEY = Buffer.from(process.env.PIN_KEY || '', 'hex');
if (PIN_KEY.length !== 32) {
  console.error('Falta PIN_KEY en el .env (debe tener 64 caracteres hexadecimales).');
  process.exit(1);
}
const cifrarPin = pin => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', PIN_KEY, iv);
  const enc = Buffer.concat([c.update(pin, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
};
const descifrarPin = txt => {
  const b = Buffer.from(txt, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', PIN_KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
};

// Errores "del usuario" (se muestran tal cual) frente a errores internos (se registran en la terminal)
class ErrUsuario extends Error {}
const fallo = (res, e) => {
  if (e instanceof ErrUsuario) return res.status(400).json({ error: e.message });
  if (e && e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Ya existe un registro con esos datos' });
  console.error(e);
  // Falta una columna o tabla: lo más probable es que haya que ejecutar inframen_completo.sql (se muestra el detalle)
  if (e && (e.code === 'ER_BAD_FIELD_ERROR' || e.code === 'ER_NO_SUCH_TABLE')) {
    return res.status(500).json({ error: 'Falta actualizar la base de datos (ejecuta inframen_completo.sql): ' + (e.sqlMessage || e.message) });
  }
  res.status(500).json({ error: 'Error del servidor' });
};

/* ================== Configuración de la institución ================== */
// meta_horas, max_horas_semana (0 = sin límite) y nombre de la institución, guardados en la tabla `configuracion`
async function leerConfig(db = pool) {
  const c = { meta_horas: 150, max_horas_semana: 2, institucion: 'Instituto Nacional Francisco Menéndez' };
  const [rows] = await db.query('SELECT clave, valor FROM configuracion');
  for (const r of rows) {
    if (r.clave === 'institucion') c.institucion = r.valor;
    else if (r.clave in c) c[r.clave] = Number(r.valor);
  }
  return c;
}
const guardarConfig = (db, clave, valor) =>
  db.query('INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)', [clave, String(valor)]);

/* ================== Permisos ================== */
const auth = (...roles) => (req, res, next) => {
  const u = req.session.usuario;
  if (!u) return res.status(401).json({ error: 'No autenticado' });
  if (!roles.includes(u.rol)) return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  next();
};
const ANY = auth('administrador', 'docente', 'alumno');
const ADMIN = auth('administrador');
const STAFF = auth('administrador', 'docente');
const DOCENTE = auth('docente');
const alumnoActivo = async (req, res, next) => {
  try {
    const [[u]] = await pool.query("SELECT activo FROM usuarios WHERE id = ? AND rol = 'alumno'", [req.session.usuario.id]);
    if (!u || !u.activo) { req.session.destroy(() => {}); return res.status(401).json({ error: 'Tu cuenta no está activa' }); }
    next();
  } catch (e) { fallo(res, e); }
};
const ALUMNO = [auth('alumno'), alumnoActivo];   // permiso por rol (sesión) + verificación en la base de datos

// Un docente solo puede trabajar con sus secciones; el administrador con todas.
async function seccionPermitida(u, id) {
  const [[s]] = await pool.query('SELECT id FROM secciones WHERE id = ?', [id]);
  if (!s) throw new ErrUsuario('La sección no existe');
  if (u.rol === 'docente') {
    const [[d]] = await pool.query('SELECT 1 AS ok FROM docente_seccion WHERE docente_id = ? AND seccion_id = ?', [u.id, id]);
    if (!d) throw new ErrUsuario('Esa sección no está asignada a tu usuario');
  }
  return s;
}
// Fragmento SQL para limitar a las secciones del docente (alias de la tabla secciones). El administrador no tiene límite.
const ambito = (u, alias = 's') => u.rol === 'docente'
  ? { sql: ` AND EXISTS (SELECT 1 FROM docente_seccion q WHERE q.seccion_id = ${alias}.id AND q.docente_id = ?)`, p: [u.id] }
  : { sql: '', p: [] };

// Devuelve los datos del alumno si el usuario puede trabajar con él
async function alumnoPermitido(u, alumnoId, db = pool) {
  const [[a]] = await db.query(`
    SELECT x.id, x.nie, x.nombre, x.activo, x.limite_semanal, s.id AS seccion_id, s.especialidad, s.seccion, s.anio
    FROM usuarios x
    LEFT JOIN alumno_seccion al ON al.alumno_id = x.id
    LEFT JOIN secciones s ON s.id = al.seccion_id
    WHERE x.id = ? AND x.rol = 'alumno' LIMIT 1`, [alumnoId]);
  if (!a) throw new ErrUsuario('Estudiante no encontrado');
  if (u.rol === 'docente') {
    const [[d]] = a.seccion_id
      ? await db.query('SELECT 1 AS ok FROM docente_seccion WHERE docente_id = ? AND seccion_id = ?', [u.id, a.seccion_id])
      : [[]];
    if (!d) throw new ErrUsuario('Ese estudiante no pertenece a tus secciones');
  }
  return a;
}

/* ================== Prueba de conexión ================== */
app.get('/api/salud', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ servidor: 'ok', mysql: 'ok' });
  } catch (e) {
    res.status(500).json({ servidor: 'ok', mysql: 'error', detalle: e.message });
  }
});

/* ================== Inicio de sesión (administrador, docente y estudiante) ================== */
// Límite de intentos del inicio de sesión. Se cuenta por NIE + IP: si alguien falla desde otra computadora, tu otra laptop o tu celular
// no se bloquean. Además hay topes más altos por IP y por NIE para frenar a quien pruebe muchos PIN o muchas cuentas.
const MAX_POR_DISPOSITIVO = 5;    // fallos del mismo NIE desde la misma IP
const MAX_POR_IP = 30;            // fallos de cualquier NIE desde la misma IP
const MAX_POR_NIE = 30;           // fallos del mismo NIE sumando todas las IP
const BLOQUEO_MS = 15 * 60 * 1000;
const intentos = new Map();       // clave -> { n, hasta, ult }
const ipDe = req => req.ip || req.socket.remoteAddress || 'desconocida';
const esperaDe = (clave, ahora) => { const r = intentos.get(clave); return r && r.hasta > ahora ? r.hasta - ahora : 0; };
const contarFallo = (clave, max, ahora) => {
  const r = intentos.get(clave) || { n: 0, hasta: 0, ult: ahora };
  if (ahora - r.ult > BLOQUEO_MS || (r.hasta && r.hasta <= ahora)) { r.n = 0; r.hasta = 0; }   // los fallos viejos ya no cuentan
  r.n++; r.ult = ahora;
  if (r.n >= max) { r.hasta = ahora + BLOQUEO_MS; r.n = 0; }
  intentos.set(clave, r);
};
setInterval(() => { const t = Date.now(); for (const [k, r] of intentos) if (r.hasta <= t && t - r.ult > BLOQUEO_MS) intentos.delete(k); }, 10 * 60 * 1000).unref();

app.post('/api/login', async (req, res) => {
  const nie = String(req.body.nie || '').trim();
  const pin = String(req.body.pin || '').trim();
  if (!RE_CODIGO.test(nie) || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ error: 'NIE/código o PIN con formato no válido' });
  }
  const ahora = Date.now(), ip = ipDe(req);
  const kDisp = `d|${nie}|${ip}`, kIp = `i|${ip}`, kNie = `n|${nie}`;
  const espera = Math.max(esperaDe(kDisp, ahora), esperaDe(kIp, ahora), esperaDe(kNie, ahora));
  if (espera) return res.status(429).json({ error: `Demasiados intentos. Espera ${Math.ceil(espera / 60000)} minuto(s).` });
  try {
    const [rows] = await pool.query(
      'SELECT id, nombre, rol, password_hash, activo FROM usuarios WHERE nie = ?', [nie]);
    const u = rows[0];
    const ok = u && u.activo && await bcrypt.compare(pin, u.password_hash);
    if (!ok) {
      contarFallo(kDisp, MAX_POR_DISPOSITIVO, ahora); contarFallo(kIp, MAX_POR_IP, ahora); contarFallo(kNie, MAX_POR_NIE, ahora);
      return res.status(401).json({ error: 'NIE/código o PIN incorrecto' });
    }
    intentos.delete(kDisp);
    req.session.usuario = { id: u.id, nombre: u.nombre, rol: u.rol };
    res.json({ ok: true, usuario: req.session.usuario });
  } catch (e) { fallo(res, e); }
});

app.get('/api/yo', (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ error: 'No autenticado' });
  res.json(req.session.usuario);
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Meta de horas y datos de la institución (los necesitan las tres vistas)
app.get('/api/config', ANY, async (req, res) => {
  try { res.json({ ...await leerConfig(), horas_permiso: HORAS_PERMISO, max_horas_registro: MAX_HORAS_REGISTRO }); } catch (e) { fallo(res, e); }
});

/* ================== Mi perfil (todos los roles) ================== */
app.get('/api/perfil', ANY, async (req, res) => {
  try {
    const [[u]] = await pool.query('SELECT nombre, nie, correo, rol FROM usuarios WHERE id = ?', [req.session.usuario.id]);
    // El teléfono vive en una columna que se agrega al actualizar la base; si aún no existe, el perfil carga igual
    try { const [[t]] = await pool.query('SELECT telefono FROM usuarios WHERE id = ?', [req.session.usuario.id]); u.telefono = t ? t.telefono : null; }
    catch { u.telefono = null; }
    if (u.rol === 'alumno') {
      const [[s]] = await pool.query(`SELECT CONCAT(s.especialidad, ' ', s.seccion) AS seccion, s.especialidad, s.seccion AS numero FROM alumno_seccion a
        JOIN secciones s ON s.id = a.seccion_id WHERE a.alumno_id = ? LIMIT 1`, [req.session.usuario.id]);
      u.seccion = s ? s.seccion : null; u.especialidad = s ? s.especialidad : null; u.seccion_numero = s ? s.numero : null;
    } else if (u.rol === 'docente') {
      const [[s]] = await pool.query(`SELECT GROUP_CONCAT(CONCAT(s.especialidad, ' ', s.seccion) ORDER BY s.seccion SEPARATOR ', ') AS seccion
        FROM docente_seccion d JOIN secciones s ON s.id = d.seccion_id WHERE d.docente_id = ?`, [req.session.usuario.id]);
      u.seccion = s ? s.seccion : null;
    }
    res.json(u);
  } catch (e) { fallo(res, e); }
});

// Solo el administrador cambia su propio PIN. Docentes y estudiantes lo reciben del administrador
// (docentes) o del docente / administrador (estudiantes).
app.post('/api/perfil/pin', ADMIN, async (req, res) => {
  try {
    const actual = String(req.body.actual || ''), nuevo = String(req.body.nuevo || '');
    if (!/^\d{4}$/.test(actual) || !/^\d{4}$/.test(nuevo)) throw new ErrUsuario('El PIN debe tener exactamente 4 números');
    const [[u]] = await pool.query('SELECT password_hash FROM usuarios WHERE id = ?', [req.session.usuario.id]);
    if (!await bcrypt.compare(actual, u.password_hash)) throw new ErrUsuario('El PIN actual no es correcto');
    await pool.query('UPDATE usuarios SET password_hash = ?, pin_cifrado = ? WHERE id = ?',
      [await bcrypt.hash(nuevo, 10), cifrarPin(nuevo), req.session.usuario.id]);
    res.json({ ok: true });
  } catch (e) { fallo(res, e); }
});

/* =====================================================================
   ADMINISTRADOR
   ===================================================================== */

/* ---------- Gestión de usuarios ---------- */
app.get('/api/admin/usuarios', ADMIN, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.nie, u.nombre, u.correo, u.rol, u.activo,
        (SELECT a.seccion_id FROM alumno_seccion a WHERE a.alumno_id = u.id LIMIT 1) AS seccion_id,
        CASE
          WHEN u.rol = 'alumno' THEN
            (SELECT CONCAT(s.especialidad, ' ', s.seccion, ' (', s.anio, ')') FROM alumno_seccion a
             JOIN secciones s ON s.id = a.seccion_id WHERE a.alumno_id = u.id LIMIT 1)
          WHEN u.rol = 'docente' THEN
            (SELECT GROUP_CONCAT(CONCAT(s.especialidad, ' ', s.seccion, ' (', s.anio, ')') ORDER BY s.anio DESC, s.seccion SEPARATOR ', ')
             FROM docente_seccion ds JOIN secciones s ON s.id = ds.seccion_id WHERE ds.docente_id = u.id)
        END AS seccion,
        -- ids de las secciones del usuario (un estudiante tiene una; un docente puede tener varias): sirven para filtrar sin confundir años
        CASE
          WHEN u.rol = 'alumno' THEN (SELECT CAST(a.seccion_id AS CHAR) FROM alumno_seccion a WHERE a.alumno_id = u.id LIMIT 1)
          WHEN u.rol = 'docente' THEN (SELECT GROUP_CONCAT(ds.seccion_id SEPARATOR ',') FROM docente_seccion ds WHERE ds.docente_id = u.id)
        END AS seccion_ids
      FROM usuarios u ORDER BY u.id`);
    res.json(rows);
  } catch (e) { fallo(res, e); }
});

app.post('/api/admin/usuarios', ADMIN, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const nie = String(req.body.nie || '').trim();
    const nombre = limpiarNombre(req.body.nombre);
    const rol = String(req.body.rol || '');
    const correo = String(req.body.correo || '').trim().toLowerCase() || nie + DOMINIO;
    if (!ROLES.includes(rol)) throw new ErrUsuario('Rol no válido');
    if (rol === 'alumno' ? !RE_NIE.test(nie) : !RE_CODIGO.test(nie)) {
      throw new ErrUsuario(rol === 'alumno' ? 'El NIE debe tener exactamente 8 números' : 'El código debe tener solo números (máximo 15)');
    }
    if (nombre.length < 3 || nombre.length > 100 || !RE_NOMBRE.test(nombre)) throw new ErrUsuario('El nombre debe tener solo letras (nombre y apellido)');
    if (!RE_CORREO.test(correo) || correo.length > 120) throw new ErrUsuario('Correo electrónico no válido');
    let seccionId = null;
    if (rol === 'alumno') {
      seccionId = idOk(req.body.seccion_id);
      if (!seccionId) throw new ErrUsuario('Selecciona la sección del estudiante');
      const [[s]] = await conn.query('SELECT id FROM secciones WHERE id = ?', [seccionId]);
      if (!s) throw new ErrUsuario('La sección no existe');
    }
    const [ya] = await conn.query('SELECT id FROM usuarios WHERE nie = ? OR correo = ?', [nie, correo]);
    if (ya.length) throw new ErrUsuario('Ya existe un usuario con ese NIE/código o correo');

    // PIN inicial: lo genera el sistema (o el administrador puede fijarlo con 4 números)
    let pin = pinNuevo();
    if (req.body.pin !== undefined && req.body.pin !== null && String(req.body.pin).trim() !== '') {
      pin = String(req.body.pin).trim();
      if (!/^\d{4}$/.test(pin)) throw new ErrUsuario('El PIN inicial debe tener exactamente 4 números');
    }
    const hash = await bcrypt.hash(pin, 10);
    if (seccionId && await ocupadosSeccion(conn, seccionId) >= MAX_POR_SECCION) throw new ErrUsuario(`La sección ya tiene ${MAX_POR_SECCION} estudiantes (cupo lleno)`);
    await conn.beginTransaction();
    const [r] = await conn.query(
      'INSERT INTO usuarios (nombre, correo, password_hash, rol, nie, pin_cifrado) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre, correo, hash, rol, nie, cifrarPin(pin)]);
    if (seccionId) await conn.query('INSERT INTO alumno_seccion (alumno_id, seccion_id) VALUES (?, ?)', [r.insertId, seccionId]);
    await conn.commit();
    res.json({ ok: true, id: r.insertId, pin });
  } catch (e) {
    await conn.rollback().catch(() => {});
    fallo(res, e);
  } finally { conn.release(); }
});

app.put('/api/admin/usuarios/:id', ADMIN, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Usuario no válido');
    const [[u]] = await conn.query('SELECT id, rol FROM usuarios WHERE id = ?', [id]);
    if (!u) throw new ErrUsuario('Usuario no encontrado');
    const nombre = limpiarNombre(req.body.nombre);
    const correo = String(req.body.correo || '').trim().toLowerCase();
    const activo = req.body.activo ? 1 : 0;
    if (nombre.length < 3 || nombre.length > 100 || !RE_NOMBRE.test(nombre)) throw new ErrUsuario('El nombre debe tener solo letras (nombre y apellido)');
    if (!RE_CORREO.test(correo) || correo.length > 120) throw new ErrUsuario('Correo electrónico no válido');
    if (id === req.session.usuario.id && !activo) throw new ErrUsuario('No puedes desactivar tu propia cuenta');
    const [dup] = await conn.query('SELECT id FROM usuarios WHERE correo = ? AND id <> ?', [correo, id]);
    if (dup.length) throw new ErrUsuario('Ese correo ya lo usa otro usuario');
    let seccionId = null;
    if (u.rol === 'alumno') {
      seccionId = idOk(req.body.seccion_id);
      if (!seccionId) throw new ErrUsuario('Selecciona la sección del estudiante');
      const [[s]] = await conn.query('SELECT id FROM secciones WHERE id = ?', [seccionId]);
      if (!s) throw new ErrUsuario('La sección no existe');
      if (activo && await ocupadosSeccion(conn, seccionId, id) >= MAX_POR_SECCION) throw new ErrUsuario(`La sección ya tiene ${MAX_POR_SECCION} estudiantes (cupo lleno)`);
    }
    await conn.beginTransaction();
    await conn.query('UPDATE usuarios SET nombre = ?, correo = ?, activo = ? WHERE id = ?', [nombre, correo, activo, id]);
    if (seccionId) {
      await conn.query('DELETE FROM alumno_seccion WHERE alumno_id = ?', [id]);
      await conn.query('INSERT INTO alumno_seccion (alumno_id, seccion_id) VALUES (?, ?)', [id, seccionId]);
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    fallo(res, e);
  } finally { conn.release(); }
});

app.delete('/api/admin/usuarios/:id', ADMIN, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Usuario no válido');
    if (id === req.session.usuario.id) throw new ErrUsuario('No puedes eliminar tu propia cuenta');
    const [[u]] = await conn.query('SELECT id FROM usuarios WHERE id = ?', [id]);
    if (!u) throw new ErrUsuario('Usuario no encontrado');
    await conn.beginTransaction();
    await conn.query('DELETE FROM registro_horas WHERE alumno_id = ?', [id]);
    await conn.query('DELETE FROM asistencias WHERE alumno_id = ?', [id]);
    await conn.query('DELETE FROM alumno_seccion WHERE alumno_id = ?', [id]);
    await conn.query('DELETE FROM docente_seccion WHERE docente_id = ?', [id]);
    await conn.query('DELETE FROM usuarios WHERE id = ?', [id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    fallo(res, e);
  } finally { conn.release(); }
});

// PIN nuevo (el anterior deja de funcionar). Si se envía "pin" (4 números), se usa ese; si no, se genera uno.
app.post('/api/admin/usuarios/:id/pin', ADMIN, async (req, res) => {
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Usuario no válido');
    const [[u]] = await pool.query('SELECT id FROM usuarios WHERE id = ?', [id]);
    if (!u) throw new ErrUsuario('Usuario no encontrado');
    let pin = pinNuevo();
    if (req.body && req.body.pin !== undefined && String(req.body.pin).trim() !== '') {
      pin = String(req.body.pin).trim();
      if (!/^\d{4}$/.test(pin)) throw new ErrUsuario('El PIN debe tener exactamente 4 números');
    }
    await pool.query('UPDATE usuarios SET password_hash = ?, pin_cifrado = ? WHERE id = ?', [await bcrypt.hash(pin, 10), cifrarPin(pin), id]);
    res.json({ pin });
  } catch (e) { fallo(res, e); }
});

// Ver el PIN de cualquier usuario (estudiante, docente o administrador) y solo cuando se pide
app.get('/api/admin/usuarios/:id/pin', ADMIN, async (req, res) => {
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Usuario no válido');
    const [[u]] = await pool.query("SELECT pin_cifrado FROM usuarios WHERE id = ?", [id]);
    if (!u) throw new ErrUsuario('Usuario no encontrado');
    if (!u.pin_cifrado) throw new ErrUsuario('Este usuario no tiene el PIN guardado. Usa "Restablecer PIN" para generar uno nuevo.');
    res.json({ pin: descifrarPin(u.pin_cifrado) });
  } catch (e) { fallo(res, e); }
});

app.get('/api/admin/docentes', ADMIN, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, nombre FROM usuarios WHERE rol = 'docente' AND activo = TRUE ORDER BY nombre");
    res.json(rows);
  } catch (e) { fallo(res, e); }
});

/* ---------- Gestión de secciones ---------- */
// Administrador: todas. Docente: solo las suyas.
app.get('/api/admin/secciones', STAFF, async (req, res) => {
  try {
    const u = req.session.usuario;
    const [rows] = await pool.query(`
      SELECT s.id, s.especialidad, s.seccion, s.anio, s.activa,
        (SELECT MIN(ds.docente_id) FROM docente_seccion ds WHERE ds.seccion_id = s.id) AS docente_id,
        (SELECT GROUP_CONCAT(d.nombre ORDER BY d.nombre SEPARATOR ', ') FROM docente_seccion ds
          JOIN usuarios d ON d.id = ds.docente_id WHERE ds.seccion_id = s.id) AS docente,
        (SELECT COUNT(*) FROM alumno_seccion a JOIN usuarios x ON x.id = a.alumno_id
          WHERE a.seccion_id = s.id AND x.activo = TRUE) AS estudiantes
      FROM secciones s
      ${u.rol === 'docente' ? 'WHERE EXISTS (SELECT 1 FROM docente_seccion q WHERE q.seccion_id = s.id AND q.docente_id = ?)' : ''}
      ORDER BY s.anio DESC, s.especialidad, s.seccion`, u.rol === 'docente' ? [u.id] : []);
    res.json(rows.map(r => ({ ...r, cupo_max: MAX_POR_SECCION })));
  } catch (e) { fallo(res, e); }
});

// Deja al docente indicado como único responsable de la sección (tabla docente_seccion)
async function asignarDocente(seccionId, docenteId) {
  await pool.query('DELETE FROM docente_seccion WHERE seccion_id = ?', [seccionId]);
  if (docenteId) await pool.query('INSERT INTO docente_seccion (docente_id, seccion_id) VALUES (?, ?)', [docenteId, seccionId]);
}

async function validarSeccion(b, idActual) {
  const especialidad = limpiarNombre(b.especialidad);
  const seccion = Number(b.seccion);
  if (especialidad.length < 3 || especialidad.length > 100) throw new ErrUsuario('Escribe la especialidad (3 a 100 caracteres)');
  if (!Number.isInteger(seccion) || seccion < 1 || seccion > 9) throw new ErrUsuario('La sección debe ser un número del 1 al 9');
  const anio = Number(b.anio);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) throw new ErrUsuario('Escribe un año válido (por ejemplo 2026)');
  let docenteId = null;
  if (b.docente_id !== null && b.docente_id !== undefined && b.docente_id !== '') {
    docenteId = idOk(b.docente_id);
    const [[d]] = docenteId ? await pool.query("SELECT id FROM usuarios WHERE id = ? AND rol = 'docente'", [docenteId]) : [[]];
    if (!d) throw new ErrUsuario('El docente seleccionado no es válido');
  }
  const [dup] = await pool.query('SELECT id FROM secciones WHERE especialidad = ? AND seccion = ? AND anio = ? AND id <> ?', [especialidad, seccion, anio, idActual || 0]);
  if (dup.length) throw new ErrUsuario('Esa sección ya existe en el año ' + anio);
  return { especialidad, seccion, anio, docenteId, activa: b.activa === false || b.activa === 0 || b.activa === '0' ? 0 : 1 };
}

app.post('/api/admin/secciones', ADMIN, async (req, res) => {
  try {
    const d = await validarSeccion(req.body);
    const [r] = await pool.query('INSERT INTO secciones (especialidad, seccion, anio, activa) VALUES (?, ?, ?, ?)',
      [d.especialidad, d.seccion, d.anio, d.activa]);
    await asignarDocente(r.insertId, d.docenteId);
    res.json({ ok: true, id: r.insertId });
  } catch (e) { fallo(res, e); }
});

app.put('/api/admin/secciones/:id', ADMIN, async (req, res) => {
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Sección no válida');
    const [[s]] = await pool.query('SELECT id FROM secciones WHERE id = ?', [id]);
    if (!s) throw new ErrUsuario('La sección no existe');
    const d = await validarSeccion(req.body, id);
    await pool.query('UPDATE secciones SET especialidad = ?, seccion = ?, anio = ?, activa = ? WHERE id = ?',
      [d.especialidad, d.seccion, d.anio, d.activa, id]);
    await asignarDocente(id, d.docenteId);
    res.json({ ok: true });
  } catch (e) { fallo(res, e); }
});

app.delete('/api/admin/secciones/:id', ADMIN, async (req, res) => {
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Sección no válida');
    const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM alumno_seccion WHERE seccion_id = ?', [id]);
    if (n.n > 0) throw new ErrUsuario('La sección tiene estudiantes inscritos. Muévelos a otra sección o desactívala.');
    const [[h]] = await pool.query('SELECT COUNT(*) AS n FROM asistencias WHERE seccion_id = ?', [id]);
    if (h.n > 0) throw new ErrUsuario('La sección tiene asistencias registradas. Mejor desactívala.');
    const [[r]] = await pool.query('SELECT COUNT(*) AS n FROM registro_horas WHERE seccion_id = ?', [id]);
    if (r.n > 0) throw new ErrUsuario('La sección tiene horas registradas. Mejor desactívala.');
    await pool.query('DELETE FROM docente_seccion WHERE seccion_id = ?', [id]);
    await pool.query('DELETE FROM secciones WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) { fallo(res, e); }
});

/* ---------- Asignación de estudiantes a secciones: alta masiva (CSV) y asignación manual ---------- */
// Esta pantalla DA DE ALTA y ASIGNA: no cambia de sección a quien ya tiene una (eso se hace en Gestión de Usuarios).
const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const RE_NIE_CSV = /^\d{7,8}$/;

// Asignación manual: estudiantes que todavía no tienen sección
app.post('/api/admin/asignaciones', ADMIN, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const ids = [...new Set((Array.isArray(req.body.alumnos) ? req.body.alumnos : []).map(idOk).filter(Boolean))].slice(0, 500);
    if (!ids.length) throw new ErrUsuario('Selecciona al menos un estudiante');
    const sid = idOk(req.body.seccion_id);
    const [[sec]] = sid ? await conn.query('SELECT id, activa FROM secciones WHERE id = ?', [sid]) : [[]];
    if (!sec) throw new ErrUsuario('Elige la sección destino');
    if (!sec.activa) throw new ErrUsuario('La sección está inactiva. Actívala primero en Gestión de Secciones.');
    const [libres] = await conn.query(`SELECT u.id FROM usuarios u WHERE u.rol = 'alumno' AND u.activo = TRUE AND u.id IN (?)
      AND NOT EXISTS (SELECT 1 FROM alumno_seccion a WHERE a.alumno_id = u.id)`, [ids]);
    if (!libres.length) throw new ErrUsuario('Los estudiantes seleccionados ya tienen una sección asignada');
    const hueco = MAX_POR_SECCION - await ocupadosSeccion(conn, sid);
    if (libres.length > hueco) throw new ErrUsuario(hueco <= 0 ? `La sección ya tiene ${MAX_POR_SECCION} estudiantes (cupo lleno)` : `La sección solo tiene ${hueco} lugar(es) libre(s) (máximo ${MAX_POR_SECCION}) y elegiste ${libres.length}`);
    await conn.beginTransaction();
    for (const a of libres) await conn.query('INSERT INTO alumno_seccion (alumno_id, seccion_id) VALUES (?, ?)', [a.id, sid]);
    await conn.commit();
    res.json({ ok: true, cantidad: libres.length, omitidos: ids.length - libres.length });
  } catch (e) {
    await conn.rollback().catch(() => {});
    fallo(res, e);
  } finally { conn.release(); }
});

// Alta masiva por CSV. Cada fila: nie, nombre y sección.
//  - Si el NIE no existe: se CREA el estudiante (PIN generado) y se asigna a la sección.
//  - Si existe y no tiene sección: se asigna.
//  - Si ya está en esa sección: se omite. Si tiene OTRA sección: no se toca (error informativo).
// Con aplicar=false solo revisa y devuelve la vista previa; con aplicar=true guarda en la base de datos.
app.post('/api/admin/asignaciones/csv', STAFF, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const filas = Array.isArray(req.body.filas) ? req.body.filas.slice(0, 500) : [];
    if (!filas.length) throw new ErrUsuario('El archivo no tiene filas para procesar (máximo 500 por carga)');
    const aplicar = req.body.aplicar === true;
    // El administrador usa todas las secciones; el docente solo las suyas
    const ambCsv = ambito(req.session.usuario, 's');
    const [secs] = await conn.query('SELECT s.id, s.especialidad, s.seccion, s.anio, s.activa FROM secciones s WHERE 1 = 1' + ambCsv.sql, ambCsv.p);
    // Una misma especialidad + sección puede existir en varios años: se distingue por el año.
    const porNombre = new Map();
    for (const x of secs) { const k = norm(x.especialidad + ' ' + x.seccion); if (!porNombre.has(k)) porNombre.set(k, []); porNombre.get(k).push(x); }
    const nombreSec = new Map(secs.map(x => [x.id, x.especialidad + ' ' + x.seccion + ' (' + x.anio + ')']));
    // Texto de la fila: "Desarrollo de Software 1" o "Desarrollo de Software 1 2026". Sin año se usa la sección activa.
    // anioFila: valor de la columna "anio" (o el año elegido en pantalla). Tiene prioridad sobre un año escrito dentro del texto.
    const buscarSec = (txt, anioFila) => {
      let t = String(txt || '').trim(), anio = null;
      const m = t.match(/^(.*?)[\s(\-\/]*((?:19|20)\d{2})\)?$/);
      if (m && porNombre.has(norm(m[1]))) { t = m[1]; anio = Number(m[2]); }
      if (anioFila) anio = anioFila;
      const lista = porNombre.get(norm(t)) || [];
      if (!lista.length) return { error: req.session.usuario.rol === 'docente' ? 'La sección no existe o no es una de tus secciones (escríbela como en Mis Secciones)' : 'La sección no existe (escríbela como en Gestión de Secciones)' };
      if (anio) { const x = lista.find(y => y.anio === anio); return x ? { sec: x } : { error: 'No existe esa sección en el año ' + anio }; }
      const activas = lista.filter(y => y.activa);
      if (activas.length === 1) return { sec: activas[0] };
      if (activas.length > 1) return { error: 'Hay varias secciones activas con ese nombre; agrega el año (ej. ' + t + ' ' + activas[0].anio + ')' };
      return { error: 'La sección está inactiva' };
    };
    const [alu] = await conn.query(`SELECT u.id, u.nie, u.nombre, u.activo,
      (SELECT a.seccion_id FROM alumno_seccion a WHERE a.alumno_id = u.id LIMIT 1) AS seccion_id FROM usuarios u WHERE u.nie IS NOT NULL`);
    const porNie = new Map(alu.map(a => [a.nie, a]));
    const [cor] = await conn.query('SELECT correo FROM usuarios');
    const correos = new Set(cor.map(c => String(c.correo).toLowerCase()));

    // Cupo: estudiantes activos que ya hay en cada sección + los que esta carga va sumando
    const [cnt] = await conn.query(`SELECT a.seccion_id, COUNT(*) AS n FROM alumno_seccion a JOIN usuarios x ON x.id = a.alumno_id
      WHERE x.activo = TRUE GROUP BY a.seccion_id`);
    const ocupados = new Map(cnt.map(c => [c.seccion_id, Number(c.n)]));
    const lleno = id => (ocupados.get(id) || 0) >= MAX_POR_SECCION;
    const ocupar = id => ocupados.set(id, (ocupados.get(id) || 0) + 1);
    const msgLleno = `La sección ya tiene ${MAX_POR_SECCION} estudiantes (cupo lleno)`;
    const vistos = new Set(), trabajo = [];
    const resultado = filas.map((f, i) => {
      const nie = String(f.nie || '').trim(), nombre = limpiarNombre(f.nombre), txt = limpiarTexto(f.seccion, 150);
      const anioTxt = String(f.anio ?? '').trim(), anioFila = /^\d{4}$/.test(anioTxt) ? Number(anioTxt) : null;
      const r = { fila: i + 1, nie, nombre, seccion: txt, anio: anioFila || '', actual: '', estado: 'error', mensaje: '', pin: '' };
      const a = porNie.get(nie), busq = anioTxt && !anioFila ? { error: 'Año no válido (escribe 4 dígitos, por ejemplo 2025)' } : buscarSec(txt, anioFila), sec = busq.sec;
      if (!nie || !txt) r.mensaje = 'Falta el NIE o la sección';
      else if (vistos.has(nie)) r.mensaje = 'NIE repetido en el archivo (se usa su primera fila)';
      else if (!sec) r.mensaje = busq.error;
      else if (!sec.activa) { r.anio = sec.anio; r.mensaje = 'La sección está inactiva (año ' + sec.anio + ')'; }
      else {
        r.seccion = sec.especialidad + ' ' + sec.seccion + ' (' + sec.anio + ')'; r.anio = sec.anio;
        if (a) {
          r.nombre = a.nombre; r.actual = a.seccion_id ? (nombreSec.get(a.seccion_id) || '-') : 'Sin sección';
          if (a.seccion_id === sec.id) { r.estado = 'igual'; r.mensaje = 'Ya está en esa sección'; }
          else if (a.seccion_id) r.mensaje = `Ya tiene sección asignada (${r.actual}); no se cambia`;
          else if (!a.activo) r.mensaje = 'El estudiante está inactivo';
          else if (lleno(sec.id)) r.mensaje = msgLleno;
          else { r.estado = 'ok'; r.mensaje = aplicar ? 'Asignado' : 'Existe: se asignará a la sección'; ocupar(sec.id); trabajo.push({ r, a, sec }); }
        } else if (!RE_NIE_CSV.test(nie)) r.mensaje = 'NIE no válido (7 u 8 números)';
        else if (nombre.length < 3 || nombre.length > 100 || !RE_NOMBRE.test(nombre)) r.mensaje = 'Nombre no válido (nombre y apellido, solo letras)';
        else if (correos.has((nie + DOMINIO).toLowerCase())) r.mensaje = 'Ya existe un usuario con ese correo';
        else if (lleno(sec.id)) r.mensaje = msgLleno;
        else { r.estado = 'nuevo'; r.actual = '-'; r.mensaje = aplicar ? 'Creado y asignado' : 'Se creará y asignará'; ocupar(sec.id); trabajo.push({ r, sec }); }
      }
      vistos.add(nie);
      return r;
    });

    if (aplicar && trabajo.length) {
      for (const t of trabajo.filter(t => !t.a)) {   // PIN y hash de cada estudiante nuevo, antes de abrir la transacción
        t.pin = pinNuevo(); t.hash = await bcrypt.hash(t.pin, 10);
      }
      await conn.beginTransaction();
      for (const t of trabajo) {
        if (t.a) {
          await conn.query('DELETE FROM alumno_seccion WHERE alumno_id = ?', [t.a.id]);
          await conn.query('INSERT INTO alumno_seccion (alumno_id, seccion_id) VALUES (?, ?)', [t.a.id, t.sec.id]);
        } else {
          const [ins] = await conn.query(
            "INSERT INTO usuarios (nombre, correo, password_hash, rol, nie, pin_cifrado) VALUES (?, ?, ?, 'alumno', ?, ?)",
            [t.r.nombre, t.r.nie + DOMINIO, t.hash, t.r.nie, cifrarPin(t.pin)]);
          await conn.query('INSERT INTO alumno_seccion (alumno_id, seccion_id) VALUES (?, ?)', [ins.insertId, t.sec.id]);
          t.r.pin = t.pin;
        }
      }
      await conn.commit();
    }
    const n = e => resultado.filter(r => r.estado === e).length;
    res.json({ aplicado: aplicar, resumen: { nuevo: n('nuevo'), ok: n('ok'), igual: n('igual'), error: n('error'), total: resultado.length }, filas: resultado });
  } catch (e) {
    await conn.rollback().catch(() => {});
    fallo(res, e);
  } finally { conn.release(); }
});

/* ---------- Gestión de la institución: meta de horas, proyectos y actividades ---------- */
app.get('/api/admin/config', ADMIN, async (req, res) => {
  try { res.json(await leerConfig()); } catch (e) { fallo(res, e); }
});

app.put('/api/admin/config', ADMIN, async (req, res) => {
  try {
    const meta = Number(req.body.meta_horas), max = Number(req.body.max_horas_semana);
    const inst = limpiarTexto(req.body.institucion, 120);
    if (!Number.isInteger(meta) || meta < 1 || meta > 2000) throw new ErrUsuario('La meta de horas debe ser un número entero entre 1 y 2000');
    if (!Number.isFinite(max) || max < 0 || max > 40 || !decimas(max)) throw new ErrUsuario('El máximo semanal debe estar entre 0 y 40 (con un decimal, por ejemplo 2.3). Usa 0 para no tener límite');
    if (inst.length < 3) throw new ErrUsuario('Escribe el nombre de la institución');
    await guardarConfig(pool, 'meta_horas', meta);
    await guardarConfig(pool, 'max_horas_semana', max);
    await guardarConfig(pool, 'institucion', inst);
    res.json({ ok: true });
  } catch (e) { fallo(res, e); }
});

app.get('/api/admin/proyectos', ADMIN, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.id, p.nombre, p.descripcion, p.activo,
        (SELECT COUNT(*) FROM actividades a WHERE a.proyecto_id = p.id) AS actividades
      FROM proyectos p ORDER BY p.nombre`);
    res.json(rows);
  } catch (e) { fallo(res, e); }
});

function validarProyecto(b) {
  const nombre = limpiarTexto(b.nombre, 100), descripcion = limpiarTexto(b.descripcion, 255);
  if (nombre.length < 3) throw new ErrUsuario('Escribe el nombre del proyecto (mínimo 3 caracteres)');
  return { nombre, descripcion, activo: b.activo === false || b.activo === 0 || b.activo === '0' ? 0 : 1 };
}

app.post('/api/admin/proyectos', ADMIN, async (req, res) => {
  try {
    const d = validarProyecto(req.body);
    const [r] = await pool.query('INSERT INTO proyectos (nombre, descripcion, activo) VALUES (?, ?, ?)', [d.nombre, d.descripcion, d.activo]);
    res.json({ ok: true, id: r.insertId });
  } catch (e) { fallo(res, e); }
});

app.put('/api/admin/proyectos/:id', ADMIN, async (req, res) => {
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Proyecto no válido');
    const d = validarProyecto(req.body);
    const [r] = await pool.query('UPDATE proyectos SET nombre = ?, descripcion = ?, activo = ? WHERE id = ?', [d.nombre, d.descripcion, d.activo, id]);
    if (!r.affectedRows) throw new ErrUsuario('El proyecto no existe');
    res.json({ ok: true });
  } catch (e) { fallo(res, e); }
});

app.delete('/api/admin/proyectos/:id', ADMIN, async (req, res) => {
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Proyecto no válido');
    const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM actividades WHERE proyecto_id = ?', [id]);
    if (n.n > 0) throw new ErrUsuario('El proyecto tiene actividades. Elimínalas primero o desactiva el proyecto.');
    const [arch] = await pool.query('SELECT nombre_guardado FROM proyecto_archivos WHERE proyecto_id = ?', [id]);
    await pool.query('DELETE FROM proyectos WHERE id = ?', [id]);   // sus archivos se borran de la base por ON DELETE CASCADE
    for (const a of arch) fs.promises.unlink(path.join(CARPETA_ARCHIVOS, a.nombre_guardado)).catch(() => {});
    res.json({ ok: true });
  } catch (e) { fallo(res, e); }
});

app.get('/api/admin/actividades', ADMIN, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.id, a.nombre, a.activa, a.proyecto_id, p.nombre AS proyecto,
        (SELECT COUNT(*) FROM registro_horas r WHERE r.actividad_id = a.id) AS usos
      FROM actividades a LEFT JOIN proyectos p ON p.id = a.proyecto_id
      ORDER BY p.nombre, a.nombre`);
    res.json(rows);
  } catch (e) { fallo(res, e); }
});

async function validarActividad(b, idActual) {
  const nombre = limpiarTexto(b.nombre, 100);
  if (nombre.length < 3) throw new ErrUsuario('Escribe el nombre de la actividad (mínimo 3 caracteres)');
  let proyectoId = null;
  if (b.proyecto_id !== null && b.proyecto_id !== undefined && b.proyecto_id !== '') {
    proyectoId = idOk(b.proyecto_id);
    const [[p]] = proyectoId ? await pool.query('SELECT id FROM proyectos WHERE id = ?', [proyectoId]) : [[]];
    if (!p) throw new ErrUsuario('El proyecto seleccionado no existe');
  }
  const [dup] = await pool.query('SELECT id FROM actividades WHERE nombre = ? AND proyecto_id <=> ? AND id <> ?', [nombre, proyectoId, idActual || 0]);
  if (dup.length) throw new ErrUsuario('Esa actividad ya existe en ese proyecto');
  return { nombre, proyectoId, activa: b.activa === false || b.activa === 0 || b.activa === '0' ? 0 : 1 };
}

app.post('/api/admin/actividades', ADMIN, async (req, res) => {
  try {
    const d = await validarActividad(req.body);
    const [r] = await pool.query('INSERT INTO actividades (proyecto_id, nombre, activa) VALUES (?, ?, ?)', [d.proyectoId, d.nombre, d.activa]);
    res.json({ ok: true, id: r.insertId });
  } catch (e) { fallo(res, e); }
});

app.put('/api/admin/actividades/:id', ADMIN, async (req, res) => {
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Actividad no válida');
    const d = await validarActividad(req.body, id);
    const [r] = await pool.query('UPDATE actividades SET proyecto_id = ?, nombre = ?, activa = ? WHERE id = ?', [d.proyectoId, d.nombre, d.activa, id]);
    if (!r.affectedRows) throw new ErrUsuario('La actividad no existe');
    res.json({ ok: true });
  } catch (e) { fallo(res, e); }
});

// Importar actividades desde un documento de Word (.docx): crea los proyectos que falten y registra las actividades una por una.
// Con ?aplicar=0 solo revisa y devuelve la vista previa; con ?aplicar=1 guarda. El navegador manda el .docx tal cual.
app.post('/api/admin/actividades/importar-word', ADMIN, express.raw({ type: () => true, limit: 5 * 1024 * 1024 }), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ErrUsuario('Elige un documento de Word (.docx)');
    const aplicar = req.query.aplicar === '1';
    let items;
    try { items = leerActividadesDocx(req.body); } catch (e) { throw new ErrUsuario(e.message); }
    if (!items.length) throw new ErrUsuario('No encontré actividades. Usa títulos «Proyecto: nombre» con una tabla de actividades, o una tabla con las columnas Proyecto y Actividad.');
    if (items.length > 500) throw new ErrUsuario('Máximo 500 actividades por documento');

    const [proys] = await conn.query('SELECT id, nombre FROM proyectos');
    const [acts] = await conn.query('SELECT proyecto_id, nombre FROM actividades');
    const proyPorNorm = new Map(proys.map(p => [normWord(p.nombre), p.id]));
    const actExiste = new Set(acts.map(a => `${a.proyecto_id || 0}|${normWord(a.nombre)}`));
    const vistos = new Set(), proyNuevos = new Set(), trabajo = [];
    const filas = items.map((it, i) => {
      const proyecto = limpiarTexto(it.proyecto, 100), actividad = limpiarTexto(it.actividad, 100);
      const r = { fila: i + 1, proyecto, actividad, estado: 'error', mensaje: '', proyecto_nuevo: false };
      const kP = normWord(proyecto), kA = normWord(actividad);
      if (String(it.actividad).trim().length > 100 || String(it.proyecto).trim().length > 100) r.mensaje = 'El nombre supera los 100 caracteres';
      else if (actividad.length < 3 || !kA) r.mensaje = 'El nombre de la actividad debe tener al menos 3 caracteres';
      else if (proyecto && (proyecto.length < 3 || !kP)) r.mensaje = 'El nombre del proyecto debe tener al menos 3 caracteres';
      else if (vistos.has(kP + '|' + kA)) r.mensaje = 'Repetida en el documento';
      else {
        vistos.add(kP + '|' + kA);
        const pid = kP ? proyPorNorm.get(kP) : 0;
        if (pid !== undefined && actExiste.has(`${pid || 0}|${kA}`)) { r.estado = 'igual'; r.mensaje = 'Ya existe en ese proyecto'; }
        else {
          r.estado = 'nuevo';
          r.proyecto_nuevo = !!kP && pid === undefined;
          if (r.proyecto_nuevo) proyNuevos.add(kP);
          r.mensaje = aplicar ? 'Creada' : (r.proyecto_nuevo ? 'Se creará (con proyecto nuevo)' : 'Se creará');
          trabajo.push(r);
        }
      }
      return r;
    });

    if (aplicar && trabajo.length) {
      await conn.beginTransaction();
      const cache = new Map(proyPorNorm);
      for (const t of trabajo) {
        let pid = null;
        if (t.proyecto) {
          const k = normWord(t.proyecto);
          pid = cache.get(k);
          if (pid === undefined) {
            const [r] = await conn.query("INSERT INTO proyectos (nombre, descripcion, activo) VALUES (?, '', 1)", [t.proyecto]);
            pid = r.insertId; cache.set(k, pid);
          }
        }
        await conn.query('INSERT INTO actividades (proyecto_id, nombre, activa) VALUES (?, ?, 1)', [pid, t.actividad]);
      }
      await conn.commit();
    }
    const n = e => filas.filter(f => f.estado === e).length;
    res.json({ aplicado: aplicar, resumen: { proyectos: proyNuevos.size, nuevas: n('nuevo'), igual: n('igual'), error: n('error'), total: filas.length }, filas });
  } catch (e) {
    await conn.rollback().catch(() => {});
    fallo(res, e);
  } finally { conn.release(); }
});

app.delete('/api/admin/actividades/:id', ADMIN, async (req, res) => {
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Actividad no válida');
    // Los registros de horas ya guardados conservan el nombre de la actividad
    await pool.query('UPDATE registro_horas SET actividad_id = NULL WHERE actividad_id = ?', [id]);
    const [arch] = await pool.query('SELECT nombre_guardado FROM proyecto_archivos WHERE actividad_id = ?', [id]);
    await pool.query('DELETE FROM proyecto_archivos WHERE actividad_id = ?', [id]);
    await pool.query('DELETE FROM actividades WHERE id = ?', [id]);
    for (const a of arch) fs.promises.unlink(path.join(CARPETA_ARCHIVOS, a.nombre_guardado)).catch(() => {});
    res.json({ ok: true });
  } catch (e) { fallo(res, e); }
});

// Actividades activas, para los formularios de carga de horas (docente y administrador)
// Proyectos con sus actividades y archivos. El administrador ve todo; el docente solo lo activo (solo lectura).
app.get('/api/proyectos', STAFF, async (req, res) => {
  try {
    const adm = req.session.usuario.rol === 'administrador';
    const [proy] = await pool.query(`SELECT id, nombre, descripcion, activo FROM proyectos${adm ? '' : ' WHERE activo = TRUE'} ORDER BY nombre`);
    const [act] = await pool.query(`SELECT a.id, a.nombre, a.activa, a.proyecto_id,
        (SELECT COUNT(*) FROM registro_horas r WHERE r.actividad_id = a.id) AS usos
      FROM actividades a${adm ? '' : ' WHERE a.activa = TRUE'} ORDER BY a.nombre`);
    const [arch] = await pool.query(`SELECT id, proyecto_id, actividad_id, nombre_original AS nombre, tamano, DATE_FORMAT(creado_en, '%Y-%m-%d') AS fecha
      FROM proyecto_archivos ORDER BY creado_en DESC, id DESC`);
    const fArch = a => ({ id: a.id, nombre: a.nombre, tamano: a.tamano, fecha: a.fecha });
    const mapA = r => ({ id: r.id, nombre: r.nombre, activa: !!r.activa, proyecto_id: r.proyecto_id, usos: Number(r.usos),
      archivos: arch.filter(a => a.actividad_id === r.id).map(fArch) });
    res.json({
      proyectos: proy.map(p => ({ id: p.id, nombre: p.nombre, descripcion: p.descripcion, activo: !!p.activo,
        actividades: act.filter(a => a.proyecto_id === p.id).map(mapA),
        archivos: arch.filter(a => a.proyecto_id === p.id).map(fArch) })),
      sin_proyecto: act.filter(a => !a.proyecto_id).map(mapA),
      max_archivo_mb: MAX_ARCHIVO / 1048576, extensiones: [...EXT_ARCHIVO],
    });
  } catch (e) { fallo(res, e); }
});

// Subir un archivo a un proyecto o a una actividad: el navegador manda el archivo tal cual y su nombre en la cabecera X-Nombre-Archivo
const subirArchivo = tipo => async (req, res) => {
  try {
    const esAct = tipo === 'actividad', tabla = esAct ? 'actividades' : 'proyectos', col = esAct ? 'actividad_id' : 'proyecto_id';
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario(esAct ? 'Actividad no válida' : 'Proyecto no válido');
    const [[p]] = await pool.query(`SELECT id FROM ${tabla} WHERE id = ?`, [id]);
    if (!p) throw new ErrUsuario(esAct ? 'La actividad no existe' : 'El proyecto no existe');
    let nombre = '';
    try { nombre = decodeURIComponent(String(req.get('x-nombre-archivo') || '')); } catch { nombre = ''; }
    nombre = nombre.replace(/[\\/\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(-150);
    const ext = path.extname(nombre).slice(1).toLowerCase();
    if (!nombre || !EXT_ARCHIVO.has(ext)) throw new ErrUsuario('Tipo de archivo no permitido. Se aceptan: ' + [...EXT_ARCHIVO].join(', '));
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ErrUsuario('El archivo está vacío');
    const [[n]] = await pool.query(`SELECT COUNT(*) AS n FROM proyecto_archivos WHERE ${col} = ?`, [id]);
    if (n.n >= MAX_ARCHIVOS_PROYECTO) throw new ErrUsuario(`${esAct ? 'Una actividad puede' : 'Un proyecto puede'} tener máximo ${MAX_ARCHIVOS_PROYECTO} archivos`);
    const guardado = crypto.randomUUID() + '.' + ext;
    await fs.promises.writeFile(path.join(CARPETA_ARCHIVOS, guardado), req.body);
    try {
      const [r] = await pool.query(`INSERT INTO proyecto_archivos (${col}, nombre_original, nombre_guardado, tamano, subido_por) VALUES (?, ?, ?, ?, ?)`,
        [id, nombre, guardado, req.body.length, req.session.usuario.id]);
      res.json({ ok: true, id: r.insertId });
    } catch (e) { await fs.promises.unlink(path.join(CARPETA_ARCHIVOS, guardado)).catch(() => {}); throw e; }
  } catch (e) { fallo(res, e); }
};
const cuerpoArchivo = express.raw({ type: () => true, limit: MAX_ARCHIVO });
app.post('/api/admin/proyectos/:id/archivos', ADMIN, cuerpoArchivo, subirArchivo('proyecto'));
app.post('/api/admin/actividades/:id/archivos', ADMIN, cuerpoArchivo, subirArchivo('actividad'));

app.delete('/api/admin/proyectos/archivos/:id', ADMIN, async (req, res) => {
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Archivo no válido');
    const [[a]] = await pool.query('SELECT nombre_guardado FROM proyecto_archivos WHERE id = ?', [id]);
    if (!a) throw new ErrUsuario('El archivo no existe');
    await pool.query('DELETE FROM proyecto_archivos WHERE id = ?', [id]);
    await fs.promises.unlink(path.join(CARPETA_ARCHIVOS, a.nombre_guardado)).catch(() => {});
    res.json({ ok: true });
  } catch (e) { fallo(res, e); }
});

// Descargar un archivo de proyecto (administrador y docentes)
app.get('/api/proyectos/archivos/:id', STAFF, async (req, res) => {
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Archivo no válido');
    const [[a]] = await pool.query('SELECT nombre_original, nombre_guardado FROM proyecto_archivos WHERE id = ?', [id]);
    if (!a) throw new ErrUsuario('El archivo no existe');
    res.set('X-Content-Type-Options', 'nosniff');
    res.download(path.join(CARPETA_ARCHIVOS, a.nombre_guardado), a.nombre_original, err => {
      if (err && !res.headersSent) res.status(404).json({ error: 'El archivo ya no está en el servidor' });
    });
  } catch (e) { fallo(res, e); }
});

app.get('/api/actividades', STAFF, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.id, a.nombre, p.nombre AS proyecto
      FROM actividades a LEFT JOIN proyectos p ON p.id = a.proyecto_id
      WHERE a.activa = TRUE AND (p.id IS NULL OR p.activo = TRUE)
      ORDER BY p.nombre, a.nombre`);
    res.json(rows);
  } catch (e) { fallo(res, e); }
});

/* =====================================================================
   ASISTENCIA (administrador y docente)
   ===================================================================== */
app.get('/api/admin/asistencia', STAFF, async (req, res) => {
  try {
    const sid = idOk(req.query.seccion_id), fecha = String(req.query.fecha || '');
    if (!sid || !fechaOk(fecha)) throw new ErrUsuario('Datos inválidos');
    await seccionPermitida(req.session.usuario, sid);
    const [rows] = await pool.query(`
      SELECT u.id, u.nie, u.nombre, x.estado, x.observacion
      FROM alumno_seccion a
      JOIN usuarios u ON u.id = a.alumno_id AND u.activo = TRUE
      LEFT JOIN asistencias x ON x.alumno_id = u.id AND x.fecha = ?
      WHERE a.seccion_id = ? ORDER BY u.nombre`, [fecha, sid]);
    res.json(rows.map(r => ({ id: r.id, nie: r.nie, nombre: r.nombre, estado: r.estado || null, obs: r.observacion || '' })));
  } catch (e) { fallo(res, e); }
});

// Un estudiante "Justificado" (permiso) recibe HORAS_PERMISO horas validadas ese día. Si después se cambia el estado, esas horas se quitan.
// Es seguro repetirlo: no duplica. Respeta la meta total (si faltan menos horas, suma solo lo que falta).
async function sincronizarHorasPermiso(conn, aid, sid, fecha, estado, userId, cfg) {
  const [ex] = await conn.query("SELECT id FROM registro_horas WHERE alumno_id = ? AND fecha = ? AND origen = 'permiso' LIMIT 1", [aid, fecha]);
  if (estado !== 'permiso') { if (ex.length) await conn.query('DELETE FROM registro_horas WHERE id = ?', [ex[0].id]); return 0; }
  if (ex.length) return 0;
  const [[tot]] = await conn.query("SELECT COALESCE(SUM(horas),0) AS h FROM registro_horas WHERE alumno_id = ? AND estado <> 'rechazado'", [aid]);
  const horas = Math.min(HORAS_PERMISO, Math.round((cfg.meta_horas - Number(tot.h)) * 10) / 10);
  if (horas <= 0) return 0;
  await conn.query(
    `INSERT INTO registro_horas (alumno_id, seccion_id, fecha, actividad_id, actividad, descripcion, horas, estado, registrado_por, origen)
     VALUES (?, ?, ?, NULL, 'Asistencia justificada', 'Horas automáticas por permiso o justificación', ?, 'validado', ?, 'permiso')`,
    [aid, sid, fecha, horas, userId]);
  return 1;
}

app.post('/api/admin/asistencia', STAFF, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const sid = idOk(req.body.seccion_id), { fecha, registros } = req.body;
    if (!sid || !fechaOk(fecha) || !Array.isArray(registros)) throw new ErrUsuario('Datos inválidos');
    if (fecha > hoyStr()) throw new ErrUsuario('No se puede registrar asistencia de una fecha futura');
    await seccionPermitida(req.session.usuario, sid);
    const [alumnos] = await conn.query(
      'SELECT a.alumno_id FROM alumno_seccion a JOIN usuarios u ON u.id = a.alumno_id AND u.activo = TRUE WHERE a.seccion_id = ?', [sid]);
    const validos = new Set(alumnos.map(a => a.alumno_id));
    const cfg = await leerConfig(conn);
    let horasAuto = 0;
    await conn.beginTransaction();
    for (const r of registros.slice(0, 500)) {
      const aid = idOk(r.alumno_id);
      if (!aid || !validos.has(aid)) continue;
      if (!ESTADOS.includes(r.estado)) throw new ErrUsuario('Estado no válido: ' + r.estado);
      const obs = String(r.obs || '').trim().slice(0, 255);
      await conn.query(
        `INSERT INTO asistencias (alumno_id, seccion_id, fecha, horas, estado, observacion) VALUES (?, ?, ?, 0, ?, ?)
         ON DUPLICATE KEY UPDATE estado = VALUES(estado), observacion = VALUES(observacion)`,
        [aid, sid, fecha, r.estado, obs]);
      horasAuto += await sincronizarHorasPermiso(conn, aid, sid, fecha, r.estado, req.session.usuario.id, cfg);
    }
    await conn.commit();
    res.json({ ok: true, horas_auto: horasAuto, horas_por_permiso: HORAS_PERMISO });
  } catch (e) {
    await conn.rollback().catch(() => {});
    fallo(res, e);
  } finally { conn.release(); }
});

/* ---- Asistencia de DOCENTES (la marca el administrador) ---- */
app.get('/api/admin/asistencia-docentes', ADMIN, async (req, res) => {
  try {
    const fecha = String(req.query.fecha || '');
    if (!fechaOk(fecha)) throw new ErrUsuario('Fecha inválida');
    const [rows] = await pool.query(`
      SELECT u.id, u.nie, u.nombre, x.estado, x.observacion
      FROM usuarios u LEFT JOIN asistencia_docentes x ON x.docente_id = u.id AND x.fecha = ?
      WHERE u.rol = 'docente' AND u.activo = TRUE ORDER BY u.nombre`, [fecha]);
    res.json(rows.map(r => ({ id: r.id, nie: r.nie, nombre: r.nombre, estado: r.estado || null, obs: r.observacion || '' })));
  } catch (e) { fallo(res, e); }
});

app.post('/api/admin/asistencia-docentes', ADMIN, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { fecha, registros } = req.body;
    if (!fechaOk(fecha) || !Array.isArray(registros)) throw new ErrUsuario('Datos inválidos');
    if (fecha > hoyStr()) throw new ErrUsuario('No se puede registrar asistencia de una fecha futura');
    const [docs] = await conn.query("SELECT id FROM usuarios WHERE rol = 'docente' AND activo = TRUE");
    const validos = new Set(docs.map(d => d.id));
    await conn.beginTransaction();
    for (const r of registros.slice(0, 500)) {
      const did = idOk(r.docente_id);
      if (!did || !validos.has(did)) continue;
      if (!ESTADOS.includes(r.estado)) throw new ErrUsuario('Estado no válido: ' + r.estado);
      await conn.query(
        `INSERT INTO asistencia_docentes (docente_id, fecha, estado, observacion, registrado_por) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE estado = VALUES(estado), observacion = VALUES(observacion), registrado_por = VALUES(registrado_por)`,
        [did, fecha, r.estado, String(r.obs || '').trim().slice(0, 255), req.session.usuario.id]);
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    fallo(res, e);
  } finally { conn.release(); }
});

/* =====================================================================
   DOCENTE (y administrador): estudiantes y registro de horas
   ===================================================================== */
// Cuántas horas más puede recibir un alumno en la semana de `fecha`: respeta el máximo semanal y la meta total
// Límite semanal que le corresponde a un estudiante: el suyo si el docente lo amplió, o el general de la institución.
// 0 = sin límite semanal.
async function limiteAlumno(db, alumnoId, cfg) {
  const [[u]] = await db.query('SELECT limite_semanal FROM usuarios WHERE id = ?', [alumnoId]);
  return cfg.max_horas_semana;   // un solo límite para todos: el que el administrador define en Institución (los límites personales antiguos ya no se usan)
}

async function cupoAlumno(db, alumnoId, fecha, cfg, ignorarSemana = false) {
  const [[sem]] = await db.query(
    "SELECT COALESCE(SUM(horas),0) AS h FROM registro_horas WHERE alumno_id = ? AND estado = 'validado' AND (origen IS NULL OR origen <> 'perfil') AND YEARWEEK(fecha,1) = YEARWEEK(?,1)", [alumnoId, fecha]);
  const [[tot]] = await db.query("SELECT COALESCE(SUM(horas),0) AS h FROM registro_horas WHERE alumno_id = ? AND estado <> 'rechazado'", [alumnoId]);
  const limite = await limiteAlumno(db, alumnoId, cfg);
  const porMeta = cfg.meta_horas - Number(tot.h);
  const porSemana = !ignorarSemana && limite > 0 ? limite - Number(sem.h) : Infinity;
  return Math.max(0, Math.round(Math.min(porMeta, porSemana) * 10) / 10);   // redondeo a décimas (evita 1.1999999)
}

// Valida y normaliza los datos comunes de un registro de horas (fecha, actividad, descripción, estado)
async function datosRegistro(b, db = pool) {
  const fecha = String(b.fecha || '');
  if (!fechaOk(fecha)) throw new ErrUsuario('Fecha no válida');
  if (fecha > hoyStr()) throw new ErrUsuario('No se pueden registrar horas con fecha futura');
  const descripcion = limpiarTexto(b.descripcion, 255);
  const estado = b.estado === 'pendiente' ? 'pendiente' : 'validado';
  let actividadId = null, actividad = limpiarTexto(b.actividad, 100);
  if (b.actividad_id !== null && b.actividad_id !== undefined && b.actividad_id !== '') {
    actividadId = idOk(b.actividad_id);
    const [[a]] = actividadId ? await db.query('SELECT id, nombre FROM actividades WHERE id = ? AND activa = TRUE', [actividadId]) : [[]];
    if (!a) throw new ErrUsuario('La actividad seleccionada no existe o está inactiva');
    actividad = a.nombre;
  }
  if (actividad.length < 3) throw new ErrUsuario('Indica la actividad realizada (mínimo 3 caracteres)');
  return { fecha, descripcion, estado, actividadId, actividad };
}

const decimas = n => Math.abs(n * 10 - Math.round(n * 10)) < 1e-6;   // se aceptan décimas: 2.3, 1.5, 0.1...
const horasOk = h => Number.isFinite(h) && h > 0 && h <= MAX_HORAS_REGISTRO && decimas(h);

// opciones.ignorarSemana: desde el perfil del estudiante no se aplica el límite semanal (solo la meta total)
async function insertarHoras(conn, a, d, horas, userId, cfg, opciones = {}) {
  if (!horasOk(horas)) throw new ErrUsuario(`Las horas deben estar entre 0.1 y ${MAX_HORAS_REGISTRO} (con un decimal, por ejemplo 2.3)`);
  const cupo = await cupoAlumno(conn, a.id, d.fecha, cfg, !!opciones.ignorarSemana);
  if (horas > cupo) throw new ErrUsuario(opciones.ignorarSemana
    ? `${a.nombre} solo puede recibir ${cupo} h más (meta de ${cfg.meta_horas} h)`
    : `${a.nombre} solo puede registrar ${cupo} h en esa semana (límite semanal del estudiante o meta de ${cfg.meta_horas} h)`);
  await conn.query(
    `INSERT INTO registro_horas (alumno_id, seccion_id, fecha, actividad_id, actividad, descripcion, horas, estado, registrado_por, origen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.id, a.seccion_id, d.fecha, d.actividadId, d.actividad, d.descripcion, horas, d.estado, userId, opciones.origen || null]);
}

// Listado de estudiantes (de las secciones del docente; el administrador ve todos) con su avance
app.get('/api/docente/alumnos', STAFF, async (req, res) => {
  try {
    const u = req.session.usuario;
    const fecha = fechaOk(String(req.query.fecha || '')) ? String(req.query.fecha) : hoyStr();
    const amb = ambito(u);
    const sid = idOk(req.query.seccion_id);
    const cfg = await leerConfig();
    const [rows] = await pool.query(`
      SELECT x.id, x.nie, x.nombre, x.limite_semanal, s.id AS seccion_id, s.especialidad, s.seccion, s.anio,
        (SELECT COALESCE(SUM(r.horas),0) FROM registro_horas r WHERE r.alumno_id = x.id AND r.estado = 'validado') AS validadas,
        (SELECT COALESCE(SUM(r.horas),0) FROM registro_horas r WHERE r.alumno_id = x.id AND r.estado = 'pendiente') AS pendientes,
        (SELECT COALESCE(SUM(r.horas),0) FROM registro_horas r WHERE r.alumno_id = x.id AND r.estado = 'validado' AND (r.origen IS NULL OR r.origen <> 'perfil') AND YEARWEEK(r.fecha,1) = YEARWEEK(?,1)) AS semana
      FROM usuarios x
      JOIN alumno_seccion al ON al.alumno_id = x.id
      JOIN secciones s ON s.id = al.seccion_id
      WHERE x.rol = 'alumno' AND x.activo = TRUE${amb.sql}${sid ? ' AND s.id = ?' : ''}
      ORDER BY x.nombre`, [fecha, ...amb.p, ...(sid ? [sid] : [])]);
    res.json(rows.map(r => ({
      id: r.id, nie: r.nie, nombre: r.nombre, seccion_id: r.seccion_id, grupo: r.especialidad + ' ' + r.seccion, anio: r.anio,   // grupo queda sin año: los PDF toman de ahí el número de sección
      validadas: Number(r.validadas), pendientes: Number(r.pendientes), semana: Number(r.semana),
      limite: cfg.max_horas_semana,   // límite semanal (0 = sin límite)
      limite_propio: false,
    })));
  } catch (e) { fallo(res, e); }
});

// Perfil de un estudiante: historial de horas y resumen de asistencia
app.get('/api/docente/alumnos/:id', STAFF, async (req, res) => {
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Estudiante no válido');
    const a = await alumnoPermitido(req.session.usuario, id);
    const [registros] = await pool.query(`
      SELECT r.id, DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha, r.actividad, r.descripcion, r.observacion, r.horas, r.estado,
             d.nombre AS registrado_por
      FROM registro_horas r LEFT JOIN usuarios d ON d.id = r.registrado_por
      WHERE r.alumno_id = ? ORDER BY r.fecha DESC, r.id DESC`, [id]);
    const [asis] = await pool.query(
      'SELECT estado, COUNT(*) AS n FROM asistencias WHERE alumno_id = ? AND estado IS NOT NULL GROUP BY estado', [id]);
    const asistencia = { presente: 0, tarde: 0, falto: 0, permiso: 0 };
    asis.forEach(r => { asistencia[r.estado] = Number(r.n); });
    const cfg = await leerConfig();
    const regs = registros.map(r => ({ ...r, horas: Number(r.horas) }));
    res.json({
      alumno: { id: a.id, nie: a.nie, nombre: a.nombre, activo: !!a.activo, grupo: a.seccion_id ? a.especialidad + ' ' + a.seccion : '-', anio: a.anio || null },
      meta: cfg.meta_horas, max_semana: cfg.max_horas_semana,
      limite_propio: null, limite_general: cfg.max_horas_semana,
      validadas: regs.filter(r => r.estado === 'validado').reduce((s, r) => s + r.horas, 0),
      pendientes: regs.filter(r => r.estado === 'pendiente').reduce((s, r) => s + r.horas, 0),
      registros: regs, asistencia,
    });
  } catch (e) { fallo(res, e); }
});

// Agregar un registro de horas a un estudiante (formulario del perfil)
app.post('/api/docente/alumnos/:id/horas', STAFF, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Estudiante no válido');
    const u = req.session.usuario;
    const a = await alumnoPermitido(u, id, conn);
    if (!a.activo) throw new ErrUsuario('El estudiante está inactivo');
    const d = await datosRegistro(req.body, conn);
    const cfg = await leerConfig(conn);
    await conn.beginTransaction();
    // Desde el perfil: hasta 40 h por registro y sin el límite semanal (solo se detiene en la meta total)
    await insertarHoras(conn, a, d, Number(req.body.horas), u.id, cfg, { ignorarSemana: true, origen: 'perfil' });
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    fallo(res, e);
  } finally { conn.release(); }
});

// Carga masiva: la misma actividad para varios estudiantes, cada uno con sus horas
app.post('/api/docente/horas', STAFF, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const u = req.session.usuario;
    const registros = Array.isArray(req.body.registros) ? req.body.registros.slice(0, 500) : [];
    if (!registros.length) throw new ErrUsuario('No hay estudiantes marcados');
    const d = await datosRegistro(req.body, conn);
    const cfg = await leerConfig(conn);
    await conn.beginTransaction();
    for (const r of registros) {
      const aid = idOk(r.alumno_id);
      if (!aid) throw new ErrUsuario('Estudiante no válido');
      const a = await alumnoPermitido(u, aid, conn);
      if (!a.activo) continue;
      await insertarHoras(conn, a, d, Number(r.horas), u.id, cfg);
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    fallo(res, e);
  } finally { conn.release(); }
});

// Validar de una vez las horas pendientes de una fecha para varios estudiantes (al terminar la actividad)
app.post('/api/docente/horas/validar-fecha', STAFF, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const u = req.session.usuario, fecha = String(req.body.fecha || '');
    if (!fechaOk(fecha)) throw new ErrUsuario('Fecha inválida');
    const ids = [...new Set((Array.isArray(req.body.alumno_ids) ? req.body.alumno_ids : []).slice(0, 500).map(idOk).filter(Boolean))];
    if (!ids.length) throw new ErrUsuario('No hay estudiantes');
    const permitidos = [];
    for (const id of ids) { const a = await alumnoPermitido(u, id, conn); if (a.activo) permitidos.push(id); }
    if (!permitidos.length) return res.json({ ok: true, registros: 0, horas: 0 });
    await conn.beginTransaction();
    const cfg = await leerConfig(conn);
    let n = 0, h = 0, omitidos = 0;
    for (const aid of permitidos) {
      const limite = await limiteAlumno(conn, aid, cfg);
      const [pend] = await conn.query("SELECT id, horas, origen FROM registro_horas WHERE alumno_id = ? AND estado = 'pendiente' AND fecha = ? ORDER BY id", [aid, fecha]);
      if (!pend.length) continue;
      const [[sem]] = await conn.query("SELECT COALESCE(SUM(horas),0) AS h FROM registro_horas WHERE alumno_id = ? AND estado = 'validado' AND (origen IS NULL OR origen <> 'perfil') AND YEARWEEK(fecha,1) = YEARWEEK(?,1)", [aid, fecha]);
      let acum = Number(sem.h);
      for (const r of pend) {
        const delPerfil = r.origen === 'perfil';   // lo registrado desde el perfil no se limita por semana
        if (!delPerfil && limite > 0 && Math.round((acum + Number(r.horas)) * 10) / 10 > limite) { omitidos++; continue; }   // pasaría el máximo semanal
        await conn.query("UPDATE registro_horas SET estado = 'validado', revisado_por = ?, revisado_en = NOW() WHERE id = ?", [u.id, r.id]);
        if (!delPerfil) acum += Number(r.horas);
        n++; h += Number(r.horas);
      }
    }
    await conn.commit();
    res.json({ ok: true, registros: n, horas: h, omitidos });
  } catch (e) {
    await conn.rollback().catch(() => {});
    fallo(res, e);
  } finally { conn.release(); }
});

// Revisar un registro (validar o rechazar). Solo el personal autorizado sobre ese estudiante puede hacerlo.
// El rechazo exige una observación para que el estudiante sepa el motivo; al validar es opcional.
async function revisarRegistro(req, estado) {
  const id = idOk(req.params.id);
  if (!id) throw new ErrUsuario('Registro no válido');
  const [[r]] = await pool.query('SELECT alumno_id, estado FROM registro_horas WHERE id = ?', [id]);
  if (!r) throw new ErrUsuario('El registro no existe');
  await alumnoPermitido(req.session.usuario, r.alumno_id);
  const obs = limpiarTexto(req.body && req.body.observacion, 255);
  if (estado === 'rechazado' && obs.length < 3) throw new ErrUsuario('Escribe el motivo del rechazo (mínimo 3 caracteres)');
  await pool.query('UPDATE registro_horas SET estado = ?, observacion = ?, revisado_por = ?, revisado_en = NOW() WHERE id = ?',
    [estado, obs || null, req.session.usuario.id, id]);
}
app.post('/api/docente/horas/:id/validar', STAFF, async (req, res) => {
  try { await revisarRegistro(req, 'validado'); res.json({ ok: true }); } catch (e) { fallo(res, e); }
});
app.post('/api/docente/horas/:id/rechazar', STAFF, async (req, res) => {
  try { await revisarRegistro(req, 'rechazado'); res.json({ ok: true }); } catch (e) { fallo(res, e); }
});

// Eliminar un registro (corregir un error de captura)
app.delete('/api/docente/horas/:id', STAFF, async (req, res) => {
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Registro no válido');
    const [[r]] = await pool.query('SELECT alumno_id FROM registro_horas WHERE id = ?', [id]);
    if (!r) throw new ErrUsuario('El registro no existe');
    await alumnoPermitido(req.session.usuario, r.alumno_id);
    await pool.query('DELETE FROM registro_horas WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) { fallo(res, e); }
});

// Excepción por estudiante: el docente sube (o quita) el límite semanal de horas de un estudiante de sus secciones.
// limite = número con un decimal (0.1 a 40), o null para volver al límite general de la institución.
// El docente (o el administrador) da de alta a un estudiante en una de sus secciones activas. Devuelve el PIN generado.
app.post('/api/docente/alumnos', STAFF, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const u = req.session.usuario;
    const nie = String(req.body.nie || '').trim(), nombre = limpiarNombre(req.body.nombre), correo = nie + DOMINIO;
    if (!RE_NIE.test(nie)) throw new ErrUsuario('El NIE debe tener exactamente 8 números');
    if (nombre.length < 3 || nombre.length > 100 || !RE_NOMBRE.test(nombre)) throw new ErrUsuario('El nombre debe tener solo letras (nombre y apellido)');
    const sid = idOk(req.body.seccion_id);
    if (!sid) throw new ErrUsuario('Elige la sección del estudiante');
    await seccionPermitida(u, sid);
    const [[sec]] = await conn.query('SELECT activa FROM secciones WHERE id = ?', [sid]);
    if (!sec.activa) throw new ErrUsuario('La sección está inactiva');
    const [ya] = await conn.query('SELECT id FROM usuarios WHERE nie = ? OR correo = ?', [nie, correo]);
    if (ya.length) throw new ErrUsuario('Ya existe un usuario con ese NIE');
    if (await ocupadosSeccion(conn, sid) >= MAX_POR_SECCION) throw new ErrUsuario(`La sección ya tiene ${MAX_POR_SECCION} estudiantes (cupo lleno)`);
    const pin = pinNuevo(), hash = await bcrypt.hash(pin, 10);
    await conn.beginTransaction();
    const [r] = await conn.query("INSERT INTO usuarios (nombre, correo, password_hash, rol, nie, pin_cifrado) VALUES (?, ?, ?, 'alumno', ?, ?)",
      [nombre, correo, hash, nie, cifrarPin(pin)]);
    await conn.query('INSERT INTO alumno_seccion (alumno_id, seccion_id) VALUES (?, ?)', [r.insertId, sid]);
    await conn.commit();
    res.json({ ok: true, id: r.insertId, pin });
  } catch (e) {
    await conn.rollback().catch(() => {});
    fallo(res, e);
  } finally { conn.release(); }
});

// Ver el PIN de un estudiante de mis secciones
app.get('/api/docente/alumnos/:id/pin', STAFF, async (req, res) => {
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Estudiante no válido');
    await alumnoPermitido(req.session.usuario, id);
    const [[u]] = await pool.query('SELECT pin_cifrado FROM usuarios WHERE id = ?', [id]);
    if (!u || !u.pin_cifrado) throw new ErrUsuario('Este estudiante no tiene el PIN guardado. Usa "Nuevo PIN".');
    res.json({ pin: descifrarPin(u.pin_cifrado) });
  } catch (e) { fallo(res, e); }
});

// Generar un PIN nuevo para un estudiante de mis secciones (el anterior deja de funcionar)
app.post('/api/docente/alumnos/:id/pin', STAFF, async (req, res) => {
  try {
    const id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Estudiante no válido');
    await alumnoPermitido(req.session.usuario, id);
    const pin = pinNuevo();
    await pool.query('UPDATE usuarios SET password_hash = ?, pin_cifrado = ? WHERE id = ?', [await bcrypt.hash(pin, 10), cifrarPin(pin), id]);
    res.json({ pin });
  } catch (e) { fallo(res, e); }
});

// Bitácora de horas validadas (para el PDF del resumen)
app.get('/api/docente/bitacora', STAFF, async (req, res) => {
  try {
    const amb = ambito(req.session.usuario);
    const [rows] = await pool.query(`
      SELECT DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha, x.nie AS carnet, x.nombre, CONCAT(s.especialidad, ' ', s.seccion, ' (', s.anio, ')') AS grupo, r.horas
      FROM registro_horas r
      JOIN usuarios x ON x.id = r.alumno_id
      JOIN secciones s ON s.id = r.seccion_id
      WHERE r.estado = 'validado'${amb.sql}
      ORDER BY r.fecha DESC, r.id DESC`, amb.p);
    res.json(rows.map(r => ({ ...r, horas: Number(r.horas) })));
  } catch (e) { fallo(res, e); }
});

/* =====================================================================
   ESTUDIANTE (solo lectura, salvo contacto y PIN propios)
   Todas las consultas usan req.session.usuario.id: el estudiante nunca envía el id de otra persona.
   ===================================================================== */
// Datos básicos del alumno + totales. Solo las horas 'validado' cuentan; pendientes y rechazadas se informan aparte.
async function resumenAlumno(id) {
  const cfg = await leerConfig();
  const [[a]] = await pool.query(`
    SELECT u.nombre, u.nie, u.activo, u.limite_semanal, s.id AS seccion_id, s.especialidad, s.seccion FROM usuarios u
    LEFT JOIN alumno_seccion al ON al.alumno_id = u.id LEFT JOIN secciones s ON s.id = al.seccion_id
    WHERE u.id = ? AND u.rol = 'alumno' LIMIT 1`, [id]);
  if (!a) throw new ErrUsuario('Estudiante no encontrado');
  const [[t]] = await pool.query(`
    SELECT COALESCE(SUM(CASE WHEN estado = 'validado'  THEN horas END), 0) AS validadas,
           COALESCE(SUM(CASE WHEN estado = 'pendiente' THEN horas END), 0) AS pendientes,
           COALESCE(SUM(CASE WHEN estado = 'rechazado' THEN horas END), 0) AS rechazadas
    FROM registro_horas WHERE alumno_id = ?`, [id]);
  const validadas = Number(t.validadas);
  return {
    cfg, validadas, pendientes: Number(t.pendientes), rechazadas: Number(t.rechazadas),
    restantes: Math.max(0, cfg.meta_horas - validadas),
    limite_semanal: cfg.max_horas_semana,
    // Requisitos de la constancia (se comprueban aquí, en el servidor): meta alcanzada con horas validadas,
    // cuenta activa y sección asignada. Para agregar otra condición institucional, súmala a esta línea.
    constancia: validadas >= cfg.meta_horas && !!a.activo && !!a.seccion_id,
    alumno: {
      nombre: a.nombre, nie: a.nie, especialidad: a.especialidad || '', seccion_id: a.seccion_id,
      seccion: a.seccion ? a.especialidad + ' ' + a.seccion : '-',
    },
  };
}

// Campos de una jornada tal como los ve el estudiante
const SQL_JORNADA = `r.id, DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha, r.actividad, r.descripcion, r.horas, r.estado,
  r.observacion, DATE_FORMAT(r.revisado_en, '%Y-%m-%d') AS revisado_en, d.nombre AS revisado_por`;
const mapJornada = r => ({ ...r, horas: Number(r.horas) });

app.get('/api/alumno/resumen', ALUMNO, async (req, res) => {
  try {
    const id = req.session.usuario.id;
    const r = await resumenAlumno(id);
    const [recientes] = await pool.query(`
      SELECT ${SQL_JORNADA} FROM registro_horas r LEFT JOIN usuarios d ON d.id = r.revisado_por
      WHERE r.alumno_id = ? ORDER BY r.fecha DESC, r.id DESC LIMIT 5`, [id]);
    res.json({
      alumno: r.alumno, meta: r.cfg.meta_horas, validadas: r.validadas, pendientes: r.pendientes, rechazadas: r.rechazadas,
      restantes: r.restantes, limite_semanal: r.limite_semanal, cumplida: r.constancia, recientes: recientes.map(mapJornada),
    });
  } catch (e) { fallo(res, e); }
});

// Historial con filtros (estado y rango de fechas) y paginación en el servidor
app.get('/api/alumno/jornadas', ALUMNO, async (req, res) => {
  try {
    const id = req.session.usuario.id;
    const c = ['r.alumno_id = ?'], p = [id];
    const estado = String(req.query.estado || '');
    if (estado) {
      if (!['pendiente', 'validado', 'rechazado'].includes(estado)) throw new ErrUsuario('Estado no válido');
      c.push('r.estado = ?'); p.push(estado);
    }
    const desde = String(req.query.desde || ''), hasta = String(req.query.hasta || '');
    if (desde) { if (!fechaOk(desde)) throw new ErrUsuario('Fecha "desde" no válida'); c.push('r.fecha >= ?'); p.push(desde); }
    if (hasta) { if (!fechaOk(hasta)) throw new ErrUsuario('Fecha "hasta" no válida'); c.push('r.fecha <= ?'); p.push(hasta); }
    if (desde && hasta && desde > hasta) throw new ErrUsuario('La fecha "desde" no puede ser posterior a "hasta"');
    const por = 10, pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    const [[n]] = await pool.query(`SELECT COUNT(*) AS n, COALESCE(SUM(r.horas), 0) AS horas FROM registro_horas r WHERE ${c.join(' AND ')}`, p);
    const [rows] = await pool.query(`
      SELECT ${SQL_JORNADA} FROM registro_horas r LEFT JOIN usuarios d ON d.id = r.revisado_por
      WHERE ${c.join(' AND ')} ORDER BY r.fecha DESC, r.id DESC LIMIT ? OFFSET ?`, [...p, por, (pagina - 1) * por]);
    res.json({ total: Number(n.n), horas: Number(n.horas), pagina, por, registros: rows.map(mapJornada) });
  } catch (e) { fallo(res, e); }
});

// Eventos y avisos: solo los dirigidos a todos o a la sección del estudiante
async function seccionDelAlumno(id) {
  const [[s]] = await pool.query('SELECT seccion_id FROM alumno_seccion WHERE alumno_id = ? LIMIT 1', [id]);
  return s ? s.seccion_id : null;
}

app.get('/api/alumno/calendario', ALUMNO, async (req, res) => {
  try {
    const sid = await seccionDelAlumno(req.session.usuario.id);
    const [rows] = await pool.query(`
      SELECT e.id, e.titulo, e.descripcion, e.lugar, DATE_FORMAT(e.fecha, '%Y-%m-%d') AS fecha,
             TIME_FORMAT(e.hora_inicio, '%H:%i') AS hora_inicio, TIME_FORMAT(e.hora_fin, '%H:%i') AS hora_fin,
             (e.seccion_id IS NULL) AS general
      FROM eventos e WHERE (e.seccion_id IS NULL OR e.seccion_id <=> ?)
      ORDER BY e.fecha, e.hora_inicio`, [sid]);
    const hoy = hoyStr();
    res.json({
      proximos: rows.filter(e => e.fecha >= hoy).map(e => ({ ...e, general: !!e.general })),
      pasados: rows.filter(e => e.fecha < hoy).reverse().slice(0, 50).map(e => ({ ...e, general: !!e.general })),
    });
  } catch (e) { fallo(res, e); }
});

app.get('/api/alumno/avisos', ALUMNO, async (req, res) => {
  try {
    const sid = await seccionDelAlumno(req.session.usuario.id);
    const por = Math.min(20, Math.max(1, parseInt(req.query.por, 10) || 10)), pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM avisos a WHERE (a.seccion_id IS NULL OR a.seccion_id <=> ?)', [sid]);
    const [rows] = await pool.query(`
      SELECT a.id, a.titulo, a.contenido, DATE_FORMAT(a.creado_en, '%Y-%m-%d') AS publicado,
             DATE_FORMAT(a.fecha_actividad, '%Y-%m-%d') AS fecha_actividad, u.nombre AS autor, (a.seccion_id IS NULL) AS general
      FROM avisos a LEFT JOIN usuarios u ON u.id = a.publicado_por
      WHERE (a.seccion_id IS NULL OR a.seccion_id <=> ?)
      ORDER BY a.creado_en DESC, a.id DESC LIMIT ? OFFSET ?`, [sid, por, (pagina - 1) * por]);
    res.json({ total: Number(n.n), pagina, por, avisos: rows.map(r => ({ ...r, general: !!r.general })) });
  } catch (e) { fallo(res, e); }
});

// Datos personales que la institución autoriza a cambiar: solo correo y teléfono.
// NIE, nombre, rol, sección, especialidad y horas NO se pueden tocar desde aquí.
app.put('/api/alumno/perfil', ALUMNO, async (req, res) => {
  try {
    const id = req.session.usuario.id;
    const correo = String(req.body.correo || '').trim().toLowerCase();
    const telefono = String(req.body.telefono || '').trim();
    if (!RE_CORREO.test(correo) || correo.length > 120) throw new ErrUsuario('Correo electrónico no válido');
    if (telefono && !/^[0-9+\-() ]{8,20}$/.test(telefono)) throw new ErrUsuario('Teléfono no válido (8 a 20 caracteres: números, +, -, paréntesis)');
    const [dup] = await pool.query('SELECT id FROM usuarios WHERE correo = ? AND id <> ?', [correo, id]);
    if (dup.length) throw new ErrUsuario('Ese correo ya lo usa otro usuario');
    await pool.query('UPDATE usuarios SET correo = ?, telefono = ? WHERE id = ?', [correo, telefono || null, id]);
    res.json({ ok: true });
  } catch (e) { fallo(res, e); }
});

// Datos de la constancia: el servidor solo los entrega si se cumplen los requisitos
app.get('/api/alumno/constancia', ALUMNO, async (req, res) => {
  try {
    const id = req.session.usuario.id;
    const r = await resumenAlumno(id);
    if (!r.constancia) {
      return res.status(403).json({ error: `Aún no cumples los requisitos de la constancia (${r.cfg.meta_horas} horas validadas)` });
    }
    const [registros] = await pool.query(`
      SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, actividad, descripcion, horas
      FROM registro_horas WHERE alumno_id = ? AND estado = 'validado' ORDER BY fecha, id`, [id]);
    res.json({
      institucion: r.cfg.institucion, meta: r.cfg.meta_horas, horas: r.validadas, alumno: r.alumno,
      emitida: hoyStr(), folio: 'CT-' + new Date().getFullYear() + '-' + String(id).padStart(5, '0'),
      registros: registros.map(x => ({ ...x, horas: Number(x.horas) })),
    });
  } catch (e) { fallo(res, e); }
});

/* =====================================================================
   PUBLICACIONES DEL PERSONAL: avisos y eventos que ven los estudiantes
   Solo el docente publica, y solo para sus secciones asignadas.
   ===================================================================== */
// Destinatarios: null = todos (solo el administrador); si no, una sección permitida para quien publica
async function destinoPublicacion(u, valor) {
  if (valor === null || valor === undefined || valor === '') {
    if (u.rol !== 'administrador') throw new ErrUsuario('Elige la sección a la que va dirigido');
    return null;
  }
  const sid = idOk(valor);
  if (!sid) throw new ErrUsuario('Sección no válida');
  await seccionPermitida(u, sid);
  return sid;
}
const horaOk = h => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h));
// El docente ve lo suyo y lo dirigido a sus secciones; el administrador ve todo
const alcancePub = (u, aliasSec, aliasAutor) => u.rol === 'docente'
  ? { sql: ` WHERE ${aliasAutor} = ? OR EXISTS (SELECT 1 FROM docente_seccion q WHERE q.seccion_id = ${aliasSec} AND q.docente_id = ?)`, p: [u.id, u.id] }
  : { sql: '', p: [] };

app.get('/api/staff/avisos', DOCENTE, async (req, res) => {
  try {
    const u = req.session.usuario, amb = alcancePub(u, 'a.seccion_id', 'a.publicado_por');
    const [rows] = await pool.query(`
      SELECT a.id, a.titulo, a.contenido, DATE_FORMAT(a.creado_en, '%Y-%m-%d') AS publicado,
             DATE_FORMAT(a.fecha_actividad, '%Y-%m-%d') AS fecha_actividad, a.publicado_por,
             a.seccion_id, CASE WHEN s.id IS NULL THEN 'Todos los estudiantes' ELSE CONCAT(s.especialidad, ' ', s.seccion, ' (', s.anio, ')') END AS destino
      FROM avisos a LEFT JOIN secciones s ON s.id = a.seccion_id${amb.sql}
      ORDER BY a.creado_en DESC, a.id DESC LIMIT 100`, amb.p);
    res.json(rows.map(r => ({ ...r, mio: r.publicado_por === u.id })));
  } catch (e) { fallo(res, e); }
});

app.post('/api/staff/avisos', DOCENTE, async (req, res) => {
  try {
    const u = req.session.usuario;
    const titulo = limpiarTexto(req.body.titulo, 120);
    const contenido = String(req.body.contenido || '').replace(/\r\n/g, '\n').trim().slice(0, 2000);
    const fa = String(req.body.fecha_actividad || '');
    if (titulo.length < 3) throw new ErrUsuario('Escribe el título del aviso (mínimo 3 caracteres)');
    if (contenido.length < 3) throw new ErrUsuario('Escribe el contenido del aviso');
    if (fa && !fechaOk(fa)) throw new ErrUsuario('Fecha de la actividad no válida');
    if (fa && fa < hoyApp()) throw new ErrUsuario('La fecha de la actividad no puede ser anterior a hoy');
    const sid = await destinoPublicacion(u, req.body.seccion_id);
    const [r] = await pool.query('INSERT INTO avisos (titulo, contenido, fecha_actividad, seccion_id, publicado_por) VALUES (?, ?, ?, ?, ?)',
      [titulo, contenido, fa || null, sid, u.id]);
    res.json({ ok: true, id: r.insertId });
  } catch (e) { fallo(res, e); }
});

app.delete('/api/staff/avisos/:id', DOCENTE, async (req, res) => {
  try {
    const u = req.session.usuario, id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Aviso no válido');
    const [[a]] = await pool.query('SELECT publicado_por FROM avisos WHERE id = ?', [id]);
    if (!a) throw new ErrUsuario('El aviso no existe');
    if (u.rol !== 'administrador' && a.publicado_por !== u.id) throw new ErrUsuario('Solo puedes eliminar los avisos que tú publicaste');
    await pool.query('DELETE FROM avisos WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) { fallo(res, e); }
});

app.get('/api/staff/eventos', DOCENTE, async (req, res) => {
  try {
    const u = req.session.usuario, amb = alcancePub(u, 'e.seccion_id', 'e.creado_por');
    const [rows] = await pool.query(`
      SELECT e.id, e.titulo, e.descripcion, e.lugar, DATE_FORMAT(e.fecha, '%Y-%m-%d') AS fecha,
             TIME_FORMAT(e.hora_inicio, '%H:%i') AS hora_inicio, TIME_FORMAT(e.hora_fin, '%H:%i') AS hora_fin, e.creado_por,
             e.seccion_id, CASE WHEN s.id IS NULL THEN 'Todos los estudiantes' ELSE CONCAT(s.especialidad, ' ', s.seccion, ' (', s.anio, ')') END AS destino
      FROM eventos e LEFT JOIN secciones s ON s.id = e.seccion_id${amb.sql}
      ORDER BY e.fecha DESC, e.hora_inicio LIMIT 100`, amb.p);
    res.json(rows.map(r => ({ ...r, mio: r.creado_por === u.id })));
  } catch (e) { fallo(res, e); }
});

app.post('/api/staff/eventos', DOCENTE, async (req, res) => {
  try {
    const u = req.session.usuario, b = req.body;
    const titulo = limpiarTexto(b.titulo, 120), descripcion = limpiarTexto(b.descripcion, 500), lugar = limpiarTexto(b.lugar, 150);
    const fecha = String(b.fecha || ''), hi = String(b.hora_inicio || ''), hf = String(b.hora_fin || '');
    if (titulo.length < 3) throw new ErrUsuario('Escribe el nombre de la actividad (mínimo 3 caracteres)');
    if (!fechaOk(fecha)) throw new ErrUsuario('Fecha no válida');
    if (fecha < hoyApp()) throw new ErrUsuario('La fecha no puede ser anterior a hoy');
    if (hi && !horaOk(hi)) throw new ErrUsuario('Hora de inicio no válida');
    if (hf && !horaOk(hf)) throw new ErrUsuario('Hora de fin no válida');
    if (hf && !hi) throw new ErrUsuario('Indica también la hora de inicio');
    if (hi && hf && hf <= hi) throw new ErrUsuario('La hora de fin debe ser posterior a la de inicio');
    const sid = await destinoPublicacion(u, b.seccion_id);
    const [r] = await pool.query(
      'INSERT INTO eventos (titulo, descripcion, fecha, hora_inicio, hora_fin, lugar, seccion_id, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [titulo, descripcion, fecha, hi || null, hf || null, lugar, sid, u.id]);
    res.json({ ok: true, id: r.insertId });
  } catch (e) { fallo(res, e); }
});

app.delete('/api/staff/eventos/:id', DOCENTE, async (req, res) => {
  try {
    const u = req.session.usuario, id = idOk(req.params.id);
    if (!id) throw new ErrUsuario('Actividad no válida');
    const [[e]] = await pool.query('SELECT creado_por FROM eventos WHERE id = ?', [id]);
    if (!e) throw new ErrUsuario('La actividad no existe');
    if (u.rol !== 'administrador' && e.creado_por !== u.id) throw new ErrUsuario('Solo puedes eliminar las actividades que tú publicaste');
    await pool.query('DELETE FROM eventos WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) { fallo(res, e); }
});

/* =====================================================================
   REPORTES Y TABLERO (administrador y docente, este último solo con sus secciones)
   ===================================================================== */
app.get('/api/admin/reportes', STAFF, async (req, res) => {
  try {
    const u = req.session.usuario;
    const cfg = await leerConfig();
    const desde = req.query.desde || hoyStr().slice(0, 8) + '01', hasta = req.query.hasta || hoyStr();
    if (!fechaOk(desde) || !fechaOk(hasta) || desde > hasta) throw new ErrUsuario('Rango de fechas no válido');

    // Condiciones sobre la tabla secciones (alias s): filtro de sección y alcance del docente
    const c = [], p = [];
    const sid = idOk(req.query.seccion_id);
    if (sid) { c.push('s.id = ?'); p.push(sid); }
    if (u.rol === 'docente') { c.push('EXISTS (SELECT 1 FROM docente_seccion ds WHERE ds.seccion_id = s.id AND ds.docente_id = ?)'); p.push(u.id); }
    const AND = c.length ? ' AND ' + c.join(' AND ') : '';
    const WHERE = c.length ? 'WHERE ' + c.join(' AND ') : '';
    const base = `FROM asistencias a JOIN secciones s ON s.id = a.seccion_id WHERE a.fecha BETWEEN ? AND ?${AND}`;
    const bp = [desde, hasta, ...p];

    const [dist] = await pool.query(`SELECT a.estado, COUNT(*) AS n ${base} AND a.estado IS NOT NULL GROUP BY a.estado`, bp);
    const [[hr]] = await pool.query(
      `SELECT COALESCE(SUM(r.horas), 0) AS h FROM registro_horas r JOIN secciones s ON s.id = r.seccion_id
       WHERE r.estado = 'validado' AND r.fecha BETWEEN ? AND ?${AND}`, bp);
    const [porSeccion] = await pool.query(`
      SELECT s.id, s.especialidad, s.seccion, s.anio, COUNT(a.alumno_id) AS total,
             COALESCE(SUM(a.estado IN ('presente','tarde')), 0) AS pres
      FROM secciones s
      LEFT JOIN asistencias a ON a.seccion_id = s.id AND a.estado IS NOT NULL AND a.fecha BETWEEN ? AND ?
      ${WHERE} GROUP BY s.id, s.especialidad, s.seccion, s.anio ORDER BY s.anio DESC, s.especialidad, s.seccion`, [desde, hasta, ...p]);
    const [[sec]] = await pool.query(
      `SELECT COUNT(*) AS n FROM secciones s WHERE s.activa = TRUE${AND}`, p);
    const [actividad] = await pool.query(`
      SELECT DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha, s.id, s.especialidad, s.seccion, s.anio,
             COUNT(*) AS registros, COALESCE(SUM(a.estado IN ('presente','tarde')), 0) AS pres
      ${base} AND a.estado IS NOT NULL
      GROUP BY a.fecha, s.id, s.especialidad, s.seccion, s.anio ORDER BY a.fecha DESC, s.id LIMIT 8`, bp);

    // Avance de horas (acumulado, sin importar el rango de fechas): una fila por estudiante activo
    const [alumnos] = await pool.query(`
      SELECT x.id, s.id AS sid, s.especialidad, s.seccion, s.anio,
        (SELECT COALESCE(SUM(r.horas),0) FROM registro_horas r WHERE r.alumno_id = x.id AND r.estado = 'validado') AS v,
        (SELECT COALESCE(SUM(r.horas),0) FROM registro_horas r WHERE r.alumno_id = x.id AND r.estado = 'pendiente') AS pe
      FROM usuarios x JOIN alumno_seccion al ON al.alumno_id = x.id JOIN secciones s ON s.id = al.seccion_id
      WHERE x.rol = 'alumno' AND x.activo = TRUE${AND}`, p);
    const meta = cfg.meta_horas, avance = new Map();
    let validadas = 0, pendientes = 0, completaron = 0;
    for (const x of alumnos) {
      const v = Number(x.v), pe = Number(x.pe);
      validadas += v; pendientes += pe; if (v >= meta) completaron++;
      const g = avance.get(x.sid) || { grupo: x.especialidad + ' ' + x.seccion + ' (' + x.anio + ')', alumnos: 0, horas: 0, completaron: 0 };
      g.alumnos++; g.horas += v; if (v >= meta) g.completaron++;
      avance.set(x.sid, g);
    }
    const topeTotal = alumnos.length * meta;

    const d = { presente: 0, tarde: 0, falto: 0, permiso: 0 };
    dist.forEach(r => { d[r.estado] = Number(r.n); });
    const total = d.presente + d.tarde + d.falto + d.permiso;
    res.json({
      desde, hasta, meta,
      estudiantes: alumnos.length,
      secciones_activas: Number(sec.n),
      horas: Number(hr.h),
      asistencia: { total, ...d, promedio: total ? Math.round((d.presente + d.tarde) / total * 100) : 0 },
      rendimiento: {
        validadas, pendientes, completaron,
        pct: topeTotal ? Math.round(Math.min(validadas, topeTotal) / topeTotal * 100) : 0,
      },
      avance: [...avance.values()].sort((a, b) => a.grupo.localeCompare(b.grupo, 'es')).map(g => ({
        ...g, pct: Math.round(Math.min(g.horas, g.alumnos * meta) / (g.alumnos * meta) * 100),
      })),
      porSeccion: porSeccion.map(r => ({
        id: r.id, grupo: r.especialidad + ' ' + r.seccion + ' (' + r.anio + ')', total: Number(r.total), pres: Number(r.pres),
        pct: Number(r.total) ? Math.round(Number(r.pres) / Number(r.total) * 100) : 0,
      })),
      actividad: actividad.map(r => ({
        fecha: r.fecha, grupo: r.especialidad + ' ' + r.seccion + ' (' + r.anio + ')', registros: Number(r.registros), pres: Number(r.pres),
        pct: Number(r.registros) ? Math.round(Number(r.pres) / Number(r.registros) * 100) : 0,
      })),
    });
  } catch (e) { fallo(res, e); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada: ' + req.method + ' ' + req.originalUrl }));

// Cuerpo JSON mal formado u otros errores no capturados: respuesta JSON en lugar de HTML
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Datos inválidos' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: `El archivo es demasiado grande (máximo ${MAX_ARCHIVO / 1048576} MB)` });
  console.error(err);
  res.status(500).json({ error: 'Error del servidor' });
});

// Al arrancar, crea lo que falte en la base de datos (equivale a inframen_completo.sql).
// Solo agrega columnas y tablas; nunca borra datos. Si tu usuario de MySQL no puede modificar tablas, avisa en la terminal.
async function asegurarEsquema() {
  const falta = async (tabla, col) => {
    const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [tabla, col]);
    return !c.n;
  };
  const aplicar = async (sql, que) => {
    try { await pool.query(sql); console.log('Base de datos actualizada: ' + que); }
    catch (e) { console.error(`No se pudo aplicar "${que}". Ejecuta inframen_completo.sql en MySQL. Detalle: ${e.message}`); }
  };
  try {
    if (await falta('usuarios', 'limite_semanal')) await aplicar('ALTER TABLE usuarios ADD COLUMN limite_semanal DECIMAL(4,1) NULL', 'usuarios.limite_semanal');
    if (await falta('usuarios', 'telefono')) await aplicar('ALTER TABLE usuarios ADD COLUMN telefono VARCHAR(20) NULL', 'usuarios.telefono');
    if (await falta('registro_horas', 'origen')) await aplicar('ALTER TABLE registro_horas ADD COLUMN origen VARCHAR(20) NULL', 'registro_horas.origen');
    await pool.query(`CREATE TABLE IF NOT EXISTS proyecto_archivos (
      id INT AUTO_INCREMENT PRIMARY KEY, proyecto_id INT NULL, actividad_id INT NULL, nombre_original VARCHAR(160) NOT NULL, nombre_guardado VARCHAR(80) NOT NULL,
      tamano INT NOT NULL, subido_por INT NULL, creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pa_proyecto (proyecto_id), INDEX idx_pa_actividad (actividad_id),
      FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE,
      FOREIGN KEY (actividad_id) REFERENCES actividades(id) ON DELETE CASCADE,
      FOREIGN KEY (subido_por) REFERENCES usuarios(id) ON DELETE SET NULL)`);
    // Versión anterior: los documentos eran solo de proyectos. Ahora también pueden ser de una actividad.
    if (await falta('proyecto_archivos', 'actividad_id')) {
      await aplicar('ALTER TABLE proyecto_archivos MODIFY proyecto_id INT NULL', 'proyecto_archivos.proyecto_id acepta NULL');
      await aplicar('ALTER TABLE proyecto_archivos ADD COLUMN actividad_id INT NULL', 'proyecto_archivos.actividad_id');
      await aplicar('ALTER TABLE proyecto_archivos ADD INDEX idx_pa_actividad (actividad_id)', 'índice de actividad_id');
      await aplicar('ALTER TABLE proyecto_archivos ADD FOREIGN KEY (actividad_id) REFERENCES actividades(id) ON DELETE CASCADE', 'relación con actividades');
    }
    if (await falta('registro_horas', 'observacion')) await aplicar('ALTER TABLE registro_horas ADD COLUMN observacion VARCHAR(255) NULL', 'registro_horas.observacion');
    if (await falta('registro_horas', 'revisado_por')) await aplicar('ALTER TABLE registro_horas ADD COLUMN revisado_por INT NULL', 'registro_horas.revisado_por');
    if (await falta('registro_horas', 'revisado_en')) await aplicar('ALTER TABLE registro_horas ADD COLUMN revisado_en TIMESTAMP NULL', 'registro_horas.revisado_en');
    const [[t]] = await pool.query("SELECT COLUMN_TYPE AS tipo FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'registro_horas' AND COLUMN_NAME = 'estado'");
    if (t && !String(t.tipo).includes('rechazado')) {
      await aplicar("ALTER TABLE registro_horas MODIFY estado ENUM('pendiente','validado','rechazado') NOT NULL DEFAULT 'validado'", "registro_horas.estado con 'rechazado'");
    }
    await pool.query(`CREATE TABLE IF NOT EXISTS eventos (
      id INT AUTO_INCREMENT PRIMARY KEY, titulo VARCHAR(120) NOT NULL, descripcion VARCHAR(500) NOT NULL DEFAULT '',
      fecha DATE NOT NULL, hora_inicio TIME NULL, hora_fin TIME NULL, lugar VARCHAR(150) NOT NULL DEFAULT '',
      seccion_id INT NULL, creado_por INT NULL, creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_evento_fecha (fecha), INDEX idx_evento_seccion (seccion_id),
      FOREIGN KEY (seccion_id) REFERENCES secciones(id) ON DELETE CASCADE,
      FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE SET NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS avisos (
      id INT AUTO_INCREMENT PRIMARY KEY, titulo VARCHAR(120) NOT NULL, contenido TEXT NOT NULL, fecha_actividad DATE NULL,
      seccion_id INT NULL, publicado_por INT NULL, creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_aviso_creado (creado_en), INDEX idx_aviso_seccion (seccion_id),
      FOREIGN KEY (seccion_id) REFERENCES secciones(id) ON DELETE CASCADE,
      FOREIGN KEY (publicado_por) REFERENCES usuarios(id) ON DELETE SET NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS asistencia_docentes (
      id INT AUTO_INCREMENT PRIMARY KEY, docente_id INT NOT NULL, fecha DATE NOT NULL,
      estado ENUM('presente','tarde','falto','permiso') NOT NULL, observacion VARCHAR(255) NOT NULL DEFAULT '',
      registrado_por INT NULL, creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_doc_fecha (docente_id, fecha),
      FOREIGN KEY (docente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (registrado_por) REFERENCES usuarios(id) ON DELETE SET NULL)`);
  } catch (e) { console.error('No se pudo verificar la base de datos. Ejecuta inframen_completo.sql en MySQL. Detalle:', e.message); }
}

asegurarEsquema().then(() => app.listen(process.env.PORT || 3000, () => {
  console.log('Servidor en http://localhost:' + (process.env.PORT || 3000));
}));
