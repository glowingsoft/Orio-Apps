"""Verify a MongoDB backup restore by comparing the restored copy with production.

READ-ONLY on both databases. Use it after restoring an Atlas snapshot into a separate,
isolated cluster (see docs/BACKUP_AND_RECOVERY.md). It compares every collection:
document counts, the newest document (by _id) and that a sample of production documents
exists in the restore. Production keeps changing after the snapshot time, so the restore is
expected to be the same or slightly behind — never ahead, and never missing collections.

Usage (any machine with network access to both clusters):
    python scripts/verify_restore.py --prod "<prod MONGO_URL>" --restored "<restored MONGO_URL>" [--db orio]
    # or with PROD_MONGO_URL / RESTORED_MONGO_URL / DB_NAME environment variables

Exit code 0 = restore verified, 1 = problems found. Prints a report you can attach as evidence.
"""
import argparse
import os
import sys
from datetime import datetime, timezone

from pymongo import MongoClient


def ts(oid) -> str:
    try:
        return oid.generation_time.strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        return "-"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--prod", default=os.environ.get("PROD_MONGO_URL"))
    ap.add_argument("--restored", default=os.environ.get("RESTORED_MONGO_URL"))
    ap.add_argument("--db", default=os.environ.get("DB_NAME", "orio"))
    ap.add_argument("--restored-db", default=None, help="database name in the restore (default: same as --db)")
    ap.add_argument("--sample", type=int, default=20, help="documents per collection to look up in the restore")
    a = ap.parse_args()
    if not a.prod or not a.restored:
        ap.error("both --prod and --restored connection strings are required")
    rdb = a.restored_db or a.db
    if a.prod == a.restored and rdb == a.db:
        ap.error("--prod and --restored point to the same database")

    prod = MongoClient(a.prod, serverSelectionTimeoutMS=15000)[a.db]
    rest = MongoClient(a.restored, serverSelectionTimeoutMS=15000)[rdb]

    print(f"Restore verification - {datetime.now(timezone.utc):%Y-%m-%d %H:%M UTC} - production '{a.db}' vs restored '{rdb}'")
    prod_cols = sorted(c for c in prod.list_collection_names() if not c.startswith("system."))
    rest_cols = set(rest.list_collection_names())
    problems = []

    print(f"\n{'collection':32} {'production':>11} {'restored':>11} {'diff':>7}  newest in restore         sample")
    print("-" * 110)
    total_p = total_r = 0
    for name in prod_cols:
        pc = prod[name].estimated_document_count()
        if name not in rest_cols:
            print(f"{name:32} {pc:>11} {'MISSING':>11}")
            if pc:
                problems.append(f"collection '{name}' is missing from the restore")
            continue
        rc = rest[name].estimated_document_count()
        total_p += pc
        total_r += rc
        newest = rest[name].find_one(sort=[("_id", -1)], projection={"_id": 1})
        # Sample older production documents (before the newest restored one) and check they exist.
        sample_ok = sample_n = 0
        if newest is not None and pc:
            q = {"_id": {"$lte": newest["_id"]}} if hasattr(newest["_id"], "generation_time") else {}
            for d in prod[name].aggregate([{"$match": q}, {"$sample": {"size": a.sample}}, {"$project": {"_id": 1}}]):
                sample_n += 1
                sample_ok += rest[name].count_documents({"_id": d["_id"]}, limit=1)
        flag = ""
        if rc > pc:
            flag = "  <- restore has MORE documents than production"
            problems.append(f"'{name}': restore has more documents than production")
        if sample_n and sample_ok < sample_n:
            flag = f"  <- {sample_n - sample_ok} sampled documents missing"
            problems.append(f"'{name}': {sample_n - sample_ok}/{sample_n} sampled documents missing")
        print(f"{name:32} {pc:>11} {rc:>11} {rc - pc:>7}  {ts(newest['_id']) if newest else '-':24}  "
              f"{sample_ok}/{sample_n}{flag}")

    print("-" * 110)
    print(f"{'TOTAL':32} {total_p:>11} {total_r:>11} {total_r - total_p:>7}")
    extra = sorted(rest_cols - set(prod_cols) - {c for c in rest_cols if c.startswith('system.')})
    if extra:
        print(f"\nCollections only in the restore (dropped in production since the snapshot): {', '.join(extra)}")
    print("\nNote: production keeps changing after the snapshot, so small negative differences are expected.")

    if problems:
        print("\nRESULT: PROBLEMS FOUND")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("\nRESULT: RESTORE VERIFIED - all collections present, sampled documents found, no unexpected data")
    return 0


if __name__ == "__main__":
    sys.exit(main())
