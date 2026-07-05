const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data', 'ticketfactura.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS comercios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  nif TEXT NOT NULL,
  direccion TEXT NOT NULL,
  email TEXT NOT NULL,
  serie TEXT NOT NULL,            -- prefijo de facturación, ej. "TF-COPI"
  iva_defecto REAL NOT NULL DEFAULT 21,
  api_key TEXT NOT NULL UNIQUE,   -- para que su TPV/PrintQueue genere QRs
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS facturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comercio_id INTEGER NOT NULL REFERENCES comercios(id),
  numero TEXT NOT NULL,           -- SERIE-AÑO-NNNN, consecutivo por comercio+año
  anio INTEGER NOT NULL,
  secuencia INTEGER NOT NULL,
  fecha_emision TEXT NOT NULL,
  concepto TEXT NOT NULL,
  base_imponible REAL NOT NULL,
  tipo_iva REAL NOT NULL,
  cuota_iva REAL NOT NULL,
  total REAL NOT NULL,
  cliente_nif TEXT NOT NULL,
  cliente_nombre TEXT NOT NULL,
  cliente_direccion TEXT,
  cliente_email TEXT NOT NULL,
  ticket_ref TEXT,                -- referencia del ticket original
  enviada INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (comercio_id, anio, secuencia)
);
`);

/**
 * Numeración legal: consecutiva y sin huecos por comercio y año.
 * Transacción con SELECT MAX + INSERT — el UNIQUE remata la garantía.
 */
const emitirFactura = db.transaction((datos) => {
  const anio = new Date().getFullYear();
  const row = db
    .prepare('SELECT COALESCE(MAX(secuencia), 0) + 1 AS next FROM facturas WHERE comercio_id = ? AND anio = ?')
    .get(datos.comercio_id, anio);
  const secuencia = row.next;
  const comercio = db.prepare('SELECT serie FROM comercios WHERE id = ?').get(datos.comercio_id);
  const numero = `${comercio.serie}-${anio}-${String(secuencia).padStart(4, '0')}`;

  const info = db.prepare(`
    INSERT INTO facturas (
      comercio_id, numero, anio, secuencia, fecha_emision, concepto,
      base_imponible, tipo_iva, cuota_iva, total,
      cliente_nif, cliente_nombre, cliente_direccion, cliente_email, ticket_ref
    ) VALUES (
      @comercio_id, @numero, @anio, @secuencia, @fecha_emision, @concepto,
      @base_imponible, @tipo_iva, @cuota_iva, @total,
      @cliente_nif, @cliente_nombre, @cliente_direccion, @cliente_email, @ticket_ref
    )
  `).run({ ...datos, numero, anio, secuencia });

  return db.prepare('SELECT * FROM facturas WHERE id = ?').get(info.lastInsertRowid);
});

module.exports = { db, emitirFactura };
