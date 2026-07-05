// Crea el comercio de demo (la copistería) y muestra su API key.
const crypto = require('crypto');
const { db } = require('./db');

const existe = db.prepare('SELECT * FROM comercios WHERE serie = ?').get('TF-DEMO');
if (existe) {
  console.log('Comercio demo ya existe. API key:', existe.api_key);
  process.exit(0);
}

const apiKey = 'tf_' + crypto.randomBytes(24).toString('hex');
db.prepare(`
  INSERT INTO comercios (nombre, nif, direccion, email, serie, iva_defecto, api_key)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  'Copistería Demo',
  'B00000000',
  'Calle Ejemplo 1, 03201 Elche',
  'copisteria@example.com',
  'TF-DEMO',
  21,
  apiKey,
);
console.log('Comercio demo creado. API key:', apiKey);
