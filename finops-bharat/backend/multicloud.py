"""Provider-neutral inventory types and India-region metadata.

This module deliberately contains no cloud SDK clients or pricing assumptions.
Provider adapters can normalize their read-only scan results into
``CloudResource`` records without coupling the API to a particular vendor.
"""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any, Mapping


class CloudProvider(str, Enum):
    AWS = "aws"
    AZURE = "azure"
    GOOGLE_CLOUD = "google_cloud"
    OCI = "oci"


@dataclass(frozen=True)
class CloudRegion:
    provider: CloudProvider
    region_id: str
    name: str
    cities: tuple[str, ...]


INDIA_REGIONS: dict[CloudProvider, tuple[CloudRegion, ...]] = {
    CloudProvider.AWS: (
        CloudRegion(CloudProvider.AWS, "ap-south-1", "Asia Pacific (Mumbai)", ("Mumbai",)),
        CloudRegion(CloudProvider.AWS, "ap-south-2", "Asia Pacific (Hyderabad)", ("Hyderabad",)),
    ),
    CloudProvider.AZURE: (
        CloudRegion(CloudProvider.AZURE, "centralindia", "Central India", ("Pune",)),
        CloudRegion(CloudProvider.AZURE, "southindia", "South India", ("Chennai",)),
        CloudRegion(CloudProvider.AZURE, "westindia", "West India", ("Mumbai",)),
    ),
    CloudProvider.GOOGLE_CLOUD: (
        CloudRegion(CloudProvider.GOOGLE_CLOUD, "asia-south1", "Mumbai", ("Mumbai",)),
        CloudRegion(CloudProvider.GOOGLE_CLOUD, "asia-south2", "Delhi", ("Delhi",)),
    ),
    CloudProvider.OCI: (
        CloudRegion(CloudProvider.OCI, "ap-mumbai-1", "Mumbai", ("Mumbai",)),
        CloudRegion(CloudProvider.OCI, "ap-hyderabad-1", "Hyderabad", ("Hyderabad",)),
    ),
}


@dataclass(frozen=True)
class IndianInfrastructureTarget:
    """Indian infrastructure option; this catalog does not imply API support."""

    name: str
    category: str
    locations: tuple[str, ...]
    integration_status: str


INDIAN_INFRASTRUCTURE_TARGETS = (
    IndianInfrastructureTarget(
        "MeghRaj (GI Cloud)",
        "Government cloud initiative",
        (),
        "catalog_only",
    ),
    IndianInfrastructureTarget("Yotta", "Indian cloud provider", (), "catalog_only"),
    IndianInfrastructureTarget("CtrlS", "Indian data centre and cloud provider", (), "catalog_only"),
    IndianInfrastructureTarget("Sify", "Indian data centre and cloud provider", (), "catalog_only"),
)


def _coerce_provider(provider: CloudProvider | str) -> CloudProvider:
    if isinstance(provider, CloudProvider):
        return provider
    try:
        normalized_provider = str(provider).strip().lower()
        return CloudProvider(normalized_provider)
    except (AttributeError, ValueError) as exc:
        supported = ", ".join(item.value for item in CloudProvider)
        raise ValueError(f"Unsupported cloud provider {provider!r}; expected one of: {supported}") from exc


def list_india_regions(
    provider: CloudProvider | str | None = None,
) -> tuple[CloudRegion, ...]:
    """Return known India regions, optionally filtered to one provider."""
    if provider is not None:
        return INDIA_REGIONS.get(_coerce_provider(provider), ())
    return tuple(region for regions in INDIA_REGIONS.values() for region in regions)


def is_india_region(provider: CloudProvider | str, region_id: str) -> bool:
    """Check a canonical provider region ID; unknown IDs are not assumed to be in India."""
    normalized_region = region_id.strip().casefold()
    if not normalized_region:
        return False
    return any(
        region.region_id.casefold() == normalized_region
        for region in list_india_regions(provider)
    )


@dataclass(frozen=True)
class CloudResource:
    """Normalized inventory record; cost remains in its source currency."""

    provider: CloudProvider | str
    account_id: str
    resource_id: str
    resource_type: str
    region: str
    status: str
    monthly_cost: Decimal | int | float | str | None = None
    currency: str | None = None
    tags: Mapping[str, str] | None = None

    def __post_init__(self) -> None:
        normalized_provider = _coerce_provider(self.provider)
        normalized_account_id = str(self.account_id).strip()
        normalized_resource_id = str(self.resource_id).strip()
        normalized_resource_type = str(self.resource_type).strip()
        normalized_region = str(self.region).strip()
        normalized_status = str(self.status).strip()

        object.__setattr__(self, "provider", normalized_provider)
        object.__setattr__(self, "account_id", normalized_account_id)
        object.__setattr__(self, "resource_id", normalized_resource_id)
        object.__setattr__(self, "resource_type", normalized_resource_type)
        object.__setattr__(self, "region", normalized_region)
        object.__setattr__(self, "status", normalized_status)

        for field_name in ("account_id", "resource_id", "resource_type", "region", "status"):
            if not getattr(self, field_name).strip():
                raise ValueError(f"{field_name} must not be empty")

        if self.monthly_cost is None:
            if self.currency is not None:
                normalized_currency = str(self.currency).strip()
                if not normalized_currency:
                    raise ValueError("currency cannot be empty when monthly_cost is unknown")
                object.__setattr__(self, "currency", normalized_currency)
                raise ValueError("currency cannot be set when monthly_cost is unknown")
            return

        try:
            cost = Decimal(str(self.monthly_cost))
        except (InvalidOperation, ValueError) as exc:
            raise ValueError("monthly_cost must be a valid decimal amount") from exc
        if not cost.is_finite() or cost < 0:
            raise ValueError("monthly_cost must be a finite, non-negative amount")

        normalized_currency = str(self.currency).strip().upper() if self.currency is not None else None
        if not normalized_currency or len(normalized_currency) != 3 or not normalized_currency.isalpha():
            raise ValueError("currency must be a three-letter code when monthly_cost is set")

        object.__setattr__(self, "monthly_cost", cost)
        object.__setattr__(self, "currency", normalized_currency)

    @property
    def is_india_region(self) -> bool:
        return is_india_region(self.provider, self.region)

    @property
    def monthly_cost_inr(self) -> Decimal | None:
        """Return a cost already denominated in INR; never guess an FX rate."""
        if self.monthly_cost is not None and self.currency == "INR":
            return self.monthly_cost
        return None

    def to_dict(self) -> dict[str, Any]:
        """Serialize with decimal amounts represented exactly as strings."""
        return {
            "provider": self.provider.value,
            "account_id": self.account_id,
            "id": self.resource_id,
            "type": self.resource_type,
            "region": self.region,
            "status": self.status,
            "monthly_cost": str(self.monthly_cost) if self.monthly_cost is not None else None,
            "currency": self.currency,
            "monthly_cost_inr": (
                str(self.monthly_cost_inr) if self.monthly_cost_inr is not None else None
            ),
            "is_india_region": self.is_india_region,
            "tags": dict(self.tags or {}),
        }


def normalize_resource(
    *,
    provider: CloudProvider | str,
    account_id: str,
    resource_id: str,
    resource_type: str,
    region: str,
    status: str,
    monthly_cost: Decimal | int | float | str | None = None,
    currency: str | None = None,
    tags: Mapping[str, str] | None = None,
) -> CloudResource:
    """Construct a validated normalized inventory record for a provider adapter."""
    return CloudResource(
        provider=provider,
        account_id=account_id,
        resource_id=resource_id,
        resource_type=resource_type,
        region=region,
        status=status,
        monthly_cost=monthly_cost,
        currency=currency,
        tags=tags,
    )
