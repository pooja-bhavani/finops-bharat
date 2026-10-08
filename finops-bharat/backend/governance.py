from collections import deque
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import base64
import json
import logging
import os
import re
from typing import Any
from urllib.parse import urlparse

import boto3
import httpx
from botocore.exceptions import BotoCoreError, ClientError
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.x509 import load_pem_x509_certificate
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger("finops_governance")
router = APIRouter()

GITHUB_API = "https://api.github.com"
GITHUB_REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
REGION_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*-\d+$")
REQUIRED_TAGS = ("Owner", "Environment", "CostCenter")
SNS_CERTIFICATE_PATH = re.compile(r"^/SimpleNotificationService-[A-Za-z0-9]+\.pem$")
SNS_EVENTS: deque[dict[str, Any]] = deque(maxlen=100)


class RegionRequest(BaseModel):
    region: str = Field(min_length=1, max_length=64)


class PullRequestCostCheck(BaseModel):
    pull_number: int = Field(gt=0)


class CleanupPlanRequest(BaseModel):
    region: str = Field(min_length=1, max_length=64)
    volume_ids: list[str] = Field(max_length=100)


class ParkingPlanRequest(BaseModel):
    region: str = Field(min_length=1, max_length=64)
    environment: str
    enabled: bool


class EcrImageReference(BaseModel):
    repository: str = Field(min_length=1, max_length=256)
    digest: str = Field(pattern=r"^sha256:[a-fA-F0-9]{64}$")


class EcrCleanupPlanRequest(BaseModel):
    region: str = Field(min_length=1, max_length=64)
    images: list[EcrImageReference] = Field(max_length=100)


class WebhookTestRequest(BaseModel):
    destination_url: str = Field(min_length=1, max_length=4096)


def _validate_region(region: str) -> str:
    normalized = region.strip()
    if not REGION_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=422, detail="Provide a valid AWS region identifier.")
    return normalized


def _github_config() -> tuple[str, str]:
    token = os.getenv("GITHUB_TOKEN", "").strip()
    repository = os.getenv("GITHUB_REPOSITORY", "").strip()
    if not token or not GITHUB_REPOSITORY_PATTERN.fullmatch(repository):
        raise HTTPException(
            status_code=503,
            detail="Configure GITHUB_TOKEN and GITHUB_REPOSITORY (owner/name) for GitHub features.",
        )
    return token, repository


async def _github_request(
    client: httpx.AsyncClient,
    method: str,
    path: str,
    *,
    token: str,
    **kwargs: Any,
) -> dict[str, Any]:
    try:
        response = await client.request(
            method,
            f"{GITHUB_API}{path}",
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": "Bearer " + token,
                "X-GitHub-Api-Version": "2022-11-28",
            },
            **kwargs,
        )
    except httpx.HTTPError as exc:
        logger.warning("GitHub API request failed: %s %s: %s", method, path, exc)
        raise HTTPException(status_code=502, detail="GitHub API request failed.") from exc
    if not response.is_success:
        logger.warning("GitHub API returned HTTP %s for %s %s", response.status_code, method, path)
        raise HTTPException(status_code=502, detail=f"GitHub API returned HTTP {response.status_code}.")
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="GitHub API returned an invalid JSON response.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="GitHub API returned an unexpected response.")
    return payload


def _github_repo_path(repository: str) -> str:
    return f"/repos/{repository}"


def _is_runner_tagged(tags: dict[str, str]) -> bool:
    normalized = {key.casefold(): value.casefold() for key, value in tags.items()}
    return (
        normalized.get("ephemeral") in {"true", "yes", "1"}
        or normalized.get("githubactionsrunner") in {"true", "yes", "1"}
        or "github actions runner" in normalized.get("purpose", "")
        or "github runner" in normalized.get("name", "")
    )


@router.get("/api/cicd/audit")
def cicd_audit(region: str):
    selected_region = _validate_region(region)
    ec2 = boto3.client("ec2", region_name=selected_region)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    try:
        volumes = ec2.describe_volumes(Filters=[{"Name": "status", "Values": ["available"]}]).get("Volumes", [])
    except (BotoCoreError, ClientError) as exc:
        logger.exception("AWS ephemeral runner disk audit failed")
        raise HTTPException(status_code=502, detail=f"AWS runner disk audit failed: {exc}") from exc
    disks = []
    for volume in volumes:
        created_at = volume.get("CreateTime")
        tags = {tag["Key"]: tag["Value"] for tag in volume.get("Tags", []) if "Key" in tag and "Value" in tag}
        if (
            not created_at
            or created_at.replace(tzinfo=created_at.tzinfo or timezone.utc) > cutoff
            or not _is_runner_tagged(tags)
        ):
            continue
        disks.append({
            "volume_id": volume.get("VolumeId"),
            "size_gib": volume.get("Size"),
            "volume_type": volume.get("VolumeType"),
            "created_at": created_at.isoformat(),
            "age_hours": round((datetime.now(timezone.utc) - created_at.replace(tzinfo=created_at.tzinfo or timezone.utc)).total_seconds() / 3600, 1),
            "runner_tagged": _is_runner_tagged(tags),
            "tags": tags,
        })
    return {
        "status": "ok",
        "region": selected_region,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "stale_unattached_ebs": disks,
        "docker_volumes": None,
        "docker_volume_audit_supported": False,
        "docker_volume_note": "Docker daemon volumes are not visible to this API service; no host Docker socket is mounted.",
        "aws_changes_made": False,
    }


@router.post("/api/cicd/cleanup")
def plan_cicd_cleanup(body: CleanupPlanRequest):
    selected_region = _validate_region(body.region)
    if not body.volume_ids:
        return {"status": "review_required", "candidate_volume_ids": [], "aws_changes_made": False}
    if any(not volume_id.startswith("vol-") for volume_id in body.volume_ids):
        raise HTTPException(status_code=422, detail="Only EBS volume identifiers may be included in the cleanup plan.")
    ec2 = boto3.client("ec2", region_name=selected_region)
    try:
        volumes = ec2.describe_volumes(VolumeIds=body.volume_ids).get("Volumes", [])
    except (BotoCoreError, ClientError) as exc:
        logger.exception("AWS cleanup-plan verification failed")
        raise HTTPException(status_code=502, detail=f"AWS cleanup-plan verification failed: {exc}") from exc
    eligible = []
    for volume in volumes:
        created_at = volume.get("CreateTime")
        tags = {tag["Key"]: tag["Value"] for tag in volume.get("Tags", []) if "Key" in tag and "Value" in tag}
        if volume.get("State") != "available" or not created_at or not _is_runner_tagged(tags):
            continue
        created = created_at.replace(tzinfo=created_at.tzinfo or timezone.utc)
        if created <= datetime.now(timezone.utc) - timedelta(hours=24):
            eligible.append(volume.get("VolumeId"))
    return {
        "status": "review_required",
        "region": selected_region,
        "candidate_volume_ids": eligible,
        "not_eligible": sorted(set(body.volume_ids) - set(eligible)),
        "aws_changes_made": False,
        "message": "Review candidates and obtain owner approval; this endpoint never deletes EBS volumes.",
    }


def _monthly_service_costs(client, start: date, end: date) -> list[dict[str, str]]:
    request: dict[str, Any] = {
        "TimePeriod": {"Start": start.isoformat(), "End": end.isoformat()},
        "Granularity": "MONTHLY",
        "Metrics": ["UnblendedCost"],
        "GroupBy": [{"Type": "DIMENSION", "Key": "SERVICE"}],
    }
    totals: dict[str, Decimal] = {}
    currencies: dict[str, str] = {}
    while True:
        response = client.get_cost_and_usage(**request)
        for period in response.get("ResultsByTime", []):
            for group in period.get("Groups", []):
                service = group.get("Keys", ["Unknown"])[0]
                metric = group.get("Metrics", {}).get("UnblendedCost", {})
                currency = metric.get("Unit")
                if service in currencies and currencies[service] != currency:
                    raise ValueError("Cost Explorer returned inconsistent currencies for a service.")
                currencies[service] = currency
                totals[service] = totals.get(service, Decimal("0")) + Decimal(metric.get("Amount", "0"))
        token = response.get("NextPageToken")
        if not token:
            break
        request["NextPageToken"] = token
    return [
        {"service": service, "amount": str(amount), "currency": currencies[service]}
        for service, amount in sorted(totals.items(), key=lambda item: item[1], reverse=True)
    ]


@router.post("/api/cicd/cost-check")
async def cicd_cost_check(body: PullRequestCostCheck):
    token, repository = _github_config()
    path = _github_repo_path(repository)
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            pull = await _github_request(
                client,
                "GET",
                f"{path}/pulls/{body.pull_number}",
                token=token,
            )
            files = []
            page = 1
            while page <= 10:
                response = await client.get(
                    f"{GITHUB_API}{path}/pulls/{body.pull_number}/files",
                    headers={
                        "Accept": "application/vnd.github+json",
                        "Authorization": "Bearer " + token,
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                    params={"per_page": 100, "page": page},
                )
                if not response.is_success:
                    raise HTTPException(status_code=502, detail=f"GitHub API returned HTTP {response.status_code}.")
                page_files = response.json()
                if not isinstance(page_files, list):
                    raise HTTPException(status_code=502, detail="GitHub returned invalid pull request file data.")
                files.extend(page_files)
                if len(page_files) < 100:
                    break
                page += 1

            today = date.today().replace(day=1)
            month_start = (today - timedelta(days=1)).replace(day=1)
            cost_client = boto3.client("ce", region_name="us-east-1")
            spend = _monthly_service_costs(cost_client, month_start, today)
            lines = [
                "## FinOps-Bharat CI/CD cost review",
                "",
                f"Pull request: #{body.pull_number} — {pull.get('title', 'Untitled')}",
                f"Changed files reviewed: {len(files)}",
                f"Actual account spend shown below is AWS Cost Explorer unblended cost for the complete month {month_start.isoformat()} through {today.isoformat()} (exclusive).",
                "",
                "| AWS service | Actual spend |",
                "| --- | ---: |",
            ]
            for item in spend[:20]:
                service = str(item["service"]).replace("|", "\\|")
                lines.append(f"| {service} | {item['amount']} {item['currency']} |")
            if not spend:
                lines.append("| No service rows returned | Not available |")
            lines.extend([
                "",
                "**PR monthly cost impact: not quantified.** This API does not run a reviewed Terraform plan or AWS Pricing calculation for the proposed changes; current account spend cannot be attributed to this pull request. No estimated delta is presented.",
                "",
                "Review the deployment plan, resource sizing, environment lifecycle, and owner approval before merge.",
            ])
            comment = await _github_request(
                client,
                "POST",
                f"{path}/issues/{body.pull_number}/comments",
                token=token,
                json={"body": "\n".join(lines)},
            )
    except HTTPException:
        raise
    except (BotoCoreError, ClientError) as exc:
        logger.exception("AWS Cost Explorer query for pull request failed")
        raise HTTPException(status_code=502, detail=f"AWS Cost Explorer request failed: {exc}") from exc
    except (KeyError, ValueError) as exc:
        logger.exception("AWS Cost Explorer response for pull request could not be validated")
        raise HTTPException(status_code=502, detail="AWS Cost Explorer returned invalid service cost data.") from exc
    except httpx.HTTPError as exc:
        logger.warning("GitHub pull request cost check failed: %s", exc)
        raise HTTPException(status_code=502, detail="GitHub pull request cost-check request failed.") from exc
    return {
        "status": "commented",
        "pull_request_number": body.pull_number,
        "changed_file_count": len(files),
        "actual_spend_period_start": month_start.isoformat(),
        "actual_spend_currency": spend[0]["currency"] if spend else None,
        "monthly_impact": None,
        "impact_status": "not_quantified_without_reviewed_plan_and_pricing_data",
        "comment_url": comment.get("html_url"),
    }


def _metric_queries(cloudwatch, cluster_name: str, metric_names: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    queries: list[dict[str, Any]] = []
    warnings: list[str] = []
    for metric_name in metric_names:
        metrics = []
        token = None
        while True:
            request: dict[str, Any] = {
                "Namespace": "ContainerInsights",
                "MetricName": metric_name,
                "Dimensions": [{"Name": "ClusterName", "Value": cluster_name}],
            }
            if token:
                request["NextToken"] = token
            response = cloudwatch.list_metrics(**request)
            metrics.extend(response.get("Metrics", []))
            token = response.get("NextToken")
            if not token:
                break
        if not metrics:
            warnings.append(f"No Container Insights metric series found for {metric_name}.")
        for metric in metrics:
            if len(queries) >= 450:
                warnings.append("Metric series were capped at 450 queries per cluster.")
                return queries, warnings
            query_id = f"m{len(queries)}"
            queries.append({
                "Id": query_id,
                "MetricStat": {
                    "Metric": {
                        "Namespace": "ContainerInsights",
                        "MetricName": metric_name,
                        "Dimensions": metric.get("Dimensions", []),
                    },
                    "Period": 300,
                    "Stat": "Average",
                },
                "ReturnData": True,
                "Label": metric_name,
            })
    return queries, warnings


@router.get("/api/k8s/inventory")
def eks_inventory(region: str):
    selected_region = _validate_region(region)
    eks = boto3.client("eks", region_name=selected_region)
    cloudwatch = boto3.client("cloudwatch", region_name=selected_region)
    clusters: list[dict[str, Any]] = []
    try:
        paginator = eks.get_paginator("list_clusters")
        cluster_names = [name for page in paginator.paginate() for name in page.get("clusters", [])]
        for cluster_name in cluster_names:
            description = eks.describe_cluster(name=cluster_name).get("cluster", {})
            if description.get("status") != "ACTIVE":
                clusters.append({
                    "name": cluster_name,
                    "status": description.get("status"),
                    "version": description.get("version"),
                    "nodegroups": [],
                    "container_insights_metrics": [],
                    "warnings": ["Cluster is not active; utilization metrics were not queried."],
                })
                continue
            nodegroups = []
            nodegroup_paginator = eks.get_paginator("list_nodegroups")
            groups = [name for page in nodegroup_paginator.paginate(clusterName=cluster_name) for name in page.get("nodegroups", [])]
            for group_name in groups:
                group = eks.describe_nodegroup(clusterName=cluster_name, nodegroupName=group_name).get("nodegroup", {})
                nodegroups.append({
                    "name": group_name,
                    "status": group.get("status"),
                    "desired_size": group.get("scalingConfig", {}).get("desiredSize"),
                    "instance_types": group.get("instanceTypes", []),
                    "capacity_type": group.get("capacityType"),
                    "resources": group.get("resources", {}),
                })
            metric_names = [
                "node_cpu_utilization",
                "node_memory_utilization",
                "pod_cpu_utilization_over_pod_cpu_request",
                "pod_memory_utilization_over_pod_memory_request",
            ]
            queries, warnings = _metric_queries(cloudwatch, cluster_name, metric_names)
            series: list[dict[str, Any]] = []
            if queries:
                end_time = datetime.now(timezone.utc)
                response = cloudwatch.get_metric_data(
                    MetricDataQueries=queries,
                    StartTime=end_time - timedelta(minutes=15),
                    EndTime=end_time,
                    ScanBy="TimestampDescending",
                )
                query_map = {query["Id"]: query for query in queries}
                for result in response.get("MetricDataResults", []):
                    values = result.get("Values", [])
                    query = query_map.get(result.get("Id"), {})
                    dimensions = query.get("MetricStat", {}).get("Metric", {}).get("Dimensions", [])
                    series.append({
                        "metric": result.get("Label"),
                        "dimensions": {item["Name"]: item["Value"] for item in dimensions},
                        "latest_value": values[0] if values else None,
                        "unit": "percent",
                        "timestamps": result.get("Timestamps", [])[:3],
                        "values": values[:3],
                        "status": result.get("StatusCode"),
                    })
            clusters.append({
                "name": cluster_name,
                "status": description.get("status"),
                "version": description.get("version"),
                "endpoint": description.get("endpoint"),
                "nodegroups": nodegroups,
                "container_insights_metrics": series,
                "warnings": warnings,
            })
    except (BotoCoreError, ClientError) as exc:
        logger.exception("EKS/Container Insights inventory failed")
        raise HTTPException(status_code=502, detail=f"EKS inventory or CloudWatch metrics query failed: {exc}") from exc
    return {
        "status": "ok",
        "region": selected_region,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "clusters": clusters,
        "metrics_period_seconds": 300,
        "metrics_window_minutes": 15,
        "metrics_note": "Container Insights data is returned as published by CloudWatch. Requested-versus-used comparison requires these metrics to be enabled in each cluster.",
    }


def _ecr_monthly_cost() -> dict[str, Any]:
    today = date.today().replace(day=1)
    start = (today - timedelta(days=1)).replace(day=1)
    client = boto3.client("ce", region_name="us-east-1")
    services = [
        item for item in _monthly_service_costs(client, start, today)
        if "elastic container registry" in item["service"].casefold()
    ]
    if not services:
        return {"amount": None, "currency": None, "period": start.isoformat(), "status": "not_returned"}
    amount = sum((Decimal(item["amount"]) for item in services), Decimal("0"))
    currency = services[0]["currency"]
    return {"amount": str(amount), "currency": currency, "period": start.isoformat(), "status": "actual_cost_explorer"}


@router.get("/api/ecr/audit")
def ecr_audit(region: str):
    selected_region = _validate_region(region)
    ecr = boto3.client("ecr", region_name=selected_region)
    repositories = []
    images_by_digest: dict[str, list[dict[str, Any]]] = {}
    cutoff = datetime.now(timezone.utc) - timedelta(days=60)
    stale_images = []
    untagged_images = []
    image_bytes_by_digest: dict[str, int] = {}
    try:
        repository_pages = ecr.get_paginator("describe_repositories")
        for page in repository_pages.paginate():
            for repository in page.get("repositories", []):
                repository_name = repository["repositoryName"]
                repositories.append(repository_name)
                image_pages = ecr.get_paginator("describe_images")
                for image_page in image_pages.paginate(repositoryName=repository_name):
                    for image in image_page.get("imageDetails", []):
                        digest = image.get("imageDigest")
                        if not digest:
                            continue
                        pushed = image.get("imagePushedAt")
                        created = pushed.replace(tzinfo=pushed.tzinfo or timezone.utc) if pushed else None
                        record = {
                            "repository": repository_name,
                            "digest": digest,
                            "tags": image.get("imageTags", []),
                            "pushed_at": pushed.isoformat() if pushed else None,
                            "size_bytes": image.get("imageSizeInBytes"),
                        }
                        images_by_digest.setdefault(digest, []).append(record)
                        image_bytes_by_digest[digest] = max(image_bytes_by_digest.get(digest, 0), int(image.get("imageSizeInBytes") or 0))
                        if created and created < cutoff:
                            stale_images.append(record)
                        if not image.get("imageTags"):
                            untagged_images.append(record)
    except (BotoCoreError, ClientError) as exc:
        logger.exception("ECR inventory failed")
        raise HTTPException(status_code=502, detail=f"ECR image inventory failed: {exc}") from exc

    duplicates = [
        {"digest": digest, "repositories": records, "count": len(records)}
        for digest, records in images_by_digest.items()
        if len(records) > 1
    ]
    stale_digests = {image["digest"] for image in stale_images}
    untagged_digests = {image["digest"] for image in untagged_images}
    candidate_digests = stale_digests | untagged_digests
    candidate_bytes = sum(image_bytes_by_digest.get(digest, 0) for digest in candidate_digests)
    total_bytes = sum(image_bytes_by_digest.values())
    cost = None
    if total_bytes and candidate_bytes:
        try:
            monthly = _ecr_monthly_cost()
            if monthly["amount"] is not None:
                cost = {
                    "amount": str(Decimal(monthly["amount"]) * candidate_bytes / total_bytes),
                    "currency": monthly["currency"],
                    "period": monthly["period"],
                    "basis": "actual account-level ECR Cost Explorer charge allocated by unique image digest bytes; indicative only",
                }
        except (BotoCoreError, ClientError, ValueError) as exc:
            logger.warning("ECR Cost Explorer query failed: %s", exc)
            cost = {
                "amount": None,
                "currency": None,
                "status": "unavailable",
                "message": f"Cost Explorer could not provide ECR storage spend: {exc}",
            }
    return {
        "status": "ok",
        "region": selected_region,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "repositories": repositories,
        "stale_images": stale_images,
        "untagged_images": untagged_images,
        "duplicate_digests": duplicates,
        "unique_image_bytes": total_bytes,
        "candidate_unique_image_bytes": candidate_bytes,
        "indicative_monthly_storage_cost": cost,
        "cost_note": "No currency conversion is applied. Account-level ECR spend divided by regional image bytes is an indicative allocation, not an avoidable-cost estimate.",
    }


@router.post("/api/ecr/cleanup")
def plan_ecr_cleanup(body: EcrCleanupPlanRequest):
    selected_region = _validate_region(body.region)
    ecr = boto3.client("ecr", region_name=selected_region)
    cutoff = datetime.now(timezone.utc) - timedelta(days=60)
    by_repository: dict[str, list[EcrImageReference]] = {}
    for image in body.images:
        by_repository.setdefault(image.repository, []).append(image)
    eligible = []
    found: set[tuple[str, str]] = set()
    try:
        for repository, images in by_repository.items():
            response = ecr.describe_images(
                repositoryName=repository,
                imageIds=[{"imageDigest": image.digest} for image in images],
            )
            for image in response.get("imageDetails", []):
                digest = image.get("imageDigest")
                if not digest:
                    continue
                found.add((repository, digest))
                pushed = image.get("imagePushedAt")
                is_stale = bool(
                    pushed and pushed.replace(tzinfo=pushed.tzinfo or timezone.utc) < cutoff
                )
                is_untagged = not image.get("imageTags")
                if is_stale or is_untagged:
                    eligible.append({
                        "repository": repository,
                        "digest": digest,
                        "pushed_at": pushed.isoformat() if pushed else None,
                        "size_bytes": image.get("imageSizeInBytes"),
                        "reasons": [
                            reason for reason, matches in (
                                ("older_than_60_days", is_stale),
                                ("untagged", is_untagged),
                            ) if matches
                        ],
                    })
    except (BotoCoreError, ClientError) as exc:
        logger.exception("ECR cleanup-plan verification failed")
        raise HTTPException(status_code=502, detail=f"ECR cleanup-plan verification failed: {exc}") from exc
    requested = {(image.repository, image.digest) for image in body.images}
    return {
        "status": "review_required",
        "region": selected_region,
        "eligible_images": eligible,
        "not_eligible": [
            {"repository": repository, "digest": digest}
            for repository, digest in sorted(requested - found)
        ],
        "aws_changes_made": False,
        "message": "Review image ownership and retention before action; this endpoint never deletes ECR images.",
    }


def _tag_dict(resource: dict[str, Any]) -> dict[str, str]:
    return {
        item["Key"]: item.get("Value", "")
        for item in resource.get("Tags", [])
        if isinstance(item, dict) and item.get("Key")
    }


def _tag_audit(region: str) -> dict[str, Any]:
    ec2 = boto3.client("ec2", region_name=region)
    rds = boto3.client("rds", region_name=region)
    resources = []
    try:
        for instance in (
            item
            for page in ec2.get_paginator("describe_instances").paginate(
                Filters=[{"Name": "instance-state-name", "Values": ["pending", "running", "stopping", "stopped"]}]
            )
            for reservation in page.get("Reservations", [])
            for item in reservation.get("Instances", [])
        ):
            resources.append({
                "id": instance.get("InstanceId"),
                "type": "EC2",
                "state": instance.get("State", {}).get("Name"),
                "tags": _tag_dict(instance),
            })
        for volume in (
            item for page in ec2.get_paginator("describe_volumes").paginate(
                Filters=[{"Name": "status", "Values": ["available", "in-use"]}]
            )
            for item in page.get("Volumes", [])
        ):
            resources.append({
                "id": volume.get("VolumeId"),
                "type": "EBS",
                "state": volume.get("State"),
                "tags": _tag_dict(volume),
            })
        addresses = ec2.describe_addresses().get("Addresses", [])
        for address in addresses:
            resources.append({
                "id": address.get("AllocationId") or address.get("PublicIp"),
                "type": "EIP",
                "state": "associated" if address.get("AssociationId") else "unassociated",
                "tags": _tag_dict(address),
            })
        for instance in (
            item for page in rds.get_paginator("describe_db_instances").paginate()
            for item in page.get("DBInstances", [])
        ):
            arn = instance.get("DBInstanceArn")
            tags = rds.list_tags_for_resource(ResourceName=arn).get("TagList", []) if arn else []
            resources.append({
                "id": arn or instance.get("DBInstanceIdentifier"),
                "type": "RDS",
                "state": instance.get("DBInstanceStatus"),
                "tags": _tag_dict({"Tags": tags}),
            })
    except (BotoCoreError, ClientError) as exc:
        logger.exception("AWS tag governance audit failed")
        raise HTTPException(status_code=502, detail=f"AWS tag governance audit failed: {exc}") from exc
    for resource in resources:
        resource["missing_tags"] = [tag for tag in REQUIRED_TAGS if not resource["tags"].get(tag, "").strip()]
    compliant = sum(not resource["missing_tags"] for resource in resources)
    return {
        "status": "ok",
        "region": region,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "required_tags": list(REQUIRED_TAGS),
        "resource_count": len(resources),
        "compliant_count": compliant,
        "compliance_percent": round(100 * compliant / len(resources), 1) if resources else None,
        "resources": resources,
    }


@router.get("/api/governance/tags")
def governance_tags(region: str):
    return _tag_audit(_validate_region(region))


@router.post("/api/governance/tags/notify")
async def notify_tag_violations(body: RegionRequest):
    audit = _tag_audit(_validate_region(body.region))
    violations = [resource for resource in audit["resources"] if resource["missing_tags"]]
    message = (
        f"FinOps-Bharat tag audit: {len(violations)} of {audit['resource_count']} AWS resources "
        f"are missing required tags in {audit['region']}."
    )
    return await _dispatch_message(message, event={"type": "tag_violations", "violations": violations})


@router.post("/api/governance/park-schedule")
def parking_schedule_plan(body: ParkingPlanRequest):
    selected_region = _validate_region(body.region)
    environment = body.environment.strip()
    if environment.casefold() not in {"dev", "staging"}:
        raise HTTPException(status_code=422, detail="Auto-parking plans are limited to Dev or Staging environments.")
    ec2 = boto3.client("ec2", region_name=selected_region)
    rds = boto3.client("rds", region_name=selected_region)
    matches = []
    try:
        for instance in (
            item
            for page in ec2.get_paginator("describe_instances").paginate(
                Filters=[{"Name": "instance-state-name", "Values": ["pending", "running", "stopping", "stopped"]}]
            )
            for reservation in page.get("Reservations", [])
            for item in reservation.get("Instances", [])
        ):
            tags = _tag_dict(instance)
            if tags.get("Environment", "").casefold() == environment.casefold():
                matches.append({"id": instance.get("InstanceId"), "type": "EC2", "state": instance.get("State", {}).get("Name")})
        for instance in (
            item for page in rds.get_paginator("describe_db_instances").paginate()
            for item in page.get("DBInstances", [])
        ):
            arn = instance.get("DBInstanceArn")
            tags = _tag_dict({"Tags": rds.list_tags_for_resource(ResourceName=arn).get("TagList", [])}) if arn else {}
            if tags.get("Environment", "").casefold() == environment.casefold():
                matches.append({
                    "id": arn or instance.get("DBInstanceIdentifier"),
                    "type": "RDS",
                    "state": instance.get("DBInstanceStatus"),
                })
    except (BotoCoreError, ClientError) as exc:
        logger.exception("AWS auto-parking candidate scan failed")
        raise HTTPException(status_code=502, detail=f"AWS auto-parking candidate scan failed: {exc}") from exc
    return {
        "status": "plan_only",
        "region": selected_region,
        "environment": environment,
        "enabled_requested": body.enabled,
        "matched_resources": matches,
        "schedules": {
            "stop": {"expression": "cron(0 20 * * ? *)", "timezone": "Asia/Kolkata"},
            "start": {"expression": "cron(0 8 * * ? *)", "timezone": "Asia/Kolkata"},
        },
        "aws_changes_made": False,
        "message": "Schedule proposal only: no EventBridge rule, Lambda, EC2, or RDS changes are created by this read-only service.",
    }


def _validate_webhook_url(value: str) -> str:
    try:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower()
        valid_host = (
            host == "hooks.slack.com"
            or host.endswith(".webhook.office.com")
            or host.endswith(".webhook.office365.com")
            or host.endswith(".powerplatform.com")
        )
        if (
            parsed.scheme != "https"
            or not valid_host
            or parsed.port not in (None, 443)
            or parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
            or parsed.username is not None
            or parsed.password is not None
            or not parsed.path
        ):
            raise ValueError("invalid destination")
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail="Use a valid HTTPS Slack or Microsoft Teams incoming-webhook URL.",
        ) from exc
    return value


def _configured_webhooks() -> list[tuple[str, str]]:
    configured = []
    for name, env_var in (
        ("Slack", "SLACK_WEBHOOK_URL"),
        ("Microsoft Teams", "TEAMS_WEBHOOK_URL"),
    ):
        value = os.getenv(env_var, "").strip()
        if value:
            try:
                configured.append((name, _validate_webhook_url(value)))
            except HTTPException:
                logger.error("Ignoring invalid %s webhook configuration", env_var)
                raise HTTPException(status_code=503, detail=f"{env_var} is configured with an invalid URL.")
    return configured


async def _post_webhook(url: str, payload: dict[str, Any]) -> None:
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            response = await client.post(url, json=payload)
    except httpx.HTTPError as exc:
        logger.warning("Webhook dispatcher request failed: %s", exc)
        raise HTTPException(status_code=502, detail="Webhook delivery failed.") from exc
    if not response.is_success:
        logger.warning("Webhook dispatcher returned HTTP %s", response.status_code)
        raise HTTPException(status_code=502, detail=f"Webhook destination returned HTTP {response.status_code}.")


async def _dispatch_message(
    message: str,
    *,
    event: dict[str, Any],
    already_delivered: set[str] | None = None,
) -> dict[str, Any]:
    destinations = _configured_webhooks()
    if not destinations:
        raise HTTPException(status_code=503, detail="Configure SLACK_WEBHOOK_URL or TEAMS_WEBHOOK_URL on the API service.")
    delivered = list(already_delivered or set())
    errors = []
    for name, url in destinations:
        if name in delivered:
            continue
        payload = {"text": message}
        if name == "Microsoft Teams":
            payload = {"text": message, "title": event.get("title", "FinOps-Bharat alert")}
        try:
            await _post_webhook(url, payload)
            delivered.append(name)
        except HTTPException as exc:
            errors.append(f"{name}: {exc.detail}")
    result = {"status": "delivered" if not errors else "partial", "destinations": delivered, "message": message}
    if errors:
        raise HTTPException(
            status_code=502,
            detail=f"Webhook delivery failed: {'; '.join(errors)}",
            headers={"X-Webhook-Delivered": ",".join(delivered)},
        )
    return result


@router.get("/api/webhooks/config")
def webhook_config():
    destinations = _configured_webhooks()
    return {
        "destinations": [{"name": name, "configured": True} for name, _ in destinations],
        "user_test_urls_persisted": False,
        "alert_feed_retention": "current API process memory only; newest 100 signed SNS notifications",
    }


@router.post("/api/webhooks/trigger")
async def trigger_webhook_test(body: WebhookTestRequest):
    destination = _validate_webhook_url(body.destination_url)
    await _post_webhook(
        destination,
        {"text": f"FinOps-Bharat webhook test delivered at {datetime.now(timezone.utc).isoformat()}."},
    )
    return {"status": "delivered", "destination": urlparse(destination).hostname}


def _sns_signing_string(message: dict[str, Any]) -> bytes:
    message_type = message.get("Type")
    fields = (
        ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
        if message_type == "Notification"
        else ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"]
    )
    parts = [f"{key}\n{message[key]}\n" for key in fields if key in message]
    return "".join(parts).encode()


def _sns_certificate_url(value: str) -> str:
    try:
        parsed = urlparse(value)
        port = parsed.port
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="SNS signing certificate URL is invalid.") from exc
    host = (parsed.hostname or "").lower()
    allowed_host = bool(
        re.fullmatch(r"sns(?:-fips)?\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?", host)
        or host in {"sns.amazonaws.com", "sns-fips.amazonaws.com"}
    )
    if (
        parsed.scheme != "https"
        or not allowed_host
        or port not in (None, 443)
        or parsed.query
        or parsed.fragment
        or not SNS_CERTIFICATE_PATH.fullmatch(parsed.path)
    ):
        raise HTTPException(status_code=400, detail="SNS signing certificate URL is invalid.")
    return value


async def _verify_sns_message(message: dict[str, Any]) -> None:
    if message.get("Type") not in {"Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"}:
        raise HTTPException(status_code=400, detail="Unsupported SNS message type.")
    signature_version = message.get("SignatureVersion")
    if signature_version not in {"1", "2"}:
        raise HTTPException(status_code=400, detail="Unsupported SNS signature version.")
    certificate_url = _sns_certificate_url(message.get("SigningCertURL", ""))
    try:
        signature = base64.b64decode(message["Signature"], validate=True)
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            response = await client.get(certificate_url)
            response.raise_for_status()
        certificate = load_pem_x509_certificate(response.content)
        digest = hashes.SHA1() if signature_version == "1" else hashes.SHA256()
        certificate.public_key().verify(signature, _sns_signing_string(message), padding.PKCS1v15(), digest)
    except (KeyError, TypeError, ValueError, InvalidSignature, httpx.HTTPError) as exc:
        logger.warning("SNS message signature verification failed")
        raise HTTPException(status_code=403, detail="SNS message signature could not be verified.") from exc


def _sns_topic_allowed(topic_arn: str) -> bool:
    configured = os.getenv("AWS_SNS_TOPIC_ARN", "").strip()
    return bool(configured and topic_arn == configured)


async def _confirm_sns_subscription(url: str) -> None:
    parsed = urlparse(url)
    _sns_certificate_url(f"{parsed.scheme}://{parsed.netloc}/SimpleNotificationService-placeholder.pem")
    if parsed.scheme != "https" or not parsed.hostname or not (
        parsed.hostname.startswith("sns.") or parsed.hostname.startswith("sns-fips.")
    ):
        raise HTTPException(status_code=400, detail="SNS subscription confirmation URL is invalid.")
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            response = await client.get(url)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("SNS subscription confirmation request failed")
        raise HTTPException(status_code=502, detail="SNS subscription confirmation failed.") from exc


@router.post("/api/webhooks/aws-sns")
async def receive_aws_sns(request: Request):
    if request.headers.get("x-amz-sns-message-type") not in {
        "Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation",
    }:
        raise HTTPException(status_code=400, detail="Missing or invalid SNS message type header.")
    raw_body = await request.body()
    if len(raw_body) > 262144:
        raise HTTPException(status_code=413, detail="SNS message exceeds the supported size limit.")
    try:
        message = json.loads(raw_body)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="SNS request body must be valid JSON.") from exc
    if not isinstance(message, dict):
        raise HTTPException(status_code=400, detail="SNS request body must be a JSON object.")
    if request.headers["x-amz-sns-message-type"] != message.get("Type"):
        raise HTTPException(status_code=400, detail="SNS message type header does not match the body.")
    await _verify_sns_message(message)
    topic_arn = message.get("TopicArn", "")
    if not _sns_topic_allowed(topic_arn):
        raise HTTPException(status_code=403, detail="SNS topic is not configured for this endpoint.")

    if message["Type"] == "SubscriptionConfirmation":
        await _confirm_sns_subscription(message.get("SubscribeURL", ""))
        return {"status": "subscription_confirmed"}
    if message["Type"] == "UnsubscribeConfirmation":
        return {"status": "unsubscribe_confirmation_received"}

    message_id = message.get("MessageId")
    previous_event = next((item for item in SNS_EVENTS if item.get("message_id") == message_id), None)
    if previous_event and previous_event.get("delivery_status") == "delivered":
        return {"status": "duplicate_ignored"}
    raw_message = message.get("Message", "")
    try:
        detail = json.loads(raw_message)
    except (ValueError, TypeError):
        detail = {"message": raw_message}
    event = previous_event or {
        "message_id": message_id,
        "topic_arn": topic_arn,
        "subject": message.get("Subject"),
        "received_at": datetime.now(timezone.utc).isoformat(),
        "detail": detail,
    }
    if not previous_event:
        SNS_EVENTS.appendleft(event)
    try:
        result = await _dispatch_message(
            f"AWS Cost Anomaly Detection alert\nSubject: {message.get('Subject', 'Cost anomaly')}\n{raw_message}",
            event={"title": message.get("Subject", "AWS Cost Anomaly Detection")},
            already_delivered=set(previous_event.get("destinations", [])) if previous_event else None,
        )
        event["delivery_status"] = "delivered"
        event["destinations"] = result["destinations"]
    except HTTPException as exc:
        event["delivery_status"] = "failed"
        event["dispatch_error"] = exc.detail
        delivered = set(event.get("destinations", []))
        delivered.update(
            name for name in (exc.headers or {}).get("X-Webhook-Delivered", "").split(",") if name
        )
        event["destinations"] = sorted(delivered)
        raise
    return {"status": "accepted", "message_id": message_id}


@router.get("/api/webhooks/alerts")
def webhook_alerts():
    return {"alerts": list(SNS_EVENTS), "retention_limit": 100}
