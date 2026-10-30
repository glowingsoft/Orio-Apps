#!/usr/bin/env bash
# Runs ON THE SERVER (as root, via AWS SSM) — manual rollback of the website to the build
# saved by the last deploy. If the restored site does not respond, the site that was live
# before the rollback is put back automatically.
set -euo pipefail

WEB_DIR=/var/www/html
BACKUP_DIR=/var/www/html.prev
UNDO_DIR=/var/www/html.before-rollback
SITE_URL=${SITE_URL:-https://aazabex.com/}

site_ok() {
  for _ in $(seq 1 10); do
    if curl -sf "$SITE_URL" | grep -qi '<script'; then return 0; fi
    sleep 3
  done
  return 1
}

[ -f "$BACKUP_DIR/index.html" ] || { echo "No previous site in $BACKUP_DIR — nothing to roll back to"; exit 1; }
echo "== $(date -u +%FT%TZ) Website rollback"
echo "== Live now:  $(head -1 "$WEB_DIR/REVISION" 2>/dev/null || echo unknown)"
echo "== Restoring: $(head -1 "$BACKUP_DIR/REVISION" 2>/dev/null || echo unknown)"

mkdir -p "$UNDO_DIR"
rsync -a --delete "$WEB_DIR/" "$UNDO_DIR/"
rsync -a --delete "$BACKUP_DIR/" "$WEB_DIR/"

if site_ok; then
  echo "== Site OK after rollback. Live: $(head -1 "$WEB_DIR/REVISION" 2>/dev/null || echo unknown)"
  exit 0
fi
echo "== Restored site does not respond — putting back the site that was live before the rollback"
rsync -a --delete "$UNDO_DIR/" "$WEB_DIR/"
if site_ok; then echo "== Rollback aborted; the original site is live again"; exit 1; fi
echo "== WARNING: neither site version responds — check nginx now"
exit 2
