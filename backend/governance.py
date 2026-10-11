"""Containers, ECR, tagging, parking and webhook endpoints for FinOps-Bharat.

Every AWS call here uses the CALLER'S boto3 session (get_boto_session), i.e. the role the visitor
connected, so a visitor only ever sees their own account. All actions are review/plan only:
nothing is created, changed or deleted in AWS.
"""
from __future__ import annotations

import logging
import re
import json
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse

from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

try:
    from backend.connect import get_boto_session
except ModuleNotFoundError:  # pragma: no cover - direct backend execution
    from connect import get_boto_session

logger = logging.getLogger("finops_governance")
router = APIRouter(tags=["governance"])

REGION_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*-\d+$")
REQUIRED_TAGS = ("Owner", "Environment", "CostCenter")
STALE_IMAGE_DAYS = 60
MAX_ECR_REPOSITORIES = 100
MAX_ECR_IMAGES = 5000
MAX_CLUSTERS = 20
_BOTO_CONFIG = Config(retries={"max_attempts": 3, "mode": "standard"}, connect_timeout=5, read_timeout=20)
ALLOWED_WEBHOOK_HOSTS = ("hooks.slack.com", "outlook.office.com")
ALLOWED_WEBHOOK_SUFFIXES = (".webhook.office.com",)


# ------------------------------------------------------------------------------ helpers
def _region(value: str) -> str:
    region = (value or "").strip()
    if not REGION_PATTERN.fullmatch(region):
        raise HTTPException(status_code=422, detail="Provide a valid AWS region identifier.")
    return region


def _client(request: Request, service: str, region: str):
    return get_boto_session(request).client(service, region_name=region, config=_BOTO_CONFIG)


def _aws_error(operation: str, exc: Exception) -> HTTPException:
    if isinstance(exc, ClientError):
        err = exc.response.get("Error", {})
        message = err.get("Message") or err.get("Code") or str(exc)
    else:
        message = str(exc)
    logger.warning("%s failed: %s", operation, message)
    return HTTPException(status_code=502, detail=f"AWS {operation} failed: {message}")


def _tags_to_dict(tags: list[dict] | None) -> dict[str, str]:
    return {t.get("Key", ""): t.get("Value", "") for t in tags or []}


def _name(tags: dict[str, str], fallback: str) -> str:
    return tags.get("Name") or fallback


# ------------------------------------------------------------------------------ EKS
@router.get("/api/k8s/inventory")
def k8s_inventory(request: Request, region: str = Query(..., min_length=1, max_length=64)):
    region = _region(region)
    try:
        eks = _client(request, "eks", region)
        cw = _client(request, "cloudwatch", region)
        names: list[str] = []
        for page in eks.get_paginator("list_clusters").paginate():
            names.extend(page.get("clusters", []))
    except (BotoCoreError, ClientError) as exc:
        raise _aws_error("EKS cluster lookup", exc) from exc

    clusters = []
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=1)
    for name in names[:MAX_CLUSTERS]:
        warnings: list[str] = []
        status, version, nodegroups = "", "", []
        try:
            info = eks.describe_cluster(name=name)["cluster"]
            status, version = info.get("status", ""), info.get("version", "")
        except (BotoCoreError, ClientError) as exc:
            warnings.append(f"Could not describe cluster: {exc}")
        try:
            for page in eks.get_paginator("list_nodegroups").paginate(clusterName=name):
                for group in page.get("nodegroups", []):
                    ng = eks.describe_nodegroup(clusterName=name, nodegroupName=group)["nodegroup"]
                    nodegroups.append({
                        "name": group,
                        "desired_size": ng.get("scalingConfig", {}).get("desiredSize"),
                        "instance_types": ng.get("instanceTypes", []),
                    })
        except (BotoCoreError, ClientError) as exc:
            warnings.append(f"Could not list node groups: {exc}")

        metrics = []
        queries = []
        for idx, metric in enumerate(("node_cpu_utilization", "node_memory_utilization")):
            queries.append({
                "Id": f"m{idx}",
                "MetricStat": {
                    "Metric": {"Namespace": "ContainerInsights", "MetricName": metric,
                               "Dimensions": [{"Name": "ClusterName", "Value": name}]},
                    "Period": 300, "Stat": "Average",
                },
                "ReturnData": True,
            })
        try:
            data = cw.get_metric_data(MetricDataQueries=queries, StartTime=start, EndTime=end, ScanBy="TimestampDescending")
            by_id = {r["Id"]: r for r in data.get("MetricDataResults", [])}
            for idx, metric in enumerate(("node_cpu_utilization", "node_memory_utilization")):
                values = by_id.get(f"m{idx}", {}).get("Values", [])
                metrics.append({
                    "metric": metric,
                    "latest_value": values[0] if values else None,
                    "dimensions": {"ClusterName": name},
                })
            if all(m["latest_value"] is None for m in metrics):
                warnings.append("No Container Insights datapoints in the last hour. Enable Container Insights on this cluster to see utilization.")
        except (BotoCoreError, ClientError) as exc:
            warnings.append(f"Could not read CloudWatch metrics: {exc}")
        clusters.append({
            "name": name, "status": status, "version": version, "nodegroups": nodegroups,
            "warnings": warnings, "container_insights_metrics": metrics,
        })
    return {"region": region, "clusters": clusters}


# ------------------------------------------------------------------------------ ECR
def _ecr_monthly_cost(request: Request) -> dict:
    """Last full month's actual ECR spend from Cost Explorer (one billed API request)."""
    end = date.today().replace(day=1)
    start = (end - timedelta(days=1)).replace(day=1)
    try:
        ce = _client(request, "ce", "us-east-1")
        result = ce.get_cost_and_usage(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
            Granularity="MONTHLY", Metrics=["UnblendedCost"],
            Filter={"Dimensions": {"Key": "SERVICE", "Values": ["Amazon EC2 Container Registry (ECR)"]}},
        )
        periods = result.get("ResultsByTime", [])
        if not periods:
            return {"amount": None, "currency": None}
        total = periods[0]["Total"]["UnblendedCost"]
        return {"amount": total["Amount"], "currency": total["Unit"]}
    except (BotoCoreError, ClientError, KeyError, HTTPException):
        return {"amount": None, "currency": None}


@router.get("/api/ecr/audit")
def ecr_audit(request: Request, region: str = Query(..., min_length=1, max_length=64)):
    region = _region(region)
    cutoff = datetime.now(timezone.utc) - timedelta(days=STALE_IMAGE_DAYS)
    stale, untagged = [], []
    digest_repos: dict[str, set[str]] = defaultdict(set)
    notes = []
    try:
        ecr = _client(request, "ecr", region)
        repos: list[str] = []
        for page in ecr.get_paginator("describe_repositories").paginate():
            repos.extend(r["repositoryName"] for r in page.get("repositories", []))
        if len(repos) > MAX_ECR_REPOSITORIES:
            notes.append(f"Only the first {MAX_ECR_REPOSITORIES} of {len(repos)} repositories were audited.")
            repos = repos[:MAX_ECR_REPOSITORIES]
        seen = 0
        for repo in repos:
            for page in ecr.get_paginator("describe_images").paginate(repositoryName=repo):
                for image in page.get("imageDetails", []):
                    seen += 1
                    if seen > MAX_ECR_IMAGES:
                        break
                    digest = image.get("imageDigest", "")
                    tags = image.get("imageTags", [])
                    pushed = image.get("imagePushedAt")
                    item = {
                        "repository": repo, "digest": digest, "tags": tags,
                        "pushed_at": pushed.isoformat() if pushed else None,
                        "size_bytes": image.get("imageSizeInBytes"),
                    }
                    digest_repos[digest].add(repo)
                    if not tags:
                        untagged.append(item)
                    if pushed and pushed < cutoff:
                        stale.append(item)
        if seen > MAX_ECR_IMAGES:
            notes.append(f"Only the first {MAX_ECR_IMAGES} images were audited.")
    except (BotoCoreError, ClientError) as exc:
        raise _aws_error("ECR audit", exc) from exc
    duplicates = [{"digest": d, "repositories": sorted(r)} for d, r in digest_repos.items() if len(r) > 1]
    return {
        "region": region,
        "stale_threshold_days": STALE_IMAGE_DAYS,
        "stale_images": stale,
        "untagged_images": untagged,
        "duplicate_digests": duplicates,
        "indicative_monthly_storage_cost": _ecr_monthly_cost(request),
        "cost_note": " ".join(notes + ["Counts come from live ECR metadata. This app never deletes images; confirm owners and running workloads first."]),
    }


class EcrImageRef(BaseModel):
    repository: str = Field(min_length=1, max_length=256)
    digest: str = Field(min_length=1, max_length=128)


class EcrCleanupBody(BaseModel):
    region: str
    images: list[EcrImageRef] = Field(default_factory=list, max_length=100)


@router.post("/api/ecr/cleanup")
def ecr_cleanup_plan(body: EcrCleanupBody, request: Request):
    """Re-check that each candidate still exists. Review plan only; nothing is deleted."""
    region = _region(body.region)
    eligible, missing = [], []
    try:
        ecr = _client(request, "ecr", region)
        by_repo: dict[str, list[str]] = defaultdict(list)
        for image in body.images:
            by_repo[image.repository].append(image.digest)
        for repo, digests in by_repo.items():
            live: set[str] = set()
            # One missing digest makes the whole batch call fail, so check each digest on its own.
            for d in digests:
                try:
                    found = ecr.describe_images(repositoryName=repo, imageIds=[{"imageDigest": d}])
                    live.update(i["imageDigest"] for i in found.get("imageDetails", []))
                except ClientError as exc:
                    if exc.response.get("Error", {}).get("Code") not in ("ImageNotFoundException", "RepositoryNotFoundException"):
                        raise
            for d in digests:
                (eligible if d in live else missing).append({"repository": repo, "digest": d})
    except (BotoCoreError, ClientError) as exc:
        raise _aws_error("ECR verification", exc) from exc
    return {"region": region, "eligible_images": eligible, "missing_images": missing, "deleted": 0,
            "message": "Review plan only. No ECR images were deleted."}


# ------------------------------------------------------------------------------ tags
def _collect_taggable(request: Request, region: str) -> list[dict]:
    items: list[dict] = []
    try:
        ec2 = _client(request, "ec2", region)
        for page in ec2.get_paginator("describe_instances").paginate():
            for res in page.get("Reservations", []):
                for inst in res.get("Instances", []):
                    if inst.get("State", {}).get("Name") == "terminated":
                        continue
                    tags = _tags_to_dict(inst.get("Tags"))
                    items.append({"id": inst["InstanceId"], "type": "EC2 instance", "name": _name(tags, inst["InstanceId"]),
                                  "tags": tags, "state": inst.get("State", {}).get("Name", ""), "kind": "ec2"})
        for page in ec2.get_paginator("describe_volumes").paginate():
            for vol in page.get("Volumes", []):
                tags = _tags_to_dict(vol.get("Tags"))
                items.append({"id": vol["VolumeId"], "type": "EBS volume", "name": _name(tags, vol["VolumeId"]),
                              "tags": tags, "state": vol.get("State", ""), "kind": "ebs"})
        rds = _client(request, "rds", region)
        for page in rds.get_paginator("describe_db_instances").paginate():
            for db in page.get("DBInstances", []):
                tags = _tags_to_dict(db.get("TagList"))
                items.append({"id": db["DBInstanceIdentifier"], "type": "RDS instance", "name": db["DBInstanceIdentifier"],
                              "tags": tags, "state": db.get("DBInstanceStatus", ""), "kind": "rds"})
    except (BotoCoreError, ClientError) as exc:
        raise _aws_error("tag audit", exc) from exc
    return items


def _tag_audit(request: Request, region: str) -> dict:
    items = _collect_taggable(request, region)
    resources = []
    for item in items:
        missing = [t for t in REQUIRED_TAGS if not item["tags"].get(t)]
        resources.append({"id": item["id"], "type": item["type"], "name": item["name"], "missing_tags": missing})
    compliant = sum(1 for r in resources if not r["missing_tags"])
    total = len(resources)
    return {
        "region": region,
        "required_tags": list(REQUIRED_TAGS),
        "resource_count": total,
        "compliant_count": compliant,
        "compliance_percent": round(compliant * 100 / total) if total else None,
        "resources": resources,
    }


@router.get("/api/governance/tags")
def governance_tags(request: Request, region: str = Query(..., min_length=1, max_length=64)):
    return _tag_audit(request, _region(region))


class RegionBody(BaseModel):
    region: str


@router.post("/api/governance/tags/notify")
def governance_tags_notify(body: RegionBody, request: Request):
    """Summarise violations. Nothing is sent: a visitor's tag data is never forwarded to a server-side webhook."""
    audit = _tag_audit(request, _region(body.region))
    violations = [r for r in audit["resources"] if r["missing_tags"]]
    return {
        "sent": False,
        "violation_count": len(violations),
        "message": (f"{len(violations)} resource(s) are missing required tags. No alert destination is configured for your account, so nothing was sent."
                    if violations else "All audited resources have the required tags."),
    }


class ParkBody(BaseModel):
    region: str
    environment: str = "Dev"
    enabled: bool = True


@router.post("/api/governance/park-schedule")
def governance_park_schedule(body: ParkBody, request: Request):
    """Proposal only: which tagged EC2/RDS resources would be stopped 8 PM and started 8 AM IST."""
    region = _region(body.region)
    environment = body.environment.strip().lower()
    if environment not in ("dev", "staging"):
        raise HTTPException(status_code=422, detail="Environment must be Dev or Staging.")
    matched = [
        {"id": i["id"], "type": i["type"], "name": i["name"], "state": i["state"]}
        for i in _collect_taggable(request, region)
        if i["kind"] in ("ec2", "rds") and i["tags"].get("Environment", "").lower() == environment
    ]
    return {
        "region": region, "environment": body.environment, "enabled": body.enabled,
        "schedule": {"stop": "20:00 IST", "start": "08:00 IST"},
        "matched_resources": matched,
        "message": "Proposal only. No EventBridge, Lambda, EC2 or RDS changes were made.",
    }


# ------------------------------------------------------------------------------ webhooks
@router.get("/api/webhooks/config")
def webhooks_config():
    # No server-side destinations are exposed to visitors.
    return {"destinations": []}


@router.get("/api/webhooks/alerts")
def webhooks_alerts():
    # Alerts received by this server belong to the server's own account, never to a visitor's.
    return {"alerts": []}


class WebhookTestBody(BaseModel):
    destination_url: str = Field(min_length=1, max_length=2048)


def _validated_webhook_host(url: str) -> str:
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    allowed = host in ALLOWED_WEBHOOK_HOSTS or any(host.endswith(s) for s in ALLOWED_WEBHOOK_SUFFIXES)
    if parsed.scheme != "https" or not allowed or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise HTTPException(status_code=422, detail="Only HTTPS Slack (hooks.slack.com) and Microsoft Teams webhook URLs are accepted.")
    return host


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # never follow redirects to another host
        return None


@router.post("/api/webhooks/trigger")
def webhooks_trigger(body: WebhookTestBody):
    host = _validated_webhook_host(body.destination_url)
    payload = json.dumps({"text": "FinOps-Bharat test message: your webhook is working."}).encode()
    req = urllib.request.Request(body.destination_url.strip(), data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.build_opener(_NoRedirect).open(req, timeout=8).read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise HTTPException(status_code=502, detail=f"Webhook delivery failed: {exc}") from exc
    return {"destination": host, "delivered": True}
try:
    from backend.metrics import router as metrics_router
except ModuleNotFoundError:
    from metrics import router as metrics_router
router.include_router(metrics_router)
