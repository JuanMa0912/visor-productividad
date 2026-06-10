# Pendientes de despliegue Linux - historico

Este archivo queda como nota historica de los problemas detectados el
**2026-06-01** durante la revision de una instancia servida por HTTP plano.

La guia operativa vigente esta en [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Estado actual

| Tema original | Estado al 2026-06-10 | Fuente vigente |
| --- | --- | --- |
| Loop de login por cookie `Secure` sobre HTTP | documentado como excepcion temporal | `docs/DEPLOYMENT.md` |
| Warning de Cross-Origin-Opener-Policy en HTTP | documentado como excepcion temporal | `docs/DEPLOYMENT.md` |
| CSP y exportaciones | el CSP actual incluye `'unsafe-eval'` en `next.config.ts` | `README.md`, `docs/DEPLOYMENT.md` |
| 401 de `/api/auth/heartbeat` en login | corregido: `PresenceHeartbeat` solo corre autenticado | `src/components/PresenceHeartbeat.tsx` |
| Limpieza de sesiones/logs | ya hay script y timer systemd versionados | `deploy/README.md` |

## Pendientes reales

- Migrar cualquier despliegue HTTP temporal a HTTPS.
- Confirmar que el servidor tenga aplicadas las migraciones de actividad y
  presencia (`20260520_*`, `20260526_*`).
- Confirmar que el timer `visor-cleanup-logs.timer` este activo si se requiere
  retencion corta de logs/sesiones.
