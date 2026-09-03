# backend/app/security.py
from __future__ import annotations

import hashlib
import secrets
from passlib.context import CryptContext

# ✅ bcrypt 대신 pbkdf2_sha256 사용 (Windows/Python 3.14 환경에서 훨씬 안정적)
pwd_context = CryptContext(
    schemes=["pbkdf2_sha256"],
    deprecated="auto",
)

# 너무 긴 비밀번호는 DB/로그/보안상도 위험해서 상한만 둠(원하면 조정 가능)
_MAX_PASSWORD_LEN = 1024


def hash_password(password: str) -> str:
    if password is None:
        raise ValueError("password is required")
    if len(password) > _MAX_PASSWORD_LEN:
        raise ValueError("password too long")
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    if not password or not password_hash:
        return False
    if len(password) > _MAX_PASSWORD_LEN:
        return False
    return pwd_context.verify(password, password_hash)


def generate_token() -> str:
    # 길고 안전한 토큰
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    # 토큰은 DB에 해시로 저장
    return hashlib.sha256(token.encode("utf-8")).hexdigest()