# Plantilla para sistemas — SMTP rotación visor

Copiar y enviar a `auxsistemas@mercamio.com` (o canal interno).

---

**Asunto:** Habilitar SMTP para notificaciones automáticas — notificaciones.uaid@mercamio.com

Hola,

Necesitamos enviar correos automáticos desde el **visor de productividad** (servidor `app-server` / `192.168.35.232`) con la cuenta:

- **Cuenta:** notificaciones.uaid@mercamio.com  
- **Webmail:** funciona en https://correo.mercamio.com  
- **IMAP:** imap.mercamio.com (según documentación interna)

**Problema:** el envío por **SMTP autenticado** falla con:

```text
535 5.7.8 Error: authentication failed: authentication failure
```

Probado desde:

1. PC de desarrollo (red local)  
2. Servidor de aplicación `/opt/visor-productividad` (usuario `visor`)

Hosts y puertos probados sin éxito:

- `smtp.mercamio.com` — 587 y 465  
- `imap.mercamio.com` — 587 y 465  
- `correo.mercamio.com` — 587 y 465  

Usuario probado: `notificaciones.uaid@mercamio.com` (misma contraseña que webmail).

**Solicitud:**

1. ¿Pueden **habilitar SMTP autenticado** para esa cuenta en envío programático?  
2. O indicar **host, puerto y si requiere auth** para relay desde `192.168.35.232`.  
3. Si existe **relay interno en puerto 25** sin autenticación desde esa IP, confirmar host.

Uso: un correo diario (~08:00) con resumen de inventario/rotación por sede.

Gracias.
