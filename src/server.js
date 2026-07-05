const express = require('express');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const path = require('path');
const nodemailer = require('nodemailer');

const { db, emitirFactura } = require('./db');
const { validarNIF, normalizarNIF } = require('./validators');
const { renderFacturaHtml } = require('./invoice');

const PORT = process.env.PORT || 8380;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-CAMBIAR-EN-PRODUCCION';

// SMTP: en desarrollo, transport JSON (loguea en vez de enviar).
const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : nodemailer.createTransport({ jsonTransport: true });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

/* ── API del comercio (TPV / PrintQueue) ─────────────────────────────
   El comercio crea un "ticket facturable" y recibe la URL (y el QR)
   que se imprime en el ticket físico. */
app.post('/api/tickets', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const comercio = db.prepare('SELECT * FROM comercios WHERE api_key = ? AND activo = 1').get(apiKey || '');
  if (!comercio) return res.status(401).json({ error: 'API key inválida' });

  const { total, concepto, ticket_ref, tipo_iva } = req.body || {};
  const totalNum = Number(total);
  if (!Number.isFinite(totalNum) || totalNum <= 0) {
    return res.status(400).json({ error: 'total (importe con IVA) es obligatorio y > 0' });
  }

  const token = jwt.sign(
    {
      c: comercio.id,
      t: Math.round(totalNum * 100),          // céntimos
      iva: Number(tipo_iva ?? comercio.iva_defecto),
      cpt: String(concepto || 'Venta').slice(0, 140),
      ref: String(ticket_ref || '').slice(0, 60),
    },
    JWT_SECRET,
    { expiresIn: '90d' },                      // plazo razonable para pedir factura
  );

  const url = `${BASE_URL}/f/${token}`;
  res.json({ url });
});

// QR en PNG para imprimir junto al ticket
app.get('/api/qr', async (req, res) => {
  const { url } = req.query;
  if (!url || !String(url).startsWith(BASE_URL)) return res.status(400).send('url inválida');
  res.type('png').send(await QRCode.toBuffer(String(url), { width: 300, margin: 1 }));
});

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
    token: req.params.token,
  }));
});

app.post('/f/:token', async (req, res) => {
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

  const html = renderFacturaHtml(factura, comercio);
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
});

// Vista HTML de la factura (enlace del email en producción llevaría aquí con auth)
app.get('/factura/:id/html', (req, res) => {
  const f = db.prepare('SELECT * FROM facturas WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).send('No encontrada');
  const c = db.prepare('SELECT * FROM comercios WHERE id = ?').get(f.comercio_id);
  res.send(renderFacturaHtml(f, c));
});

function renderPedirPage({ comercio, total, concepto, token }) {
  return `<!doctype html><html lang="es"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tu factura de ${comercio}</title>
  <link rel="stylesheet" href="/estilo.css"></head>
  <body class="pedir">
  <main class="card">
    <h1>Factura de tu compra</h1>
    <p class="resumen"><strong>${comercio}</strong> · ${concepto} · <strong>${total} €</strong></p>
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

app.listen(PORT, () => console.log(`TicketFactura en ${BASE_URL}`));
