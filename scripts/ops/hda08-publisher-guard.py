"""Pure guard and manifest producer for the proposed POS publisher bootstrap."""
import json
import os
import re
import sys

COMPONENTS = ("api", "customer", "merchant", "admin")


def require(ok):
    if not ok:
        raise ValueError("POS autonomous publisher refused")


def context(env):
    def positive(key):
        value = env.get(key, "")
        require(re.fullmatch(r"[1-9][0-9]{0,17}", value))
        return int(value)
    require(env.get("HDA_ENABLED") == "true"
            and env.get("GITHUB_REPOSITORY") == "yiwssx/rcat-pos-system"
            and env.get("GITHUB_REPOSITORY_ID") == "1442358980"
            and env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and env.get("GITHUB_REF") == "refs/heads/main"
            and env.get("GITHUB_RUN_ATTEMPT") == "1"
            and env.get("GITHUB_ACTOR") == env.get("GITHUB_TRIGGERING_ACTOR")
            and env.get("GITHUB_ACTOR", "").endswith("[bot]")
            and positive("GITHUB_ACTOR_ID") == positive("HDA_PUBLISHER_ID")
            and positive("GITHUB_ACTOR_ID") not in (48784420, 354878936, 354372345)
            and re.fullmatch(r"[0-9a-f]{40}", env.get("GITHUB_SHA", ""))
            and env["GITHUB_SHA"] == env.get("HDA_EXPECTED_SHA")
            and re.fullmatch(r"sha256:[0-9a-f]{64}", env.get("HDA_REQUEST_DIGEST", "")))
    return dict(kind="rcat.pos.publication.manifest.v1", repository_id=1442358980,
                source=env["GITHUB_SHA"], workflow=".github/workflows/onprem-staging.yml",
                publisher=positive("GITHUB_ACTOR_ID"), request_digest=env["HDA_REQUEST_DIGEST"],
                run_id=positive("GITHUB_RUN_ID"), run_attempt=1)


def guard(env, runs):
    bound = context(env)
    rows = runs.get("workflow_runs")
    require(type(rows) is list and 0 < len(rows) <= 100
            and type(runs.get("total_count")) is int and runs["total_count"] == len(rows))
    current = int(env["GITHUB_RUN_NUMBER"])
    found = 0
    for row in rows:
        require(row.get("head_sha") == bound["source"] and row.get("event") == "workflow_dispatch"
                and row.get("head_branch") == "main" and type(row.get("run_number")) is int
                and type(row.get("id")) is int)
        if row["id"] == bound["run_id"]:
            require(row["run_number"] == current and row.get("run_attempt") == 1)
            found += 1
        else:
            require(row["run_number"] > current)
    require(found == 1)


def manifest(env):
    result = context(env)
    digests = {name: env.get("HDA_DIGEST_" + name.upper(), "") for name in COMPONENTS}
    require(all(re.fullmatch(r"sha256:[0-9a-f]{64}", d) for d in digests.values())
            and len(set(digests.values())) == 4)
    return dict(result, digests=digests)


if __name__ == "__main__":
    if sys.argv[1:] == ["guard"]:
        guard(os.environ, json.load(sys.stdin))
    elif sys.argv[1:] == ["manifest"]:
        print(json.dumps(manifest(os.environ), sort_keys=True, separators=(",", ":")))
    else:
        raise SystemExit("invalid fixed operation")
