"""Firebase Cloud Messaging helpers for native Android and iOS pushes."""
import asyncio
import logging
import os
import threading
from pathlib import Path
from typing import Any

from fastapi import HTTPException

logger = logging.getLogger(__name__)
ROOT_DIR = Path(__file__).parent
_firebase_app = None
_firebase_lock = threading.Lock()


def _firebase():
    """Initialize Firebase Admin once, using the ignored local key or ADC."""
    global _firebase_app
    with _firebase_lock:
        if _firebase_app is not None:
            return _firebase_app

        import firebase_admin
        from firebase_admin import credentials

        key_path = Path(os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH", "service-account.json"))
        if not key_path.is_absolute():
            key_path = ROOT_DIR / key_path
        if key_path.is_file():
            cred = credentials.Certificate(str(key_path))
            _firebase_app = firebase_admin.initialize_app(cred)
        else:
            # Supports GOOGLE_APPLICATION_CREDENTIALS / workload identity in deployed environments.
            _firebase_app = firebase_admin.initialize_app()
        return _firebase_app


def _firebase_enabled() -> bool:
    return os.environ.get("PUSH_PROVIDER", "firebase").strip().lower() == "firebase"


async def register_device(db: Any, user_id: str, platform: str, device_token: str) -> None:
    if not _firebase_enabled():
        await _register_emergent(user_id, platform, device_token)
        return
    try:
        await asyncio.to_thread(_firebase)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Firebase Admin initialization failed")
        raise HTTPException(503, "Firebase push is not configured") from exc

    await db.push_devices.update_one(
        {"token": device_token},
        {"$set": {"user_id": user_id, "platform": platform, "token": device_token}},
        upsert=True,
    )


async def _register_emergent(user_id: str, platform: str, device_token: str) -> None:
    import httpx

    async with httpx.AsyncClient(
        base_url="https://integrations.emergentagent.com",
        headers={"X-Push-Key": os.environ.get("EMERGENT_PUSH_KEY", "placeholder")}, timeout=10.0,
    ) as client:
        resp = await client.post("/api/v1/push/users/register",
                                 json={"user_id": user_id, "platform": platform, "device_token": device_token})
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()


async def send_push(db: Any, recipients: list[str], data: dict,
                    idempotency_key: str | None = None) -> None:
    """Send one FCM notification per registered device; failures stay non-blocking upstream."""
    del idempotency_key  # FCM does not provide provider-side idempotency keys.
    recipients = [r for r in dict.fromkeys(recipients) if r]
    if not recipients:
        return
    if not _firebase_enabled():
        await _send_emergent(recipients, data)
        return
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")

    devices = await db.push_devices.find({"user_id": {"$in": recipients}}).to_list(length=None)
    if not devices:
        return
    try:
        stale_tokens = await asyncio.to_thread(_send_firebase_batch, devices, data)
        if stale_tokens:
            await db.push_devices.delete_many({"token": {"$in": stale_tokens}})
    except Exception as exc:  # noqa: BLE001
        logger.exception("Firebase push send failed")
        raise HTTPException(502, "Push provider unavailable") from exc


def _send_firebase_batch(devices: list[dict], data: dict) -> list[str]:
    from firebase_admin import messaging

    app = _firebase()
    stale_tokens = []
    for offset in range(0, len(devices), 500):
        batch = devices[offset:offset + 500]
        messages = [
            messaging.Message(
                token=device["token"],
                notification=messaging.Notification(title=data["title"], body=data["message"]),
                data={str(k): str(v) for k, v in data.items() if k not in ("title", "message")},
                android=messaging.AndroidConfig(priority="high"),
                apns=messaging.APNSConfig(headers={"apns-priority": "10"}),
            )
            for device in batch
        ]
        response = messaging.send_each(messages, app=app)
        for device, result in zip(batch, response.responses):
            if result.success:
                continue
            code = getattr(result.exception, "code", None)
            if code in ("messaging/registration-token-not-registered", "registration-token-not-registered"):
                stale_tokens.append(device["token"])
            else:
                logger.warning("FCM delivery failed (%s)", code or type(result.exception).__name__)
    return stale_tokens


async def _send_emergent(recipients: list[str], data: dict) -> None:
    import httpx

    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    async with httpx.AsyncClient(
        base_url="https://integrations.emergentagent.com",
        headers={"X-Push-Key": os.environ.get("EMERGENT_PUSH_KEY", "placeholder")}, timeout=10.0,
    ) as client:
        for offset in range(0, len(recipients), 100):
            resp = await client.post("/api/v1/push/trigger", json={"recipients": recipients[offset:offset + 100], "data": data})
            if resp.status_code == 401:
                raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
            if resp.status_code >= 500:
                raise HTTPException(502, "Push provider unavailable")
            resp.raise_for_status()
