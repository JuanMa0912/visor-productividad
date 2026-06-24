# ETL de margenes (`cargar_margen.py`)

Carga el "movimiento unificado" (margen por linea de factura) desde las BD POS de
origen (**192.168.35.217**: mercamio / mtodo / bogota) a **`produXdia.margen_final`**
(192.168.35.232). Basado en `consulta_Movimiento_bd.py`.

- **Estrategia:** por cada empresa y dia → `DELETE (fecha_dcto, empresa)` + **COPY
  postgres->postgres** (formato texto, NULL-safe). Idempotente: re-correr no duplica.
- Carga **solo a local (232)**. La replicacion a GCP la hace el sync local->GCP
  (`sync-local-to-gcp.sh`, 07:50), que incluye `margen_final` en modo "replace"
  (borra-ventana + inserta, por no tener clave natural).
- Corre en el server (232) con `python3` del sistema (tiene `psycopg2-binary`; no hay venv).

## Config

Usa el **mismo `.env.etl`** que el sync (no tiene su propio archivo). Necesita:
- Destino: `DB_HOST_LOCAL / DB_PORT_LOCAL / DB_NAME_LOCAL / DB_USER_LOCAL / DB_PASSWORD_LOCAL`
  (= produXdia 232; ya estaban para el sync).
- Origen POS: `DB_HOST_POS / DB_PORT_POS / DB_PWD_POS_MERCAMIO / DB_PWD_POS_MTODO / DB_PWD_POS_BOGOTA`.

Ver `scripts/etl/env.etl.example`. La ruta del `.env.etl` se puede sobreescribir con
`ETL_ENV_FILE=/ruta/.env.etl`.

## Uso manual

```bash
cd /home/prodapp/visor-productividad
python3 scripts/etl/margen/cargar_margen.py                       # ayer
python3 scripts/etl/margen/cargar_margen.py --date 20260623       # un dia
python3 scripts/etl/margen/cargar_margen.py --desde 20260601 --hasta 20260623  # rango
python3 scripts/etl/margen/cargar_margen.py --date 20260623 --dry-run          # solo cuenta
```

Codigos de salida: `0` OK | `1` error | `2` uso invalido.

## Programacion (systemd)

Units en `deploy/systemd/`: `visor-etl-margen.{service,timer}` → **todos los dias 07:15**,
carga el dia anterior.

```bash
cd /home/prodapp/visor-productividad
sudo cp deploy/systemd/visor-etl-margen.service deploy/systemd/visor-etl-margen.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now visor-etl-margen.timer

systemctl list-timers 'visor-etl-*'
journalctl -u visor-etl-margen.service -n 80 --no-pager   # (con sudo si no ves nada)
sudo systemctl start visor-etl-margen.service             # correrlo a mano sin esperar
```

## CSV (desactivado)

El `consulta_Movimiento_bd.py` original genera CSVs a `\\192.168.35.236\...\
Analisis_Margen_Facturas_Diarias\YYYY\mes\` (diario unificado + rango mes-a-fecha por
sede). Este cargador **no** los genera; solo carga a la BD. Si en el futuro se quiere
volver a generar el CSV ademas de cargar, se agrega un paso que escriba el resultado del
COPY a un archivo (reusando `build_query`) antes del INSERT.
