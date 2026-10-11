"""Cross-account "Connect your AWS account" support for FinOps-Bharat.

A customer creates a read-only IAM role (CloudFormation one-click) that trusts this
app's AWS account and requires a server-generated ExternalId. They paste the role ARN,
and this module assumes the role with short-lived credentials.

Environment variables
---------------------
FINOPS_TEMPLATE_URL     Public S3 URL of the CloudFormation role template. Optional: defaults to
                        DEFAULT_TEMPLATE_URL below, so a restart never loses it.
APP_AWS_ACCOUNT_ID      Account customers should trust. Defaults to the server's own account.
FINOPS_ROLE_NAME        Role name customers create. Default: FinOpsBharatReadOnly.
FINOPS_CONNECT_STORE    JSON file that keeps ExternalIds/role ARNs across restarts.
FINOPS_SESSION_DAYS     How long a browser keeps its connection / ExternalId. Default: 30.
COOKIE_SECURE           "true"/"false". Defaults to true only when APP_ENV=production.
FINOPS_ALLOW_SERVER_ACCOUNT  "true" shows the server's OWN AWS account to visitors who have not
                        connected (private/single-tenant use). Default "false": visitors see
                        nothing until they connect their own account.
"""
import json
import logging
import os
import re
import secrets
import threading
import time
from functools import lru_cache
from pathlib import Path

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

logger = logging.getLogger("finops_connect")
router = APIRouter(prefix="/api/connect", tags=["connect"])

ROLE_NAME = os.getenv("FINOPS_ROLE_NAME", "FinOpsBharatReadOnly")
# Not a secret: it is a public file that every visitor's AWS console must be able to read.
DEFAULT_TEMPLATE_URL = "https://finops-bharat-templates-pooja.s3.ap-south-1.amazonaws.com/finops-bharat.yml"
ROLE_ARN_RE = re.compile(r"^arn:aws:iam::\d{12}:role/" + re.escape(ROLE_NAME) + r"$")
COOKIE_NAME = "fb_sid"
# A visitor keeps the same ExternalId (and connection) in the same browser for this long.
COOKIE_MAX_AGE = int(os.getenv("FINOPS_SESSION_DAYS", "30")) * 24 * 3600
STORE_PATH = Path(os.getenv("FINOPS_CONNECT_STORE", ".finops_connections.json"))
REFRESH_MARGIN_SECONDS = 300
SERVER_ACCOUNT_ENABLED = os.getenv("FINOPS_ALLOW_SERVER_ACCOUNT", "false").lower() == "true"

_lock = threading.RLock()
_sessions: dict[str, dict] = {}  # sid -> {"external_id", "role_arn", "created"}  (persisted)
_creds: dict[str, dict] = {}     # sid -> {"session", "expires"}                  (memory only)


def _load_store() -> None:
    try:
        data = json.loads(STORE_PATH.read_text())
    except FileNotFoundError:
        return
    except (OSError, ValueError):
        logger.warning("Could not read connection store %s", STORE_PATH)
        return
    if isinstance(data, dict):
        _sessions.update({k: v for k, v in data.items() if isinstance(v, dict)})


def _save_store() -> None:
    try:
        tmp = STORE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(_sessions))
        os.chmod(tmp, 0o600)
        tmp.replace(STORE_PATH)
    except OSError:
        logger.warning("Could not write connection store %s", STORE_PATH)


def _prune() -> None:
    cutoff = time.time() - COOKIE_MAX_AGE
    for sid in [s for s, e in _sessions.items() if e.get("created", 0) < cutoff]:
        _sessions.pop(sid, None)
        _creds.pop(sid, None)


def _cookie_secure() -> bool:
    default = "true" if os.getenv("APP_ENV", "development").lower() == "production" else "false"
    return os.getenv("COOKIE_SECURE", default).lower() == "true"


@lru_cache(maxsize=1)
def _app_account_id() -> str:
    configured = os.getenv("APP_AWS_ACCOUNT_ID", "").strip()
    if configured:
        return configured
    return boto3.client("sts").get_caller_identity()["Account"]


def _assume(entry: dict) -> tuple[boto3.Session, float]:
    creds = boto3.client("sts").assume_role(
        RoleArn=entry["role_arn"],
        RoleSessionName="finops-bharat",
        ExternalId=entry["external_id"],
        DurationSeconds=3600,
    )["Credentials"]
    session = boto3.Session(
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds["SessionToken"],
    )
    return session, creds["Expiration"].timestamp()


_load_store()


class VerifyBody(BaseModel):
    role_arn: str


@router.post("/start")
def start(request: Request, response: Response):
    template_url = os.getenv("FINOPS_TEMPLATE_URL", DEFAULT_TEMPLATE_URL).strip()
    if not template_url:
        raise HTTPException(status_code=503, detail="Server is missing FINOPS_TEMPLATE_URL (public S3 URL of finops-role.yaml).")
    try:
        trusted_account_id = _app_account_id()
    except (BotoCoreError, ClientError) as exc:
        logger.warning("Could not determine app account id: %s", exc)
        raise HTTPException(status_code=503, detail="Server could not determine its AWS account id. Set APP_AWS_ACCOUNT_ID.") from exc
    with _lock:
        _prune()
        sid = request.cookies.get(COOKIE_NAME)
        if sid not in _sessions:
            sid = secrets.token_urlsafe(32)
            _sessions[sid] = {"external_id": secrets.token_hex(16), "role_arn": None, "created": time.time()}
            _save_store()
        external_id = _sessions[sid]["external_id"]
    response.set_cookie(
        COOKIE_NAME, sid, httponly=True, secure=_cookie_secure(),
        samesite="lax", max_age=COOKIE_MAX_AGE, path="/",
    )
    return {
        "external_id": external_id,
        "trusted_account_id": trusted_account_id,
        "role_name": ROLE_NAME,
        "template_url": template_url,
    }


@router.post("/verify")
def verify(body: VerifyBody, request: Request):
    role_arn = body.role_arn.strip()
    if not ROLE_ARN_RE.fullmatch(role_arn):
        raise HTTPException(status_code=400, detail=f"Role ARN must look like arn:aws:iam::<12-digit account id>:role/{ROLE_NAME}.")
    sid = request.cookies.get(COOKIE_NAME)
    with _lock:
        entry = _sessions.get(sid)
        if not entry:
            raise HTTPException(status_code=400, detail="Start the connection first: close this window and click Connect AWS again.")
        candidate = {**entry, "role_arn": role_arn}
    try:
        session, expires = _assume(candidate)
        identity = session.client("sts").get_caller_identity()
    except (BotoCoreError, ClientError) as exc:
        code = exc.response["Error"]["Code"] if isinstance(exc, ClientError) else "ConnectionError"
        logger.warning("assume_role failed for %s: %s", role_arn, code)
        raise HTTPException(
            status_code=400,
            detail=f"Could not assume the role ({code}). Check the ARN, that the stack finished creating, and that it used the External ID from this page.",
        ) from exc
    with _lock:
        if sid in _sessions:
            _sessions[sid]["role_arn"] = role_arn
            _creds[sid] = {"session": session, "expires": expires}
            _save_store()
    return {"connected": True, "account_id": identity["Account"], "role_arn": role_arn}


@router.get("/status")
def status(request: Request):
    conn = get_connection(request)
    return {
        "connected": bool(conn),
        "role_arn": conn["role_arn"] if conn else None,
        "server_account_enabled": SERVER_ACCOUNT_ENABLED,
    }


@router.post("/disconnect")
def disconnect(request: Request):
    sid = request.cookies.get(COOKIE_NAME)
    with _lock:
        entry = _sessions.get(sid)
        if entry:
            entry["role_arn"] = None  # keep the ExternalId so an existing stack stays valid
            _save_store()
        _creds.pop(sid, None)
    return {"connected": False}


def get_connection(request: Request) -> dict | None:
    """The caller's connected role, or None if they are using the server's own account."""
    sid = request.cookies.get(COOKIE_NAME)
    with _lock:
        entry = _sessions.get(sid)
        if entry and entry.get("role_arn"):
            return {**entry, "sid": sid}
    return None


def is_connected(request: Request) -> bool:
    return get_connection(request) is not None


def get_boto_session(request: Request) -> boto3.Session:
    """boto3 session for this caller: their assumed role if connected, else the server default.

    If a connected role stops working this raises 502 instead of silently falling back to
    the server's own account, so one user's scan never shows another account's data.
    """
    conn = get_connection(request)
    if conn is None:
        if not SERVER_ACCOUNT_ENABLED:
            raise HTTPException(status_code=401, detail="Connect your AWS account to see your data.")
        return boto3.Session()
    sid = conn["sid"]
    with _lock:
        cached = _creds.get(sid)
        if cached and cached["expires"] - time.time() > REFRESH_MARGIN_SECONDS:
            return cached["session"]
    try:
        session, expires = _assume(conn)
    except (BotoCoreError, ClientError) as exc:
        logger.warning("Re-assuming connected role failed: %s", exc)
        raise HTTPException(status_code=502, detail="The connected AWS role could not be used. Disconnect and connect your account again.") from exc
    with _lock:
        _creds[sid] = {"session": session, "expires": expires}
    return session