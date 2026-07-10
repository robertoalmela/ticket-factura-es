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

- Fecha: 2026-07-10 (pivote comprador)
- Qué funciona (verificado local): registro/login comprador (`/app`), foto→OCR→factura con alta automática del vendedor por NIF (serie `TF-<NIF>`), coincidencia con comercios registrados (usa su serie), idempotencia, email a ambas partes, historial "Mis facturas", y todos los flujos anteriores (QR `/f/`, `/solicitar`, `/panel`, API).
- Qué cambia: landing reorientada al autónomo; nueva tabla `compradores`; `comercios.auto_creado`; `facturas.comprador_id`; parser OCR ampliado (IVA, email, dirección).
- Qué falta para producción: redesplegar en VPS (`git pull` + `docker compose up -d --build`), DNS `ticket-factura.es` hacia `173.249.46.245` y SMTP real.
- Bloqueos: sin SMTP real los emails se simulan con `jsonTransport`; sin `OCR_API_KEY` la lectura de tickets funciona en modo manual.

## Próximos pasos

1. Redesplegar el VPS con el pivote comprador (rama `claude/ai-project-vps-deploy-i31z7t` o main tras merge).
2. Conseguir `OCR_API_KEY` (gratuita en ocr.space) y añadirla al `.env` del VPS para que la foto detecte datos de verdad.
3. Configurar DNS del dominio `ticket-factura.es` hacia el VPS.
4. Configurar SMTP real del dominio/correo.
5. Cambiar `BASE_URL` a `https://ticket-factura.es` y activar bloque Caddy definitivo.

## Última actualización IA

- Fecha: `2026-07-10T23:00:00+00:00` (aprox.)
- Resumen: Pivote comprador-céntrico: registro de compradores con datos fiscales, foto→OCR→factura con detección/alta automática del vendedor, email a ambas partes, historial, landing nueva. Flujos QR/solicitar/panel intactos.
- Verificación: smoke local completo por API (registro, login, factura vendedor nuevo/existente, idempotencia, validaciones, regresión QR+solicitar+dashboard) y Playwright sobre `/app` (registro UI, factura manual, listado, sesión persistente) sin errores propios de consola.

