"""StatMedX backend configuration."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
DATA_DIR = BASE_DIR / "data"                                # uploaded datasets (pickled DataFrames)
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("STATMEDX_DB", f"sqlite:///{BASE_DIR / 'statmedx.db'}")
SECRET_KEY = os.getenv("STATMEDX_SECRET", "statmedx-dev-secret-change-in-production")
TOKEN_EXPIRE_HOURS = 72

CORS_ORIGINS = ["*"]  # dev mode; tighten for production deployment

MAX_DATASET_MB = 100
