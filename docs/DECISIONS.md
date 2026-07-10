# DECISIONS.md

Decisiones durables del proyecto.

## Decisiones

<!-- DECISIONS:START -->

### 2026-07-10 — Pivote a flujo comprador-céntrico

El producto principal pasa a ser la app del comprador (`/app`): el autónomo se registra una vez con sus datos fiscales, fotografía el ticket y la app emite la factura detectando al vendedor. Decisiones asociadas:

- **Vendedores auto-creados**: si el NIF del ticket no coincide con ningún comercio, se crea uno automáticamente (`auto_creado=1`) con serie derivada del NIF (`TF-<NIF>`), numeración propia desde 0001 y sin acceso al panel. Si un comprador aporta email/dirección que faltaban, se completan. Cuando el comercio "reclame" su cuenta (v2), hereda su serie e historial.
- **Coincidencia por NIF**: si el vendedor ya está registrado (QR/alta manual), la factura sale con su serie real — el mismo comercio nunca tiene dos series.
- **Facturación por destinatario**: las facturas de vendedores auto-creados llevan la mención "expedida por el destinatario (art. 5 RD 1619/2012)". Para cumplimiento estricto haría falta acuerdo previo del vendedor; asumido como riesgo aceptable de MVP.
- **Auth comprador sin dependencias nuevas**: scrypt de Node para contraseñas y cookie httpOnly con JWT (180 días). Sin verificación de email mientras no haya SMTP real.
- **El flujo QR se mantiene** como producto para comercios adheridos: ambos conviven y comparten numeración y emisión.

### 2026-07-10 — Trust proxy configurable fuera de producción

El VPS usa Caddy delante de la app y mantiene `NODE_ENV=development` mientras no hay SMTP real, para que el envío de emails siga simulado. Aun así, Caddy añade `X-Forwarded-For`; por eso `TRUST_PROXY=1` debe activar `app.set('trust proxy', 1)` aunque `NODE_ENV` no sea `production`. No volver a condicionar `trust proxy` solo a producción mientras exista modo demo detrás de Caddy.

### 2026-07-10 — Producción real depende de SMTP

`NODE_ENV=production` exige `BASE_URL`, `JWT_SECRET`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM`. Hasta tener SMTP del dominio, mantener despliegue en modo demo/desarrollo con `JWT_SECRET` real y `BASE_URL` de preview.

<!-- DECISIONS:END -->
