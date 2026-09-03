# backend/app/db.py
from __future__ import annotations

import os
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session, declarative_base


# ------------------------------------------------------------
# DATABASE_URL
# - Render(운영): env DATABASE_URL 사용
# - 로컬(Windows): 없으면 backend/local_dev.db 사용
# ------------------------------------------------------------
def _default_sqlite_url() -> str:
    # backend/ 폴더 기준으로 local_dev.db
    backend_dir = Path(__file__).resolve().parents[1]  # .../backend
    db_path = backend_dir / "local_dev.db"
    return f"sqlite:///{db_path.as_posix()}"


DATABASE_URL = os.getenv("DATABASE_URL", "").strip() or _default_sqlite_url()

# SQLite면 connect_args 필요 (check_same_thread)
_connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    _connect_args = {"check_same_thread": False}

# ------------------------------------------------------------
# SQLAlchemy Core Objects
# ------------------------------------------------------------
engine = create_engine(
    DATABASE_URL,
    future=True,
    pool_pre_ping=True,
    connect_args=_connect_args,
)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    future=True,
)

Base = declarative_base()


# ------------------------------------------------------------
# FastAPI dependency
# ------------------------------------------------------------
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()