# API TicketFactura

## Autenticación comercio

Las llamadas del TPV/PrintQueue usan la cabecera:

```http
x-api-key: tf_xxxxxxxxxxxxxxxxxxxxx
```

Cada comercio tiene una API key propia. Se crea con:

```bash
COMERCIO_NOMBRE="Copistería Centro" \
COMERCIO_NIF="B12345674" \
COMERCIO_DIRECCION="Calle Ejemplo 1, Elche" \
COMERCIO_EMAIL="facturas@example.com" \
COMERCIO_SERIE="CC" \
COMERCIO_SECUENCIA_PREVIA=0 \
COMERCIO_ANIO_PREVIO=2026 \
npm run commerce:create
```

## Crear ticket facturable

```http
POST /api/tickets
content-type: application/json
x-api-key: <api-key-del-comercio>
```

Body:

```json
{
  "total": 12.10,
  "concepto": "Fotocopias y encuadernación",
  "ticket_ref": "T-2026-000123",
  "tipo_iva": 21
}
```

Respuesta:

```json
{
  "url": "https://ticket-factura.es/f/<token>"
}
```

El `ticket_ref` debe ser único por comercio para que la emisión sea idempotente por `ticket_ref + NIF`.

## Generar QR PNG

```http
GET /api/qr?url=<url-codificada>
```

Devuelve `image/png`, listo para imprimir en el ticket.

## Flujo cliente

El cliente abre:

```text
/f/<token>
```

Envía:

```http
POST /f/<token>
content-type: application/json
```

```json
{
  "nif": "12345678Z",
  "nombre": "Cliente Prueba",
  "direccion": "Calle Test 1",
  "email": "cliente@example.com"
}
```

Respuesta:

```json
{
  "ok": true,
  "numero": "CC-2026-0001",
  "reenviada": false
}
```

## Factura HTML

El email incluye un enlace firmado:

```text
/factura/<id>/html?token=<token>
```

Ese endpoint no es público sin token.

## Flujo recuperado del proyecto anterior

### Buscar empresas

```http
GET /api/companies/search?q=copi
```

Respuesta:

```json
[
  {"id":1,"name":"Copistería Demo","nif":"B00000000","address":"Calle Ejemplo 1","email":"copisteria@example.com","serie":"TF-DEMO"}
]
```

### OCR de ticket

```http
POST /api/invoices/ocr
content-type: multipart/form-data
image=<archivo>
```

Si no hay `OCR_API_KEY`, responde sin fallar:

```json
{"enabled":false,"message":"OCR no configurado todavía. Rellena importe, fecha y empresa manualmente."}
```

### Solicitud manual/subida de ticket

```http
POST /api/invoices/request
content-type: application/json
```

```json
{
  "companyId": 1,
  "clientData": {"nif":"12345678Z","name":"Cliente","email":"cliente@example.com","address":"Calle 1"},
  "total": 14.52,
  "concepto": "Venta",
  "ticket_ref": "MANUAL-001",
  "tipo_iva": 21
}
```

Genera factura usando la misma numeración legal e idempotencia que el flujo QR.

### Panel comercio

```http
GET /api/dashboard?api_key=<api-key>
GET /api/invoices/approved?api_key=<api-key>
```

`/panel` consume estos endpoints desde navegador.

## API del comprador (flujo principal `/app`)

Sesión por cookie httpOnly `tf_comprador` (JWT, 180 días). Todas las rutas devuelven `401` sin sesión.

### Registro y sesión

```http
POST /api/comprador/registro   {"email","password","nif","nombre","direccion"}
POST /api/comprador/login      {"email","password"}
POST /api/comprador/logout
GET  /api/comprador/me
PUT  /api/comprador/perfil     {"nif","nombre","direccion"}
```

`registro` y `login` fijan la cookie de sesión. La contraseña se guarda con scrypt.

### Leer un ticket fotografiado

```http
POST /api/invoices/ocr    (multipart, campo "image")
```

Devuelve `companyName`, `nif`, `address`, `email`, `date`, `amount` y `taxRate` detectados (o `enabled:false` si no hay `OCR_API_KEY`; el flujo sigue en manual).

### Emitir factura desde un ticket

```http
POST /api/comprador/factura
content-type: application/json
```

Body:

```json
{
  "vendedor": {"nif": "B12345674", "nombre": "Bar Manolo", "direccion": "opcional", "email": "obligatorio si no está registrado"},
  "total": "18,50",
  "tipo_iva": 21,
  "fecha": "2026-07-09",
  "ticket_ref": "BAR-77",
  "concepto": "Menú del día"
}
```

- **Vendedor registrado** (por NIF): factura inmediata con su serie real → `{ok, estado:"FACTURADA", numero, reenviada, factura_url, message}`. Email al comprador con copia (`cc`) al vendedor. Idempotente por `ticket_ref` + comprador.
- **Vendedor sin registrar**: requiere `vendedor.email` (si falta → `400` con `necesita_email_vendedor: true`). Crea/actualiza una solicitud `PENDIENTE` y envía email de invitación al vendedor → `{ok, estado:"PENDIENTE_VENDEDOR", reenviada, message}`.

### Alta de vendedor por invitación

```http
GET  /vendedor/alta/<token>    → formulario de alta (token JWT firmado, 30 días)
POST /vendedor/alta/<token>    {"nombre","direccion","email"}
```

Crea el comercio con serie `TF-<NIF>` y emite automáticamente todas las solicitudes pendientes de ese NIF, enviando cada factura a su comprador con copia al vendedor. Respuesta: `{ok, comercio:{nombre,nif,serie}, api_key, facturas_emitidas, panel_url, message}`.

### Historial del comprador

```http
GET /api/comprador/facturas
```

Devuelve `{facturas: [...], pendientes: [...]}` — facturas emitidas (con `url` firmada) y solicitudes aún pendientes del alta del vendedor.

## Healthcheck

```http
GET /health
```

Respuesta:

```json
{"ok": true}
```
