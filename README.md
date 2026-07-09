# TicketFactura

**Factura tu ticket con un QR.** El comercio imprime un QR en el ticket; el cliente escanea, pone su NIF una vez, y la factura (numeración legal consecutiva por comercio y año) le llega al email. Sin apps.

Producto separado de PrintQueue Pro — la copistería es el canal, no el dueño (ver `_INFORME/INFORME_foroapeme.md`... y la estrategia en el chat del 2026-07-04).

## Arrancar
```bash
npm install
npm run seed     # crea comercio demo y muestra su API key
npm start        # http://localhost:8380 (landing en /)
```

## Flujos (verificados e2e)

### QR / TPV — MVP principal
1. TPV/PrintQueue: `POST /api/tickets` con `x-api-key` y `ticket_ref` único → `{url}` (y `GET /api/qr?url=...` da el PNG para el ticket)
2. Cliente: abre `/f/<token>` → NIF+nombre+email (se recuerdan en su móvil) → `POST`
3. Emisión: numeración `SERIE-AÑO-NNNN` sin huecos (transacción+UNIQUE), email al cliente con copia al comercio, idempotente por ticket+NIF

### Flujo recuperado del proyecto anterior
- `/solicitar`: subir foto del ticket, OCR opcional, buscador de empresa, datos fiscales del cliente y generación de factura.
- `/panel`: panel simple del comercio con métricas, facturas recientes y generación de ticket QR de prueba mediante API key.
- Endpoints compatibles: `/api/companies/search`, `/api/invoices/ocr`, `/api/invoices/request`, `/api/dashboard`, `/api/invoices/approved`.

## Configurar producción (.env)
Ver `.env.example`. En `NODE_ENV=production` son obligatorios `JWT_SECRET`, `BASE_URL`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM`.

Recomendado en VPS: ejecutar la app detras de Nginx/Caddy con HTTPS, poner `DATA_DIR` en un volumen persistente y configurar backups diarios de la base SQLite.

Crear un comercio real:
```bash
COMERCIO_NOMBRE="Copisteria Centro" COMERCIO_NIF="B12345674" COMERCIO_DIRECCION="Calle..." COMERCIO_EMAIL="facturas@dominio.com" COMERCIO_SERIE="CC" npm run commerce:create
```

El script muestra la API key que debe usar el TPV/PrintQueue en `x-api-key`.

## Documentación

- [`docs/API.md`](docs/API.md): endpoints para TPV/PrintQueue, QR, flujo cliente y healthcheck.
- [`DEPLOYMENT.md`](DEPLOYMENT.md): despliegue en VPS Contabo, PM2/Caddy, variables de entorno y backups.
- `.env.example`: plantilla de configuración de producción.

## Comandos útiles

```bash
npm ci
npm run seed
npm start
```

Comprobar salud:

```bash
curl http://localhost:8380/health
```

## Despliegue actual de prueba

El VPS Contabo de Roberto ejecuta la app en `/srv/apps/ticketfactura` detrás de Caddy.

- URL temporal hasta configurar DNS: `http://173.249.46.245/`
- Ticket demo para probar formulario: `http://173.249.46.245/demo`
- Dominio previsto: `ticket-factura.es`

## Pendiente (v2)
- PDF adjunto (el HTML ya es imprimible)
- Login/autoservicio completo del comercio (ahora `/panel` usa API key)
- VeriFactu cuando aplique (la numeración ya es compatible)
- Integración como módulo de PrintQueue Pro
