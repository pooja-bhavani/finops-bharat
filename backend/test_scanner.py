import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from botocore.exceptions import ClientError

from scanner import AWSFinOpsScanner


def aws_error(operation):
    return ClientError(
        {"Error": {"Code": "AccessDenied", "Message": "not authorized"}},
        operation,
    )


class FakePaginator:
    def __init__(self, pages):
        self.pages = pages

    def paginate(self, **kwargs):
        return self.pages


class FakeEC2Client:
    def __init__(self):
        self.calls = []
        self.volume = {
            "VolumeId": "vol-1",
            "Size": 10,
            "VolumeType": "gp3",
            "State": "available",
            "CreateTime": datetime(2025, 1, 1, tzinfo=timezone.utc),
            "Tags": [{"Key": "Name", "Value": "archive"}],
        }

    def can_paginate(self, operation):
        return operation != "describe_addresses"

    def get_paginator(self, operation):
        self.calls.append(operation)
        pages = {
            "describe_instances": [{"Reservations": []}],
            "describe_volumes": [{"Volumes": [self.volume]}],
            "describe_addresses": [{"Addresses": [
                {"AllocationId": "eip-free", "PublicIp": "192.0.2.1"},
                {"AllocationId": "eip-used", "PublicIp": "192.0.2.2", "AssociationId": "eipassoc-1"},
            ]}],
            "describe_vpcs": [{"Vpcs": []}],
            "describe_nat_gateways": [{"NatGateways": []}],
        }
        return FakePaginator(pages.get(operation, [{}]))

    def describe_addresses(self):
        return {"Addresses": [
            {"AllocationId": "eip-free", "PublicIp": "192.0.2.1"},
            {"AllocationId": "eip-used", "PublicIp": "192.0.2.2", "AssociationId": "eipassoc-1"},
        ]}


class EmptyClient:
    def __init__(self, denied_operations=None):
        self.denied_operations = denied_operations or set()

    def can_paginate(self, operation):
        return True

    def get_paginator(self, operation):
        if operation in self.denied_operations:
            raise aws_error(operation)
        return FakePaginator([{}])

    def list_buckets(self):
        return {"Buckets": []}


class ScannerTests(unittest.TestCase):
    def test_cost_explorer_call_propagates_aws_errors_after_logging(self):
        error = aws_error("GetCostAndUsage")
        client = type("FailingCostClient", (), {
            "get_cost_and_usage": lambda self, **kwargs: (_ for _ in ()).throw(error),
        })()
        with self.assertLogs("scanner", level="ERROR"):
            with self.assertRaises(ClientError):
                AWSFinOpsScanner.get_cost_and_usage({"TimePeriod": {}}, ce_client=client)

    def test_scanner_normalizes_resources_and_preserves_unattached_candidates(self):
        ec2 = FakeEC2Client()
        with patch("scanner.boto3.client", side_effect=lambda service, **kwargs: EmptyClient()):
            scanner = AWSFinOpsScanner("ap-south-2")
            resources = scanner.scan_resources(ec2_client=ec2)

        volume = next(item for item in resources if item["service"] == "EBS")
        address = next(item for item in resources if item["id"] == "eip-free")
        self.assertEqual(volume["name"], "archive")
        self.assertEqual(volume["category"], "Storage")
        self.assertEqual(volume["state"], "unattached")
        self.assertTrue(volume["is_waste_candidate"])
        self.assertEqual(volume["created_at"], "2025-01-01T00:00:00+00:00")
        self.assertIsNone(volume["estimated_monthly_cost"])
        self.assertTrue(address["is_waste_candidate"])
        self.assertFalse(next(item for item in resources if item["id"] == "eip-used")["is_waste_candidate"])
        self.assertEqual(scanner.last_scan_metadata["regions_scanned"], ["ap-south-2"])

    def test_service_permission_failure_is_reported_without_losing_other_results(self):
        ec2 = FakeEC2Client()
        clients = {
            "ec2": ec2,
            "ecs": EmptyClient({"list_clusters"}),
        }

        def client_factory(service, **kwargs):
            return clients.get(service, EmptyClient())

        with patch("scanner.boto3.client", side_effect=client_factory):
            scanner = AWSFinOpsScanner("ap-south-1")
            resources = scanner.scan_resources()

        self.assertTrue(any(item["service"] == "EBS" for item in resources))
        self.assertTrue(any(item["service"] == "EC2" for item in resources))
        self.assertTrue(any(error["service"] == "ECS" for error in scanner.last_scan_metadata["errors"]))

    def test_all_region_scan_uses_enabled_region_list_and_scans_global_services_once(self):
        scanner = AWSFinOpsScanner()
        with (
            patch.object(scanner, "list_enabled_regions", return_value=[{"id": "us-east-1"}, {"id": "ap-south-1"}]),
            patch.object(scanner, "_scan_region", side_effect=lambda region: [{"id": region}]) as scan_region,
            patch.object(scanner, "_scan_global_services", return_value=[{"id": "global"}]) as scan_global,
        ):
            resources = scanner.scan_resources("all")

        self.assertEqual([item["id"] for item in resources], ["us-east-1", "ap-south-1", "global"])
        self.assertEqual(scan_region.call_count, 2)
        scan_global.assert_called_once_with("ap-south-1")
        self.assertEqual(scanner.last_scan_metadata["regions_scanned"], ["us-east-1", "ap-south-1"])

    def test_region_listing_omits_regions_not_opted_in(self):
        class RegionsClient:
            def describe_regions(self, **kwargs):
                self.kwargs = kwargs
                return {"Regions": [
                    {"RegionName": "us-east-1", "OptInStatus": "opt-in-not-required"},
                    {"RegionName": "ap-south-2", "OptInStatus": "not-opted-in"},
                    {"RegionName": "ap-south-1", "OptInStatus": "opted-in"},
                ]}

        client = RegionsClient()
        self.assertEqual(
            AWSFinOpsScanner.list_enabled_regions(client),
            [{"id": "ap-south-1", "name": "ap-south-1"}, {"id": "us-east-1", "name": "us-east-1"}],
        )
        self.assertEqual(client.kwargs, {"AllRegions": True})


if __name__ == "__main__":
    unittest.main()
