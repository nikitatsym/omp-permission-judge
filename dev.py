#!/usr/bin/env python3
"""Repository entry point: `lint`, `test`, `e2e`, `check` (lint + test, the pre-commit and CI gate), `hook`.

Needs bun and uv on PATH.
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INSTALL = ["bun", "install", "--frozen-lockfile"]
LINT = [
    INSTALL,
    ["bun", "x", "tsc", "--noEmit"],
    ["uvx", "tackbox@latest", "lint", "."],
]
TEST = [INSTALL, ["bun", "test"]]


def run_all(commands):
    for command in commands:
        code = subprocess.run(command, cwd=ROOT, check=False).returncode
        if code:
            return code
    return 0


def hook():
    return subprocess.run(["git", "config", "core.hooksPath", ".githooks"], cwd=ROOT, check=False).returncode


def main(name):
    if name == "lint":
        return run_all(LINT)
    if name == "test":
        return run_all(TEST)
    if name == "e2e":
        print("no e2e tests found")
        return 0
    if name == "check":
        return run_all(LINT) or run_all(TEST)
    if name == "hook":
        return hook()
    print(f"unknown command {name!r}; use lint, test, e2e, check or hook", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "check"))
