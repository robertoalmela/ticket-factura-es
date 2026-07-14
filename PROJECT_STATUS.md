# PROJECT_STATUS.md

> Estado vivo del proyecto. Mantener breve y útil para la próxima IA.

## Resumen

- Estado: MVP fusionado y verificado localmente: QR comercio + flujo comprador con foto/OCR conviven en la misma app. Pendiente verificación final post-deploy VPS.
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

- Fecha: 2026-07-14 (merge QR + OCR y rediseño)
- Qué funciona (verificado local): landing rediseñada; registro/login comprador (`/app`); OCR opcional y modo manual; vendedor registrado por NIF → factura inmediata; vendedor no registrado → solicitud pendiente + invitación; QR `/api/tickets` + `/api/qr` + `/f/<token>`; flujo heredado `/solicitar`; panel `/panel` + `/api/dashboard`.
- Qué cambia: la landing comunica claramente los dos flujos (QR comercio y foto/OCR comprador) y todo el UI comparte el mismo sistema visual desde `public/estilo.css`.
- Qué falta para producción: verificación final post-deploy; SMTP real; `OCR_API_KEY` para OCR real (sin clave, el flujo sigue manual); DNS `www.ticket-factura.es` aún no resuelve.
- Bloqueos: sin SMTP real los emails se simulan con `jsonTransport`; sin `OCR_API_KEY` la lectura de tickets funciona en modo manual.

## Próximos pasos

1. Configurar secrets del workflow de deploy (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`) o redesplegar a mano (`git pull` + `docker compose up -d --build`).
2. Configurar SMTP real (ahora crítico: las invitaciones a vendedores viajan por email).
3. Conseguir `OCR_API_KEY` (gratuita en ocr.space) y añadirla al `.env` del VPS para que la foto detecte datos de verdad.
4. Configurar DNS del dominio `ticket-factura.es` hacia el VPS.
5. Cambiar `BASE_URL` a `https://ticket-factura.es` y activar bloque Caddy definitivo.

## Última actualización IA

- Fecha: `2026-07-14`
- Resumen: Merge de la rama comprador/OCR sobre la rama desplegable, preservando QR. Rediseño de landing y sistema visual común para landing, app, panel, solicitar y formulario QR.
- Verificación: smoke local API contra servidor temporal en `:8394`: `/`, `/app`, `/panel`, `/solicitar`, `/health`, QR completo, OCR/manual, comprador `/app` y panel/dashboard OK.

