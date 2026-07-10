# PROJECT_STATUS.md

> Estado vivo del proyecto. Mantener breve y útil para la próxima IA.

## Resumen

- Estado: MVP desplegado en VPS + pivote comprador-céntrico implementado (pendiente redesplegar); pendiente producción real con dominio + SMTP.
- Objetivo: el autónomo hace una foto al ticket y recibe la factura por email (con copia al vendedor y numeración correcta). El QR para comercios adheridos se mantiene como segundo flujo.
- Usuario final: autónomos/empresas que necesitan facturar tickets; comercios como canal (QR).
- Ruta local: `/home/roberto/Desktop/GitHub/01-incubating/ticketfactura`
- Remote GitHub actual: `https://github.com/robertoalmela/ticket-factura-es`
- Remote histórico divergente: `https://github.com/robertoalmela/factura-ticket`
- VPS: `/srv/apps/ticketfactura`, Docker Compose, puerto interno `127.0.0.1:8380`.

## Cómo arrancar local

```bash
npm ci
DATA_DIR=/tmp/ticketfactura-dev npm run seed
PORT=8392 BASE_URL=http://127.0.0.1:8392 JWT_SECRET=test-secret DATA_DIR=/tmp/ticketfactura-dev TRUST_PROXY=1 NODE_ENV=development npm start
```

## Verificación

```bash
curl -fsS http://127.0.0.1:8392/health
curl -I http://127.0.0.1:8392/demo
curl -fsS 'http://127.0.0.1:8392/api/dashboard?api_key=DEMO_KEY_AUTO'
curl -fsS -X POST http://127.0.0.1:8392/api/invoices/request \
  -H 'content-type: application/json' \
  -d '{"companyId":1,"ticket":{"total":12.8,"concepto":"Material de oficina","ticket_ref":"MANUAL-LOCAL-1"},"clientData":{"nif":"12345678Z","name":"Cliente Prueba","email":"cliente@example.com","address":"Calle Test 1"}}'
```

## URLs desplegadas

- Dashboard VPS con rutas proxy: `http://173.249.46.245/`
- Preview dedicado: `https://ticketfactura.173.249.46.245.sslip.io/`
- App comprador (flujo principal): `/app`
- Demo QR: `/demo`
- Flujo subir ticket heredado: `/solicitar`
- Panel comercio demo: `/panel`

## Último estado conocido

- Fecha: 2026-07-10 (pivote comprador + invitación a vendedores)
- Qué funciona (verificado local): registro/login comprador (`/app`); foto→OCR→revisión; vendedor registrado (por NIF) → factura inmediata con su serie y email a ambos; vendedor sin registrar → solicitud `PENDIENTE` + email de invitación con enlace de alta (`/vendedor/alta/<token>`) que al completarse emite todas sus pendientes automáticamente; historial con facturas y pendientes; y todos los flujos anteriores (QR `/f/`, `/solicitar`, `/panel`, API).
- Qué cambia: solo facturan vendedores registrados (sin alta automática); tablas `compradores` y `solicitudes`; `facturas.comprador_id`; parser OCR ampliado (IVA, email, dirección); workflow GitHub Actions `deploy.yml` para desplegar al VPS (necesita secrets).
- Qué falta para producción: redesplegar en VPS (o configurar secrets del workflow), DNS `ticket-factura.es` hacia `173.249.46.245` y SMTP real (crítico ahora: las invitaciones a vendedores van por email).
- Bloqueos: sin SMTP real los emails se simulan con `jsonTransport`; sin `OCR_API_KEY` la lectura de tickets funciona en modo manual.

## Próximos pasos

1. Configurar secrets del workflow de deploy (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`) o redesplegar a mano (`git pull` + `docker compose up -d --build`).
2. Configurar SMTP real (ahora crítico: las invitaciones a vendedores viajan por email).
3. Conseguir `OCR_API_KEY` (gratuita en ocr.space) y añadirla al `.env` del VPS para que la foto detecte datos de verdad.
4. Configurar DNS del dominio `ticket-factura.es` hacia el VPS.
5. Cambiar `BASE_URL` a `https://ticket-factura.es` y activar bloque Caddy definitivo.

## Última actualización IA

- Fecha: `2026-07-10` (segunda iteración)
- Resumen: Pivote comprador-céntrico con invitación a vendedores: el comprador registrado fotografía el ticket; si el vendedor está registrado la factura es inmediata para ambos; si no, solicitud pendiente + email de invitación cuyo enlace de alta emite automáticamente las facturas pendientes. Sin alta automática de vendedores (decisión de Roberto). Añadido workflow de deploy por GitHub Actions.
- Verificación: smoke local completo por API (registro, login, pendiente sin email → 400, invitación, dedupe/reenvío, alta vendedor → factura emitida + api_key funcional en dashboard, vendedor registrado → inmediata, token inválido, regresión QR+solicitar+dashboard) y Playwright sobre `/app` (error guiado de email, pendiente, factura inmediata, tablas) sin errores JS.

