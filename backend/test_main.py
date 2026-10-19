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
