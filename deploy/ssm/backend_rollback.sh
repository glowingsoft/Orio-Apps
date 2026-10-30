#!/usr/bin/env bash
# Runs ON THE SERVER (as root, via AWS SSM) — manual rollback of the backend to the release
# saved by the last deploy (/home/ubuntu/orio.prev). If the restored release fails its
# health check, the release that was live before the rollback is put back automatically.
set -euo pipefail

BACKEND_DIR=/home/ubuntu/orio
BACKUP_DIR=/home/ubuntu/orio.prev
UNDO_DIR=/home/ubuntu/orio.before-rollback
SERVICE=orio
OWNER=ubuntu
HEALTH_URL=${HEALTH_URL:-https://aazabex.com/api/health}
# Code-only transfers: server-only files are never copied in EITHER direction (so a backup
# or restore can't overwrite the live .env / Firebase key) and, being excluded, are never
# deleted on the receiving side either.
CODE_ONLY=(--exclude='/.env' --exclude='/service-account.json' --exclude='/venv/'
           --exclude='__pycache__/' --exclude='*.log')

healthy() {
  for _ in $(seq 1 30); do
    if curl -sf "$HEALTH_URL" | grep -q '"db":true'; then curl -s "$HEALTH_URL"; echo; return 0; fi
    sleep 2
  done
  return 1
}

[ -f "$BACKUP_DIR/server.py" ] || { echo "No previous release in $BACKUP_DIR — nothing to roll back to"; exit 1; }

echo "== $(date -u +%FT%TZ) Backend rollback"
echo "== Live now:  $(head -1 "$BACKEND_DIR/REVISION" 2>/dev/null || echo unknown)"
echo "== Restoring: $(head -1 "$BACKUP_DIR/REVISION" 2>/dev/null || echo unknown)"

# Keep the live release (code only) so a failed rollback can be undone.
rsync -a --delete "${CODE_ONLY[@]}" "$BACKEND_DIR/" "$UNDO_DIR/"
rm -f "$UNDO_DIR/.env" "$UNDO_DIR/service-account.json"

rsync -a --delete "${CODE_ONLY[@]}" "$BACKUP_DIR/" "$BACKEND_DIR/"
chown -R "$OWNER:$OWNER" "$BACKEND_DIR"
sudo -u "$OWNER" "$BACKEND_DIR/venv/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt" || true
systemctl restart "$SERVICE"

if healthy; then
  echo "== Rolled back. Running: $(head -1 "$BACKEND_DIR/REVISION" 2>/dev/null || echo unknown)"
  exit 0
fi

echo "== Restored release is unhealthy — putting back the release that was live before the rollback"
journalctl -u "$SERVICE" -n 30 --no-pager || true
rsync -a --delete "${CODE_ONLY[@]}" "$UNDO_DIR/" "$BACKEND_DIR/"
chown -R "$OWNER:$OWNER" "$BACKEND_DIR"
systemctl restart "$SERVICE"
if healthy; then
  echo "== Rollback aborted; the original release is live again: $(head -1 "$BACKEND_DIR/REVISION" 2>/dev/null || echo unknown)"
  exit 1
fi
echo "== WARNING: neither release passes the health check — check the server now"
exit 2
