import importlib
import json
import os

import boto3
from fastapi import FastAPI
from fastapi.testclient import TestClient
from moto import mock_aws
from starlette.requests import Request


def make_client(secret):
    """Reload connect.py with a given secret. Reloading = a restart: all memory is gone."""
    os.environ["FINOPS_SECRET"] = secret
    import connect
    importlib.reload(connect)
    app = FastAPI()
    app.include_router(connect.router)

    @app.get("/whoami")
    def whoami(request: Request):
        sts = connect.get_boto_session(request).client("sts")
        return {"account": sts.get_caller_identity()["Account"]}

    return TestClient(app)


def make_role():
    acct = boto3.client("sts").get_caller_identity()["Account"]
    trust = json.dumps({"Version": "2012-10-17", "Statement": [
        {"Effect": "Allow", "Principal": {"AWS": f"arn:aws:iam::{acct}:root"}, "Action": "sts:AssumeRole"}]})
    boto3.client("iam").create_role(RoleName="FinOpsBharatReadOnly", AssumeRolePolicyDocument=trust)
    return acct, f"arn:aws:iam::{acct}:role/FinOpsBharatReadOnly"


@mock_aws
def test_connect_survives_restart_with_same_secret():
    acct, arn = make_role()
    c = make_client("secret-A")
    ext = c.post("/api/connect/start").json()["external_id"]
    assert len(ext) == 32
    assert c.post("/api/connect/verify", json={"role_arn": arn}).status_code == 200
    cookies = dict(c.cookies)

    c2 = make_client("secret-A")  # "redeploy"
    for k, v in cookies.items():
        c2.cookies.set(k, v)
    assert c2.get("/api/connect/status").json()["connected"] is True
    assert c2.post("/api/connect/start").json()["external_id"] == ext
    assert c2.get("/whoami").json()["account"] == acct


@mock_aws
def test_each_visitor_gets_their_own_external_id():
    make_role()
    a = make_client("secret-A").post("/api/connect/start").json()["external_id"]
    b = make_client("secret-A").post("/api/connect/start").json()["external_id"]
    assert a != b


@mock_aws
def test_bad_role_arn_is_rejected():
    make_role()
    c = make_client("secret-A")
    c.post("/api/connect/start")
    assert c.post("/api/connect/verify", json={"role_arn": "arn:aws:iam::1:role/Other"}).status_code == 400


@mock_aws
def test_tampered_or_foreign_cookies_do_not_connect():
    _, arn = make_role()
    c = make_client("secret-A")
    c.post("/api/connect/start")
    c.post("/api/connect/verify", json={"role_arn": arn})
    sid, role = c.cookies["fb_sid"], c.cookies["fb_role"]

    forged = make_client("secret-A")
    forged.cookies.set("fb_sid", sid)
    forged.cookies.set("fb_role", arn + ".deadbeef")
    assert forged.get("/api/connect/status").json()["connected"] is False

    other = make_client("secret-A")  # someone else's session id + your role cookie
    other.cookies.set("fb_sid", "A" * 30)
    other.cookies.set("fb_role", role)
    assert other.get("/api/connect/status").json()["connected"] is False

    wrong_secret = make_client("another-secret")
    wrong_secret.cookies.set("fb_sid", sid)
    wrong_secret.cookies.set("fb_role", role)
    assert wrong_secret.get("/api/connect/status").json()["connected"] is False


@mock_aws
def test_disconnect_keeps_external_id_but_drops_connection():
    _, arn = make_role()
    c = make_client("secret-A")
    ext = c.post("/api/connect/start").json()["external_id"]
    c.post("/api/connect/verify", json={"role_arn": arn})
    assert c.post("/api/connect/disconnect").json()["connected"] is False
    assert c.get("/api/connect/status").json()["connected"] is False
    assert c.post("/api/connect/start").json()["external_id"] == ext
