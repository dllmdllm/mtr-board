#!/usr/bin/env python3
import os
import time
import subprocess
from datetime import datetime
from zoneinfo import ZoneInfo

REPO = "/mnt/c/Users/Nary/PY_Project/MTR"
TARGETS = ("index.html", "styles.css", "config.js", "api.js", "favorites.js", "service-news.js", "app.js")
POLL_SECONDS = 1
DEBOUNCE_SECONDS = 0.6


def file_sig(path):
    try:
        st = os.stat(path)
        return (st.st_mtime_ns, st.st_size)
    except FileNotFoundError:
        return None


def run_git(*args):
    return subprocess.run(
        ["git", "-C", REPO, *args],
        capture_output=True,
        text=True,
    )


def log(msg):
    ts = datetime.now(ZoneInfo("Asia/Hong_Kong")).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def checked_git(*args):
    result = run_git(*args)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"git {args[0]} failed")
    return result.stdout


def require_safe_index():
    root = checked_git("rev-parse", "--show-toplevel").strip()
    if os.path.realpath(root) != os.path.realpath(REPO):
        raise RuntimeError("configured directory is not the repository root")
    if checked_git("symbolic-ref", "--short", "HEAD").strip() != "main":
        raise RuntimeError("refusing publication outside main")
    if checked_git("diff", "--name-only", "--diff-filter=U", "-z"):
        raise RuntimeError("unresolved files require manual review")
    staged = checked_git("diff", "--cached", "--name-only", "--no-renames", "-z").split("\0")
    if any(name and name not in TARGETS for name in staged):
        raise RuntimeError("unrelated staged files require manual review")


def commit_and_push():
    try:
        require_safe_index()
        base = checked_git("rev-parse", "--verify", "HEAD").strip()
        remote_base = checked_git("rev-parse", "--verify", "refs/remotes/origin/main").strip()
        if base != remote_base:
            raise RuntimeError("local commits or divergence require manual review")
        paths = [name for name in checked_git("ls-files", "-z", "--", *TARGETS).split("\0") if name]
        if not paths or any(name not in TARGETS for name in paths):
            raise RuntimeError("no verified project files")
        checked_git("add", "--all", "--", *paths)
        require_safe_index()
        diff = run_git("diff", "--cached", "--quiet", "--", *paths)
        if diff.returncode == 0:
            return False
        if diff.returncode != 1:
            raise RuntimeError(diff.stderr.strip() or "cannot verify staged changes")
        if checked_git("rev-parse", "--verify", "HEAD").strip() != base:
            raise RuntimeError("HEAD changed during preparation")
        ts = datetime.now(ZoneInfo("Asia/Hong_Kong")).strftime("%Y-%m-%d %H:%M:%S HKT")
        # A path-limited commit cannot absorb another writer's unrelated index entries.
        checked_git("commit", "--only", "-m", f"Auto update MTR board {ts}", "--", *paths)
        require_safe_index()
        revision = checked_git("rev-parse", "--verify", "HEAD").strip()
        if checked_git("rev-parse", "HEAD^").strip() != base:
            raise RuntimeError("unexpected commit history; manual review required")
        changed = checked_git("diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", revision).split("\0")
        if any(name and name not in TARGETS for name in changed):
            raise RuntimeError("unexpected committed files; manual review required")
        checked_git("push", "origin", f"{revision}:refs/heads/main")
        log("push ok")
        return True
    except RuntimeError as error:
        log(str(error))
        return False


def project_signature():
    return tuple(file_sig(os.path.join(REPO, name)) for name in TARGETS)


def main():
    if not os.path.isfile(os.path.join(REPO, "index.html")):
        log("missing index.html")
        return

    last = project_signature()
    log("watching MTR HTML, JavaScript and CSS changes")

    while True:
        time.sleep(POLL_SECONDS)
        current = project_signature()
        if current != last:
            last = current
            time.sleep(DEBOUNCE_SECONDS)
            commit_and_push()


if __name__ == "__main__":
    main()
