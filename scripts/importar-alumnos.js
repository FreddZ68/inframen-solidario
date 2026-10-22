require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

// ====== AJUSTA ESTOS DOS VALORES ======
const ESPECIALIDAD = 'Desarrollo de Software';
const SECCION = 2;
// ======================================
const DOMINIO = '@clases.edu.sv';

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const filas = fs.readFileSync(path.join(__dirname, 'alumnos.csv'), 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const i = l.search(/[;,]/);
      return { nie: l.slice(0, i).trim(), nombre: l.slice(i + 1).trim() };
    })
    .filter(f => f.nie.toLowerCase() !== 'nie');

  const pines = [];
  let omitidos = 0;

  try {
    await conn.beginTransaction();

    await conn.query(
      'INSERT IGNORE INTO secciones (especialidad, seccion) VALUES (?, ?)',
      [ESPECIALIDAD, SECCION]
    );
    const [[sec]] = await conn.query(
      'SELECT id FROM secciones WHERE especialidad = ? AND seccion = ?',
      [ESPECIALIDAD, SECCION]
    );

    for (const f of filas) {
      const [existe] = await conn.query('SELECT id FROM usuarios WHERE nie = ?', [f.nie]);
      if (existe.length) { omitidos++; continue; }

      const pin = String(crypto.randomInt(0, 10000)).padStart(4, '0');
      const hash = await bcrypt.hash(pin, 10);

      const [r] = await conn.query(
        "INSERT INTO usuarios (nombre, correo, password_hash, rol, nie) VALUES (?, ?, ?, 'alumno', ?)",
        [f.nombre, f.nie + DOMINIO, hash, f.nie]
      );
      await conn.query(
        'INSERT IGNORE INTO alumno_seccion (alumno_id, seccion_id) VALUES (?, ?)',
        [r.insertId, sec.id]
      );
      pines.push({ nie: f.nie, nombre: f.nombre, pin });
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.error('Error, no se guardó nada:', e.message);
    await conn.end();
    process.exit(1);
  }

  if (pines.length > 0) {
    fs.writeFileSync(
      path.join(__dirname, 'pines.csv'),
      'nie,nombre,pin\n' + pines.map(p => `${p.nie},${p.nombre},${p.pin}`).join('\n')
    );
    console.log(`Insertados: ${pines.length} | Ya existían: ${omitidos}`);
    console.log('PIN iniciales guardados en pines.csv');
  } else {
    console.log(`Insertados: 0 | Ya existían: ${omitidos}. pines.csv no se tocó.`);
  }

  await conn.end();
})();