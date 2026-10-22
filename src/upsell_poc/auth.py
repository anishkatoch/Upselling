"""Email + password accounts with signed session cookies.

Accounts live in `<auth_dir>/users.json` (never in the sample-data store), passwords are salted scrypt hashes,
and a session is an HMAC-signed, expiring token in an HttpOnly cookie. The first account created is the admin.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from upsell_poc.config import Settings

COOKIE = "upsell_session"
SESSION_SECONDS = 7 * 24 * 3600
MIN_PASSWORD = 8
MAX_PASSWORD = 128
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")
_N, _R, _P = 2**14, 8, 1
_lock = threading.Lock()
_failures: dict[str, list[float]] = {}
MAX_FAILURES, FAILURE_WINDOW = 5, 600


# A built-in account for trying the app, offered on the login page as a checkbox that fills the form. It is on
# wherever the app runs; the DEMO_LOGIN setting (DEMO_LOGIN=false) switches it off. These details are in the repository,
# so anyone who can reach a running copy can use them while it is on.
DEMO_EMAIL = "demo@salesiq.app"
DEMO_PASSWORD = "SalesIQ-demo-2026"
DEMO_NAME = "Demo User"


class AuthError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class PublicUser(BaseModel):
    id: str
    name: str
    email: str
    role: str


def _dir(settings: Settings) -> Path:
    d = settings.auth_dir
    d.mkdir(parents=True, exist_ok=True)
    return d


def _users_path(settings: Settings) -> Path:
    return _dir(settings) / "users.json"


def _load(settings: Settings) -> dict[str, dict[str, Any]]:
    try:
        return json.loads(_users_path(settings).read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def _save(settings: Settings, users: dict[str, dict[str, Any]]) -> None:
    path = _users_path(settings)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(users, indent=1), "utf-8")
    os.replace(tmp, path)


def _secret(settings: Settings) -> bytes:
    if settings.auth_secret:
        return settings.auth_secret.encode()
    path = _dir(settings) / "secret.key"
    try:
        return path.read_bytes()
    except OSError:
        key = secrets.token_bytes(32)
        path.write_bytes(key)
        return key


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(got, bytes.fromhex(digest))
    except (ValueError, TypeError):
        return False


_DUMMY_HASH = hash_password("not-a-real-password")  # so a wrong email costs the same time as a wrong password


def _public(u: dict[str, Any]) -> PublicUser:
    return PublicUser(id=u["id"], name=u["name"], email=u["email"], role=u["role"])


def _real_users(users: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """The accounts people made, not the built-in demo one (which must not count as "the first account")."""
    return {e: u for e, u in users.items() if e != DEMO_EMAIL}


def has_users(settings: Settings) -> bool:
    return bool(_real_users(_load(settings)))


def is_demo_credentials(email: str, password: str) -> bool:
    return normalise_email(email) == DEMO_EMAIL and hmac.compare_digest(password.encode(), DEMO_PASSWORD.encode())


def demo_login(settings: Settings) -> PublicUser:
    """The demo account, created (or its password reset) on first use. A plain member, never the admin."""
    with _lock:
        users = _load(settings)
        user = users.get(DEMO_EMAIL)
        if user is None or not verify_password(DEMO_PASSWORD, user["password"]):
            user = {
                "id": user["id"] if user else uuid.uuid4().hex,
                "name": DEMO_NAME,
                "email": DEMO_EMAIL,
                "password": hash_password(DEMO_PASSWORD),
                "role": "member",
                "created_at": user["created_at"] if user else datetime.now(UTC).isoformat(),
            }
            users[DEMO_EMAIL] = user
            _save(settings, users)
    return _public(user)


def normalise_email(email: str) -> str:
    return email.strip().lower()


def signup(settings: Settings, name: str, email: str, password: str) -> PublicUser:
    name, email = name.strip(), normalise_email(email)
    if not settings.auth_allow_signup and _real_users(_load(settings)):
        raise AuthError(403, "Sign-ups are closed. Ask an administrator for an account.")
    if not 1 <= len(name) <= 80:
        raise AuthError(422, "Please enter your name.")
    if not _EMAIL.match(email):
        raise AuthError(422, "Please enter a valid email address.")
    if not MIN_PASSWORD <= len(password) <= MAX_PASSWORD:
        raise AuthError(422, f"Choose a password of {MIN_PASSWORD} to {MAX_PASSWORD} characters.")
    pw = hash_password(password)
    with _lock:
        users = _load(settings)
        if email in users:
            raise AuthError(409, "An account with this email already exists. Try logging in.")
        user = {
            "id": uuid.uuid4().hex,
            "name": name,
            "email": email,
            "password": pw,
            "role": "admin" if not _real_users(users) else "member",
            "created_at": datetime.now(UTC).isoformat(),
        }
        users[email] = user
        _save(settings, users)
    return _public(user)


def _throttled(key: str) -> bool:
    now = time.time()
    recent = [t for t in _failures.get(key, []) if now - t < FAILURE_WINDOW]
    _failures[key] = recent
    return len(recent) >= MAX_FAILURES


def login(settings: Settings, email: str, password: str, client: str = "") -> PublicUser:
    email = normalise_email(email)
    if email == DEMO_EMAIL and not settings.demo_login:
        # Switched off: the demo account stops working even if it was created while the demo login was on.
        raise AuthError(401, "That email and password don't match.")
    key = f"{client}|{email}"
    if _throttled(key):
        raise AuthError(429, "Too many attempts. Please wait a few minutes and try again.")
    user = _load(settings).get(email)
    ok = verify_password(password[:MAX_PASSWORD], user["password"] if user else _DUMMY_HASH)
    if not user or not ok:
        _failures.setdefault(key, []).append(time.time())
        raise AuthError(401, "That email and password don't match.")
    _failures.pop(key, None)
    return _public(user)


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def make_token(settings: Settings, user_id: str) -> str:
    payload = _b64(json.dumps({"uid": user_id, "exp": int(time.time()) + SESSION_SECONDS}).encode())
    sig = _b64(hmac.new(_secret(settings), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def user_from_token(settings: Settings, token: str | None) -> PublicUser | None:
    if not token or "." not in token:
        return None
    payload, sig = token.rsplit(".", 1)
    good = _b64(hmac.new(_secret(settings), payload.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, good):
        return None
    try:
        data = json.loads(_unb64(payload))
    except (ValueError, TypeError):
        return None
    if data.get("exp", 0) < time.time():
        return None
    for u in _load(settings).values():
        if u["id"] == data.get("uid"):
            return _public(u)
    return None
