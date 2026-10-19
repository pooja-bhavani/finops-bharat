from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


def test_health_is_open():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "healthy"


def test_data_routes_require_a_connected_account():
    # A visitor who has not connected must never be served the server's own AWS account.
    for path in ("/api/aws/account", "/api/aws/costs", "/api/ecr/audit", "/api/governance/tags"):
        r = client.get(path)
        assert r.status_code in (401, 405), (path, r.status_code)
    assert client.post("/api/aws/scan", json={"region": "ap-south-1"}).status_code == 401


def test_connect_status_starts_disconnected():
    body = client.get("/api/connect/status").json()
    assert body["connected"] is False
    assert body["server_account_enabled"] is False


def test_health_reports_version():
    from fastapi.testclient import TestClient
    import backend.main as main_module

    body = TestClient(main_module.app).get("/api/health").json()
    assert body["status"] == "healthy"
    assert isinstance(body["version"], str) and body["version"]


def test_costs_work_when_cost_explorer_omits_total(monkeypatch):
    """With GroupBy, real Cost Explorer returns an empty Total. The monthly total must come from the groups."""
    import boto3

    def group(name, amount):
        return {"Keys": [name], "Metrics": {"UnblendedCost": {"Amount": amount, "Unit": "USD"}}}

    def fake_cost_and_usage(query, ce_client=None):
        return {"ResultsByTime": [
            {"TimePeriod": {"Start": "2026-08-01"}, "Total": {}, "Groups": [group("Amazon EC2", "10.0"), group("Amazon S3", "2.5")]},
            {"TimePeriod": {"Start": "2026-09-01"}, "Total": {}, "Groups": [group("Amazon EC2", "15.0"), group("Amazon S3", "2.0")]},
        ]}

    monkeypatch.setattr(main, "is_connected", lambda request: True)
    monkeypatch.setattr(main, "get_boto_session", lambda request: boto3.Session(region_name="us-east-1"))
    monkeypatch.setattr(main.scanner, "get_cost_and_usage", fake_cost_and_usage)
    body = client.get("/api/aws/costs").json()
    assert body.get("status") != "warning", body
    assert body["currency"] == "USD"
    assert [m["amount"] for m in body["monthly"]] == ["12.5", "17.0"]
    assert body["service_by_month"]["2026-09-01"]["Amazon EC2"] == "15.0"
