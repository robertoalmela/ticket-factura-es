# TicketFactura

**Factura tu ticket con un QR.** El comercio imprime un QR en el ticket; el cliente escanea, pone su NIF una vez, y la factura (numeración legal consecutiva por comercio y año) le llega al email. Sin apps.

Producto separado de PrintQueue Pro — la copistería es el canal, no el dueño (ver `_INFORME/INFORME_foroapeme.md`... y la estrategia en el chat del 2026-07-04).

## Arrancar
```bash
npm install
npm run seed     # crea comercio demo y muestra su API key
npm start        # http://localhost:8380 (landing en /)
```

## Flujo (verificado e2e)
1. TPV/PrintQueue: `POST /api/tickets` con `x-api-key` → `{url}` (y `GET /api/qr?url=...` da el PNG para el ticket)
2. Cliente: abre `/f/<token>` → NIF+nombre+email (se recuerdan en su móvil) → `POST`
3. Emisión: numeración `SERIE-AÑO-NNNN` sin huecos (transacción+UNIQUE), email al cliente con copia al comercio, idempotente por ticket+NIF

## Configurar producción (.env)
`JWT_SECRET` (obligatorio), `BASE_URL`, `SMTP_HOST/PORT/USER/PASS/FROM` (sin SMTP: modo dev, loguea en vez de enviar).

## Pendiente (v2)
- PDF adjunto (el HTML ya es imprimible)
- Panel del comercio (listado de facturas, alta self-service)
- VeriFactu cuando aplique (la numeración ya es compatible)
- Integración como módulo de PrintQueue Pro
