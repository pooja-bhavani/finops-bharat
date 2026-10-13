"""Overview metrics panel: EC2 cost/usage, S3 storage, projected monthly cost, EC2 network traffic.

Everything comes from the CALLER'S connected account (get_boto_session). Each section is fetched
independently, so one missing permission only blanks that section and adds a warning.

Billing note: Cost Explorer bills about $0.01 per request to the account being queried and this
endpoint makes 3, so results are cached per account and region for CACHE_TTL_SECONDS.
"""
from __future__ import annotations

import calendar
import logging
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone

from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, HTTPException, Query, Request

try:
    from backend.connect import get_boto_session
except ModuleNotFoundError:  # pragma: no cover - direct backend execution
    from connect import get_boto_session

logger = logging.getLogger("finops_metrics")
router = APIRouter(tags=["metrics"])

REGION_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*-\d+$")
CACHE_TTL_SECONDS = 15 * 60
MAX_METRICS = 200
EC2_SERVICE = "Amazon Elastic Compute Cloud - Compute"
_CFG = Config(retries={"max_attempts": 3, "mode": "standard"}, connect_timeout=5, read_timeout=25)

_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_lock = threading.Lock()


def _day_range(days: int = 7) -> list[date]:
    today = date.today()
    return [today - timedelta(days=days - 1 - i) for i in range(days)]


def _ce_section(session) -> tuple[dict, list[str]]:
    """Daily EC2 cost + running hours for the last 7 days, and month-to-date / last month / projection."""
    warnings: list[str] = []
    ce = session.client("ce", region_name="us-east-1", config=_CFG)
    days = _day_range(7)
    tomorrow = date.today() + timedelta(days=1)
    daily = {d.isoformat(): {"date": d.isoformat(), "cost": 0.0, "hours": 0.0} for d in days}
    currency = "USD"

    ec2_filter = {"Dimensions": {"Key": "SERVICE", "Values": [EC2_SERVICE]}}
    window = {"Start": days[0].isoformat(), "End": tomorrow.isoformat()}
    try:
        res = ce.get_cost_and_usage(TimePeriod=window, Granularity="DAILY", Metrics=["UnblendedCost"], Filter=ec2_filter)
        for period in res.get("ResultsByTime", []):
            total = period["Total"]["UnblendedCost"]
            currency = total.get("Unit", currency)
            key = period["TimePeriod"]["Start"]
            if key in daily:
                daily[key]["cost"] = float(total["Amount"])
    except (BotoCoreError, ClientError, KeyError, ValueError) as exc:
        warnings.append(f"EC2 daily cost unavailable: {_msg(exc)}")
    try:
        usage_filter = {"And": [ec2_filter, {"Dimensions": {"Key": "USAGE_TYPE_GROUP", "Values": ["EC2: Running Hours"]}}]}
        res = ce.get_cost_and_usage(TimePeriod=window, Granularity="DAILY", Metrics=["UsageQuantity"], Filter=usage_filter)
        for period in res.get("ResultsByTime", []):
            key = period["TimePeriod"]["Start"]
            if key in daily:
                daily[key]["hours"] = float(period["Total"]["UsageQuantity"]["Amount"])
    except (BotoCoreError, ClientError, KeyError, ValueError) as exc:
        warnings.append(f"EC2 usage hours unavailable: {_msg(exc)}")

    cost = {"month_to_date": None, "last_month": None, "projected": None, "currency": currency}
    today = date.today()
    first_this = today.replace(day=1)
    first_prev = (first_this - timedelta(days=1)).replace(day=1)
    try:
        res = ce.get_cost_and_usage(
            TimePeriod={"Start": first_prev.isoformat(), "End": tomorrow.isoformat()},
            Granularity="MONTHLY", Metrics=["UnblendedCost"],
        )
        for period in res.get("ResultsByTime", []):
            total = period["Total"]["UnblendedCost"]
            cost["currency"] = total.get("Unit", currency)
            amount = float(total["Amount"])
            if period["TimePeriod"]["Start"] == first_this.isoformat():
                cost["month_to_date"] = amount
            elif period["TimePeriod"]["Start"] == first_prev.isoformat():
                cost["last_month"] = amount
        mtd = cost["month_to_date"]
        if mtd is not None and today.day >= 3:
            # Cost Explorer lags by up to a day, so count only fully reported days.
            elapsed = today.day - 1
            cost["projected"] = round(mtd / elapsed * calendar.monthrange(today.year, today.month)[1], 2)
    except (BotoCoreError, ClientError, KeyError, ValueError) as exc:
        warnings.append(f"Monthly cost unavailable: {_msg(exc)}")
    return {"daily": list(daily.values()), "cost": cost, "currency": cost["currency"]}, warnings


def _metric_values(cw, queries: list[dict], start: datetime, end: datetime) -> dict[str, list[float]]:
    out: dict[str, list[float]] = {}
    for i in range(0, len(queries), 500):
        paginator = cw.get_paginator("get_metric_data")
        for page in paginator.paginate(MetricDataQueries=queries[i:i + 500], StartTime=start, EndTime=end, ScanBy="TimestampDescending"):
            for result in page.get("MetricDataResults", []):
                out.setdefault(result["Id"], []).extend(result.get("Values", []))
    return out


def _s3_section(session, region: str) -> dict:
    cw = session.client("cloudwatch", region_name=region, config=_CFG)
    metrics = []
    for page in cw.get_paginator("list_metrics").paginate(Namespace="AWS/S3", MetricName="BucketSizeBytes"):
        metrics.extend(page.get("Metrics", []))
        if len(metrics) >= MAX_METRICS:
            break
    metrics = metrics[:MAX_METRICS]
    queries = [{
        "Id": f"s{i}",
        "MetricStat": {"Metric": {"Namespace": "AWS/S3", "MetricName": "BucketSizeBytes", "Dimensions": m["Dimensions"]},
                       "Period": 86400, "Stat": "Average"},
        "ReturnData": True,
    } for i, m in enumerate(metrics)]
    end = datetime.now(timezone.utc)
    values = _metric_values(cw, queries, end - timedelta(days=3), end) if queries else {}
    total = standard = 0.0
    buckets = set()
    for i, m in enumerate(metrics):
        dims = {d["Name"]: d["Value"] for d in m["Dimensions"]}
        vals = values.get(f"s{i}", [])
        size = vals[0] if vals else 0.0   # newest datapoint first
        buckets.add(dims.get("BucketName", ""))
        total += size
        if dims.get("StorageType") == "StandardStorage":
            standard += size
    return {"total_bytes": total, "standard_bytes": standard, "bucket_count": len(buckets)}


def _network_section(session, region: str) -> dict:
    cw = session.client("cloudwatch", region_name=region, config=_CFG)
    instances = []
    for page in cw.get_paginator("list_metrics").paginate(Namespace="AWS/EC2", MetricName="NetworkIn"):
        for m in page.get("Metrics", []):
            dims = m.get("Dimensions", [])
            if len(dims) == 1 and dims[0]["Name"] == "InstanceId":
                instances.append(dims[0]["Value"])
        if len(instances) >= MAX_METRICS:
            break
    instances = instances[:MAX_METRICS]
    queries = []
    for i, iid in enumerate(instances):
        for tag, name in (("i", "NetworkIn"), ("o", "NetworkOut")):
            queries.append({
                "Id": f"{tag}{i}",
                "MetricStat": {"Metric": {"Namespace": "AWS/EC2", "MetricName": name,
                                          "Dimensions": [{"Name": "InstanceId", "Value": iid}]},
                               "Period": 86400, "Stat": "Sum"},
                "ReturnData": True,
            })
    end = datetime.now(timezone.utc)
    values = _metric_values(cw, queries, end - timedelta(days=7), end) if queries else {}
    in_bytes = sum(sum(v) for k, v in values.items() if k.startswith("i"))
    out_bytes = sum(sum(v) for k, v in values.items() if k.startswith("o"))
    return {"in_bytes": in_bytes, "out_bytes": out_bytes, "instance_count": len(instances)}


def _msg(exc: Exception) -> str:
    if isinstance(exc, ClientError):
        err = exc.response.get("Error", {})
        return err.get("Message") or err.get("Code") or str(exc)
    return str(exc)


@router.get("/api/aws/metrics")
def aws_metrics(request: Request, region: str = Query(..., min_length=1, max_length=64)):
    region = region.strip()
    if not REGION_PATTERN.fullmatch(region):
        raise HTTPException(status_code=422, detail="Provide a valid AWS region identifier.")
    session = get_boto_session(request)
    try:
        account = session.client("sts", region_name=region, config=_CFG).get_caller_identity()["Account"]
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(status_code=502, detail=f"AWS identity check failed: {_msg(exc)}") from exc

    key = (account, region)
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_TTL_SECONDS:
            return {**hit[1], "cached": True}

    warnings: list[str] = []
    try:
        ce_data, ce_warn = _ce_section(session)
        warnings += ce_warn
    except (BotoCoreError, ClientError) as exc:
        ce_data = {"daily": [{"date": d.isoformat(), "cost": 0.0, "hours": 0.0} for d in _day_range(7)],
                   "cost": {"month_to_date": None, "last_month": None, "projected": None, "currency": "USD"}, "currency": "USD"}
        warnings.append(f"Cost Explorer unavailable: {_msg(exc)}")
    try:
        s3 = _s3_section(session, region)
    except (BotoCoreError, ClientError) as exc:
        s3 = None
        warnings.append(f"S3 storage metrics unavailable: {_msg(exc)}")
    try:
        network = _network_section(session, region)
    except (BotoCoreError, ClientError) as exc:
        network = None
        warnings.append(f"EC2 network metrics unavailable: {_msg(exc)}")

    payload = {
        "region": region,
        "currency": ce_data["currency"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "ec2_daily": ce_data["daily"],
        "cost": ce_data["cost"],
        "s3": s3,
        "network": network,
        "warnings": warnings,
        "cached": False,
    }
    with _lock:
        _cache[key] = (time.time(), payload)
        if len(_cache) > 500:  # keep memory bounded
            oldest = min(_cache, key=lambda k: _cache[k][0])
            _cache.pop(oldest, None)
    return payload