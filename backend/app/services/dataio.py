"""Dataset IO: read CSV / Excel / TXT / TSV / Stata .dta / SPSS .sav, paste parsing,
DataFrame persistence (pickle), variable metadata sync."""
from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..config import DATA_DIR, MAX_DATASET_MB
from ..models import Dataset, Variable

SUPPORTED = {
    ".csv": "csv", ".txt": "txt", ".tsv": "tsv", ".xlsx": "excel", ".xls": "excel",
    ".dta": "stata", ".sav": "spss", ".zsav": "spss",
}


def df_path(dataset_id: int | str) -> Path:
    return DATA_DIR / f"ds_{dataset_id}.df"


def save_df(dataset_id: int | str, df: pd.DataFrame) -> None:
    df.to_pickle(df_path(dataset_id))


def load_df(dataset: Dataset) -> pd.DataFrame:
    p = df_path(dataset.id)
    if not p.exists():
        raise HTTPException(404, "Dataset data file missing")
    return pd.read_pickle(p)


def infer_type(series: pd.Series) -> str:
    if pd.api.types.is_integer_dtype(series):
        return "int"
    if pd.api.types.is_bool_dtype(series):
        return "int"
    if pd.api.types.is_numeric_dtype(series):
        return "float"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "date"
    return "string"


def parse_paste(text: str, sep: str = "auto") -> pd.DataFrame:
    sep_map = {"tab": "\t", "comma": ",", "semicolon": ";", "space": r"\s+"}
    if sep == "auto":
        first = text.strip().splitlines()[0] if text.strip() else ""
        if "\t" in first:
            use = "\t"
        elif ";" in first:
            use = ";"
        else:
            use = ","
    else:
        use = sep_map.get(sep, ",")
    return pd.read_csv(io.StringIO(text), sep=use, engine="python")


def read_upload(filename: str, payload: bytes) -> tuple[pd.DataFrame, str]:
    ext = Path(filename).suffix.lower()
    fmt = SUPPORTED.get(ext)
    if fmt is None:
        raise HTTPException(400, f"Unsupported file type '{ext}'. Supported: CSV, TXT, TSV, Excel, Stata .dta, SPSS .sav")
    if len(payload) > MAX_DATASET_MB * 1024 * 1024:
        raise HTTPException(400, f"File larger than {MAX_DATASET_MB} MB")
    try:
        if fmt in ("csv", "txt", "tsv"):
            sep = "," if fmt == "csv" else "\t"
            df = pd.read_csv(io.BytesIO(payload), sep=sep, engine="python", na_values=["", "NA", "N/A", ".", "na", "NaN"])
        elif fmt == "excel":
            df = pd.read_excel(io.BytesIO(payload))
        elif fmt == "stata":
            df = pd.read_stata(io.BytesIO(payload))
        else:  # spss
            import pyreadstat
            df, _ = pyreadstat.read_sav(io.BytesIO(payload))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Could not parse file: {e}")
    if df.empty:
        raise HTTPException(400, "File contains no data rows")
    return df, fmt


def clean_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Unique, non-empty, python-safe column names."""
    cols, seen = [], {}
    for i, c in enumerate(df.columns):
        name = str(c).strip().replace(" ", "_") or f"var{i+1}"
        if name in seen:
            seen[name] += 1
            name = f"{name}_{seen[name]}"
        else:
            seen[name] = 0
        cols.append(name)
    df.columns = cols
    return df


def sync_variables(db: Session, dataset: Dataset, df: pd.DataFrame, preserve: dict[str, Variable] | None = None):
    """Rebuild Variable View rows to match current DataFrame columns."""
    preserve = preserve or {}
    for v in list(dataset.variables):
        db.delete(v)
    db.flush()
    for i, col in enumerate(df.columns):
        s = df[col]
        old = preserve.get(col)
        uniq = s.dropna().unique()
        v = Variable(
            dataset_id=dataset.id,
            position=i,
            name=col,
            label=(old.label if old else ""),
            vtype=infer_type(s),
            missing_codes=(old.missing_codes if old else []),
            value_labels=(old.value_labels if old and old.value_labels else {}),
            is_categorical=bool(old.is_categorical) if old else (
                (infer_type(s) in ("string", "int") and len(uniq) <= 15)
            ),
        )
        db.add(v)


def df_to_records(df: pd.DataFrame, max_rows: int | None = None):
    """JSON-safe records with NaN -> None."""
    out = df.copy()
    for c in out.columns:
        if pd.api.types.is_datetime64_any_dtype(out[c]):
            out[c] = out[c].astype(str).replace("NaT", None)
    out = out.replace({np.nan: None})
    if max_rows is not None:
        out = out.head(max_rows)
    return out.values.tolist()
