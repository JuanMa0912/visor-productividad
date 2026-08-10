"""
Utilidades comunes para el pipeline de ventas
"""
from __future__ import annotations

import logging
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo
import yaml


class PipelineConfig:
    """Gestor de configuración del pipeline"""
    
    def __init__(self, config_path: str | Path):
        self.config_path = Path(config_path)
        self._config = self._load_config()
    
    def _load_config(self) -> dict:
        """Carga el archivo de configuración YAML"""
        if not self.config_path.exists():
            raise FileNotFoundError(f"Config file not found: {self.config_path}")
        
        with open(self.config_path, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f)
    
    def get(self, key_path: str, default=None):
        """Obtiene un valor de configuración usando notación de punto"""
        keys = key_path.split('.')
        value = self._config
        
        for key in keys:
            if isinstance(value, dict) and key in value:
                value = value[key]
            else:
                return default
        
        return value
    
    @property
    def timezone(self) -> ZoneInfo:
        """Zona horaria configurada"""
        tz_name = self.get('timezone', 'America/Bogota')
        return ZoneInfo(tz_name)


class PipelineLogger:
    """Gestor de logging para el pipeline"""
    
    def __init__(self, config: PipelineConfig, component_name: str):
        self.config = config
        self.component_name = component_name
        self.logs_dir = Path(config.get('paths.logs_dir'))
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        
        self.logger = self._setup_logger()
    
    def _setup_logger(self) -> logging.Logger:
        """Configura el logger con archivo y consola"""
        logger = logging.getLogger(self.component_name)
        logger.setLevel(logging.DEBUG)
        
        # Evitar duplicados
        if logger.handlers:
            return logger
        
        # Formato de log
        log_format = self.config.get('logging.format')
        date_format = self.config.get('logging.date_format')
        formatter = logging.Formatter(log_format, datefmt=date_format)
        
        # Handler de archivo (diario)
        today = datetime.now(self.config.timezone).strftime('%Y%m%d')
        log_file = self.logs_dir / f"{self.component_name}_{today}.log"
        
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(formatter)
        
        # Handler de consola
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(formatter)
        
        logger.addHandler(file_handler)
        logger.addHandler(console_handler)
        
        return logger
    
    def info(self, message: str):
        self.logger.info(message)
    
    def debug(self, message: str):
        self.logger.debug(message)
    
    def warning(self, message: str):
        self.logger.warning(message)
    
    def error(self, message: str, exc_info=False):
        self.logger.error(message, exc_info=exc_info)
    
    def critical(self, message: str, exc_info=False):
        self.logger.critical(message, exc_info=exc_info)


def get_yesterday_yyyymmdd(tz: ZoneInfo) -> str:
    """Retorna la fecha de ayer en formato YYYYMMDD"""
    now = datetime.now(tz)
    yesterday = now.date() - timedelta(days=1)
    return yesterday.strftime("%Y%m%d")


def get_month_range_yyyymmdd(tz: ZoneInfo) -> tuple[str, str]:
    """Retorna el rango del mes actual desde el día 1 hasta ayer"""
    now = datetime.now(tz)
    yesterday = now.date() - timedelta(days=1)
    
    first_day = yesterday.replace(day=1)
    
    return first_day.strftime("%Y%m%d"), yesterday.strftime("%Y%m%d")


def should_run_validation(tz: ZoneInfo, validation_weeks: list[int]) -> bool:
    """
    Determina si hoy debe ejecutarse la validación mensual
    
    Args:
        tz: Zona horaria
        validation_weeks: Lista de semanas del mes [1, 3] significa semanas 1 y 3
    
    Returns:
        True si debe ejecutarse la validación
    """
    now = datetime.now(tz)
    
    # Calcular en qué semana del mes estamos (1-5)
    day_of_month = now.day
    week_of_month = ((day_of_month - 1) // 7) + 1
    
    return week_of_month in validation_weeks


def cleanup_old_logs(logs_dir: Path, retention_days: int, logger: Optional[logging.Logger] = None):
    """
    Elimina logs más antiguos que retention_days
    
    Args:
        logs_dir: Directorio de logs
        retention_days: Días de retención
        logger: Logger opcional para registrar la limpieza
    """
    if not logs_dir.exists():
        return
    
    cutoff_date = datetime.now() - timedelta(days=retention_days)
    deleted_count = 0
    
    for log_file in logs_dir.glob("*.log"):
        try:
            # Obtener fecha de modificación
            file_mtime = datetime.fromtimestamp(log_file.stat().st_mtime)
            
            if file_mtime < cutoff_date:
                log_file.unlink()
                deleted_count += 1
                if logger:
                    logger.debug(f"Deleted old log: {log_file.name}")
        except Exception as e:
            if logger:
                logger.warning(f"Error deleting log {log_file.name}: {e}")
    
    if logger and deleted_count > 0:
        logger.info(f"Cleaned up {deleted_count} old log file(s)")


def format_duration(seconds: float) -> str:
    """Formatea duración en segundos a formato legible"""
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        minutes = seconds / 60
        return f"{minutes:.1f}m"
    else:
        hours = seconds / 3600
        return f"{hours:.2f}h"
