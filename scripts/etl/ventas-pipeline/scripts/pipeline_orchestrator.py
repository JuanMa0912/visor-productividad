#!/usr/bin/env python3
"""
ORQUESTADOR PRINCIPAL - Pipeline de Ventas
Ejecuta ETLs en paralelo y secuencial con validaciones
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import List

# Agregar directorio scripts al path
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

from pipeline_utils import (
    PipelineConfig,
    PipelineLogger,
    get_yesterday_yyyymmdd,
    get_month_range_yyyymmdd,
    should_run_validation,
    cleanup_old_logs,
    format_duration
)
from etl_runner import ETLRunner, ETLResult


class PipelineOrchestrator:
    """Orquestador principal del pipeline"""
    
    def __init__(self, config_path: str):
        self.config = PipelineConfig(config_path)
        self.logger = PipelineLogger(self.config, "orchestrator")
        
        self.etl_runner = ETLRunner(
            etl_dir=Path(self.config.get('paths.etl_dir')),
            max_retries=self.config.get('execution.max_retries', 3),
            retry_delay=self.config.get('execution.retry_delay_seconds', 60),
            timeout=self.config.get('execution.etl_timeout', 1800),
            logger=self.logger
        )
        
        self.results: List[ETLResult] = []
    
    def run_daily_load(self):
        """Ejecuta carga diaria (ventas del día anterior)"""
        self.logger.info("=" * 80)
        self.logger.info("INICIANDO CARGA DIARIA DE VENTAS")
        self.logger.info("=" * 80)
        
        # Obtener fecha de ayer
        yesterday = get_yesterday_yyyymmdd(self.config.timezone)
        self.logger.info(f"Fecha a procesar: {yesterday}")
        
        # Limpiar logs antiguos
        self._cleanup_logs()
        
        # Ejecutar ETLs
        pipeline_start = datetime.now()
        
        # 1. ETLs en paralelo (ligeros)
        self._run_parallel_etls(yesterday, yesterday)
        
        # 2. ETL secuencial (pesado)
        self._run_sequential_etls(yesterday, yesterday)
        
        pipeline_duration = (datetime.now() - pipeline_start).total_seconds()
        
        # Generar reporte
        self._generate_report(pipeline_duration, "DAILY")
    
    def run_monthly_validation(self):
        """Ejecuta validación mensual (del 1 del mes hasta ayer)"""
        self.logger.info("=" * 80)
        self.logger.info("INICIANDO VALIDACIÓN MENSUAL")
        self.logger.info("=" * 80)
        
        # Verificar si hoy toca validación
        validation_weeks = self.config.get('execution.validation_weeks', [1, 3])
        if not should_run_validation(self.config.timezone, validation_weeks):
            self.logger.info("Hoy no corresponde validación mensual. Abortando.")
            return
        
        # Obtener rango del mes
        start_date, end_date = get_month_range_yyyymmdd(self.config.timezone)
        self.logger.info(f"Rango a validar: {start_date} - {end_date}")
        
        # Limpiar logs antiguos
        self._cleanup_logs()
        
        # Ejecutar ETLs
        pipeline_start = datetime.now()
        
        # 1. ETLs en paralelo
        self._run_parallel_etls(start_date, end_date)
        
        # 2. ETL secuencial
        self._run_sequential_etls(start_date, end_date)
        
        pipeline_duration = (datetime.now() - pipeline_start).total_seconds()
        
        # Generar reporte
        self._generate_report(pipeline_duration, "MONTHLY_VALIDATION")
    
    def _run_parallel_etls(self, start_date: str, end_date: str):
        """Ejecuta ETLs ligeros en paralelo"""
        parallel_etls = self.config.get('etls.parallel', [])
        
        if not parallel_etls:
            self.logger.warning("No hay ETLs paralelos configurados")
            return
        
        self.logger.info(f"Ejecutando {len(parallel_etls)} ETLs en paralelo...")
        
        # Ordenar por prioridad
        parallel_etls = sorted(parallel_etls, key=lambda x: x.get('priority', 999))
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(parallel_etls)) as executor:
            futures = {}
            
            for etl_config in parallel_etls:
                future = executor.submit(
                    self.etl_runner.run_etl,
                    etl_config['script'],
                    etl_config['name'],
                    start_date,
                    end_date
                )
                futures[future] = etl_config['name']
            
            # Esperar a que terminen todos
            for future in concurrent.futures.as_completed(futures):
                etl_name = futures[future]
                try:
                    result = future.result()
                    self.results.append(result)
                except Exception as e:
                    self.logger.error(f"Error ejecutando {etl_name}: {e}", exc_info=True)
    
    def _run_sequential_etls(self, start_date: str, end_date: str):
        """Ejecuta ETLs pesados secuencialmente"""
        sequential_etls = self.config.get('etls.sequential', [])
        
        if not sequential_etls:
            self.logger.warning("No hay ETLs secuenciales configurados")
            return
        
        self.logger.info(f"Ejecutando {len(sequential_etls)} ETL(s) secuencial(es)...")
        
        # Ordenar por prioridad
        sequential_etls = sorted(sequential_etls, key=lambda x: x.get('priority', 999))
        
        for etl_config in sequential_etls:
            result = self.etl_runner.run_etl(
                etl_config['script'],
                etl_config['name'],
                start_date,
                end_date
            )
            self.results.append(result)
    
    def _cleanup_logs(self):
        """Limpia logs antiguos según configuración"""
        logs_dir = Path(self.config.get('paths.logs_dir'))
        retention_days = self.config.get('logging.retention_days', 7)
        
        self.logger.info(f"Limpiando logs antiguos (retención: {retention_days} días)...")
        cleanup_old_logs(logs_dir, retention_days, self.logger.logger)
    
    def _generate_report(self, total_duration: float, run_type: str):
        """Genera reporte final de ejecución"""
        self.logger.info("=" * 80)
        self.logger.info(f"REPORTE FINAL - {run_type}")
        self.logger.info("=" * 80)
        
        success_count = sum(1 for r in self.results if r.success)
        failed_count = len(self.results) - success_count
        total_records = sum(r.records_processed for r in self.results)
        
        self.logger.info(f"Duración total: {format_duration(total_duration)}")
        self.logger.info(f"ETLs ejecutados: {len(self.results)}")
        self.logger.info(f"  ✓ Exitosos: {success_count}")
        self.logger.info(f"  ✗ Fallidos: {failed_count}")
        self.logger.info(f"Registros procesados: {total_records:,}")
        
        # Detalle por ETL
        self.logger.info("")
        self.logger.info("Detalle por ETL:")
        self.logger.info("-" * 80)
        
        for result in sorted(self.results, key=lambda r: r.name):
            status_symbol = "✓" if result.success else "✗"
            status_color = result.status.value.upper()
            
            self.logger.info(
                f"{status_symbol} [{result.name:15s}] {status_color:10s} | "
                f"Duration: {format_duration(result.duration_seconds):>8s} | "
                f"Records: {result.records_processed:>6,} | "
                f"Attempts: {result.attempts}"
            )
            
            if not result.success and result.error_message:
                self.logger.error(f"    Error: {result.error_message}")
        
        # Guardar reporte en JSON
        self._save_json_report(run_type)
        
        # Estado final
        self.logger.info("=" * 80)
        if failed_count == 0:
            self.logger.info("✓ PIPELINE COMPLETADO EXITOSAMENTE")
        else:
            self.logger.warning(f"⚠ PIPELINE COMPLETADO CON {failed_count} ERRORES")
        self.logger.info("=" * 80)
    
    def _save_json_report(self, run_type: str):
        """Guarda reporte detallado en JSON"""
        logs_dir = Path(self.config.get('paths.logs_dir'))
        timestamp = datetime.now(self.config.timezone).strftime('%Y%m%d_%H%M%S')
        report_file = logs_dir / f"report_{run_type.lower()}_{timestamp}.json"
        
        report = {
            'run_type': run_type,
            'timestamp': datetime.now(self.config.timezone).isoformat(),
            'summary': {
                'total_etls': len(self.results),
                'successful': sum(1 for r in self.results if r.success),
                'failed': sum(1 for r in self.results if not r.success),
                'total_records': sum(r.records_processed for r in self.results)
            },
            'etls': [r.to_dict() for r in self.results]
        }
        
        with open(report_file, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        
        self.logger.info(f"Reporte JSON guardado: {report_file}")


def main():
    """Punto de entrada principal"""
    parser = argparse.ArgumentParser(
        description="Orquestador del Pipeline de Ventas"
    )
    parser.add_argument(
        '--mode',
        choices=['daily', 'monthly'],
        required=True,
        help='Modo de ejecución: daily (diario) o monthly (validación mensual)'
    )
    parser.add_argument(
        '--config',
        default='/opt/ventas_pipeline/config/pipeline_config.yaml',
        help='Ruta al archivo de configuración'
    )
    
    args = parser.parse_args()
    
    try:
        orchestrator = PipelineOrchestrator(args.config)
        
        if args.mode == 'daily':
            orchestrator.run_daily_load()
        elif args.mode == 'monthly':
            orchestrator.run_monthly_validation()
        
        # Exit code basado en resultados
        failed = sum(1 for r in orchestrator.results if not r.success)
        sys.exit(1 if failed > 0 else 0)
    
    except Exception as e:
        print(f"ERROR FATAL: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(2)


if __name__ == '__main__':
    main()
