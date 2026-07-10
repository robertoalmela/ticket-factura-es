# PROJECT_STATUS.md

> Estado vivo del proyecto. Mantener breve y útil para la próxima IA.

## Resumen

- Estado: MVP desplegado y usable en VPS; pendiente producción real con dominio + SMTP.
- Objetivo: convertir tickets de comercio en facturas solicitables por QR, sin app para el cliente.
- Usuario final: comercios/copisterías y clientes que necesitan factura de ticket.
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
- Demo QR: `/demo`
- Flujo subir ticket heredado: `/solicitar`
- Panel comercio demo: `/panel`

## Último estado conocido

- Fecha: 2026-07-10 23:47 CEST
- Qué funciona: landing, demo QR, flujo `/solicitar`, panel `/panel`, API tickets, buscador empresas, generación manual de factura, Docker healthcheck.
- Qué se corrigió: `TRUST_PROXY=1` ahora se aplica aunque el VPS esté en `NODE_ENV=development`, evitando errores `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` detrás de Caddy.
- Qué falta para producción: DNS `ticket-factura.es`/`www` hacia `173.249.46.245` y SMTP real.
- Bloqueos: sin SMTP real los emails se simulan con `jsonTransport`; no activar `NODE_ENV=production` hasta tener SMTP completo.

## Próximos pasos

1. Configurar DNS del dominio `ticket-factura.es` hacia el VPS.
2. Configurar SMTP real del dominio/correo.
3. Cambiar `BASE_URL` a `https://ticket-factura.es` y activar bloque Caddy definitivo.
