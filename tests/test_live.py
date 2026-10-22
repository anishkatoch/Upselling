from types import SimpleNamespace

import openai
import pytest
from fastapi.testclient import TestClient

from upsell_poc import live
from upsell_poc.config import get_settings


class FakeClient:
    """Stands in for the OpenAI client; remembers what it was asked."""

    def __init__(self, text="hello sir, kitne ka hai", fail=False):
        self.calls = []
        self._text, self._fail = text, fail
        self.audio = SimpleNamespace(transcriptions=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.calls.append(kw)
        if self._fail:
            raise openai.APIConnectionError(request=None)  # type: ignore[arg-type]
        return SimpleNamespace(text=self._text)


def test_clip_text_comes_back_trimmed_and_the_model_is_told_to_use_english_letters(settings):
    fake = FakeClient("  namaste sir  ")
    assert live.transcribe_clip(settings, b"audio", "c.webm", "earlier words", client=fake) == "namaste sir"
    sent = fake.calls[0]
    assert sent["model"] == settings.live_transcribe_model and sent["file"] == ("c.webm", b"audio")
    assert "never in Devanagari" in sent["prompt"] and "earlier words" in sent["prompt"]


def test_any_hindi_script_left_in_the_answer_is_shown_in_english_letters(settings):
    assert live.transcribe_clip(settings, b"a", "c.webm", None, client=FakeClient("तीन सौ")) == "teen sau"


def test_service_trouble_becomes_one_clear_error(settings):
    with pytest.raises(live.LiveUnavailable):
        live.transcribe_clip(settings, b"a", "c.webm", None, client=FakeClient(fail=True))


@pytest.fixture
def api(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("AUTH_DIR", str(tmp_path / "auth"))
    get_settings.cache_clear()
    from upsell_poc.api import main

    return TestClient(main.app)


def test_endpoint_needs_login_then_returns_text(api, monkeypatch):
    monkeypatch.setattr(live, "transcribe_clip", lambda *a, **k: "live words")
    files = {"file": ("c.webm", b"abc", "audio/webm")}
    assert api.post("/api/live-transcribe", files=files).status_code == 401
    api.post("/api/auth/signup", json={"name": "A B", "email": "a@example.com", "password": "correct horse"})
    r = api.post("/api/live-transcribe", files=files, data={"context": "so far"})
    assert r.status_code == 200 and r.json() == {"text": "live words"}


def test_endpoint_refuses_empty_and_oversized_clips_and_reports_outages(api, monkeypatch):
    api.post("/api/auth/signup", json={"name": "A B", "email": "a@example.com", "password": "correct horse"})
    assert api.post("/api/live-transcribe", files={"file": ("c.webm", b"", "audio/webm")}).status_code == 400
    big = b"x" * (live.MAX_CLIP_BYTES + 1)
    assert api.post("/api/live-transcribe", files={"file": ("c.webm", big, "audio/webm")}).status_code == 413

    def down(*a, **k):
        raise live.LiveUnavailable("nope")

    monkeypatch.setattr(live, "transcribe_clip", down)
    r = api.post("/api/live-transcribe", files={"file": ("c.webm", b"abc", "audio/webm")})
    assert r.status_code == 502 and "unavailable" in r.json()["detail"]
