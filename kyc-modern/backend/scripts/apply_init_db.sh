#!/usr/bin/env bash
set -euo pipefail

# Usage:
#  ./apply_init_db.sh           # uses DB_USER and DB_PASS from backend/.env (or env)
#  ./apply_init_db.sh --root    # runs as root (sudo mysql -u root -p < migrations/001-init-mysql.sql)
#
# Requires: mysql client in PATH.

ROOT_MODE=0
if [ "${1:-}" = "--root" ]; then
  ROOT_MODE=1
fi

# Try to read backend/.env if present (parse only KEY=VALUE lines)
ENV_FILE="$(dirname "$0")/../.env"
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # skip empty lines and comments
    case "$line" in
      ''|\#*) continue ;;
    esac
    # accept only KEY=VALUE (key starts with letter or underscore)
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      # strip possible CR at end (Windows files)
      line="${line%$'\r'}"
      export "$line"
    fi
  done < "$ENV_FILE"
fi

SQL_FILE="$(dirname "$0")/../migrations/001-init-mysql.sql"
if [ ! -f "$SQL_FILE" ]; then
  echo "Fichier SQL introuvable: $SQL_FILE" >&2
  exit 1
fi

if [ "$ROOT_MODE" -eq 1 ]; then
  echo "Exécution en mode root : sudo mysql -u root -p < $SQL_FILE"
  sudo mysql -u root -p < "$SQL_FILE"
  exit $?
fi

# Check required vars
: "${DB_HOST:?DB_HOST non défini}"
: "${DB_PORT:?DB_PORT non défini}"
: "${DB_USER:?DB_USER non défini}"
: "${DB_NAME:?DB_NAME non défini}"

echo "Import en tant que $DB_USER vers $DB_NAME@$DB_HOST:$DB_PORT"

# Prefer prompting for password rather than exposing it in env
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p "$DB_NAME" < "$SQL_FILE"

echo "Import terminé."
