# ETL local -> GCP (`sync-local-to-gcp.sh`)

Sube el dia a dia de las tablas de **hechos** desde el Postgres **local**
(`192.168.35.232`, `produXdia`) a **Cloud SQL** (`produxdia`).

- **Estrategia:** UPSERT por clave natural (`INSERT ... ON CONFLICT DO UPDATE`).
  No borra; las PK/UNIQUE son identicas en ambos lados, asi que **no puede duplicar**.
- **Tablas (allowlist):** `ventas_cajas`, `ventas_fruver`, `ventas_carnes`,
  `ventas_asadero`, `ventas_pollo_pesc`, `ventas_industria`,
  `rotacion_base_item_dia_sede`, `asistencia_horas`.
- **No toca:** tablas de estado de la app (usuarios, sesiones, `rotacion_cero_*`,
  `rotacion_abcd_*`, horarios, presets), matviews, `margenes_*` (local vacio) ni
  `ventas_item_diario` (lo maneja un ETL aparte del local).
- Al terminar refresca la matview de rotacion en GCP (reusa `refresh-rotacion-matview.sh`).

Corre en el server **192.168.35.232** (ve el local como `localhost` y alcanza GCP).

## 1. Requisitos (una sola vez)

1. **Autorizar la IP de salida del server en Cloud SQL.** En 192.168.35.232:
   ```bash
   curl -s https://api.ipify.org; echo
   ```
   Agrega esa IP (`/32`) en GCP -> SQL -> instancia -> Connections -> Networking ->
   Authorized networks. Si la IP del server es **dinamica**, usa Cloud SQL Auth Proxy.

2. **Credenciales del DESTINO (GCP):** ya estan en el env de produccion del deploy
   (vars `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`). El script lo
   autodetecta en la raiz: prueba `.env.local`, luego `.env.production`, luego `.env`.
   Si tu archivo tiene otro nombre/ruta, pasalo con `ENV_FILE=$PWD/.env.production`.
   Revisa la linea `ENV destino:` y `Destino:` del log para confirmar que apunta a GCP.

3. **Credenciales del ORIGEN (local):** crear `/home/prodapp/visor-productividad/.env.etl`
   (queda fuera de git por el patron `.env*`):
   ```bash
   SRC_DB_HOST=localhost
   SRC_DB_PORT=5432
   SRC_DB_NAME=produXdia
   SRC_DB_USER=postgres
   SRC_DB_PASSWORD=*** la clave del postgres local ***
   # SRC_DB_SSL=disable   # opcional; default disable para localhost
   ```
   Protegerlo: `chmod 600 /home/prodapp/visor-productividad/.env.etl`

4. `chmod +x scripts/etl/sync-local-to-gcp.sh`

## 2. Primer arranque (seguro)

Validar conexion y conteos **sin escribir** antes del primer upsert real:
```bash
sudo -u prodapp bash /home/prodapp/visor-productividad/scripts/etl/sync-local-to-gcp.sh --days 1 --dry-run
```
Si los conteos se ven bien, corre el real y verifica:
```bash
sudo -u prodapp bash /home/prodapp/visor-productividad/scripts/etl/sync-local-to-gcp.sh --verify
```

## 3. Cron (automatico)

`crontab -e` del usuario `prodapp` (el local cierra ~7:45am; corremos 8:00am):
```cron
# Diario (dom a vie): solo el dia anterior, rapido
0 8 * * 0-5 bash /home/prodapp/visor-productividad/scripts/etl/sync-local-to-gcp.sh >> /var/log/visor-etl-sync.log 2>&1
# Sabado: reconciliacion de los ultimos 18 dias (atrapa correcciones de hasta ~10 dias)
0 8 * * 6   bash /home/prodapp/visor-productividad/scripts/etl/sync-local-to-gcp.sh --days 18 >> /var/log/visor-etl-sync.log 2>&1
```
La ventana de 18 dias = 10 (lag de correccion) + 7 (cadencia semanal) + holgura.
Con 7 dias se escaparian correcciones que llegan 8-10 dias tarde.

## 4. Corridas MANUALES (cuando falla, avisa o aun no hay datos)

Todas como `sudo -u prodapp bash /home/prodapp/visor-productividad/scripts/etl/sync-local-to-gcp.sh ...`:

| Situacion | Comando |
| --- | --- |
| Re-correr AYER (tras un fallo) | *(sin flags)* |
| Subir un dia puntual / backfill | `--date 2026-06-22` |
| Reconciliacion manual de N dias | `--days 18` |
| Probar sin escribir (solo conteos) | `--days 7 --dry-run` |
| Mas rapido, sin refrescar matview | `--no-refresh` |
| Con verificacion de frescura al final | `--verify` |
| Ayuda | `--help` |

Ejemplos:
```bash
# El job de las 8am aviso "sin datos de ayer" porque el local no habia terminado.
# Espera a que termine el cierre y re-corre (vuelve a hacer ayer, idempotente):
sudo -u prodapp bash /home/prodapp/visor-productividad/scripts/etl/sync-local-to-gcp.sh --verify

# Falto un dia especifico (p.ej. el server estuvo caido):
sudo -u prodapp bash /home/prodapp/visor-productividad/scripts/etl/sync-local-to-gcp.sh --date 2026-06-20

# Reconciliacion puntual mas amplia (un mes):
sudo -u prodapp bash /home/prodapp/visor-productividad/scripts/etl/sync-local-to-gcp.sh --days 31
```

Re-correr es **siempre seguro**: el upsert no duplica ni borra; vuelve a dejar el
estado correcto.

## 5. Codigos de salida y logs

- `0` OK · `3` WARNING (sin datos de ayer en las tablas canary) · `1` ERROR · `2` uso invalido.
- Log: `/var/log/visor-etl-sync.log`.
- El WARNING (exit 3) casi siempre significa: el cierre del local todavia no termino.
  Solucion: esperar y re-correr el comando default, o usar `--date`.

## 6. Notas

- Solo propaga **altas y cambios**, no borrados fisicos del origen (decision acordada).
- Si alguna vez quieres incluir `rotacion_v4` (tablero `/rotacion-dos`): hoy esa tabla
  **no existe en GCP**; habria que crearla alla y agregarla a la allowlist del script.
- Archivo en formato Unix (LF). Si lo editas en Windows, asegura `LF` (no CRLF) o el
  shebang fallara en Debian.
