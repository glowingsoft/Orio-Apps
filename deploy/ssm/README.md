# Deploying through AWS Systems Manager (no SSH)

GitHub Actions deploys the backend and the website **without SSH**:

1. The workflow signs in to AWS with **GitHub OIDC** (short-lived credentials — no AWS keys stored in GitHub).
2. It uploads the release (`backend-release.tgz` or `site-release.tgz`) and the deploy script to an S3 **deploy bucket**.
3. It asks **AWS Systems Manager (SSM)** to run the script on the EC2 instance. The SSM agent on the
   server downloads the files from S3 (with the backend venv's boto3 and the instance's IAM role) and runs them as root.
4. The script validates the release in a temporary folder, backs up the live release, publishes,
   restarts, checks health and **rolls back automatically** if anything fails. The full server
   output appears in the GitHub run log.

> This guide describes the setup; it does not mean the setup exists yet. The IAM roles, S3 bucket,
> instance profile, SSM registration and GitHub variables must be created and then proven with the
> acceptance tests at the end.

Files in this folder:

| File | Runs on | Purpose |
| --- | --- | --- |
| `ssm-run.sh` | GitHub runner | Sends one command to the server via SSM, waits, prints the output, fails on failure |
| `ssm-fetch-run.sh` | GitHub runner | Builds the server command: download files from S3, run one of them |
| `backend_deploy.sh` | Server | Unpack + validate in a temp folder → backup → publish (obsolete files removed; `.env`, Firebase key, venv kept) → Firebase key → `pip install` → restart → health check → automatic rollback |
| `backend_rollback.sh` | Server | Manual rollback to the previous release; if that release is unhealthy, the release live before the rollback is put back |
| `web_deploy.sh` | Server | Backup → publish website build → check → restore on failure |
| `web_rollback.sh` | Server | Manual rollback of the website; undone automatically if the restored site does not respond |
| `selftest_rsync.sh` | Server | One-off check (in `/tmp` only) that the rsync rules keep `.env`, the Firebase key and the venv |

## Names used (must match everywhere)

| Item | Value |
| --- | --- |
| Firebase key parameter | `/yazeen/prod/firebase-service-account` (set in `.github/workflows/backend.yml` as `FIREBASE_PARAM`; the IAM policies below allow `parameter/yazeen/prod/*`) |
| Deploy object prefix | `deploys/` in the deploy bucket |
| Server paths | backend `/home/ubuntu/orio` (venv inside), service `orio`, website `/var/www/html` |

If a different parameter path is agreed with AAZABEX, change `FIREBASE_PARAM` **and** both policies together.

---

## One-time setup (AAZABEX AWS account)

Replace `<ACCOUNT_ID>`, `<REGION>` (the EC2 region, e.g. `us-east-2`), `<INSTANCE_ID>`,
`<DEPLOY_BUCKET>` and `<ORG>/<REPO>` (the company GitHub repository) below.

### 1. Deploy bucket

Create a private S3 bucket, e.g. `aazabex-yazeen-deploys` (Block all public access: on).
Add a lifecycle rule that deletes objects under `deploys/` after **30 days**.

### 2. Server prerequisites

On the server:

```bash
sudo snap services amazon-ssm-agent                                   # should say "active"
/home/ubuntu/orio/venv/bin/python -c "import boto3; print('boto3 OK')"  # downloads use the venv's boto3
bash deploy/ssm/selftest_rsync.sh   # copy the script to the server first; must end "0 failed"
```

`selftest_rsync.sh` proves on the server's own rsync that publishing removes obsolete code but keeps
`.env`, the Firebase key and the venv, and that a rollback can never bring back old copies of those
files. It only works inside a temporary folder under `/tmp`.

The instance needs **outbound HTTPS** to the SSM endpoints (`ssm`, `ssmmessages`, `ec2messages`),
S3 and, for the Firebase key, Parameter Store. A public-subnet instance with normal internet access
has this. In a private subnet, add VPC interface endpoints for `ssm`, `ssmmessages`, `ec2messages`
and a gateway endpoint for S3 (or another outbound route).

### 3. IAM role for the EC2 instance

IAM → Roles → Create role → **AWS service: EC2**. Attach the managed policy
**`AmazonSSMManagedInstanceCore`**, plus this inline policy (`yazeen-deploy-instance`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<DEPLOY_BUCKET>/deploys/*" },
    { "Effect": "Allow", "Action": "ssm:GetParameter",
      "Resource": "arn:aws:ssm:<REGION>:<ACCOUNT_ID>:parameter/yazeen/prod/*" }
  ]
}
```

**KMS:** if the SecureString parameter uses a **customer-managed KMS key** (not the default
`aws/ssm` key), allow `kms:Decrypt` on that key for this role and `kms:Encrypt` for the GitHub
deploy role (step 4). If the deploy bucket uses **SSE-KMS with a customer-managed key**, allow
`kms:Decrypt` here and `kms:GenerateDataKey` for the GitHub deploy role. With the AWS-managed
default keys no extra KMS permissions are needed.

EC2 → the instance → Actions → Security → **Modify IAM role** → choose this role.
After a minute the instance appears in **Systems Manager → Fleet Manager** as *Online*.

> If the backend currently reads S3 media with access keys in `.env`, those keep working. The
> instance role can later also receive the media-bucket permissions so the keys can be removed.

### 4. GitHub OIDC provider and deploy role

IAM → Identity providers → Add provider → **OpenID Connect**:
- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

IAM → Roles → Create role → **Web identity** → that provider. Trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": "repo:<ORG>/<REPO>:environment:dev" }
    }
  }]
}
```

(The deploy and rollback jobs run in the GitHub environment `dev`, which is what the `sub` above matches.)

Permissions — inline policy `yazeen-github-deploy`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::<DEPLOY_BUCKET>/deploys/*" },
    { "Effect": "Allow", "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ec2:<REGION>:<ACCOUNT_ID>:instance/<INSTANCE_ID>",
        "arn:aws:ssm:<REGION>::document/AWS-RunShellScript"
      ] },
    { "Effect": "Allow", "Action": "ssm:GetCommandInvocation", "Resource": "*" },
    { "Effect": "Allow", "Action": "ssm:PutParameter",
      "Resource": "arn:aws:ssm:<REGION>:<ACCOUNT_ID>:parameter/yazeen/prod/*" }
  ]
}
```

Name the role e.g. `yazeen-github-deploy` and copy its ARN.

### 5. GitHub settings

The workflows read the AWS values as **variables** (`vars.*`) in their top-level `env:` block.
Create them as **repository-level** Actions variables (Settings → Secrets and variables → Actions →
Variables → *Repository variables*). Don't put them only in the `dev` environment: environment
variables are attached to individual jobs and may not be available to the workflow-level `env:`.

| Variable | Value |
| --- | --- |
| `AWS_REGION` | `<REGION>` |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<ACCOUNT_ID>:role/yazeen-github-deploy` |
| `DEPLOY_BUCKET` | `<DEPLOY_BUCKET>` |
| `EC2_INSTANCE_ID` | `<INSTANCE_ID>` |

Secrets: `EXPO_ENV` (website build values) and `FIREBASE_SERVICE_ACCOUNT` are already set.
`EXPO_TOKEN` is only needed for the **Android build** job in the frontend workflow (it starts an
EAS build on each push to `frontend`); the website deploy works without it. Create it at
expo.dev → Account settings → Access tokens (for the `aazabex` organisation).

`SSH_HOST`, `SSH_USER` and `SSH_PRIVATE_KEY` are no longer used by the workflows. Delete them only
after the acceptance tests below have passed.

### 6. SSH

Keep SSH (port 22) restricted to approved administrator IPs during the initial SSM testing.
Close port 22 only after backend deployment, website deployment, manual rollback (backend and
website) and **Session Manager** shell access have all been tested successfully.
Don't remove the server's SSH keys until you have confirmed no other administrator or process
still depends on them.

---

## How to run

| Action | Where |
| --- | --- |
| Deploy backend | Push to `backend`, or Actions → **backend** → Run workflow → `deploy` |
| Deploy website (+ Android build) | Push to `frontend`, or Actions → **frontend** → Run workflow → `deploy` |
| Roll back backend | Actions → **backend** → Run workflow → `rollback` |
| Roll back website | Actions → **frontend** → Run workflow → `rollback` |
| Test automatic rollback | Actions → **backend** → Run workflow → `test-auto-rollback` |

`test-auto-rollback` deploys the branch with a **simulated** failed health check, so the deploy
script must roll back on its own. The run passes only if the server script exits with **code 1**
(failed → rolled back → previous release healthy) **and** prints that marker; code 0 (no rollback)
or 2 (rollback unhealthy) fails it. Run it **right after a successful deploy of the same commit**,
so the "new" and "previous" releases are identical — it still restarts the service, so do it in
a quiet period / maintenance window, or on staging once it exists. Never break the production
backend on purpose to test this.

Server script exit codes (shown in the log as `Exit code: N`): `0` success · `1` failed and rolled
back to a healthy release · `2` failed and the rollback is not healthy — check the server.

## Acceptance checklist (evidence for the client)

| Test | Required evidence |
| --- | --- |
| rsync rules on the server | `selftest_rsync.sh` output ending `0 failed` |
| EC2 registered in SSM | Fleet Manager shows the instance **Online** (screenshot) |
| GitHub OIDC | A workflow log showing the "configure-aws-credentials" step assumed the role |
| Backend deployment | GitHub log: publish, health check, `Deployed revision: <commit>` |
| Website deployment | GitHub log: publish and `Site OK` |
| Backend manual rollback | `rollback` run succeeds; log shows live and restored revisions; `.env` unchanged afterwards |
| Website manual rollback | frontend `rollback` run succeeds and the site serves the previous `REVISION` |
| Automatic rollback | `test-auto-rollback` run passes ("Automatic rollback verified") |
| SSH restriction | Security group no longer allows `0.0.0.0/0` on port 22 (screenshot) |
| Revision verification | `/home/ubuntu/orio/REVISION` and `https://aazabex.com/REVISION` match the deployed commits |

After the rollback tests, deploy again so the latest release is live.
