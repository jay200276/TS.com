# backend/app/deps.py
from __future__ import annotations

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User, AccessToken
from app.security import hash_token

# ✅ Swagger에 Authorize 버튼이 생기게 하는 핵심
bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    # 토큰이 아예 없으면
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    # scheme이 bearer가 아니면
    if (creds.scheme or "").lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid auth scheme")

    token = creds.credentials
    token_h = hash_token(token)

    at = db.query(AccessToken).filter(AccessToken.token_hash == token_h).first()
    if not at:
        raise HTTPException(status_code=401, detail="Invalid token")
    if at.revoked_at is not None:
        raise HTTPException(status_code=401, detail="Revoked token")

    user = db.query(User).filter(User.id == at.user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user