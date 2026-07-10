# AI_WORKLOG.md

Bitácora de trabajo de agentes IA. Añadir entradas arriba, bajo "Últimas entradas".

## Últimas entradas

<!-- AI_WORKLOG:START -->
### 2026-07-10 — IA (Claude)

- Resumen: pivote a flujo comprador-céntrico. Nueva app `/app`: el autónomo se registra una vez (email+contraseña scrypt, cookie JWT) con sus datos fiscales; foto al ticket → OCR detecta vendedor/fecha/total/IVA → factura emitida con la serie del vendedor (existente por NIF, o alta automática `TF-<NIF>` con `auto_creado=1`) → email a comprador y vendedor. Historial "Mis facturas". Landing reorientada al autónomo; QR se mantiene para comercios.
- Archivos: `src/comprador.js` (nuevo), `src/db.js` (tabla `compradores`, `comercios.auto_creado`, `facturas.comprador_id`), `src/server.js`, `src/invoice.js` (mención art. 5 RD 1619/2012), `src/legacy-features.js` (parser OCR ampliado), `public/app.html` (nuevo), `public/index.html`, `public/panel.html`, `public/solicitar.html`, `docs/API.md`, `docs/DECISIONS.md`, `README.md`, `.env.example`, `PROJECT_STATUS.md`.
- Verificación: smoke API completo (registro/login/logout/401s, factura con vendedor nuevo → `TF-B12345674-2026-0001`, idempotencia reenviada, vendedor registrado → serie `TF-DEMO`, NIF inválido rechazado, nota destinatario en HTML) + regresión de flujos QR/solicitar/dashboard + Playwright sobre `/app` (registro UI, factura, listado, sesión persistente) sin errores.
- Siguiente paso: redesplegar VPS, `OCR_API_KEY` en `.env`, luego DNS + SMTP.

### 2026-07-10T21:53:22+00:00 — IA

- Resumen: Revisado TicketFactura en local/VPS/GitHub; corregido trust proxy detrás de Caddy, añadido favicon, restaurada metadata webs-deploy y redesplegado en Contabo
- Verificación: Local smoke: health/landing/demo/solicitar/panel/API dashboard/tickets/invoices OK. VPS: docker health healthy, rutas 200/302, factura manual OK, logs sin ERR_ERL, Caddy valid, Playwright panel OK sin consola, webs-deploy 10/10 sin blockers.
- Siguiente paso: no indicado
- Cambios detectados:
  - Sin cambios pendientes


### 2026-07-10 23:47 CEST — Hermes / gpt-5.5

- Resumen: revisión de TicketFactura local/VPS/GitHub; detectado error repetido de `express-rate-limit` por `X-Forwarded-For` detrás de Caddy; corregido `trust proxy` para respetar `TRUST_PROXY=1` también en modo demo/desarrollo.
- Archivos tocados: `src/server.js`, `public/favicon.ico`, `.websdeploy.json`, `PROJECT_STATUS.md`, `docs/AI_WORKLOG.md`, `docs/DECISIONS.md`.
- Verificación local: seed en `/tmp/ticketfactura-smoke`; `/health`, `/`, `/demo`, `/solicitar`, `/panel`, `/favicon.ico`, `/api/companies/search`, `/api/dashboard`, `/api/tickets` y `/api/invoices/request` OK; logs sin `ERR_ERL`.
- Verificación VPS: Docker Compose build/restart, curl de rutas principales, API dashboard y factura manual OK; navegador real en `/panel` sin errores propios tras añadir favicon.
- Siguiente paso: configurar DNS + SMTP para pasar de demo a producción real.

<!-- AI_WORKLOG:END -->
