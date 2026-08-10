# Pipeline de Ventas - Mercamio

## 📋 Descripción

Pipeline automatizado para la carga diaria y validación mensual de ventas desde múltiples fuentes (mercamio, mtodo, bogota) hacia la base de datos consolidada `produXdia`.

## 🏗️ Arquitectura

```
/opt/ventas_pipeline/
├── config/
│   └── pipeline_config.yaml    # Configuración central
├── etl/
│   ├── fruver_ventas_rango.py
│   ├── carnes_ventas_rango.py
│   ├── pollo_pesc_ventas_rango.py
│   ├── industria_ventas_rango.py
│   ├── asadero_ventas_rango.py
│   └── cajas_ventas_rango.py
├── scripts/
│   ├── pipeline_orchestrator.py  # Orquestador principal
│   ├── etl_runner.py             # Ejecutor de ETLs con reintentos
│   └── pipeline_utils.py         # Utilidades comunes
└── logs/
    ├── orchestrator_YYYYMMDD.log
    └── report_*.json
```

## ⚙️ Funcionalidades

### 1. Carga Diaria (07:00 AM)
- Ejecuta automáticamente todos los ETLs para las **ventas del día anterior**
- ETLs en paralelo: fruver, carnes, pollo_pesc, industria, asadero
- ETL secuencial (pesado): cajas
- Reintentos automáticos: hasta 3 intentos por ETL
- Timeout: 30 minutos por ETL

### 2. Validación Mensual (14:00 PM - Semanas 1 y 3)
- Reprocesa todo el mes actual (del día 1 hasta ayer)
- Se ejecuta cada 2 semanas (semanas 1 y 3 de cada mes)
- Asegura integridad de datos históricos
- Mismo proceso que carga diaria pero con rango de fechas extendido

### 3. Gestión de Logs
- Retención: 7 días
- Limpieza automática de logs antiguos
- Logs detallados por componente
- Reportes JSON con métricas de ejecución

## 🚀 Instalación

### Requisitos Previos
- Debian/Ubuntu con acceso root
- Python 3.9+
- Acceso a las bases de datos origen y destino
- Systemd (para timers)

### Instalación Automática

```bash
# 1. Copiar archivos al servidor
scp -r ventas_pipeline/ root@servidor:/tmp/

# 2. Ejecutar instalador
cd /tmp/ventas_pipeline
sudo bash install.sh
```

El instalador:
- ✅ Verifica dependencias de Python
- ✅ Instala paquetes necesarios (psycopg2, pandas, pyyaml)
- ✅ Crea estructura en `/opt/ventas_pipeline`
- ✅ Configura servicios systemd
- ✅ Activa timers automáticos

## 📊 Monitoreo y Gestión

### Ver Estado de Timers

```bash
# Ver todos los timers del pipeline
systemctl list-timers ventas-pipeline-*

# Ver próxima ejecución
systemctl list-timers --all | grep ventas
```

### Ver Logs en Tiempo Real

```bash
# Logs de carga diaria
journalctl -u ventas-pipeline-daily -f

# Logs de validación mensual
journalctl -u ventas-pipeline-monthly -f

# Logs del orquestador (archivos)
tail -f /opt/ventas_pipeline/logs/orchestrator_$(date +%Y%m%d).log
```

### Ejecutar Manualmente

```bash
# Ejecutar carga diaria
systemctl start ventas-pipeline-daily.service

# Ejecutar validación mensual
systemctl start ventas-pipeline-monthly.service

# Ejecutar directamente (sin systemd)
cd /opt/ventas_pipeline
python3 scripts/pipeline_orchestrator.py --mode daily
python3 scripts/pipeline_orchestrator.py --mode monthly
```

### Ver Resultados de Última Ejecución

```bash
# Ver último reporte JSON
ls -lt /opt/ventas_pipeline/logs/report_*.json | head -1 | xargs cat | jq .

# Ver resumen
journalctl -u ventas-pipeline-daily --since "today" | grep "REPORTE FINAL" -A 20
```

## 🔧 Configuración

### Modificar Horarios

Editar archivos timer en `/etc/systemd/system/`:

```bash
# Cambiar hora de carga diaria (por defecto 07:00)
sudo nano /etc/systemd/system/ventas-pipeline-daily.timer
# Modificar línea: OnCalendar=*-*-* 07:00:00

# Cambiar hora de validación mensual (por defecto 14:00)
sudo nano /etc/systemd/system/ventas-pipeline-monthly.timer
# Modificar línea: OnCalendar=*-*-* 14:00:00

# Aplicar cambios
sudo systemctl daemon-reload
sudo systemctl restart ventas-pipeline-daily.timer
sudo systemctl restart ventas-pipeline-monthly.timer
```

### Modificar Semanas de Validación

Editar configuración principal:

```bash
sudo nano /opt/ventas_pipeline/config/pipeline_config.yaml
```

Cambiar:
```yaml
execution:
  validation_weeks: [1, 3]  # Semanas del mes (1-5)
```

### Modificar Reintentos y Timeouts

En el mismo archivo de configuración:

```yaml
execution:
  max_retries: 3              # Intentos por ETL
  retry_delay_seconds: 60     # Espera entre reintentos
  etl_timeout: 1800           # Timeout en segundos (30 min)
```

### Agregar/Quitar ETLs

Editar `pipeline_config.yaml`:

```yaml
etls:
  parallel:  # ETLs que se ejecutan en paralelo
    - name: "nuevo_etl"
      script: "nuevo_etl_ventas_rango.py"
      priority: 1
  
  sequential:  # ETLs que se ejecutan después, uno por uno
    - name: "cajas"
      script: "cajas_ventas_rango.py"
      priority: 10
```

## 📈 Métricas y Reportes

### Reporte JSON

Cada ejecución genera un reporte JSON con:

```json
{
  "run_type": "DAILY",
  "timestamp": "2026-02-12T07:15:30-05:00",
  "summary": {
    "total_etls": 6,
    "successful": 6,
    "failed": 0,
    "total_records": 12543
  },
  "etls": [
    {
      "name": "fruver",
      "status": "success",
      "duration_seconds": 45.3,
      "records_processed": 2341,
      "attempts": 1
    }
  ]
}
```

### Logs Estructurados

Formato de logs:
```
[2026-02-12 07:00:01] [INFO] [orchestrator] ================================================================================
[2026-02-12 07:00:01] [INFO] [orchestrator] INICIANDO CARGA DIARIA DE VENTAS
[2026-02-12 07:00:01] [INFO] [orchestrator] Fecha a procesar: 20260211
[2026-02-12 07:00:05] [INFO] [orchestrator] [fruver] Attempt 1/3 | Range: 20260211 - 20260211
[2026-02-12 07:00:32] [INFO] [orchestrator] [fruver] SUCCESS | Duration: 27.1s | Records: 2341
```

## 🔍 Troubleshooting

### Pipeline No Se Ejecuta

```bash
# Verificar estado de timers
systemctl status ventas-pipeline-daily.timer
systemctl status ventas-pipeline-monthly.timer

# Ver si están activos
systemctl is-active ventas-pipeline-daily.timer

# Reiniciar timers
sudo systemctl restart ventas-pipeline-*.timer
```

### ETL Falla Repetidamente

```bash
# Ver logs detallados del ETL específico
cat /opt/ventas_pipeline/logs/orchestrator_$(date +%Y%m%d).log | grep -A 10 "nombre_etl"

# Ejecutar ETL manualmente para debugging
cd /opt/ventas_pipeline/etl
python3 nombre_etl_ventas_rango.py --date $(date -d yesterday +%Y%m%d)
```

### Conexión a Base de Datos

```bash
# Verificar conectividad
psql -h 192.168.35.232 -U postgres -d produXdia -c "SELECT version();"

# Ver últimos registros cargados
psql -h 192.168.35.232 -U postgres -d produXdia -c "
  SELECT tabla, COUNT(*), MAX(fecha_carga) 
  FROM (
    SELECT 'fruver' as tabla, fecha_carga FROM ventas_fruver
    UNION ALL
    SELECT 'carnes', fecha_carga FROM ventas_carnes
    UNION ALL
    SELECT 'pollo_pesc', fecha_carga FROM ventas_pollo_pesc
    UNION ALL
    SELECT 'industria', fecha_carga FROM ventas_industria
    UNION ALL
    SELECT 'asadero', fecha_carga FROM ventas_asadero
    UNION ALL
    SELECT 'cajas', fecha_carga FROM ventas_cajas
  ) t
  GROUP BY tabla;
"
```

### Logs Ocupando Mucho Espacio

```bash
# Ver tamaño de logs
du -sh /opt/ventas_pipeline/logs/

# Limpiar logs manualmente (más de 7 días)
find /opt/ventas_pipeline/logs/ -name "*.log" -mtime +7 -delete
find /opt/ventas_pipeline/logs/ -name "report_*.json" -mtime +7 -delete
```

## 🛡️ Seguridad

- Credenciales en archivo de configuración: `/opt/ventas_pipeline/config/pipeline_config.yaml`
- Permisos: Solo root puede leer la configuración
- Logs accesibles solo para root
- Servicios se ejecutan como root (puede cambiarse creando usuario dedicado)

### Cambiar a Usuario Dedicado (Recomendado)

```bash
# Crear usuario
sudo useradd -r -s /bin/false ventas-pipeline

# Cambiar permisos
sudo chown -R ventas-pipeline:ventas-pipeline /opt/ventas_pipeline

# Modificar servicios systemd
sudo nano /etc/systemd/system/ventas-pipeline-daily.service
# Agregar en [Service]:
# User=ventas-pipeline
# Group=ventas-pipeline

sudo systemctl daemon-reload
```

## 📞 Soporte

### Archivos Importantes

- Configuración: `/opt/ventas_pipeline/config/pipeline_config.yaml`
- Logs: `/opt/ventas_pipeline/logs/`
- Scripts ETL: `/opt/ventas_pipeline/etl/`
- Servicios: `/etc/systemd/system/ventas-pipeline-*`

### Comandos de Diagnóstico

```bash
# Estado completo del sistema
systemctl list-timers ventas-pipeline-*
journalctl -u ventas-pipeline-daily --since "1 week ago" | grep "REPORTE FINAL" -A 15
ls -lth /opt/ventas_pipeline/logs/ | head -10
```

---

**Versión:** 1.0  
**Última actualización:** 2026-02-12  
**Autor:** Pipeline Automation Team
