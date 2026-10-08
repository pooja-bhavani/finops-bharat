import asyncio
import base64
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import unittest
from unittest.mock import AsyncMock, patch

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509 import Name, NameAttribute
from cryptography.x509.oid import NameOID
from fastapi import HTTPException

import governance


class Paginator:
    def __init__(self, pages):
        self._pages = pages

    def paginate(self, **_kwargs):
        return iter(self._pages)


class GovernanceTests(unittest.TestCase):
    def test_monthly_service_costs_sum_cost_explorer_pages(self):
        class CostExplorer:
            def __init__(self):
                self.requests = []

            def get_cost_and_usage(self, **kwargs):
                self.requests.append(kwargs)
                if "NextPageToken" not in kwargs:
                    return {
                        "ResultsByTime": [{"Groups": [{
                            "Keys": ["Amazon EC2"],
                            "Metrics": {"UnblendedCost": {"Amount": "10.25", "Unit": "USD"}},
                        }]}],
                        "NextPageToken": "next",
                    }
                return {"ResultsByTime": [{"Groups": [
                    {
                        "Keys": ["Amazon EC2"],
                        "Metrics": {"UnblendedCost": {"Amount": "0.75", "Unit": "USD"}},
                    },
                    {
                        "Keys": ["Amazon S3"],
                        "Metrics": {"UnblendedCost": {"Amount": "3.00", "Unit": "USD"}},
                    },
                ]}]}

        client = CostExplorer()
        result = governance._monthly_service_costs(
            client,
            datetime(2026, 9, 1).date(),
            datetime(2026, 10, 1).date(),
        )
        self.assertEqual(result[0], {"service": "Amazon EC2", "amount": "11.00", "currency": "USD"})
        self.assertEqual(result[1], {"service": "Amazon S3", "amount": "3.00", "currency": "USD"})
        self.assertEqual(client.requests[1]["NextPageToken"], "next")

    def test_webhook_url_validation_only_allows_https_supported_destinations(self):
        self.assertEqual(
            governance._validate_webhook_url("https://hooks.slack.com/services/team/key"),
            "https://hooks.slack.com/services/team/key",
        )
        self.assertEqual(
            governance._validate_webhook_url("https://tenant.webhook.office.com/webhookb2/id"),
            "https://tenant.webhook.office.com/webhookb2/id",
        )
        for url in (
            "http://hooks.slack.com/services/team/key",
            "https://localhost/callback",
            "https://attacker.example/hooks.slack.com",
            "https://user:pass@hooks.slack.com/services/team/key",
        ):
            with self.subTest(url=url), self.assertRaises(HTTPException) as error:
                governance._validate_webhook_url(url)
            self.assertEqual(error.exception.status_code, 422)

    def test_sns_signing_certificate_rejects_non_aws_host_and_path(self):
        valid = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc123.pem"
        self.assertEqual(governance._sns_certificate_url(valid), valid)
        for url in (
            "https://evil.example/SimpleNotificationService-abc.pem",
            "http://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem",
            "https://sns.us-east-1.amazonaws.com/other.pem",
            "https://sns.us-east-1.amazonaws.com@evil.example/SimpleNotificationService-abc.pem",
        ):
            with self.subTest(url=url), self.assertRaises(HTTPException):
                governance._sns_certificate_url(url)

    def test_sns_signature_string_uses_message_type_order(self):
        payload = {
            "Type": "Notification",
            "Message": "Anomaly",
            "MessageId": "message-id",
            "Timestamp": "2026-10-07T12:00:00Z",
            "TopicArn": "arn:aws:sns:us-east-1:123456789012:cost",
        }
        self.assertEqual(
            governance._sns_signing_string(payload),
            b"Message\nAnomaly\nMessageId\nmessage-id\nTimestamp\n2026-10-07T12:00:00Z\n"
            b"TopicArn\narn:aws:sns:us-east-1:123456789012:cost\nType\nNotification\n",
        )

    def test_webhook_dispatch_continues_after_failure_and_supports_retry(self):
        destinations = [
            ("Slack", "https://hooks.slack.com/services/slack/key"),
            ("Microsoft Teams", "https://tenant.webhook.office.com/webhookb2/id"),
        ]
        with (
            patch.object(governance, "_configured_webhooks", return_value=destinations),
            patch.object(governance, "_post_webhook", new_callable=AsyncMock) as send,
        ):
            send.side_effect = [None, HTTPException(status_code=502, detail="destination unavailable")]
            with self.assertRaises(HTTPException) as error:
                asyncio.run(governance._dispatch_message("alert", event={}))
            self.assertEqual(error.exception.headers["X-Webhook-Delivered"], "Slack")

            send.reset_mock()
            send.side_effect = None
            send.return_value = None
            result = asyncio.run(governance._dispatch_message(
                "alert",
                event={},
                already_delivered={"Slack"},
            ))
        self.assertEqual(result["destinations"], ["Slack", "Microsoft Teams"])
        self.assertEqual(send.await_count, 1)
        self.assertIn("webhook.office.com", send.await_args.args[0])

    def test_cicd_audit_returns_only_old_runner_tagged_unattached_volumes(self):
        old = datetime.now(timezone.utc) - timedelta(days=2)
        recent = datetime.now(timezone.utc) - timedelta(hours=2)

        class EC2:
            def describe_volumes(self, **_kwargs):
                return {"Volumes": [
                    {
                        "VolumeId": "vol-runner-old",
                        "CreateTime": old,
                        "State": "available",
                        "Size": 15,
                        "VolumeType": "gp3",
                        "Tags": [{"Key": "Ephemeral", "Value": "true"}],
                    },
                    {
                        "VolumeId": "vol-general-old",
                        "CreateTime": old,
                        "State": "available",
                        "Tags": [],
                    },
                    {
                        "VolumeId": "vol-runner-recent",
                        "CreateTime": recent,
                        "State": "available",
                        "Tags": [{"Key": "GitHubActionsRunner", "Value": "true"}],
                    },
                ]}

        with patch.object(governance.boto3, "client", return_value=EC2()):
            result = governance.cicd_audit("ap-south-1")
        self.assertEqual([disk["volume_id"] for disk in result["stale_unattached_ebs"]], ["vol-runner-old"])
        self.assertFalse(result["docker_volume_audit_supported"])
        self.assertIsNone(result["docker_volumes"])

    def test_tag_audit_computes_percentage_from_live_resource_tags(self):
        class EC2:
            def get_paginator(self, operation):
                if operation == "describe_instances":
                    return Paginator([{"Reservations": [{
                        "Instances": [{
                            "InstanceId": "i-tagged",
                            "State": {"Name": "running"},
                            "Tags": [
                                {"Key": "Owner", "Value": "platform"},
                                {"Key": "Environment", "Value": "Dev"},
                                {"Key": "CostCenter", "Value": "42"},
                            ],
                        }],
                    }]}])
                return Paginator([{"Volumes": [{
                    "VolumeId": "vol-untagged",
                    "State": "available",
                    "Tags": [{"Key": "Owner", "Value": "platform"}],
                }]}])

            def describe_addresses(self):
                return {"Addresses": []}

        class RDS:
            def get_paginator(self, _operation):
                return Paginator([{"DBInstances": []}])

        with patch.object(governance.boto3, "client", side_effect=lambda service, **_kwargs: {
            "ec2": EC2(),
            "rds": RDS(),
        }[service]):
            result = governance.governance_tags("ap-south-1")
        self.assertEqual(result["resource_count"], 2)
        self.assertEqual(result["compliant_count"], 1)
        self.assertEqual(result["compliance_percent"], 50)
        self.assertEqual(result["resources"][1]["missing_tags"], ["Environment", "CostCenter"])

    def test_cloudwatch_metric_queries_use_discovered_metric_dimensions(self):
        class CloudWatch:
            def list_metrics(self, **kwargs):
                self.requested_metric = kwargs["MetricName"]
                return {"Metrics": [{
                    "Namespace": "ContainerInsights",
                    "MetricName": kwargs["MetricName"],
                    "Dimensions": [
                        {"Name": "ClusterName", "Value": "live-cluster"},
                        {"Name": "NodeName", "Value": "ip-10-0-0-1"},
                    ],
                }]}

        client = CloudWatch()
        queries, warnings = governance._metric_queries(client, "live-cluster", ["node_cpu_utilization"])
        self.assertEqual(warnings, [])
        self.assertEqual(len(queries), 1)
        self.assertEqual(
            queries[0]["MetricStat"]["Metric"]["Dimensions"][1],
            {"Name": "NodeName", "Value": "ip-10-0-0-1"},
        )

    def test_eks_inventory_reads_active_clusters_and_cloudwatch_datapoints(self):
        class EKS:
            def get_paginator(self, operation):
                if operation == "list_clusters":
                    return Paginator([{"clusters": ["cluster-live"]}])
                return Paginator([{"nodegroups": ["workers"]}])

            def describe_cluster(self, **_kwargs):
                return {"cluster": {"status": "ACTIVE", "version": "1.30"}}

            def describe_nodegroup(self, **_kwargs):
                return {"nodegroup": {
                    "status": "ACTIVE",
                    "scalingConfig": {"desiredSize": 2},
                    "instanceTypes": ["m7i.large"],
                    "capacityType": "ON_DEMAND",
                }}

        class CloudWatch:
            def list_metrics(self, **kwargs):
                return {"Metrics": [{
                    "Namespace": "ContainerInsights",
                    "MetricName": kwargs["MetricName"],
                    "Dimensions": [{"Name": "ClusterName", "Value": "cluster-live"}],
                }]}

            def get_metric_data(self, **kwargs):
                return {"MetricDataResults": [
                    {
                        "Id": query["Id"],
                        "Label": query["Label"],
                        "Timestamps": [datetime.now(timezone.utc)],
                        "Values": [42.0],
                        "StatusCode": "Complete",
                    }
                    for query in kwargs["MetricDataQueries"]
                ]}

        with patch.object(governance.boto3, "client", side_effect=lambda service, **_kwargs: {
            "eks": EKS(),
            "cloudwatch": CloudWatch(),
        }[service]):
            result = governance.eks_inventory("ap-south-1")
        self.assertEqual(len(result["clusters"]), 1)
        self.assertEqual(result["clusters"][0]["nodegroups"][0]["desired_size"], 2)
        self.assertEqual(len(result["clusters"][0]["container_insights_metrics"]), 4)
        self.assertEqual(result["clusters"][0]["container_insights_metrics"][0]["latest_value"], 42.0)

    def test_ecr_cost_allocation_uses_live_image_sizes_and_actual_cost(self):
        old = datetime.now(timezone.utc) - timedelta(days=90)
        recent = datetime.now(timezone.utc) - timedelta(days=2)

        class ECR:
            def get_paginator(self, operation):
                if operation == "describe_repositories":
                    return Paginator([{"repositories": [{"repositoryName": "service"}]}])
                return Paginator([{"imageDetails": [
                    {"imageDigest": "sha256:old", "imagePushedAt": old, "imageSizeInBytes": 1000},
                    {"imageDigest": "sha256:new", "imagePushedAt": recent, "imageSizeInBytes": 1000, "imageTags": ["latest"]},
                ]}])

        with (
            patch.object(governance.boto3, "client", return_value=ECR()),
            patch.object(governance, "_ecr_monthly_cost", return_value={
                "amount": "12",
                "currency": "USD",
                "period": "2026-09-01",
                "status": "actual_cost_explorer",
            }),
        ):
            result = governance.ecr_audit("ap-south-1")
        self.assertEqual(result["unique_image_bytes"], 2000)
        self.assertEqual(result["candidate_unique_image_bytes"], 1000)
        self.assertEqual(Decimal(result["indicative_monthly_storage_cost"]["amount"]), Decimal("6"))
        self.assertEqual(result["indicative_monthly_storage_cost"]["currency"], "USD")

    def test_ecr_cleanup_plan_revalidates_live_images_without_deleting(self):
        old = datetime.now(timezone.utc) - timedelta(days=90)
        recent = datetime.now(timezone.utc) - timedelta(days=2)

        class ECR:
            def describe_images(self, **kwargs):
                return {"imageDetails": [
                    {"imageDigest": kwargs["imageIds"][0]["imageDigest"], "imagePushedAt": old, "imageTags": ["old"]},
                    {"imageDigest": kwargs["imageIds"][1]["imageDigest"], "imagePushedAt": recent, "imageTags": ["current"]},
                ]}

        body = governance.EcrCleanupPlanRequest(
            region="ap-south-1",
            images=[
                {"repository": "service", "digest": "sha256:" + "a" * 64},
                {"repository": "service", "digest": "sha256:" + "b" * 64},
            ],
        )
        with patch.object(governance.boto3, "client", return_value=ECR()):
            result = governance.plan_ecr_cleanup(body)
        self.assertEqual(len(result["eligible_images"]), 1)
        self.assertEqual(result["eligible_images"][0]["reasons"], ["older_than_60_days"])
        self.assertFalse(result["aws_changes_made"])

    def test_sns_signature_verification_accepts_valid_signed_notification(self):
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        identity = Name([NameAttribute(NameOID.COMMON_NAME, "SNS local test signer")])
        not_before = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)
        certificate = (
            x509.CertificateBuilder()
            .subject_name(identity)
            .issuer_name(identity)
            .public_key(private_key.public_key())
            .serial_number(1)
            .not_valid_before(not_before)
            .not_valid_after(not_before + timedelta(days=1))
            .sign(private_key, hashes.SHA256())
        )
        signed_message = {
            "Type": "Notification",
            "Message": '{"detail":"live anomaly"}',
            "MessageId": "message-1",
            "Timestamp": "2026-10-07T12:00:00Z",
            "TopicArn": "arn:aws:sns:us-east-1:123456789012:cost",
            "SignatureVersion": "2",
            "SigningCertURL": "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem",
        }
        signed_message["Signature"] = base64.b64encode(
            private_key.sign(governance._sns_signing_string(signed_message), padding.PKCS1v15(), hashes.SHA256())
        ).decode()

        class CertificateResponse:
            content = certificate.public_bytes(serialization.Encoding.PEM)

            def raise_for_status(self):
                return None

        class HttpClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def get(self, _url):
                return CertificateResponse()

        with patch.object(governance.httpx, "AsyncClient", return_value=HttpClient()):
            asyncio.run(governance._verify_sns_message(signed_message))
        signed_message["Signature"] = base64.b64encode(b"invalid signature").decode()
        with patch.object(governance.httpx, "AsyncClient", return_value=HttpClient()):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(governance._verify_sns_message(signed_message))
        self.assertEqual(error.exception.status_code, 403)

    def test_invalid_region_fails_before_creating_aws_client(self):
        with patch.object(governance.boto3, "client") as create_client:
            with self.assertRaises(HTTPException) as error:
                governance.cicd_audit("not a region")
        self.assertEqual(error.exception.status_code, 422)
        create_client.assert_not_called()

    def test_governance_endpoints_are_registered(self):
        from main import app

        paths = set(app.openapi()["paths"])
        self.assertTrue({
            "/api/cicd/audit",
            "/api/cicd/cleanup",
            "/api/cicd/cost-check",
            "/api/k8s/inventory",
            "/api/ecr/audit",
            "/api/ecr/cleanup",
            "/api/governance/tags",
            "/api/governance/park-schedule",
            "/api/webhooks/aws-sns",
            "/api/webhooks/trigger",
            "/api/webhooks/alerts",
        }.issubset(paths))


if __name__ == "__main__":
    unittest.main()
