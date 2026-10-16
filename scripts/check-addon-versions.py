#!/usr/bin/env python3
"""Reject staged userscript edits without newer versions and matching markers.

Enable once for local commits: git config core.hooksPath .githooks
No GitHub Actions or Rust dependency needed.
"""
import re
import subprocess
import sys

META = re.compile(r"(?m)^// @version\s+([0-9]+(?:\.[0-9]+)+)\s*$")

def git(*args):
    return subprocess.run(["git", *args], stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=False)

def version(blob):
    match = META.search(blob.decode("utf-8"))
    if match is None:
        raise ValueError("missing or invalid @version")
    return match.group(1)

def parts(value):
    return tuple(int(part) for part in value.split("."))

def main():
    staged = git("diff", "--cached", "--name-only", "--diff-filter=ACM", "--", "addons")
    if staged.returncode:
        print(staged.stderr.decode(), file=sys.stderr)
        return 1
    failed = False
    for path in staged.stdout.decode().splitlines():
        if not re.fullmatch(r"addons/[^/]+\\.user\\.js", path):
            continue
        new = git("show", ":" + path)
        old = git("show", "HEAD:" + path)
        if new.returncode:
            print(f"{path}: cannot read staged script", file=sys.stderr)
            failed = True
            continue
        try:
            current = version(new.stdout)
            if old.returncode == 0 and parts(current) <= parts(version(old.stdout)):
                raise ValueError("changed script must increase @version")
            key = path.removeprefix("addons/").removesuffix(".user.js")
            marker = f"setAttribute('data-moth-addon-version-{key}', '{current}')".encode()
            if marker not in new.stdout:
                raise ValueError("DOM version marker does not match @version")
        except (UnicodeDecodeError, ValueError) as error:
            print(f"{path}: {error}", file=sys.stderr)
            failed = True
    if failed:
        print("Bump @version and the addon marker before committing.", file=sys.stderr)
    return int(failed)

if __name__ == "__main__":
    raise SystemExit(main())
