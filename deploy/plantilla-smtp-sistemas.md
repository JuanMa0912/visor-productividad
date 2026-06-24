# Plantilla para sistemas — SMTP rotación visor

Copiar y enviar a `auxsistemas@mercamio.com` (o canal interno).

---

**Asunto:** Habilitar SMTP para notificaciones automáticas — notificaciones.uaid@mercamio.com

Hola,

Necesitamos enviar correos automáticos desde el **visor de productividad** (servidor `app-server` / `192.168.35.232`) con la cuenta:

- **Cuenta:** notificaciones.uaid@mercamio.com  
- **Webmail:** funciona en https://correo.mercamio.com  
- **IMAP:** imap.mercamio.com — puerto **3993** (referencia)  
- **SMTP:** smtp.mercamio.com — puerto **3465** (según sistemas)

**Problema previo:** el envío por **SMTP autenticado** fallaba con:

```text
535 5.7.8 Error: authentication failed: authentication failure
```

Probado antes en puertos estándar `587` / `465` sin éxito.

**Configuración objetivo en la VM:**

```env
SMTP_HOST=smtp.mercamio.com
SMTP_PORT=3465
SMTP_USER=notificaciones.uaid@mercamio.com
SMTP_TLS_REJECT_UNAUTHORIZED=false
```

**Solicitud (si aún falla con 3465):**

1. Confirmar que **SMTP autenticado** está habilitado para esa cuenta en el puerto **3465**.  
2. Indicar si el puerto requiere **STARTTLS** o **SSL directo** (`SMTP_SECURE=true`).  
3. Si existe **relay interno en puerto 25** sin autenticación desde `192.168.35.232`, confirmar host.

Uso: un correo diario (~08:00) con resumen de inventario/rotación por sede.

Gracias.
