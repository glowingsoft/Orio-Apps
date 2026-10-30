#!/usr/bin/env bash
# On the server (through SSM): download files from s3://$DEPLOY_BUCKET/<prefix>/ into a
# temporary folder, then run one of them there. Uses the backend venv's boto3, so the
# server needs no AWS CLI; credentials come from the instance's IAM role.
#
# Usage (GitHub Actions):
#   bash deploy/ssm/ssm-fetch-run.sh <s3-prefix> "<files to fetch>" "<command run in that folder>" [timeout]
# Example:
#   bash deploy/ssm/ssm-fetch-run.sh deploys/backend/123 "backend-release.tgz backend_deploy.sh" \
#        "bash ./backend_deploy.sh ./backend-release.tgz -"
set -euo pipefail

: "${DEPLOY_BUCKET:?DEPLOY_BUCKET is not set (repository variable)}"
: "${AWS_REGION:?AWS_REGION is not set (repository variable)}"
PREFIX="${1:?s3 prefix}"
FILES="${2:?files to fetch}"
RUN="${3:?command to run}"
TIMEOUT="${4:-900}"

PY='import boto3, sys; s3 = boto3.client("s3"); [s3.download_file(sys.argv[1], sys.argv[2] + "/" + n, n) for n in sys.argv[3:]]'

REMOTE=$(cat <<EOF
set -e
export AWS_DEFAULT_REGION='$AWS_REGION'
D=\$(mktemp -d /tmp/yazeen-deploy-XXXXXX)
cd "\$D"
/home/ubuntu/orio/venv/bin/python -c '$PY' '$DEPLOY_BUCKET' '$PREFIX' $FILES
set +e
$RUN
rc=\$?
cd /; rm -rf "\$D"
exit \$rc
EOF
)

exec bash "$(dirname "$0")/ssm-run.sh" "$REMOTE" "$TIMEOUT"
