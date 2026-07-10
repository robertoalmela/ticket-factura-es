const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'ticketfactura.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

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
  -- Continuidad de serie: si el comercio se une a mitad de año con
  -- facturas ya emitidas, seguimos su numeración (p. ej. última = 57
  -- → la nuestra primera será la 58). Solo aplica a ese año.
  secuencia_previa INTEGER NOT NULL DEFAULT 0,
  anio_previo INTEGER,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_facturas_ticket_nif
ON facturas (comercio_id, ticket_ref, cliente_nif)
WHERE ticket_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS compradores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,    -- scrypt "salt:hash" en hex
  nif TEXT NOT NULL,
  nombre TEXT NOT NULL,
  direccion TEXT NOT NULL DEFAULT '',
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Migración: columnas de continuidad de serie en BDs anteriores
const cols = db.prepare("PRAGMA table_info(comercios)").all().map((c) => c.name);
if (!cols.includes('secuencia_previa')) {
  db.exec('ALTER TABLE comercios ADD COLUMN secuencia_previa INTEGER NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE comercios ADD COLUMN anio_previo INTEGER');
}

// Migración: vendedores creados automáticamente desde una foto de ticket
// (no dados de alta por el admin; sin acceso al panel hasta que reclamen).
if (!cols.includes('auto_creado')) {
  db.exec('ALTER TABLE comercios ADD COLUMN auto_creado INTEGER NOT NULL DEFAULT 0');
}

// Migración: facturas pedidas por un comprador registrado
const colsFacturas = db.prepare("PRAGMA table_info(facturas)").all().map((c) => c.name);
if (!colsFacturas.includes('comprador_id')) {
  db.exec('ALTER TABLE facturas ADD COLUMN comprador_id INTEGER REFERENCES compradores(id)');
}


/**
 * Numeración legal: consecutiva y sin huecos por comercio y año.
 * Transacción con SELECT MAX + INSERT — el UNIQUE remata la garantía.
 */
const emitirFactura = db.transaction((datos) => {
  const anio = new Date().getFullYear();
  const comercio = db
    .prepare('SELECT serie, secuencia_previa, anio_previo FROM comercios WHERE id = ?')
    .get(datos.comercio_id);
  const row = db
    .prepare('SELECT COALESCE(MAX(secuencia), 0) AS max FROM facturas WHERE comercio_id = ? AND anio = ?')
    .get(datos.comercio_id, anio);
  // Arranque de serie: en el año de alta se respeta la numeración que el
  // comercio ya llevaba fuera del sistema; los años siguientes empiezan en 1.
  const base = comercio.anio_previo === anio ? Math.max(row.max, comercio.secuencia_previa) : row.max;
  const secuencia = base + 1;
  const numero = `${comercio.serie}-${anio}-${String(secuencia).padStart(4, '0')}`;

  const info = db.prepare(`
    INSERT INTO facturas (
      comercio_id, numero, anio, secuencia, fecha_emision, concepto,
      base_imponible, tipo_iva, cuota_iva, total,
      cliente_nif, cliente_nombre, cliente_direccion, cliente_email, ticket_ref, comprador_id
    ) VALUES (
      @comercio_id, @numero, @anio, @secuencia, @fecha_emision, @concepto,
      @base_imponible, @tipo_iva, @cuota_iva, @total,
      @cliente_nif, @cliente_nombre, @cliente_direccion, @cliente_email, @ticket_ref, @comprador_id
    )
  `).run({ comprador_id: null, ...datos, numero, anio, secuencia });

  return db.prepare('SELECT * FROM facturas WHERE id = ?').get(info.lastInsertRowid);
});

module.exports = { db, emitirFactura };
