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
FINOPS_SECRET           REQUIRED in production. Long random string. Sessions are stateless: each visitor's
                        ExternalId is derived from it and their connected role lives in a signed cookie,
                        so deploys, rebuilds and extra instances never disconnect anyone. Keep it private
                        and never change it (changing it disconnects everyone and invalidates their ExternalIds).
FINOPS_SESSION_DAYS     How long a browser keeps its connection / ExternalId. Default: 30.
COOKIE_SECURE           "true"/"false". Defaults to true only when APP_ENV=production.
FINOPS_ALLOW_SERVER_ACCOUNT  "true" shows the server's OWN AWS account to visitors who have not
                        connected (private/single-tenant use). Default "false": visitors see
                        nothing until they connect their own account.
"""
import hashlib
import hmac
import logging
import os
import re
import secrets
import threading
import time
from functools import lru_cache

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
COOKIE_NAME = "fb_sid"        # random session id (identifies the browser; ExternalId is derived from it)
ROLE_COOKIE = "fb_role"       # signed "<role arn>.<signature>": which role this browser connected
SID_RE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")
# A visitor keeps the same ExternalId (and connection) in the same browser for this long.
COOKIE_MAX_AGE = int(os.getenv("FINOPS_SESSION_DAYS", "30")) * 24 * 3600
REFRESH_MARGIN_SECONDS = 300
SERVER_ACCOUNT_ENABLED = os.getenv("FINOPS_ALLOW_SERVER_ACCOUNT", "false").lower() == "true"

_SECRET = os.getenv("FINOPS_SECRET", "").strip()
if not _SECRET:
    _SECRET = secrets.token_hex(32)
    logger.warning(
        "FINOPS_SECRET is not set: using a random secret that changes on every restart, so visitors "
        "will be disconnected and their ExternalIds will change after each deploy. Set FINOPS_SECRET."
    )

_lock = threading.RLock()
_creds: dict[str, dict] = {}  # sid -> {"session", "expires"}  (memory only; re-assumed after a restart)


def _sign(message: str) -> str:
    return hmac.new(_SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()


def _external_id(sid: str) -> str:
    """Stable per-browser ExternalId, recomputed on demand: nothing is stored on the server."""
    return _sign("external-id:" + sid)[:32]


def _valid_sid(sid: str | None) -> bool:
    return bool(sid) and bool(SID_RE.fullmatch(sid))


def _pack_role(sid: str, role_arn: str) -> str:
    return f"{role_arn}.{_sign('role:' + sid + ':' + role_arn)}"


def _unpack_role(sid: str, value: str | None) -> str | None:
    if not value or "." not in value:
        return None
    role_arn, signature = value.rsplit(".", 1)
    if not hmac.compare_digest(signature, _sign("role:" + sid + ":" + role_arn)):
        return None
    return role_arn if ROLE_ARN_RE.fullmatch(role_arn) else None


def _set_cookie(response: Response, name: str, value: str) -> None:
    response.set_cookie(
        name, value, httponly=True, secure=_cookie_secure(),
        samesite="lax", max_age=COOKIE_MAX_AGE, path="/",
    )


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
    sid = request.cookies.get(COOKIE_NAME)
    if not _valid_sid(sid):
        sid = secrets.token_urlsafe(32)
    _set_cookie(response, COOKIE_NAME, sid)
    return {
        "external_id": _external_id(sid),
        "trusted_account_id": trusted_account_id,
        "role_name": ROLE_NAME,
        "template_url": template_url,
    }


@router.post("/verify")
def verify(body: VerifyBody, request: Request, response: Response):
    role_arn = body.role_arn.strip()
    if not ROLE_ARN_RE.fullmatch(role_arn):
        raise HTTPException(status_code=400, detail=f"Role ARN must look like arn:aws:iam::<12-digit account id>:role/{ROLE_NAME}.")
    sid = request.cookies.get(COOKIE_NAME)
    if not _valid_sid(sid):
        raise HTTPException(status_code=400, detail="Start the connection first: close this window and click Connect AWS again.")
    candidate = {"role_arn": role_arn, "external_id": _external_id(sid)}
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
        _creds[sid] = {"session": session, "expires": expires}
    _set_cookie(response, ROLE_COOKIE, _pack_role(sid, role_arn))
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
def disconnect(request: Request, response: Response):
    sid = request.cookies.get(COOKIE_NAME)
    with _lock:
        _creds.pop(sid, None)
    # Keep the session id so an existing stack (same ExternalId) stays valid if they reconnect.
    response.delete_cookie(ROLE_COOKIE, path="/")
    return {"connected": False}


def get_connection(request: Request) -> dict | None:
    """The caller's connected role, or None if they are using the server's own account."""
    sid = request.cookies.get(COOKIE_NAME)
    if not _valid_sid(sid):
        return None
    role_arn = _unpack_role(sid, request.cookies.get(ROLE_COOKIE))
    if not role_arn:
        return None
    return {"sid": sid, "role_arn": role_arn, "external_id": _external_id(sid)}


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
