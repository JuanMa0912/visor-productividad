# Pendientes detectados en el despliegue Linux

> Detectados el 2026-06-01 mientras revisabamos errores de consola en la
> instancia desplegada por HTTP plano.

## Resumen rapido

| # | Problema | Estado del codigo | Lo que tienes que hacer |
|---|---|---|---|
| 1 | Warning de Cross-Origin-Opener-Policy | Switch agregado | Setear `COOP_DISABLED=true` en `.env` y reiniciar |
| 2 | CSP bloquea `unsafe-eval` (rompe exportaciones) | Switch ya existia | Setear `CSP_UNSAFE_EVAL=true` en `.env` y reiniciar |
| 3 | 401 en `/api/auth/heartbeat` | **Arreglado** en codigo | Hacer deploy del fix |
| 4 | **Loop infinito en login** (cookie Secure sobre HTTP) | Switch ya existia | Setear `SESSION_COOKIE_SECURE=false` en `.env` y reiniciar |

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

## 4. Loop infinito en `/login` (cookie Secure rechazada en HTTP)

**Sintoma:** El usuario ingresa credenciales correctas en `/login`, el server
responde OK, pero el browser inmediatamente redirige de vuelta a
`/login?from=/secciones`. Pareciera que el login no funciona.

**Causa identificada:** En produccion (`NODE_ENV=production`) la cookie de
sesion `vp_session` se emite con el flag `Secure`. Ese flag le dice al
navegador "esta cookie solo se acepta en HTTPS". Como el server esta
sirviendo por HTTP plano, **el navegador descarta la cookie silenciosamente**.
Sin cookie, el proxy del proximo request detecta "no hay sesion" y redirige
otra vez al login -> bucle infinito.

**Severidad:** Critica. **Bloquea completamente el acceso al portal.**

**Fix:**

En el `.env` del servidor agregar:

```bash
SESSION_COOKIE_SECURE=false
```

Esto fuerza a que la cookie se emita SIN el flag `Secure`, lo que la hace
aceptable en HTTP.

**Trade-off de seguridad:** sin HTTPS, las cookies viajan en texto plano
de todas formas. Marcarlas como `Secure` no las hace mas seguras en HTTP,
solo las hace inutilizables. La proteccion real viene de HTTPS.

**Cuando habilitar HTTPS:** revertir a `SESSION_COOKIE_SECURE=true` (o
simplemente quitar la linea para que use el default de produccion).

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

   Agregar (o cambiar) estas TRES lineas:

   ```bash
   SESSION_COOKIE_SECURE=false
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
