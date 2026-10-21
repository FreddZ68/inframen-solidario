// Crea una cuenta de administrador.  Uso (desde la carpeta raíz del proyecto):
//   node scripts/crear-admin.js 00000001 "Nombre Apellido" 1234
// NIE/código: solo números (máx. 15). PIN: 4 números. Usa los datos del .env.
require('dotenv').config({ path: '.env' });
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

const [nie, nombre, pin] = process.argv.slice(2);
if (!/^\d{1,15}$/.test(nie || '') || !/^\p{L}+(?: \p{L}+)+$/u.test(nombre || '') || !/^\d{4}$/.test(pin || '')) {
  console.error('Uso: node scripts/crear-admin.js <NIE/código> "<Nombre Apellido>" <PIN de 4 números>');
  process.exit(1);
}
const key = Buffer.from(process.env.PIN_KEY || '', 'hex');
if (key.length !== 32) { console.error('Falta PIN_KEY (64 caracteres hexadecimales) en el .env'); process.exit(1); }
const cifrar = p => {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(p, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
};

(async () => {
  const conn = await mysql.createConnection(require('../db-config'));
  try {
    const correo = nie + '@clases.edu.sv';
    const [ya] = await conn.query('SELECT id FROM usuarios WHERE nie = ? OR correo = ?', [nie, correo]);
    if (ya.length) { console.error('Ya existe un usuario con ese NIE/código.'); process.exit(1); }
    await conn.query(
      "INSERT INTO usuarios (nombre, correo, password_hash, rol, nie, pin_cifrado) VALUES (?, ?, ?, 'administrador', ?, ?)",
      [nombre, correo, await bcrypt.hash(pin, 10), nie, cifrar(pin)]);
    console.log(`Administrador creado. Entra en /login.html con NIE/código ${nie} y el PIN indicado.`);
  } finally { await conn.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
