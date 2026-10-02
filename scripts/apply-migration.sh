#!/usr/bin/env bash
# Applies ONE migration file from drizzle/ to the database in .env.local.
#
# This exists so permission to run migrations can be granted narrowly. A blanket
# "psql *" rule would allow any statement at all, typed inline, with no record
# of it anywhere. This runner only applies a FILE that already exists in
# drizzle/, so every statement that reaches the database has been written down,
# reviewed in a diff, and committed first.
set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "usage: npm run db:migrate -- 0011_media_visibility_and_shares.sql" >&2
  exit 1
fi

# Refuse anything outside drizzle/. Without this the argument is just a path and
# the narrow permission buys nothing.
case "$FILE" in
  */*|..*) echo "Refusing '$FILE': pass a bare filename inside drizzle/." >&2; exit 1 ;;
  *.sql) ;;
  *) echo "Refusing '$FILE': migrations are .sql files." >&2; exit 1 ;;
esac

TARGET="drizzle/$FILE"
[ -f "$TARGET" ] || { echo "No such migration: $TARGET" >&2; exit 1; }

# An explicit DATABASE_URL in the environment wins, so the same runner can be
# pointed at the local test cluster or, later, a staging branch. Without that
# override there would be no way to rehearse a migration before it is real.
DB="${DATABASE_URL:-$(grep '^DATABASE_URL=' .env.local 2>/dev/null | cut -d= -f2- | tr -d '"')}"
[ -n "$DB" ] || { echo "DATABASE_URL is not set, and .env.local has none" >&2; exit 1; }

# Say which database out loud, with the credentials stripped, because "applied
# successfully" to the wrong database is the failure worth preventing here.
echo "Target: $(printf '%s' "$DB" | sed -E 's#://[^@]*@#://#; s#\?.*##')"

# Echo the statements before running them, so the transcript shows exactly what
# was applied rather than just a filename.
echo "Applying $TARGET"
echo "----------------------------------------"
cat "$TARGET"
echo "----------------------------------------"

# ON_ERROR_STOP means a failing statement aborts the run rather than leaving the
# schema half migrated, which is the worst outcome and the hardest to unpick.
psql "$DB" -v ON_ERROR_STOP=1 -f "$TARGET"
echo "Applied $FILE"
