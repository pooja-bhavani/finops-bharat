# FinOps-Bharat

**Read-only AWS inventory and Cost Explorer data, served through a protected internal dashboard.**

FinOps-Bharat reads the AWS identity attached to its server, scans major AWS compute, storage, database, serverless, networking, security, and management services in a selected region or across opted-in regions, and queries Cost Explorer for six complete months of actual unblended costs. It does not invent per-resource monthly prices, savings, carbon impact, or absent AWS data.

> Live data is available only when this service is deployed with the required AWS runtime role and placed behind the organization’s SSO gateway. Never provide AWS access keys to this chat or enter them into the dashboard or TWS Labs terminal. The dashboard uses its server-side role; the separate terminal does not need AWS credentials.

## In plain words

FinOps-Bharat is a small web app that looks at an AWS account and shows, in one place, what is running and what it has actually cost. It only *reads*. It never creates, changes or deletes anything in the account it scans.

There are two ways to use it:

| | **Connect mode** (public, many users) | **Owner mode** (one account, protected) |
|---|---|---|
| Who it is for | Anyone who wants to scan *their own* AWS account | A team scanning the account the app itself runs in |
| How the app reaches AWS | You create a read-only IAM role and give the app your account ID. No keys. | The server's own IAM role or profile, behind your organization's SSO gateway |
| What visitors see before they connect | Nothing. The host's own account is never shown. | Whatever the gateway lets through |
| Where it is described | [Use the app](#use-the-app-scan-your-own-aws-account) and [Run it yourself](#run-it-yourself-from-git-clone-end-to-end) | The original sections further down (Codespaces, Elastic Beanstalk, SSO gateway) |

Live demo: <http://finops-bharat-env.eba-6yvcbyqr.ap-south-1.elasticbeanstalk.com/>
(The demo is served over plain `http://` for now, so use the full link including `http://`.)

### Contents

- [Why this matters](#why-this-matters) and [Current live capabilities](#current-live-capabilities)
- [Use the app: scan your own AWS account](#use-the-app-scan-your-own-aws-account)
- [Run it yourself from git clone (end to end)](#run-it-yourself-from-git-clone-end-to-end)
- [Run in GitHub Codespaces](#run-in-github-codespaces), [Deploy to AWS Elastic Beanstalk](#deploy-to-aws-elastic-beanstalk) and the rest of the original guide
- [Delete everything and stop costs](#delete-everything-and-stop-costs)

## Why this matters

India's digital public services and growing startup ecosystem depend on reliable cloud infrastructure. Unused disks, idle addresses, forgotten snapshots, and oversized environments can consume public and private budgets while also using energy. Those costs can limit money available for service delivery, innovation, connectivity, and digital skills.

FinOps-Bharat surfaces observed account data for teams to review. An unattached resource is not proof that it is safe to delete, and Cost Explorer totals are not per-resource savings estimates.

## Current live capabilities

- **AWS identity:** display the account and caller ARN returned by STS using the server's runtime credentials.
- **Multi-service inventory:** scan EC2/ECS/EKS/App Runner, EBS/S3/EFS, RDS/DynamoDB/ElastiCache/Redshift, Lambda/API Gateway/SQS/SNS, VPC/NAT/Elastic IP/ELB/CloudFront, KMS/Secrets Manager, and CloudWatch resources in a region or across all opted-in regions. Permission failures are retained as per-service warnings; they do not discard other results.
- **Inventory visualizations:** interactive category and active-versus-idle candidate charts with service quick filters and a grouped AWS region selector.
- **Actual billing data:** display Cost Explorer unblended costs grouped by month and AWS service, in the currency returned by AWS.
- **CSV export:** export the currently displayed live scan results.
- **FinOps learning guide:** interactive lessons use the current account's billing, service totals, and inventory findings as exercises, link to AWS documentation and a billing-alert video, and save completion in this browser per AWS account. Creating actual AWS Budgets or notifications is done in the authorized AWS Billing console; this app is read-only.
- **Linux practice sandbox:** embed the official TWS Labs experience from a separate service. The terminal does not receive this app's AWS credentials; do not enter production credentials into it.
- **Read-only AWS dashboard:** the AWS API routes do not create, modify, or delete AWS resources. Commands typed into the separate terminal are learner-controlled and outside that read-only guarantee.

This release does not provide Cost Explorer resource-level allocation, per-resource prices, carbon estimates, Azure/GCP/OCI integrations, or cleanup automation. These are not substituted with generated or sample values.

## Use the app: scan your own AWS account

This section is for anyone who opens the app and wants to see their own AWS account. It takes about five minutes. You never share a password or an access key.

### No long-term credentials needed

You do not create access keys, you do not share a secret key, and you do not hand over an administrator login. The app only needs two things from you:

- a **read-only IAM role** that you create in your own account with one click (steps below), and
- your **12-digit AWS account ID** (or that role's ARN).

Each time you scan, AWS gives the app short-lived credentials (valid for about an hour) for that role. When you delete the role, or its CloudFormation stack, the app loses access immediately.

### Steps to get your account scanned

1. Open the app and click **Connect AWS** (top right).
2. Click **Launch CloudFormation stack**. The AWS console opens in *your* account with the form already filled in: the app's account ID and a one-time **External ID** that belongs to your browser session. Leave the **Permissions** box empty, tick the IAM acknowledgement box at the bottom, and click **Create stack**. You need permission to create IAM roles (an administrator user is fine).
3. Wait until the stack status shows **CREATE_COMPLETE** (about a minute).
4. Back in the app, type your 12-digit **AWS account ID** (shown at the top right of the AWS console). Or open the stack's **Outputs** tab and paste the `RoleArn` value, which ends with `:role/FinOpsBharatReadOnly`.
5. Click **Verify & connect**. The account card on the left now shows that you are connected.
6. Choose any AWS region from the region menu (or all regions) and click **Run read-only scan** or **Refresh inventory**. Cost data, the resource inventory, containers and ECR, governance checks and the FinOps learning guide all use *your* account.
7. When you are done, click **Disconnect AWS** and delete the stack (see [Delete everything and stop costs](#delete-everything-and-stop-costs)).

The role the stack creates is read-only. It combines AWS's `ViewOnlyAccess` and `SecurityAudit` policies with read access to cost, ECR, EKS and CloudWatch data. It cannot create, change or delete anything.

### Your data is visible to you only, and it is not kept

> **Your AWS data is shown to you and nobody else, and only after your scan has finished.** Scan results and cost figures travel from your account to your browser tab and are held in that tab's memory. The app does not save them: nothing is written to a database or to disk on the server. When you refresh or close the page, the data on screen is gone. If your connection is still active, the page simply asks AWS again, so what you see is always fresh, never a stored copy.
>
> What stays behind is small: a signed session cookie in your own browser (a random session ID and the role ARN, for up to 30 days) so you do not have to reconnect on every visit, plus a few display preferences such as theme and lesson progress in your browser's local storage. **Disconnect AWS** removes the connection cookie.

### What it costs you

- Creating the stack and the IAM role is free.
- Cost Explorer charges about $0.01 for each API request, billed to your own account. The app caches the AWS Resource Metrics panel for 15 minutes to avoid repeat requests, so a normal session typically costs a few cents. Cost Explorer must be enabled in your account, and new data can take up to 24 hours to appear.

### If something goes wrong

| What you see | Usual reason and fix |
|---|---|
| *Could not assume the role (AccessDenied)* | The stack is still creating, or it was created with a different External ID. The External ID is tied to your browser session, so use the same browser. In the Connect window open **"Already created the role before, or connecting from a new browser?"**, copy the current External ID, and in CloudFormation choose **Update stack → Use existing template** and paste it into the `ExternalId` parameter. |
| *Role ARN must look like …* | The ARN must end in `:role/FinOpsBharatReadOnly`. Easiest fix: type your 12-digit account ID instead. |
| *Connect your AWS account to see your data* | You are not connected in this browser yet, or you disconnected. Click **Connect AWS** and verify again. |
| Costs show *Unavailable* | Turn on Cost Explorer in the AWS Billing console and give it up to 24 hours. |
| A service you just created is missing | The app scans when you ask it to. Click **Refresh inventory** and check that the region menu matches the service's region. |

## Run it yourself from git clone (end to end)

Use this section if you want to test the whole app on your own machine, from an empty folder to a finished scan of your own AWS account. The original Codespaces and Elastic Beanstalk instructions follow after it.

### What you need

- **Git**
- **Python 3.11 or newer**
- **Node.js 20 or newer** (the project's Dev Container and Docker image use Node 22)
- **AWS CLI v2** and an AWS account you are allowed to scan
- Credentials the app can use on your machine: an IAM Identity Center (SSO) profile or any other AWS profile. The app uses them only to ask AWS for the short-lived role credentials described above. Do not put access keys in the app or commit them.

### Step 1. Clone the repository

```bash
git clone https://github.com/pooja-bhavani/finops-bharat.git
cd finops-bharat
```

### Step 2. Sign in to AWS on your machine

```bash
aws configure sso --profile finops-bharat
aws sso login --profile finops-bharat
```

If you already use another profile, skip these two commands and use that profile name below. The profile's user or role must be allowed to call `sts:AssumeRole` on `arn:aws:iam::*:role/FinOpsBharatReadOnly` (an administrator can).

### Step 3. Start the API (terminal 1)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

export AWS_PROFILE=finops-bharat
export AWS_REGION=ap-south-1
export FINOPS_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"

uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

`FINOPS_SECRET` makes your session stable. Without it the app still runs, prints a warning, and your connection resets whenever the server restarts. Leave this terminal running.

### Step 4. Start the dashboard (terminal 2)

```bash
cd finops-bharat        # the repository root
npm ci
npm run dev
```

Open <http://localhost:5173>. The dashboard proxies `/api` to the API on port 8000.

### Step 5. Connect your AWS account and scan

Follow [Steps to get your account scanned](#steps-to-get-your-account-scanned). The standard CloudFormation template is published at a public URL, so it works from your laptop too. The "app account" shown in the launch form is the AWS account behind your profile.

### Step 6. Check it end to end

- The account card shows your account ID after **Verify & connect**.
- **Run read-only scan** lists resources that really exist in the region you chose.
- Open the page in a private window: it should say you are not connected and show none of your data.
- Click **Disconnect AWS**: the data disappears and the page asks you to connect again.

### Optional: private single-account mode

To see only the account behind your own profile, with no role or stack at all, start the API with `export FINOPS_ALLOW_SERVER_ACCOUNT=true` in step 3. Use this on your own machine only. Never switch it on for a deployment other people can reach, because it shows the host's account to every visitor.

### Optional: run the container instead

```bash
docker build -t finops-bharat .
docker run --rm -p 8000:8000 \
  -e APP_ENV=development \
  -e FINOPS_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')" \
  -e AWS_PROFILE=finops-bharat -e AWS_REGION=ap-south-1 \
  -v "$HOME/.aws:/root/.aws:ro" \
  finops-bharat
```

Then open <http://localhost:8000>. The container serves the built dashboard and the API on one port.

### Checks and tests

```bash
npm run build
python -m unittest discover -s backend -p 'test_*.py'
```

Some of the older unit tests were written before the Connect feature and may need updating. The walkthrough above is the most reliable end-to-end check.

### Host your own public Connect-mode copy

1. Follow [Deploy to AWS Elastic Beanstalk](#deploy-to-aws-elastic-beanstalk) below to create the environment.
2. Set these environment properties on the environment (never in the frontend build):
   - `FINOPS_SECRET` (required): a long random string. Keep it private and never change it afterwards; changing it disconnects everyone.
   - `COOKIE_SECURE=false` only while the site has no HTTPS. Remove it once HTTPS is in front of the app, so session cookies are HTTPS-only.
   - `FINOPS_TEMPLATE_URL` only if you host your own copy of `backend/src/cloudformation/finops-bharat.yml` on S3. The default points to a public copy.
   - Leave `FINOPS_ALLOW_SERVER_ACCOUNT` unset.
3. Add an inline policy to the instance profile role (for example `aws-elasticbeanstalk-ec2-role`) so the server may assume visitors' roles:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": "sts:AssumeRole",
       "Resource": "arn:aws:iam::*:role/FinOpsBharatReadOnly"
     }]
   }
   ```

4. Keep the environment at one instance unless you move sessions elsewhere, and use the full `http://` or `https://` address when sharing the link. Sessions are kept in signed cookies, so deploys and restarts do not disconnect anyone while `FINOPS_SECRET` stays the same.

## Run in GitHub Codespaces

The included Dev Container uses Node.js 22 and enables Docker-in-Docker for TWS Labs. When creating a new Codespace, or after adding this configuration to an existing one, run **Codespaces: Rebuild Container** from the Command Palette and wait for setup to finish.

### 1. Sign in to AWS

In a Codespaces terminal, configure and sign in to your AWS IAM Identity Center profile. The configure command prompts for your organization's SSO start URL and region, then the login command opens the browser sign-in:

```bash
aws configure sso --profile finops-bharat
aws sso login --profile finops-bharat
```

Use your organization's assigned SSO account and permission set. Do not enter AWS access keys into the app or commit credentials. If your environment already provides AWS credentials through an attached role or another configured profile, use that credential source instead and skip the SSO commands and `export AWS_PROFILE` below.

### 2. Install dependencies and start the API

In the first terminal, from the repository root:

```bash
cd /workspaces/finops-bharat/backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
export AWS_PROFILE=finops-bharat
export AWS_REGION=ap-south-1
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Leave this terminal running. The API uses the AWS SDK credential chain and the selected profile to fetch account data.

### 3. Install dependencies and start the dashboard

Open a second terminal:

```bash
cd /workspaces/finops-bharat
npm ci
npm run dev -- --host 0.0.0.0
```

Leave this terminal running, then open the forwarded **5173** port in Codespaces. The dashboard calls the API on port **8000**.

The Vite server proxies `/api` to the FastAPI service. In local development when the dashboard is opened on `localhost`, the bottom terminal drawer points to `http://localhost:8080` by default. For a production container, set `VITE_TWS_LABS_URL` to the separately hosted TWS Labs HTTPS URL at build time:

```bash
cd /workspaces/finops-bharat
docker build --build-arg VITE_TWS_LABS_URL=https://labs.example.com -t finops-bharat .
```

The container serves the compiled UI and API on port 8000. The runtime must have AWS SDK credentials through an IAM role/profile and must be reachable only through the organization’s SSO gateway. The TWS Labs URL is public build-time configuration, not a credential.

### Temporary public hackathon demo

The Elastic Beanstalk configuration temporarily enables `PUBLIC_READ_ONLY_DEMO`. This allows anonymous GET requests only to the dashboard, its `/assets/*` files, and `/api/aws/account`, `/api/aws/costs`, `/api/aws/regions`, and `/api/aws/scan`. Those APIs expose live account identity, inventory, and billing data to anyone who can reach the URL. All POST requests and other API routes continue to require the trusted identity header. Use a least-privilege read-only instance role, and set `PUBLIC_READ_ONLY_DEMO` to `false` or remove it after judging.

### Deploy to AWS Elastic Beanstalk

The repository-root `Dockerfile` builds the React dashboard and packages it with the FastAPI API; Elastic Beanstalk does not need a prebuilt `dist/` directory. Use the Docker platform and deploy from the repository root so the source bundle includes `Dockerfile`, `backend/`, `src/`, and `.ebextensions/`.

Before creating the environment, configure an Elastic Beanstalk instance profile with the app's reviewed, read-only AWS permissions. Configure the environment in a VPC and put the organization's SSO gateway in front of it; do not allow users to reach the application directly. The production app rejects requests without the trusted `X-Authenticated-User` header, except for its health check and signed AWS SNS endpoint.

With the AWS and Elastic Beanstalk CLIs installed and configured:

```bash
cd /workspaces/finops-bharat
eb init --platform docker --region ap-south-1 finops-bharat
eb create finops-bharat-prod
eb deploy finops-bharat-prod
```

Select the instance profile, VPC/subnets, load balancer, and security groups appropriate for your account when creating the environment. The included `.ebextensions/01_fastapi.config` sets the app region, production mode, port, and `/api/health` health check. Configure integrations such as GitHub and notification webhooks as Elastic Beanstalk environment properties, never as frontend build arguments. `VITE_TWS_LABS_URL` is an optional public build-time URL for the separately hosted TWS Labs service; the dashboard and API work without it.

### Optional DevOps integration configuration

The **DevOps & governance** page calls AWS, GitHub, and webhook APIs when opened. These server-side environment variables enable the corresponding integrations; never put tokens or incoming webhook URLs in frontend build variables:

- `GITHUB_TOKEN`: GitHub token with pull-request read and issue-comment write permissions, used only by the optional CI/CD cost-review comment action.
- `GITHUB_REPOSITORY`: connected repository in `owner/name` form for the optional CI/CD cost-review comment.
- `SLACK_WEBHOOK_URL` and/or `TEAMS_WEBHOOK_URL`: server-side destinations for signed AWS SNS notifications and tag-violation alerts.
- `AWS_SNS_TOPIC_ARN`: exact Cost Anomaly Detection SNS topic ARN allowed to deliver to `/api/webhooks/aws-sns`.

The user-entered Slack/Teams test URL is sent to the API only for that HTTPS test request and is not persisted. In production, SNS delivery relies on AWS SNS signature verification and the configured topic ARN; permit the SNS endpoint through the gateway only with that signature check intact. The alert feed is held in API process memory (up to 100 recent events) and is cleared when the process restarts.

The GitHub cost comment reports actual Cost Explorer service spend for context. It does not claim a PR-specific cost delta: this app does not run a reviewed Terraform plan or AWS Pricing calculation for proposed changes. ECR storage allocation is an indicative share of actual account-level ECR spend, not a deletion recommendation or guaranteed saving. EKS utilization requires Container Insights metrics to be enabled; unavailable metrics are reported as such. Host Docker volumes are intentionally not inspectable because the API container has no Docker socket access.

All cloud governance controls remain read-only: EBS and ECR cleanup controls revalidate candidates and return IDs for human review, and parking returns a schedule proposal. No EBS volumes, ECR images, instances, databases, EventBridge rules, or Lambda functions are changed or created by these endpoints.

## Use TWS Labs from the same Codespace

[TWS Labs](https://github.com/TrainWithShubham/tws-labs) is embedded in a bottom terminal drawer, but remains a separate service and isolated Docker sandbox. FinOps-Bharat does not proxy its HTTP or WebSocket traffic, mount its Docker socket, or pass it AWS credentials.

For local development, open a second terminal and clone TWS Labs beside this repo:

```bash
cd /workspaces
git clone https://github.com/TrainWithShubham/tws-labs.git
cd tws-labs
docker compose up --build
```

The official Compose configuration binds the service to `127.0.0.1:8080`; a locally opened FinOps-Bharat development page uses that URL automatically. For Codespaces or other remote browser access, use a separately hosted TWS Labs URL instead of forwarding the local-profile service. Stop the service with `Ctrl+C` or `docker compose down`. Check the TWS Labs repository for its latest Docker requirements and sandbox controls.

In production, deploy TWS Labs independently with its hosted security profile and its own access controls. Configure its HTTPS URL using `VITE_TWS_LABS_URL` when building this app. The TWS Labs host must permit framing by the FinOps-Bharat origin; the FinOps-Bharat SSO gateway does not automatically protect the separate terminal service. Do not publicly forward the local-profile service from Codespaces: that profile is intentionally loopback-only.

## Tech stack and deployment architecture

### In this repository today

- React and Vite for a responsive single-page interface.
- Recharts for Cost Explorer visualization and Lucide icons for controls.
- React/Vite dashboard served by the FastAPI application in the production container.
- FastAPI/Boto3 API using the standard server-side AWS credential chain; no AWS credentials are sent to the browser.
- Cost Explorer values are actual AWS responses, subject to AWS billing data latency and permissions.
- `backend/multicloud.py` defines normalized cloud inventory records, India-region metadata for AWS/Azure/Google Cloud/OCI, and a catalog-only list of Indian infrastructure options. It is an adapter foundation, not a live integration.
- `backend/compliance.py` compares declared personal-data storage and processing countries with an explicitly configured organizational residency policy. It is a policy check, not a DPDP Act compliance certification.

To run its backend unit tests from the repository root:

```bash
cd /workspaces/finops-bharat
python -m unittest discover -s backend -p 'test_*.py'
```

### Intended production architecture

```text
User browser
  └── HTTPS organization SSO gateway / load balancer
      └── FinOps-Bharat container (React assets + FastAPI)
          ├── STS GetCallerIdentity
          ├── EC2 DescribeRegions and regional read-only service inventory APIs
          └── Cost Explorer GetCostAndUsage
              (all calls use the container's attached read-only IAM role)
  └── Separately hosted TWS Labs service
      (embedded over HTTPS; isolated shell container and independently protected)
```

The region selector lists regions opted into by the account; the global scan walks all such regions and queries global S3 and CloudFront resources once. Set `AWS_REGION` or `AWS_DEFAULT_REGION` for the initial region (default: `ap-south-1`). The dashboard calls Cost Explorer for the last six complete calendar months. Cost Explorer may return delayed or adjusted values; the UI preserves the returned currency and never converts it to INR. Generic per-resource monthly prices are not available from these inventory APIs and remain unset. The existing `multicloud.py` and `compliance.py` modules are not connected to the live UI.

### AWS runtime role and access requirements

- Attach a least-privilege IAM instance profile/task role to the production compute; do not configure static access keys.
- The scanner requires read-only `List*`, `Describe*`, or `Get*` actions for each selected service, plus `sts:GetCallerIdentity`, `ec2:DescribeRegions`, and `ce:GetCostAndUsage`. Grant only actions for services the deployment intends to inventory; inaccessible services are reported as partial-scan warnings.
- The optional governance page also requires the least-privilege read actions used by CloudFormation `ListStacks`/`DescribeStackResources`, EC2 volume/address/instance, RDS instance/tag, EKS cluster/node-group, CloudWatch `ListMetrics`/`GetMetricData`, ECR repository/image, and Cost Explorer APIs. GitHub changes use the separately configured token; no AWS write permissions are needed.
- Put both the UI and `/api/*` behind the organization’s SSO gateway. The production container fails closed unless the gateway injects a non-empty `X-Authenticated-User` header; configure the gateway to strip any client-supplied copy before inserting the authenticated identity. Restrict direct network access to the service so callers cannot bypass the gateway.
- Review and test the SSO gateway, IAM policy, TLS, logging, rate limits, and operational monitoring in the target AWS environment before production traffic.
- Keep recommendations informational. No cleanup API is implemented.

## Savings and emissions methodology

This release does not calculate per-resource savings or emissions. Cost Explorer spend is account/service-level actual billing data, not a prediction or proof of avoidable spend. Any future resource-level price or carbon feature needs a validated source, time period, methodology, and uncertainty disclosure; do not infer savings from an idle-state finding.

## Suggested build roadmap

1. Deploy behind the corporate SSO gateway with the reviewed IAM role and validate account identity and permissions in a non-production environment.
2. Add historical cost allocation, budgets, and anomaly alerts from verified AWS billing sources.
3. Add safe recommendation workflows with owner assignment, approval gates, dry-run, audit history, and rollback/retention checks.
4. Add CloudWatch utilization evidence, multi-account views, tagging/compliance coverage, and sustainability methodology.
5. Add FinOps learning tracks: AWS cost allocation, tagging, rightsizing, budgets, and Terraform/Elastic Beanstalk labs using TWS Labs.
6. Pilot with a small team; validate observed data and billing totals before scaling.

## Important production requirements

Before production traffic, the target environment needs:

- **Identity and network isolation:** a verified organization SSO gateway that strips and injects `X-Authenticated-User`, with direct access to the container blocked.
- **Least privilege:** a reviewed read-only IAM role attached to the runtime. Never put AWS access keys in the browser or source tree.
- **Trustworthy data:** AWS errors are surfaced rather than replaced with fallback values. Cost Explorer billing data can be delayed and does not prove resource-level savings.
- **Production operations:** HTTPS, monitoring and alerting, rate limits, dependency/image scanning, and incident response.
- **Validation:** unit and integration tests with AWS responses, tests for permission-denied/throttled/partial scans, and a pilot in a non-production account before wider use.

## Ideas for future features

After the read-only foundation is reliable, useful additions include multi-account and multi-region views; budgets and anomaly alerts; cost allocation and tag coverage; owner assignment and Slack/email approval workflows; scheduled scan history and verified savings tracking; rightsizing recommendations with utilization evidence; policy/compliance checks; and guided TWS Labs tracks for AWS cost controls, tagging, and safe infrastructure changes. Prioritize features with pilot users and measure accuracy and verified savings rather than treating every flagged resource as waste.

## Local checks

```bash
cd /workspaces/finops-bharat
npm run build
```

## License and attribution

FinOps-Bharat is an independent project concept. TWS Labs is a separate project; use it under its own license and follow its contribution and security guidance. No affiliation or endorsement is implied.

---

## Delete everything and stop costs

Whoever tries the app can remove everything they created. Follow the part that applies to you, then check your bill the next day.

### If you scanned your own account (visitors)

1. In the app, click **Disconnect AWS**.
2. Delete the CloudFormation stack that created the role. In the AWS console open **CloudFormation → Stacks**, select `FinOpsBharatReadOnly`, choose **Delete**, and wait for `DELETE_COMPLETE`. From the command line:

   ```bash
   aws cloudformation delete-stack --stack-name FinOpsBharatReadOnly --region <region you created it in>
   ```

3. Check **IAM → Roles**: `FinOpsBharatReadOnly` should be gone. Delete the stack rather than the role by hand, so CloudFormation does not keep a broken record.
4. Optional: clear the site's cookies in your browser.

The stack and role cost nothing. The only charges they could cause are Cost Explorer requests, and those stop once you disconnect.

### If you ran it on your own machine

1. Stop both terminals with `Ctrl + C`.
2. Remove the project folder:

   ```bash
   cd ..
   rm -rf finops-bharat
   ```

3. Optional: `aws sso logout --profile finops-bharat`, and remove the `[profile finops-bharat]` section from `~/.aws/config`.
4. If you used Docker, run `docker rmi finops-bharat`. If you used GitHub Codespaces, delete the codespace at <https://github.com/codespaces>.

### If you deployed a public copy (hosts)

Work through this list. Deleting these resources takes the live URL offline.

1. **Elastic Beanstalk:** terminate the environment (**Actions → Terminate environment**, or `eb terminate <environment-name>`), then delete the application and its old versions (`aws elasticbeanstalk delete-application --application-name finops-bharat`).
2. **S3:** empty and delete the bucket Elastic Beanstalk created (`elasticbeanstalk-<region>-<account-id>`) and any bucket you made for the CloudFormation template.
3. **In front of the app, if you created them:** CloudFront distribution (disable it, wait, then delete), load balancer, ACM certificate, Route 53 records.
4. **IAM:** remove the inline `sts:AssumeRole` policy from the instance profile role. If a GitHub Action deploys the app, delete the deploy IAM user and its access keys, and remove the repository secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.
5. **Leftovers:** CloudWatch log groups under `/aws/elasticbeanstalk/`, unused Elastic IPs, and any EKS clusters, load balancers or secrets you created while testing.
6. **Verify:** open **Billing → Bills** and **Cost Explorer** the next day, and add a small **Budget** alert so any surprise charge reaches you by email.
