"""Disposable local Git fixtures; helper main is never run; commit/push are stubbed."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("mtr_helper", ROOT / "auto_push_mtr.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class PublicationGuards(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="mtr-helper-test-")
        self.addCleanup(self.directory.cleanup)
        self.repo = Path(self.directory.name)
        self.env = {**os.environ, "GIT_CONFIG_NOSYSTEM":"1", "GIT_CONFIG_GLOBAL":os.devnull,
                    "GIT_AUTHOR_NAME":"Fixture", "GIT_AUTHOR_EMAIL":"fixture@example.invalid",
                    "GIT_COMMITTER_NAME":"Fixture", "GIT_COMMITTER_EMAIL":"fixture@example.invalid"}
        self.git("init", "-b", "main")
        for name in helper.TARGETS:
            (self.repo / name).write_text("baseline\n")
        self.git("add", "--", *helper.TARGETS)
        # Fixture setup commit only. The helper's commit and push calls below are stubs.
        self.git("-c", "core.hooksPath=" + os.devnull, "commit", "-m", "fixture baseline")
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")
        self.base = self.git("rev-parse", "HEAD").stdout.strip()
        self.calls = []
        self.committed = False
        self.failure = None
        self.addCleanup(patch.stopall)
        patch.object(helper, "REPO", str(self.repo)).start()
        patch.object(helper, "run_git", self.stub_git).start()
        patch.object(helper, "log").start()

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.repo), *args], env=self.env,
                              capture_output=True, text=True, check=True)

    def stub_git(self, *args):
        self.calls.append(args)
        if self.failure == args[0]:
            return subprocess.CompletedProcess(args, 2, "", "injected failure")
        if args[0] == "commit":
            self.committed = True
            return subprocess.CompletedProcess(args, 0, "stub commit", "")
        if args[0] == "push":
            return subprocess.CompletedProcess(args, 0, "stub push", "")
        if self.committed and args == ("rev-parse", "--verify", "HEAD"):
            return subprocess.CompletedProcess(args, 0, "f" * 40 + "\n", "")
        if self.committed and args == ("rev-parse", "HEAD^"):
            return subprocess.CompletedProcess(args, 0, self.base + "\n", "")
        if self.committed and args[0] == "diff-tree":
            return subprocess.CompletedProcess(args, 0, "app.js\0", "")
        return subprocess.run(["git", "-C", str(self.repo), *args], env=self.env,
                              capture_output=True, text=True)

    def assert_no_publication(self):
        self.assertFalse(any(args[0] in ("commit", "push") for args in self.calls))

    def test_unrelated_staged_change_is_untouched(self):
        (self.repo / "private.txt").write_text("manual staged work\n")
        self.git("add", "private.txt")
        (self.repo / "app.js").write_text("new script\n")
        before = self.git("diff", "--cached", "--binary").stdout
        self.assertFalse(helper.commit_and_push())
        self.assert_no_publication()
        self.assertFalse(any(args[0] == "add" for args in self.calls))
        self.assertEqual(self.git("diff", "--cached", "--binary").stdout, before)

    def test_rename_from_unrelated_staged_path_is_rejected(self):
        self.git("mv", "app.js", "unrelated.js")
        self.assertFalse(helper.commit_and_push())
        self.assert_no_publication()

    def test_wrong_branch_and_detached_head_fail_before_staging(self):
        for args in [("switch", "-c", "manual-work"), ("checkout", "--detach")]:
            self.git(*args)
            self.calls.clear()
            self.assertFalse(helper.commit_and_push())
            self.assert_no_publication()
            self.assertFalse(any(call[0] == "add" for call in self.calls))

    def test_existing_local_commit_is_not_published(self):
        self.git("-c", "core.hooksPath=" + os.devnull, "commit", "--allow-empty", "-m", "manual local commit")
        self.assertFalse(helper.commit_and_push())
        self.assert_no_publication()
        self.git("update-ref", "-d", "refs/remotes/origin/main")
        self.assertFalse(helper.commit_and_push())
        self.assert_no_publication()

    def test_split_assets_are_watched_and_only_allowlisted_paths_are_committed(self):
        before = helper.project_signature()
        (self.repo / "app.js").write_text("new script\n")
        (self.repo / "styles.css").write_text("new styles\n")
        (self.repo / "unrelated.txt").write_text("leave untracked\n")
        self.assertNotEqual(before, helper.project_signature())
        self.assertTrue(helper.commit_and_push())
        for command in ["add", "commit"]:
            call = next(args for args in self.calls if args[0] == command)
            self.assertEqual(set(call[call.index("--") + 1:]), set(helper.TARGETS))
        self.assertIn("--only", next(args for args in self.calls if args[0] == "commit"))
        self.assertEqual(next(args for args in self.calls if args[0] == "push"),
                         ("push", "origin", "f" * 40 + ":refs/heads/main"))
        self.assertIn("?? unrelated.txt", self.git("status", "--short").stdout)

    def test_clean_tree_and_git_errors_do_not_publish(self):
        self.assertFalse(helper.commit_and_push())
        self.assert_no_publication()
        (self.repo / "app.js").write_text("new script\n")
        for command in ["add", "diff", "symbolic-ref", "rev-parse", "ls-files"]:
            self.calls.clear()
            self.failure = command
            self.assertFalse(helper.commit_and_push())
            self.assert_no_publication()

    def test_commit_error_never_pushes(self):
        (self.repo / "app.js").write_text("new script\n")
        self.failure = "commit"
        self.assertFalse(helper.commit_and_push())
        self.assertFalse(any(args[0] == "push" for args in self.calls))


if __name__ == "__main__":
    unittest.main()
