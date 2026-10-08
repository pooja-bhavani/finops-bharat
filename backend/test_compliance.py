import unittest

from compliance import (
    DataFootprint,
    DataLocation,
    ResidencyPolicy,
    ResidencyStatus,
    evaluate_data_residency,
    evaluate_many,
)


class ComplianceTests(unittest.TestCase):
    def setUp(self):
        self.india_policy = ResidencyPolicy("india-only-contract", frozenset({"in"}))

    def test_declared_indian_personal_data_location_matches_explicit_policy(self):
        footprint = DataFootprint(
            "database-1",
            True,
            (DataLocation("primary", "in", "storage"),),
        )
        result = evaluate_data_residency(footprint, self.india_policy)
        self.assertEqual(result.status, ResidencyStatus.POLICY_COMPLIANT)
        self.assertEqual(result.findings[0].country_code, "IN")
        self.assertTrue(result.limitations)

    def test_location_outside_allowlist_is_a_policy_mismatch(self):
        footprint = DataFootprint(
            "database-2",
            True,
            (DataLocation("backup", "us", "backup"),),
        )
        result = evaluate_data_residency(footprint, self.india_policy)
        self.assertEqual(result.status, ResidencyStatus.POLICY_MISMATCH)
        self.assertEqual(result.findings[0].status, "policy_mismatch")

    def test_unknown_location_requires_review(self):
        footprint = DataFootprint(
            "database-3",
            True,
            (DataLocation("support-processing", None, "support access"),),
        )
        result = evaluate_data_residency(footprint, self.india_policy)
        self.assertEqual(result.status, ResidencyStatus.REVIEW_REQUIRED)

    def test_missing_classification_or_locations_requires_review(self):
        self.assertEqual(
            evaluate_data_residency(
                DataFootprint("unknown-data", None, ()),
                self.india_policy,
            ).status,
            ResidencyStatus.REVIEW_REQUIRED,
        )
        self.assertEqual(
            evaluate_data_residency(
                DataFootprint("unmapped-data", True, ()),
                self.india_policy,
            ).status,
            ResidencyStatus.REVIEW_REQUIRED,
        )

    def test_non_personal_data_is_not_in_dpdp_personal_data_scope(self):
        result = evaluate_data_residency(
            DataFootprint(
                "metrics",
                False,
                (DataLocation("region", "us", "storage"),),
            ),
            self.india_policy,
        )
        self.assertEqual(result.status, ResidencyStatus.NOT_IN_SCOPE)
        self.assertEqual(result.findings, ())

    def test_batch_evaluation_preserves_input_order(self):
        footprints = (
            DataFootprint("one", True, (DataLocation("primary", "in", "storage"),)),
            DataFootprint("two", False, ()),
        )
        results = evaluate_many(footprints, self.india_policy)
        self.assertEqual([result.resource_id for result in results], ["one", "two"])

    def test_policy_requires_explicit_allowlist(self):
        with self.assertRaises(ValueError):
            ResidencyPolicy("missing-allowlist", frozenset())

    def test_country_codes_are_validated(self):
        with self.assertRaises(ValueError):
            DataLocation("primary", "IND", "storage")

    def test_serialization_is_json_friendly(self):
        result = evaluate_data_residency(
            DataFootprint("database-1", True, (DataLocation("primary", "in", "storage"),)),
            self.india_policy,
        ).to_dict()
        self.assertEqual(result["status"], "policy_compliant")
        self.assertIsInstance(result["findings"], list)
        self.assertIsInstance(result["limitations"], list)


if __name__ == "__main__":
    unittest.main()
