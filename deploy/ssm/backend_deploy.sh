#!/usr/bin/env bash
# Runs ON THE SERVER (as root, sent by GitHub Actions through AWS SSM).
# Installs a backend release and rolls back automatically if anything fails.
#
# Usage: backend_deploy.sh <release.tar.gz> [<firebase-parameter-name> | -]
#   release.tar.gz   backend/ packed by the workflow (never contains .env, keys or venv)
#   firebase param   SSM Parameter Store SecureString holding the Firebase service-account
#                    JSON; "-" keeps the key file already on the server
# Env:
#   SIMULATE_HEALTH_FAILURE=1   treat the health check as failed (safe automatic-rollback test)
set -euo pipefail

BACKEND_DIR=/home/ubuntu/orio
VENV_DIR=$BACKEND_DIR/venv
BACKUP_DIR=/home/ubuntu/orio.prev
SERVICE=orio
OWNER=ubuntu
HEALTH_URL=${HEALTH_URL:-https://aazabex.com/api/health}

# Code-only transfers: server-only files are never copied in EITHER direction (so a backup
# or restore can't overwrite the live .env / Firebase key) and, being excluded, are never
# deleted on the receiving side either.
CODE_ONLY=(--exclude='/.env' --exclude='/service-account.json' --exclude='/venv/'
           --exclude='__pycache__/' --exclude='*.log')

REL="${1:?usage: backend_deploy.sh <release.tar.gz> [firebase-param|-]}"
FB_PARAM="${2:--}"

[ -f "$BACKEND_DIR/server.py" ] && [ -x "$VENV_DIR/bin/pip" ] \
  || { echo "Expected $BACKEND_DIR/server.py and $VENV_DIR/bin/pip on the server"; exit 1; }

STAGE=$(mktemp -d /tmp/yazeen-release-XXXXXX)
trap 'rm -rf "$STAGE"' EXIT

echo "== $(date -u +%FT%TZ) Deploying $(tar -xzOf "$REL" ./REVISION 2>/dev/null | head -1)"
echo "== Running now: $(head -1 "$BACKEND_DIR/REVISION" 2>/dev/null || echo unknown)"

# 1) Unpack and validate in a temporary folder — nothing live is touched yet.
echo "== Unpacking and validating the release"
tar -xzf "$REL" -C "$STAGE"
# Everything the API needs at runtime (server.py imports these modules).
REQUIRED=(server.py requirements.txt REVISION push.py admin_dashboard.py admin_phase1.py
          account_deletion.py moderation.py)
for f in "${REQUIRED[@]}"; do
  [ -f "$STAGE/$f" ] || { echo "Release is missing $f — not deploying"; exit 1; }
done
for f in .env service-account.json; do
  [ ! -e "$STAGE/$f" ] || { echo "Release unexpectedly contains $f — not deploying"; exit 1; }
done
# Compile every Python file in the release (syntax errors stop the deploy before anything changes).
"$VENV_DIR/bin/python" -m compileall -q -x '/(venv|tests)/' "$STAGE" >/dev/null \
  || { echo "Release has Python syntax errors — not deploying"; exit 1; }
"$VENV_DIR/bin/python" -c "import boto3" 2>/dev/null || echo "WARN: boto3 missing in the venv"

# 2) Back up the live release — code only (never the .env / Firebase key, see CODE_ONLY).
echo "== Backing up the live release to $BACKUP_DIR"
rsync -a --delete "${CODE_ONLY[@]}" "$BACKEND_DIR/" "$BACKUP_DIR/"
rm -f "$BACKUP_DIR/.env" "$BACKUP_DIR/service-account.json"   # stray copies from older SSH-era backups

rollback() {
  echo "== Deploy failed — restoring the previous release from $BACKUP_DIR"
  rsync -a --delete "${CODE_ONLY[@]}" "$BACKUP_DIR/" "$BACKEND_DIR/"
  chown -R "$OWNER:$OWNER" "$BACKEND_DIR" || true
  systemctl restart "$SERVICE" || true
  for _ in $(seq 1 30); do
    if curl -sf "$HEALTH_URL" | grep -q '"db":true'; then
      echo "== Rolled back and healthy: $(head -1 "$BACKEND_DIR/REVISION" 2>/dev/null || echo unknown)"
      exit 1
    fi
    sleep 2
  done
  echo "== WARNING: the previous release did not pass the health check either — check the server now"
  journalctl -u "$SERVICE" -n 50 --no-pager || true
  exit 2
}

# 3) Publish: same file set as the release (obsolete files removed), server-only files kept.
echo "== Publishing (files below are no longer part of the code and will be removed):"
rsync -an --delete --itemize-changes "${CODE_ONLY[@]}" "$STAGE/" "$BACKEND_DIR/" | grep '^\*deleting' || echo "   (none)"
rsync -a --delete "${CODE_ONLY[@]}" "$STAGE/" "$BACKEND_DIR/" || rollback
chown -R "$OWNER:$OWNER" "$BACKEND_DIR" || rollback

if [ "$FB_PARAM" != "-" ]; then
  echo "== Writing Firebase key from Parameter Store ($FB_PARAM)"
  "$VENV_DIR/bin/python" - "$FB_PARAM" "$BACKEND_DIR/service-account.json" <<'PY' || rollback
import json, os, sys
import boto3
value = boto3.client("ssm").get_parameter(Name=sys.argv[1], WithDecryption=True)["Parameter"]["Value"]
data = json.loads(value)
assert data.get("type") == "service_account" and data.get("private_key"), "not a service-account JSON"
fd = os.open(sys.argv[2], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.write(value)
PY
  chown "$OWNER:$OWNER" "$BACKEND_DIR/service-account.json"
  chmod 600 "$BACKEND_DIR/service-account.json"
fi

echo "== Installing requirements"
sudo -u "$OWNER" "$VENV_DIR/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt" || rollback

echo "== Restarting $SERVICE"
systemctl restart "$SERVICE" || rollback

echo "== Health check ($HEALTH_URL)"
if [ "${SIMULATE_HEALTH_FAILURE:-0}" = "1" ]; then
  echo "== SIMULATE_HEALTH_FAILURE=1 — treating the health check as failed (automatic-rollback test)"
  rollback
fi
for _ in $(seq 1 30); do
  if curl -sf "$HEALTH_URL" | grep -q '"db":true'; then
    curl -s "$HEALTH_URL"; echo
    echo "== Deployed revision: $(head -1 "$BACKEND_DIR/REVISION" 2>/dev/null || echo unknown)"
    exit 0
  fi
  sleep 2
done
journalctl -u "$SERVICE" -n 50 --no-pager || true
rollback
