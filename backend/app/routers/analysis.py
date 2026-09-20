"""Analysis + results + command console endpoints."""
from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth_utils import get_current_user
from ..database import get_db
from ..models import AnalysisRun, CommandHistory, Dataset, User
from ..services import analyses, dataio
from ..services import command_parser
from ..services.export_service import export as export_result

router = APIRouter(prefix="/api", tags=["analysis"])


class RunIn(BaseModel):
    dataset_id: int
    module: str
    params: dict = {}


@router.post("/analysis")
def run_analysis(body: RunIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ds = db.get(Dataset, body.dataset_id)
    if ds is None or (ds.owner_id != user.id):
        raise HTTPException(404, "Dataset not found")
    df = dataio.load_df(ds)
    try:
        res = analyses.run(body.module, df, body.params)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Analysis error: {type(e).__name__}: {e}")
    run = AnalysisRun(user_id=user.id, dataset_id=ds.id, module=body.module,
                      title=res["title"], request_json={"module": body.module, "params": body.params},
                      result_json=res)
    db.add(run)
    db.commit()
    db.refresh(run)
    return {"id": run.id, "title": res["title"], "result": res}


class CommandIn(BaseModel):
    dataset_id: int
    command: str


@router.post("/commands")
def run_command(body: CommandIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ds = db.get(Dataset, body.dataset_id)
    if ds is None or (ds.owner_id != user.id):
        raise HTTPException(404, "Dataset not found")
    df = dataio.load_df(ds)
    ok = True
    try:
        res, new_df, mutated, _msg = command_parser.execute(ds, df, body.command)
    except ValueError as e:
        ok = False
        res = {"title": f"✗ {body.command}", "command": body.command,
               "blocks": [{"type": "text", "content": f"<b style='color:#dc2626'>error:</b> {e}"}]}
        new_df, mutated = df, False
    except Exception as e:
        ok = False
        res = {"title": f"✗ {body.command}", "command": body.command,
               "blocks": [{"type": "text", "content": f"<b style='color:#dc2626'>error:</b> {type(e).__name__}: {e}"}]}
        new_df, mutated = df, False
    if ok and res is None:
        res = {"title": "empty command", "command": body.command, "blocks": []}
    if mutated:
        preserve = {v.name: v for v in ds.variables}
        dataio.save_df(ds.id, new_df)
        ds.n_rows, ds.n_cols = len(new_df), len(new_df.columns)
        dataio.sync_variables(db, ds, new_df, preserve=preserve)
    db.add(CommandHistory(user_id=user.id, dataset_id=ds.id, command=body.command, ok=ok))
    db.commit()
    return {"result": res, "dataset": {"id": ds.id, "n_rows": ds.n_rows, "n_cols": ds.n_cols}}


@router.get("/commands/history")
def command_history(dataset_id: int | None = None, limit: int = 30,
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(CommandHistory).filter(CommandHistory.user_id == user.id)
    if dataset_id:
        q = q.filter(CommandHistory.dataset_id == dataset_id)
    return [c.command for c in q.order_by(CommandHistory.id.desc()).limit(min(limit, 100)).all()]


@router.get("/results")
def list_results(dataset_id: int | None = None, limit: int = 50,
                 db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(AnalysisRun).filter(AnalysisRun.user_id == user.id)
    if dataset_id:
        q = q.filter(AnalysisRun.dataset_id == dataset_id)
    return [{"id": r.id, "module": r.module, "title": r.title,
             "dataset_id": r.dataset_id, "created_at": str(r.created_at)}
            for r in q.order_by(AnalysisRun.id.desc()).limit(min(limit, 200)).all()]


@router.get("/results/{rid}")
def get_result(rid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = db.get(AnalysisRun, rid)
    if r is None or (r.user_id != user.id):
        raise HTTPException(404, "Result not found")
    return {"id": r.id, "module": r.module, "title": r.title, "result": r.result_json,
            "request": r.request_json, "created_at": str(r.created_at)}


@router.delete("/results/{rid}")
def delete_result(rid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = db.get(AnalysisRun, rid)
    if r is None or (r.user_id != user.id):
        raise HTTPException(404, "Result not found")
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.get("/results/{rid}/export")
def export_run(rid: int, format: str = "csv", db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = db.get(AnalysisRun, rid)
    if r is None or (r.user_id != user.id):
        raise HTTPException(404, "Result not found")
    try:
        content, media, ext = export_result(r.result_json, format)
    except ValueError as e:
        raise HTTPException(400, str(e))
    from fastapi import Response
    slug = "".join(ch if ch.isalnum() else "_" for ch in r.title)[:60] or "statmedx_result"
    return Response(content, media_type=media,
                    headers={"Content-Disposition": f"attachment; filename=statmedx_{rid}.{ext}"})


# ---- meta: variables list helper for form dropdowns ----
@router.get("/datasets/{dsid}/schema")
def dataset_schema(dsid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ds = db.get(Dataset, dsid)
    if ds is None or (ds.owner_id != user.id):
        raise HTTPException(404, "Dataset not found")
    df = dataio.load_df(ds)
    cols = []
    for c in df.columns:
        s = df[c]
        numeric = pd.api.types.is_numeric_dtype(s)
        cols.append({"name": c, "type": dataio.infer_type(s), "numeric": numeric,
                     "n_unique": int(s.nunique(dropna=True)),
                     "values": [str(v) for v in s.dropna().unique()[:25]] if (numeric is False or s.nunique() <= 15) else []})
    return {"name": ds.name, "n_rows": ds.n_rows, "n_cols": ds.n_cols, "columns": cols,
            "meta": ds.meta or {}}
