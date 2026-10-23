"""Emergent managed push relay (SuprSend passthrough). Backend-only."""
import asyncio
import logging
import os

import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)

PUSH_BASE_URL = "https://integrations.emergentagent.com"
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=PUSH_BASE_URL,
            headers={"X-Push-Key": os.environ.get("EMERGENT_PUSH_KEY", "placeholder")},
            timeout=10.0,
        )
    return _client


async def register_device(user_id: str, platform: str, device_token: str) -> None:
    resp = await _get_client().post("/api/v1/push/users/register",
                                    json={"user_id": user_id, "platform": platform, "device_token": device_token})
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()


async def send_push(recipients: list[str], data: dict, idempotency_key: str | None = None, _attempt: int = 0) -> None:
    recipients = [r for r in dict.fromkeys(recipients) if r]
    if not recipients:
        return
    if len(recipients) > 100:
        for i in range(0, len(recipients), 100):
            await send_push(recipients[i:i + 100], data, f"{idempotency_key}:{i}" if idempotency_key else None)
        return
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    payload: dict = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    resp = await _get_client().post("/api/v1/push/trigger", json=payload)
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    code = resp.json().get("code", "") if resp.headers.get("content-type", "").startswith("application/json") else ""
    if code == "idempotency_key_in_progress" and idempotency_key and _attempt < 3:
        await asyncio.sleep(3)
        return await send_push(recipients, data, idempotency_key=idempotency_key, _attempt=_attempt + 1)
    if code in ("insufficient_credits", "integration_disabled", "daily_limit_reached"):
        logger.warning(f"Push paused: {code} ({resp.status_code}): {resp.json().get('message', '')}")
        return
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()
