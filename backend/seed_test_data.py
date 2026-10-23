"""
ORIO — TEMPORARY TEST DATA (accounts + voice rooms) for previewing the UI.

Everything created here is marked `is_test: True` and `test_batch: "orio-demo"`:
  • test users: email test.N@oriotest.dev, password demo1234,
    0 coins / 0 diamonds / 0 points / VIP 0 (no wallet, gift or VIP history)
  • test rooms: owned by test users, seats filled with test users (data only —
    NO simulated voice connections, NO socket presence)
Visibility: test rooms/users are shown ONLY to test accounts and admins.

Usage (from /app/backend):
    python seed_test_data.py          # create (idempotent: re-running replaces the batch)
    python seed_test_data.py --remove # delete ALL test data before production
"""
import asyncio
import os
import random
import sys
from datetime import datetime, timezone

import bcrypt
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
BATCH = "orio-demo"

PEOPLE = [
    ("Layla", "female", "SA", "🇸🇦"), ("Omar", "male", "EG", "🇪🇬"), ("Noor", "female", "AE", "🇦🇪"),
    ("Yousef", "male", "IQ", "🇮🇶"), ("Sara", "female", "MA", "🇲🇦"), ("Karim", "male", "LB", "🇱🇧"),
    ("Huda", "female", "JO", "🇯🇴"), ("Ali", "male", "KW", "🇰🇼"), ("Mira", "female", "FR", "🇫🇷"),
    ("Adam", "male", "US", "🇺🇸"), ("Rojin", "female", "KRD", ""), ("Emre", "male", "TR", "🇹🇷"),
]
ROOMS = [
    ("TEST · Chill Chat", "chat", 0, 5), ("TEST · Music Night", "music", 3, 4),
    ("TEST · CP Corner", "cp", 6, 3), ("TEST · Game Lounge", "games", 9, 3),
]


def _now():
    return datetime.now(timezone.utc)


async def remove(db):
    ids = [str(u["_id"]) async for u in db.users.find({"is_test": True, "test_batch": BATCH}, {"_id": 1})]
    r1 = await db.rooms.delete_many({"is_test": True, "test_batch": BATCH})
    r2 = await db.users.delete_many({"is_test": True, "test_batch": BATCH})
    if ids:
        await db.refresh_sessions.delete_many({"user_id": {"$in": ids}})
    print(f"removed test rooms={r1.deleted_count} users={r2.deleted_count}")


async def seed(db):
    await remove(db)
    pw = bcrypt.hashpw(b"demo1234", bcrypt.gensalt()).decode()
    users = []
    for i, (name, gender, cc, flag) in enumerate(PEOPLE, start=1):
        while True:
            nid = str(random.randint(10_000_000, 99_999_999))
            if not await db.users.find_one({"numeric_id": nid}, {"_id": 1}):
                break
        doc = {
            "is_test": True, "test_batch": BATCH,
            "email": f"test.{i}@oriotest.dev", "username": f"test_{name.lower()}{i}",
            "nickname": f"{name} (Test)", "password_hash": pw, "gender": gender, "age": 20 + i,
            "country_code": cc, "country_flag": flag,
            "avatar_url": f"https://api.dicebear.com/7.x/avataaars/png?seed=orio-test-{i}",
            "numeric_id": nid, "profile_completed": True, "gender_confirmed": True, "language": "en",
            # Isolated from every financial / progression system.
            "coins": 0, "diamonds": 0, "vip_level": 0, "wealth_points": 0, "charm_points": 0,
            "wealth_level": 0, "charm_level": 0, "level": 1, "experience": 0,
            "followers_count": 0, "following_count": 0, "bio": "ORIO test account",
            "created_at": _now(),
        }
        r = await db.users.insert_one(doc)
        doc["_id"] = r.inserted_id
        users.append(doc)

    for name, cat, start, members in ROOMS:
        owner = users[start]
        seated = users[start:start + members]
        seats = [{"index": k, "user": None, "muted": False, "locked": False} for k in range(8)]
        for k, u in enumerate(seated):
            seats[k]["user"] = {"id": str(u["_id"]), "nickname": u["nickname"], "avatar_url": u["avatar_url"], "vip_level": 0}
        snap = {"id": str(owner["_id"]), "nickname": owner["nickname"], "avatar_url": owner["avatar_url"],
                "vip_level": 0, "country_flag": owner["country_flag"]}
        await db.rooms.insert_one({
            "is_test": True, "test_batch": BATCH,
            "name": name, "description": "ORIO test room", "category": cat,
            "owner_id": str(owner["_id"]), "owner_public": snap,
            "country_code": owner["country_code"], "country_flag": owner["country_flag"],
            "cover_url": f"https://picsum.photos/seed/orio-test-{cat}/400/400",
            "is_live": True, "listeners_count": 0, "seats": seats, "mic_count": 8,
            "moderators": [], "created_at": _now(),
        })
    print(f"seeded test users={len(users)} rooms={len(ROOMS)} (password demo1234)")
    for u in users:
        print(f"  {u['email']}  ID {u['numeric_id']}  {u['nickname']}")


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    await (remove(db) if "--remove" in sys.argv else seed(db))


if __name__ == "__main__":
    asyncio.run(main())
