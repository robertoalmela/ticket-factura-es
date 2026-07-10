# AI_WORKLOG.md

Bitácora de trabajo de agentes IA. Añadir entradas arriba, bajo "Últimas entradas".

## Últimas entradas

<!-- AI_WORKLOG:START -->

### 2026-07-10 23:47 CEST — Hermes / gpt-5.5

- Resumen: revisión de TicketFactura local/VPS/GitHub; detectado error repetido de `express-rate-limit` por `X-Forwarded-For` detrás de Caddy; corregido `trust proxy` para respetar `TRUST_PROXY=1` también en modo demo/desarrollo.
- Archivos tocados: `src/server.js`, `public/favicon.ico`, `PROJECT_STATUS.md`, `docs/AI_WORKLOG.md`, `docs/DECISIONS.md`.
- Verificación local: seed en `/tmp/ticketfactura-smoke`; `/health`, `/`, `/demo`, `/solicitar`, `/panel`, `/favicon.ico`, `/api/companies/search`, `/api/dashboard`, `/api/tickets` y `/api/invoices/request` OK; logs sin `ERR_ERL`.
- Verificación VPS: Docker Compose build/restart, curl de rutas principales, API dashboard y factura manual OK; navegador real en `/panel` sin errores propios tras añadir favicon.
- Siguiente paso: configurar DNS + SMTP para pasar de demo a producción real.

<!-- AI_WORKLOG:END -->
