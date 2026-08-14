#!/usr/bin/env bash
set -euo pipefail

# Génère un rapport détaillé de la base `kyc_prod`.
# Utilisation:
# 1) Sur le serveur, sourcez le .env du backend ou laissez le script le faire automatiquement.
# 2) Exécutez: ./scripts/db_report.sh

OUT_DIR="reports"
OUT_FILE="$OUT_DIR/db_report_kyc_prod_$(date +%F_%H%M%S).txt"
ENV_PATHS=("/home/kyc/kyc-modern/kyc-modern/kyc-modern/backend/.env" "kyc-modern/backend/.env")

mkdir -p "$OUT_DIR"
echo "Generating DB report to $OUT_FILE" >&2

# load env if present
for p in "${ENV_PATHS[@]}"; do
  if [ -f "$p" ]; then
    # shellcheck disable=SC1090
    source "$p"
    echo "Sourced env: $p" >> "$OUT_FILE"
    break
  fi
done

MYSQL_CMD=(mysql -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" -u "${DB_USER:-kyc_user}" -p"${DB_PASS:-}" )

echo "Report generated: $(date)" > "$OUT_FILE"
echo "DB: ${DB_NAME:-kyc_prod} @ ${DB_HOST:-127.0.0.1}:${DB_PORT:-3306}" >> "$OUT_FILE"
echo "" >> "$OUT_FILE"

echo "-- MySQL version & globals --" >> "$OUT_FILE"
"${MYSQL_CMD[@]}" -e "SELECT @@version AS mysql_version, @@version_comment; SHOW VARIABLES LIKE 'version%';" >> "$OUT_FILE" 2>&1 || true

echo "" >> "$OUT_FILE"
echo "-- Databases and selected DB status --" >> "$OUT_FILE"
"${MYSQL_CMD[@]}" -e "SHOW DATABASES; SHOW VARIABLES LIKE 'datadir';" >> "$OUT_FILE" 2>&1 || true

echo "" >> "$OUT_FILE"
echo "-- Table status (kyc_prod) --" >> "$OUT_FILE"
"${MYSQL_CMD[@]}" -e "SELECT table_name, engine, table_rows, ROUND(data_length/1024/1024,2) AS data_mb, ROUND(index_length/1024/1024,2) AS idx_mb, ROUND((data_length+index_length)/1024/1024,2) AS total_mb FROM information_schema.tables WHERE table_schema='${DB_NAME:-kyc_prod}' ORDER BY (data_length+index_length) DESC;" >> "$OUT_FILE" 2>&1 || true

echo "" >> "$OUT_FILE"
echo "-- Views definitions --" >> "$OUT_FILE"
"${MYSQL_CMD[@]}" -e "SELECT TABLE_NAME, DEFINER FROM information_schema.views WHERE TABLE_SCHEMA='${DB_NAME:-kyc_prod}';" >> "$OUT_FILE" 2>&1 || true

views=$("${MYSQL_CMD[@]}" -N -e "SELECT TABLE_NAME FROM information_schema.views WHERE TABLE_SCHEMA='${DB_NAME:-kyc_prod}';" 2>/dev/null || true)
for v in $views; do
  echo "\n-- VIEW: $v --" >> "$OUT_FILE"
  "${MYSQL_CMD[@]}" -D "${DB_NAME:-kyc_prod}" -e "SHOW CREATE VIEW \\`$v\\`\G" >> "$OUT_FILE" 2>&1 || true
done

echo "" >> "$OUT_FILE"
echo "-- Tables detail (create/index/count) --" >> "$OUT_FILE"
tables=$("${MYSQL_CMD[@]}" -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema='${DB_NAME:-kyc_prod}' AND table_type='BASE TABLE';" 2>/dev/null || true)
for t in $tables; do
  echo "\n==== TABLE: $t ====" >> "$OUT_FILE"
  "${MYSQL_CMD[@]}" -D "${DB_NAME:-kyc_prod}" -e "SHOW CREATE TABLE \\`$t\\`\G" >> "$OUT_FILE" 2>&1 || true
  "${MYSQL_CMD[@]}" -D "${DB_NAME:-kyc_prod}" -e "SHOW INDEX FROM \\`$t\\`;" >> "$OUT_FILE" 2>&1 || true
  "${MYSQL_CMD[@]}" -D "${DB_NAME:-kyc_prod}" -e "SELECT COUNT(*) AS cnt FROM \\`$t\\`;" >> "$OUT_FILE" 2>&1 || true
done

echo "" >> "$OUT_FILE"
echo "-- Processlist (top) --" >> "$OUT_FILE"
"${MYSQL_CMD[@]}" -e "SHOW FULL PROCESSLIST LIMIT 50;" >> "$OUT_FILE" 2>&1 || true

echo "" >> "$OUT_FILE"
echo "Report written to $OUT_FILE"

exit 0
