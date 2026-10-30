#!/usr/bin/env bash
# Proves, on the real Linux server, that the deploy / backup / rollback rsync rules keep the
# server's .env, Firebase key and venv while publishing code. Safe: works only in a temporary
# folder under /tmp and touches nothing else.
#
# Run on the server:  bash deploy/ssm/selftest_rsync.sh
# Keep CODE_ONLY identical to backend_deploy.sh / backend_rollback.sh.
set -uo pipefail

CODE_ONLY=(--exclude='/.env' --exclude='/service-account.json' --exclude='/venv/'
           --exclude='__pycache__/' --exclude='*.log')

T=$(mktemp -d /tmp/yazeen-rsync-selftest-XXXXXX)
trap 'rm -rf "$T"' EXIT
pass=0; fail=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }

# Live app folder with server-only files and an obsolete module.
mkdir -p "$T/live/venv/bin" "$T/live/__pycache__" "$T/stage/sub"
echo LIVE_ENV > "$T/live/.env"; echo LIVE_KEY > "$T/live/service-account.json"
echo venv > "$T/live/venv/bin/python"; echo cache > "$T/live/__pycache__/x.pyc"
echo log > "$T/live/app.log"; echo old > "$T/live/old_module.py"; echo v1 > "$T/live/server.py"
# New release (never contains .env / key).
echo v2 > "$T/stage/server.py"; echo new > "$T/stage/new_module.py"; echo s > "$T/stage/sub/a.py"

echo "== 1. Backup of the live release"
rsync -a --delete "${CODE_ONLY[@]}" "$T/live/" "$T/backup/"
check "backup has the code"              '[ "$(cat "$T/backup/server.py")" = v1 ]'
check "backup has NO .env"               '[ ! -e "$T/backup/.env" ]'
check "backup has NO Firebase key"       '[ ! -e "$T/backup/service-account.json" ]'
check "backup has NO venv"               '[ ! -e "$T/backup/venv" ]'

echo "== 2. Publish the new release"
rsync -a --delete "${CODE_ONLY[@]}" "$T/stage/" "$T/live/"
check "new code published"               '[ "$(cat "$T/live/server.py")" = v2 ] && [ -f "$T/live/sub/a.py" ]'
check "obsolete module removed"          '[ ! -e "$T/live/old_module.py" ]'
check ".env kept unchanged"              '[ "$(cat "$T/live/.env")" = LIVE_ENV ]'
check "Firebase key kept unchanged"      '[ "$(cat "$T/live/service-account.json")" = LIVE_KEY ]'
check "venv kept"                        '[ -f "$T/live/venv/bin/python" ]'
check "logs kept"                        '[ -f "$T/live/app.log" ]'

echo "== 3. Secrets change after the backup, then a rollback runs"
echo NEW_ENV > "$T/live/.env"; echo NEW_KEY > "$T/live/service-account.json"
# An older SSH-era backup may still hold old secret copies — they must not come back.
echo OLD_ENV > "$T/backup/.env"; echo OLD_KEY > "$T/backup/service-account.json"
rsync -a --delete "${CODE_ONLY[@]}" "$T/backup/" "$T/live/"
check "old code restored"                '[ "$(cat "$T/live/server.py")" = v1 ] && [ -f "$T/live/old_module.py" ]'
check "release-only files removed"       '[ ! -e "$T/live/new_module.py" ]'
check ".env NOT overwritten by backup"   '[ "$(cat "$T/live/.env")" = NEW_ENV ]'
check "key NOT overwritten by backup"    '[ "$(cat "$T/live/service-account.json")" = NEW_KEY ]'
check "venv still there"                 '[ -f "$T/live/venv/bin/python" ]'

echo
echo "Result: $pass passed, $fail failed  (rsync $(rsync --version | head -1 | awk '{print $3}'))"
[ "$fail" -eq 0 ]
