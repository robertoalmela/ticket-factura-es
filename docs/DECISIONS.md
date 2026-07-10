# DECISIONS.md

Decisiones durables del proyecto.

## Decisiones

<!-- DECISIONS:START -->

### 2026-07-10 — Trust proxy configurable fuera de producción

El VPS usa Caddy delante de la app y mantiene `NODE_ENV=development` mientras no hay SMTP real, para que el envío de emails siga simulado. Aun así, Caddy añade `X-Forwarded-For`; por eso `TRUST_PROXY=1` debe activar `app.set('trust proxy', 1)` aunque `NODE_ENV` no sea `production`. No volver a condicionar `trust proxy` solo a producción mientras exista modo demo detrás de Caddy.

### 2026-07-10 — Producción real depende de SMTP

`NODE_ENV=production` exige `BASE_URL`, `JWT_SECRET`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM`. Hasta tener SMTP del dominio, mantener despliegue en modo demo/desarrollo con `JWT_SECRET` real y `BASE_URL` de preview.

<!-- DECISIONS:END -->
