# backend/app/engine/analysis_engine.py  (FULL REPLACE)
from __future__ import annotations

from typing import Any, Dict, Optional, List, Tuple

from app.schemas.analysis_v1 import (
    AnalysisV1,
    ExecutiveSummary,
    KpiCard,
    Benchmarks,
    BenchmarkItem,
    Risk,
    RiskDriver,
    TaxBrief,
    TaxBriefVat,
    TaxBriefIncomeTax,
    TaxBriefInsurance,
    Action,
)

from app.engine.official_db_reader import get_benchmark


# ============================================================
# Helpers
# ============================================================
def _safe_int(x: Any, default: int = 0) -> int:
    try:
        if x is None:
            return default
        return int(x)
    except Exception:
        return default


def _safe_float(x: Any, default: Optional[float] = 0.0) -> Optional[float]:
    try:
        if x is None:
            return default
        return float(x)
    except Exception:
        return default


def _ratio(num: float, den: float) -> Optional[float]:
    try:
        den = float(den)
        if den <= 0:
            return None
        return float(num) / den
    except Exception:
        return None


def _pp(my_value: Optional[float], bench_value: Optional[float]) -> Optional[float]:
    if my_value is None or bench_value is None:
        return None
    return (float(my_value) - float(bench_value)) * 100.0


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _nonnull_str(x: Any) -> str:
    return str(x or "").strip()


def _pick_first_non_null(*vals):
    for v in vals:
        if v is not None:
            return v
    return None


def _as_dict(obj: Any) -> Dict[str, Any]:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj

    if hasattr(obj, "model_dump"):
        try:
            return obj.model_dump()
        except Exception:
            pass

    out: Dict[str, Any] = {}
    for k in dir(obj):
        if k.startswith("_"):
            continue
        try:
            val = getattr(obj, k)
        except Exception:
            continue
        if callable(val):
            continue
        out[k] = val
    return out


# ============================================================
# Schema-safe metric handling
# ============================================================
ALLOWED_BENCHMARK_METRICS = {
    "COST_RATIO",
    "LABOR_RATIO",
    "MATERIAL_RATIO",
    "RENT_RATIO",
    "OTHER_RATIO",
    "PROFIT_RATIO",
    "AVG_REVENUE_ANNUAL",
    "SALES_GROWTH_YOY",
    "AVG_TICKET_DINEIN",
    "AVG_TICKET_DELIVERY",
}

RATIO_METRICS = {
    "COST_RATIO",
    "LABOR_RATIO",
    "MATERIAL_RATIO",
    "RENT_RATIO",
    "OTHER_RATIO",
    "PROFIT_RATIO",
}

DEFAULT_BENCHMARKS: Dict[str, Dict[str, float]] = {
    "COST_RATIO": {"p25": 0.70, "p50": 0.85, "p75": 0.95},
    "LABOR_RATIO": {"p25": 0.18, "p50": 0.25, "p75": 0.35},
    "MATERIAL_RATIO": {"p25": 0.25, "p50": 0.35, "p75": 0.45},
    "RENT_RATIO": {"p25": 0.08, "p50": 0.12, "p75": 0.18},
    "OTHER_RATIO": {"p25": 0.08, "p50": 0.15, "p75": 0.25},
    "PROFIT_RATIO": {"p25": 0.05, "p50": 0.12, "p75": 0.18},
}


def _schema_metric_or_none(metric: Any) -> Optional[str]:
    m = str(metric or "").upper().strip()

    # 기존 코드에서 쓰던 비허용 지표를 스키마 허용 지표로 흡수
    if m in {"MARGIN_RATIO", "GROSS_MARGIN_RATIO", "OPERATING_MARGIN_RATIO"}:
        m = "PROFIT_RATIO"

    # TAX_BURDEN_RATIO는 현재 BenchmarkMetric Literal에 없으므로 benchmark item에서는 제외
    if m not in ALLOWED_BENCHMARK_METRICS:
        return None

    return m


def _metric_label(metric: str) -> str:
    m = _schema_metric_or_none(metric) or str(metric or "").upper()
    return {
        "COST_RATIO": "총비용률",
        "LABOR_RATIO": "인건비율",
        "MATERIAL_RATIO": "재료비율",
        "RENT_RATIO": "임대료율",
        "OTHER_RATIO": "기타비용률",
        "PROFIT_RATIO": "영업이익률",
        "AVG_REVENUE_ANNUAL": "연환산 매출",
        "SALES_GROWTH_YOY": "전년 대비 매출 성장률",
        "AVG_TICKET_DINEIN": "객단가(매장)",
        "AVG_TICKET_DELIVERY": "객단가(배달)",
    }.get(m, m)


def _fmt_pct(v: Optional[float]) -> str:
    if v is None:
        return "-"
    try:
        return f"{v * 100:.1f}%"
    except Exception:
        return "-"


def _fmt_pp(v: Optional[float]) -> str:
    if v is None:
        return "-"
    try:
        sign = "+" if v > 0 else ""
        return f"{sign}{v:.1f}%p"
    except Exception:
        return "-"


def _fmt_won(v: Optional[float]) -> str:
    if v is None:
        return "-"
    try:
        return f"{int(round(v)):,}원"
    except Exception:
        return "-"



def _append_unique_risk(drivers: List[RiskDriver], code: str, title: str, detail: str) -> None:
    key = (str(code), str(title), str(detail))
    existing = {(str(d.code), str(d.title), str(d.detail)) for d in drivers}
    if key not in existing:
        drivers.append(RiskDriver(code=code, title=title, detail=detail))


# ============================================================
# Absolute risk / score guard
# ============================================================
def _build_absolute_risk_drivers(
    revenue_month: float,
    monthly_profit: float,
    cost_ratio: Optional[float],
    labor_ratio: Optional[float],
    material_ratio: Optional[float],
    rent_ratio: Optional[float],
    other_ratio: Optional[float],
    profit_ratio: Optional[float],
    gross_profit_ratio: Optional[float],
    tax_burden_ratio: Optional[float],
) -> List[RiskDriver]:
    drivers: List[RiskDriver] = []

    if revenue_month <= 0:
        _append_unique_risk(
            drivers,
            "INPUT_OUTLIER",
            "매출 입력값 확인 필요",
            "월 매출이 0 이하입니다.",
        )
        return drivers

    if cost_ratio is not None and cost_ratio >= 1.0:
        _append_unique_risk(
            drivers,
            "COST_RATIO",
            "총비용 과다 리스크",
            f"총비용 {_fmt_pct(cost_ratio)} · 매출 초과",
        )
    elif cost_ratio is not None and cost_ratio >= 0.85:
        _append_unique_risk(
            drivers,
            "COST_RATIO",
            "총비용 부담 확대",
            f"총비용 {_fmt_pct(cost_ratio)}",
        )

    if labor_ratio is not None and labor_ratio >= 1.0:
        _append_unique_risk(
            drivers,
            "LABOR_RATIO",
            "인건비 입력값 또는 구조 재확인 필요",
            f"인건비 {_fmt_pct(labor_ratio)} · 입력값 확인 필요",
        )
    elif labor_ratio is not None and labor_ratio >= 0.40:
        _append_unique_risk(
            drivers,
            "LABOR_RATIO",
            "인건비 부담 리스크",
            f"인건비 {_fmt_pct(labor_ratio)}",
        )

    if material_ratio is not None and material_ratio >= 0.50:
        _append_unique_risk(
            drivers,
            "MATERIAL_RATIO",
            "재료비 부담 리스크",
            f"재료비 {_fmt_pct(material_ratio)}",
        )

    if rent_ratio is not None and rent_ratio >= 0.20:
        _append_unique_risk(
            drivers,
            "RENT_RATIO",
            "임대료 부담 리스크",
            f"임대료 {_fmt_pct(rent_ratio)}",
        )

    if other_ratio is not None and other_ratio >= 0.30:
        _append_unique_risk(
            drivers,
            "OTHER_RATIO",
            "기타비용 부담 리스크",
            f"기타비용 {_fmt_pct(other_ratio)}",
        )

    if profit_ratio is not None and profit_ratio < 0:
        _append_unique_risk(
            drivers,
            "PROFIT_RATIO",
            "적자 구조 리스크",
            f"월 이익률 {_fmt_pct(profit_ratio)} · 적자",
        )

    if profit_ratio is not None and profit_ratio <= -0.30:
        _append_unique_risk(
            drivers,
            "PROFIT_RATIO",
            "고위험 적자 상태",
            f"월 이익률 {_fmt_pct(profit_ratio)} · 고위험",
        )

    if profit_ratio is not None and profit_ratio <= -1.0:
        _append_unique_risk(
            drivers,
            "INPUT_OUTLIER",
            "입력값 이상치 가능성",
            f"월 이익률 {_fmt_pct(profit_ratio)} · 범위 이탈, 입력값 확인 필요",
        )

    # gross_profit_ratio / tax_burden_ratio는 BenchmarkItem에는 넣지 않고, RiskDriver/notes에서만 사용
    if gross_profit_ratio is not None and gross_profit_ratio < 0:
        _append_unique_risk(
            drivers,
            "PROFIT_RATIO",
            "매출총이익 구조 악화",
            f"매출총이익률 {_fmt_pct(gross_profit_ratio)} · 마이너스",
        )

    if tax_burden_ratio is not None and tax_burden_ratio >= 0.15:
        _append_unique_risk(
            drivers,
            "TAX_CASHFLOW",
            "세금 현금흐름 부담",
            f"세금·보험 부담률 {_fmt_pct(tax_burden_ratio)}",
        )

    if monthly_profit < 0 and abs(monthly_profit) >= max(revenue_month * 0.5, 1_000_000):
        _append_unique_risk(
            drivers,
            "PROFIT_RATIO",
            "월 손실 규모 확대",
            f"월 손실 {_fmt_won(abs(monthly_profit))}",
        )

    return drivers


def _apply_absolute_score_guard(
    score_100: int,
    profit_ratio: Optional[float],
    cost_ratio: Optional[float],
    labor_ratio: Optional[float],
) -> int:
    guarded = int(score_100)

    if (profit_ratio is not None and profit_ratio <= -1.0) or (cost_ratio is not None and cost_ratio >= 2.0) or (labor_ratio is not None and labor_ratio >= 1.0):
        guarded = min(guarded, 15)
    elif (profit_ratio is not None and profit_ratio <= -0.50) or (cost_ratio is not None and cost_ratio >= 1.50) or (labor_ratio is not None and labor_ratio >= 0.60):
        guarded = min(guarded, 25)
    elif (profit_ratio is not None and profit_ratio < 0) or (cost_ratio is not None and cost_ratio >= 1.00) or (labor_ratio is not None and labor_ratio >= 0.40):
        guarded = min(guarded, 40)

    return int(_clamp(float(guarded), 0, 100))


# ============================================================
# 업종 비교군 매핑
# ============================================================
def _normalize_industry_detail(detail: Optional[str]) -> str:
    s = _nonnull_str(detail)
    if not s:
        return "FOOD_ALL"

    table = {
        "백반/한식": "KOREAN",
        "찜·탕": "KOREAN",
        "고기": "KOREAN",
        "도시락": "KOREAN",
        "족발": "KOREAN",
        "기타(일반)": "KOREAN",
        "중식": "CHINESE",
        "일식": "JAPANESE",
        "치킨": "CHICKEN",
        "피자": "PIZZA",
        "패스트푸드": "FASTFOOD",
        "간식": "SNACK",
        "야식": "SNACK",
        "카페": "CAFE",
        "디저트": "DESSERT",
        "제과/베이커리": "BAKERY",
        "주점": "PUB",
        "아시아": "ASIAN_OTHER",
        "양식": "WESTERN",
    }
    return table.get(s, "FOOD_ALL")


def _peer_candidates(detail: Optional[str], business_type_code: Optional[str]) -> List[Tuple[str, str]]:
    normalized = _normalize_industry_detail(detail)
    base = _nonnull_str(business_type_code) or "FOOD_ALL"

    mapping = {
        "KOREAN": [("KOREAN", "한식"), ("FOOD_MEAL", "식사형 음식업"), (base, "음식업 전체")],
        "CHINESE": [("CHINESE", "중식"), ("FOOD_MEAL", "식사형 음식업"), (base, "음식업 전체")],
        "JAPANESE": [("JAPANESE", "일식"), ("FOOD_MEAL", "식사형 음식업"), (base, "음식업 전체")],
        "CHICKEN": [("CHICKEN", "치킨"), ("QSR", "패스트푸드/배달형"), (base, "음식업 전체")],
        "PIZZA": [("PIZZA", "피자"), ("QSR", "패스트푸드/배달형"), (base, "음식업 전체")],
        "FASTFOOD": [("FASTFOOD", "패스트푸드"), ("QSR", "패스트푸드/배달형"), (base, "음식업 전체")],
        "SNACK": [("SNACK", "간식/야식"), ("QSR", "간편식/패스트푸드"), (base, "음식업 전체")],
        "CAFE": [("CAFE", "카페"), ("CAFE_DESSERT", "카페/디저트"), (base, "음식업 전체")],
        "DESSERT": [("DESSERT", "디저트"), ("CAFE_DESSERT", "카페/디저트"), (base, "음식업 전체")],
        "BAKERY": [("BAKERY", "제과/베이커리"), ("CAFE_DESSERT", "카페/디저트"), (base, "음식업 전체")],
        "PUB": [("PUB", "주점"), ("DRINKING_FOOD", "주류취급 음식업"), (base, "음식업 전체")],
        "WESTERN": [("WESTERN", "양식"), ("FOOD_MEAL", "식사형 음식업"), (base, "음식업 전체")],
        "ASIAN_OTHER": [("ASIAN_OTHER", "아시아 음식"), ("FOOD_MEAL", "식사형 음식업"), (base, "음식업 전체")],
    }

    out = mapping.get(normalized, [(base, "음식업 전체")])

    dedup: List[Tuple[str, str]] = []
    seen = set()
    for code, label in out:
        key = (code, label)
        if key in seen:
            continue
        seen.add(key)
        dedup.append((code, label))
    return dedup


# ============================================================
# benchmark normalize / query
# ============================================================
def _default_benchmark_row(metric: str, region_code: str, business_type_code: str, size_band: str) -> Optional[Dict[str, Any]]:
    metric = _schema_metric_or_none(metric) or ""
    defaults = DEFAULT_BENCHMARKS.get(metric)
    if not defaults:
        return None

    return {
        "version_key": "DEFAULT_FALLBACK_V1",
        "region_code": region_code or "ALL",
        "business_type_code": business_type_code or "FOOD_ALL",
        "metric": metric,
        "size_band": size_band or "BAND_UNKNOWN",
        "avg": defaults.get("p50"),
        "p25": defaults.get("p25"),
        "p50": defaults.get("p50"),
        "p75": defaults.get("p75"),
        "is_default": True,
    }


def _normalize_benchmark_row(row: Any) -> Optional[Dict[str, Any]]:
    if row is None:
        return None

    d = _as_dict(row)
    metric = _schema_metric_or_none(_pick_first_non_null(d.get("metric"), d.get("metric_code")))
    if metric is None:
        return None

    return {
        "version_key": _pick_first_non_null(d.get("version_key"), d.get("bench_version_key")),
        "region_code": _pick_first_non_null(d.get("region_code"), d.get("bench_region_code")),
        "business_type_code": _pick_first_non_null(d.get("business_type_code"), d.get("peer_code")),
        "metric": metric,
        "size_band": _pick_first_non_null(d.get("size_band"), d.get("band_code")),
        "avg": _pick_first_non_null(
            _safe_float(d.get("avg"), None),
            _safe_float(d.get("mean"), None),
            _safe_float(d.get("p50"), None),
        ),
        "p25": _safe_float(d.get("p25"), None),
        "p50": _safe_float(d.get("p50"), None),
        "p75": _safe_float(d.get("p75"), None),
    }


def _call_get_benchmark_with_fallback(
    *,
    region_code: str,
    business_type_code: str,
    size_band: str,
    metric: str,
) -> Optional[Dict[str, Any]]:
    metric = _schema_metric_or_none(metric)
    if metric is None:
        return None

    try:
        row = get_benchmark(
            region_code=region_code,
            business_type_code=business_type_code,
            size_band=size_band,
            metric=metric,
        )
        normalized = _normalize_benchmark_row(row)
        if normalized:
            return normalized
    except Exception:
        pass

    return None


def _find_best_benchmark(
    *,
    region_code: str,
    business_type_code: str,
    business_type_detail: Optional[str],
    size_band: str,
    metric: str,
) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    metric = _schema_metric_or_none(metric)
    tried_codes: List[str] = []

    if metric is None:
        return None, {
            "peer_code": None,
            "peer_label": None,
            "matched": False,
            "tried_codes": tried_codes[:],
            "fallback_scope": "unsupported_metric",
        }

    for peer_code, peer_label in _peer_candidates(business_type_detail, business_type_code):
        tried_codes.append(peer_code)
        row = _call_get_benchmark_with_fallback(
            region_code=region_code,
            business_type_code=peer_code,
            size_band=size_band,
            metric=metric,
        )
        if row:
            return row, {
                "peer_code": peer_code,
                "peer_label": peer_label,
                "matched": True,
                "tried_codes": tried_codes[:],
                "fallback_scope": "exact_or_similar_or_food_all",
            }

    if region_code != "ALL":
        for peer_code, peer_label in _peer_candidates(business_type_detail, business_type_code):
            row = _call_get_benchmark_with_fallback(
                region_code="ALL",
                business_type_code=peer_code,
                size_band=size_band,
                metric=metric,
            )
            if row:
                return row, {
                    "peer_code": peer_code,
                    "peer_label": f"{peer_label}(전국 fallback)",
                    "matched": True,
                    "tried_codes": tried_codes[:],
                    "fallback_scope": "region_all_fallback",
                }

    default_row = _default_benchmark_row(metric, region_code, business_type_code, size_band)
    if default_row:
        return default_row, {
            "peer_code": business_type_code or "FOOD_ALL",
            "peer_label": "음식업 기본 기준값",
            "matched": True,
            "tried_codes": tried_codes[:],
            "fallback_scope": "default_threshold_fallback",
            "is_default": True,
        }

    return None, {
        "peer_code": None,
        "peer_label": None,
        "matched": False,
        "tried_codes": tried_codes[:],
        "fallback_scope": "not_found",
    }


# ============================================================
# level / scoring
# ============================================================
def _grade_by_ratio_low_good(value: Optional[float], p50: Optional[float], p75: Optional[float]) -> str:
    if value is None or p50 is None:
        return "UNKNOWN"
    if p75 is not None and value >= p75:
        return "RISK"
    if value >= p50:
        return "WARN"
    return "GOOD"


def _grade_by_ratio_high_good(value: Optional[float], p25: Optional[float], p50: Optional[float]) -> str:
    if value is None or p50 is None:
        return "UNKNOWN"
    if p25 is not None and value <= p25:
        return "RISK"
    if value <= p50:
        return "WARN"
    return "GOOD"


def _level_for_metric(metric: str, my_value: Optional[float], p25: Optional[float], p50: Optional[float], p75: Optional[float]) -> str:
    metric = _schema_metric_or_none(metric)

    if metric in {"COST_RATIO", "LABOR_RATIO", "MATERIAL_RATIO", "RENT_RATIO", "OTHER_RATIO"}:
        return _grade_by_ratio_low_good(my_value, p50, p75)

    if metric == "PROFIT_RATIO":
        return _grade_by_ratio_high_good(my_value, p25, p50)

    return "UNKNOWN"


def _score_from_levels(levels: List[str]) -> int:
    score = 85
    for lv in levels:
        if lv == "GOOD":
            score += 2
        elif lv == "WARN":
            score -= 8
        elif lv == "RISK":
            score -= 16
    return int(_clamp(score, 30, 95))


def _letter_grade(score_100: int) -> str:
    if score_100 >= 90:
        return "A"
    if score_100 >= 75:
        return "B"
    if score_100 >= 60:
        return "C"
    if score_100 >= 45:
        return "D"
    return "E"


# ============================================================
# 해석 문장
# ============================================================
def _comment_for_metric(
    metric: str,
    my_value: Optional[float],
    p25: Optional[float],
    p50: Optional[float],
    p75: Optional[float],
    peer_label: Optional[str],
) -> str:
    metric = _schema_metric_or_none(metric) or "PROFIT_RATIO"
    peer_txt = peer_label or "업종"

    if my_value is None or p50 is None:
        return "비교 기준 부족"

    diff = _pp(my_value, p50)
    return f"{_fmt_pct(my_value)} · {peer_txt} 중앙값 대비 {_fmt_pp(diff)}"


# ============================================================
# req / resp_dict / result 호환 처리
# ============================================================
def _coerce_inputs(
    result: Optional[Dict[str, Any]] = None,
    request_payload: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
    req: Any = None,
    resp_dict: Any = None,
) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
    result_dict = _as_dict(result)
    request_dict = _as_dict(request_payload)
    meta_dict = _as_dict(meta)

    if not request_dict and req is not None:
        request_dict = _as_dict(req)

    if not result_dict and resp_dict is not None:
        result_dict = _as_dict(resp_dict)

    if "result" in result_dict and isinstance(result_dict.get("result"), dict):
        inner_result = _as_dict(result_dict.get("result"))
        result_only = inner_result if inner_result else result_dict
    else:
        result_only = result_dict

    if not meta_dict:
        if isinstance(result_dict.get("meta"), dict):
            meta_dict = _as_dict(result_dict.get("meta"))
        elif isinstance(result_dict.get("debug"), dict):
            meta_dict = _as_dict(result_dict.get("debug"))

    return result_only, request_dict, meta_dict


# ============================================================
# Core
# ============================================================
def build_analysis_v1(
    result: Optional[Dict[str, Any]] = None,
    request_payload: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
    req: Any = None,
    resp_dict: Any = None,
) -> AnalysisV1:
    result, request_payload, meta = _coerce_inputs(
        result=result,
        request_payload=request_payload,
        meta=meta,
        req=req,
        resp_dict=resp_dict,
    )

    region_value = result.get("region") if isinstance(result.get("region"), dict) else {}
    business_value = result.get("business_type") if isinstance(result.get("business_type"), dict) else {}

    region_code = _nonnull_str(
        _pick_first_non_null(
            region_value.get("code"),
            request_payload.get("region_code"),
            "ALL",
        )
    ) or "ALL"

    business_type_code = _nonnull_str(
        _pick_first_non_null(
            business_value.get("code"),
            request_payload.get("business_type_code"),
            "FOOD_ALL",
        )
    ) or "FOOD_ALL"

    business_type_label = _nonnull_str(
        _pick_first_non_null(
            business_value.get("label"),
            request_payload.get("business_type_detail"),
            "음식업",
        )
    )

    business_type_detail = _pick_first_non_null(
        request_payload.get("business_type_detail"),
        result.get("business_type_detail"),
        business_type_label,
    )

    annualized = result.get("annualized") or {}
    derived = result.get("derived") or {}

    revenue_annual = _safe_float(annualized.get("revenue_vat_included"), 0.0) or 0.0
    cost_annual = _safe_float(annualized.get("cost_vat_included"), 0.0) or 0.0
    labor_annual = _safe_float(annualized.get("labor_cost"), 0.0) or 0.0

    revenue_month = revenue_annual / 12.0 if revenue_annual else 0.0
    cost_month = cost_annual / 12.0 if cost_annual else 0.0
    labor_month = labor_annual / 12.0 if labor_annual else 0.0

    monthly_profit = _safe_float(derived.get("monthly_profit_estimate"), None)
    if monthly_profit is None:
        monthly_profit = revenue_month - cost_month - labor_month

    gross_profit_ratio = _safe_float(derived.get("gross_margin_ratio"), None)
    profit_ratio = _safe_float(derived.get("profit_ratio"), None)
    if profit_ratio is None:
        profit_ratio = _safe_float(derived.get("margin_ratio"), None)

    labor_ratio = _safe_float(derived.get("labor_ratio"), None)

    cost_ratio = _ratio(cost_annual + labor_annual, revenue_annual)

    if profit_ratio is None:
        profit_ratio = _ratio(monthly_profit, revenue_month)
    if labor_ratio is None:
        labor_ratio = _ratio(labor_annual, revenue_annual)
    if gross_profit_ratio is None:
        gross_profit_ratio = _ratio(revenue_annual - cost_annual, revenue_annual)

    material_ratio = _safe_float(derived.get("material_ratio"), None)
    rent_ratio = _safe_float(derived.get("rent_ratio"), None)
    other_ratio = _safe_float(derived.get("other_ratio"), None)

    size_band = _nonnull_str(derived.get("size_band")) or "BAND_UNKNOWN"

    tax = result.get("tax") or {}
    vat = tax.get("vat") or {
        "due_month": result.get("vat_due_month"),
        "due_year": result.get("vat_due_year"),
        "monthly_estimate": result.get("vat_due_month"),
        "annual_estimate": result.get("vat_due_year"),
    }
    income_tax = tax.get("income_tax") or {
        "due_year": result.get("income_tax_due_year"),
        "annual_estimate": result.get("income_tax_due_year"),
    }
    insurance = tax.get("insurance") or {
        "employer_year": result.get("insurance_employer_year"),
        "annual_estimate": result.get("insurance_employer_year"),
    }

    vat_due_month = _safe_int(
        _pick_first_non_null(
            vat.get("due_month"),
            vat.get("monthly_estimate"),
            result.get("vat_due_month"),
            result.get("vat_month"),
            0,
        ),
        0,
    )
    vat_due_year = _safe_int(
        _pick_first_non_null(
            vat.get("due_year"),
            vat.get("annual_estimate"),
            result.get("vat_due_year"),
            result.get("vat_year"),
            vat_due_month * 12,
        ),
        0,
    )
    income_tax_due_year = _safe_int(
        _pick_first_non_null(
            income_tax.get("due_year"),
            income_tax.get("annual_estimate"),
            result.get("income_tax_due_year"),
            result.get("income_tax_year"),
            0,
        ),
        0,
    )
    insurance_employer_year = _safe_int(
        _pick_first_non_null(
            insurance.get("employer_year"),
            insurance.get("annual_estimate"),
            result.get("insurance_employer_year"),
            result.get("insurance_year"),
            0,
        ),
        0,
    )

    tax_burden_ratio = _ratio(vat_due_year + income_tax_due_year + insurance_employer_year, revenue_annual)

    # 중요:
    # BenchmarkItem.metric은 analysis_v1.BenchmarkMetric Literal을 통과해야 한다.
    # 따라서 MARGIN_RATIO, TAX_BURDEN_RATIO는 여기 넣지 않는다.
    metric_to_value = {
        "COST_RATIO": cost_ratio,
        "LABOR_RATIO": labor_ratio,
        "MATERIAL_RATIO": material_ratio,
        "RENT_RATIO": rent_ratio,
        "OTHER_RATIO": other_ratio,
        "PROFIT_RATIO": profit_ratio,
    }

    bench_items: List[BenchmarkItem] = []
    kpi_cards: List[KpiCard] = []
    bench_version_key = None
    bench_region_code = None
    matched_peer_label = None

    for raw_metric, my_value in metric_to_value.items():
        metric = _schema_metric_or_none(raw_metric)
        if metric is None or my_value is None:
            continue

        row, bench_meta = _find_best_benchmark(
            region_code=region_code,
            business_type_code=business_type_code,
            business_type_detail=business_type_detail,
            size_band=size_band,
            metric=metric,
        )

        peer_label = bench_meta.get("peer_label")
        if peer_label and not matched_peer_label:
            matched_peer_label = peer_label

        if not row:
            row = _default_benchmark_row(metric, region_code, business_type_code, size_band)
            if row and not matched_peer_label:
                matched_peer_label = "음식업 기본 기준값"

        if row:
            bench_version_key = bench_version_key or row.get("version_key")
            bench_region_code = bench_region_code or row.get("region_code") or region_code

            p25 = _safe_float(row.get("p25"), None)
            p50 = _safe_float(row.get("p50"), None)
            p75 = _safe_float(row.get("p75"), None)

            diff_pp = _pp(my_value, p50)
            level = _level_for_metric(metric, my_value, p25, p50, p75)

            bench_items.append(
                BenchmarkItem(
                    metric=metric,
                    my_value=my_value,
                    p25=p25,
                    p50=p50,
                    p75=p75,
                    diff_pp=diff_pp,
                    level=level,
                )
            )

            kpi_cards.append(
                KpiCard(
                    code=metric,
                    label=_metric_label(metric),
                    value=my_value,
                    unit="ratio",
                    level=level,
                    comment=_comment_for_metric(
                        metric=metric,
                        my_value=my_value,
                        p25=p25,
                        p50=p50,
                        p75=p75,
                        peer_label=peer_label or matched_peer_label,
                    ),
                )
            )
        else:
            kpi_cards.append(
                KpiCard(
                    code=metric,
                    label=_metric_label(metric),
                    value=my_value,
                    unit="ratio",
                    level="WARN",
                    comment="비교 기준이 충분하지 않아 현재 값 중심으로 해석했습니다.",
                )
            )

    levels = [str(getattr(x, "level", "UNKNOWN")) for x in kpi_cards]
    score_100 = _score_from_levels(levels)
    score_100 = _apply_absolute_score_guard(
        score_100=score_100,
        profit_ratio=profit_ratio,
        cost_ratio=cost_ratio,
        labor_ratio=labor_ratio,
    )
    grade = _letter_grade(score_100)

    benchmark_available = len(bench_items) > 0

    summary_lines: List[str] = []
    if not benchmark_available:
        summary_lines.append("벤치마크 부족 항목은 기본값으로 보완")

    if profit_ratio is not None:
        if profit_ratio >= 0.15:
            summary_lines.append(f"영업이익률 {_fmt_pct(profit_ratio)} · 양호")
        elif profit_ratio >= 0.05:
            summary_lines.append(f"영업이익률 {_fmt_pct(profit_ratio)} · 비용 관리 필요")
        elif profit_ratio >= 0:
            summary_lines.append(f"영업이익률 {_fmt_pct(profit_ratio)} · 낮음")
        elif profit_ratio <= -1.0:
            summary_lines.append(f"영업이익률 {_fmt_pct(profit_ratio)} · 범위 이탈, 입력값 확인 필요")
        else:
            summary_lines.append(f"영업이익률 {_fmt_pct(profit_ratio)} · 적자")

    if gross_profit_ratio is not None and gross_profit_ratio < 0:
        summary_lines.append(f"매출총이익률 {_fmt_pct(gross_profit_ratio)} · 마이너스")

    if cost_ratio is not None and cost_ratio >= 1.0:
        summary_lines.append(f"총비용 {_fmt_pct(cost_ratio)} · 매출 초과")
    elif cost_ratio is not None and cost_ratio >= 0.85:
        summary_lines.append(f"총비용 {_fmt_pct(cost_ratio)} · 부담 확대")

    if labor_ratio is not None and labor_ratio >= 1.0:
        summary_lines.append(f"인건비 {_fmt_pct(labor_ratio)} · 입력값 확인 필요")
    elif labor_ratio is not None and labor_ratio >= 0.40:
        summary_lines.append(f"인건비 {_fmt_pct(labor_ratio)} · 부담")

    if tax_burden_ratio is not None and tax_burden_ratio >= 0.12:
        summary_lines.append(f"세금·보험 부담률(연) {_fmt_pct(tax_burden_ratio)}")

    risk_sorted = [
        x for x in bench_items
        if getattr(x, "level", "") == "RISK" and getattr(x, "diff_pp", None) is not None
    ]
    risk_sorted.sort(key=lambda x: abs(float(x.diff_pp)), reverse=True)

    if risk_sorted:
        worst_item = risk_sorted[0]
        summary_lines.append(
            f"최대 편차: {_metric_label(worst_item.metric)} {_fmt_pp(worst_item.diff_pp)}"
        )
    elif benchmark_available:
        summary_lines.append("핵심 지표 중앙값 부근")

    if matched_peer_label:
        summary_lines.append(f"비교 기준: {matched_peer_label}")

    executive = ExecutiveSummary(
        headline=f"{business_type_label} 경영 진단 요약",
        summary=summary_lines,
    )

    risk_drivers: List[RiskDriver] = []

    absolute_risk_drivers = _build_absolute_risk_drivers(
        revenue_month=revenue_month,
        monthly_profit=monthly_profit,
        cost_ratio=cost_ratio,
        labor_ratio=labor_ratio,
        material_ratio=material_ratio,
        rent_ratio=rent_ratio,
        other_ratio=other_ratio,
        profit_ratio=profit_ratio,
        gross_profit_ratio=gross_profit_ratio,
        tax_burden_ratio=tax_burden_ratio,
    )
    for driver in absolute_risk_drivers:
        _append_unique_risk(risk_drivers, driver.code, driver.title, driver.detail)

    for item in bench_items:
        if getattr(item, "level", None) != "RISK":
            continue

        metric = item.metric
        diff_pp = _safe_float(item.diff_pp, None)
        title = f"{_metric_label(metric)} 리스크"
        detail = f"중앙값 대비 {_fmt_pp(diff_pp)}"

        _append_unique_risk(risk_drivers, metric, title, detail)

    risk = Risk(
        score_100=score_100,
        grade=grade,
        drivers=risk_drivers,
    )

    actions: List[Action] = []

    def _add_action(priority: str, title: str, why: str, how: List[str], kpis: List[str]):
        safe_kpis: List[str] = []
        for k in kpis:
            metric = _schema_metric_or_none(k)
            if metric and metric in RATIO_METRICS and metric not in safe_kpis:
                safe_kpis.append(metric)
        if not safe_kpis:
            safe_kpis = ["PROFIT_RATIO"]

        actions.append(
            Action(
                priority=priority,
                title=title,
                why=why,
                how=how,
                kpi_to_track=safe_kpis,
            )
        )

    risk_metrics = {d.code for d in risk_drivers}

    if "INPUT_OUTLIER" in risk_metrics:
        _add_action(
            "P1",
            "입력값 재확인",
            "입력 단위 오류 또는 큰 적자 감지",
            [
                "매출·비용·인건비 단위 재확인",
                "일회성 비용 구분 입력",
                "적자 원인을 고정비·변동비로 분리",
            ],
            ["COST_RATIO", "LABOR_RATIO", "PROFIT_RATIO"],
        )

    if "MATERIAL_RATIO" in risk_metrics or (material_ratio is not None and material_ratio >= 0.4):
        _add_action(
            "P1",
            "재료비 구조 점검",
            "재료비율 상승 시 이익 증가 제한",
            [
                "단가 인상 품목 우선 점검",
                "폐기율·포션 편차 확인",
                "메뉴별 원가표 재계산",
            ],
            ["MATERIAL_RATIO", "PROFIT_RATIO"],
        )

    if "LABOR_RATIO" in risk_metrics or (labor_ratio is not None and labor_ratio >= 0.25):
        _add_action(
            "P1",
            "인력 운영 효율화",
            "인건비율 상승 시 이익 잠식",
            [
                "피크 시간대 중심 스케줄 재편",
                "비생산 시간 인력 축소",
                "주간 단위 인건비율 관리",
            ],
            ["LABOR_RATIO", "PROFIT_RATIO"],
        )

    if "COST_RATIO" in risk_metrics:
        _add_action(
            "P1",
            "총비용 통제 계획 수립",
            "총비용률 상승 · 이익 방어력 약화",
            [
                "재료비·인건비·기타비 분리 추적",
                "월별 비용 상한 설정",
                "고정비·변동비 구분 관리",
            ],
            ["COST_RATIO", "PROFIT_RATIO"],
        )

    if "RENT_RATIO" in risk_metrics:
        _add_action(
            "P2",
            "고정비 재점검",
            "임대료 비중 높음 · 매출 변동에 취약",
            [
                "배달·포장으로 공간 효율 확대",
                "유휴 시간대 매출 보완",
                "임대 조건 재협상 검토",
            ],
            ["RENT_RATIO", "PROFIT_RATIO"],
        )

    if "PROFIT_RATIO" in risk_metrics or (profit_ratio is not None and profit_ratio < 0.08):
        _add_action(
            "P1",
            "수익성 회복 액션 실행",
            "영업이익률 낮음 · 납부기 현금흐름 압박 우려",
            [
                "저마진 메뉴 비중 조정",
                "가격 인상 가능 메뉴 선별",
                "배달 수수료·할인 정책 점검",
            ],
            ["PROFIT_RATIO"],
        )

    if tax_burden_ratio is not None and tax_burden_ratio >= 0.12:
        _add_action(
            "P2",
            "세금 현금흐름 준비",
            "세금·보험 부담률 높음",
            [
                "월별 세금 적립금 분리 관리",
                "부가세·소득세·보험료 납부월 캘린더 관리",
                "증빙 누락 여부 점검",
            ],
            ["PROFIT_RATIO"],
        )

    if not actions:
        _add_action(
            "P3",
            "현재 구조 모니터링 유지",
            "뚜렷한 이상 징후 없음 · 추세 관찰 권장",
            [
                "매출·비용·인건비 매월 기록",
                "직전 기록 대비 추세 비교",
                "벤치마크 갱신 후 재비교",
            ],
            ["COST_RATIO", "LABOR_RATIO", "PROFIT_RATIO"],
        )

    priority_order = {"P1": 1, "P2": 2, "P3": 3}
    actions.sort(key=lambda x: priority_order.get(str(x.priority), 99))

    notes: List[str] = []
    if tax_burden_ratio is not None:
        notes.append(f"총 세부담률(연): {_fmt_pct(tax_burden_ratio)}")
    if gross_profit_ratio is not None:
        notes.append(f"매출총이익률: {_fmt_pct(gross_profit_ratio)}")
    if matched_peer_label:
        notes.append(f"비교 기준: {matched_peer_label}")
    if bench_version_key:
        notes.append(f"benchmark version: {bench_version_key}")

    tax_brief = TaxBrief(
        vat=TaxBriefVat(
            due_month=vat_due_month,
            due_year=vat_due_year,
        ),
        income_tax=TaxBriefIncomeTax(
            due_year=income_tax_due_year,
        ),
        insurance=TaxBriefInsurance(
            employer_year=insurance_employer_year,
        ),
        notes=notes,
    )

    benchmarks = Benchmarks(
        version_key=bench_version_key or "UNKNOWN",
        region_code=bench_region_code or region_code,
        size_band=size_band,
        items=bench_items,
    )

    prior_year_sales = _safe_float(request_payload.get("prior_year_sales_vat_included"), None)
    if prior_year_sales and prior_year_sales > 0 and revenue_annual > 0:
        sales_growth_yoy = (revenue_annual - prior_year_sales) / prior_year_sales
        if sales_growth_yoy >= 0.05:
            yoy_level = "GOOD"
        elif sales_growth_yoy >= -0.05:
            yoy_level = "WARN"
        else:
            yoy_level = "RISK"
        kpi_cards.append(
            KpiCard(
                code="SALES_GROWTH_YOY",
                label=_metric_label("SALES_GROWTH_YOY"),
                value=sales_growth_yoy,
                unit="ratio",
                level=yoy_level,
                comment=(
                    f"이번 달 매출을 연환산({_fmt_won(revenue_annual)})해 "
                    f"직전연도 매출({_fmt_won(prior_year_sales)})과 비교한 추정치입니다."
                ),
            )
        )

    return AnalysisV1(
        executive_summary=executive,
        kpi_cards=kpi_cards,
        benchmarks=benchmarks,
        risk=risk,
        tax_brief=tax_brief,
        actions=actions,
    )


# ============================================================
# Compatibility aliases
# ============================================================
def build_analysis(
    result: Optional[Dict[str, Any]] = None,
    request_payload: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
    req: Any = None,
    resp_dict: Any = None,
) -> AnalysisV1:
    return build_analysis_v1(
        result=result,
        request_payload=request_payload,
        meta=meta,
        req=req,
        resp_dict=resp_dict,
    )


def generate_analysis_v1(
    result: Optional[Dict[str, Any]] = None,
    request_payload: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
    req: Any = None,
    resp_dict: Any = None,
) -> AnalysisV1:
    return build_analysis_v1(
        result=result,
        request_payload=request_payload,
        meta=meta,
        req=req,
        resp_dict=resp_dict,
    )
