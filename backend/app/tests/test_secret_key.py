"""Security regression tests — JWT secret handling (app/config.py).

The old code fell back to a hardcoded, publicly-known string
("statmedx-dev-secret-change-in-production") whenever STATMEDX_SECRET was
unset — allowing anyone to forge valid JWTs for any user id (full account
takeover). Now:

  • production (STATMEDX_ENV=production) without a secret  → refuses to start
  • dev without a secret  → fresh random 32-byte ephemeral secret + warning
  • explicit STATMEDX_SECRET  → used verbatim, no warning

Each scenario is evaluated in a clean subprocess so environment variables
cannot leak into (or be polluted by) the running test process.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _run_config_snippet(env_extra: dict) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k != "STATMEDX_SECRET"}
    env.update(env_extra)
    return subprocess.run(
        [sys.executable, "-c", "from app import config; print('SECRET:', config.SECRET_KEY)"],
        env=env, capture_output=True, text=True, cwd=BACKEND_DIR, timeout=60,
    )


def test_production_without_secret_refuses_to_start():
    r = _run_config_snippet({"STATMEDX_ENV": "production"})
    assert r.returncode != 0, "config must raise in production without STATMEDX_SECRET"
    assert "STATMEDX_SECRET" in r.stderr
    assert "Refusing to start" in r.stderr


def test_dev_without_secret_generates_random_ephemeral_secret_with_warning():
    r = _run_config_snippet({"STATMEDX_ENV": "dev"})
    assert r.returncode == 0, r.stderr
    m = re.search(r"SECRET: ([0-9a-f]+)", r.stdout)
    assert m, r.stdout + r.stderr
    assert len(m.group(1)) == 64  # token_hex(32)
    assert "ephemeral dev secret" in r.stderr

    # ephemeral → different secret on every process start
    r2 = _run_config_snippet({"STATMEDX_ENV": "dev"})
    m2 = re.search(r"SECRET: ([0-9a-f]+)", r2.stdout)
    assert m2 and m2.group(1) != m.group(1)


def test_explicit_secret_is_used_verbatim_without_warning():
    r = _run_config_snippet({"STATMEDX_ENV": "production", "STATMEDX_SECRET": "super-secret-value"})
    assert r.returncode == 0, r.stderr
    assert "SECRET: super-secret-value" in r.stdout
    assert "ephemeral" not in r.stderr  # no warning when configured

    r = _run_config_snippet({"STATMEDX_SECRET": "dev-explicit"})
    assert r.returncode == 0 and "SECRET: dev-explicit" in r.stdout
    assert "ephemeral" not in r.stderr


def test_no_hardcoded_secret_anywhere_in_source():
    """The dangerous default string must be gone from the codebase
    (excluding this test file, which necessarily mentions it)."""
    hits = []
    for root, _dirs, files in os.walk(os.path.join(BACKEND_DIR, "app")):
        for fn in files:
            if fn.endswith(".py") and fn != "test_secret_key.py":
                with open(os.path.join(root, fn), encoding="utf-8") as fh:
                    if "statmedx-dev-secret-change-in-production" in fh.read():
                        hits.append(fn)
    assert hits == [], f"hardcoded secret still present in: {hits}"
