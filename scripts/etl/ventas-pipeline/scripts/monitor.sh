#!/bin/bash
# =====================================================
# MONITOR - Muestra resumen de últimas ejecuciones
# =====================================================

LOG_DIR="/opt/ventas_pipeline/logs"

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         MONITOR - ÚLTIMAS EJECUCIONES DEL PIPELINE     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

# Verificar si jq está instalado
if ! command -v jq &>/dev/null; then
    echo -e "${YELLOW}Instalando jq para mejor visualización...${NC}"
    apt-get update -qq && apt-get install -y jq -qq
fi

# Encontrar últimos reportes
echo -e "${YELLOW}Últimas 5 ejecuciones:${NC}"
echo ""

REPORTS=$(ls -t "$LOG_DIR"/report_*.json 2>/dev/null | head -5)

if [ -z "$REPORTS" ]; then
    echo -e "${RED}No se encontraron reportes en $LOG_DIR${NC}"
    exit 1
fi

COUNT=1
for REPORT in $REPORTS; do
    if [ -f "$REPORT" ]; then
        RUN_TYPE=$(jq -r '.run_type // "N/A"' "$REPORT")
        TIMESTAMP=$(jq -r '.timestamp // "N/A"' "$REPORT")
        TOTAL_ETLS=$(jq -r '.summary.total_etls // 0' "$REPORT")
        SUCCESSFUL=$(jq -r '.summary.successful // 0' "$REPORT")
        FAILED=$(jq -r '.summary.failed // 0' "$REPORT")
        TOTAL_RECORDS=$(jq -r '.summary.total_records // 0' "$REPORT")
        
        # Color según resultado
        if [ "$FAILED" -eq 0 ]; then
            STATUS_COLOR=$GREEN
            STATUS="✓ EXITOSO"
        else
            STATUS_COLOR=$RED
            STATUS="✗ CON ERRORES"
        fi
        
        echo -e "${BLUE}[$COUNT]${NC} $(basename "$REPORT")"
        echo -e "    Tipo:      $RUN_TYPE"
        echo -e "    Fecha:     $TIMESTAMP"
        echo -e "    Estado:    ${STATUS_COLOR}${STATUS}${NC}"
        echo -e "    ETLs:      $SUCCESSFUL/$TOTAL_ETLS exitosos"
        echo -e "    Registros: $(printf "%'d" $TOTAL_RECORDS)"
        
        if [ "$FAILED" -gt 0 ]; then
            echo -e "    ${RED}Fallidos:${NC}"
            jq -r '.etls[] | select(.status != "success") | "      - " + .name + " (" + .status + ")"' "$REPORT"
        fi
        
        echo ""
        ((COUNT++))
    fi
done

# Estadísticas de logs
echo -e "${YELLOW}Estadísticas de logs:${NC}"
TOTAL_LOGS=$(ls "$LOG_DIR"/*.log 2>/dev/null | wc -l)
TOTAL_REPORTS=$(ls "$LOG_DIR"/report_*.json 2>/dev/null | wc -l)
DISK_USAGE=$(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)

echo "  - Archivos de log: $TOTAL_LOGS"
echo "  - Reportes JSON:   $TOTAL_REPORTS"
echo "  - Espacio usado:   $DISK_USAGE"
echo ""

# Próximas ejecuciones
echo -e "${YELLOW}Próximas ejecuciones programadas:${NC}"
systemctl list-timers ventas-pipeline-* --no-pager 2>/dev/null | grep ventas-pipeline || echo "  No se pudieron obtener timers"
echo ""

# Log de hoy
TODAY=$(date +%Y%m%d)
TODAY_LOG="$LOG_DIR/orchestrator_$TODAY.log"

if [ -f "$TODAY_LOG" ]; then
    echo -e "${YELLOW}Actividad de hoy ($TODAY):${NC}"
    
    # Contar ejecuciones
    DAILY_COUNT=$(grep -c "INICIANDO CARGA DIARIA" "$TODAY_LOG" 2>/dev/null || echo "0")
    MONTHLY_COUNT=$(grep -c "INICIANDO VALIDACIÓN MENSUAL" "$TODAY_LOG" 2>/dev/null || echo "0")
    
    echo "  - Cargas diarias:       $DAILY_COUNT"
    echo "  - Validaciones mensual: $MONTHLY_COUNT"
    
    # Última línea
    if [ -s "$TODAY_LOG" ]; then
        LAST_LINE=$(tail -1 "$TODAY_LOG")
        echo "  - Última actividad:     $LAST_LINE"
    fi
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
