# Pendientes detectados en el despliegue Linux

> Detectados el 2026-06-01 mientras revisabamos errores de consola en la
> instancia desplegada por HTTP plano.

## Resumen rapido

| # | Problema | Estado del codigo | Lo que tienes que hacer |
|---|---|---|---|
| 1 | Warning de Cross-Origin-Opener-Policy | Switch agregado | Setear `COOP_DISABLED=true` en `.env` y reiniciar |
| 2 | CSP bloquea `unsafe-eval` (rompe exportaciones) | Switch ya existia | Setear `CSP_UNSAFE_EVAL=true` en `.env` y reiniciar |
| 3 | 401 en `/api/auth/heartbeat` | **Arreglado** en codigo | Hacer deploy del fix |

Todos los cambios de `.env` requieren reiniciar el proceso (systemd / pm2 / npm).

---

## 1. Warning de Cross-Origin-Opener-Policy

**Sintoma en consola del browser:**

```
The Cross-Origin-Opener-Policy header has been ignored, because the URL's
origin was untrustworthy. It was defined either in the final response or
a redirect. Please deliver the response using the HTTPS protocol.
```

**Causa:** COOP solo funciona sobre HTTPS (o `localhost`). El servidor
esta sirviendo por HTTP plano, asi que el navegador descarta el header
y muestra el warning.

**Severidad:** Bajo. Es un warning, no rompe nada. Pero es ruido en
consola que confunde al diagnosticar otros problemas.

**Fix temporal (sin HTTPS):**

En el `.env` del servidor agregar:

```bash
COOP_DISABLED=true
```

Esto hace que el header se envie como `unsafe-none`, que el navegador
acepta sin protestar.

**Fix definitivo (con HTTPS):** dejar `COOP_DISABLED=false` (o quitar
la variable) una vez que el portal se sirva por HTTPS. Para HTTPS:

- Instalar nginx delante del Next.
- Pedir certificado a Let's Encrypt con `certbot --nginx`.
- Configurar nginx para hacer reverse proxy a Next con `proxy_pass`.
- En GCP Cloud Run o App Engine, HTTPS viene activado por defecto.

---

## 2. CSP bloquea `unsafe-eval`

**Sintoma en consola:**

```
Evaluating a string as JavaScript violates the following Content Security
Policy directive because content.js:1 'unsafe-eval' is not an allowed
source of script: "script-src 'self' 'unsafe-inline'". The action has
been blocked.
```

**Causa:** Librerias de terceros usan `eval` / `new Function()`
internamente. Verificado que el codigo propio NO usa eval. Los culpables
son:

- `@mui/x-charts` + `@emotion/react`: Emotion compila estilos con
  `new Function`. Lo usa la pantalla `ventas-x-item`.
- `exceljs`: usa `Function` para templates de celda. Lo usan todas
  las exportaciones a Excel.
- `jspdf` + `jspdf-autotable`: parser interno usa eval. Lo usan
  todas las exportaciones a PDF.
- `animejs`: compilador de animaciones.

**Severidad:** Alta. Probablemente las exportaciones a Excel y PDF
fallan silenciosamente en produccion.

**Fix:**

En el `.env` del servidor cambiar:

```bash
CSP_UNSAFE_EVAL=true
```

**Trade-off de seguridad:** permitir `unsafe-eval` reduce la defensa
contra ataques XSS que inyecten codigo. En este portal el riesgo es
acotado porque:

- Es interno (requiere login).
- `unsafe-inline` ya esta permitido por las animaciones y estilos.
- Las librerias que usan eval son legitimas y mantenidas.

La alternativa seria reemplazar MUI Charts, ExcelJS y jsPDF, lo que es
una migracion de varias semanas.

---

## 3. 401 en `/api/auth/heartbeat`

**Sintoma en consola:**

```
Failed to load resource: the server responded with a status of 401
(Unauthorized) :5600/api/auth/heartbeat:1
```

**Causa identificada:** El componente `<PresenceHeartbeat />` esta
montado en el `RootLayout`, asi que se ejecutaba tambien en
`/login` (cuando todavia no hay sesion). El POST al heartbeat
devolvia 401 (correcto, porque no hay cookie de sesion).

**Solucion aplicada:** El componente ahora consume `useAuth()` y solo
dispara peticiones cuando `status === "authenticated"`. Cambios en
`src/components/PresenceHeartbeat.tsx`.

**Severidad:** Media. No afectaba el flujo normal del usuario, pero
ensuciaba la consola y consumia ciclos del backend para nada.

**Que tienes que hacer:** simplemente desplegar el codigo actualizado.

---

## Plan ordenado de aplicacion

1. Editar `.env` del servidor Linux:

   ```bash
   ssh tu-servidor
   cd /ruta/al/portal
   nano .env
   ```

   Agregar (o cambiar) estas dos lineas:

   ```bash
   CSP_UNSAFE_EVAL=true
   COOP_DISABLED=true
   ```

2. Hacer pull del codigo con el fix del heartbeat:

   ```bash
   git pull origin main
   npm install        # solo si cambiaron dependencias (no es el caso)
   npm run build      # rebuild de Next con las nuevas env vars
   ```

3. Reiniciar el proceso:

   ```bash
   # con pm2:
   pm2 restart visor-productividad

   # con systemd:
   sudo systemctl restart nombre-del-servicio
   ```

4. Validar en el browser (Ctrl+Shift+R para descartar cache):
   - Abrir DevTools -> Console.
   - Los 3 errores deberian haber desaparecido.
   - Probar una exportacion a Excel o PDF para confirmar que ya no se
     bloquean.
