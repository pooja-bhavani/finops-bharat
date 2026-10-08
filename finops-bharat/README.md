# FinOps-Bharat AWS service

The FastAPI backend serves the built React dashboard and exposes read-only AWS APIs for account identity, enabled regions, EC2 inventory, and Cost Explorer billing data.

## AWS permissions

Attach a least-privilege instance profile/task role to the runtime with:

- `sts:GetCallerIdentity`
- `ec2:DescribeRegions`
- `ec2:DescribeVolumes`
- `ec2:DescribeAddresses`
- `ce:GetCostAndUsage`

Use the standard AWS SDK credential chain. Do not configure browser credentials or commit access keys. Place the service behind the organization's SSO gateway and prevent direct public access to the container. The production container requires a non-empty `X-Authenticated-User` header; configure the gateway to remove any client-provided value and inject the authenticated user. Set `SSO_USER_HEADER` only if the gateway's trusted identity header differs.

## Local API development

From this directory:

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

In another terminal at the repository root, run `npm ci` and `npm run dev`. Vite proxies `/api` requests to port 8000. The API reports AWS errors explicitly if the current local AWS profile lacks permissions.

## Container deployment

Build using the repository root as the Docker context:

```bash
docker build -f finops-bharat/Dockerfile -t finops-bharat .
```

The container serves the dashboard and API on port 8000. Configure `AWS_REGION` (default `ap-south-1`), attach the IAM role, and place the service behind corporate SSO before allowing users to access it.

## API behavior

- `GET /api/aws/account`: STS identity of the server-side runtime role.
- `GET /api/aws/regions`: enabled EC2 regions.
- `GET /api/aws/scan?region=<region>`: unattached EBS volumes and unassociated Elastic IPs in one region.
- `GET /api/aws/costs`: six complete months of actual Cost Explorer unblended costs, grouped by service and returned currency.

The scanner performs no write operations. It does not estimate individual resource charges or savings, or report carbon reductions.
