#!/usr/bin/env bash
# Runs ON THE SERVER (as root, via AWS SSM). Publishes a website build and restores the
# previous site automatically if the new one does not respond.
# Usage: web_deploy.sh <site.tar.gz>
set -euo pipefail

WEB_DIR=/var/www/html
BACKUP_DIR=/var/www/html.prev
SITE_URL=${SITE_URL:-https://aazabex.com/}
REL="${1:?usage: web_deploy.sh <site.tar.gz>}"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "== $(date -u +%FT%TZ) Deploying website $(tar -xzOf "$REL" ./REVISION 2>/dev/null | head -1)"
tar -xzf "$REL" -C "$STAGE"
[ -f "$STAGE/index.html" ] || { echo "Build has no index.html — not deploying"; exit 1; }

echo "== Backing up current site to $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
rsync -a --delete "$WEB_DIR/" "$BACKUP_DIR/"

echo "== Publishing"
rsync -a --delete --chmod=D755,F644 "$STAGE/" "$WEB_DIR/"

for _ in $(seq 1 10); do
  if curl -sf "$SITE_URL" | grep -qi '<script'; then echo "== Site OK"; exit 0; fi
  sleep 3
done
echo "== Site check failed — restoring the previous site"
rsync -a --delete "$BACKUP_DIR/" "$WEB_DIR/"
exit 1
