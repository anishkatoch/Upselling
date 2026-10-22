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
    assert client.get("/api/auth/options").json() == {"signup": True, "demo": None}
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
    assert client.get("/api/auth/options").json() == {"signup": False, "demo": None}
    assert TestClient(client.app).post("/api/auth/signup", json={**GOOD, "email": "c@example.com"}).status_code == 403


def _local(app):
    """A client that looks like a browser on this computer opening http://localhost:8000."""
    return TestClient(app, base_url="http://localhost:8000", client=("127.0.0.1", 50000))


def test_demo_login_works_only_from_this_computer(client):
    demo = {"email": auth.DEMO_EMAIL, "password": auth.DEMO_PASSWORD}
    # an ordinary (remote) request, e.g. the live site: refused, whatever the credentials are
    assert client.post("/api/auth/login", json=demo).status_code == 401
    assert client.get("/api/auth/options").json()["demo"] is None
    # a request that comes from this computer but is addressed to the public site name: still refused
    spoof = TestClient(client.app, base_url="https://sales.example.com", client=("127.0.0.1", 50000))
    assert spoof.post("/api/auth/login", json=demo).status_code == 401
    # a remote machine claiming to be localhost in the Host header: still refused
    remote = TestClient(client.app, base_url="http://localhost:8000", client=("203.0.113.9", 50000))
    assert remote.post("/api/auth/login", json=demo).status_code == 401
    # forwarded through a proxy (as on Render), even if every address is faked to look local: refused
    for header in ("X-Forwarded-For", "X-Real-IP", "Forwarded", "X-Forwarded-Host"):
        proxied = _local(client.app)
        r = proxied.post("/api/auth/login", json=demo, headers={header: "127.0.0.1"})
        assert r.status_code == 401, header
        assert proxied.get("/api/auth/options", headers={header: "127.0.0.1"}).json()["demo"] is None
    # this computer, addressed as localhost: works, and the login page is told the details
    here = _local(client.app)
    assert here.get("/api/auth/options").json()["demo"] == {"email": auth.DEMO_EMAIL, "password": auth.DEMO_PASSWORD}
    r = here.post("/api/auth/login", json=demo)
    assert r.status_code == 200 and r.json()["role"] == "member"
    assert here.get("/api/jobs").status_code == 200


def test_the_demo_account_never_takes_the_first_account_slot(client):
    _local(client.app).post("/api/auth/login", json={"email": auth.DEMO_EMAIL, "password": auth.DEMO_PASSWORD})
    assert client.get("/api/auth/options").json()["signup"] is True
    first = TestClient(client.app).post("/api/auth/signup", json=GOOD)
    assert first.json()["role"] == "admin"  # the first real account is still the admin


def test_wrong_demo_password_and_normal_logins_still_behave(client):
    here = _local(client.app)
    assert here.post("/api/auth/login", json={"email": auth.DEMO_EMAIL, "password": "not it"}).status_code == 401
    client.post("/api/auth/signup", json=GOOD)
    assert here.post("/api/auth/login", json={"email": GOOD["email"], "password": GOOD["password"]}).status_code == 200


@pytest.mark.parametrize(
    ("host", "ip", "expected"),
    [
        ("localhost:8000", "127.0.0.1", True),
        ("127.0.0.1:8000", "127.0.0.1", True),
        ("[::1]:8000", "::1", True),
        ("localhost", "10.0.0.5", False),  # not from this computer
        ("salesiq.onrender.com", "127.0.0.1", False),  # not addressed to localhost
        (None, None, False),
    ],
)
def test_is_local(host, ip, expected):
    assert auth.is_local(host, ip) is expected


def test_is_local_refuses_anything_that_came_through_a_proxy():
    assert auth.is_local("localhost:8000", "127.0.0.1", ["host", "accept"]) is True
    assert auth.is_local("localhost:8000", "127.0.0.1", ["host", "X-Forwarded-For"]) is False
