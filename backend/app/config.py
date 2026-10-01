"""StatMedX backend configuration."""
import os
import secrets
import warnings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
# Set STATMEDX_STORAGE_DIR to the Render disk mount (for example /var/data)
# to keep both the SQLite database and uploaded dataset files across restarts.
STORAGE_DIR = Path(os.getenv("STATMEDX_STORAGE_DIR", str(BASE_DIR)))
DATA_DIR = Path(os.getenv("STATMEDX_DATA_DIR", str(STORAGE_DIR / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("STATMEDX_DB", f"sqlite:///{STORAGE_DIR / 'statmedx.db'}")

# --- JWT signing secret ---------------------------------------------------
# Never ship a hardcoded fallback: a publicly-known secret lets anyone forge
# a valid JWT for any user id (full account takeover). In production the app
# REFUSES to start without STATMEDX_SECRET; in dev an ephemeral random secret
# is generated per process (sessions reset on restart — expected in dev).
SECRET_KEY = os.getenv("STATMEDX_SECRET")
if not SECRET_KEY:
    if os.getenv("STATMEDX_ENV", "dev").lower() == "production":
        raise RuntimeError(
            "STATMEDX_SECRET environment variable must be set in production. "
            "Refusing to start with no secret configured."
        )
    SECRET_KEY = secrets.token_hex(32)
    warnings.warn(
        "STATMEDX_SECRET not set — using a random ephemeral dev secret "
        "(all sessions will be invalidated on restart). Set STATMEDX_SECRET "
        "before deploying.",
        stacklevel=2,
    )
# ---------------------------------------------------------------------------

TOKEN_EXPIRE_HOURS = 72

CORS_ORIGINS = ["*"]  # dev mode; tighten for production deployment

MAX_DATASET_MB = 100
