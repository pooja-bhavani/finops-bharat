from datetime import date, datetime, timezone
from decimal import Decimal
import logging
import os
from pathlib import Path
import re

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.requests import Request

try:
    from backend.scanner import AWSFinOpsScanner
    from backend.governance import router as governance_router
except ModuleNotFoundError:  # pragma: no cover - support direct backend execution in tests/dev
    from scanner import AWSFinOpsScanner
    from governance import router as governance_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("finops_main")

REGION_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*-\d+$")
AWS_REGION = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "ap-south-1"
scanner = AWSFinOpsScanner(region_name=AWS_REGION)

app = FastAPI(
    title="FinOps-Bharat API",
    description="Read-only AWS account, EC2 inventory, and Cost Explorer data.",
    version="2.0.0",
)
app.include_router(governance_router)

APP_ENV = os.getenv("APP_ENV", "development").lower()
SSO_USER_HEADER = os.getenv("SSO_USER_HEADER", "x-authenticated-user").lower()
PUBLIC_READ_ONLY_DEMO = os.getenv("PUBLIC_READ_ONLY_DEMO", "false").lower() == "true"
PUBLIC_DEMO_GET_PATHS = {
    "/",
    "/api/aws/account",
    "/api/aws/costs",
    "/api/aws/regions",
    "/api/aws/scan",
}


@app.middleware("http")
async def require_sso_identity(request: Request, call_next):
    if APP_ENV == "production" and request.url.path not in {"/api/health", "/api/webhooks/aws-sns"}:
        if not request.headers.get(SSO_USER_HEADER):
            is_public_demo_read = (
                PUBLIC_READ_ONLY_DEMO
                and request.method == "GET"
                and (
                    request.url.path in PUBLIC_DEMO_GET_PATHS
                    or request.url.path.startswith("/assets/")
                )
            )
            if is_public_demo_read:
                return await call_next(request)
            return JSONResponse(
                status_code=401,
                content={"detail": "A valid organization SSO session is required."},
            )
    return await call_next(request)


def _aws_warning_response(operation: str, exc: Exception, **extra: object) -> dict[str, object]:
    logger.exception("AWS %s failed", operation)
    payload: dict[str, object] = {
        "status": "warning",
        "is_live": False,
        "message": f"AWS scan notice: {exc}",
        "ebs_volumes": [],
        "elastic_ips": [],
        "total_savings": 0,
    }
    payload.update(extra)
    return payload


@app.get("/api/health")
def health_check():
    return {"status": "healthy", "service": "FinOps-Bharat API"}


@app.get("/api/aws/account")
def get_aws_account():
    """Return the identity of the server-side AWS credentials in use."""
    try:
        identity = boto3.client("sts", region_name=AWS_REGION).get_caller_identity()
    except (BotoCoreError, ClientError) as exc:
        return _aws_warning_response(
            "identity check",
            exc,
            account_id=None,
            arn=None,
            user_id=None,
            region=AWS_REGION,
        )
    return {
        "account_id": identity["Account"],
        "arn": identity["Arn"],
        "user_id": identity["UserId"],
        "region": AWS_REGION,
    }


@app.get("/api/aws/regions")
def get_aws_regions():
    try:
        regions = scanner.list_enabled_regions()
    except (BotoCoreError, ClientError) as exc:
        return _aws_warning_response("enabled region lookup", exc, regions=[], configured_region=AWS_REGION)
    return {"regions": regions, "configured_region": AWS_REGION}


@app.get("/api/aws/scan")
def scan_cloud_resources(region: str = Query(default=AWS_REGION, min_length=1, max_length=64)):
    normalized_region = region.strip()
    global_scan = normalized_region.lower() == "all"
    if not global_scan and not REGION_PATTERN.fullmatch(normalized_region):
        raise HTTPException(status_code=422, detail="Provide a valid AWS region identifier.")
    try:
        resources = scanner.scan_resources(region_name="all" if global_scan else normalized_region)
    except (BotoCoreError, ClientError) as exc:
        return _aws_warning_response(
            f"inventory scan in {normalized_region}",
            exc,
            account_id=None,
            region=normalized_region,
            scanned_at=datetime.now(timezone.utc).isoformat(),
            resource_count=0,
            resources=[],
            errors=[{"service": "AWS", "operation": "inventory scan", "region": normalized_region, "message": str(exc)}],
        )
    try:
        identity = boto3.client("sts", region_name=AWS_REGION).get_caller_identity()
        account_id = identity.get("Account")
    except (BotoCoreError, ClientError) as exc:
        logger.warning("AWS caller identity lookup failed during inventory scan: %s", exc)
        account_id = None
        scanner.last_scan_metadata.setdefault("errors", []).append({
            "service": "STS",
            "operation": "GetCallerIdentity",
            "region": AWS_REGION,
            "message": str(exc),
        })
    category_counts: dict[str, int] = {}
    service_counts: dict[str, int] = {}
    waste_count = 0
    for resource in resources:
        category = resource["category"]
        service = resource["service"]
        category_counts[category] = category_counts.get(category, 0) + 1
        service_counts[service] = service_counts.get(service, 0) + 1
        waste_count += int(resource["is_waste_candidate"])
    errors = scanner.last_scan_metadata.get("errors", [])
    return {
        "status": "warning" if errors else "ok",
        "is_live": bool(resources) or not errors,
        "message": f"Scan completed with {len(errors)} service warning(s)." if errors else "Live AWS scan complete.",
        "account_id": account_id,
        "region": "all" if global_scan else normalized_region,
        "regions_scanned": scanner.last_scan_metadata.get("regions_scanned", []),
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "resource_count": len(resources),
        "waste_candidate_count": waste_count,
        "category_counts": category_counts,
        "service_counts": service_counts,
        "errors": errors,
        "resources": resources,
    }


def _subtract_months(value: date, months: int) -> date:
    month_index = value.year * 12 + value.month - 1 - months
    year, month = divmod(month_index, 12)
    return date(year, month + 1, 1)


@app.get("/api/aws/costs")
def get_aws_costs():
    """Return actual unblended AWS costs for the last six complete calendar months."""
    end = date.today().replace(day=1)
    start = _subtract_months(end, 6)
    try:
        client = boto3.client("ce", region_name="us-east-1")
        request = {
            "TimePeriod": {"Start": start.isoformat(), "End": end.isoformat()},
            "Granularity": "MONTHLY",
            "Metrics": ["UnblendedCost"],
            "GroupBy": [{"Type": "DIMENSION", "Key": "SERVICE"}],
        }
        monthly_by_date: dict[str, dict[str, str]] = {}
        service_totals: dict[str, Decimal] = {}
        currency = None
        next_token = None
        while True:
            if next_token:
                request["NextPageToken"] = next_token
            response = scanner.get_cost_and_usage(request, ce_client=client)
            for period in response.get("ResultsByTime", []):
                total = period["Total"]["UnblendedCost"]
                period_currency = total["Unit"]
                if currency is not None and period_currency != currency:
                    raise ValueError("Cost Explorer returned inconsistent currencies.")
                currency = period_currency
                month = period["TimePeriod"]["Start"]
                monthly_by_date[month] = {
                    "month": month,
                    "amount": str(Decimal(total["Amount"])),
                    "currency": period_currency,
                }
                for group in period.get("Groups", []):
                    service = group["Keys"][0]
                    service_cost = Decimal(group["Metrics"]["UnblendedCost"]["Amount"])
                    service_totals[service] = service_totals.get(service, Decimal("0")) + service_cost
            next_token = response.get("NextPageToken")
            if not next_token:
                break
    except (BotoCoreError, ClientError) as exc:
        return _aws_warning_response(
            "Cost Explorer query",
            exc,
            period_start=start.isoformat(),
            period_end_exclusive=end.isoformat(),
            currency=None,
            monthly=[],
            services=[],
        )
    except (KeyError, ValueError) as exc:
        logger.exception("Unexpected AWS Cost Explorer response")
        return _aws_warning_response(
            "Cost Explorer response validation",
            exc,
            period_start=start.isoformat(),
            period_end_exclusive=end.isoformat(),
            currency=None,
            monthly=[],
            services=[],
        )

    return {
        "period_start": start.isoformat(),
        "period_end_exclusive": end.isoformat(),
        "currency": currency,
        "monthly": [monthly_by_date[month] for month in sorted(monthly_by_date)],
        "services": [
            {"name": name, "amount": str(amount), "currency": currency}
            for name, amount in sorted(service_totals.items(), key=lambda item: item[1], reverse=True)
        ],
    }


static_dir = Path(os.getenv("STATIC_DIR", Path(__file__).resolve().parent.parent / "static"))
if (static_dir / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")


@app.get("/")
def serve_dashboard():
    index_file = static_dir / "index.html"
    if not index_file.is_file():
        raise HTTPException(status_code=503, detail="Frontend build is not installed.")
    return FileResponse(index_file)
