#!/usr/bin/env bash
set -euo pipefail

# migrate_all.sh
# Parcourt les fichiers de migration dans src/db/migrations et applique
# chaque migration avec `yarn migrate:force -- --name=<migration>`.
# Usage:
#   export DB_HOST=... DB_PORT=... DB_USER=... DB_PASS=... DB_NAME=...
#   export FORCE_MIGRATIONS_CONFIRM=1
#   ./migrate_all.sh

MIG_DIR="$(dirname "$0")/src/db/migrations"

if [ ! -d "$MIG_DIR" ]; then
  echo "Erreur: dossier de migrations introuvable: $MIG_DIR"
  exit 1
fi

# Vérifier variables DB essentielles
if [ -z "${DB_NAME:-}" ] || [ -z "${DB_USER:-}" ] || [ -z "${DB_PASS:-}" ]; then
  echo "Veuillez exporter DB_NAME, DB_USER et DB_PASS avant d'exécuter ce script."
  echo "Exemple: export DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=kyc_user DB_PASS='...'
DB_NAME=kyc_prod FORCE_MIGRATIONS_CONFIRM=1"
  exit 2
fi

export FORCE_MIGRATIONS_CONFIRM=${FORCE_MIGRATIONS_CONFIRM:-1}

echo "Using DB: ${DB_USER}@${DB_HOST:-localhost}/${DB_NAME}"

for file in "$MIG_DIR"/*.ts; do
  [ -e "$file" ] || continue
  name=$(basename "$file" .ts)
  echo "=== Applying $name ==="
  if ! yarn migrate:force -- --name="$name"; then
    echo "Migration $name failed"
    exit 3
  fi
done

echo "All migrations processed."
