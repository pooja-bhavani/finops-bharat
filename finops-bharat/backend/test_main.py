import unittest
import asyncio
from unittest.mock import patch

from botocore.exceptions import ClientError
from fastapi import HTTPException
from starlette.requests import Request

import main


class CostExplorerClient:
    def __init__(self):
        self.requests = []

    def get_cost_and_usage(self, **kwargs):
        self.requests.append(kwargs)
        month = kwargs["TimePeriod"]["Start"]
        result = {
            "TimePeriod": {"Start": month, "End": "2099-01-01"},
            "Total": {"UnblendedCost": {"Amount": "123.45", "Unit": "USD"}},
            "Groups": [{
                "Keys": ["Amazon EC2"],
                "Metrics": {"UnblendedCost": {"Amount": "100.00", "Unit": "USD"}},
            }],
        }
        if "NextPageToken" not in kwargs:
            return {"ResultsByTime": [result], "NextPageToken": "next"}
        second_group = {
            "Keys": ["Amazon S3"],
            "Metrics": {"UnblendedCost": {"Amount": "23.45", "Unit": "USD"}},
        }
        return {"ResultsByTime": [{**result, "Groups": [second_group]}]}


class MainApiTests(unittest.TestCase):
    def test_costs_use_cost_explorer_and_sum_paginated_service_groups(self):
        client = CostExplorerClient()
        with patch("main.boto3.client", return_value=client) as create_client:
            result = main.get_aws_costs()

        create_client.assert_called_once_with("ce", region_name="us-east-1")
        self.assertEqual(len(client.requests), 2)
        self.assertEqual(client.requests[1]["NextPageToken"], "next")
        self.assertEqual(len(result["monthly"]), 1)
        self.assertEqual(result["monthly"][0]["amount"], "123.45")
        self.assertEqual(
            {item["name"]: item["amount"] for item in result["services"]},
            {"Amazon EC2": "100.00", "Amazon S3": "23.45"},
        )
        self.assertEqual(result["currency"], "USD")

    def test_cost_explorer_aws_error_is_returned_as_warning_payload(self):
        aws_error = ClientError(
            {"Error": {"Code": "AccessDeniedException", "Message": "not authorized"}},
            "GetCostAndUsage",
        )
        with patch.object(main.scanner, "get_cost_and_usage", side_effect=aws_error):
            result = main.get_aws_costs()

        self.assertEqual(result["status"], "warning")
        self.assertFalse(result["is_live"])
        self.assertIn("AWS scan notice", result["message"])
        self.assertEqual(result["monthly"], [])
        self.assertEqual(result["services"], [])

    def test_invalid_region_is_rejected_before_aws_calls(self):
        with self.assertRaises(HTTPException) as error:
            main.scan_cloud_resources(region="bad region")
        self.assertEqual(error.exception.status_code, 422)

    def test_global_scan_returns_partial_results_and_regions_scanned(self):
        resource = {
            "id": "bucket-1",
            "name": "bucket-1",
            "service": "S3",
            "category": "Storage",
            "type": "S3 bucket",
            "region": "global",
            "state": "available",
            "is_waste_candidate": False,
            "estimated_monthly_cost": None,
            "details": "Created today",
        }

        class IdentityClient:
            def get_caller_identity(self):
                return {"Account": "123456789012"}

        with (
            patch.object(main.scanner, "scan_resources", return_value=[resource]) as scan,
            patch.object(main.scanner, "last_scan_metadata", {
                "regions_scanned": ["us-east-1", "ap-south-1"],
                "errors": [{"service": "RDS", "operation": "DescribeDBInstances", "region": "ap-south-1", "message": "denied"}],
            }, create=True),
            patch("main.boto3.client", return_value=IdentityClient()),
        ):
            result = main.scan_cloud_resources(region="all")

        scan.assert_called_once_with(region_name="all")
        self.assertEqual(result["status"], "warning")
        self.assertTrue(result["is_live"])
        self.assertEqual(result["region"], "all")
        self.assertEqual(result["regions_scanned"], ["us-east-1", "ap-south-1"])
        self.assertEqual(result["resource_count"], 1)
        self.assertEqual(result["waste_candidate_count"], 0)
        self.assertIsNone(result["resources"][0]["estimated_monthly_cost"])

    def test_production_ui_and_api_require_gateway_identity_header(self):
        request = Request({
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "https",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": [],
            "server": ("app", 443),
            "client": ("gateway", 1234),
            "root_path": "",
        })
        called = False

        async def next_handler(_request):
            nonlocal called
            called = True
            return None

        with patch("main.APP_ENV", "production"):
            response = asyncio.run(main.require_sso_identity(request, next_handler))
        self.assertEqual(response.status_code, 401)
        self.assertFalse(called)


if __name__ == "__main__":
    unittest.main()
