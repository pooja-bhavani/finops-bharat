from datetime import datetime, timezone
import logging
from typing import Any, Callable

import boto3
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)

GLOBAL_REGION = "global"
SCAN_CATEGORIES = ("Compute", "Storage", "Database", "Serverless", "Networking", "Security", "Management")
WASTE_STATES = {"unattached", "unassociated"}


def client_list_once(client, operation: str, result_key: str, **kwargs) -> list[dict[str, Any]]:
    response = getattr(client, operation)(**kwargs)
    items = list(response.get(result_key, []))
    token = response.get("NextToken")
    while token:
        response = getattr(client, operation)(**kwargs, NextToken=token)
        items.extend(response.get(result_key, []))
        token = response.get("NextToken")
    return items


class AWSFinOpsScanner:
    """Read-only, multi-service AWS inventory scanner using the runtime credential chain."""

    def __init__(self, region_name: str = "ap-south-1"):
        self.region_name = region_name
        self._errors: list[dict[str, str]] = []

    @staticmethod
    def get_cost_and_usage(request: dict[str, Any], ce_client=None) -> dict[str, Any]:
        """Fetch a Cost Explorer page and report AWS errors to the API layer."""
        try:
            if ce_client is None:
                ce_client = boto3.client("ce", region_name="us-east-1")
            return ce_client.get_cost_and_usage(**request)
        except (BotoCoreError, ClientError):
            logger.exception("AWS Cost Explorer GetCostAndUsage request failed")
            raise

    @staticmethod
    def list_enabled_regions(ec2_client=None, *, all_regions: bool = True) -> list[dict[str, str]]:
        if ec2_client is None:
            ec2_client = boto3.client("ec2", region_name="us-east-1")
        try:
            response = ec2_client.describe_regions(AllRegions=all_regions)
        except (BotoCoreError, ClientError):
            logger.exception("AWS EC2 DescribeRegions request failed")
            raise
        regions = []
        for region in response.get("Regions", []):
            status = region.get("OptInStatus")
            if status and status not in {"opt-in-not-required", "opted-in"}:
                continue
            name = region["RegionName"]
            regions.append({"id": name, "name": name})
        return sorted(regions, key=lambda region: region["id"])

    @staticmethod
    def _tags(resource: dict[str, Any]) -> dict[str, str]:
        tags = resource.get("Tags", [])
        if isinstance(tags, dict):
            return {str(key): str(value) for key, value in tags.items()}
        return {
            tag["Key"]: tag["Value"]
            for tag in tags
            if isinstance(tag, dict) and "Key" in tag and "Value" in tag
        }

    @classmethod
    def _resource(
        cls,
        *,
        identifier: Any,
        name: Any,
        service: str,
        category: str,
        resource_type: str,
        region: str,
        state: Any,
        details: str,
        waste_candidate: bool = False,
        created_at: Any = None,
    ) -> dict[str, Any]:
        normalized_state = str(state or "unknown").lower()
        return {
            "id": str(identifier or name or "unknown"),
            "name": str(name or identifier or "Unnamed resource"),
            "service": service,
            "category": category,
            "type": resource_type,
            "region": region,
            "state": normalized_state,
            "is_waste_candidate": waste_candidate or normalized_state in WASTE_STATES,
            "estimated_monthly_cost": None,
            "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else created_at,
            "details": details,
        }

    def _run(
        self,
        service: str,
        region: str,
        operation: str,
        action: Callable[[], list[dict[str, Any]]],
    ) -> list[dict[str, Any]]:
        try:
            return action()
        except (BotoCoreError, ClientError) as exc:
            logger.warning("AWS %s %s failed in %s: %s", service, operation, region, exc)
            self._errors.append({
                "service": service,
                "operation": operation,
                "region": region,
                "message": str(exc),
            })
            return []

    @staticmethod
    def _pages(client, operation: str, result_key: str, **kwargs) -> list[dict[str, Any]]:
        if hasattr(client, "can_paginate") and not client.can_paginate(operation):
            return client_list_once(client, operation, result_key, **kwargs)
        paginator = client.get_paginator(operation)
        return [
            item
            for page in paginator.paginate(**kwargs)
            for item in page.get(result_key, [])
        ]

    @staticmethod
    def _chunks(values: list[str], size: int) -> list[list[str]]:
        return [values[index:index + size] for index in range(0, len(values), size)]

    def _scan_region(self, region: str, ec2_client=None) -> list[dict[str, Any]]:
        found: list[dict[str, Any]] = []

        def collect(service_name: str, operation: str, action: Callable[[], list[dict[str, Any]]]):
            found.extend(self._run(service_name, region, operation, action))

        # Compute and containers
        ec2 = ec2_client
        if ec2 is None:
            try:
                ec2 = boto3.client("ec2", region_name=region)
            except (BotoCoreError, ClientError) as exc:
                self._errors.append({"service": "EC2", "operation": "create_client", "region": region, "message": str(exc)})
                logger.warning("AWS EC2 client creation failed in %s: %s", region, exc)

        if ec2 is not None:
            def instances():
                return [
                    self._resource(
                        identifier=instance.get("InstanceId"),
                        name=self._tags(instance).get("Name") or instance.get("InstanceId"),
                        service="EC2",
                        category="Compute",
                        resource_type=instance.get("InstanceType", "EC2 instance"),
                        region=region,
                        state=instance.get("State", {}).get("Name"),
                        details=f'{instance.get("InstanceType", "unknown")} · {instance.get("State", {}).get("Name", "unknown")}',
                        waste_candidate=instance.get("State", {}).get("Name") == "stopped",
                    )
                    for reservation in self._pages(ec2, "describe_instances", "Reservations")
                    for instance in reservation.get("Instances", [])
                ]

            collect("EC2", "DescribeInstances", instances)

            def volumes():
                return [
                    self._resource(
                        identifier=volume.get("VolumeId"),
                        name=self._tags(volume).get("Name") or volume.get("VolumeId"),
                        service="EBS",
                        category="Storage",
                        resource_type=volume.get("VolumeType", "EBS volume"),
                        region=region,
                        state="unattached" if volume.get("State") == "available" else volume.get("State"),
                        details=f'{volume.get("Size", 0)} GiB · {volume.get("VolumeType", "unknown")} · {len(volume.get("Attachments", []))} attachment(s)',
                        created_at=volume.get("CreateTime"),
                    )
                    for volume in self._pages(ec2, "describe_volumes", "Volumes")
                ]

            collect("EBS", "DescribeVolumes", volumes)

            def addresses():
                return [
                    self._resource(
                        identifier=address.get("AllocationId") or address.get("PublicIp"),
                        name=self._tags(address).get("Name") or address.get("PublicIp"),
                        service="EC2",
                        category="Networking",
                        resource_type="Elastic IP",
                        region=region,
                        state="associated" if address.get("AssociationId") else "unassociated",
                        details=f'{address.get("PublicIp", "Public IP not returned")} · {address.get("NetworkInterfaceId", "not attached to network interface")}',
                    )
                    for address in self._pages(ec2, "describe_addresses", "Addresses")
                ]

            collect("EC2", "DescribeAddresses", addresses)

            def vpcs():
                return [
                    self._resource(
                        identifier=vpc.get("VpcId"),
                        name=self._tags(vpc).get("Name") or vpc.get("VpcId"),
                        service="VPC",
                        category="Networking",
                        resource_type="VPC",
                        region=region,
                        state=vpc.get("State"),
                        details=f'{vpc.get("CidrBlock", "CIDR unavailable")} · default={vpc.get("IsDefault", False)}',
                    )
                    for vpc in self._pages(ec2, "describe_vpcs", "Vpcs")
                ]

            collect("VPC", "DescribeVpcs", vpcs)

            def nat_gateways():
                return [
                    self._resource(
                        identifier=nat.get("NatGatewayId"),
                        name=nat.get("NatGatewayId"),
                        service="VPC",
                        category="Networking",
                        resource_type="NAT Gateway",
                        region=region,
                        state=nat.get("State"),
                        details=f'{nat.get("ConnectivityType", "public")} · {nat.get("SubnetId", "subnet unavailable")}',
                        waste_candidate=nat.get("State") in {"deleted", "failed"},
                    )
                    for nat in self._pages(ec2, "describe_nat_gateways", "NatGateways")
                ]

            collect("VPC", "DescribeNatGateways", nat_gateways)

        def ecs_services():
            ecs = boto3.client("ecs", region_name=region)
            resources = []
            clusters = self._pages(ecs, "list_clusters", "clusterArns")
            for cluster_arn in clusters:
                cluster_name = cluster_arn.rsplit("/", 1)[-1]
                resources.append(self._resource(
                    identifier=cluster_arn,
                    name=cluster_name,
                    service="ECS",
                    category="Compute",
                    resource_type="ECS cluster",
                    region=region,
                    state="active",
                    details=cluster_arn,
                ))
                service_arns = self._pages(ecs, "list_services", "serviceArns", cluster=cluster_arn)
                for service_arns_chunk in self._chunks(service_arns, 10):
                    descriptions = ecs.describe_services(cluster=cluster_arn, services=service_arns_chunk)
                    for item in descriptions.get("services", []):
                        resources.append(self._resource(
                            identifier=item.get("serviceArn"),
                            name=item.get("serviceName"),
                            service="ECS",
                            category="Compute",
                            resource_type="ECS service",
                            region=region,
                            state=item.get("status"),
                            details=f'{item.get("runningCount", 0)} running / {item.get("desiredCount", 0)} desired tasks',
                        ))
            return resources

        collect("ECS", "ListClusters/DescribeServices", ecs_services)

        def eks_clusters():
            client = boto3.client("eks", region_name=region)
            names = self._pages(client, "list_clusters", "clusters")
            return [
                self._resource(
                    identifier=name, name=name, service="EKS", category="Compute",
                    resource_type="EKS cluster", region=region, state="unknown",
                    details="Cluster listed by EKS; describe permission not requested.",
                )
                for name in names
            ]

        collect("EKS", "ListClusters", eks_clusters)

        def apprunner_services():
            client = boto3.client("apprunner", region_name=region)
            if not client.can_paginate("list_services"):
                services = []
                token = None
                while True:
                    response = client.list_services(**({"NextToken": token} if token else {}))
                    services.extend(response.get("ServiceSummaryList", []))
                    token = response.get("NextToken")
                    if not token:
                        break
                listed = services
            else:
                listed = self._pages(client, "list_services", "ServiceSummaryList")
            return [
                self._resource(
                    identifier=item.get("ServiceArn"), name=item.get("ServiceName"), service="App Runner",
                    category="Compute", resource_type="App Runner service", region=region,
                    state=item.get("Status"), details=item.get("ServiceUrl", "Service URL unavailable"),
                )
                for item in listed
            ]

        collect("App Runner", "ListServices", apprunner_services)

        # Regional storage
        def efs():
            client = boto3.client("efs", region_name=region)
            return [
                self._resource(
                    identifier=item.get("FileSystemId"), name=item.get("Name") or item.get("FileSystemId"),
                    service="EFS", category="Storage", resource_type="EFS file system", region=region,
                    state=item.get("LifeCycleState"),
                    details=f'{item.get("SizeInBytes", {}).get("Value", 0)} bytes · {item.get("ThroughputMode", "unknown")} throughput',
                )
                for item in self._pages(client, "describe_file_systems", "FileSystems")
            ]

        collect("EFS", "DescribeFileSystems", efs)

        # Databases and caches
        def rds():
            client = boto3.client("rds", region_name=region)
            return [
                self._resource(
                    identifier=item.get("DBInstanceArn") or item.get("DBInstanceIdentifier"),
                    name=item.get("DBInstanceIdentifier"), service="RDS", category="Database",
                    resource_type=item.get("DBInstanceClass", "RDS instance"), region=region,
                    state=item.get("DBInstanceStatus"),
                    details=f'{item.get("Engine", "unknown")} {item.get("EngineVersion", "")} · {item.get("AllocatedStorage", 0)} GiB',
                )
                for item in self._pages(client, "describe_db_instances", "DBInstances")
            ]

        collect("RDS", "DescribeDBInstances", rds)

        def dynamodb():
            client = boto3.client("dynamodb", region_name=region)
            resources = []
            for table_name in self._pages(client, "list_tables", "TableNames"):
                table = client.describe_table(TableName=table_name).get("Table", {})
                capacity = table.get("ProvisionedThroughput", {})
                resources.append(self._resource(
                    identifier=table.get("TableArn") or table_name, name=table_name,
                    service="DynamoDB", category="Database", resource_type="DynamoDB table",
                    region=region, state=table.get("TableStatus"),
                    details=f'{table.get("BillingModeSummary", {}).get("BillingMode", "PROVISIONED")} · {capacity.get("ReadCapacityUnits", 0)} RCU / {capacity.get("WriteCapacityUnits", 0)} WCU',
                ))
            return resources

        collect("DynamoDB", "ListTables/DescribeTable", dynamodb)

        def elasticache():
            client = boto3.client("elasticache", region_name=region)
            return [
                self._resource(
                    identifier=item.get("ARN") or item.get("CacheClusterId"), name=item.get("CacheClusterId"),
                    service="ElastiCache", category="Database", resource_type=item.get("Engine", "cache cluster"),
                    region=region, state=item.get("CacheClusterStatus"),
                    details=f'{item.get("CacheNodeType", "unknown")} · {item.get("NumCacheNodes", 0)} node(s)',
                )
                for item in self._pages(client, "describe_cache_clusters", "CacheClusters", ShowCacheNodeInfo=False)
            ]

        collect("ElastiCache", "DescribeCacheClusters", elasticache)

        def redshift():
            client = boto3.client("redshift", region_name=region)
            return [
                self._resource(
                    identifier=item.get("ClusterNamespaceArn") or item.get("ClusterIdentifier"),
                    name=item.get("ClusterIdentifier"), service="Redshift", category="Database",
                    resource_type="Redshift cluster", region=region, state=item.get("ClusterStatus"),
                    details=f'{item.get("NodeType", "unknown")} · {item.get("NumberOfNodes", 0)} node(s)',
                )
                for item in self._pages(client, "describe_clusters", "Clusters")
            ]

        collect("Redshift", "DescribeClusters", redshift)

        # Serverless and integration
        def lambdas():
            client = boto3.client("lambda", region_name=region)
            return [
                self._resource(
                    identifier=item.get("FunctionArn") or item.get("FunctionName"), name=item.get("FunctionName"),
                    service="Lambda", category="Serverless", resource_type="Lambda function",
                    region=region, state=item.get("State", "active"),
                    details=f'{item.get("Runtime", "custom runtime")} · {item.get("MemorySize", 0)} MiB',
                )
                for item in self._pages(client, "list_functions", "Functions")
            ]

        collect("Lambda", "ListFunctions", lambdas)

        def api_gateway():
            client = boto3.client("apigateway", region_name=region)
            return [
                self._resource(
                    identifier=item.get("id"), name=item.get("name"), service="API Gateway",
                    category="Serverless", resource_type="REST API", region=region,
                    state="available", details=f'{item.get("endpointConfiguration", {}).get("types", ["unknown"])[0]} endpoint',
                )
                for item in self._pages(client, "get_rest_apis", "items")
            ]

        collect("API Gateway", "GetRestApis", api_gateway)

        def api_gateway_v2():
            client = boto3.client("apigatewayv2", region_name=region)
            return [
                self._resource(
                    identifier=item.get("ApiId"), name=item.get("Name"), service="API Gateway",
                    category="Serverless", resource_type=f'{item.get("ProtocolType", "HTTP")} API',
                    region=region, state="available", details=item.get("ApiEndpoint", "Endpoint unavailable"),
                )
                for item in self._pages(client, "get_apis", "Items")
            ]

        collect("API Gateway", "GetApis", api_gateway_v2)

        def sqs():
            client = boto3.client("sqs", region_name=region)
            queues = self._pages(client, "list_queues", "QueueUrls")
            return [
                self._resource(
                    identifier=url, name=url.rsplit("/", 1)[-1], service="SQS",
                    category="Serverless", resource_type="SQS queue", region=region,
                    state="available", details=url,
                )
                for url in queues
            ]

        collect("SQS", "ListQueues", sqs)

        def sns():
            client = boto3.client("sns", region_name=region)
            return [
                self._resource(
                    identifier=item.get("TopicArn"), name=(item.get("TopicArn") or "").rsplit(":", 1)[-1],
                    service="SNS", category="Serverless", resource_type="SNS topic",
                    region=region, state="available", details=item.get("TopicArn", ""),
                )
                for item in self._pages(client, "list_topics", "Topics")
            ]

        collect("SNS", "ListTopics", sns)

        # Networking and delivery
        def load_balancers():
            client = boto3.client("elbv2", region_name=region)
            return [
                self._resource(
                    identifier=item.get("LoadBalancerArn"), name=item.get("LoadBalancerName"),
                    service="Elastic Load Balancing", category="Networking",
                    resource_type=f'{item.get("Type", "load balancer").upper()} load balancer',
                    region=region, state=item.get("State", {}).get("Code"),
                    details=f'{item.get("Scheme", "unknown")} · {item.get("DNSName", "DNS unavailable")}',
                )
                for item in self._pages(client, "describe_load_balancers", "LoadBalancers")
            ]

        collect("ELB", "DescribeLoadBalancers", load_balancers)

        # Management and security
        def kms_keys():
            client = boto3.client("kms", region_name=region)
            return [
                self._resource(
                    identifier=item.get("KeyArn") or item.get("KeyId"), name=item.get("KeyId"),
                    service="KMS", category="Security", resource_type="KMS key",
                    region=region, state="available", details=item.get("KeyArn", "Key ARN unavailable"),
                )
                for item in self._pages(client, "list_keys", "Keys")
            ]

        collect("KMS", "ListKeys", kms_keys)

        def secrets():
            client = boto3.client("secretsmanager", region_name=region)
            return [
                self._resource(
                    identifier=item.get("ARN") or item.get("Name"), name=item.get("Name"),
                    service="Secrets Manager", category="Security", resource_type="secret",
                    region=region, state="active" if not item.get("DeletedDate") else "scheduled for deletion",
                    details=f'Last changed {item.get("LastChangedDate", "date unavailable")}',
                )
                for item in self._pages(client, "list_secrets", "SecretList")
            ]

        collect("Secrets Manager", "ListSecrets", secrets)

        def alarms():
            client = boto3.client("cloudwatch", region_name=region)
            return [
                self._resource(
                    identifier=item.get("AlarmArn") or item.get("AlarmName"), name=item.get("AlarmName"),
                    service="CloudWatch", category="Management", resource_type="alarm",
                    region=region, state=item.get("StateValue"),
                    details=item.get("MetricName") or item.get("AlarmDescription") or "CloudWatch alarm",
                )
                for item in self._pages(client, "describe_alarms", "MetricAlarms")
            ]

        collect("CloudWatch", "DescribeAlarms", alarms)

        return found

    def _scan_global_services(self, region: str) -> list[dict[str, Any]]:
        resources: list[dict[str, Any]] = []

        def run(service: str, operation: str, action: Callable[[], list[dict[str, Any]]]):
            try:
                resources.extend(action())
            except (BotoCoreError, ClientError) as exc:
                logger.warning("AWS %s %s failed: %s", service, operation, exc)
                self._errors.append({"service": service, "operation": operation, "region": GLOBAL_REGION, "message": str(exc)})

        def buckets():
            client = boto3.client("s3", region_name=region)
            result = []
            for bucket in client.list_buckets().get("Buckets", []):
                public_status = "unknown"
                try:
                    public_status = client.get_public_access_block(Bucket=bucket["Name"]).get(
                        "PublicAccessBlockConfiguration", {}
                    )
                    public_status = "blocked" if all(public_status.values()) else "not fully blocked"
                except (BotoCoreError, ClientError) as exc:
                    logger.info("S3 public access status unavailable for %s: %s", bucket["Name"], exc)
                    self._errors.append({
                        "service": "S3",
                        "operation": "GetPublicAccessBlock",
                        "region": GLOBAL_REGION,
                        "message": f'{bucket["Name"]}: {exc}',
                    })
                result.append(self._resource(
                    identifier=bucket.get("Name"), name=bucket.get("Name"), service="S3",
                    category="Storage", resource_type="S3 bucket", region=GLOBAL_REGION,
                    state="available",
                    details=f'Created {bucket.get("CreationDate", "date unavailable")} · public access {public_status}',
                ))
            return result

        run("S3", "ListBuckets/GetPublicAccessBlock", buckets)

        def cloudfront():
            client = boto3.client("cloudfront", region_name="us-east-1")
            paginator = client.get_paginator("list_distributions")
            result = []
            for page in paginator.paginate():
                listing = page.get("DistributionList", {})
                for item in listing.get("Items", []):
                    result.append(self._resource(
                        identifier=item.get("ARN") or item.get("Id"),
                        name=item.get("DomainName") or item.get("Id"),
                        service="CloudFront", category="Networking", resource_type="distribution",
                        region=GLOBAL_REGION, state="deployed" if item.get("Status") == "Deployed" else item.get("Status"),
                        details=f'{item.get("Enabled", False) and "enabled" or "disabled"} · {item.get("DomainName", "")}',
                    ))
            return result

        run("CloudFront", "ListDistributions", cloudfront)
        return resources

    def scan_resources(self, region_name: str | None = None, ec2_client=None) -> list[dict[str, Any]]:
        selected_region = (region_name or self.region_name).strip()
        self._errors = []
        if selected_region.lower() == "all":
            regions = self.list_enabled_regions()
            resources = []
            for region in regions:
                resources.extend(self._scan_region(region["id"]))
            resources.extend(self._scan_global_services(self.region_name))
            self.last_scan_metadata = {"regions_scanned": [region["id"] for region in regions], "errors": self._errors[:]}
            return resources

        resources = self._scan_region(selected_region, ec2_client=ec2_client)
        resources.extend(self._scan_global_services(selected_region))
        self.last_scan_metadata = {"regions_scanned": [selected_region], "errors": self._errors[:]}
        return resources
