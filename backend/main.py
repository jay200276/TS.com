# backend/main.py  (FULL REPLACE)
from __future__ import annotations

import io
import json
import os
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Literal, Union

import pandas as pd
from fastapi import FastAPI, Depends, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings
from sqlalchemy.orm import Session

# ✅ DB / Auth / OAuth / Models (유지)
from app.db import engine, get_db, Base
from app.models import User, AccessToken, Record
from app.security import hash_password, verify_password, generate_token, hash_token
from app.deps import get_current_user
from app.routers_oauth import router as oauth_router
from app.routers_opportunity import router as opportunity_router

# ✅ 계산 엔진
from app.engine.tax_engine import (
    EngineMeta,
    decide_taxpayer_type,
    compute_vat_simple,
    compute_vat_general,
    compute_income_tax,
    compute_local_income_tax,
    compute_insurance_employer_estimate,
    compute_expense_ratio_hint,
)

# ✅ 결과 분석 엔진
from app.engine.analysis_engine import build_analysis_v1


# ---------------------------------------------------------------------
# ✅ LOCK/호환 심볼 유지
# ---------------------------------------------------------------------
def load_benchmarks(version: str = "v1") -> Dict[str, Any]:
    return {"version": version, "loaded": False, "note": "benchmarks disabled (member UI only)"}


def validate_business_type_code(code: str) -> str:
    c = (code or "").strip().upper()
    mapping = {
        "FOOD_ALL": "음식업(전체)",
        "FOODSVC": "음식 서비스업",
        "CAFE": "카페/커피",
        "FOOD_CAFE": "카페/커피(음식업 분류)",
    }
    if not c:
        raise ValueError("empty business_type_code")
    return mapping.get(c, c)


# ---------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------
class Settings(BaseSettings):
    benchmarks_version: str = "v1"


settings = Settings()

# ---------------------------------------------------------------------
# DB init
# ---------------------------------------------------------------------
Base.metadata.create_all(bind=engine)

# ---------------------------------------------------------------------
# FastAPI App
# ---------------------------------------------------------------------
app = FastAPI(title="TS (tax secretary)", version="0.2.0")
app.include_router(oauth_router)
app.include_router(opportunity_router)

_cors_allow_origins = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
]
_extra_origin = os.environ.get("FRONTEND_ORIGIN", "").strip()
if _extra_origin:
    _cors_allow_origins.append(_extra_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------
SourceType = Literal["official", "public", "heuristic"]
CalcMode = Literal["quick", "pro"]


class ErrorItem(BaseModel):
    code: str
    message: str
    details: List[Dict[str, Any]] = Field(default_factory=list)


class PartialFailure(BaseModel):
    code: str
    message: str
    detail: Optional[str] = None
    source_type: SourceType = "heuristic"
    confidence: float = 0.3


class Meta(BaseModel):
    record_id: Optional[str] = None
    assumptions: List[str] = Field(default_factory=list)
    partial_failures: List[PartialFailure] = Field(default_factory=list)
    source_type: SourceType = "heuristic"
    confidence: float = 0.7


class ErrorResponse(BaseModel):
    error: ErrorItem
    meta: Meta


class KPI(BaseModel):
    score_100: int
    grade: str
    label: str


class Insight(BaseModel):
    type: Literal["warning", "good", "recommend"]
    title: str
    message: str
    source_type: SourceType = "heuristic"
    confidence: float = 0.6


class TaxEstimate(BaseModel):
    estimated_total_tax: Optional[int] = None
    note: str = "입력값 기준 추정(세부 공제/공제한도/개인공제는 케이스에 따라 달라질 수 있습니다.)"
    breakdown: Dict[str, Any] = Field(default_factory=dict)


class ExpenseBreakdown(BaseModel):
    material_cost_vat_included: int = 0
    labor_cost: int = 0
    rent_cost_vat_included: int = 0
    other_cost_vat_included: int = 0
    total: int = 0
    mode: Literal["split", "fallback"] = "fallback"


class BusinessType(BaseModel):
    code: str
    label: str


class Region(BaseModel):
    code: str
    label: str


class Annualized(BaseModel):
    revenue_vat_included: int
    cost_vat_included: int
    labor_cost: int


class Derived(BaseModel):
    monthly_profit_estimate: int
    gross_margin_ratio: float
    margin_ratio: float
    labor_ratio: float

    size_band: Optional[str] = None
    bench_cost_ratio_avg: Optional[float] = None
    bench_labor_ratio_avg: Optional[float] = None
    bench_version_key: Optional[str] = None
    bench_region_code: Optional[str] = None

    bench_cost_ratio_p25: Optional[float] = None
    bench_cost_ratio_p50: Optional[float] = None
    bench_cost_ratio_p75: Optional[float] = None
    bench_labor_ratio_p25: Optional[float] = None
    bench_labor_ratio_p50: Optional[float] = None
    bench_labor_ratio_p75: Optional[float] = None

    bench_cost_ratio_diff_pp: Optional[float] = None
    bench_labor_ratio_diff_pp: Optional[float] = None
    bench_cost_ratio_level: Optional[str] = None
    bench_labor_ratio_level: Optional[str] = None
    bench_size_band: Optional[str] = None

    expense_ratio_hint: Optional[Dict[str, Any]] = None


class Result(BaseModel):
    month: str
    region: Region
    business_type: BusinessType
    annualized: Annualized
    derived: Derived
    tax_estimate: TaxEstimate
    expense_breakdown: ExpenseBreakdown


class CalcResponse(BaseModel):
    kpi: KPI
    result: Result
    insights: List[Insight]
    meta: Meta
    analysis: Optional[Dict[str, Any]] = None


class CalcRequest(BaseModel):
    month: str
    region_code: str = "ALL"

    revenue_vat_included: int
    cost_vat_included: int
    labor_cost: int = 0
    business_type_code: str = "FOOD_ALL"
    material_cost_vat_included: Optional[int] = None
    rent_cost_vat_included: Optional[int] = None
    other_cost_vat_included: Optional[int] = None

    mode: CalcMode = "quick"

    prior_year_sales_vat_included: Optional[int] = None
    industry_code: Optional[str] = None

    sales_cash_vat_included: Optional[int] = None
    sales_card_vat_included: Optional[int] = None
    sales_platform_vat_included: Optional[int] = None

    purchase_tax_invoice_vat_included: Optional[int] = None
    purchase_card_vat_included: Optional[int] = None
    purchase_cash_receipt_vat_included: Optional[int] = None

    purchase_exempt_agri_vat_exempt: Optional[int] = None

    employees_count: Optional[int] = None
    payroll_total_month: Optional[int] = None

    business_type_detail: Optional[str] = None


class RegisterRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    id: int
    email: str


class RecordListItem(BaseModel):
    record_id: str
    month: str
    business_type_code: str
    region_code: Optional[str] = None
    size_band: Optional[str] = None
    revenue_vat_included: int
    cost_vat_included: int
    labor_cost: int
    created_at: str


class RecordListResponse(BaseModel):
    items: List[RecordListItem]


class ImportRowPreview(BaseModel):
    row_index: int
    ok: bool
    error: Optional[str] = None
    payload: Optional[CalcRequest] = None
    result: Optional[CalcResponse] = None
    will_overwrite: bool = False


class ImportPreviewResponse(BaseModel):
    rows: List[ImportRowPreview]
    valid_count: int
    error_count: int


class ImportCommitRequest(BaseModel):
    rows: List[CalcRequest]


class ImportCommitItemResult(BaseModel):
    month: str
    ok: bool
    error: Optional[str] = None
    overwritten: bool = False


class ImportCommitResponse(BaseModel):
    results: List[ImportCommitItemResult]
    saved_count: int
    failed_count: int


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------
def _clamp_int(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))


def _grade_from_score(score: int) -> str:
    if score >= 75:
        return "A"
    if score >= 55:
        return "B"
    if score >= 35:
        return "C"
    return "D"


def _kpi_label(grade: str) -> str:
    return {"A": "안정", "B": "주의", "C": "위험", "D": "즉시 개선"}.get(grade, "주의")


def _safe_int(x: Optional[int]) -> int:
    return int(x) if x is not None else 0


def _norm_region_code(code: Optional[str]) -> str:
    c = (code or "").strip()
    return (c.upper() if c else "ALL")


def _region_label(code: str) -> str:
    return "전국" if code == "ALL" else code


def derive_size_band(revenue_vat_included: int) -> str:
    v = int(revenue_vat_included or 0)
    if v <= 0:
        return "BAND_0_10M"
    if v <= 10_000_000:
        return "BAND_0_10M"
    if v <= 30_000_000:
        return "BAND_10_30M"
    if v <= 50_000_000:
        return "BAND_30_50M"
    if v <= 100_000_000:
        return "BAND_50_100M"
    return "BAND_100M_PLUS"


_MAX_IMPORT_ROWS = 120  # 넉넉히 10년치 월별 데이터

_IMPORT_COLUMN_ALIASES: Dict[str, List[str]] = {
    "month": ["월", "연월", "년월", "month", "period"],
    "revenue_vat_included": ["매출", "매출액", "월매출", "매출(부가세포함)", "revenue", "revenue_vat_included"],
    "cost_vat_included": ["비용", "총비용", "월비용", "비용(부가세포함)", "cost", "cost_vat_included"],
    "labor_cost": ["인건비", "labor_cost", "labor"],
    "material_cost_vat_included": ["재료비", "material_cost_vat_included", "material"],
    "rent_cost_vat_included": ["임대료", "rent_cost_vat_included", "rent"],
    "other_cost_vat_included": ["기타비용", "기타", "other_cost_vat_included", "other"],
    "region_code": ["지역코드", "지역", "region_code", "region"],
    "industry_code": ["업종코드", "업종", "industry_code"],
    "business_type_code": ["business_type_code", "업태코드"],
}


def _normalize_header(h: Any) -> str:
    return str(h or "").strip().lower().replace(" ", "")


def _build_import_column_map(columns: List[Any]) -> Dict[str, Any]:
    norm_cols = {_normalize_header(c): c for c in columns}
    mapping: Dict[str, Any] = {}
    for field, aliases in _IMPORT_COLUMN_ALIASES.items():
        for alias in aliases:
            key = _normalize_header(alias)
            if key in norm_cols:
                mapping[field] = norm_cols[key]
                break
    return mapping


def _normalize_month_value(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip().replace(".", "-").replace("/", "-")
        if not s:
            return None
        m = re.match(r"^(\d{4})-(\d{1,2})$", s)
        if m:
            return f"{m.group(1)}-{int(m.group(2)):02d}"
        return None
    try:
        if pd.isna(v):
            return None
    except Exception:
        pass
    try:
        return f"{v.year:04d}-{v.month:02d}"
    except Exception:
        return None


def _to_number(v: Any) -> Optional[int]:
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip().replace(",", "").replace("원", "")
        if not s:
            return None
        try:
            return int(round(float(s)))
        except Exception:
            return None
    try:
        if isinstance(v, float) and pd.isna(v):
            return None
        return int(round(float(v)))
    except Exception:
        return None


def _to_code_or_none(v: Any) -> Optional[str]:
    if v is None:
        return None
    try:
        if isinstance(v, float) and pd.isna(v):
            return None
    except Exception:
        pass
    s = str(v).strip()
    return s or None


def _row_to_calc_request(row: Dict[str, Any], colmap: Dict[str, Any]) -> CalcRequest:
    def get(field: str) -> Any:
        col = colmap.get(field)
        return row.get(col) if col is not None else None

    month = _normalize_month_value(get("month"))
    if not month:
        raise ValueError("월 값을 인식할 수 없습니다. 'YYYY-MM' 형식으로 입력해주세요.")

    revenue = _to_number(get("revenue_vat_included"))
    if revenue is None or revenue <= 0:
        raise ValueError("매출(부가세포함) 값이 없거나 0 이하입니다.")

    cost = _to_number(get("cost_vat_included"))
    if cost is None or cost <= 0:
        raise ValueError("비용(부가세포함) 값이 없거나 0 이하입니다.")

    return CalcRequest(
        month=month,
        region_code=_to_code_or_none(get("region_code")) or "ALL",
        revenue_vat_included=revenue,
        cost_vat_included=cost,
        labor_cost=_to_number(get("labor_cost")) or 0,
        business_type_code=_to_code_or_none(get("business_type_code")) or "FOOD_ALL",
        industry_code=_to_code_or_none(get("industry_code")),
        material_cost_vat_included=_to_number(get("material_cost_vat_included")),
        rent_cost_vat_included=_to_number(get("rent_cost_vat_included")),
        other_cost_vat_included=_to_number(get("other_cost_vat_included")),
        mode="quick",
    )


def _parse_year_from_month(month: str) -> int:
    try:
        y = int(str(month).split("-")[0])
        return y
    except Exception:
        return datetime.utcnow().year


def _obj_get(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _as_dict(obj: Any) -> Dict[str, Any]:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "model_dump"):
        try:
            dumped = obj.model_dump()
            if isinstance(dumped, dict):
                return dumped
        except Exception:
            return {}
    return {}


def _as_list(obj: Any) -> List[Any]:
    if obj is None:
        return []
    if isinstance(obj, list):
        return obj
    if isinstance(obj, tuple):
        return list(obj)
    return []


def _engine_meta_to_meta(em: EngineMeta, record_id: Optional[str]) -> Meta:
    pfs: List[PartialFailure] = []
    raw_pfs = getattr(em, "partial_failures", None) or []
    for pf in raw_pfs:
        if isinstance(pf, dict):
            pfs.append(
                PartialFailure(
                    code=str(pf.get("code", "UNKNOWN")),
                    message=str(pf.get("message", "")),
                    detail=pf.get("detail"),
                    source_type=pf.get("source_type", em.source_type),  # type: ignore
                    confidence=float(pf.get("confidence", em.confidence)),
                )
            )
        else:
            pfs.append(PartialFailure(code=str(pf), message=""))

    return Meta(
        record_id=record_id,
        assumptions=list(getattr(em, "assumptions", None) or []),
        partial_failures=pfs,
        source_type=em.source_type,  # type: ignore
        confidence=float(em.confidence),
    )


def _extract_vat_due_month(vat: Dict[str, Any]) -> int:
    candidates = [
        vat.get("vat_due_month"),  # ✅ 핵심 수정
        vat.get("vat_payable"),
        vat.get("due_month"),
        vat.get("monthly_estimate"),
        vat.get("net_vat_payable"),
        vat.get("payable_vat"),
        vat.get("final_vat"),
        vat.get("estimated_vat"),
        vat.get("vat_due"),
        vat.get("monthly_vat"),
    ]
    for v in candidates:
        try:
            if v is not None:
                return int(v)
        except Exception:
            continue
    return 0


CalcOrError = Union[CalcResponse, JSONResponse]


def _make_calc_response(req: CalcRequest, record_id: Optional[str]) -> CalcOrError:
    region_code = _norm_region_code(req.region_code)
    size_band = derive_size_band(req.revenue_vat_included)

    try:
        bt_label = validate_business_type_code(req.business_type_code)
    except Exception:
        meta = Meta(
            record_id=record_id,
            assumptions=["유효하지 않은 business_type_code"],
            partial_failures=[],
            source_type="heuristic",
            confidence=0.4,
        )
        err = ErrorResponse(
            error=ErrorItem(
                code="INVALID_BUSINESS_TYPE_CODE",
                message="유효하지 않은 business_type_code 입니다.",
                details=[{"field": "business_type_code", "value": req.business_type_code}],
            ),
            meta=meta,
        )
        return JSONResponse(status_code=422, content=err.model_dump())

    revenue_m = max(1, int(req.revenue_vat_included or 0))
    monthly_profit = int(req.revenue_vat_included) - int(req.cost_vat_included) - int(req.labor_cost)
    margin_ratio = monthly_profit / revenue_m
    labor_ratio = int(req.labor_cost) / revenue_m
    gross_margin_ratio = (int(req.revenue_vat_included) - int(req.cost_vat_included)) / revenue_m

    score = 70
    if margin_ratio < 0.2:
        score -= 20
    if margin_ratio < 0.1:
        score -= 20
    if labor_ratio > 0.35:
        score -= 15
    score = _clamp_int(score, 0, 100)
    grade = _grade_from_score(score)

    em = EngineMeta(
        source_type="public",
        confidence=0.70,
        assumptions=[
            "모든 결과는 입력값 기준 추정치입니다.",
            "개인공제/세액공제/가족 인건비 등 개별 요인은 미반영(추후 정밀 옵션으로 확장 가능).",
            f"지역 코드: {region_code}",
            f"매출 밴드: {size_band}",
            f"모드: {req.mode}",
        ],
    )

    year = _parse_year_from_month(req.month)

    monthly_sales_vat_included = int(req.revenue_vat_included)
    annual_sales_vat_included = monthly_sales_vat_included * 12

    purchase_total_vat_included = (
        _safe_int(req.purchase_tax_invoice_vat_included)
        + _safe_int(req.purchase_card_vat_included)
        + _safe_int(req.purchase_cash_receipt_vat_included)
    )
    exempt_agri_purchase = _safe_int(req.purchase_exempt_agri_vat_exempt)

    taxpayer_type = decide_taxpayer_type(
        prior_year_sales_vat_included=req.prior_year_sales_vat_included,
        current_annual_sales_vat_included=annual_sales_vat_included,
        region_code=region_code,
        meta=em,
        excluded_simple_regions=None,
    )

    is_corporate = False
    if taxpayer_type == "SIMPLE":
        vat = compute_vat_simple(
            annual_sales_vat_included=annual_sales_vat_included,
            meta=em,
        )
    else:
        vat = compute_vat_general(
            taxable_sales_vat_included=monthly_sales_vat_included,
            purchase_vat_included_total=(
                purchase_total_vat_included if purchase_total_vat_included > 0 else int(req.cost_vat_included)
            ),
            exempt_agri_purchase_vat_exempt=exempt_agri_purchase,
            annual_sales_vat_included=annual_sales_vat_included,
            business_type_code=req.business_type_code,
            is_corporate=is_corporate,
            meta=em,
        )

    vat_due_month_value = _extract_vat_due_month(vat)
    vat_due_year_value = vat_due_month_value * 12

    material_m = _safe_int(req.material_cost_vat_included)
    rent_m = _safe_int(req.rent_cost_vat_included)
    other_m = _safe_int(req.other_cost_vat_included)

    split_mode = (material_m + rent_m + other_m) > 0
    if split_mode:
        expense_total_m = material_m + req.labor_cost + rent_m + other_m
        expense = ExpenseBreakdown(
            material_cost_vat_included=material_m,
            labor_cost=req.labor_cost,
            rent_cost_vat_included=rent_m,
            other_cost_vat_included=other_m,
            total=expense_total_m,
            mode="split",
        )
        annual_profit_est = (req.revenue_vat_included - (material_m + rent_m + other_m) - req.labor_cost) * 12
    else:
        expense_total_m = req.cost_vat_included + req.labor_cost
        expense = ExpenseBreakdown(
            material_cost_vat_included=req.cost_vat_included,
            labor_cost=req.labor_cost,
            rent_cost_vat_included=0,
            other_cost_vat_included=0,
            total=expense_total_m,
            mode="fallback",
        )
        annual_profit_est = (req.revenue_vat_included - req.cost_vat_included - req.labor_cost) * 12

    exp_hint = compute_expense_ratio_hint(req.industry_code, year=year, meta=em)

    _temp_resp_dict_pre = {
        "kpi": {"score_100": score, "grade": grade, "label": _kpi_label(grade)},
        "result": {
            "month": req.month,
            "region": {
                "code": region_code,
                "label": _region_label(region_code),
            },
            "business_type": {
                "code": req.business_type_code,
                "label": bt_label,
            },
            "business_type_detail": req.business_type_detail,
            "annualized": {
                "revenue_vat_included": int(req.revenue_vat_included) * 12,
                "cost_vat_included": int(req.cost_vat_included) * 12,
                "labor_cost": int(req.labor_cost) * 12,
            },
            "derived": {
                "monthly_profit_estimate": monthly_profit,
                "gross_margin_ratio": float(gross_margin_ratio),
                "margin_ratio": float(margin_ratio),
                "labor_ratio": float(labor_ratio),
                "material_ratio": (float(material_m) / float(revenue_m)) if material_m > 0 else None,
                "rent_ratio": (float(rent_m) / float(revenue_m)) if rent_m > 0 else None,
                "other_ratio": (float(other_m) / float(revenue_m)) if other_m > 0 else None,
                "size_band": size_band,
                "bench_version_key": None,
                "bench_region_code": None,
                "bench_cost_ratio_p25": None,
                "bench_cost_ratio_p50": None,
                "bench_cost_ratio_p75": None,
                "bench_labor_ratio_p25": None,
                "bench_labor_ratio_p50": None,
                "bench_labor_ratio_p75": None,
                "bench_cost_ratio_diff_pp": None,
                "bench_labor_ratio_diff_pp": None,
                "bench_size_band": None,
            },
            "tax": {
                "vat": {
                    "due_month": vat_due_month_value,
                    "due_year": vat_due_year_value,
                },
                "income_tax": {
                    "due_year": 0,
                },
                "insurance": {
                    "employer_year": 0,
                },
            },
            "tax_estimate": {
                "estimated_total_tax": None,
                "breakdown": {
                    "vat": vat,
                    "income": {"income_tax_est": None, "local_income_tax_est": None},
                    "insurance": {"employer_year_est": None},
                },
            },
            "expense_breakdown": {
                "material_cost_vat_included": int(expense.material_cost_vat_included),
                "labor_cost": int(expense.labor_cost),
                "rent_cost_vat_included": int(expense.rent_cost_vat_included),
                "other_cost_vat_included": int(expense.other_cost_vat_included),
                "total": int(expense.total),
                "mode": expense.mode,
            },
        },
    }
    analysis_pre = build_analysis_v1(req=req, resp_dict=_temp_resp_dict_pre)

    taxable_income_est_raw = max(0, int(annual_profit_est))

    def _get_profit_bench(pre_obj: Any) -> Dict[str, Any]:
        bb = _obj_get(pre_obj, "benchmarks", None)
        items = _as_list(_obj_get(bb, "items", []))
        for it in items:
            it_dict = _as_dict(it)
            if it_dict.get("metric") == "PROFIT_RATIO":
                return it_dict
        return {}

    profit_b = _get_profit_bench(analysis_pre)
    profit_p75 = profit_b.get("p75")

    taxable_income_est = taxable_income_est_raw

    if (
        req.mode == "quick"
        and (req.industry_code is None or str(req.industry_code).strip() == "")
        and isinstance(profit_p75, (int, float))
        and annual_sales_vat_included > 0
    ):
        bench_profit_cap = int(annual_sales_vat_included * float(profit_p75))
        if taxable_income_est_raw > bench_profit_cap:
            taxable_income_est = max(0, bench_profit_cap)
            em.assumptions.append(
                "quick 모드/업종코드 미입력으로 경비율을 적용할 수 없어, 공식 벤치마크(PROFIT_RATIO p75) 기준으로 소득세 과세표준을 보수적으로 보정했습니다."
            )
            em.partial_failures.append({
                "code": "INCOME_TAX_BASE_CLAMPED_BY_BENCH_PROFIT_P75",
                "message": "quick 모드에서 과세표준(추정)이 공식 벤치마크 상한(p75)을 초과하여 보정 적용",
                "detail": f"raw={taxable_income_est_raw}, cap={bench_profit_cap}, p75={profit_p75}",
                "source_type": "public",
                "confidence": 0.75,
            })

    if taxable_income_est == 0:
        em.assumptions.append("연 순이익(추정)이 0 이하로 계산되어 종합소득세는 0으로 추정")

    income_tax = compute_income_tax(taxable_income=taxable_income_est, year=year, meta=em)
    local_tax = compute_local_income_tax(income_tax)

    payroll_for_insurance = _safe_int(req.payroll_total_month)
    if payroll_for_insurance <= 0:
        payroll_for_insurance = _safe_int(req.labor_cost)
        if payroll_for_insurance > 0:
            em.assumptions.append(
                "급여총액(정밀 입력)이 없어 월 인건비를 급여총액 추정치로 대신 사용했습니다."
            )

    insurance = compute_insurance_employer_estimate(
        employees_count=_safe_int(req.employees_count),
        payroll_total_month=payroll_for_insurance,
        meta=em,
    )
    annual_insurance_est = int(insurance.get("employer_total", 0)) * 12

    vat_payable = vat_due_month_value
    estimated_total = vat_payable + income_tax + local_tax + annual_insurance_est

    meta = _engine_meta_to_meta(em, record_id=record_id)

    insights: List[Insight] = [
        Insight(
            type="recommend",
            title="정밀 분석 정확도 올리기",
            message="직전연도 매출·증빙별 매입·면세 농산물 매입·직원수를 입력하면 추정 정확도가 올라갑니다.",
            source_type=meta.source_type,
            confidence=0.7,
        )
    ]
    if req.mode == "quick":
        insights.append(
            Insight(
                type="warning",
                title="일반 분석(간편) 모드 안내",
                message="최소 입력 기반 추정 · 의제매입공제·증빙 구분은 단순화됩니다.",
                source_type=meta.source_type,
                confidence=0.7,
            )
        )

    _temp_resp_dict_final = {
        "kpi": {"score_100": score, "grade": grade, "label": _kpi_label(grade)},
        "result": {
            "month": req.month,
            "region": {
                "code": region_code,
                "label": _region_label(region_code),
            },
            "business_type": {
                "code": req.business_type_code,
                "label": bt_label,
            },
            "business_type_detail": req.business_type_detail,
            "annualized": {
                "revenue_vat_included": int(req.revenue_vat_included) * 12,
                "cost_vat_included": int(req.cost_vat_included) * 12,
                "labor_cost": int(req.labor_cost) * 12,
            },
            "derived": {
                "monthly_profit_estimate": monthly_profit,
                "gross_margin_ratio": float(gross_margin_ratio),
                "margin_ratio": float(margin_ratio),
                "labor_ratio": float(labor_ratio),
                "material_ratio": (float(material_m) / float(revenue_m)) if material_m > 0 else None,
                "rent_ratio": (float(rent_m) / float(revenue_m)) if rent_m > 0 else None,
                "other_ratio": (float(other_m) / float(revenue_m)) if other_m > 0 else None,
                "size_band": size_band,
                "bench_version_key": None,
                "bench_region_code": None,
                "bench_cost_ratio_p25": None,
                "bench_cost_ratio_p50": None,
                "bench_cost_ratio_p75": None,
                "bench_labor_ratio_p25": None,
                "bench_labor_ratio_p50": None,
                "bench_labor_ratio_p75": None,
                "bench_cost_ratio_diff_pp": None,
                "bench_labor_ratio_diff_pp": None,
                "bench_size_band": None,
            },
            "tax": {
                "vat": {
                    "due_month": vat_due_month_value,
                    "due_year": vat_due_year_value,
                },
                "income_tax": {
                    "due_year": int(income_tax + local_tax),
                },
                "insurance": {
                    "employer_year": int(annual_insurance_est),
                },
            },
            "tax_estimate": {
                "estimated_total_tax": int(max(0, estimated_total)),
                "breakdown": {
                    "vat": vat,
                    "income": {"income_tax_est": income_tax, "local_income_tax_est": local_tax},
                    "insurance": {"employer_year_est": annual_insurance_est},
                },
            },
            "expense_breakdown": {
                "material_cost_vat_included": int(expense.material_cost_vat_included),
                "labor_cost": int(expense.labor_cost),
                "rent_cost_vat_included": int(expense.rent_cost_vat_included),
                "other_cost_vat_included": int(expense.other_cost_vat_included),
                "total": int(expense.total),
                "mode": expense.mode,
            },
        },
    }
    analysis_obj = build_analysis_v1(req=req, resp_dict=_temp_resp_dict_final)

    bench_block = _obj_get(analysis_obj, "benchmarks", None)
    bench_items = _as_list(_obj_get(bench_block, "items", []))

    def _find_bench(metric: str) -> Dict[str, Any]:
        for it in bench_items:
            it_dict = _as_dict(it)
            if it_dict.get("metric") == metric:
                return it_dict
        return {}

    cost_b = _find_bench("COST_RATIO")
    labor_b = _find_bench("LABOR_RATIO")

    bench_version_key = _obj_get(bench_block, "version_key", None)
    bench_region_code = _obj_get(bench_block, "region_code", None) or region_code
    bench_size_band = _obj_get(bench_block, "size_band", None) or size_band

    bench_cost_ratio_p25 = cost_b.get("p25")
    bench_cost_ratio_p50 = cost_b.get("p50")
    bench_cost_ratio_p75 = cost_b.get("p75")
    bench_cost_ratio_diff_pp = cost_b.get("diff_pp")
    bench_cost_ratio_level = cost_b.get("level")

    bench_labor_ratio_p25 = labor_b.get("p25")
    bench_labor_ratio_p50 = labor_b.get("p50")
    bench_labor_ratio_p75 = labor_b.get("p75")
    bench_labor_ratio_diff_pp = labor_b.get("diff_pp")
    bench_labor_ratio_level = labor_b.get("level")

    analysis_payload = _as_dict(analysis_obj) if analysis_obj is not None else None

    return CalcResponse(
        kpi=KPI(score_100=score, grade=grade, label=_kpi_label(grade)),
        result=Result(
            month=req.month,
            region=Region(code=region_code, label=_region_label(region_code)),
            business_type=BusinessType(code=req.business_type_code, label=bt_label),
            annualized=Annualized(
                revenue_vat_included=int(req.revenue_vat_included) * 12,
                cost_vat_included=int(req.cost_vat_included) * 12,
                labor_cost=int(req.labor_cost) * 12,
            ),
            derived=Derived(
                monthly_profit_estimate=monthly_profit,
                gross_margin_ratio=float(gross_margin_ratio),
                margin_ratio=float(margin_ratio),
                labor_ratio=float(labor_ratio),
                size_band=size_band,
                bench_version_key=bench_version_key,
                bench_region_code=bench_region_code,
                bench_size_band=bench_size_band,
                bench_cost_ratio_avg=(float(bench_cost_ratio_p50) if bench_cost_ratio_p50 is not None else None),
                bench_labor_ratio_avg=(float(bench_labor_ratio_p50) if bench_labor_ratio_p50 is not None else None),
                bench_cost_ratio_p25=(float(bench_cost_ratio_p25) if bench_cost_ratio_p25 is not None else None),
                bench_cost_ratio_p50=(float(bench_cost_ratio_p50) if bench_cost_ratio_p50 is not None else None),
                bench_cost_ratio_p75=(float(bench_cost_ratio_p75) if bench_cost_ratio_p75 is not None else None),
                bench_labor_ratio_p25=(float(bench_labor_ratio_p25) if bench_labor_ratio_p25 is not None else None),
                bench_labor_ratio_p50=(float(bench_labor_ratio_p50) if bench_labor_ratio_p50 is not None else None),
                bench_labor_ratio_p75=(float(bench_labor_ratio_p75) if bench_labor_ratio_p75 is not None else None),
                bench_cost_ratio_diff_pp=(float(bench_cost_ratio_diff_pp) if bench_cost_ratio_diff_pp is not None else None),
                bench_labor_ratio_diff_pp=(float(bench_labor_ratio_diff_pp) if bench_labor_ratio_diff_pp is not None else None),
                bench_cost_ratio_level=(str(bench_cost_ratio_level) if bench_cost_ratio_level is not None else None),
                bench_labor_ratio_level=(str(bench_labor_ratio_level) if bench_labor_ratio_level is not None else None),
                expense_ratio_hint=exp_hint,
            ),
            tax_estimate=TaxEstimate(
                estimated_total_tax=int(max(0, estimated_total)),
                note="입력값 기준 추정입니다. (개인공제/세액공제/지출 증빙/직원 구분/연도별 개정에 따라 실제 신고세액은 달라질 수 있습니다.)",
                breakdown={
                    "mode": req.mode,
                    "taxpayer_type_guess": taxpayer_type,
                    "vat": vat,
                    "income": {
                        "taxable_income_est": int(taxable_income_est),
                        "taxable_income_est_raw": int(taxable_income_est_raw),
                        "income_tax_est": income_tax,
                        "local_income_tax_est": local_tax,
                    },
                    "insurance": {
                        "employer_month_est": int(insurance.get("employer_total", 0)),
                        "employer_year_est": annual_insurance_est,
                        "details": insurance.get("details", {}),
                        "note": insurance.get("note"),
                    },
                    "sum": {
                        "vat_payable": vat_payable,
                        "income_tax": income_tax,
                        "local_income_tax": local_tax,
                        "insurance_employer_year": annual_insurance_est,
                    },
                },
            ),
            expense_breakdown=expense,
        ),
        insights=insights,
        meta=meta,
        analysis=analysis_payload,
    )


# ---------------------------------------------------------------------
# 계산 + 저장 (같은 사용자/같은 달이면 overwrite) — 단건 계산과 엑셀 업로드 커밋이 공유
# ---------------------------------------------------------------------
def _calc_and_save_record(db: Session, user: User, req: CalcRequest) -> CalcOrError:
    # 같은 사용자의 같은 달(month) 기록이 이미 있으면 새로 만들지 않고 덮어쓴다.
    # (MVP 기본 정책: 중복 달 재계산/재업로드 시 overwrite. keep/skip 옵션은 필요해지면 추가.)
    existing = (
        db.query(Record)
        .filter(Record.user_id == user.id)
        .filter(Record.month == req.month)
        .filter(Record.deleted_at.is_(None))
        .order_by(Record.created_at.desc())
        .first()
    )

    rid = existing.id if existing else str(uuid.uuid4())
    resp = _make_calc_response(req, record_id=rid)

    if isinstance(resp, JSONResponse):
        return resp

    result_json = json.dumps(resp.model_dump(), ensure_ascii=False)

    if existing:
        existing.region_code = _norm_region_code(req.region_code)
        existing.business_type_code = req.business_type_code
        existing.size_band = derive_size_band(req.revenue_vat_included)
        existing.revenue_vat_included = req.revenue_vat_included
        existing.cost_vat_included = req.cost_vat_included
        existing.labor_cost = req.labor_cost
        existing.material_cost_vat_included = _safe_int(req.material_cost_vat_included)
        existing.rent_cost_vat_included = _safe_int(req.rent_cost_vat_included)
        existing.other_cost_vat_included = _safe_int(req.other_cost_vat_included)
        existing.result_json = result_json
        existing.created_at = datetime.utcnow()  # 목록/월비교 정렬 및 "마지막 계산 시각" 표시용
        db.add(existing)
    else:
        rec = Record(
            id=rid,
            user_id=user.id,
            month=req.month,
            region_code=_norm_region_code(req.region_code),
            business_type_code=req.business_type_code,
            size_band=derive_size_band(req.revenue_vat_included),
            revenue_vat_included=req.revenue_vat_included,
            cost_vat_included=req.cost_vat_included,
            labor_cost=req.labor_cost,
            material_cost_vat_included=_safe_int(req.material_cost_vat_included),
            rent_cost_vat_included=_safe_int(req.rent_cost_vat_included),
            other_cost_vat_included=_safe_int(req.other_cost_vat_included),
            result_json=result_json,
        )
        db.add(rec)

    db.commit()
    return resp


# ---------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/register", response_model=MeResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    email = req.email.strip().lower()
    if not email or len(req.password) < 6:
        return JSONResponse(status_code=422, content={"detail": "invalid email/password"})

    exists = db.query(User).filter(User.email == email).first()
    if exists:
        return JSONResponse(status_code=409, content={"detail": "email already exists"})

    u = User(email=email, password_hash=hash_password(req.password))
    db.add(u)
    db.commit()
    db.refresh(u)
    return MeResponse(id=u.id, email=u.email)


@app.post("/auth/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    email = req.email.strip().lower()
    u = db.query(User).filter(User.email == email).first()
    if not u or not verify_password(req.password, u.password_hash):
        return JSONResponse(status_code=401, content={"detail": "invalid credentials"})

    token = generate_token()
    token_h = hash_token(token)

    at = AccessToken(token_hash=token_h, user_id=u.id)
    db.add(at)
    db.commit()

    return TokenResponse(access_token=token, token_type="bearer")


@app.get("/auth/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user)):
    return MeResponse(id=user.id, email=user.email)


@app.post("/api/v1/calc/run-guest", response_model=CalcResponse, responses={422: {"model": ErrorResponse}})
def run_guest(req: CalcRequest):
    return _make_calc_response(req, record_id=None)


@app.post("/api/v1/calc/run", response_model=CalcResponse, responses={422: {"model": ErrorResponse}})
def run_member(
    req: CalcRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _calc_and_save_record(db, user, req)


@app.post("/api/v1/calc/import/preview", response_model=ImportPreviewResponse)
async def import_preview(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    filename = (file.filename or "").lower()
    if not (filename.endswith(".xlsx") or filename.endswith(".xls")):
        raise HTTPException(status_code=422, detail="엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다.")

    raw_bytes = await file.read()
    try:
        df = pd.read_excel(io.BytesIO(raw_bytes))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"엑셀 파일을 읽을 수 없습니다: {e}")

    if len(df) == 0:
        raise HTTPException(status_code=422, detail="엑셀에 데이터 행이 없습니다.")
    if len(df) > _MAX_IMPORT_ROWS:
        raise HTTPException(status_code=422, detail=f"한 번에 업로드할 수 있는 행은 최대 {_MAX_IMPORT_ROWS}개입니다.")

    colmap = _build_import_column_map(list(df.columns))
    required = ("month", "revenue_vat_included", "cost_vat_included")
    if any(f not in colmap for f in required):
        raise HTTPException(
            status_code=422,
            detail="필수 컬럼(월, 매출, 비용)을 찾을 수 없습니다. 엑셀 첫 행에 '월', '매출', '비용' 컬럼이 있는지 확인해주세요.",
        )

    existing_months = {
        r.month
        for r in (
            db.query(Record.month)
            .filter(Record.user_id == user.id)
            .filter(Record.deleted_at.is_(None))
            .all()
        )
    }

    rows_out: List[ImportRowPreview] = []
    seen_months_in_file: Dict[str, int] = {}

    for idx, row in enumerate(df.to_dict(orient="records")):
        row_index = idx + 2  # 엑셀 1행은 헤더
        try:
            req = _row_to_calc_request(row, colmap)

            if req.month in seen_months_in_file:
                raise ValueError(
                    f"같은 엑셀 안에서 {req.month}가 {seen_months_in_file[req.month]}행과 중복됩니다. "
                    f"하나만 남기고 다시 업로드해주세요."
                )
            seen_months_in_file[req.month] = row_index

            resp = _make_calc_response(req, record_id=None)
            if isinstance(resp, JSONResponse):
                rows_out.append(
                    ImportRowPreview(row_index=row_index, ok=False, error="계산 실패(입력값을 확인해주세요).")
                )
                continue

            rows_out.append(
                ImportRowPreview(
                    row_index=row_index,
                    ok=True,
                    payload=req,
                    result=resp,
                    will_overwrite=req.month in existing_months,
                )
            )
        except ValueError as e:
            rows_out.append(ImportRowPreview(row_index=row_index, ok=False, error=str(e)))
        except Exception as e:
            rows_out.append(ImportRowPreview(row_index=row_index, ok=False, error=f"처리 중 오류: {e}"))

    valid_count = sum(1 for r in rows_out if r.ok)
    return ImportPreviewResponse(rows=rows_out, valid_count=valid_count, error_count=len(rows_out) - valid_count)


@app.post("/api/v1/calc/import/commit", response_model=ImportCommitResponse)
def import_commit(
    body: ImportCommitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not body.rows:
        raise HTTPException(status_code=422, detail="저장할 행이 없습니다.")
    if len(body.rows) > _MAX_IMPORT_ROWS:
        raise HTTPException(status_code=422, detail=f"한 번에 저장할 수 있는 행은 최대 {_MAX_IMPORT_ROWS}개입니다.")

    seen_months: set = set()
    results: List[ImportCommitItemResult] = []

    for req in body.rows:
        if req.month in seen_months:
            results.append(ImportCommitItemResult(month=req.month, ok=False, error="같은 요청 안에서 월이 중복되어 건너뜀"))
            continue
        seen_months.add(req.month)

        already_existed = (
            db.query(Record.id)
            .filter(Record.user_id == user.id)
            .filter(Record.month == req.month)
            .filter(Record.deleted_at.is_(None))
            .first()
            is not None
        )

        resp = _calc_and_save_record(db, user, req)
        if isinstance(resp, JSONResponse):
            try:
                body_data = json.loads(resp.body)
            except Exception:
                body_data = {}
            err_msg = (
                (body_data.get("error") or {}).get("message")
                or body_data.get("detail")
                or "계산/저장 실패"
            )
            results.append(ImportCommitItemResult(month=req.month, ok=False, error=err_msg))
            continue

        results.append(ImportCommitItemResult(month=req.month, ok=True, overwritten=already_existed))

    saved_count = sum(1 for r in results if r.ok)
    return ImportCommitResponse(results=results, saved_count=saved_count, failed_count=len(results) - saved_count)


@app.get("/api/v1/records", response_model=RecordListResponse)
def list_records(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = (
        db.query(Record)
        .filter(Record.user_id == user.id)
        .filter(Record.deleted_at.is_(None))
        .order_by(Record.created_at.desc())
        .limit(500)  # 월 1건으로 정리된 이후 기준 40년치 이상 — 엑셀 대량 업로드로 인한 누락 방지
    )
    items: List[RecordListItem] = []
    for r in q.all():
        items.append(
            RecordListItem(
                record_id=r.id,
                month=r.month,
                business_type_code=r.business_type_code,
                region_code=r.region_code,
                size_band=r.size_band,
                revenue_vat_included=r.revenue_vat_included,
                cost_vat_included=r.cost_vat_included,
                labor_cost=r.labor_cost,
                created_at=r.created_at.isoformat(),
            )
        )
    return RecordListResponse(items=items)


@app.delete("/api/v1/records/{record_id}")
def delete_record(
    record_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rec = (
        db.query(Record)
        .filter(Record.id == record_id)
        .filter(Record.user_id == user.id)
        .filter(Record.deleted_at.is_(None))
        .first()
    )
    if not rec:
        return JSONResponse(status_code=404, content={"detail": "record not found"})

    rec.deleted_at = datetime.utcnow()
    db.add(rec)
    db.commit()
    return {"ok": True, "record_id": record_id}


# ---------------------------------------------------------------------
# Static frontend (single-service deploy: API routes above take priority)
# ---------------------------------------------------------------------
_frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(_frontend_dir):
    app.mount("/", StaticFiles(directory=_frontend_dir, html=True), name="frontend")