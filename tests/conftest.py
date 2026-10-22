from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from upsell_poc.config import Settings, get_settings, load_models_config  # noqa: E402

requires_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


@pytest.fixture(autouse=True)
def _accounts_off_and_isolated(tmp_path, monkeypatch):
    """Existing API tests run signed out; accounts never touch the real data/auth folder."""
    monkeypatch.setenv("AUTH_REQUIRED", "false")
    monkeypatch.setenv("AUTH_DIR", str(tmp_path / "auth"))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def settings(tmp_path, monkeypatch) -> Settings:
    monkeypatch.setenv("LOCAL_STORAGE_DIR", str(tmp_path / "storage"))
    monkeypatch.setenv("WORK_DIR", str(tmp_path / "work"))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("QUEUE_BACKEND", "inline")
    get_settings.cache_clear()
    yield get_settings()
    get_settings.cache_clear()


@pytest.fixture
def models_config():
    cfg = load_models_config()
    cfg.mood.tone_model.enabled = False
    return cfg
