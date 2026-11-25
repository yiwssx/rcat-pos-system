import runpy
from pathlib import Path
import unittest

G = runpy.run_path(str(Path(__file__).resolve().parents[2] / "scripts/ops/hda08-publisher-guard.py"))


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.env = dict(HDA_ENABLED="true", GITHUB_REPOSITORY="yiwssx/rcat-pos-system",
            GITHUB_REPOSITORY_ID="1442358980", GITHUB_EVENT_NAME="workflow_dispatch",
            GITHUB_REF="refs/heads/main", GITHUB_RUN_ATTEMPT="1", GITHUB_ACTOR="fixture[bot]",
            GITHUB_TRIGGERING_ACTOR="fixture[bot]", GITHUB_ACTOR_ID="222", HDA_PUBLISHER_ID="222",
            GITHUB_SHA="a"*40, HDA_EXPECTED_SHA="a"*40, HDA_REQUEST_DIGEST="sha256:"+"b"*64,
            GITHUB_RUN_ID="77", GITHUB_RUN_NUMBER="9")
        self.row = dict(id=77, run_number=9, run_attempt=1, head_sha="a"*40,
                        event="workflow_dispatch", head_branch="main")
        for i, name in enumerate(G["COMPONENTS"], 1):
            self.env["HDA_DIGEST_"+name.upper()] = "sha256:"+str(i)*64

    def test_valid(self):
        G["guard"](self.env, dict(total_count=1, workflow_runs=[self.row]))
        self.assertEqual(G["manifest"](self.env)["run_id"], 77)
        self.assertEqual(len(G["manifest"](self.env)["digests"]), 4)

    def test_disabled_wrong_actor_sha_or_attempt(self):
        for change in (dict(HDA_ENABLED="false"), dict(GITHUB_ACTOR_ID="333"),
            dict(HDA_EXPECTED_SHA="c"*40), dict(GITHUB_RUN_ATTEMPT="2"),
            dict(GITHUB_TRIGGERING_ACTOR="other"), dict(GITHUB_REF="refs/heads/dev"),
            dict(HDA_REQUEST_DIGEST="invalid"), dict(GITHUB_ACTOR_ID="354878936", HDA_PUBLISHER_ID="354878936")):
            with self.subTest(change=change), self.assertRaises(ValueError):
                G["manifest"](dict(self.env, **change))

    def test_prior_or_missing_run(self):
        for rows, count in (([self.row, dict(self.row, id=76, run_number=8)], 2),
                            ([self.row], 2), ([], 0), ([self.row, self.row], 2)):
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                G["guard"](self.env, dict(total_count=count, workflow_runs=rows))

    def test_digest_set(self):
        for value in ("latest", self.env["HDA_DIGEST_API"]):
            with self.assertRaises(ValueError):
                G["manifest"](dict(self.env, HDA_DIGEST_ADMIN=value))
