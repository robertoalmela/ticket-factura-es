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

## Healthcheck

```http
GET /health
```

Respuesta:

```json
{"ok": true}
```
