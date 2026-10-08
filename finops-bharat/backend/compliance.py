"""Conservative residency-policy checks for declared personal-data locations.

This is an operational policy evaluator, not a legal compliance determination.
The DPDP Act does not create a blanket India-only storage rule; cross-border
transfers must be assessed against current government restrictions and other
applicable laws, rules, contracts, and sectoral requirements.
"""

from dataclasses import dataclass
from enum import Enum
import re
from typing import Iterable


class ResidencyStatus(str, Enum):
    POLICY_COMPLIANT = "policy_compliant"
    POLICY_MISMATCH = "policy_mismatch"
    REVIEW_REQUIRED = "review_required"
    NOT_IN_SCOPE = "not_in_scope"


@dataclass(frozen=True)
class DataLocation:
    """Declared country for one place where personal data is stored or processed."""

    location_id: str
    country_code: str | None
    purpose: str

    def __post_init__(self) -> None:
        normalized_location_id = self.location_id.strip()
        normalized_purpose = self.purpose.strip()
        if not normalized_location_id:
            raise ValueError("location_id must not be empty")
        if not normalized_purpose:
            raise ValueError("purpose must not be empty")
        object.__setattr__(self, "location_id", normalized_location_id)
        object.__setattr__(self, "purpose", normalized_purpose)
        if self.country_code is not None:
            code = self.country_code.strip().upper()
            if not re.fullmatch(r"[A-Z]{2}", code):
                raise ValueError("country_code must be a two-letter ISO country code or None")
            object.__setattr__(self, "country_code", code)


@dataclass(frozen=True)
class ResidencyPolicy:
    """Organization-defined allowlist; no jurisdictions are assumed by default."""

    policy_id: str
    allowed_countries: frozenset[str]

    def __post_init__(self) -> None:
        normalized_policy_id = self.policy_id.strip()
        if not normalized_policy_id:
            raise ValueError("policy_id must not be empty")
        if not self.allowed_countries:
            raise ValueError("allowed_countries must be explicitly configured")
        normalized = frozenset(country.strip().upper() for country in self.allowed_countries)
        if any(not re.fullmatch(r"[A-Z]{2}", country) for country in normalized):
            raise ValueError("allowed_countries must contain two-letter ISO country codes")
        object.__setattr__(self, "policy_id", normalized_policy_id)
        object.__setattr__(self, "allowed_countries", normalized)


@dataclass(frozen=True)
class DataFootprint:
    """Data classification and declared storage/processing locations for a workload."""

    resource_id: str
    contains_personal_data: bool | None
    locations: tuple[DataLocation, ...]

    def __post_init__(self) -> None:
        normalized_resource_id = self.resource_id.strip()
        if not normalized_resource_id:
            raise ValueError("resource_id must not be empty")
        if self.contains_personal_data not in (True, False, None):
            raise ValueError("contains_personal_data must be True, False, or None")
        if self.locations is None:
            raise ValueError("locations must be a tuple of DataLocation values")
        object.__setattr__(self, "resource_id", normalized_resource_id)
        object.__setattr__(self, "locations", tuple(self.locations))


@dataclass(frozen=True)
class ResidencyFinding:
    location_id: str
    purpose: str
    country_code: str | None
    status: str
    message: str


@dataclass(frozen=True)
class ResidencyEvaluation:
    resource_id: str
    status: ResidencyStatus
    policy_id: str
    findings: tuple[ResidencyFinding, ...]
    limitations: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "resource_id": self.resource_id,
            "status": self.status.value,
            "policy_id": self.policy_id,
            "findings": [
                {
                    "location_id": finding.location_id,
                    "purpose": finding.purpose,
                    "country_code": finding.country_code,
                    "status": finding.status,
                    "message": finding.message,
                }
                for finding in self.findings
            ],
            "limitations": list(self.limitations),
        }


LIMITATIONS = (
    "This checks declared locations against an organization-configured policy; it does not certify DPDP Act compliance.",
    "The DPDP Act does not impose a blanket India-only data-localization requirement. Verify current transfer restrictions and other applicable laws, rules, contracts, and sectoral requirements with qualified counsel.",
    "Provider region metadata does not prove where backups, support access, subprocessors, or all processing occur.",
)


def _build_finding(location: DataLocation, policy: ResidencyPolicy) -> ResidencyFinding:
    if location.country_code is None:
        return ResidencyFinding(
            location.location_id,
            location.purpose,
            None,
            "unknown",
            "Country is not declared; verify the provider's storage and processing footprint.",
        )
    if location.country_code not in policy.allowed_countries:
        return ResidencyFinding(
            location.location_id,
            location.purpose,
            location.country_code,
            "policy_mismatch",
            "Declared country is outside the configured policy allowlist; review the policy and applicable transfer requirements.",
        )
    return ResidencyFinding(
        location.location_id,
        location.purpose,
        location.country_code,
        "within_policy",
        "Declared country is included in the configured policy allowlist.",
    )


def evaluate_data_residency(
    footprint: DataFootprint,
    policy: ResidencyPolicy,
) -> ResidencyEvaluation:
    """Compare declared locations to an explicit policy without making legal claims."""
    if footprint.contains_personal_data is False:
        return ResidencyEvaluation(
            footprint.resource_id,
            ResidencyStatus.NOT_IN_SCOPE,
            policy.policy_id,
            (),
            LIMITATIONS,
        )

    findings = tuple(_build_finding(location, policy) for location in footprint.locations)
    if footprint.contains_personal_data is None or not findings:
        status = ResidencyStatus.REVIEW_REQUIRED
    elif any(item.status == "policy_mismatch" for item in findings):
        status = ResidencyStatus.POLICY_MISMATCH
    elif any(item.status == "unknown" for item in findings):
        status = ResidencyStatus.REVIEW_REQUIRED
    else:
        status = ResidencyStatus.POLICY_COMPLIANT

    return ResidencyEvaluation(
        footprint.resource_id,
        status,
        policy.policy_id,
        findings,
        LIMITATIONS,
    )


def evaluate_many(
    footprints: Iterable[DataFootprint],
    policy: ResidencyPolicy,
) -> tuple[ResidencyEvaluation, ...]:
    """Evaluate multiple workloads using one explicit organizational policy."""
    return tuple(evaluate_data_residency(footprint, policy) for footprint in footprints)
