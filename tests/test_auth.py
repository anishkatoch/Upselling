import pytest
from fastapi.testclient import TestClient

from upsell_poc import auth
from upsell_poc.config import get_settings

GOOD = {"name": "Asha Rao", "email": "Asha@Example.com", "password": "correct horse"}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("AUTH_DIR", str(tmp_path / "auth"))
    monkeypatch.setenv("LOCAL_STORAGE_DIR", str(tmp_path / "storage"))
    get_settings.cache_clear()
    auth._failures.clear()
    from upsell_poc.api import main

    return TestClient(main.app)


def test_api_needs_a_login_but_health_and_auth_routes_do_not(client):
    assert client.get("/health").status_code == 200
    assert client.get("/api/auth/options").json() == {"signup": True}
    assert client.get("/api/jobs").status_code == 401
    assert client.get("/api/dashboard?period=month").status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_signup_signs_you_in_and_first_account_is_admin(client):
    r = client.post("/api/auth/signup", json=GOOD)
    assert r.status_code == 201 and r.json()["email"] == "asha@example.com" and r.json()["role"] == "admin"
    assert "HttpOnly" in r.headers["set-cookie"] and "SameSite=lax" in r.headers["set-cookie"]
    assert client.get("/api/auth/me").json()["name"] == "Asha Rao"
    assert client.get("/api/jobs").status_code == 200
    other = {**GOOD, "email": "b@example.com"}
    assert TestClient(client.app).post("/api/auth/signup", json=other).json()["role"] == "member"


def test_passwords_are_hashed_not_stored(client, tmp_path):
    client.post("/api/auth/signup", json=GOOD)
    text = (tmp_path / "auth" / "users.json").read_text()
    assert "correct horse" not in text and "scrypt$" in text


@pytest.mark.parametrize(
    "patch",
    [{"name": " "}, {"email": "nope"}, {"password": "short"}],
)
def test_signup_rejects_bad_input(client, patch):
    assert client.post("/api/auth/signup", json={**GOOD, **patch}).status_code == 422


def test_duplicate_email_is_refused_whatever_the_case(client):
    client.post("/api/auth/signup", json=GOOD)
    assert (
        TestClient(client.app).post("/api/auth/signup", json={**GOOD, "email": "ASHA@example.com"}).status_code == 409
    )


def test_login_logout_and_wrong_password(client):
    client.post("/api/auth/signup", json=GOOD)
    client.post("/api/auth/logout")
    assert client.get("/api/jobs").status_code == 401
    wrong = {"email": GOOD["email"], "password": "wrong password"}
    assert client.post("/api/auth/login", json=wrong).status_code == 401
    ghost = {"email": "ghost@example.com", "password": "whatever1"}
    assert client.post("/api/auth/login", json=ghost).status_code == 401
    ok = client.post("/api/auth/login", json={"email": " ASHA@example.com ", "password": GOOD["password"]})
    assert ok.status_code == 200 and client.get("/api/jobs").status_code == 200


def test_repeated_wrong_passwords_are_throttled(client):
    client.post("/api/auth/signup", json=GOOD)
    bad = {"email": GOOD["email"], "password": "wrong password"}
    codes = [client.post("/api/auth/login", json=bad).status_code for _ in range(6)]
    assert codes[:5] == [401] * 5 and codes[5] == 429
    # even the right password waits out the lock
    assert client.post("/api/auth/login", json={**bad, "password": GOOD["password"]}).status_code == 429


def test_tampered_or_expired_sessions_are_refused(client, monkeypatch):
    client.post("/api/auth/signup", json=GOOD)
    cookie = client.cookies.get(auth.COOKIE)
    client.cookies.clear()
    client.cookies.set(auth.COOKIE, cookie[:-2] + "xx")
    assert client.get("/api/jobs").status_code == 401
    s = get_settings()
    uid = auth.user_from_token(s, cookie).id
    monkeypatch.setattr(auth, "SESSION_SECONDS", -10)
    client.cookies.clear()
    client.cookies.set(auth.COOKIE, auth.make_token(s, uid))
    assert client.get("/api/jobs").status_code == 401


def test_closed_signup_still_lets_the_very_first_account_in(client, monkeypatch):
    monkeypatch.setenv("AUTH_ALLOW_SIGNUP", "false")
    get_settings.cache_clear()
    assert client.post("/api/auth/signup", json=GOOD).status_code == 201
    assert client.get("/api/auth/options").json() == {"signup": False}
    assert TestClient(client.app).post("/api/auth/signup", json={**GOOD, "email": "c@example.com"}).status_code == 403
