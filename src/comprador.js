/*
 * Flujo comprador-céntrico: el autónomo se registra una vez con sus datos
 * fiscales, hace una foto al ticket y la app emite la factura detectando al
 * vendedor (o dándolo de alta automáticamente) y la envía por email a ambos.
 */
const crypto = require('crypto');
const path = require('path');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const { validarNIF, normalizarNIF } = require('./validators');
const { renderFacturaHtml } = require('./invoice');

const SESSION_COOKIE = 'tf_comprador';
const SESSION_DAYS = 180;

function mountComprador(app, { db, emitirFactura, mailer, BASE_URL, JWT_SECRET, apiLimiter, formLimiter, isProduction }) {
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

  app.get('/app', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'app.html')));

  /* ── Sesión ── */
  function setSession(res, compradorId) {
    const token = jwt.sign({ uid: compradorId, typ: 'comprador' }, JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
    const flags = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
    if (isProduction) flags.push('Secure');
    res.setHeader('Set-Cookie', flags.join('; '));
  }

  function clearSession(res) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  function compradorFromRequest(req) {
    const cookies = String(req.get('cookie') || '');
    const raw = cookies.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    if (!raw) return null;
    try {
      const data = jwt.verify(raw.slice(SESSION_COOKIE.length + 1), JWT_SECRET);
      if (data.typ !== 'comprador') return null;
      return db.prepare('SELECT * FROM compradores WHERE id = ? AND activo = 1').get(data.uid) || null;
    } catch {
      return null;
    }
  }

  const requireComprador = (handler) => async (req, res, next) => {
    const comprador = compradorFromRequest(req);
    if (!comprador) return res.status(401).json({ error: 'Inicia sesión para continuar' });
    try {
      await handler(req, res, comprador);
    } catch (err) {
      next(err);
    }
  };

  /* ── Registro / login ── */
  app.post('/api/comprador/registro', authLimiter, (req, res) => {
    const { email, password, nif, nombre, direccion } = req.body || {};
    const emailNorm = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) return res.status(400).json({ error: 'Email no válido' });
    if (String(password || '').length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    if (!validarNIF(nif)) return res.status(400).json({ error: 'NIF/CIF no válido' });
    if (!nombre || String(nombre).trim().length < 3) return res.status(400).json({ error: 'Nombre o razón social obligatorio' });

    if (db.prepare('SELECT id FROM compradores WHERE email = ?').get(emailNorm)) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email. Inicia sesión.' });
    }

    const info = db.prepare(`
      INSERT INTO compradores (email, password_hash, nif, nombre, direccion)
      VALUES (?, ?, ?, ?, ?)
    `).run(emailNorm, hashPassword(String(password)), normalizarNIF(nif), String(nombre).trim(), String(direccion || '').trim());

    setSession(res, info.lastInsertRowid);
    res.status(201).json({ ok: true, comprador: publicComprador(db.prepare('SELECT * FROM compradores WHERE id = ?').get(info.lastInsertRowid)) });
  });

  app.post('/api/comprador/login', authLimiter, (req, res) => {
    const emailNorm = String((req.body || {}).email || '').trim().toLowerCase();
    const comprador = db.prepare('SELECT * FROM compradores WHERE email = ? AND activo = 1').get(emailNorm);
    if (!comprador || !verifyPassword(String((req.body || {}).password || ''), comprador.password_hash)) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    setSession(res, comprador.id);
    res.json({ ok: true, comprador: publicComprador(comprador) });
  });

  app.post('/api/comprador/logout', (req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  app.get('/api/comprador/me', apiLimiter, (req, res) => {
    const comprador = compradorFromRequest(req);
    if (!comprador) return res.status(401).json({ error: 'Sin sesión' });
    res.json({ comprador: publicComprador(comprador) });
  });

  app.put('/api/comprador/perfil', apiLimiter, requireComprador(async (req, res, comprador) => {
    const { nif, nombre, direccion } = req.body || {};
    if (!validarNIF(nif)) return res.status(400).json({ error: 'NIF/CIF no válido' });
    if (!nombre || String(nombre).trim().length < 3) return res.status(400).json({ error: 'Nombre o razón social obligatorio' });
    db.prepare('UPDATE compradores SET nif = ?, nombre = ?, direccion = ? WHERE id = ?')
      .run(normalizarNIF(nif), String(nombre).trim(), String(direccion || '').trim(), comprador.id);
    res.json({ ok: true, comprador: publicComprador(db.prepare('SELECT * FROM compradores WHERE id = ?').get(comprador.id)) });
  }));

  /* ── Emitir factura desde una foto de ticket ──
     El comprador manda los datos del vendedor detectados por OCR (revisados
     por él) y los importes. Si el vendedor no existe, se da de alta
     automáticamente con su propia serie de numeración. */
  app.post('/api/comprador/factura', formLimiter, requireComprador(async (req, res, comprador) => {
    const body = req.body || {};
    const vendedor = body.vendedor || {};
    const vendedorNif = normalizarNIF(vendedor.nif);
    const vendedorNombre = String(vendedor.nombre || '').trim();
    const vendedorEmail = String(vendedor.email || '').trim().toLowerCase();

    if (!validarNIF(vendedorNif)) return res.status(400).json({ error: 'El NIF/CIF del vendedor no es válido. Revísalo en el ticket.' });
    if (vendedorNombre.length < 3) return res.status(400).json({ error: 'Nombre del vendedor obligatorio' });
    if (vendedorEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(vendedorEmail)) return res.status(400).json({ error: 'Email del vendedor no válido' });

    const totalNum = Number(String(body.total ?? '').replace(',', '.'));
    if (!Number.isFinite(totalNum) || totalNum <= 0) return res.status(400).json({ error: 'Importe total obligatorio y > 0' });
    const tipoIva = Number(body.tipo_iva ?? 21);
    if (!Number.isFinite(tipoIva) || tipoIva < 0 || tipoIva > 100) return res.status(400).json({ error: 'Tipo de IVA no válido' });

    const concepto = String(body.concepto || 'Compra según ticket').trim().slice(0, 140);
    const fechaTicket = String(body.fecha || '').trim().slice(0, 10);
    const ticketRef = String(body.ticket_ref || '').trim().slice(0, 80)
      || `FOTO-${fechaTicket || new Date().toISOString().slice(0, 10)}-${Math.round(totalNum * 100)}`;

    const comercio = obtenerOCrearVendedor(db, {
      nif: vendedorNif,
      nombre: vendedorNombre,
      direccion: String(vendedor.direccion || '').trim(),
      email: vendedorEmail,
    });

    // Idempotencia: misma referencia + mismo comprador → reenviar la existente.
    const previa = db.prepare('SELECT * FROM facturas WHERE comercio_id = ? AND ticket_ref = ? AND cliente_nif = ?')
      .get(comercio.id, ticketRef, comprador.nif);

    const total = Math.round(totalNum * 100) / 100;
    const base = total / (1 + tipoIva / 100);
    const factura = previa ?? emitirFactura({
      comercio_id: comercio.id,
      fecha_emision: new Date().toISOString().slice(0, 10),
      concepto: fechaTicket ? `${concepto} (ticket de ${fechaTicket})` : concepto,
      base_imponible: Math.round(base * 100) / 100,
      tipo_iva: tipoIva,
      cuota_iva: Math.round((total - base) * 100) / 100,
      total,
      cliente_nif: comprador.nif,
      cliente_nombre: comprador.nombre,
      cliente_direccion: comprador.direccion || '',
      cliente_email: comprador.email,
      ticket_ref: ticketRef,
      comprador_id: comprador.id,
    });

    const facturaUrl = `${BASE_URL}/factura/${factura.id}/html?token=${signFacturaToken(factura.id, JWT_SECRET)}`;
    const html = addFacturaLink(renderFacturaHtml(factura, comercio), facturaUrl);
    const destinatarios = { to: factura.cliente_email };
    const emailVendedor = comercio.email || vendedorEmail;
    if (emailVendedor) destinatarios.cc = emailVendedor;

    const envio = await mailer.sendMail({
      from: process.env.SMTP_FROM || `"TicketFactura" <facturas@ticketfactura.local>`,
      ...destinatarios,
      subject: `Factura ${factura.numero} — ${comercio.nombre}`,
      html,
    });
    db.prepare('UPDATE facturas SET enviada = 1 WHERE id = ?').run(factura.id);

    res.status(previa ? 200 : 201).json({
      ok: true,
      numero: factura.numero,
      reenviada: Boolean(previa),
      vendedor: { nombre: comercio.nombre, nif: comercio.nif, nuevo: Boolean(comercio.recienCreado) },
      email_vendedor: emailVendedor || null,
      factura_url: facturaUrl,
      dev_preview: process.env.SMTP_HOST ? undefined : JSON.parse(envio.message).subject,
      message: emailVendedor
        ? `Factura ${factura.numero} enviada a ${factura.cliente_email} y al vendedor (${emailVendedor}).`
        : `Factura ${factura.numero} enviada a ${factura.cliente_email}. El ticket no incluía email del vendedor: puedes reenviársela desde el enlace.`,
    });
  }));

  app.get('/api/comprador/facturas', apiLimiter, requireComprador(async (req, res, comprador) => {
    const rows = db.prepare(`
      SELECT f.*, c.nombre AS vendedor_nombre, c.nif AS vendedor_nif
      FROM facturas f JOIN comercios c ON c.id = f.comercio_id
      WHERE f.comprador_id = ?
      ORDER BY f.created_at DESC LIMIT 100
    `).all(comprador.id);
    res.json(rows.map((f) => ({
      id: f.id,
      numero: f.numero,
      fecha: f.fecha_emision,
      concepto: f.concepto,
      total: f.total,
      vendedor: { nombre: f.vendedor_nombre, nif: f.vendedor_nif },
      url: `${BASE_URL}/factura/${f.id}/html?token=${signFacturaToken(f.id, JWT_SECRET)}`,
    })));
  }));
}

/* Alta automática del vendedor detectado en el ticket: serie propia derivada
   del NIF y numeración consecutiva por año desde 0001. Si ya existe y el
   comprador aporta email/dirección que faltaban, se completan. */
function obtenerOCrearVendedor(db, { nif, nombre, direccion, email }) {
  const existente = db.prepare('SELECT * FROM comercios WHERE nif = ? AND activo = 1').get(nif);
  if (existente) {
    if ((!existente.email && email) || (!existente.direccion && direccion)) {
      db.prepare('UPDATE comercios SET email = COALESCE(NULLIF(email, \'\'), ?), direccion = COALESCE(NULLIF(direccion, \'\'), ?) WHERE id = ?')
        .run(email || '', direccion || '', existente.id);
      return db.prepare('SELECT * FROM comercios WHERE id = ?').get(existente.id);
    }
    return existente;
  }

  let serie = `TF-${nif}`;
  let sufijo = 1;
  while (db.prepare('SELECT id FROM comercios WHERE serie = ?').get(serie)) {
    sufijo += 1;
    serie = `TF-${nif}-${sufijo}`;
  }

  const info = db.prepare(`
    INSERT INTO comercios (nombre, nif, direccion, email, serie, iva_defecto, api_key, auto_creado)
    VALUES (?, ?, ?, ?, ?, 21, ?, 1)
  `).run(nombre, nif, direccion || '', email || '', serie, 'tf_' + crypto.randomBytes(24).toString('hex'));

  const creado = db.prepare('SELECT * FROM comercios WHERE id = ?').get(info.lastInsertRowid);
  creado.recienCreado = true;
  return creado;
}

/* ── Contraseñas: scrypt de Node, sin dependencias nuevas ── */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

function publicComprador(c) {
  return { id: c.id, email: c.email, nif: c.nif, nombre: c.nombre, direccion: c.direccion };
}

function signFacturaToken(id, secret) {
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

module.exports = { mountComprador };
