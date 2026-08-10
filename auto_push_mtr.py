#!/usr/bin/env python3
import os
import time
import subprocess
from datetime import datetime
from zoneinfo import ZoneInfo

REPO = "/mnt/c/Users/Nary/PY_Project/MTR"
TARGET = os.path.join(REPO, "index.html")
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


def commit_and_push():
    run_git("add", "index.html")
    diff = run_git("diff", "--cached", "--quiet")
    if diff.returncode == 0:
        return
    ts = datetime.now(ZoneInfo("Asia/Hong_Kong")).strftime("%Y-%m-%d %H:%M:%S HKT")
    msg = f"Auto update index.html {ts}"
    commit = run_git("commit", "-m", msg)
    if commit.returncode != 0:
        log(commit.stderr.strip() or "commit failed")
        return
    push = run_git("push", "origin", "main")
    if push.returncode != 0:
        log(push.stderr.strip() or "push failed")
    else:
        log("push ok")


def main():
    if not os.path.exists(TARGET):
        log(f"missing file: {TARGET}")
        return

    last = file_sig(TARGET)
    log("watching index.html changes")

    while True:
        time.sleep(POLL_SECONDS)
        current = file_sig(TARGET)
        if current is None:
            continue
        if current != last:
            last = current
            time.sleep(DEBOUNCE_SECONDS)
            commit_and_push()


if __name__ == "__main__":
    main()
