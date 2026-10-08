import unittest
from decimal import Decimal

from multicloud import (
    CloudProvider,
    CloudResource,
    INDIA_REGIONS,
    INDIAN_INFRASTRUCTURE_TARGETS,
    is_india_region,
    list_india_regions,
)


class MultiCloudTests(unittest.TestCase):
    def test_region_catalog_covers_supported_providers(self):
        self.assertEqual(set(INDIA_REGIONS), set(CloudProvider))
        self.assertGreaterEqual(len(list_india_regions()), 9)

    def test_provider_filter_is_case_insensitive(self):
        regions = list_india_regions("aws")
        self.assertEqual([region.region_id for region in regions], ["ap-south-1", "ap-south-2"])

    def test_region_matching_uses_provider_and_canonical_region_id(self):
        self.assertTrue(is_india_region("aws", "AP-SOUTH-2"))
        self.assertFalse(is_india_region("azure", "ap-south-2"))
        self.assertFalse(is_india_region("aws", "unknown-region"))

    def test_resource_normalizes_provider_and_preserves_exact_cost(self):
        resource = CloudResource(
            provider="aws",
            account_id="123456789012",
            resource_id="vol-123",
            resource_type="ebs_volume",
            region="ap-south-1",
            status="available",
            monthly_cost="12.34",
            currency="inr",
        )
        self.assertEqual(resource.provider, CloudProvider.AWS)
        self.assertEqual(resource.monthly_cost, Decimal("12.34"))
        self.assertEqual(resource.monthly_cost_inr, Decimal("12.34"))
        self.assertTrue(resource.is_india_region)
        self.assertEqual(resource.to_dict()["monthly_cost_inr"], "12.34")

    def test_foreign_currency_is_not_converted_to_inr(self):
        resource = CloudResource(
            provider="google_cloud",
            account_id="project-1",
            resource_id="disk-1",
            resource_type="disk",
            region="asia-south1",
            status="attached",
            monthly_cost=10,
            currency="USD",
        )
        self.assertIsNone(resource.monthly_cost_inr)
        self.assertTrue(resource.is_india_region)

    def test_invalid_provider_and_cost_are_rejected(self):
        with self.assertRaises(ValueError):
            CloudResource("unknown", "acct", "r1", "disk", "region", "idle")
        with self.assertRaises(ValueError):
            CloudResource("aws", "acct", "r1", "disk", "ap-south-1", "idle", -1, "INR")

    def test_indian_infrastructure_is_explicitly_catalog_only(self):
        self.assertTrue(INDIAN_INFRASTRUCTURE_TARGETS)
        self.assertTrue(
            all(target.integration_status == "catalog_only" for target in INDIAN_INFRASTRUCTURE_TARGETS)
        )


if __name__ == "__main__":
    unittest.main()
