#!/usr/bin/env bash
# Runs ONE shell command on the server through AWS Systems Manager (no SSH / port 22),
# waits for it, prints the server's output and fails if the command failed.
#
# Usage (GitHub Actions, after aws-actions/configure-aws-credentials):
#   EC2_INSTANCE_ID=i-0123... bash deploy/ssm/ssm-run.sh "<command>" [timeout_seconds]
set -euo pipefail

: "${EC2_INSTANCE_ID:?EC2_INSTANCE_ID is not set (repository variable)}"
CMD="${1:?usage: ssm-run.sh <command> [timeout_seconds]}"
TIMEOUT="${2:-900}"

PARAMS=$(python3 -c 'import json,sys; print(json.dumps({"commands":[sys.argv[1]],"executionTimeout":[sys.argv[2]]}))' "$CMD" "$TIMEOUT")
CMD_ID=$(aws ssm send-command \
  --instance-ids "$EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "${GITHUB_WORKFLOW:-manual} run ${GITHUB_RUN_ID:-local}" \
  --parameters "$PARAMS" \
  --query Command.CommandId --output text)
echo "SSM command id: $CMD_ID"

deadline=$((SECONDS + TIMEOUT + 120))
STATUS=Pending
while :; do
  sleep 5
  STATUS=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$EC2_INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$STATUS" in
    Pending|InProgress|Delayed)
      if [ "$SECONDS" -ge "$deadline" ]; then echo "::error::Timed out waiting for the server"; exit 1; fi
      continue ;;
  esac
  break
done

echo "----- server output -----"
aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$EC2_INSTANCE_ID" \
  --query StandardOutputContent --output text || true
ERR=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$EC2_INSTANCE_ID" \
  --query StandardErrorContent --output text || true)
if [ -n "$ERR" ] && [ "$ERR" != "None" ]; then echo "----- server errors -----"; echo "$ERR"; fi
echo "-------------------------"
# The server command's own exit code (e.g. backend_deploy.sh: 0 = deployed,
# 1 = failed but rolled back healthy, 2 = failed and the rollback was unhealthy).
CODE=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$EC2_INSTANCE_ID" \
  --query ResponseCode --output text 2>/dev/null || echo "")
echo "Status: $STATUS  Exit code: ${CODE:-unknown}"
[ "$STATUS" = "Success" ] && exit 0
echo "::error::Server step finished with status $STATUS (exit code ${CODE:-unknown})"
if [[ "$CODE" =~ ^[0-9]+$ ]] && [ "$CODE" -gt 0 ] && [ "$CODE" -lt 256 ]; then exit "$CODE"; fi
exit 1
