# ETL de margenes (`cargar_margen.py`)

Carga el "movimiento unificado" (margen por linea de factura) desde las BD POS de
origen (**192.168.35.217**: mercamio / mtodo / bogota) a **`produXdia.margen_final`**
(192.168.35.232). Basado en `consulta_Movimiento_bd.py`.

- **Estrategia:** por cada empresa y dia → `DELETE (fecha_dcto, empresa)` + **COPY
  postgres->postgres** (formato texto, NULL-safe). Idempotente: re-correr no duplica.
- Carga a **local (232)** siempre; con `--gcp` tambien a **GCP** (mismo COPY del POS,
  una lectura y dos escrituras, borra-dia+inserta en ambos lados).
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
python3 scripts/etl/margen/cargar_margen.py                       # ayer, solo local
python3 scripts/etl/margen/cargar_margen.py --gcp                 # ayer, local + GCP
python3 scripts/etl/margen/cargar_margen.py --date 20260623 --gcp # un dia, local + GCP
python3 scripts/etl/margen/cargar_margen.py --desde 20260601 --hasta 20260623 --gcp  # rango
python3 scripts/etl/margen/cargar_margen.py --date 20260623 --dry-run             # solo cuenta
```

`--gcp` toma las credenciales de GCP de `DB_*_GCP` (mismo `.env.etl`). Si GCP no
conecta, sigue cargando solo local (avisa con WARN). Si GCP conecta pero falla la
carga (p.ej. la tabla no existe alla), aborta con error 1.

Codigos de salida: `0` OK | `1` error | `2` uso invalido.

## Subir a GCP (una vez)

Antes de usar `--gcp`, crea `margen_final` en GCP (igual que en local). Desde 232:
```bash
PGPASSWORD='LA_CLAVE_GCP' psql "host=34.73.63.145 port=5432 dbname=produxdia user=visor sslmode=require" \
  -f db/migrations/20260622_margen_final.sql
```
Idempotente (`CREATE TABLE/INDEX IF NOT EXISTS`). Despues, `--gcp` carga a ambos.

## Programacion (systemd)

Units en `deploy/systemd/`: `visor-etl-margen.{service,timer}` → **todos los dias 07:15**,
carga el dia anterior a **local Y GCP** (el `ExecStart` usa `--gcp`).

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
