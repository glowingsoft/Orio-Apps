"""Copy users' Google profile photos into our own storage and point their avatar at the copy.

Google photo links (lh3.googleusercontent.com) get rate-limited (HTTP 429) in browsers, which
shows up as empty avatars. New Google sign-ups and returning Google users are handled by the
server automatically; this script does every existing account at once, and also updates the
author picture saved on their posts.

Safe to re-run: only avatars that are still Google links are touched.

Usage (from the backend folder, with the same .env as the server):
    python scripts/import_google_avatars.py --dry-run
    python scripts/import_google_avatars.py
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from motor.motor_asyncio import AsyncIOMotorClient  

import server 


async def main(dry_run: bool) -> None:
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    done = failed = 0
    async for u in db.users.find({"avatar_url": {"$regex": "googleusercontent\\.com"}}, {"avatar_url": 1, "nickname": 1}):
        old = u["avatar_url"]
        if dry_run:
            print(f"would copy avatar of {u.get('nickname')!r} ({u['_id']})")
            continue
        new = await server._import_google_avatar_for(db, u)
        if not new:
            print(f"fail  {u.get('nickname')!r} ({u['_id']}): could not download the photo")
            failed += 1
            continue
        p = await db.posts.update_many({"author_id": str(u["_id"]), "author_pub.avatar_url": old},
                                       {"$set": {"author_pub.avatar_url": new}})
        print(f"ok    {u.get('nickname')!r} ({u['_id']}) -> {new}  (+{p.modified_count} posts)")
        done += 1
    print(f"\nDone: {done} copied, {failed} failed{' (dry run)' if dry_run else ''}")


if __name__ == "__main__":
    asyncio.run(main("--dry-run" in sys.argv))
