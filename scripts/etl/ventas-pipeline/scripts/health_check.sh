#!/bin/bash
# =====================================================
# HEALTH CHECK - Pipeline de Ventas
# Verifica el estado general del sistema
# =====================================================

set -e

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      VERIFICACIÓN DE SALUD - PIPELINE DE VENTAS        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

ISSUES=0

# 1. Verificar directorios
echo -e "${YELLOW}[1/8] Verificando estructura de directorios...${NC}"
DIRS=("/opt/ventas_pipeline" "/opt/ventas_pipeline/etl" "/opt/ventas_pipeline/scripts" "/opt/ventas_pipeline/config" "/opt/ventas_pipeline/logs")
for dir in "${DIRS[@]}"; do
    if [ -d "$dir" ]; then
        echo -e "  ${GREEN}✓${NC} $dir"
    else
        echo -e "  ${RED}✗${NC} $dir - NO EXISTE"
        ((ISSUES++))
    fi
done

# 2. Verificar archivos críticos
echo ""
echo -e "${YELLOW}[2/8] Verificando archivos críticos...${NC}"
FILES=(
    "/opt/ventas_pipeline/config/pipeline_config.yaml"
    "/opt/ventas_pipeline/scripts/pipeline_orchestrator.py"
    "/opt/ventas_pipeline/scripts/etl_runner.py"
    "/opt/ventas_pipeline/scripts/pipeline_utils.py"
)
for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "  ${GREEN}✓${NC} $file"
    else
        echo -e "  ${RED}✗${NC} $file - NO EXISTE"
        ((ISSUES++))
    fi
done

# 3. Verificar ETLs
echo ""
echo -e "${YELLOW}[3/8] Verificando scripts ETL...${NC}"
ETL_COUNT=$(ls /opt/ventas_pipeline/etl/*.py 2>/dev/null | wc -l)
if [ $ETL_COUNT -eq 6 ]; then
    echo -e "  ${GREEN}✓${NC} 6 ETLs encontrados"
    ls /opt/ventas_pipeline/etl/*.py | sed 's/^/    /'
else
    echo -e "  ${YELLOW}⚠${NC} Se esperaban 6 ETLs, encontrados: $ETL_COUNT"
    ((ISSUES++))
fi

# 4. Verificar servicios systemd
echo ""
echo -e "${YELLOW}[4/8] Verificando servicios systemd...${NC}"
SERVICES=("ventas-pipeline-daily.service" "ventas-pipeline-daily.timer" "ventas-pipeline-monthly.service" "ventas-pipeline-monthly.timer")
for service in "${SERVICES[@]}"; do
    if systemctl list-unit-files | grep -q "$service"; then
        if systemctl is-enabled "$service" &>/dev/null; then
            echo -e "  ${GREEN}✓${NC} $service - INSTALADO y HABILITADO"
        else
            echo -e "  ${YELLOW}⚠${NC} $service - INSTALADO pero DESHABILITADO"
            ((ISSUES++))
        fi
    else
        echo -e "  ${RED}✗${NC} $service - NO INSTALADO"
        ((ISSUES++))
    fi
done

# 5. Verificar estado de timers
echo ""
echo -e "${YELLOW}[5/8] Verificando estado de timers...${NC}"
TIMERS=("ventas-pipeline-daily.timer" "ventas-pipeline-monthly.timer")
for timer in "${TIMERS[@]}"; do
    if systemctl is-active "$timer" &>/dev/null; then
        NEXT=$(systemctl status "$timer" 2>/dev/null | grep "Trigger:" | awk '{print $2, $3, $4}')
        echo -e "  ${GREEN}✓${NC} $timer - ACTIVO (próx: $NEXT)"
    else
        echo -e "  ${RED}✗${NC} $timer - INACTIVO"
        ((ISSUES++))
    fi
done

# 6. Verificar dependencias Python
echo ""
echo -e "${YELLOW}[6/8] Verificando dependencias Python...${NC}"
PYTHON_DEPS=("psycopg2" "pandas" "yaml")
for dep in "${PYTHON_DEPS[@]}"; do
    if python3 -c "import $dep" 2>/dev/null; then
        VERSION=$(python3 -c "import $dep; print($dep.__version__)" 2>/dev/null || echo "N/A")
        echo -e "  ${GREEN}✓${NC} $dep ($VERSION)"
    else
        echo -e "  ${RED}✗${NC} $dep - NO INSTALADO"
        ((ISSUES++))
    fi
done

# 7. Verificar conectividad a BD
echo ""
echo -e "${YELLOW}[7/8] Verificando conectividad a base de datos...${NC}"
if command -v psql &>/dev/null; then
    if psql -h 192.168.35.232 -U postgres -d produXdia -c "SELECT 1" &>/dev/null; then
        echo -e "  ${GREEN}✓${NC} Conexión a produXdia exitosa"
    else
        echo -e "  ${RED}✗${NC} No se puede conectar a produXdia"
        echo -e "      (Verifica credenciales y red)"
        ((ISSUES++))
    fi
else
    echo -e "  ${YELLOW}⚠${NC} psql no instalado - no se puede verificar BD"
fi

# 8. Verificar logs recientes
echo ""
echo -e "${YELLOW}[8/8] Verificando logs recientes...${NC}"
LOG_DIR="/opt/ventas_pipeline/logs"
if [ -d "$LOG_DIR" ]; then
    LOG_COUNT=$(ls -1 $LOG_DIR/*.log 2>/dev/null | wc -l)
    REPORT_COUNT=$(ls -1 $LOG_DIR/report_*.json 2>/dev/null | wc -l)
    
    echo -e "  ${GREEN}✓${NC} Directorio de logs existe"
    echo -e "    - Archivos .log: $LOG_COUNT"
    echo -e "    - Reportes JSON: $REPORT_COUNT"
    
    # Verificar log de hoy
    TODAY_LOG="$LOG_DIR/orchestrator_$(date +%Y%m%d).log"
    if [ -f "$TODAY_LOG" ]; then
        SIZE=$(du -h "$TODAY_LOG" | cut -f1)
        echo -e "    - Log de hoy: $SIZE"
    fi
    
    # Último reporte
    LAST_REPORT=$(ls -t $LOG_DIR/report_*.json 2>/dev/null | head -1)
    if [ -n "$LAST_REPORT" ]; then
        REPORT_TIME=$(stat -c %y "$LAST_REPORT" | cut -d'.' -f1)
        echo -e "    - Último reporte: $REPORT_TIME"
    fi
else
    echo -e "  ${RED}✗${NC} Directorio de logs no existe"
    ((ISSUES++))
fi

# Resumen final
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
if [ $ISSUES -eq 0 ]; then
    echo -e "${GREEN}✓ SISTEMA SALUDABLE - Sin problemas detectados${NC}"
    exit 0
else
    echo -e "${RED}✗ PROBLEMAS DETECTADOS: $ISSUES${NC}"
    echo -e "${YELLOW}Revisa los items marcados arriba y ejecuta correcciones necesarias${NC}"
    exit 1
fi
