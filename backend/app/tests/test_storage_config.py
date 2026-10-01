"""Persistent storage path configuration tests."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def test_storage_dir_redirects_database_and_uploads(tmp_path: Path):
    backend_dir = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env.pop("STATMEDX_DB", None)
    env["STATMEDX_STORAGE_DIR"] = str(tmp_path)
    env["STATMEDX_SECRET"] = "test-only-secret"
    probe = (
        "import json; from app.config import DATA_DIR, DATABASE_URL; "
        "print(json.dumps({'data_dir': str(DATA_DIR), 'database_url': DATABASE_URL}))"
    )

    completed = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=backend_dir,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    paths = json.loads(completed.stdout)

    assert Path(paths["data_dir"]) == tmp_path / "data"
    assert paths["database_url"] == f"sqlite:///{tmp_path / 'statmedx.db'}"
    assert (tmp_path / "data").is_dir()
