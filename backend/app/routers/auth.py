"""Auth endpoints: register, login, me, demo login."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from ..auth_utils import create_token, hash_password, verify_password
from ..database import get_db
from ..models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: str
    password: str
    name: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


def _user_out(u: User, token: str | None = None):
    d = {"id": u.id, "email": u.email, "name": u.name, "is_demo": u.is_demo}
    if token:
        d["token"] = token
    return d


@router.post("/register")
def register(body: RegisterIn, db: Session = Depends(get_db)):
    if len(body.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    if "@" not in body.email:
        raise HTTPException(400, "Enter a valid email")
    if db.query(User).filter(User.email == body.email.lower()).first():
        raise HTTPException(400, "Email already registered")
    u = User(email=body.email.lower(), name=body.name, hashed_password=hash_password(body.password))
    db.add(u)
    db.commit()
    db.refresh(u)
    return _user_out(u, create_token(u))


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.email == body.email.lower()).first()
    if not u or not verify_password(body.password, u.hashed_password):
        raise HTTPException(401, "Invalid email or password")
    return _user_out(u, create_token(u))


@router.post("/demo")
def demo_login(db: Session = Depends(get_db)):
    u = db.query(User).filter(User.email == "demo@statmedx.app").first()
    if not u:
        u = User(email="demo@statmedx.app", name="Demo researcher", hashed_password=hash_password("demo1234"), is_demo=True)
        db.add(u)
        db.commit()
        db.refresh(u)
    return _user_out(u, create_token(u))


@router.get("/me")
def me(user: User = Depends(__import__("app.auth_utils", fromlist=["get_current_user"]).get_current_user)):
    return _user_out(user)
