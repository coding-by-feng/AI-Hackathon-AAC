#!/usr/bin/env bash
# Build the analytics database from nothing and prove it works.
#
#   ./tools/build.sh [db_path]
#
# Deterministic: same input, byte-identical output. Safe to run repeatedly.
# Exits non-zero if any stage fails, so CI can use it directly.

set -euo pipefail
cd "$(dirname "$0")/.."

DB="${1:-aac.db}"
step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step "1/7  schema + indices"
rm -f "$DB" "$DB-wal" "$DB-shm"
sqlite3 "$DB" < db/schema.sql
sqlite3 "$DB" < db/indices.sql
echo "     $(sqlite3 "$DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table'") tables, \
$(sqlite3 "$DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name LIKE 'ix_%'") indices"

step "2/7  metric + insight catalogues"
sqlite3 "$DB" < db/seed_catalogues.sql
echo "     $(sqlite3 "$DB" "SELECT COUNT(*) FROM metrics_catalog") metrics, \
$(sqlite3 "$DB" "SELECT COUNT(*) FROM insights_catalog") insight rules"

step "3/7  seed data (deterministic)"
python3 -m tools.seed.generate --db "$DB" | sed 's/^/     /'

step "4/7  views"
sqlite3 "$DB" < db/views_metrics.sql
sqlite3 "$DB" < db/views_insights.sql
echo "     $(sqlite3 "$DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='view'") views"

step "5/7  rollup (L2)"
python3 tools/rollup.py --db "$DB" | sed 's/^/     /'

step "6/7  evaluate rules"
python3 tools/run_rules.py --db "$DB" | sed 's/^/     /'

step "7/7  verify"
python3 tools/verify.py --db "$DB"

step "docs + fixtures"
python3 tools/gen_metric_index.py --db "$DB" | sed 's/^/     /'
for child in maya_t sofia_r; do
  python3 tools/gen_fixtures.py --db "$DB" --child "$child" --window last_14d | head -1 | sed 's/^/     /'
done

printf '\n\033[32mBuild complete.\033[0m  %s\n' "$DB"
printf '  run the MCP server:   node mcp/server.ts --db %s\n' "$DB"
printf '  concurrency check:    python3 tools/concurrency_test.py --db %s\n' "$DB"
