# backend/app/models.py
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import String, Integer, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def now_utc() -> datetime:
    # 간단히 naive utc로 처리(로컬 MVP)
    return datetime.utcnow()


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, nullable=False)

    tokens: Mapped[list["AccessToken"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    records: Mapped[list["Record"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )


class AccessToken(Base):
    __tablename__ = "access_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    token_hash: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    user: Mapped["User"] = relationship(back_populates="tokens")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class Record(Base):
    __tablename__ = "records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, index=True)  # uuid string

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    user: Mapped["User"] = relationship(back_populates="records")

    # 원본 요청(LOCK 대비)
    month: Mapped[str] = mapped_column(String(7), nullable=False, index=True)  # YYYY-MM

    # ✅ 지역(선택) - add-only
    # - 초기 단계에서는 nullable 유지(마이그레이션 부담↓)
    # - 실제 운영에서는 NOT NULL + default("ALL")로 강화 가능(후순위)
    region_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)

    business_type_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # ✅ NEW (B-1): 매출 밴드(비슷한 매출 그룹) - add-only
    # - 기존 호환 위해 nullable로 시작
    size_band: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, index=True)

    revenue_vat_included: Mapped[int] = mapped_column(Integer, nullable=False)
    cost_vat_included: Mapped[int] = mapped_column(Integer, nullable=False)
    labor_cost: Mapped[int] = mapped_column(Integer, nullable=False)

    material_cost_vat_included: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rent_cost_vat_included: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    other_cost_vat_included: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # 결과 JSON 저장(프론트/분석용)
    result_json: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_utc, nullable=False, index=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)

    # ✅ 같은 사용자가 같은 달(month) 기록을 중복 저장하지 못하게 하는 안전장치.
    # deleted_at IS NULL인 것만 대상으로 하는 partial unique index라서
    # 소프트 삭제된 기록과는 충돌하지 않는다.
    # 주의: create_all()은 기존에 이미 만들어진 테이블에는 인덱스를 소급 적용하지 않는다.
    # 이미 중복 데이터가 있는 기존 local_dev.db에는 별도 정리/마이그레이션이 필요하다.
    __table_args__ = (
        Index(
            "uq_records_user_month_active",
            "user_id",
            "month",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )