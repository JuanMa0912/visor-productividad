# Documentacion tecnica

Indice principal de documentacion tecnica para `visor-productividad`.

## Objetivo

Esta carpeta organiza la documentacion operativa y tecnica del proyecto en referencias separadas por dominio para reducir duplicidad y facilitar mantenimiento.

## Navegacion

| Documento | Uso |
| --- | --- |
| [arquitectura.md](./arquitectura.md) | vista general del sistema, modulos, capas y rutas |
| [accesos-y-seguridad.md](./accesos-y-seguridad.md) | autenticacion, permisos, sesiones y controles |
| [integraciones-y-datos.md](./integraciones-y-datos.md) | fuentes de datos, endpoints e integraciones tecnicas |
| [operacion-local-y-base-de-datos.md](./operacion-local-y-base-de-datos.md) | setup local, variables de entorno, migraciones y scripts |
| [documentacion-tecnica-preliminar.md](./documentacion-tecnica-preliminar.md) | bitacora de levantamiento, gaps y preguntas abiertas |

## Ruta sugerida de lectura

1. Leer [arquitectura.md](./arquitectura.md) para entender la forma general del sistema.
2. Continuar con [accesos-y-seguridad.md](./accesos-y-seguridad.md) si el foco es autenticacion o permisos.
3. Ir a [integraciones-y-datos.md](./integraciones-y-datos.md) para revisar tablas, fuentes y comportamiento de cada modulo.
4. Usar [operacion-local-y-base-de-datos.md](./operacion-local-y-base-de-datos.md) para preparar entorno o revisar migraciones.
5. Cerrar con [documentacion-tecnica-preliminar.md](./documentacion-tecnica-preliminar.md) para ver pendientes de validacion.

## Alcance actual

Documentacion basada en el codigo versionado a 2026-03-18. No reemplaza validaciones de negocio, infraestructura o despliegue que no esten representadas en este repositorio.

## Mantenimiento

Actualizar esta carpeta cuando ocurra alguno de estos cambios:

- se agregue o elimine un tablero
- cambie el modelo de permisos o sesiones
- cambien tablas, migraciones o variables de entorno
- se agregue una integracion externa
- cambie la estrategia de cache, exportacion o despliegue
