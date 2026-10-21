// Configuración de conexión compartida (servidor y scripts).
// TiDB Cloud exige TLS: pon DB_SSL=true y DB_PORT=4000 en las variables de entorno.
module.exports = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
};
