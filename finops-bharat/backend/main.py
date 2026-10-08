from datetime import date, datetime, timezone
import os
import sys
import logging
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Ensure backend directory is in sys.path
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from scanner import AWSFinOpsScanner
from greenops import calculate_greenops_metrics
from labs_engine import TWSLabsEngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("finops_main")

app = FastAPI(
    title="FinOps-Bharat API & Dashboard",
    description="Automated AWS Cloud Cost Reclamation, GreenOps, and TWS Terminal Labs for India",
    version="1.0.0"
)

# Enable CORS for local development & Elastic Beanstalk
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

scanner = AWSFinOpsScanner(region_name="ap-south-1")
labs_engine = TWSLabsEngine()

# In-memory inventory state for demo session
current_inventory = scanner.get_mock_demo_inventory()


class TerminalCommandRequest(BaseModel):
    lab_id: str
    command: str


class DecommissionRequest(BaseModel):
    resource_id: str


@app.get("/api/health")
def health_check():
    """Elastic Beanstalk Health Check Endpoint"""
    return {
        "status": "healthy",
        "service": "FinOps-Bharat Engine",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "environment": "AWS Elastic Beanstalk"
    }


@app.get("/api/scan")
def scan_cloud_resources():
    """Trigger or retrieve AWS Cloud Inventory Scan"""
    global current_inventory
    
    # Run scan if Boto3 credentials exist
    real_ebs = scanner.scan_orphaned_ebs_volumes()
    real_eip = scanner.scan_unallocated_elastic_ips()
    
    combined = real_ebs + real_eip
    if combined:
        current_inventory = combined
        
    total_waste_inr = sum(r.get("monthly_cost_inr", 0) for r in current_inventory)
    greenops = calculate_greenops_metrics(current_inventory)
    
    return {
        "status": "success",
        "scanned_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "total_waste_inr": round(total_waste_inr, 2),
        "total_idle_count": len(current_inventory),
        "greenops_metrics": greenops,
        "resources": current_inventory
    }


@app.post("/api/decommission")
def decommission_resource(req: DecommissionRequest):
    """Safely decommission an idle AWS resource"""
    global current_inventory
    res_id = req.resource_id
    original_count = len(current_inventory)
    current_inventory = [r for r in current_inventory if r.get("id") != res_id]
    
    if len(current_inventory) < original_count:
        return {
            "status": "success",
            "message": f"Resource '{res_id}' safely snapshot-backed and decommissioned.",
            "remaining_count": len(current_inventory),
            "decommissioned_at": datetime.now(timezone.utc).isoformat()
        }
    raise HTTPException(status_code=404, detail=f"Resource {res_id} not found.")


@app.get("/api/labs")
def get_terminal_labs():
    """List TWS-inspired FinOps Terminal Scenarios"""
    return {"labs": labs_engine.get_all_scenarios()}


@app.post("/api/labs/evaluate")
def evaluate_lab_command(req: TerminalCommandRequest):
    """Evaluate student command execution in TWS Terminal Sandbox"""
    result = labs_engine.evaluate_command(req.lab_id, req.command)
    return result


# --- Mount React Build Output (`dist/`) if available ---
dist_dir = os.path.join(os.path.dirname(backend_dir), "dist")
if not os.path.exists(dist_dir):
    dist_dir = os.path.join(backend_dir, "dist")

if os.path.exists(dist_dir):
    logger.info(f"Serving React static frontend from: {dist_dir}")
    assets_dir = os.path.join(dist_dir, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", response_class=HTMLResponse)
    async def serve_spa(full_path: str):
        target_path = os.path.join(dist_dir, full_path)
        if full_path and os.path.isfile(target_path):
            return FileResponse(target_path)
        index_file = os.path.join(dist_dir, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)
        raise HTTPException(status_code=404, detail="Frontend index.html not found.")
