require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

const KEY = Buffer.from(process.env.PIN_KEY || '', 'hex');
if (KEY.length !== 32) {
  console.error('Falta PIN_KEY en el .env (64 caracteres hexadecimales).');
  process.exit(1);
}
const cifrar = pin => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(pin, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
};

(async () => {
  const archivo = path.join(__dirname, process.argv[2] || 'pines.csv');
  if (!fs.existsSync(archivo)) {
    console.error('No encontré el archivo ' + archivo);
    process.exit(1);
  }
  const lineas = fs.readFileSync(archivo, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .slice(1); // saltar el encabezado nie,nombre,pin

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  let guardados = 0, noCoinciden = 0, noExisten = 0;
  for (const l of lineas) {
    const p = l.split(',');
    const nie = p[0].trim();
    const pin = p[p.length - 1].trim();
    const [[u]] = await conn.query("SELECT id, password_hash FROM usuarios WHERE nie = ? AND rol = 'alumno'", [nie]);
    if (!u) { noExisten++; continue; }
    // Solo se guarda si el PIN del archivo es de verdad el PIN actual del alumno
    if (!(await bcrypt.compare(pin, u.password_hash))) { noCoinciden++; continue; }
    await conn.query('UPDATE usuarios SET pin_cifrado = ? WHERE id = ?', [cifrar(pin), u.id]);
    guardados++;
  }
  console.log(`PIN guardados: ${guardados} | No coinciden con el actual: ${noCoinciden} | NIE no existe: ${noExisten}`);
  await conn.end();
})();