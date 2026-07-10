# DECISIONS.md

Decisiones durables del proyecto.

## Decisiones

<!-- DECISIONS:START -->

### 2026-07-10 — Pivote a flujo comprador-céntrico

El producto principal pasa a ser la app del comprador (`/app`): el autónomo se registra una vez con sus datos fiscales, fotografía el ticket y la app gestiona la factura. Decisiones asociadas:

- **Solo facturan vendedores registrados** (decisión de Roberto, 2026-07-10): nada de emitir "en nombre de" un comercio que no ha dado su consentimiento. Si el NIF del ticket no coincide con ningún comercio, la solicitud queda `PENDIENTE` y el vendedor recibe un email de invitación con enlace de alta firmado (JWT, 30 días). Al completar el alta se emiten automáticamente todas sus solicitudes pendientes (de cualquier comprador) y cada parte recibe su copia. Se descartó el alta automática de vendedores por el riesgo legal de la facturación por destinatario sin acuerdo previo (art. 5 RD 1619/2012).
- **Email del vendedor obligatorio si no está registrado**: sin email no hay invitación posible; la UI lo pide explícitamente (el OCR intenta detectarlo del ticket).
- **Coincidencia por NIF**: si el vendedor ya está registrado (QR/alta manual/invitación), la factura sale con su serie real — el mismo comercio nunca tiene dos series. Los vendedores por invitación reciben serie `TF-<NIF>` y su API key del panel.
- **Auth comprador sin dependencias nuevas**: scrypt de Node para contraseñas y cookie httpOnly con JWT (180 días). Sin verificación de email mientras no haya SMTP real.
- **El flujo QR se mantiene** como producto para comercios adheridos: ambos conviven y comparten numeración y emisión.

### 2026-07-10 — Trust proxy configurable fuera de producción

El VPS usa Caddy delante de la app y mantiene `NODE_ENV=development` mientras no hay SMTP real, para que el envío de emails siga simulado. Aun así, Caddy añade `X-Forwarded-For`; por eso `TRUST_PROXY=1` debe activar `app.set('trust proxy', 1)` aunque `NODE_ENV` no sea `production`. No volver a condicionar `trust proxy` solo a producción mientras exista modo demo detrás de Caddy.

### 2026-07-10 — Producción real depende de SMTP

`NODE_ENV=production` exige `BASE_URL`, `JWT_SECRET`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM`. Hasta tener SMTP del dominio, mantener despliegue en modo demo/desarrollo con `JWT_SECRET` real y `BASE_URL` de preview.

<!-- DECISIONS:END -->
