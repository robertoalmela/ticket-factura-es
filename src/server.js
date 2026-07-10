const express = require('express');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const path = require('path');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');

const { validarNIF, normalizarNIF } = require('./validators');
const { renderFacturaHtml } = require('./invoice');
const { mountLegacyFeatures } = require('./legacy-features');
const { mountComprador } = require('./comprador');

const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 8380;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-CAMBIAR-EN-PRODUCCION';

if (isProduction) {
  if (!process.env.BASE_URL) throw new Error('BASE_URL es obligatorio en producción');
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET es obligatorio en producción');
  if (!process.env.SMTP_HOST) throw new Error('SMTP_HOST es obligatorio en producción');
  if (!process.env.SMTP_USER) throw new Error('SMTP_USER es obligatorio en producción');
  if (!process.env.SMTP_PASS) throw new Error('SMTP_PASS es obligatorio en producción');
  if (!process.env.SMTP_FROM) throw new Error('SMTP_FROM es obligatorio en producción');
}

const { db, emitirFactura } = require('./db');
const smtpAuth = process.env.SMTP_USER || process.env.SMTP_PASS
  ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
  : {};

// SMTP: en desarrollo, transport JSON (loguea en vez de enviar).
const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      ...smtpAuth,
    })
  : nodemailer.createTransport({ jsonTransport: true });

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY || isProduction) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
}
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: true, limit: '20kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { dotfiles: 'deny' }));

const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const formLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/health', (req, res) => res.json({ ok: true }));

// Demo navegable: genera un ticket temporal de la Copistería Demo y abre el flujo real.
app.get('/demo', apiLimiter, (req, res) => {
  const comercio = db.prepare("SELECT * FROM comercios WHERE serie = 'TF-DEMO' AND activo = 1").get()
    || db.prepare('SELECT * FROM comercios WHERE activo = 1 ORDER BY id LIMIT 1').get();
  if (!comercio) return res.status(404).send('No hay comercio demo. Ejecuta npm run seed.');
  const ticketRef = `DEMO-${Date.now()}`;
  const token = jwt.sign(
    { c: comercio.id, t: 1280, iva: comercio.iva_defecto || 21, cpt: 'Material de oficina', ref: ticketRef },
    JWT_SECRET,
    { expiresIn: '90d' },
  );
  res.redirect(`/f/${token}`);
});

/* ── API del comercio (TPV / PrintQueue) ─────────────────────────────
   El comercio crea un "ticket facturable" y recibe la URL (y el QR)
   que se imprime en el ticket físico. */
app.post('/api/tickets', apiLimiter, (req, res) => {
  const apiKey = req.get('x-api-key');
  const comercio = apiKey === 'DEMO_KEY_AUTO'
    ? db.prepare("SELECT * FROM comercios WHERE serie = 'TF-DEMO' AND activo = 1").get()
    : db.prepare('SELECT * FROM comercios WHERE api_key = ? AND activo = 1').get(apiKey || '');
  if (!comercio) return res.status(401).json({ error: 'API key inválida' });

  const { total, concepto, ticket_ref, tipo_iva } = req.body || {};
  const totalNum = Number(total);
  const ticketRef = String(ticket_ref || '').trim().slice(0, 60);
  const tipoIva = Number(tipo_iva ?? comercio.iva_defecto);
  if (!Number.isFinite(totalNum) || totalNum <= 0) {
    return res.status(400).json({ error: 'total (importe con IVA) es obligatorio y > 0' });
  }
  if (!ticketRef) return res.status(400).json({ error: 'ticket_ref es obligatorio' });
  if (!Number.isFinite(tipoIva) || tipoIva < 0 || tipoIva > 100) {
    return res.status(400).json({ error: 'tipo_iva no válido' });
  }

  const token = jwt.sign(
    {
      c: comercio.id,
      t: Math.round(totalNum * 100),          // céntimos
      iva: tipoIva,
      cpt: String(concepto || 'Venta').slice(0, 140),
      ref: ticketRef,
    },
    JWT_SECRET,
    { expiresIn: '90d' },                      // plazo razonable para pedir factura
  );

  const url = `${BASE_URL}/f/${token}`;
  res.json({ url });
});

// QR en PNG para imprimir junto al ticket
app.get('/api/qr', apiLimiter, asyncHandler(async (req, res) => {
  const { url } = req.query;
  const qrUrl = validateFacturaUrl(url);
  if (!qrUrl) return res.status(400).send('url inválida');
  res.type('png').send(await QRCode.toBuffer(qrUrl, { width: 300, margin: 1 }));
}));

/* ── Flujo del cliente final ───────────────────────────────────────── */
function decodeTicket(token) {
  const data = jwt.verify(token, JWT_SECRET);
  const comercio = db.prepare('SELECT * FROM comercios WHERE id = ? AND activo = 1').get(data.c);
  if (!comercio) throw new Error('Comercio no disponible');
  return { data, comercio };
}

app.get('/f/:token', (req, res) => {
  let ctx;
  try {
    ctx = decodeTicket(req.params.token);
  } catch {
    return res.status(400).sendFile(path.join(__dirname, '..', 'public', 'caducado.html'));
  }
  const { data, comercio } = ctx;
  res.send(renderPedirPage({
    comercio: comercio.nombre,
    total: (data.t / 100).toFixed(2),
    concepto: data.cpt,
  }));
});

app.post('/f/:token', formLimiter, asyncHandler(async (req, res) => {
  let ctx;
  try {
    ctx = decodeTicket(req.params.token);
  } catch {
    return res.status(400).json({ error: 'Ticket caducado o inválido' });
  }
  const { data, comercio } = ctx;
  const { nif, nombre, direccion, email } = req.body || {};

  if (!validarNIF(nif)) return res.status(400).json({ error: 'NIF/CIF no válido' });
  if (!nombre || String(nombre).trim().length < 3) return res.status(400).json({ error: 'Nombre obligatorio' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || ''))) return res.status(400).json({ error: 'Email no válido' });

  // Idempotencia: si ya se emitió factura para este ticket_ref+nif, reenviar la misma.
  const previa = data.ref
    ? db.prepare('SELECT * FROM facturas WHERE comercio_id = ? AND ticket_ref = ? AND cliente_nif = ?')
        .get(comercio.id, data.ref, normalizarNIF(nif))
    : null;

  const total = data.t / 100;
  const tipoIva = data.iva;
  const base = total / (1 + tipoIva / 100);

  const factura = previa ?? emitirFactura({
    comercio_id: comercio.id,
    fecha_emision: new Date().toISOString().slice(0, 10),
    concepto: data.cpt,
    base_imponible: Math.round(base * 100) / 100,
    tipo_iva: tipoIva,
    cuota_iva: Math.round((total - base) * 100) / 100,
    total,
    cliente_nif: normalizarNIF(nif),
    cliente_nombre: String(nombre).trim(),
    cliente_direccion: String(direccion || '').trim(),
    cliente_email: String(email).trim(),
    ticket_ref: data.ref || null,
  });

  const facturaUrl = `${BASE_URL}/factura/${factura.id}/html?token=${signFacturaToken(factura.id)}`;
  const html = addFacturaLink(renderFacturaHtml(factura, comercio), facturaUrl);
  const envio = await mailer.sendMail({
    from: process.env.SMTP_FROM || `"${comercio.nombre} — facturas" <facturas@ticketfactura.local>`,
    to: factura.cliente_email,
    bcc: comercio.email,
    subject: `Factura ${factura.numero} — ${comercio.nombre}`,
    html,
  });
  db.prepare('UPDATE facturas SET enviada = 1 WHERE id = ?').run(factura.id);

  res.json({
    ok: true,
    numero: factura.numero,
    reenviada: Boolean(previa),
    dev_preview: process.env.SMTP_HOST ? undefined : JSON.parse(envio.message).subject,
  });
}));

// Vista HTML de la factura: solo accesible con token firmado incluido en el email.
app.get('/factura/:id/html', (req, res) => {
  if (!verifyFacturaToken(req.params.id, req.query.token)) return res.status(403).send('No autorizado');
  const f = db.prepare('SELECT * FROM facturas WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).send('No encontrada');
  const c = db.prepare('SELECT * FROM comercios WHERE id = ?').get(f.comercio_id);
  res.send(renderFacturaHtml(f, c));
});

function validateFacturaUrl(value) {
  try {
    const parsed = new URL(String(value));
    const base = new URL(BASE_URL);
    if (parsed.origin !== base.origin) return null;
    if (!parsed.pathname.startsWith('/f/')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function signFacturaToken(id) {
  return jwt.sign({ inv: Number(id) }, JWT_SECRET, { expiresIn: '180d' });
}

function verifyFacturaToken(id, token) {
  try {
    const data = jwt.verify(String(token || ''), JWT_SECRET);
    return Number(data.inv) === Number(id);
  } catch {
    return false;
  }
}

function addFacturaLink(html, url) {
  const link = `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;text-align:center;margin:24px 0"><a href="${escapeHtml(url)}">Ver factura online</a></p>`;
  return html.replace('</body>', `${link}</body>`);
}

function renderPedirPage({ comercio, total, concepto }) {
  const comercioHtml = escapeHtml(comercio);
  const conceptoHtml = escapeHtml(concepto);
  const totalHtml = escapeHtml(total);
  return `<!doctype html><html lang="es"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tu factura de ${comercioHtml}</title>
  <link rel="stylesheet" href="/estilo.css"></head>
  <body class="pedir">
  <main class="card">
    <h1>Factura de tu compra</h1>
    <p class="resumen"><strong>${comercioHtml}</strong> · ${conceptoHtml} · <strong>${totalHtml} €</strong></p>
    <form id="form">
      <label>NIF / CIF <input name="nif" required placeholder="12345678A" autocomplete="on"></label>
      <label>Nombre o razón social <input name="nombre" required></label>
      <label>Dirección fiscal (opcional) <input name="direccion"></label>
      <label>Email <input name="email" type="email" required></label>
      <button type="submit">Recibir mi factura</button>
      <p class="nota">Tus datos se recuerdan en este dispositivo para la próxima vez.</p>
    </form>
    <div id="ok" hidden><h2>✅ Enviada</h2><p id="okmsg"></p></div>
  </main>
  <script>
    const form = document.getElementById('form');
    // Recordar datos del cliente en el dispositivo
    try {
      const saved = JSON.parse(localStorage.getItem('tf:cliente') || '{}');
      for (const k of ['nif','nombre','direccion','email']) if (saved[k]) form[k].value = saved[k];
    } catch {}
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form));
      try { localStorage.setItem('tf:cliente', JSON.stringify(body)); } catch {}
      const r = await fetch(location.pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) { alert(data.error || 'Error'); return; }
      form.hidden = true;
      document.getElementById('ok').hidden = false;
      document.getElementById('okmsg').textContent =
        'Factura ' + data.numero + (data.reenviada ? ' (reenviada)' : '') + ' enviada a tu email.';
    });
  </script>
  </body></html>`;
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

mountLegacyFeatures(app, { db, emitirFactura, mailer, BASE_URL, JWT_SECRET, apiLimiter, formLimiter });
mountComprador(app, { db, emitirFactura, mailer, BASE_URL, JWT_SECRET, apiLimiter, formLimiter, isProduction });

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  res.status(status).json({ error: status >= 500 ? 'Error interno' : err.message });
});

app.listen(PORT, () => console.log(`TicketFactura en ${BASE_URL}`));
