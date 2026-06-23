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
- Al terminar refresca la matview de rotacion en GCP (refresh inline, no depende de scripts externos).

Corre en el server **192.168.35.232** (ve el local como `localhost` y alcanza GCP).

## 1. Requisitos (una sola vez)

1. **Autorizar la IP de salida del server en Cloud SQL.** En 192.168.35.232:
   ```bash
   curl -s https://api.ipify.org; echo
   ```
   Agrega esa IP (`/32`) en GCP -> SQL -> instancia -> Connections -> Networking ->
   Authorized networks. Si la IP del server es **dinamica**, usa Cloud SQL Auth Proxy.

2. **Config del ETL (UN solo archivo, nombres explicitos por extremo).** Crea
   `.env.etl` en la raiz del deploy a partir del template y ponle las claves:
   ```bash
   cd /home/prodapp/visor-productividad
   cp scripts/etl/env.etl.example .env.etl
   chmod 600 .env.etl
   nano .env.etl   # rellena DB_PASSWORD_LOCAL y DB_PASSWORD_GCP
   ```
   El archivo trae los dos extremos sin ambiguedad (`.env.etl` queda fuera de git
   por el patron `.env*`):
   ```bash
   # ORIGEN local
   DB_HOST_LOCAL=localhost
   DB_PORT_LOCAL=5432
   DB_NAME_LOCAL=produXdia          # X mayuscula (local)
   DB_USER_LOCAL=postgres
   DB_PASSWORD_LOCAL='clave_local'  # comillas simples si tiene $ u otros simbolos
   # DESTINO GCP
   DB_HOST_GCP=34.73.63.145
   DB_PORT_GCP=5432
   DB_NAME_GCP=produxdia            # minuscula (GCP)
   DB_USER_GCP=visor
   DB_PASSWORD_GCP='clave_gcp'
   # DB_SSL_GCP=require             # default ya es require para GCP
   ```
   El ETL **NO** usa el `.env.local`/`.env.production` de la app: todo sale de aqui,
   asi no se confunde local con GCP. El log imprime `Destino(GCP): ...` para confirmar.

3. `chmod +x scripts/etl/sync-local-to-gcp.sh`

## 2. Primer arranque (seguro)

Validar conexion y conteos **sin escribir** antes del primer upsert real:
```bash
sudo -u prodapp bash /home/prodapp/visor-productividad/scripts/etl/sync-local-to-gcp.sh --days 1 --dry-run
```
Si los conteos se ven bien, corre el real y verifica:
```bash
sudo -u prodapp bash /home/prodapp/visor-productividad/scripts/etl/sync-local-to-gcp.sh --verify
```

## 3. Programacion (systemd timers)

Units en `deploy/systemd/`:
- `visor-etl-sync.{service,timer}` -> **todos los dias 07:50**, sube ayer.
- `visor-etl-reconcile.{service,timer}` -> **domingos 16:00**, re-sube los ultimos 7 dias.

Instalar (como root):
```bash
cd /home/prodapp/visor-productividad
sudo cp deploy/systemd/visor-etl-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now visor-etl-sync.timer visor-etl-reconcile.timer
```

Ver estado / proximos disparos / logs:
```bash
systemctl list-timers 'visor-etl-*'
journalctl -u visor-etl-sync.service -n 80 --no-pager        # ver el diario
journalctl -u visor-etl-reconcile.service -n 80 --no-pager   # ver la reconciliacion
```

Probar el service a mano (sin esperar el timer):
```bash
sudo systemctl start visor-etl-sync.service
```

Notas:
- Los units corren como `prodapp` con `WorkingDirectory=/home/prodapp/visor-productividad`.
  Si tu deploy esta en otra ruta/usuario, edita los units antes de copiarlos.
- El diario sale 3 si no hay datos de ayer; el unit lo trata como exito
  (`SuccessExitStatus=3`) para no marcarse failed. La senal queda en el journal
  (lineas `WARNING`). Re-corre manual cuando el cierre del local termine.
- Reconciliacion de **7 dias**: atrapa correcciones de ~1 semana. Si necesitas
  cubrir correcciones que llegan 8-10 dias tarde, sube `--days` en el ExecStart de
  `visor-etl-reconcile.service`.

## 4. Corridas MANUALES (cuando falla, avisa o aun no hay datos)

Todas como `sudo -u prodapp bash /home/prodapp/visor-productividad/scripts/etl/sync-local-to-gcp.sh ...`:

| Situacion | Comando |
| --- | --- |
| Re-correr AYER (tras un fallo) | *(sin flags)* |
| Subir un dia puntual / backfill | `--date 2026-06-22` |
| Reconciliacion manual de N dias | `--days 7` |
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
- Logs: journal de systemd (`journalctl -u visor-etl-sync.service`); ademas
  `/var/log/visor-etl-sync.log` si el usuario tiene permiso de escritura ahi.
- El WARNING (exit 3) casi siempre significa: el cierre del local todavia no termino.
  Solucion: esperar y re-correr el comando default, o usar `--date`.

## 6. Notas

- Solo propaga **altas y cambios**, no borrados fisicos del origen (decision acordada).
- Si alguna vez quieres incluir `rotacion_v4` (tablero `/rotacion-dos`): hoy esa tabla
  **no existe en GCP**; habria que crearla alla y agregarla a la allowlist del script.
- Archivo en formato Unix (LF). Si lo editas en Windows, asegura `LF` (no CRLF) o el
  shebang fallara en Debian.
