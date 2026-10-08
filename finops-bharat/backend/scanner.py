from datetime import date, datetime, timezone
import logging
from typing import List, Dict, Any

logger = logging.getLogger("finops_scanner")

try:
    import boto3
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False
    logger.info("boto3 package not installed in environment. Running in AWS simulation mode.")

# Estimated AWS Pricing for ap-south-1 (Mumbai) in INR (1 USD ~ 83.5 INR)
PRICING_INR = {
    "gp2_gp3_per_gb_month": 8.50,       # ~ $0.10 / GB-month
    "unallocated_eip_per_hour": 0.42,   # ~ $0.005 / hour (~300 INR/month)
    "idle_nat_gateway_per_hour": 3.75,  # ~ $0.045 / hour (~2700 INR/month)
    "idle_ec2_t3_medium_per_hour": 3.50 # ~ $0.0416 / hour (~2500 INR/month)
}

class AWSFinOpsScanner:
    def __init__(self, region_name: str = "ap-south-1"):
        self.region_name = region_name

    def scan_orphaned_ebs_volumes(self, ec2_client=None) -> List[Dict[str, Any]]:
        """Scans for EBS volumes in 'available' state (unattached)."""
        resources = []
        if not BOTO3_AVAILABLE:
            return resources

        try:
            if not ec2_client:
                ec2_client = boto3.client('ec2', region_name=self.region_name)
            
            response = ec2_client.describe_volumes(
                Filters=[{'Name': 'status', 'Values': ['available']}]
            )
            for vol in response.get('Volumes', []):
                size_gb = vol.get('Size', 0)
                monthly_cost_inr = round(size_gb * PRICING_INR["gp2_gp3_per_gb_month"], 2)
                
                # Calculate age using datetime timezone aware subtraction
                created_at = vol.get('CreateTime')
                age_str = "Unknown age"
                if created_at:
                    days_old = (datetime.now(timezone.utc) - created_at).days
                    age_str = f"{days_old} days"

                resources.append({
                    "id": vol.get('VolumeId'),
                    "type": "Orphaned EBS Volume",
                    "region": self.region_name,
                    "details": f"{size_gb} GB ({vol.get('VolumeType', 'gp3')})",
                    "monthly_cost_inr": monthly_cost_inr,
                    "est_co2_kg_monthly": round(size_gb * 0.05, 2),
                    "status": "Available (Unattached)",
                    "age": age_str,
                    "action_recommended": "Create Snapshot & Delete"
                })
        except Exception as e:
            logger.warning(f"Boto3 EBS scan error: {e}")
        return resources

    def scan_unallocated_elastic_ips(self, ec2_client=None) -> List[Dict[str, Any]]:
        """Scans for Elastic IPs not associated with any EC2 instance or ENI."""
        resources = []
        if not BOTO3_AVAILABLE:
            return resources

        try:
            if not ec2_client:
                ec2_client = boto3.client('ec2', region_name=self.region_name)
            
            response = ec2_client.describe_addresses()
            for addr in response.get('Addresses', []):
                if 'AssociationId' not in addr and 'InstanceId' not in addr:
                    monthly_cost_inr = round(24 * 30 * PRICING_INR["unallocated_eip_per_hour"], 2)
                    resources.append({
                        "id": addr.get('AllocationId', addr.get('PublicIp')),
                        "type": "Unassigned Elastic IP",
                        "region": self.region_name,
                        "details": f"Public IP: {addr.get('PublicIp')}",
                        "monthly_cost_inr": monthly_cost_inr,
                        "est_co2_kg_monthly": 1.20,
                        "status": "Idle / Unattached",
                        "action_recommended": "Release Allocation"
                    })
        except Exception as e:
            logger.warning(f"Boto3 EIP scan error: {e}")
        return resources

    def get_mock_demo_inventory(self) -> List[Dict[str, Any]]:
        """Provides realistic mock data for local evaluation or initial hackathon demo."""
        return [
            {
                "id": "vol-0a8b9c1d2e3f4g5h6",
                "type": "Orphaned EBS Volume",
                "region": "ap-south-1",
                "details": "100 GB (gp3)",
                "monthly_cost_inr": 850.00,
                "est_co2_kg_monthly": 5.00,
                "status": "Available (Unattached)",
                "age": "42 days",
                "action_recommended": "Create Snapshot & Delete"
            },
            {
                "id": "eipalloc-0123456789abcdef0",
                "type": "Unassigned Elastic IP",
                "region": "ap-south-1",
                "details": "Public IP: 13.232.45.109",
                "monthly_cost_inr": 302.40,
                "est_co2_kg_monthly": 1.20,
                "status": "Idle / Unattached",
                "age": "19 days",
                "action_recommended": "Release Allocation"
            },
            {
                "id": "nat-0f1e2d3c4b5a69788",
                "type": "Idle NAT Gateway",
                "region": "ap-south-1",
                "details": "VPC: vpc-0a1b2c3d (0 GB transferred)",
                "monthly_cost_inr": 2700.00,
                "est_co2_kg_monthly": 18.50,
                "status": "Zero Traffic (7 Days)",
                "age": "7 days",
                "action_recommended": "Replace with VPC Endpoints"
            },
            {
                "id": "i-0987654321fedcba0",
                "type": "Idle Dev EC2 Instance",
                "region": "ap-south-1",
                "details": "t3.medium (<2% CPU average)",
                "monthly_cost_inr": 2520.00,
                "est_co2_kg_monthly": 22.00,
                "status": "Idle / Abandoned",
                "age": "14 days",
                "action_recommended": "Stop or Auto-Schedule"
            }
        ]
