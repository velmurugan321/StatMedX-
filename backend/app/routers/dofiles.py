"""Module 12 — Do-file editor: saved command scripts, sequential execution."""
from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth_utils import get_current_user
from ..database import get_db
from ..models import CommandHistory, Dataset, DoFile, User
from ..services import command_parser, dataio

router = APIRouter(prefix="/api/dofiles", tags=["dofiles"])


class DoFileIn(BaseModel):
    name: str
    content: str


class DoFileUpdate(BaseModel):
    name: str | None = None
    content: str | None = None


class RunIn(BaseModel):
    dataset_id: int
    stop_on_error: bool = True


def _own(db: Session, user: User, fid: int) -> DoFile:
    f = db.get(DoFile, fid)
    if f is None or (f.user_id != user.id):
        raise HTTPException(404, "Do-file not found")
    return f


@router.get("")
def list_dofiles(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    files = db.query(DoFile).filter(DoFile.user_id == user.id).order_by(DoFile.id.desc()).all()
    return [{"id": f.id, "name": f.name, "content": f.content,
             "updated_at": str(f.updated_at)} for f in files]


@router.post("")
def create_dofile(body: DoFileIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    f = DoFile(user_id=user.id, name=body.name.strip() or "untitled.do", content=body.content)
    db.add(f)
    db.commit()
    db.refresh(f)
    return {"id": f.id, "name": f.name}


@router.put("/{fid}")
def update_dofile(fid: int, body: DoFileUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    f = _own(db, user, fid)
    if body.name is not None:
        f.name = body.name.strip() or f.name
    if body.content is not None:
        f.content = body.content
    db.commit()
    return {"ok": True}


@router.delete("/{fid}")
def delete_dofile(fid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    f = _own(db, user, fid)
    db.delete(f)
    db.commit()
    return {"ok": True}


def _preprocess(content: str) -> list[tuple[int, str]]:
    """Join `///` continuations, strip trailing `//` comments; return
    (original_line_no, command) pairs, dropping blanks and comments."""
    raw = content.splitlines()
    out: list[tuple[int, str]] = []
    buf, start = "", 0
    for idx, line in enumerate(raw, start=1):
        s = line.rstrip()
        if s.endswith("///"):
            if not buf:
                start = idx
            buf += s[:-3] + " "
            continue
        if buf:
            out.append((start, (buf + s).strip()))
            buf = ""
        else:
            out.append((idx, s.strip()))
    if buf:
        out.append((start, buf.strip()))
    cleaned = []
    for n, c in out:
        if not c or c.startswith("*") or c.startswith("//"):
            continue
        if " //" in c:  # trailing comment (requires whitespace before //)
            c = c.split(" //", 1)[0].strip()
            if not c:
                continue
        c = " ".join(c.split())  # collapse continuation whitespace
        cleaned.append((n, c))
    return cleaned


@router.post("/{fid}/run")
def run_dofile(fid: int, body: RunIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    f = _own(db, user, fid)
    ds = db.get(Dataset, body.dataset_id)
    if ds is None or (ds.owner_id != user.id):
        raise HTTPException(404, "Dataset not found")
    df = dataio.load_df(ds)
    steps = _preprocess(f.content)
    results = []
    mutated_any = False
    n_errors = 0
    for lineno, line in steps:
        if " //" in line:
            line = line.split(" //", 1)[0].strip()
            if not line:
                continue
        try:
            res, new_df, mutated, _ = command_parser.execute(ds, df, line)
        except Exception as e:
            n_errors += 1
            results.append({"line": lineno, "command": line, "ok": False,
                            "error": str(e) if isinstance(e, ValueError)
                            else f"{type(e).__name__}: {e}"})
            db.add(CommandHistory(user_id=user.id, dataset_id=ds.id, command=f"[{f.name}:{lineno}] {line}", ok=False))
            if body.stop_on_error:
                break
            continue
        if mutated:
            mutated_any = True
            df = new_df
        results.append({"line": lineno, "command": line, "ok": True, "result": res})
        db.add(CommandHistory(user_id=user.id, dataset_id=ds.id, command=f"[{f.name}:{lineno}] {line}", ok=True))

    if mutated_any:
        preserve = {v.name: v for v in ds.variables}
        dataio.save_df(ds.id, df)
        ds.n_rows, ds.n_cols = len(df), len(df.columns)
        dataio.sync_variables(db, ds, df, preserve=preserve)
    db.commit()  # persists meta (stset), history
    return {
        "dofile": {"id": f.id, "name": f.name},
        "dataset": {"id": ds.id, "name": ds.name, "n_rows": ds.n_rows, "n_cols": ds.n_cols},
        "n_commands": len(results),
        "n_errors": n_errors,
        "stopped": bool(n_errors and body.stop_on_error and len(results) < len(steps)),
        "results": results,
    }
