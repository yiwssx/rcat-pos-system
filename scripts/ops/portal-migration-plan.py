#!/usr/bin/env python3
"""Read-only G4 Staging migration ledger planner, never a deploy/release gate."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

VERSION = re.compile(r"[0-9]{3}_[a-z0-9_]+\.sql\Z")
ROW = re.compile(r"([0-9]{3}_[a-z0-9_]+\.sql)\|([0-9a-f]{64})\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
FLAGS = (
    "RCAT_POS_PAYMENT_QR_RELEASE_APPROVED",
    "RCAT_POS_PAYMENT_SLIP_RELEASE_APPROVED",
    "RCAT_POS_PAYMENT_FINANCE_RELEASE_APPROVED",
    "ENABLE_DEVELOPMENT_AUTH",
)
TARGETS = (
    "050_g6_slip_image_retention.sql",
    "051_g6_approved_receiver_activation.sql",
    "052_g6_receiver_retention_activation_gate.sql",
)


class Blocked(Exception):
    pass


def inventory(root: Path) -> dict[str, str]:
    paths = sorted((root / "db/migrations").glob("*.sql"))
    names = [p.name for p in paths]
    if (len(names) != 52 or any(not VERSION.fullmatch(n) for n in names)
            or [int(n[:3]) for n in names] != list(range(1, 53))
            or names[48] != "049_quick_order_tracking.sql"
            or tuple(names[49:]) != TARGETS):
        raise Blocked("source migration inventory differs from reviewed 049-052 release")
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


def assess(manifest: dict[str, str], applied: list[tuple[str, str]]) -> dict:
    """Pure function for safe synthetic tests. A ledger is not a recovery proof."""
    names = list(manifest)
    if (len(names) != 52 or names[48] != "049_quick_order_tracking.sql"
            or tuple(names[49:]) != TARGETS):
        raise Blocked("unexpected source migration inventory")
    if not 49 <= len(applied) <= 52:
        raise Blocked("missing baseline 049 or unexpected ledger count")
    for i, (version, checksum) in enumerate(applied):
        if version != names[i] or checksum != manifest[version]:
            raise Blocked("missing, out-of-order or drifted database migration")
    pending = names[len(applied):]
    return {"status": "ALREADY_APPLIED" if not pending else "PENDING_REVIEW",
            "appliedCount": len(applied), "pending": pending,
            "schemaMutation": "NONE", "backupVerified": False,
            "deployedSourceVerified": False, "paymentApproval": False}


def call(argv: list[str], *, cwd: Path | None = None) -> str:
    try:
        result = subprocess.run(argv, cwd=cwd, capture_output=True,
                                text=True, check=False, timeout=20)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Blocked("read-only command unavailable") from exc
    if result.returncode:
        # Never forward protected env, Docker or DB diagnostics to logs.
        raise Blocked("source, Docker or database read-only query failed")
    return result.stdout.strip()


def protected_nonpayment(path: Path) -> None:
    if not path.is_file() or path.is_symlink():
        raise Blocked("protected .env.portal is missing or symlinked")
    info = path.stat()
    if stat.S_IMODE(info.st_mode) & 0o077 or info.st_uid not in (0, os.geteuid()):
        raise Blocked("protected environment permissions/ownership invalid")
    found = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, raw = line.split("=", 1)
        if key not in FLAGS:
            continue
        if key in found:
            raise Blocked("duplicate sensitive release flag")
        found[key] = raw.strip().strip("'\"")
    # Portal Compose hard-codes development auth to false. The protected
    # operator template omits this optional key; a provided unsafe value
    # must still fail. All three payment flags must be explicitly false.
    if (any(found.get(key) != "false" for key in FLAGS[:3]) or
            found.get("ENABLE_DEVELOPMENT_AUTH", "false") != "false"):
        raise Blocked("payment flags must be false; development auth cannot be enabled")


def main(argv: list[str]) -> int:
    if argv == ["--help"]:
        print("Usage: python3 scripts/ops/portal-migration-plan.py --expected-sha 40_HEX_MAIN_SHA")
        print("Read-only Stage ledger report. Never deploys, migrates, enables money or backs up.")
        return 0
    if len(argv) != 2 or argv[0] != "--expected-sha" or not SHA.fullmatch(argv[1]):
        raise Blocked("exact reviewed source SHA required")
    root = Path(__file__).resolve().parents[2]
    env = root / ".env.portal"
    expected = argv[1]
    if (call(["git", "rev-parse", "HEAD"], cwd=root) != expected or
            call(["git", "status", "--porcelain", "--untracked-files=no"], cwd=root)):
        raise Blocked("checkout is not the clean, expected reviewed SHA")
    manifest = inventory(root)
    protected_nonpayment(env)
    base = ["docker", "--host=unix:///var/run/docker.sock", "compose",
            "--project-directory", str(root), "--env-file", str(env),
            "-p", "rcat-pos-staging", "-f", str(root / "compose.portal.yaml")]
    call(base + ["config", "--quiet"])
    sql = ("BEGIN READ ONLY; SELECT version, btrim(checksum) "
           "FROM rcat_migrations.applied ORDER BY version; ROLLBACK;")
    shell = ('export PGPASSWORD="$(cat /run/secrets/staging_pg_password)"; '
             'exec psql -X -qAt -v ON_ERROR_STOP=1 -F "|" '
             '-U rcat_pos_staging_dba -d rcat_pos_staging -c "$1"')
    output = call(base + ["exec", "-T", "postgres", "sh", "-ec", shell, "sh", sql])
    lines = output.splitlines()
    if any(not ROW.fullmatch(line) for line in lines):
        raise Blocked("database migration ledger output is malformed")
    summary = assess(manifest, [tuple(line.split("|", 1)) for line in lines])
    print(json.dumps({
        "kind": "rcat.pos.g4.readonly-migration-plan.v1",
        "source": expected, **summary,
        "outstandingIndependentGates": [
            "on-host image identity/source SHA",
            "protected pre-migration backup and isolated restore",
            "signed human-approved Staging release and operator rollout",
            "Google auth/nonpayment health post-deploy",
            "separate G6 receiving-bank/retention pilot approval",
        ],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Blocked as exc:
        print("MIGRATION_PLAN=BLOCKED: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
