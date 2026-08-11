"""
Ejecutor de ETLs individuales con manejo de reintentos y timeouts
"""
from __future__ import annotations

import subprocess
import time
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional


class ETLStatus(Enum):
    """Estados posibles de un ETL"""
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"


@dataclass
class ETLResult:
    """Resultado de la ejecución de un ETL"""
    name: str
    status: ETLStatus
    start_time: datetime
    end_time: Optional[datetime]
    duration_seconds: float
    records_processed: int
    attempts: int
    error_message: Optional[str]
    stdout: str
    stderr: str
    
    @property
    def success(self) -> bool:
        return self.status == ETLStatus.SUCCESS
    
    def to_dict(self) -> dict:
        return {
            'name': self.name,
            'status': self.status.value,
            'start_time': self.start_time.isoformat(),
            'end_time': self.end_time.isoformat() if self.end_time else None,
            'duration_seconds': self.duration_seconds,
            'records_processed': self.records_processed,
            'attempts': self.attempts,
            'error_message': self.error_message,
        }


class ETLRunner:
    """Ejecutor de ETLs con reintentos y timeout"""
    
    def __init__(
        self,
        etl_dir: Path,
        max_retries: int = 3,
        retry_delay: int = 60,
        timeout: int = 1800,
        logger=None
    ):
        self.etl_dir = Path(etl_dir)
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.timeout = timeout
        self.logger = logger
    
    def run_etl(
        self,
        script_name: str,
        etl_name: str,
        start_date: str,
        end_date: Optional[str] = None
    ) -> ETLResult:
        """
        Ejecuta un ETL con reintentos
        
        Args:
            script_name: Nombre del script Python (ej: fruver_ventas_rango.py)
            etl_name: Nombre descriptivo del ETL
            start_date: Fecha inicial en formato YYYYMMDD
            end_date: Fecha final (opcional, si None usa start_date)
        
        Returns:
            ETLResult con el resultado de la ejecución
        """
        script_path = self.etl_dir / script_name
        
        if not script_path.exists():
            return self._create_error_result(
                etl_name,
                f"Script not found: {script_path}"
            )
        
        if end_date is None:
            end_date = start_date
        
        start_time = datetime.now()
        
        for attempt in range(1, self.max_retries + 1):
            if self.logger:
                self.logger.info(
                    f"[{etl_name}] Attempt {attempt}/{self.max_retries} | "
                    f"Range: {start_date} - {end_date}"
                )
            
            result = self._execute_script(
                script_path,
                etl_name,
                start_date,
                end_date,
                attempt,
                start_time
            )
            
            if result.success:
                if self.logger:
                    self.logger.info(
                        f"[{etl_name}] SUCCESS | "
                        f"Duration: {result.duration_seconds:.1f}s | "
                        f"Records: {result.records_processed}"
                    )
                return result
            
            # Si falló y quedan intentos, esperar antes de reintentar
            if attempt < self.max_retries:
                if self.logger:
                    self.logger.warning(
                        f"[{etl_name}] FAILED (attempt {attempt}) | "
                        f"Retrying in {self.retry_delay}s..."
                    )
                time.sleep(self.retry_delay)
            else:
                if self.logger:
                    self.logger.error(
                        f"[{etl_name}] FAILED after {attempt} attempts | "
                        f"Error: {result.error_message}"
                    )
        
        return result
    
    def _execute_script(
        self,
        script_path: Path,
        etl_name: str,
        start_date: str,
        end_date: str,
        attempt: int,
        overall_start: datetime
    ) -> ETLResult:
        """Ejecuta el script Python y captura el resultado"""
        
        # Construir comando
        if start_date == end_date:
            cmd = ["python3", str(script_path), "--date", start_date]
        else:
            cmd = [
                "python3", str(script_path),
                "--start-date", start_date,
                "--end-date", end_date
            ]
        
        attempt_start = time.time()
        
        try:
            # Ejecutar con timeout
            process = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                cwd=self.etl_dir
            )
            
            duration = time.time() - attempt_start
            end_time = datetime.now()
            
            # Parsear salida para obtener registros procesados
            records = self._parse_records_from_output(process.stdout)
            
            if process.returncode == 0:
                return ETLResult(
                    name=etl_name,
                    status=ETLStatus.SUCCESS,
                    start_time=overall_start,
                    end_time=end_time,
                    duration_seconds=duration,
                    records_processed=records,
                    attempts=attempt,
                    error_message=None,
                    stdout=process.stdout,
                    stderr=process.stderr
                )
            else:
                return ETLResult(
                    name=etl_name,
                    status=ETLStatus.FAILED,
                    start_time=overall_start,
                    end_time=end_time,
                    duration_seconds=duration,
                    records_processed=records,
                    attempts=attempt,
                    error_message=f"Exit code {process.returncode}: {process.stderr}",
                    stdout=process.stdout,
                    stderr=process.stderr
                )
        
        except subprocess.TimeoutExpired:
            duration = time.time() - attempt_start
            return ETLResult(
                name=etl_name,
                status=ETLStatus.TIMEOUT,
                start_time=overall_start,
                end_time=datetime.now(),
                duration_seconds=duration,
                records_processed=0,
                attempts=attempt,
                error_message=f"Timeout after {self.timeout}s",
                stdout="",
                stderr=""
            )
        
        except Exception as e:
            duration = time.time() - attempt_start
            return ETLResult(
                name=etl_name,
                status=ETLStatus.FAILED,
                start_time=overall_start,
                end_time=datetime.now(),
                duration_seconds=duration,
                records_processed=0,
                attempts=attempt,
                error_message=str(e),
                stdout="",
                stderr=str(e)
            )
    
    def _parse_records_from_output(self, stdout: str) -> int:
        """Parsea el número de registros del output del ETL"""
        try:
            # Buscar línea que contenga "Upsert: X"
            for line in stdout.split('\n'):
                if 'Upsert:' in line:
                    parts = line.split('Upsert:')
                    if len(parts) > 1:
                        num_str = parts[1].strip().split()[0]
                        return int(num_str)
            return 0
        except:
            return 0
    
    def _create_error_result(self, etl_name: str, error: str) -> ETLResult:
        """Crea un resultado de error sin intentar ejecutar"""
        now = datetime.now()
        return ETLResult(
            name=etl_name,
            status=ETLStatus.FAILED,
            start_time=now,
            end_time=now,
            duration_seconds=0.0,
            records_processed=0,
            attempts=0,
            error_message=error,
            stdout="",
            stderr=error
        )
