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
    auth._hits.clear()
    from upsell_poc.api import main

    return TestClient(main.app)


def test_api_needs_a_login_but_health_and_auth_routes_do_not(client):
    assert client.get("/health").status_code == 200
    assert client.get("/api/auth/options").json()["signup"] is True
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
    assert client.get("/api/auth/options").json()["signup"] is False
    assert TestClient(client.app).post("/api/auth/signup", json={**GOOD, "email": "c@example.com"}).status_code == 403


def test_demo_login_works_anywhere_while_it_is_on_and_not_at_all_when_switched_off(client, monkeypatch):
    demo = {"email": auth.DEMO_EMAIL, "password": auth.DEMO_PASSWORD}
    # on by default, from any machine (as on a deployed copy): the login page is told the details and they work
    assert client.get("/api/auth/options").json()["demo"] == {"email": auth.DEMO_EMAIL, "password": auth.DEMO_PASSWORD}
    r = client.post("/api/auth/login", json=demo)
    assert r.status_code == 200 and r.json()["role"] == "member"
    assert client.get("/api/jobs").status_code == 200
    # DEMO_LOGIN=false: the checkbox is not offered and the details stop working (an account made earlier too)
    monkeypatch.setenv("DEMO_LOGIN", "false")
    get_settings.cache_clear()
    off = TestClient(client.app)
    assert off.get("/api/auth/options").json()["demo"] is None
    assert off.post("/api/auth/login", json=demo).status_code == 401


def test_the_demo_account_never_takes_the_first_account_slot(client):
    client.post("/api/auth/login", json={"email": auth.DEMO_EMAIL, "password": auth.DEMO_PASSWORD})
    assert client.get("/api/auth/options").json()["signup"] is True
    first = TestClient(client.app).post("/api/auth/signup", json=GOOD)
    assert first.json()["role"] == "admin"  # the first real account is still the admin


def test_wrong_demo_password_and_normal_logins_still_behave(client):
    assert client.post("/api/auth/login", json={"email": auth.DEMO_EMAIL, "password": "not it"}).status_code == 401
    client.post("/api/auth/signup", json=GOOD)
    other = TestClient(client.app)
    assert other.post("/api/auth/login", json={"email": GOOD["email"], "password": GOOD["password"]}).status_code == 200


def test_demo_email_cannot_be_claimed_by_sign_up(client):
    r = client.post("/api/auth/signup", json={**GOOD, "email": auth.DEMO_EMAIL})
    assert r.status_code == 409
    assert client.post("/api/auth/signup", json=GOOD).json()["role"] == "admin"  # still the first real account


def test_demo_session_ends_when_the_demo_login_is_switched_off(client, monkeypatch):
    r = client.post("/api/auth/login", json={"email": auth.DEMO_EMAIL, "password": auth.DEMO_PASSWORD})
    assert r.status_code == 200 and client.get("/api/jobs").status_code == 200
    monkeypatch.setenv("DEMO_LOGIN", "false")
    get_settings.cache_clear()
    assert client.get("/api/jobs").status_code == 401


def test_faking_the_address_does_not_give_unlimited_guesses(client):
    client.post("/api/auth/signup", json=GOOD)
    other = TestClient(client.app)
    for i in range(auth.MAX_FAILURES_PER_EMAIL):
        auth._failures.pop(f"testclient|{GOOD['email'].lower()}", None)  # as if each guess came from a new address
        other.post("/api/auth/login", json={"email": GOOD["email"], "password": f"bad{i}"})
    assert other.post("/api/auth/login", json=GOOD).status_code == 429


def test_only_an_admin_can_change_people(client):
    client.post("/api/auth/signup", json=GOOD)  # admin
    member = TestClient(client.app)
    member.post("/api/auth/signup", json={**GOOD, "email": "m@example.com"})
    body = {"from_name": "A", "into_name": "B"}
    assert member.post("/api/people/merge", json=body).status_code == 403
    assert member.post("/api/people/name", json={"job_id": "x", "speaker": "A", "name": "B"}).status_code == 403
    assert client.post("/api/people/merge", json=body).status_code != 403


def test_recording_endpoints_are_rate_limited(client):
    client.post("/api/auth/signup", json=GOOD)
    codes = [client.post("/api/live-transcribe", files={"file": ("c.webm", b"")}).status_code for _ in range(22)]
    assert 429 in codes
