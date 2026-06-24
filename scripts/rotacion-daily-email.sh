#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-/opt/visor-productividad/.env.local}"
LOG_FILE="${LOG_FILE:-/var/log/visor-rotacion-email.log}"

cd "$ROOT_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$' | sed 's/\r$//')
  set +a
fi

export ENV_FILE

{
  echo "==== $(date -Is) rotacion-daily-email ===="
  npx tsx scripts/rotacion-daily-email.mts
} >>"$LOG_FILE" 2>&1
