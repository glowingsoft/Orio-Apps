import os
import pytest

BASE_URL = os.environ.get("EXPO_BACKEND_URL_TEST") or "http://localhost:8001"
WS_BASE = BASE_URL.replace("http://", "ws://").replace("https://", "wss://")


@pytest.fixture(scope="session")
def base_url() -> str:
    return BASE_URL.rstrip("/")


@pytest.fixture(scope="session")
def ws_base() -> str:
    return WS_BASE.rstrip("/")
