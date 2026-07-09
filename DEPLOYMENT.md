# Despliegue de TicketFactura

## VPS actual

- Host: Contabo `roberto-contabo`
- IP pública: `173.249.46.245`
- Ruta app: `/srv/apps/ticketfactura`
- Puerto interno: `127.0.0.1:8380`
- Proceso: Docker Compose `ticketfactura-app-1`
- Datos persistentes: `/srv/apps/ticketfactura/data/ticketfactura.db`
- Proxy público: Caddy (`/etc/caddy/Caddyfile`)

Mientras `ticket-factura.es` no tenga DNS apuntando al VPS, las URLs de prueba son:

```text
http://173.249.46.245/       # landing
http://173.249.46.245/demo   # ticket demo con formulario de factura
```

Cuando el dominio apunte al VPS, cambiar `BASE_URL` en `.env` a:

```text
https://ticket-factura.es
```

y añadir en Caddy:

```caddyfile
ticket-factura.es, www.ticket-factura.es {
    reverse_proxy 127.0.0.1:8380
}
```

## Variables obligatorias en producción

Ver `.env.example`.

```bash
NODE_ENV=production
PORT=8380
BASE_URL=https://ticket-factura.es
JWT_SECRET=<secreto-largo>
DATA_DIR=/srv/apps/ticketfactura/data
TRUST_PROXY=1
SMTP_HOST=<smtp>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<usuario>
SMTP_PASS=<password>
SMTP_FROM="TicketFactura <facturas@ticket-factura.es>"
```

## Despliegue manual en el VPS

```bash
ssh roberto-contabo
cd /srv/apps/ticketfactura
docker compose up -d --build
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Verificación

```bash
curl -fsS http://127.0.0.1:8380/health
curl -I http://173.249.46.245/
docker compose ps
docker compose logs --tail=80 app
```

Flujo e2e mínimo:

1. Crear comercio demo o real.
2. Crear ticket con `POST /api/tickets` usando `x-api-key`.
3. Abrir la URL `/f/<token>`.
4. Enviar NIF/nombre/email.
5. Confirmar que se crea factura con numeración `SERIE-AÑO-NNNN` y se manda email.

## Backups

La base importante es SQLite:

```text
/srv/apps/ticketfactura/data/ticketfactura.db
```

Backup rápido:

```bash
sqlite3 /srv/apps/ticketfactura/data/ticketfactura.db ".backup '/srv/backups/ticketfactura-$(date +%F).db'"
```
