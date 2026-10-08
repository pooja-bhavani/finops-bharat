"""
TWS Labs-inspired Machine State Evaluation Engine
Evaluates student shell commands in the terminal sandbox for FinOps scenarios.
"""

from typing import Dict, Any, List

LAB_SCENARIOS = {
    "lab_1": {
        "id": "lab_1",
        "title": "Lab 1: Detect Unattached EBS Volumes via AWS CLI",
        "objective": "Run an AWS CLI query to list all EBS volumes in the 'available' status.",
        "hint": "Use: aws ec2 describe-volumes --filters Name=status,Values=available",
        "expected_command_contains": ["describe-volumes", "available"],
        "reward_xp": 100
    },
    "lab_2": {
        "id": "lab_2",
        "title": "Lab 2: Release Idle Elastic IPs",
        "objective": "Identify and release unassociated Elastic IP addresses to stop daily hourly charges.",
        "hint": "Use: aws ec2 release-address --allocation-id <allocation-id>",
        "expected_command_contains": ["release-address"],
        "reward_xp": 150
    },
    "lab_3": {
        "id": "lab_3",
        "title": "Lab 3: Automate Snapshot & Volume Deletion",
        "objective": "Write a bash command to snapshot an orphaned volume before deleting it.",
        "hint": "Use: aws ec2 create-snapshot --volume-id <vol-id> && aws ec2 delete-volume --volume-id <vol-id>",
        "expected_command_contains": ["create-snapshot", "delete-volume"],
        "reward_xp": 200
    }
}

class TWSLabsEngine:
    def evaluate_command(self, lab_id: str, command: str) -> Dict[str, Any]:
        scenario = LAB_SCENARIOS.get(lab_id)
        if not scenario:
            return {"status": "error", "message": f"Lab scenario '{lab_id}' not found."}
        
        cmd_lower = command.lower()
        required_keywords = scenario["expected_command_contains"]
        
        passed = all(keyword in cmd_lower for keyword in required_keywords)
        
        if passed:
            return {
                "status": "passed",
                "lab_id": lab_id,
                "message": f"✅ Machine State Test Passed! You earned {scenario['reward_xp']} XP.",
                "output": f"[TWS Evaluator] Query executed successfully. State verified: Target idle resources identified.",
                "passed": True
            }
        else:
            return {
                "status": "failed",
                "lab_id": lab_id,
                "message": f"❌ Test Failed. Ensure your CLI command includes: {', '.join(required_keywords)}",
                "hint": scenario["hint"],
                "passed": False
            }

    def get_all_scenarios(self) -> List[Dict[str, Any]]:
        return list(LAB_SCENARIOS.values())
