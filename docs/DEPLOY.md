# How FinOps-Bharat is deployed

FinOps-Bharat runs as one Docker container on AWS Elastic Beanstalk (single instance, region `ap-south-1`).
A push to `master` tests the code, builds it, and deploys it automatically.

## The pipeline (`.github/workflows/deploy.yml`)

1. **test job** – installs the backend and runs `python -m pytest backend`. If a test fails, nothing is deployed.
2. **deploy job** (only after tests pass) – builds the React front end, zips the app, and sends it to Elastic Beanstalk
   with `einaregilsson/beanstalk-deploy`. Each version is labelled `autodeploy-<commit sha>`.
3. Elastic Beanstalk builds the `Dockerfile` (multi-stage: Node builds the front end, Python runs FastAPI on port 8000)
   and swaps in the new version.

GitHub repository secrets used by the deploy job: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (a dedicated, deploy-only IAM user).

## Elastic Beanstalk environment

| Setting | Value |
|---|---|
| Application / environment | `finops-bharat` / `Finops-bharat-env` |
| Platform | Docker (Amazon Linux), single instance |
| Region | `ap-south-1` |

### Environment properties (names only, never commit values)

| Name | What it does |
|---|---|
| `FINOPS_SECRET` | Long random secret. Signs session cookies and derives each visitor's External ID. Required in production. |
| `COOKIE_SECURE` | `false` while the site is plain HTTP, `true` once HTTPS is on. |
| `APP_ENV` | `production`. |
| `FINOPS_TEMPLATE_URL` | Public link to the CloudFormation template visitors launch (has a built-in default). |
| `APP_AWS_ACCOUNT_ID` | The account ID that visitors' roles must trust. |
| `FINOPS_ROLE_NAME` | Name of the role the template creates (`FinOpsBharatReadOnly`). |
| `FINOPS_SESSION_DAYS` | How long a visitor stays connected (default 30). |
| `FINOPS_DEFAULT_REGION` | Default region for scans. |
| `FINOPS_ALLOW_SERVER_ACCOUNT` | Leave `false` so visitors can never see the server's own account. |

The Beanstalk instance profile needs permission for `sts:AssumeRole` on `arn:aws:iam::*:role/FinOpsBharatReadOnly`.

## How a visitor connects (infrastructure as code)

The visitor launches `backend/src/cloudformation/finops-bharat.yml` in their own account. It creates one read-only IAM role
that trusts this app's account only when the request carries the visitor's unique External ID. The app assumes it for
about an hour at a time and keeps the credentials in memory only. Deleting the stack removes all access.

## Run the tests locally

```bash
pip install -r backend/requirements.txt -r backend/requirements-dev.txt
python -m pytest backend -q
```

Tests use `moto` to fake AWS, so they never touch a real account.

## Observability

- Elastic Beanstalk health and events show the state of each deploy.
- `/api/health` is the app's own health check.
- Not set up yet (planned): CloudWatch Logs streaming, an alarm on environment health, and an uptime check.

## Rolling back

In Elastic Beanstalk open *Application versions*, pick an earlier `autodeploy-<sha>` and choose *Deploy*.
