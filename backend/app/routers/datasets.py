"""Dataset endpoints: CRUD, upload, paste, data page reads, cell edits,
transformations (generate/recode/filter/sort/missing/duplicates), variable view, export."""
from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth_utils import get_current_user
from ..database import get_db
from ..models import Dataset, User, Variable
from ..services import dataio
from ..services.export_service import export as export_result

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


class DatasetOut(BaseModel):
    id: int
    name: str
    description: str
    n_rows: int
    n_cols: int
    source_format: str


def _own(db: Session, user: User, dsid: int) -> Dataset:
    ds = db.get(Dataset, dsid)
    if ds is None or (ds.owner_id != user.id):
        raise HTTPException(404, "Dataset not found")
    return ds


def _out(ds: Dataset) -> dict:
    return {"id": ds.id, "name": ds.name, "description": ds.description,
            "n_rows": ds.n_rows, "n_cols": ds.n_cols, "source_format": ds.source_format}


@router.get("")
def list_datasets(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    dss = db.query(Dataset).filter(Dataset.owner_id == user.id).order_by(Dataset.id.desc()).all()
    return [_out(d) for d in dss]


@router.post("/upload")
def upload(file: UploadFile = File(...), name: str = Form(""), description: str = Form(""),
           db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    payload = file.file.read()
    df, fmt = dataio.read_upload(file.filename or "data.csv", payload)
    df = dataio.clean_columns(df)
    ds = Dataset(owner_id=user.id, name=name or file.filename, description=description,
                 n_rows=len(df), n_cols=len(df.columns), source_format=fmt)
    db.add(ds)
    db.commit()
    db.refresh(ds)
    dataio.save_df(ds.id, df)
    dataio.sync_variables(db, ds, df)
    db.commit()
    return _out(ds)


class PasteIn(BaseModel):
    text: str
    sep: str = "auto"
    name: str = "Pasted data"


@router.post("/paste")
def paste(body: PasteIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        df = dataio.parse_paste(body.text, body.sep)
    except Exception as e:
        raise HTTPException(400, f"Could not parse pasted data: {e}")
    df = dataio.clean_columns(df)
    if df.empty:
        raise HTTPException(400, "No data found")
    ds = Dataset(owner_id=user.id, name=body.name, description="Created by pasting data",
                 n_rows=len(df), n_cols=len(df.columns), source_format="paste")
    db.add(ds)
    db.commit()
    db.refresh(ds)
    dataio.save_df(ds.id, df)
    dataio.sync_variables(db, ds, df)
    db.commit()
    return _out(ds)


@router.get("/{dsid}")
def get_dataset(dsid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ds = _own(db, user, dsid)
    d = _out(ds)
    d["meta"] = ds.meta or {}
    return d


@router.delete("/{dsid}")
def delete_dataset(dsid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ds = _own(db, user, dsid)
    db.delete(ds)
    db.commit()
    dataio.df_path(dsid).unlink(missing_ok=True)
    return {"ok": True}


@router.get("/{dsid}/data")
def get_data(dsid: int, page: int = 1, size: int = 50,
             db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ds = _own(db, user, dsid)
    df = dataio.load_df(ds)
    size = max(10, min(size, 500))
    start = max(0, (page - 1) * size)
    chunk = df.iloc[start:start + size]
    cols = [{"name": c, "type": dataio.infer_type(df[c])} for c in df.columns]
    return {
        "columns": cols,
        "rows": dataio.df_to_records(chunk),
        "row_start": start,
        "total": len(df),
        "n_cols": len(df.columns),
        "page": start // size + 1,
        "page_size": size,
    }


@router.get("/{dsid}/variables")
def get_variables(dsid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ds = _own(db, user, dsid)
    return [{"id": v.id, "position": v.position, "name": v.name, "label": v.label,
             "type": v.vtype, "missing_codes": v.missing_codes or [],
             "value_labels": v.value_labels or {}, "is_categorical": v.is_categorical}
            for v in sorted(ds.variables, key=lambda x: x.position)]


class VariableUpdate(BaseModel):
    name: str | None = None
    label: str | None = None
    is_categorical: bool | None = None


@router.patch("/{dsid}/variables/{varname}")
def update_variable(dsid: int, varname: str, body: VariableUpdate,
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ds = _own(db, user, dsid)
    v = db.query(Variable).filter(Variable.dataset_id == ds.id, Variable.name == varname).first()
    if not v:
        raise HTTPException(404, "Variable not found")
    df = dataio.load_df(ds)
    renamed = None
    if body.name and body.name != varname:
        newname = body.name.strip().replace(" ", "_")
        if not newname or newname in df.columns:
            raise HTTPException(400, "Invalid or duplicate variable name")
        df = df.rename(columns={varname: newname})
        v.name = newname
        renamed = newname
    if body.label is not None:
        v.label = body.label
    if body.is_categorical is not None:
        v.is_categorical = body.is_categorical
    dataio.save_df(ds.id, df)
    db.commit()
    return {"ok": True, "renamed_to": renamed}


class CellEdit(BaseModel):
    row: int
    column: str
    value: str | float | int | None


class DatasetReplace(BaseModel):
    columns: list[str]
    rows: list[list[object]]


@router.put("/{dsid}/data")
def replace_dataset_data(dsid: int, body: DatasetReplace,
                         db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Replace dataset contents from a locally edited offline dataset."""
    ds = _own(db, user, dsid)
    if not body.columns or any(len(row) != len(body.columns) for row in body.rows):
        raise HTTPException(400, "Dataset columns and rows do not match")
    df = pd.DataFrame(body.rows, columns=body.columns)
    preserve = {v.name: v for v in ds.variables}
    dataio.save_df(ds.id, df)
    ds.n_rows, ds.n_cols = len(df), len(df.columns)
    dataio.sync_variables(db, ds, df, preserve=preserve)
    db.commit()
    return _out(ds)


@router.post("/{dsid}/cell")
def edit_cell(dsid: int, body: CellEdit, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ds = _own(db, user, dsid)
    df = dataio.load_df(ds)
    if body.column not in df.columns:
        raise HTTPException(400, "Unknown column")
    if body.row < 0 or body.row >= len(df):
        raise HTTPException(400, "Row out of range")
    cur = df[body.column]
    try:
        if body.value is None or body.value == "":
            df.loc[df.index[body.row], body.column] = None
        elif pd.api.types.is_numeric_dtype(cur):
            df.loc[df.index[body.row], body.column] = float(body.value)
        else:
            df.loc[df.index[body.row], body.column] = str(body.value)
    except (ValueError, TypeError):
        raise HTTPException(400, f"Value does not fit column type ({cur.dtype})")
    dataio.save_df(ds.id, df)
    return {"ok": True}


class TransformIn(BaseModel):
    op: str
    params: dict = {}


@router.post("/{dsid}/transform")
def transform(dsid: int, body: TransformIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ds = _own(db, user, dsid)
    df = dataio.load_df(ds)
    p = body.params
    msg = "OK"

    try:
        if body.op == "add_variable":
            name = str(p.get("name", "")).strip().replace(" ", "_")
            if not name:
                raise ValueError("Variable name required")
            if name in df.columns:
                raise ValueError(f"'{name}' already exists")
            init = p.get("value", "")
            try:
                df[name] = pd.to_numeric(pd.Series([init] * len(df)), errors="coerce") \
                    if str(init).replace(".", "", 1).replace("-", "", 1).isdigit() else str(init)
            except Exception:
                df[name] = str(init)
            msg = f"Added variable {name}"

        elif body.op == "add_row":
            blank = pd.DataFrame({c: [None] for c in df.columns})
            df = pd.concat([df, blank], ignore_index=True)
            msg = "Added 1 case"

        elif body.op == "delete_variable":
            df = df.drop(columns=[p["name"]])
            msg = f"Deleted variable {p['name']}"

        elif body.op == "delete_rows":
            idx = [int(i) for i in p.get("indices", [])]
            df = df.drop(index=df.index[idx]).reset_index(drop=True)
            msg = f"Deleted {len(idx)} case(s)"

        elif body.op == "sort":
            cols = p["variables"]
            df = df.sort_values(cols, ascending=bool(p.get("ascending", True))).reset_index(drop=True)
            msg = f"Sorted by {', '.join(cols)}"

        elif body.op == "filter":
            mask = df.eval(p["condition"])
            before = len(df)
            df = df[mask.fillna(False)] if hasattr(mask, "fillna") else df[mask]
            msg = f"Filter kept {len(df)} of {before} rows (dataset trimmed — use Filter in analysis for non-destructive filtering)"

        elif body.op == "generate":
            name = p["name"].strip().replace(" ", "_")
            df[name] = df.eval(p["expression"])
            msg = f"Generated {name}"

        elif body.op == "recode":
            s = df[p["variable"]]
            out = s.copy()
            for rule in p.get("rules", []):
                old, new = rule.get("old"), rule.get("new")
                try:
                    newv = float(new) if new is not None and new != "" else None
                except ValueError:
                    newv = new
                if isinstance(old, str) and "/" in old:
                    lo_s, hi_s = old.split("/", 1)
                    num_s = pd.to_numeric(s, errors="coerce")
                    lo = -float("inf") if lo_s.strip().lower() in ("min", "lo") else float(lo_s)
                    hi = float("inf") if hi_s.strip().lower() in ("max", "hi") else float(hi_s)
                    out[(num_s >= lo) & (num_s <= hi)] = newv
                elif old == "" or old is None:
                    out[s.isna()] = newv
                else:
                    try:
                        oldv = float(old)
                        out[pd.to_numeric(s, errors="coerce") == oldv] = newv
                    except (ValueError, TypeError):
                        out[s.astype(str) == str(old)] = newv
            target = p.get("generate_as") or p["variable"]
            df[target] = out
            msg = f"Recoded into {target}"

        elif body.op == "set_missing":
            v = db.query(Variable).filter(Variable.dataset_id == ds.id, Variable.name == p["name"]).first()
            codes = [c for c in (p.get("codes") or []) if str(c) != ""]
            if v:
                v.missing_codes = codes
                msg = f"Missing codes for {p['name']}: {codes}"
            code_vals = []
            for c in codes:
                try:
                    code_vals.append(float(c))
                except ValueError:
                    code_vals.append(c)
            if code_vals:
                df[p["name"]] = df[p["name"]].replace(code_vals, None)
            msg += " — codes converted to missing"

        elif body.op == "impute_missing":
            how = p.get("method", "mean")
            names = p.get("variables") or [p["name"]]
            if how not in {"mean", "median", "zero"}:
                raise HTTPException(400, "Choose mean, median, or zero imputation.")
            summaries = []
            for name in names:
                if name not in df.columns:
                    raise HTTPException(400, f"Unknown variable: {name}")
                s = pd.to_numeric(df[name], errors="coerce")
                fill = s.mean() if how == "mean" else s.median() if how == "median" else 0
                n = int(s.isna().sum())
                df[name] = s.fillna(fill)
                summaries.append(f"{name}: {n} ({round(fill, 4)})")
            msg = f"Imputed missing value(s) using {how} — " + ", ".join(summaries)

        elif body.op == "drop_missing":
            cols = p.get("variables") or list(df.columns)
            unknown = [name for name in cols if name not in df.columns]
            if unknown:
                raise HTTPException(400, f"Unknown variable(s): {', '.join(unknown)}")
            if not cols:
                raise HTTPException(400, "Select at least one column to check for missing values.")
            before = len(df)
            df = df.dropna(subset=cols).reset_index(drop=True)
            msg = f"Dropped {before - len(df)} rows with missing values"

        elif body.op == "dedupe":
            before = len(df)
            subset = p.get("variables") or None
            if p.get("mode") == "report":
                dupmask = df.duplicated(subset=subset, keep=False)
                from ..services.dataio import df_to_records
                dups = df[dupmask].head(200)
                return {"ok": True, "message": f"{int(dupmask.sum())} rows in duplicate groups "
                                               f"({int(df.duplicated(subset=subset).sum())} redundant)",
                        "duplicates": df_to_records(dups), "n_rows": len(df), "n_cols": len(df.columns)}
            df = df.drop_duplicates(subset=subset).reset_index(drop=True)
            msg = f"Removed {before - len(df)} duplicate rows"

        elif body.op == "rename_variable":
            old, new = p["old"], p["new"].strip().replace(" ", "_")
            if new in df.columns:
                raise ValueError("Name already exists")
            df = df.rename(columns={old: new})
            msg = f"Renamed {old} → {new}"

        elif body.op == "export_dataset":
            fmt = p.get("format", "csv")
            if fmt == "excel":
                data = export_result({"title": ds.name, "blocks": [
                    {"type": "table", "name": ds.name,
                     "columns": [{"key": c, "label": c} for c in df.columns],
                     "rows": dataio.df_to_records(df)}]}, "excel")
            else:
                data = (df.to_csv(index=False).encode(), "text/csv", "csv")
            from fastapi import Response
            content, media, ext = data
            return Response(content, media_type=media,
                            headers={"Content-Disposition": f"attachment; filename={ds.name}.{ext}"})
        else:
            raise ValueError(f"Unknown operation '{body.op}'")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))

    # persist
    preserve = {v.name: v for v in ds.variables}
    dataio.save_df(ds.id, df)
    ds.n_rows, ds.n_cols = len(df), len(df.columns)
    dataio.sync_variables(db, ds, df, preserve=preserve)
    db.commit()
    return {"ok": True, "message": msg, "n_rows": len(df), "n_cols": len(df.columns)}
