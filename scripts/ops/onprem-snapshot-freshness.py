#!/usr/bin/env python3
"""Offline read-only freshness check for redacted restic snapshot metadata."""
import json
import os
import sys
from datetime import datetime, timezone


def main():
    try:
        hours = float(os.environ.get("RCAT_POS_BACKUP_MAX_AGE_HOURS", "26"))
        if not 1 <= hours <= 72:
            raise ValueError("Backup freshness threshold must be between 1 and 72 hours")
        snapshots = json.load(sys.stdin)
        if not isinstance(snapshots, list):
            raise ValueError("Expected Restic snapshot list")
        timestamps = []
        for item in snapshots:
            if not isinstance(item, dict) or "rcat-pos-staging" not in item.get("tags", []):
                continue
            raw = item.get("time")
            if not isinstance(raw, str):
                continue
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                continue
            timestamps.append(parsed.astimezone(timezone.utc))
        if not timestamps:
            raise ValueError("No approved staging snapshots")
        elapsed = (datetime.now(timezone.utc) - max(timestamps)).total_seconds()
        if elapsed < -300:
            raise ValueError("Snapshot timestamp unexpectedly in the future")
        if elapsed > hours * 3600:
            raise ValueError("Staging backup is older than the configured threshold")
        print(json.dumps({
            "status": "fresh",
            "ageMinutes": max(0, round(elapsed / 60)),
            "maxAgeHours": hours,
            "snapshotCount": len(timestamps),
        }, separators=(",", ":")))
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        # Never print raw restic metadata, file paths, credentials or repo URLs.
        print("STAGING BACKUP FRESHNESS FAILED: " + str(exc), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
