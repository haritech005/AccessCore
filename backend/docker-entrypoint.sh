#!/bin/sh
set -e

echo "[AccessCore Docker] Starting container initialization..."

# Run database migrations automatically on boot
if [ -n "$DATABASE_URL" ]; then
  echo "[AccessCore Docker] Running database schema migrations..."
  node dist/db/migrate.js || {
    echo "[AccessCore Docker] Migration attempt 1 failed or database still initializing. Retrying in 3 seconds..."
    sleep 3
    node dist/db/migrate.js
  }
  echo "[AccessCore Docker] Database migrations verified and up-to-date."
fi

# Optional auto-seed if AUTO_SEED=true
if [ "$AUTO_SEED" = "true" ] || [ "$AUTO_SEED" = "1" ]; then
  echo "[AccessCore Docker] AUTO_SEED enabled. Seeding identities, documents, and policies..."
  node dist/db/seedAll.js || echo "[AccessCore Docker] Auto-seed encountered a non-fatal warning."
fi

echo "[AccessCore Docker] Launching server process..."
exec "$@"

