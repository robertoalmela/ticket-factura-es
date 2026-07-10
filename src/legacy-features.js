const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const { validarNIF, normalizarNIF } = require('./validators');
const { renderFacturaHtml } = require('./invoice');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
});

function mountLegacyFeatures(app, { db, emitirFactura, mailer, BASE_URL, JWT_SECRET, apiLimiter, formLimiter }) {
  app.get('/solicitar', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'solicitar.html')));
  app.get('/panel', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'panel.html')));

  // Compatibilidad con el proyecto anterior: buscador de empresas para el flujo "subir ticket".
  app.get(['/api/companies/search', '/api/comercios/search'], apiLimiter, (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const like = `%${q}%`;
    const rows = db.prepare(`
      SELECT id, nombre AS name, nif, direccion AS address, email, serie
      FROM comercios
      WHERE activo = 1 AND (nombre LIKE ? OR nif LIKE ? OR serie LIKE ?)
      ORDER BY nombre
      LIMIT 12
    `).all(like, like, like);
    res.json(rows);
  });

  // OCR opcional. Si no hay OCR_API_KEY, el flujo sigue manualmente con preview de imagen.
  app.post('/api/invoices/ocr', apiLimiter, upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    if (!process.env.OCR_API_KEY) {
      return res.json({
        enabled: false,
        message: 'OCR no configurado todavía. Rellena importe, fecha y empresa manualmente.',
        amount: null,
        date: null,
        companyName: null,
        rawText: '',
      });
    }

    try {
      const body = new URLSearchParams();
      body.set('apikey', process.env.OCR_API_KEY);
      body.set('language', 'spa');
      body.set('isOverlayRequired', 'false');
      body.set('base64Image', `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`);
      const response = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body });
      const payload = await response.json();
      const rawText = payload?.ParsedResults?.[0]?.ParsedText || '';
      const parsed = parseTicketText(rawText);
      res.json({ enabled: true, rawText, ...parsed });
    } catch (error) {
      console.error('OCR error:', error);
      res.status(502).json({ error: 'Error procesando OCR' });
    }
  });

  // Flujo heredado simplificado: cliente sube ticket / rellena datos / se genera factura.
  app.post(['/api/invoices/request', '/api/solicitudes/manual'], formLimiter, async (req, res, next) => {
    try {
      const body = req.body || {};
      const clientData = typeof body.clientData === 'string' ? JSON.parse(body.clientData) : (body.clientData || body.cliente || {});
      const ticket = body.ticket || body;
      const result = await createInvoiceFromLegacyRequest({ db, emitirFactura, mailer, BASE_URL, JWT_SECRET, body, ticket, clientData });
      res.status(result.reenviada ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/dashboard', apiLimiter, (req, res) => {
    const comercio = getCommerceFromRequest(db, req);
    if (!comercio) return res.status(401).json({ error: 'API key inválida' });

    const all = db.prepare('SELECT * FROM facturas WHERE comercio_id = ? ORDER BY created_at DESC LIMIT 30').all(comercio.id);
    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total_facturas,
        COALESCE(SUM(total), 0) AS total_facturado,
        SUM(CASE WHEN strftime('%Y-%m', fecha_emision) = strftime('%Y-%m', 'now') THEN 1 ELSE 0 END) AS facturas_mes,
        COALESCE(SUM(CASE WHEN strftime('%Y-%m', fecha_emision) = strftime('%Y-%m', 'now') THEN total ELSE 0 END), 0) AS facturado_mes
      FROM facturas
      WHERE comercio_id = ?
    `).get(comercio.id);

    res.json({
      comercio: publicCommerce(comercio),
      stats,
      solicitudes_pendientes: 0,
      facturas: all.map(publicInvoice),
    });
  });

  app.get('/api/invoices/approved', apiLimiter, (req, res) => {
    const comercio = getCommerceFromRequest(db, req);
    if (!comercio) return res.status(401).json({ error: 'API key inválida' });
    const rows = db.prepare('SELECT * FROM facturas WHERE comercio_id = ? ORDER BY created_at DESC LIMIT 100').all(comercio.id);
    res.json(rows.map(publicInvoice));
  });
}

async function createInvoiceFromLegacyRequest({ db, emitirFactura, mailer, BASE_URL, JWT_SECRET, body, ticket, clientData }) {
  const comercioId = Number(body.companyId || body.comercio_id || ticket.companyId || ticket.comercio_id);
  const comercio = db.prepare('SELECT * FROM comercios WHERE id = ? AND activo = 1').get(comercioId);
  if (!comercio) return problem(404, 'Empresa no encontrada');

  const nif = clientData.nif || body.nif;
  const nombre = clientData.name || clientData.nombre || body.nombre;
  const direccion = clientData.address || clientData.direccion || body.direccion || '';
  const email = clientData.email || body.email;
  const postalCode = clientData.postalCode || body.postalCode || '';
  const phone = clientData.phone || body.phone || '';
  const totalNum = Number(ticket.total || ticket.amount || body.total || body.amount);
  const tipoIva = Number(ticket.tipo_iva || ticket.taxRate || comercio.iva_defecto || 21);
  const concepto = String(ticket.concepto || ticket.description || body.concepto || 'Venta').trim().slice(0, 140);
  const ticketRef = String(ticket.ticket_ref || ticket.ticketRef || body.ticket_ref || `MANUAL-${Date.now()}`).trim().slice(0, 80);

  if (!validarNIF(nif)) return problem(400, 'NIF/CIF no válido');
  if (!nombre || String(nombre).trim().length < 3) return problem(400, 'Nombre obligatorio');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || ''))) return problem(400, 'Email no válido');
  if (!Number.isFinite(totalNum) || totalNum <= 0) return problem(400, 'Importe total obligatorio y > 0');

  const clienteNif = normalizarNIF(nif);
  const previa = db.prepare('SELECT * FROM facturas WHERE comercio_id = ? AND ticket_ref = ? AND cliente_nif = ?')
    .get(comercio.id, ticketRef, clienteNif);

  const total = Math.round(totalNum * 100) / 100;
  const base = total / (1 + tipoIva / 100);
  const factura = previa ?? emitirFactura({
    comercio_id: comercio.id,
    fecha_emision: new Date().toISOString().slice(0, 10),
    concepto,
    base_imponible: Math.round(base * 100) / 100,
    tipo_iva: tipoIva,
    cuota_iva: Math.round((total - base) * 100) / 100,
    total,
    cliente_nif: clienteNif,
    cliente_nombre: String(nombre).trim(),
    cliente_direccion: [String(direccion).trim(), String(postalCode).trim(), String(phone).trim()].filter(Boolean).join(' · '),
    cliente_email: String(email).trim(),
    ticket_ref: ticketRef,
  });

  const facturaUrl = `${BASE_URL}/factura/${factura.id}/html?token=${signFacturaToken(factura.id, JWT_SECRET)}`;
  const html = addFacturaLink(renderFacturaHtml(factura, comercio), facturaUrl);
  const envio = await mailer.sendMail({
    from: process.env.SMTP_FROM || `"${comercio.nombre} — facturas" <facturas@ticketfactura.local>`,
    to: factura.cliente_email,
    bcc: comercio.email,
    subject: `Factura ${factura.numero} — ${comercio.nombre}`,
    html,
  });
  db.prepare('UPDATE facturas SET enviada = 1 WHERE id = ?').run(factura.id);

  return {
    ok: true,
    status: 'GENERATED',
    numero: factura.numero,
    reenviada: Boolean(previa),
    factura_url: facturaUrl,
    dev_preview: process.env.SMTP_HOST ? undefined : JSON.parse(envio.message).subject,
    message: `Factura ${factura.numero} generada y enviada a ${factura.cliente_email}`,
  };
}

function parseTicketText(rawText) {
  const text = String(rawText || '').replace(/\r/g, '\n');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const nif = (text.match(/\b[ABCDEFGHJKLMNPQRSUVW][\s.-]?\d{7}[0-9A-J]\b/i) || text.match(/\b\d{8}[\s.-]?[A-Z]\b/i) || [null])[0];
  const date = (text.match(/\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/) || [null])[0];
  const totalLine = [...lines].reverse().find((line) => /total|importe|eur|€|visa|efectivo|tarjeta/i.test(line));
  const amountSource = totalLine || text;
  const numbers = amountSource.match(/\d+[,.]\d{2}/g) || [];
  const amount = numbers.length ? Number(numbers[numbers.length - 1].replace(',', '.')) : null;
  const companyName = lines.find((line) => /[A-ZÁÉÍÓÚÑ]{3}/.test(line) && !/ticket|factura|total|iva|fecha|gracias/i.test(line)) || null;
  // Datos extra útiles para el flujo comprador: IVA y email del vendedor.
  const ivaMatch = text.match(/\bIVA\s*:?\s*(\d{1,2})(?:[.,]\d+)?\s*%/i);
  const taxRate = ivaMatch ? Number(ivaMatch[1]) : null;
  const email = (text.match(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i) || [null])[0];
  const address = lines.find((line) => /\b(c\/|calle|avda|avenida|plaza|pza|ctra|carretera|camino|paseo)\b/i.test(line)) || null;
  return {
    companyName,
    nif: nif ? nif.replace(/[\s.-]/g, '').toUpperCase() : null,
    date,
    amount,
    taxRate,
    email: email ? email.toLowerCase() : null,
    address,
  };
}

function getCommerceFromRequest(db, req) {
  const apiKey = req.get('x-api-key') || req.query.api_key || req.query.apiKey;
  if (apiKey === 'DEMO_KEY_AUTO') {
    return db.prepare("SELECT * FROM comercios WHERE serie = 'TF-DEMO' AND activo = 1").get();
  }
  return db.prepare('SELECT * FROM comercios WHERE api_key = ? AND activo = 1').get(apiKey || '');
}

function publicCommerce(c) {
  return { id: c.id, name: c.nombre, nif: c.nif, address: c.direccion, email: c.email, serie: c.serie };
}

function publicInvoice(f) {
  return {
    id: f.id,
    numero: f.numero,
    status: f.enviada ? 'GENERATED' : 'APPROVED',
    fecha: f.fecha_emision,
    concepto: f.concepto,
    total: f.total,
    cliente: { nif: f.cliente_nif, nombre: f.cliente_nombre, email: f.cliente_email, direccion: f.cliente_direccion },
    ticket_ref: f.ticket_ref,
    created_at: f.created_at,
  };
}

function signFacturaToken(id, secret) {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ inv: Number(id) }, secret, { expiresIn: '180d' });
}

function addFacturaLink(html, url) {
  const link = `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;text-align:center;margin:24px 0"><a href="${escapeHtml(url)}">Ver factura online</a></p>`;
  return html.replace('</body>', `${link}</body>`);
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function problem(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

module.exports = { mountLegacyFeatures };
