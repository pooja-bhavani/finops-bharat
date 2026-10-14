"""Read-only AWS inventory scanner for FinOps-Bharat.

The scanner is bound to ONE boto3 session. For a visitor who connected their own account that
session holds the assumed-role credentials, so every call below runs inside THEIR account.
Nothing is cached at module level, so one visitor's data can never reach another.

    AWSFinOpsScanner(region_name="us-east-1", session=boto3_session)

Only describe/list/get calls are made. Nothing is created, changed or deleted.
"""
from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger("finops_scanner")

MAX_WORKERS = 8
MAX_S3_BUCKETS = 300
_BOTO_CONFIG = Config(retries={"max_attempts": 3, "mode": "standard"}, connect_timeout=5, read_timeout=20)


# Services/types the dedicated scanners above already cover, so the catch-all skips them.
_COVERED = {
    ("ec2", "instance"), ("ec2", "volume"), ("ec2", "elastic-ip"), ("ec2", "natgateway"),
    ("elasticloadbalancing", "loadbalancer"), ("rds", "db"), ("lambda", "function"),
    ("dynamodb", "table"), ("eks", "cluster"), ("s3", ""),
    # Dedicated scanners below, so brand-new untagged resources show up without any tag.
    ("sqs", ""), ("sns", ""), ("ecs", "cluster"), ("elasticache", "cluster"), ("apigateway", ""),
    ("states", "stateMachine"), ("kinesis", "stream"), ("secretsmanager", "secret"),
    ("ecr", "repository"), ("cloudformation", "stack"),
}
_SERVICE_LABELS = {
    "sqs": "SQS", "sns": "SNS", "ecs": "ECS", "ecr": "ECR", "elasticache": "ElastiCache",
    "kms": "KMS", "states": "Step Functions", "apigateway": "API Gateway", "cloudfront": "CloudFront",
    "logs": "CloudWatch Logs", "events": "EventBridge", "secretsmanager": "Secrets Manager",
    "ssm": "Systems Manager", "es": "OpenSearch", "kinesis": "Kinesis", "route53": "Route 53",
    "acm": "ACM", "cloudformation": "CloudFormation", "elasticbeanstalk": "Elastic Beanstalk",
}
_DEFAULT_TYPE = {"sqs": "Queue", "sns": "Topic", "kms": "Key", "secretsmanager": "Secret", "es": "Domain"}


def _split_arn(arn: str) -> tuple[str, str, str]:
    """Return (service, resource_type, resource_id) from an ARN, tolerant of every ARN shape."""
    parts = arn.split(":", 5)
    service = parts[2] if len(parts) > 2 else ""
    tail = parts[5] if len(parts) > 5 else ""
    for sep in ("/", ":"):
        if sep in tail:
            rtype, rid = tail.split(sep, 1)
            return service, rtype, rid
    return service, "", tail


def _tag_name(tags: list[dict] | None, fallback: str) -> str:
    for tag in tags or []:
        if tag.get("Key") == "Name" and tag.get("Value"):
            return tag["Value"]
    return fallback


def _resource(
    *, rid: str, name: str, service: str, category: str, rtype: str, region: str,
    state: str = "", waste: bool = False, details: str = "", cost: float | None = None,
) -> dict[str, Any]:
    return {
        "id": rid,
        "name": name or rid,
        "service": service,
        "category": category,
        "type": rtype,
        "region": region,
        "state": state,
        "is_waste_candidate": bool(waste),
        "estimated_monthly_cost": cost,
        "details": details,
    }


class AWSFinOpsScanner:
    def __init__(self, region_name: str = "us-east-1", session: boto3.Session | None = None):
        self.region_name = region_name
        self.session = session or boto3.Session()
        self.last_scan_metadata: dict[str, Any] = {"errors": [], "regions_scanned": []}
        self._client_lock = threading.Lock()

    # ------------------------------------------------------------------ helpers
    def _client(self, service: str, region: str):
        # Creating clients from one Session is not thread-safe, so serialise creation only.
        with self._client_lock:
            return self.session.client(service, region_name=region, config=_BOTO_CONFIG)

    def list_enabled_regions(self) -> list[dict[str, str]]:
        """Regions this account can use (opted-in/default regions), as [{"id", "name"}]."""
        response = self._client("ec2", self.region_name).describe_regions(AllRegions=False)
        names = sorted(item["RegionName"] for item in response.get("Regions", []))
        return [{"id": name, "name": name} for name in names]

    def get_cost_and_usage(self, query: dict, ce_client=None) -> dict:
        client = ce_client or self._client("ce", "us-east-1")  # Cost Explorer only exists in us-east-1
        return client.get_cost_and_usage(**query)

    # --------------------------------------------------------------------- scan
    def scan_resources(self, region_name: str | None = None) -> list[dict[str, Any]]:
        """Inventory one region, or every enabled region when region_name == "all"."""
        target = (region_name or self.region_name).strip()
        errors: list[dict[str, str]] = []
        err_lock = threading.Lock()

        def record(service: str, operation: str, region: str, exc: Exception) -> None:
            if isinstance(exc, ClientError):
                message = exc.response.get("Error", {}).get("Message") or exc.response.get("Error", {}).get("Code", str(exc))
            else:
                message = str(exc)
            logger.warning("%s %s failed in %s: %s", service, operation, region, message)
            with err_lock:
                errors.append({"service": service, "operation": operation, "region": region, "message": message})

        if target.lower() == "all":
            regions = [item["id"] for item in self.list_enabled_regions()]
        else:
            regions = [target]

        resources: list[dict[str, Any]] = []
        res_lock = threading.Lock()

        def run(region: str, service: str, operation: str, func: Callable[[str], list[dict]]) -> None:
            try:
                found = func(region)
            except (BotoCoreError, ClientError) as exc:
                record(service, operation, region, exc)
                return
            with res_lock:
                resources.extend(found)

        regional_jobs: list[tuple[str, str, str, Callable[[str], list[dict]]]] = []
        for region in regions:
            regional_jobs += [
                (region, "EC2", "DescribeInstances", self._ec2_instances),
                (region, "EBS", "DescribeVolumes", self._ebs_volumes),
                (region, "EC2", "DescribeAddresses", self._elastic_ips),
                (region, "VPC", "DescribeNatGateways", self._nat_gateways),
                (region, "ELB", "DescribeLoadBalancers", self._load_balancers),
                (region, "RDS", "DescribeDBInstances", self._rds_instances),
                (region, "Lambda", "ListFunctions", self._lambda_functions),
                (region, "DynamoDB", "ListTables", self._dynamodb_tables),
                (region, "EKS", "ListClusters", self._eks_clusters),
                (region, "SQS", "ListQueues", self._sqs_queues),
                (region, "SNS", "ListTopics", self._sns_topics),
                (region, "ECS", "ListClusters", self._ecs_clusters),
                (region, "ElastiCache", "DescribeCacheClusters", self._elasticache_clusters),
                (region, "API Gateway", "GetApis", self._api_gateways),
                (region, "Step Functions", "ListStateMachines", self._state_machines),
                (region, "Kinesis", "ListStreams", self._kinesis_streams),
                (region, "Secrets Manager", "ListSecrets", self._secrets),
                (region, "ECR", "DescribeRepositories", self._ecr_repositories),
                (region, "CloudFormation", "DescribeStacks", self._cloudformation_stacks),
                (region, "Tagging", "GetResources", self._other_resources),
            ]

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = [pool.submit(run, *job) for job in regional_jobs]
            futures.append(pool.submit(self._run_s3, regions, target.lower() == "all", resources, res_lock, record))
            for future in futures:
                future.result()

        resources.sort(key=lambda r: (r["region"], r["service"], r["type"], r["name"]))
        errors.sort(key=lambda e: (e["region"], e["service"]))
        self.last_scan_metadata = {"errors": errors, "regions_scanned": regions}
        return resources

    # ----------------------------------------------------------- per-service scans
    def _ec2_instances(self, region: str) -> list[dict]:
        out = []
        for page in self._client("ec2", region).get_paginator("describe_instances").paginate():
            for reservation in page.get("Reservations", []):
                for inst in reservation.get("Instances", []):
                    state = inst.get("State", {}).get("Name", "")
                    if state == "terminated":
                        continue
                    out.append(_resource(
                        rid=inst["InstanceId"], name=_tag_name(inst.get("Tags"), inst["InstanceId"]),
                        service="EC2", category="Compute", rtype=inst.get("InstanceType", "Instance"),
                        region=region, state=state, waste=(state == "stopped"),
                        details="Stopped instance: its EBS volumes still cost money." if state == "stopped" else "",
                    ))
        return out

    def _ebs_volumes(self, region: str) -> list[dict]:
        out = []
        for page in self._client("ec2", region).get_paginator("describe_volumes").paginate():
            for vol in page.get("Volumes", []):
                state = vol.get("State", "")
                unattached = state == "available"
                out.append(_resource(
                    rid=vol["VolumeId"], name=_tag_name(vol.get("Tags"), vol["VolumeId"]),
                    service="EBS", category="Storage", rtype=f"{vol.get('VolumeType', 'volume')} volume",
                    region=region, state=state, waste=unattached,
                    details=f"{vol.get('Size', '?')} GiB" + (" · not attached to any instance" if unattached else ""),
                ))
        return out

    def _elastic_ips(self, region: str) -> list[dict]:
        out = []
        for addr in self._client("ec2", region).describe_addresses().get("Addresses", []):
            associated = bool(addr.get("AssociationId") or addr.get("InstanceId") or addr.get("NetworkInterfaceId"))
            ip = addr.get("PublicIp", "")
            out.append(_resource(
                rid=addr.get("AllocationId") or ip, name=_tag_name(addr.get("Tags"), ip),
                service="EC2", category="Networking", rtype="Elastic IP", region=region,
                state="associated" if associated else "unassociated", waste=not associated,
                details=ip + ("" if associated else " · not associated; idle Elastic IPs are billed"),
            ))
        return out

    def _nat_gateways(self, region: str) -> list[dict]:
        out = []
        for page in self._client("ec2", region).get_paginator("describe_nat_gateways").paginate():
            for nat in page.get("NatGateways", []):
                state = nat.get("State", "")
                if state in ("deleted", "deleting"):
                    continue
                out.append(_resource(
                    rid=nat["NatGatewayId"], name=_tag_name(nat.get("Tags"), nat["NatGatewayId"]),
                    service="VPC", category="Networking", rtype="NAT gateway", region=region, state=state,
                    details=f"VPC {nat.get('VpcId', '')} · billed hourly plus data processed",
                ))
        return out

    def _load_balancers(self, region: str) -> list[dict]:
        out = []
        for page in self._client("elbv2", region).get_paginator("describe_load_balancers").paginate():
            for lb in page.get("LoadBalancers", []):
                out.append(_resource(
                    rid=lb["LoadBalancerArn"], name=lb.get("LoadBalancerName", ""), service="ELB",
                    category="Networking", rtype=f"{lb.get('Type', 'load balancer')} load balancer",
                    region=region, state=lb.get("State", {}).get("Code", ""), details=lb.get("DNSName", ""),
                ))
        return out

    def _rds_instances(self, region: str) -> list[dict]:
        out = []
        for page in self._client("rds", region).get_paginator("describe_db_instances").paginate():
            for db in page.get("DBInstances", []):
                state = db.get("DBInstanceStatus", "")
                out.append(_resource(
                    rid=db["DBInstanceIdentifier"], name=db["DBInstanceIdentifier"], service="RDS",
                    category="Database", rtype=db.get("DBInstanceClass", "DB instance"), region=region,
                    state=state, waste=(state == "stopped"),
                    details=f"{db.get('Engine', '')} · {db.get('AllocatedStorage', '?')} GiB storage",
                ))
        return out

    def _lambda_functions(self, region: str) -> list[dict]:
        out = []
        for page in self._client("lambda", region).get_paginator("list_functions").paginate():
            for fn in page.get("Functions", []):
                out.append(_resource(
                    rid=fn["FunctionName"], name=fn["FunctionName"], service="Lambda", category="Serverless",
                    rtype="Function", region=region, state=fn.get("State", "Active"),
                    details=f"{fn.get('Runtime', 'container image')} · {fn.get('MemorySize', '?')} MB",
                ))
        return out

    def _dynamodb_tables(self, region: str) -> list[dict]:
        out = []
        for page in self._client("dynamodb", region).get_paginator("list_tables").paginate():
            for table in page.get("TableNames", []):
                out.append(_resource(
                    rid=table, name=table, service="DynamoDB", category="Database", rtype="Table",
                    region=region, state="active",
                ))
        return out

    def _eks_clusters(self, region: str) -> list[dict]:
        client = self._client("eks", region)
        out = []
        for page in client.get_paginator("list_clusters").paginate():
            for name in page.get("clusters", []):
                try:
                    cluster = client.describe_cluster(name=name)["cluster"]
                    state, version = cluster.get("status", ""), cluster.get("version", "")
                except (BotoCoreError, ClientError):
                    state, version = "", ""
                out.append(_resource(
                    rid=name, name=name, service="EKS", category="Containers", rtype="Kubernetes cluster",
                    region=region, state=state, details=f"Kubernetes {version}".strip(),
                ))
        return out

    # Services below are listed directly (not via tags) so a resource shows up the moment it exists.
    def _sqs_queues(self, region: str) -> list[dict]:
        client = self._client("sqs", region)
        out = []
        for page in client.get_paginator("list_queues").paginate():
            for url in page.get("QueueUrls", []):
                name = url.rsplit("/", 1)[-1]
                out.append(_resource(
                    rid=url, name=name, service="SQS", category="Messaging",
                    rtype="FIFO queue" if name.endswith(".fifo") else "Queue", region=region, state="active",
                ))
        return out

    def _sns_topics(self, region: str) -> list[dict]:
        out = []
        for page in self._client("sns", region).get_paginator("list_topics").paginate():
            for topic in page.get("Topics", []):
                arn = topic["TopicArn"]
                out.append(_resource(
                    rid=arn, name=arn.rsplit(":", 1)[-1], service="SNS", category="Messaging",
                    rtype="Topic", region=region, state="active",
                ))
        return out

    def _ecs_clusters(self, region: str) -> list[dict]:
        client = self._client("ecs", region)
        arns: list[str] = []
        for page in client.get_paginator("list_clusters").paginate():
            arns += page.get("clusterArns", [])
        out = []
        for i in range(0, len(arns), 100):
            for cluster in client.describe_clusters(clusters=arns[i:i + 100]).get("clusters", []):
                out.append(_resource(
                    rid=cluster["clusterArn"], name=cluster.get("clusterName", ""), service="ECS",
                    category="Containers", rtype="Cluster", region=region, state=cluster.get("status", "").lower(),
                    details=f"{cluster.get('runningTasksCount', 0)} running tasks · {cluster.get('activeServicesCount', 0)} services",
                ))
        return out

    def _elasticache_clusters(self, region: str) -> list[dict]:
        out = []
        for page in self._client("elasticache", region).get_paginator("describe_cache_clusters").paginate():
            for c in page.get("CacheClusters", []):
                out.append(_resource(
                    rid=c["CacheClusterId"], name=c["CacheClusterId"], service="ElastiCache", category="Database",
                    rtype=c.get("CacheNodeType", "Cache cluster"), region=region,
                    state=c.get("CacheClusterStatus", ""), details=f"{c.get('Engine', '')} · {c.get('NumCacheNodes', '?')} node(s)",
                ))
        return out

    def _api_gateways(self, region: str) -> list[dict]:
        out = []
        for page in self._client("apigateway", region).get_paginator("get_rest_apis").paginate():
            for api in page.get("items", []):
                out.append(_resource(
                    rid=api["id"], name=api.get("name", api["id"]), service="API Gateway", category="Networking",
                    rtype="REST API", region=region, state="active",
                ))
        for api in self._client("apigatewayv2", region).get_apis().get("Items", []):
            out.append(_resource(
                rid=api["ApiId"], name=api.get("Name", api["ApiId"]), service="API Gateway", category="Networking",
                rtype=f"{api.get('ProtocolType', 'HTTP')} API", region=region, state="active",
            ))
        return out

    def _state_machines(self, region: str) -> list[dict]:
        out = []
        for page in self._client("stepfunctions", region).get_paginator("list_state_machines").paginate():
            for sm in page.get("stateMachines", []):
                out.append(_resource(
                    rid=sm["stateMachineArn"], name=sm["name"], service="Step Functions", category="Serverless",
                    rtype=f"{sm.get('type', 'STANDARD').capitalize()} state machine", region=region, state="active",
                ))
        return out

    def _kinesis_streams(self, region: str) -> list[dict]:
        out = []
        for page in self._client("kinesis", region).get_paginator("list_streams").paginate():
            for name in page.get("StreamNames", []):
                out.append(_resource(
                    rid=name, name=name, service="Kinesis", category="Streaming", rtype="Data stream",
                    region=region, state="active",
                ))
        return out

    def _secrets(self, region: str) -> list[dict]:
        out = []
        for page in self._client("secretsmanager", region).get_paginator("list_secrets").paginate():
            for sec in page.get("SecretList", []):
                out.append(_resource(
                    rid=sec["ARN"], name=sec.get("Name", ""), service="Secrets Manager", category="Security",
                    rtype="Secret", region=region, state="active", details="Billed per secret per month",
                ))
        return out

    def _ecr_repositories(self, region: str) -> list[dict]:
        out = []
        for page in self._client("ecr", region).get_paginator("describe_repositories").paginate():
            for repo in page.get("repositories", []):
                out.append(_resource(
                    rid=repo["repositoryArn"], name=repo["repositoryName"], service="ECR", category="Containers",
                    rtype="Repository", region=region, state="active", details=repo.get("repositoryUri", ""),
                ))
        return out

    def _cloudformation_stacks(self, region: str) -> list[dict]:
        out = []
        for page in self._client("cloudformation", region).get_paginator("describe_stacks").paginate():
            for stack in page.get("Stacks", []):
                out.append(_resource(
                    rid=stack["StackId"], name=stack["StackName"], service="CloudFormation", category="Management",
                    rtype="Stack", region=region, state=stack.get("StackStatus", "").lower(),
                ))
        return out

    def _other_resources(self, region: str) -> list[dict]:
        """Catch-all: any other service's resources via the Resource Groups Tagging API.

        Needs no setup in the customer's account. Limitation: AWS only returns resources that are
        tagged or were tagged at some point, so a brand-new untagged resource of a service without a
        dedicated scanner above can be missing. Tag it (any tag) and it appears.
        """
        out, seen = [], set()
        paginator = self._client("resourcegroupstaggingapi", region).get_paginator("get_resources")
        for page in paginator.paginate(ResourcesPerPage=100):
            for item in page.get("ResourceTagMappingList", []):
                arn = item.get("ResourceARN", "")
                service, rtype, rid = _split_arn(arn)
                if not service or (service, rtype) in _COVERED or arn in seen:
                    continue
                seen.add(arn)
                fallback = (rid or arn).rsplit("/", 1)[-1]
                label = _SERVICE_LABELS.get(service, service.upper() if len(service) <= 4 else service.capitalize())
                out.append(_resource(
                    rid=arn, name=_tag_name(item.get("Tags"), fallback), service=label, category="Other",
                    rtype=(rtype or _DEFAULT_TYPE.get(service, "Resource")).replace("-", " ").capitalize(),
                    region=region, state="active", details=arn,
                ))
        return out

    def _run_s3(self, regions: list[str], is_all: bool, resources: list, res_lock, record) -> None:
        """S3 buckets are global: list once, then keep the buckets that live in the scanned region(s)."""
        home = regions[0] if regions else self.region_name
        try:
            client = self._client("s3", home)
            buckets = client.list_buckets().get("Buckets", [])
        except (BotoCoreError, ClientError) as exc:
            record("S3", "ListBuckets", home, exc)
            return
        wanted = set(regions)
        if len(buckets) > MAX_S3_BUCKETS:
            record("S3", "ListBuckets", home, RuntimeError(f"Account has {len(buckets)} buckets; only the first {MAX_S3_BUCKETS} were checked."))
            buckets = buckets[:MAX_S3_BUCKETS]
        found = []
        for bucket in buckets:
            name = bucket["Name"]
            try:
                location = client.get_bucket_location(Bucket=name).get("LocationConstraint") or "us-east-1"
                if location == "EU":
                    location = "eu-west-1"
            except (BotoCoreError, ClientError) as exc:
                record("S3", "GetBucketLocation", home, exc)
                continue
            if location in wanted:
                found.append(_resource(
                    rid=name, name=name, service="S3", category="Storage", rtype="Bucket",
                    region=location, state="active",
                ))
        with res_lock:
            resources.extend(found)
