/*
 * Flujo comprador-céntrico: el autónomo se registra una vez con sus datos
 * fiscales y fotografía el ticket. Si el vendedor ya está en TicketFactura
 * (por NIF), la factura se emite y se envía a ambos al momento. Si no, la
 * solicitud queda pendiente y el vendedor recibe un email de invitación:
 * al registrarse, sus facturas pendientes se emiten automáticamente.
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

  // Endpoint silencioso para inicializar la UI sin generar un 401 visible en consola
  // cuando el visitante aún no ha iniciado sesión.
  app.get('/api/comprador/session', apiLimiter, (req, res) => {
    const comprador = compradorFromRequest(req);
    res.json({ comprador: comprador ? publicComprador(comprador) : null });
  });

  app.put('/api/comprador/perfil', apiLimiter, requireComprador(async (req, res, comprador) => {
    const { nif, nombre, direccion } = req.body || {};
    if (!validarNIF(nif)) return res.status(400).json({ error: 'NIF/CIF no válido' });
    if (!nombre || String(nombre).trim().length < 3) return res.status(400).json({ error: 'Nombre o razón social obligatorio' });
    db.prepare('UPDATE compradores SET nif = ?, nombre = ?, direccion = ? WHERE id = ?')
      .run(normalizarNIF(nif), String(nombre).trim(), String(direccion || '').trim(), comprador.id);
    res.json({ ok: true, comprador: publicComprador(db.prepare('SELECT * FROM compradores WHERE id = ?').get(comprador.id)) });
  }));

  /* ── Foto de ticket → factura o solicitud ──
     Vendedor registrado (por NIF): factura inmediata para ambos.
     Vendedor sin registrar: solicitud pendiente + email de invitación. */
  app.post('/api/comprador/factura', formLimiter, requireComprador(async (req, res, comprador) => {
    const body = req.body || {};
    const vendedor = body.vendedor || {};
    const vendedorNif = normalizarNIF(vendedor.nif);
    const vendedorNombre = String(vendedor.nombre || '').trim();
    const vendedorEmail = String(vendedor.email || '').trim().toLowerCase();
    const vendedorDireccion = String(vendedor.direccion || '').trim();

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
    const total = Math.round(totalNum * 100) / 100;

    const comercio = db.prepare('SELECT * FROM comercios WHERE nif = ? AND activo = 1').get(vendedorNif);

    /* Vendedor sin registrar → solicitud pendiente + invitación por email */
    if (!comercio) {
      if (!vendedorEmail) {
        return res.status(400).json({
          error: 'Este comercio aún no está en TicketFactura. Añade su email (pídelo en el mostrador o búscalo en el ticket) y le enviaremos una invitación: cuando se registre recibirás tu factura automáticamente.',
          necesita_email_vendedor: true,
        });
      }

      const previa = db.prepare('SELECT * FROM solicitudes WHERE comprador_id = ? AND vendedor_nif = ? AND ticket_ref = ?')
        .get(comprador.id, vendedorNif, ticketRef);
      if (previa && previa.estado === 'FACTURADA') {
        return res.json({ ok: true, estado: 'FACTURADA', message: 'Este ticket ya se facturó. Revisa "Mis facturas".' });
      }

      if (previa) {
        db.prepare('UPDATE solicitudes SET vendedor_email = ?, vendedor_nombre = ?, vendedor_direccion = ? WHERE id = ?')
          .run(vendedorEmail, vendedorNombre, vendedorDireccion, previa.id);
      } else {
        db.prepare(`
          INSERT INTO solicitudes (comprador_id, vendedor_nif, vendedor_nombre, vendedor_email, vendedor_direccion, total, tipo_iva, concepto, fecha_ticket, ticket_ref)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(comprador.id, vendedorNif, vendedorNombre, vendedorEmail, vendedorDireccion, total, tipoIva, concepto, fechaTicket || null, ticketRef);
      }

      const altaUrl = `${BASE_URL}/vendedor/alta/${signAltaToken(vendedorNif, vendedorEmail, JWT_SECRET)}`;
      const envio = await mailer.sendMail({
        from: process.env.SMTP_FROM || `"TicketFactura" <facturas@ticketfactura.local>`,
        to: vendedorEmail,
        subject: `${comprador.nombre} te pide una factura de ${eur(total)} — TicketFactura`,
        html: renderInvitacionVendedor({ vendedorNombre, comprador, total, concepto, fechaTicket, ticketRef, altaUrl }),
      });

      return res.status(previa ? 200 : 201).json({
        ok: true,
        estado: 'PENDIENTE_VENDEDOR',
        reenviada: Boolean(previa),
        vendedor: { nombre: vendedorNombre, nif: vendedorNif, registrado: false },
        dev_preview: process.env.SMTP_HOST ? undefined : JSON.parse(envio.message).subject,
        message: `${vendedorNombre} aún no está en TicketFactura. Le hemos enviado una invitación a ${vendedorEmail}: en cuanto se registre, tu factura se emitirá y te llegará por email automáticamente.`,
      });
    }

    /* Vendedor registrado → factura inmediata */
    if ((!comercio.email && vendedorEmail) || (!comercio.direccion && vendedorDireccion)) {
      db.prepare("UPDATE comercios SET email = COALESCE(NULLIF(email, ''), ?), direccion = COALESCE(NULLIF(direccion, ''), ?) WHERE id = ?")
        .run(vendedorEmail || '', vendedorDireccion || '', comercio.id);
    }

    const previa = db.prepare('SELECT * FROM facturas WHERE comercio_id = ? AND ticket_ref = ? AND cliente_nif = ?')
      .get(comercio.id, ticketRef, comprador.nif);

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

    const { facturaUrl, envio } = await enviarFactura({ db, mailer, BASE_URL, JWT_SECRET, factura, comercio });

    res.status(previa ? 200 : 201).json({
      ok: true,
      estado: 'FACTURADA',
      numero: factura.numero,
      reenviada: Boolean(previa),
      vendedor: { nombre: comercio.nombre, nif: comercio.nif, registrado: true },
      factura_url: facturaUrl,
      dev_preview: process.env.SMTP_HOST ? undefined : JSON.parse(envio.message).subject,
      message: `Factura ${factura.numero} enviada a ${factura.cliente_email}${comercio.email ? ` con copia a ${comercio.nombre}` : ''}.`,
    });
  }));

  app.get('/api/comprador/facturas', apiLimiter, requireComprador(async (req, res, comprador) => {
    const facturas = db.prepare(`
      SELECT f.*, c.nombre AS vendedor_nombre, c.nif AS vendedor_nif
      FROM facturas f JOIN comercios c ON c.id = f.comercio_id
      WHERE f.comprador_id = ?
      ORDER BY f.created_at DESC LIMIT 100
    `).all(comprador.id);
    const pendientes = db.prepare(`
      SELECT * FROM solicitudes WHERE comprador_id = ? AND estado = 'PENDIENTE'
      ORDER BY created_at DESC LIMIT 100
    `).all(comprador.id);
    res.json({
      facturas: facturas.map((f) => ({
        id: f.id,
        numero: f.numero,
        fecha: f.fecha_emision,
        concepto: f.concepto,
        total: f.total,
        vendedor: { nombre: f.vendedor_nombre, nif: f.vendedor_nif },
        url: `${BASE_URL}/factura/${f.id}/html?token=${signFacturaToken(f.id, JWT_SECRET)}`,
      })),
      pendientes: pendientes.map((s) => ({
        id: s.id,
        fecha: s.created_at.slice(0, 10),
        concepto: s.concepto,
        total: s.total,
        vendedor: { nombre: s.vendedor_nombre, nif: s.vendedor_nif, email: s.vendedor_email },
      })),
    });
  }));

  /* ── Alta de vendedor por invitación ──
     El enlace del email lleva un token firmado con el NIF. Al completar el
     alta se emiten todas las solicitudes pendientes de ese NIF. */
  app.get('/vendedor/alta/:token', (req, res) => {
    const data = verifyAltaToken(req.params.token, JWT_SECRET);
    if (!data) return res.status(400).sendFile(path.join(__dirname, '..', 'public', 'caducado.html'));
    if (db.prepare('SELECT id FROM comercios WHERE nif = ? AND activo = 1').get(data.nif)) {
      return res.send(renderAltaHechaPage());
    }
    const solicitudes = db.prepare("SELECT * FROM solicitudes WHERE vendedor_nif = ? AND estado = 'PENDIENTE' ORDER BY created_at DESC").all(data.nif);
    const ultima = solicitudes[0] || {};
    res.send(renderAltaVendedorPage({
      nif: data.nif,
      email: data.email,
      nombre: ultima.vendedor_nombre || '',
      direccion: ultima.vendedor_direccion || '',
      pendientes: solicitudes.length,
    }));
  });

  app.post('/vendedor/alta/:token', formLimiter, async (req, res, next) => {
    try {
      const data = verifyAltaToken(req.params.token, JWT_SECRET);
      if (!data) return res.status(400).json({ error: 'Enlace caducado o inválido. Pide al comprador que reenvíe la solicitud.' });

      const { nombre, direccion, email } = req.body || {};
      const emailNorm = String(email || data.email || '').trim().toLowerCase();
      if (!nombre || String(nombre).trim().length < 3) return res.status(400).json({ error: 'Nombre del comercio obligatorio' });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) return res.status(400).json({ error: 'Email no válido' });

      let comercio = db.prepare('SELECT * FROM comercios WHERE nif = ? AND activo = 1').get(data.nif);
      if (!comercio) {
        let serie = `TF-${data.nif}`;
        let sufijo = 1;
        while (db.prepare('SELECT id FROM comercios WHERE serie = ?').get(serie)) {
          sufijo += 1;
          serie = `TF-${data.nif}-${sufijo}`;
        }
        const info = db.prepare(`
          INSERT INTO comercios (nombre, nif, direccion, email, serie, iva_defecto, api_key)
          VALUES (?, ?, ?, ?, ?, 21, ?)
        `).run(String(nombre).trim(), data.nif, String(direccion || '').trim(), emailNorm, serie, 'tf_' + crypto.randomBytes(24).toString('hex'));
        comercio = db.prepare('SELECT * FROM comercios WHERE id = ?').get(info.lastInsertRowid);
      }

      // Emitir todas las solicitudes pendientes de este NIF (de cualquier comprador)
      const pendientes = db.prepare("SELECT * FROM solicitudes WHERE vendedor_nif = ? AND estado = 'PENDIENTE'").all(data.nif);
      let emitidas = 0;
      for (const s of pendientes) {
        const comprador = db.prepare('SELECT * FROM compradores WHERE id = ?').get(s.comprador_id);
        if (!comprador) continue;
        const yaEmitida = db.prepare('SELECT * FROM facturas WHERE comercio_id = ? AND ticket_ref = ? AND cliente_nif = ?')
          .get(comercio.id, s.ticket_ref, comprador.nif);
        const baseImp = s.total / (1 + s.tipo_iva / 100);
        const factura = yaEmitida ?? emitirFactura({
          comercio_id: comercio.id,
          fecha_emision: new Date().toISOString().slice(0, 10),
          concepto: s.fecha_ticket ? `${s.concepto} (ticket de ${s.fecha_ticket})` : s.concepto,
          base_imponible: Math.round(baseImp * 100) / 100,
          tipo_iva: s.tipo_iva,
          cuota_iva: Math.round((s.total - baseImp) * 100) / 100,
          total: s.total,
          cliente_nif: comprador.nif,
          cliente_nombre: comprador.nombre,
          cliente_direccion: comprador.direccion || '',
          cliente_email: comprador.email,
          ticket_ref: s.ticket_ref,
          comprador_id: comprador.id,
        });
        db.prepare("UPDATE solicitudes SET estado = 'FACTURADA', factura_id = ? WHERE id = ?").run(factura.id, s.id);
        try {
          await enviarFactura({ db, mailer, BASE_URL, JWT_SECRET, factura, comercio });
        } catch (err) {
          console.error('Error enviando factura de solicitud', s.id, err);
        }
        emitidas += 1;
      }

      res.status(201).json({
        ok: true,
        comercio: { nombre: comercio.nombre, nif: comercio.nif, serie: comercio.serie },
        api_key: comercio.api_key,
        facturas_emitidas: emitidas,
        panel_url: `${BASE_URL}/panel`,
        message: emitidas
          ? `Alta completada. Se ${emitidas === 1 ? 'ha emitido 1 factura pendiente' : `han emitido ${emitidas} facturas pendientes`} y se ha enviado por email a cada comprador con copia para ti.`
          : 'Alta completada. Ya puedes gestionar tus facturas desde el panel.',
      });
    } catch (err) {
      next(err);
    }
  });
}

/* Envío de la factura por email al comprador con copia al vendedor. */
async function enviarFactura({ db, mailer, BASE_URL, JWT_SECRET, factura, comercio }) {
  const facturaUrl = `${BASE_URL}/factura/${factura.id}/html?token=${signFacturaToken(factura.id, JWT_SECRET)}`;
  const html = addFacturaLink(renderFacturaHtml(factura, comercio), facturaUrl);
  const destinatarios = { to: factura.cliente_email };
  if (comercio.email) destinatarios.cc = comercio.email;
  const envio = await mailer.sendMail({
    from: process.env.SMTP_FROM || `"TicketFactura" <facturas@ticketfactura.local>`,
    ...destinatarios,
    subject: `Factura ${factura.numero} — ${comercio.nombre}`,
    html,
  });
  db.prepare('UPDATE facturas SET enviada = 1 WHERE id = ?').run(factura.id);
  return { facturaUrl, envio };
}

function renderInvitacionVendedor({ vendedorNombre, comprador, total, concepto, fechaTicket, ticketRef, altaUrl }) {
  return `<!doctype html><html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#172033;max-width:560px;margin:24px auto;padding:0 16px">
  <h2 style="color:#0b5563">Un cliente te pide factura</h2>
  <p>Hola${vendedorNombre ? ` <strong>${escapeHtml(vendedorNombre)}</strong>` : ''},</p>
  <p><strong>${escapeHtml(comprador.nombre)}</strong> (NIF ${escapeHtml(comprador.nif)}) necesita la factura de una compra en tu establecimiento:</p>
  <table style="border-collapse:collapse;font-size:14px;margin:12px 0">
    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Concepto</td><td>${escapeHtml(concepto)}</td></tr>
    ${fechaTicket ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Fecha del ticket</td><td>${escapeHtml(fechaTicket)}</td></tr>` : ''}
    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Referencia</td><td>${escapeHtml(ticketRef)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Importe</td><td><strong>${eur(total)}</strong></td></tr>
  </table>
  <p>Regístrate gratis en TicketFactura y la factura se emitirá automáticamente con tu numeración, con copia para ti y para tu cliente. Las próximas serán igual de automáticas.</p>
  <p style="margin:24px 0"><a href="${escapeHtml(altaUrl)}" style="background:#0e7490;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Completar alta y emitir la factura</a></p>
  <p style="font-size:12px;color:#64748b">Si no reconoces esta compra puedes ignorar este email. El enlace caduca en 30 días.</p>
  </body></html>`;
}

function renderAltaVendedorPage({ nif, email, nombre, direccion, pendientes }) {
  return `<!doctype html><html lang="es"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Alta de comercio — TicketFactura</title>
  <link rel="stylesheet" href="/estilo.css"></head>
  <body class="pedir">
  <main class="card">
    <h1>Alta en TicketFactura</h1>
    <p class="resumen">${pendientes === 1 ? 'Tienes <strong>1 solicitud de factura</strong> esperando' : `Tienes <strong>${pendientes} solicitudes de factura</strong> esperando`}. Completa el alta y ${pendientes === 1 ? 'se emitirá' : 'se emitirán'} automáticamente con tu numeración.</p>
    <form id="form">
      <label>NIF / CIF <input value="${escapeHtml(nif)}" disabled></label>
      <label>Nombre del comercio <input name="nombre" required value="${escapeHtml(nombre)}"></label>
      <label>Dirección <input name="direccion" value="${escapeHtml(direccion)}"></label>
      <label>Email para las facturas <input name="email" type="email" required value="${escapeHtml(email)}"></label>
      <button type="submit">Darme de alta y emitir</button>
      <p class="nota">Gratis durante el lanzamiento. Recibirás copia de cada factura que tus clientes se hagan solos.</p>
    </form>
    <div id="ok" hidden>
      <h2>✅ Alta completada</h2>
      <p id="okmsg"></p>
      <p>Tu clave de acceso al <a href="/panel">panel de comercio</a> (guárdala):</p>
      <p class="code" id="apikey" style="word-break:break-all"></p>
    </div>
    <div id="err" class="alert error" hidden></div>
  </main>
  <script>
    const form = document.getElementById('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form));
      const r = await fetch(location.pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      const err = document.getElementById('err');
      if (!r.ok) { err.hidden = false; err.textContent = data.error || 'Error'; return; }
      err.hidden = true;
      form.hidden = true;
      document.getElementById('ok').hidden = false;
      document.getElementById('okmsg').textContent = data.message;
      document.getElementById('apikey').textContent = data.api_key;
    });
  </script>
  </body></html>`;
}

function renderAltaHechaPage() {
  return `<!doctype html><html lang="es"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Comercio ya registrado — TicketFactura</title>
  <link rel="stylesheet" href="/estilo.css"></head>
  <body class="pedir"><main class="card">
    <h1>Este comercio ya está registrado</h1>
    <p>Las solicitudes de factura pendientes ya se emiten automáticamente. Gestiona tus facturas desde el <a href="/panel">panel de comercio</a>.</p>
  </main></body></html>`;
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

function signAltaToken(nif, email, secret) {
  return jwt.sign({ typ: 'alta-vendedor', nif, email }, secret, { expiresIn: '30d' });
}

function verifyAltaToken(token, secret) {
  try {
    const data = jwt.verify(String(token || ''), secret);
    return data.typ === 'alta-vendedor' ? data : null;
  } catch {
    return null;
  }
}

function eur(n) {
  return Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
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
