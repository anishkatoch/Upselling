#!/bin/sh
# Start-up for every role (API or worker): make sure the data folder exists, is writable by the app user,
# and has the sample data the first time it is empty (a fresh persistent disk), then hand over to the command.
set -e
seed() { [ -d /app/data/jobs ] || cp -a /app/seed/. /app/data/ 2>/dev/null || true; }
mkdir -p /app/data /tmp/upsell-poc
if [ "$(id -u)" = "0" ]; then
  seed
  chown -R app:app /app/data /tmp/upsell-poc
  exec runuser -u app -- "$@"
fi
seed
exec "$@"
