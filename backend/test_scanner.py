import boto3
from moto import mock_aws

import scanner


@mock_aws
def test_scanner_finds_unattached_volume_and_queue():
    ec2 = boto3.client("ec2", region_name="ap-south-1")
    ec2.create_volume(AvailabilityZone="ap-south-1a", Size=1)
    boto3.client("sqs", region_name="ap-south-1").create_queue(QueueName="orders")

    resources = scanner.AWSFinOpsScanner(region_name="ap-south-1").scan_resources("ap-south-1")
    by_service = {r["service"]: r for r in resources}

    assert by_service["EBS"]["state"] == "available"  # not attached to anything
    assert by_service["SQS"]["state"] == "active"
    assert all({"id", "service", "region", "state"} <= set(r) for r in resources)


@mock_aws
def test_scanner_returns_empty_list_for_empty_account():
    assert scanner.AWSFinOpsScanner(region_name="ap-south-1").scan_resources("ap-south-1") == []
