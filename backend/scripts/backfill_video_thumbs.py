"""Fill in thumbnails and durations for video posts made before the server stored them.

Safe to re-run: only posts missing `video_thumb_url`, or with a missing / wrong
`video_duration`, are touched. A video whose media file already has a thumbnail just gets
that URL copied onto the post. Durations under 0.5 s (old web uploads saved seconds ÷ 1000)
are re-measured from the file with ffmpeg.

Usage (from the backend folder, with the same .env as the server):
    python scripts/backfill_video_thumbs.py            # do it
    python scripts/backfill_video_thumbs.py --dry-run  # only list what would change
    python scripts/backfill_video_thumbs.py --transcode [--dry-run]
        # compress existing post videos to small MP4 (H.264, ≤1280 px) — same URL, original kept
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bson import ObjectId  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

import server  # noqa: E402  (loads .env, storage config and the thumbnail helpers)


def _missing(field: str) -> dict:
    return {"$or": [{field: {"$exists": False}}, {field: None}]}



_BAD_DURATION = 0.5


def _duration_needs_fix(value) -> bool:
    return value is None or float(value) < _BAD_DURATION


async def main(dry_run: bool) -> None:
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    q = {"video_url": {"$nin": [None, ""]},
         "$or": [_missing("video_thumb_url"), _missing("video_duration"), {"video_duration": {"$lt": _BAD_DURATION}}]}
    done = skipped = failed = 0
    async for p in db.posts.find(q, {"video_url": 1, "video_thumb_url": 1, "video_duration": 1}):
        m = server._MEDIA_URL_RE.search(p.get("video_url") or "")
        vdoc = await db.media_files.find_one({"_id": ObjectId(m.group(1))}) if m else None
        if not vdoc:
            print(f"skip  post {p['_id']}: video file not found ({p.get('video_url')})")
            skipped += 1
            continue
        if dry_run:
            print(f"would post {p['_id']} <- video {vdoc['_id']} (thumb: {'missing' if not p.get('video_thumb_url') else 'ok'}, "
                  f"duration: {p.get('video_duration')!r}{' -> re-measure' if _duration_needs_fix(p.get('video_duration')) else ''})")
            continue
        try:
            update: dict = {}
            data = None

            async def file_bytes():
                nonlocal data
                if data is None:
                    data, _ = await server._run_in_threadpool(server._storage_get, vdoc["storage_path"])
                return data

            if _duration_needs_fix(p.get("video_duration")):
                dur = vdoc.get("duration")
                if _duration_needs_fix(dur):
                    ext = (vdoc.get("storage_path") or "").rsplit(".", 1)[-1][:8]
                    dur = await server._run_in_threadpool(server._video_duration, await file_bytes(), ext)
                    if dur:
                        await db.media_files.update_one({"_id": vdoc["_id"]}, {"$set": {"duration": round(dur, 3)}})
                if dur and not _duration_needs_fix(dur):
                    update["video_duration"] = round(float(dur), 3)
            if not p.get("video_thumb_url"):
                url = vdoc.get("thumb_url")
                if not url:
                    url = await server._store_video_thumbnail(db, vdoc, await file_bytes())
                if url:
                    update["video_thumb_url"] = url
                else:
                    print(f"warn  post {p['_id']}: could not extract a frame")
            if not update:
                print(f"skip  post {p['_id']}: nothing available to fill in")
                skipped += 1
                continue
            await db.posts.update_one({"_id": p["_id"]}, {"$set": update})
            print(f"ok    post {p['_id']} -> {update}")
            done += 1
        except Exception as e:
            print(f"fail  post {p['_id']}: {e}")
            failed += 1
    print(f"\nDone: {done} updated, {skipped} skipped, {failed} failed{' (dry run)' if dry_run else ''}")


async def transcode(dry_run: bool) -> None:
    """Compress existing post videos to small MP4s (same URL; original kept in storage)."""
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    q = {"kind": "video", "purpose": "post", "is_deleted": {"$ne": True}, "transcoded": {"$ne": True}}
    done = failed = 0
    async for f in db.media_files.find(q):
        mb = (f.get("size") or 0) / 1e6
        if dry_run:
            print(f"would compress video {f['_id']} ({f.get('mime')}, {mb:.1f} MB)")
            continue
        try:
            data, _ = await server._run_in_threadpool(server._storage_get, f["storage_path"])
            ext = (f.get("storage_path") or "").rsplit(".", 1)[-1][:8]
            r = await server._transcode_video_bg(db, str(f["_id"]), data, ext)
            if r:
                print(f"ok    video {f['_id']}: {r['before'] / 1e6:.1f} MB -> {r['after'] / 1e6:.2f} MB")
                done += 1
            else:
                print(f"keep  video {f['_id']}: already small or could not be converted ({mb:.1f} MB)")
        except Exception as e:
            print(f"fail  video {f['_id']}: {e}")
            failed += 1
    print(f"\nCompress done: {done} converted, {failed} failed{' (dry run)' if dry_run else ''}")


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    asyncio.run(transcode(dry) if "--transcode" in sys.argv else main(dry))
