const crypto = require('crypto');

const { db } = require('./db');
const { validarNIF, normalizarNIF } = require('./validators');

const required = ['COMERCIO_NOMBRE', 'COMERCIO_NIF', 'COMERCIO_DIRECCION', 'COMERCIO_EMAIL', 'COMERCIO_SERIE'];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  console.error(`Faltan variables: ${missing.join(', ')}`);
  console.error('Ejemplo: COMERCIO_NOMBRE="Copisteria Centro" COMERCIO_NIF="B12345674" COMERCIO_DIRECCION="Calle..." COMERCIO_EMAIL="facturas@..." COMERCIO_SERIE="CC" npm run commerce:create');
  process.exit(1);
}

const nif = normalizarNIF(process.env.COMERCIO_NIF);
if (!validarNIF(nif)) {
  console.error('COMERCIO_NIF no es un NIF/CIF/NIE valido');
  process.exit(1);
}

const email = String(process.env.COMERCIO_EMAIL).trim();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('COMERCIO_EMAIL no es valido');
  process.exit(1);
}

const serie = String(process.env.COMERCIO_SERIE).trim().toUpperCase();
const existe = db.prepare('SELECT id FROM comercios WHERE serie = ? OR nif = ?').get(serie, nif);
if (existe) {
  console.error('Ya existe un comercio con esa serie o NIF');
  process.exit(1);
}

const apiKey = 'tf_' + crypto.randomBytes(24).toString('hex');
const secuenciaPrevia = Number(process.env.COMERCIO_SECUENCIA_PREVIA || 0);
const anioPrevio = process.env.COMERCIO_ANIO_PREVIO ? Number(process.env.COMERCIO_ANIO_PREVIO) : null;

db.prepare(`
  INSERT INTO comercios (
    nombre, nif, direccion, email, serie, iva_defecto, api_key,
    secuencia_previa, anio_previo
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  String(process.env.COMERCIO_NOMBRE).trim(),
  nif,
  String(process.env.COMERCIO_DIRECCION).trim(),
  email,
  serie,
  Number(process.env.COMERCIO_IVA_DEFECTO || 21),
  apiKey,
  secuenciaPrevia,
  anioPrevio,
);

console.log('Comercio creado');
console.log('Serie:', serie);
console.log('API key:', apiKey);
