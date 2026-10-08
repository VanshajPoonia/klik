#!/usr/bin/env bash
# Starts a throwaway Postgres for the database tests and pushes the schema.
#
# Deliberately not a system service and not the project's own database: it
# lives under /tmp, listens on a non-default port, and is called klik_test,
# which test/harness.ts checks before it truncates anything.
set -euo pipefail

PORT="${KLIK_TEST_PG_PORT:-55433}"
DATA_DIR="${KLIK_TEST_PG_DIR:-/tmp/klik-test-pg}"
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

if [ ! -d "$DATA_DIR" ]; then
  echo "Creating cluster in $DATA_DIR"
  initdb -D "$DATA_DIR" -U postgres --auth=trust >/dev/null
fi

if ! pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
  pg_ctl -D "$DATA_DIR" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" \
    -l "$DATA_DIR/server.log" start
  sleep 1
fi

psql -h 127.0.0.1 -p "$PORT" -U postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname='klik_test'" | grep -q 1 \
  || psql -h 127.0.0.1 -p "$PORT" -U postgres -q -c "CREATE DATABASE klik_test"

export TEST_DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/klik_test"
npx drizzle-kit push --config=drizzle.test.config.ts --force >/dev/null

# What push cannot express: CHECK constraints, partial indexes and triggers.
# Every migration is written to be re-runnable, so all of them are laid over
# the pushed schema in order, and the test database ends up shaped like
# production rather than like lib/schema.ts. Tests used to pass or fail
# depending on whether an older cluster happened to have a migration applied.
for migration in drizzle/0*.sql; do
  psql "$TEST_DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$migration" >/dev/null 2>&1 \
    || { echo "Migration failed against the test schema: $migration" >&2; exit 1; }
done

# Except the plan-limit triggers from 0003, which cap an owner at one or five
# live events. Fixtures routinely create fifty events for one owner (the purge
# circuit breaker needs a crowd), and those triggers read users.plan_key, which
# ACT-1 retires. Their replacement is tested where it is built.
psql "$TEST_DATABASE_URL" -q -c 'DROP TRIGGER IF EXISTS "events_plan_limits_trigger" ON "events"; DROP TRIGGER IF EXISTS "users_plan_limits_trigger" ON "users";' >/dev/null

echo "Ready: $TEST_DATABASE_URL"
echo "Stop it with: pg_ctl -D $DATA_DIR stop"
