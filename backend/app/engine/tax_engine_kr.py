# backend/app/engine/tax_engine_kr.py  (FULL REPLACE)
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional, List, Literal, Tuple

from .official_db_kr import (
    get_simple_threshold,
    is_simple_excluded_area,
    get_deemed_rule,
    get_expense_ratio_rule,
    get_insurance_rates,
)

# (소득세율표는 아직 CSV/DB로 안 옮겼으니, 기존 hardcoded 테이블(있으면) 그대로 사용)
try:
    from .official_tables_kr import INCOME_TAX_BRACKETS_2023_2024  # type: ignore
except Exception:
    INCOME_TAX_BRACKETS_2023_2024 = []  # fallback


# ============================================================
# Helpers
# ============================================================
def clamp(n: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, n))


def annualize(monthly: int) -> int:
    return int(max(0, int(monthly)) * 12)


def vat_taxable_base_from_gross(gross_sales: int) -> int:
    # VAT 포함 총액 -> 과세표준(공급가) 단순 환산
    return int(round(max(0, int(gross_sales)) / 1.1))


def vat_portion_from_gross(gross_amount: int) -> int:
    # VAT 포함 총액에서 VAT(10/110) = 총액/11
    return int(round(max(0, int(gross_amount)) / 11))


def _pf(
    code: str,
    message: str = "",
    detail: Optional[str] = None,
    source_type: Literal["official", "public", "heuristic", "user_provided_official_capture"] = "official",
    confidence: float = 0.8,
) -> Dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "detail": detail,
        "source_type": source_type,
        "confidence": float(confidence),
    }


# ============================================================
# Engine Meta  (main.py가 meta.partial_failures를 dict 목록으로 쓰는 형태)
# ============================================================
@dataclass
class EngineMeta:
    source_type: Literal["user_provided_official_capture", "official", "public", "heuristic"] = "official"
    confidence: float = 0.8
    assumptions: List[str] = field(default_factory=list)
    partial_failures: List[Dict[str, Any]] = field(default_factory=list)
    debug: Dict[str, Any] = field(default_factory=dict)


# ============================================================
# (A) 소득세 (기존표 사용)
# ============================================================
def _calc_income_tax_2023_2024(tax_base: int) -> Tuple[int, Dict[str, Any]]:
    x = max(0, int(tax_base))
    if not INCOME_TAX_BRACKETS_2023_2024:
        # 표가 없으면 계산 불가 → 0 반환 + debug
        return 0, {"note": "INCOME_TAX_BRACKETS not available"}

    for b in INCOME_TAX_BRACKETS_2023_2024:
        upper = b.upper if b.upper is not None else 10**30
        if b.lower <= x < upper:
            tax = int(round(x * b.rate - b.quick_deduction))
            return max(0, tax), {
                "used_bracket": {
                    "lower": b.lower,
                    "upper": b.upper,
                    "rate": b.rate,
                    "quick_deduction": b.quick_deduction,
                }
            }

    b = INCOME_TAX_BRACKETS_2023_2024[-1]
    tax = int(round(x * b.rate - b.quick_deduction))
    return max(0, tax), {
        "used_bracket": {
            "lower": b.lower,
            "upper": b.upper,
            "rate": b.rate,
            "quick_deduction": b.quick_deduction,
        }
    }


# ============================================================
# (B) 간이/일반 판정: DB 기반 threshold + (선택) 배제지역
# ============================================================
def decide_taxpayer_type(
    *,
    prior_year_sales_vat_included: Optional[int] = None,
    current_annual_sales_vat_included: Optional[int] = None,
    region_code: str = "ALL",
    meta: Optional[EngineMeta] = None,
    # 배제지역 판정(정밀): 시/구/동까지 들어오면 적용
    region_si_do: Optional[str] = None,
    region_si_gun_gu: Optional[str] = None,
    region_eup_myeon_dong: Optional[str] = None,
    effective_date: str = "2026-01-01",
    year: int = 2026,
    **_kwargs: Any,
) -> str:
    # 간이/일반과세 판정은 법적으로 "전년도 매출" 기준이지만, 이 값이 없으면(quick 모드 등)
    # 무조건 0으로 간주해 항상 간이과세로 잘못 판정되던 문제가 있었음.
    # 전년도 매출이 없을 땐 이번 달 매출을 연 환산한 값을 대체 추정치로 사용.
    if prior_year_sales_vat_included and int(prior_year_sales_vat_included) > 0:
        annual_sales = int(prior_year_sales_vat_included)
    else:
        annual_sales = int(current_annual_sales_vat_included or 0)
        if meta and annual_sales > 0:
            meta.assumptions.append(
                "전년도 매출 미입력 - 이번 달 매출을 연 환산한 값으로 간이/일반과세 여부를 추정했습니다. "
                "실제 판정 기준은 전년도 매출입니다."
            )

    th = get_simple_threshold(year)
    if not th:
        if meta:
            meta.partial_failures.append(
                _pf(
                    "SIMPLE_THRESHOLD_NOT_FOUND",
                    "간이과세 기준(매출 상한) 테이블 조회 실패",
                    source_type="heuristic",
                    confidence=0.3,
                )
            )
        # 보수적으로 GENERAL
        return "GENERAL"

    upper = int(th["annual_sales_upper_vat_included"])
    is_simple = annual_sales < upper

    # 배제지역은 시/구/동 3개가 모두 있어야만 판정 (없으면 스킵)
    if is_simple:
        if region_si_do and region_si_gun_gu and region_eup_myeon_dong:
            excluded, row = is_simple_excluded_area(
                effective_date=effective_date,
                si_do=region_si_do,
                si_gun_gu=region_si_gun_gu,
                eup_myeon_dong=region_eup_myeon_dong,
            )
            if meta:
                meta.debug["simple_excluded_area_checked"] = {
                    "effective_date": effective_date,
                    "si_do": region_si_do,
                    "si_gun_gu": region_si_gun_gu,
                    "eup_myeon_dong": region_eup_myeon_dong,
                    "excluded": bool(excluded),
                }
            if excluded:
                if meta:
                    meta.debug["simple_excluded_area_hit"] = row
                return "GENERAL"
        else:
            # region_code가 ALL이면 애초에 체크 불가라 굳이 partial 안 쌓아도 됨
            if meta and region_code not in ("ALL", "", None):
                meta.partial_failures.append(
                    _pf(
                        "SIMPLE_EXCLUDED_AREA_NOT_CHECKED",
                        "배제지역 판정을 위해 시/군/구/동 정보가 필요합니다.",
                        detail=f"region_code={region_code}",
                        source_type="public",
                        confidence=0.6,
                    )
                )

    if meta:
        meta.debug["simple_threshold_used"] = th
        meta.debug["taxpayer_type_decision"] = {
            "annual_sales": annual_sales,
            "upper": upper,
            "result": "SIMPLE" if is_simple else "GENERAL",
        }

    return "SIMPLE" if is_simple else "GENERAL"


# ============================================================
# (C) 부가세 - 간이
# ============================================================
def compute_vat_simple(
    annual_sales_vat_included: Optional[int] = None,
    *,
    meta: Optional[EngineMeta] = None,
    industry_code: str = "FOODSVC",
    year: int = 2026,
    **_kwargs: Any,
) -> Dict[str, Any]:
    annual = int(annual_sales_vat_included or 0)
    month_sales = int(round(annual / 12)) if annual > 0 else 0

    # NOTE: 간이과세 업종별 부가가치율을 공식 테이블로 확장 가능.
    # 현재는 음식점(15%) 가정 → effective 1.5%
    simple_effective_rate = 0.015

    th = get_simple_threshold(year)
    exempt_upper = int(th["annual_sales_vat_exempt_upper_vat_included"]) if th and th.get("annual_sales_vat_exempt_upper_vat_included") else None
    is_exempt = exempt_upper is not None and annual < exempt_upper

    vat_due = 0 if is_exempt else int(round(month_sales * simple_effective_rate))

    notes = [
        "간이과세(음식점) 부가세는 업종 부가가치율 기반 단순 추정입니다. 업종별 부가가치율 공식 테이블화 시 정밀화됩니다."
    ]
    if is_exempt:
        notes.append(f"직전 연매출이 납부의무 면제 기준({exempt_upper:,}원) 미만이라 부가세 납부의무가 면제됩니다.")
    elif exempt_upper is None and meta:
        meta.partial_failures.append(
            _pf(
                "VAT_EXEMPT_THRESHOLD_NOT_FOUND",
                "간이과세 납부의무 면제 기준 테이블 조회 실패 - 면제 여부 미반영",
                source_type="heuristic",
                confidence=0.3,
            )
        )

    if meta:
        meta.debug.setdefault("vat_simple", {})
        meta.debug["vat_simple"].update(
            {
                "annual_sales_vat_included": annual,
                "month_sales_used": month_sales,
                "industry_code": industry_code,
                "effective_rate": simple_effective_rate,
                "year": year,
                "vat_exempt_upper": exempt_upper,
                "is_exempt": is_exempt,
            }
        )

    return {
        "taxpayer_type": "SIMPLE",
        "vat_method": "SIMPLE_EFFECTIVE",
        "simple_effective_rate": simple_effective_rate,
        "sales_month_gross": month_sales,
        "sales_annual_gross": annual,
        "vat_due_month": max(0, vat_due),
        "is_exempt": is_exempt,
        "notes": notes,
    }


# ============================================================
# (D) 부가세 - 일반 (의제매입 포함)
# ============================================================
def _tax_base_band_from_annual_sales(annual_sales: int) -> str:
    if annual_sales <= 100_000_000:
        return "LE_100M"
    if annual_sales <= 200_000_000:
        return "100M_200M"
    return "GT_200M"


def compute_vat_general(
    taxable_sales_vat_included: Optional[int] = None,
    purchase_vat_included_total: Optional[int] = None,
    exempt_agri_purchase_vat_exempt: Optional[int] = None,
    annual_sales_vat_included: Optional[int] = None,
    business_type_code: str = "FOOD_ALL",
    is_corporate: bool = False,
    *,
    meta: Optional[EngineMeta] = None,
    industry_code: str = "FOODSVC",
    year: int = 2026,
    **_kwargs: Any,
) -> Dict[str, Any]:
    sales_month_gross = int(taxable_sales_vat_included or 0)
    annual_sales_gross = int(annual_sales_vat_included or annualize(sales_month_gross))

    taxable_base_month = vat_taxable_base_from_gross(sales_month_gross)
    output_vat = int(round(taxable_base_month * 0.10))

    purchase_total = int(purchase_vat_included_total or 0)
    input_vat_credit = vat_portion_from_gross(purchase_total)

    deemed_credit = 0
    deemed_dbg: Dict[str, Any] = {}

    vat_exempt_purchase_month = int(exempt_agri_purchase_vat_exempt or 0)
    if vat_exempt_purchase_month <= 0:
        if meta:
            meta.partial_failures.append(
                _pf(
                    "DEEMED_INPUT_MISSING_INPUTS",
                    "면세 농산물 매입(의제매입) 입력이 없어 의제공제를 0으로 처리",
                    source_type="public",
                    confidence=0.7,
                )
            )
    else:
        band = _tax_base_band_from_annual_sales(annual_sales_gross)
        be = "CORPORATE" if is_corporate else "PERSONAL"
        ig = "FOODSVC"  # 현재는 음식업 그룹 단일 (확장 가능)

        rule = get_deemed_rule(year, be, ig, band)
        if not rule:
            if meta:
                meta.partial_failures.append(
                    _pf(
                        "DEEMED_RULE_NOT_FOUND",
                        "의제매입세액공제 룰 조회 실패",
                        detail=f"{year}/{be}/{ig}/{band}",
                        source_type="heuristic",
                        confidence=0.3,
                    )
                )
        else:
            num = int(rule["rate_numerator"])
            den = int(rule["rate_denominator"])
            limit_ratio = float(rule["limit_ratio"])

            # 공제세액(월) = 면세매입액 * (num/den)
            candidate = int(round(vat_exempt_purchase_month * (num / den)))

            # 한도(월) = 과세표준(월) * limit_ratio
            limit = int(round(max(0, taxable_base_month) * limit_ratio))
            deemed_credit = max(0, min(candidate, limit))

            deemed_dbg = {"rule": rule, "candidate": candidate, "limit": limit, "credit": deemed_credit}

            if meta:
                meta.debug["deemed_rule_used"] = rule

    vat_due = max(0, output_vat - input_vat_credit - deemed_credit)

    if meta:
        meta.debug.setdefault("vat_general", {})
        meta.debug["vat_general"].update(
            {
                "sales_month_gross": sales_month_gross,
                "annual_sales_gross": annual_sales_gross,
                "taxable_base_month": taxable_base_month,
                "output_vat_month": output_vat,
                "purchase_vat_included_total": purchase_total,
                "input_vat_credit_month_est": input_vat_credit,
                "exempt_agri_purchase_month": vat_exempt_purchase_month,
                "deemed_credit": deemed_credit,
                "vat_due_month": vat_due,
                "year": year,
                "business_type_code": business_type_code,
                "industry_code": industry_code,
            }
        )

    return {
        "taxpayer_type": "GENERAL",
        "vat_method": "GENERAL_BASIC",
        "vat_rate": 0.10,
        "sales_month_gross": sales_month_gross,
        "sales_annual_gross": annual_sales_gross,
        "taxable_base_month": taxable_base_month,
        "output_vat_month": output_vat,
        "input_vat_credit_month_est": input_vat_credit,
        "purchase_vat_included_total": purchase_total,
        "deemed_input_credit_month": deemed_credit,
        "deemed_debug": deemed_dbg,
        "vat_due_month": vat_due,
    }


# ============================================================
# (E) 종합소득세/지방소득세  (기존 흐름 유지: main.py가 이 값을 사용)
# ============================================================
def compute_income_tax(
    *,
    taxable_income: Optional[int] = None,
    year: Optional[int] = None,
    meta: Optional[EngineMeta] = None,
    **_kwargs: Any,
) -> int:
    base = int(taxable_income or 0)
    tax, dbg = _calc_income_tax_2023_2024(base)

    if meta:
        meta.debug.setdefault("income_tax", {})
        meta.debug["income_tax"].update(
            {
                "taxable_income": base,
                "year": int(year) if year is not None else None,
                "detail": dbg,
                "tax": tax,
            }
        )
        if tax == 0 and base > 0 and dbg.get("note"):
            meta.partial_failures.append(
                _pf(
                    "INCOME_TAX_TABLE_MISSING",
                    "소득세율표(누진구간) 테이블이 없어 0으로 계산됨",
                    detail=str(dbg.get("note")),
                    source_type="heuristic",
                    confidence=0.3,
                )
            )

    return int(tax)


def compute_local_income_tax(income_tax: Any) -> int:
    # 지방소득세 = 소득세의 10%
    try:
        return int(round(max(0, int(income_tax or 0)) * 0.10))
    except Exception:
        return 0


# ============================================================
# (F) 4대보험(사업주 부담) - DB 기반
#   ⚠️ main.py 호환을 위해 total_employer 키를 유지
# ============================================================
def compute_insurance_employer_estimate(
    *,
    employees_count: Optional[int] = None,
    payroll_total_month: Optional[int] = None,
    meta: Optional[EngineMeta] = None,
    industry_code: str = "FOODSVC",
    year: int = 2026,
    **_kwargs: Any,
) -> Dict[str, Any]:
    payroll = max(0, int(payroll_total_month or 0))
    rates = get_insurance_rates(year)
    by_item = {str(r.get("item") or "").strip().upper(): r for r in rates}

    # 국민연금: 기준소득월액 하한/상한 적용
    nps = by_item.get("NPS")
    pension_employer = 0
    if not nps:
        if meta:
            meta.partial_failures.append(
                _pf("INSURANCE_NPS_RATE_NOT_FOUND", "국민연금 요율 테이블 조회 실패", source_type="heuristic", confidence=0.3)
            )
    else:
        lo = int(float(nps["lower_bound"])) if nps.get("lower_bound") not in (None, "") else 0
        hi = int(float(nps["upper_bound"])) if nps.get("upper_bound") not in (None, "") else payroll
        base = int(clamp(payroll, lo, hi))
        pension_employer = int(round(base * float(nps["employer_rate"])))

    # 건강보험
    health = by_item.get("HEALTH")
    health_employer = 0
    if not health:
        if meta:
            meta.partial_failures.append(
                _pf("INSURANCE_HEALTH_RATE_NOT_FOUND", "건강보험 요율 테이블 조회 실패", source_type="heuristic", confidence=0.3)
            )
    else:
        health_employer = int(round(payroll * float(health["employer_rate"])))

    # 고용보험
    emp = by_item.get("EMPLOYMENT")
    employment_employer = 0
    if not emp:
        if meta:
            meta.partial_failures.append(
                _pf("INSURANCE_EMPLOYMENT_RATE_NOT_FOUND", "고용보험 요율 테이블 조회 실패", source_type="heuristic", confidence=0.3)
            )
    else:
        employment_employer = int(round(payroll * float(emp["employer_rate"])))

    # 산재보험: industry_code 매칭 (없으면 fallback)
    accident_rows = [r for r in rates if str(r.get("item") or "").strip().upper() == "ACCIDENT"]
    accident_rate = None
    for r in accident_rows:
        if str(r.get("industry_code") or "").strip() == str(industry_code).strip():
            accident_rate = float(r["employer_rate"])
            break

    if accident_rate is None:
        if meta:
            meta.partial_failures.append(
                _pf(
                    "ACCIDENT_RATE_FALLBACK",
                    "산재 업종요율 매칭 실패 → fallback 적용",
                    detail=f"industry_code={industry_code}",
                    source_type="public",
                    confidence=0.6,
                )
            )
        # 첫 row가 있으면 그걸(예: Q56211 0.95% 같은 것), 없으면 1.05%로
        accident_rate = float(accident_rows[0]["employer_rate"]) if accident_rows else 0.0105

    industrial_employer = int(round(payroll * accident_rate))

    total_employer = pension_employer + health_employer + employment_employer + industrial_employer

    if meta:
        meta.debug["insurance_rates_used"] = {
            "year": year,
            "items": sorted(list(by_item.keys())),
            "accident_rate_used": accident_rate,
            "industry_code": industry_code,
        }

    # ✅ main.py 호환: total_employer 유지 + 보조키 employer_total도 같이 제공
    return {
        "payroll_month_total": payroll,
        "pension_employer": pension_employer,
        "health_employer": health_employer,
        "employment_employer": employment_employer,
        "industrial_employer": industrial_employer,
        "industrial_rate_used": accident_rate,
        "total_employer": total_employer,
        "employer_total": total_employer,  # alias
        "employees_count": int(employees_count) if employees_count is not None else None,
        "details": {
            "pension_employer": pension_employer,
            "health_employer": health_employer,
            "employment_employer": employment_employer,
            "industrial_employer": industrial_employer,
            "industrial_rate_used": accident_rate,
        },
        "note": "사업주 부담분 단순 추정(상한/하한/추가요율/사업장 규모별 가산은 추후 정밀화)",
    }


# ============================================================
# (G) 경비율 힌트 - DB 기반
#   ✅ main.py 호환 위해 *args/**kwargs 유연하게 받음
# ============================================================
def compute_expense_ratio_hint(
    *args: Any,
    year: Optional[int] = None,
    meta: Optional[EngineMeta] = None,
    industry_code: Optional[str] = None,
    hometax_industry_code: Optional[str] = None,
    **kwargs: Any,
) -> Dict[str, Any]:
    # main.py가 어떤 이름으로 넘겨도 최대한 잡아먹기
    y = int(year or 2026)

    code = (industry_code or hometax_industry_code or "").strip()
    if not code and args:
        # 첫 번째 포지션이 업종코드일 수 있음
        try:
            code = str(args[0] or "").strip()
        except Exception:
            code = ""

    if not code:
        if meta:
            meta.partial_failures.append(
                _pf(
                    "EXPENSE_RATIO_MISSING_INDUSTRY_CODE",
                    "경비율 조회를 위해 업종코드가 필요",
                    source_type="public",
                    confidence=0.7,
                )
            )
        return {
            "year_applied": None,
            "hometax_industry_code": None,
            "standard": {"general_rate": None, "self_rate": None, "self_applicable": None},
            "simple": {"general_rate": None, "self_rate": None, "self_applicable": None},
            "meta": {
                "source_type": "public",
                "confidence": 0.6,
                "assumptions": ["업종코드 미입력으로 경비율 미적용"],
                "partial_failures": ["EXPENSE_RATIO_MISSING_INDUSTRY_CODE"],
            },
        }

    row = get_expense_ratio_rule(y, code)
    if not row:
        if meta:
            meta.partial_failures.append(
                _pf(
                    "EXPENSE_RATIO_RULE_NOT_FOUND",
                    "경비율 테이블에서 업종코드를 찾지 못함",
                    detail=f"{y}/{code}",
                    source_type="public",
                    confidence=0.6,
                )
            )
        return {
            "year_applied": None,
            "hometax_industry_code": code,
            "standard": {"general_rate": None, "self_rate": None, "self_applicable": None},
            "simple": {"general_rate": None, "self_rate": None, "self_applicable": None},
            "meta": {
                "source_type": "public",
                "confidence": 0.6,
                "assumptions": ["경비율 테이블 확장 필요(현재 일부 코드만 입력됨)"],
                "partial_failures": ["EXPENSE_RATIO_RULE_NOT_FOUND"],
            },
        }

    if meta:
        meta.debug["expense_ratio_rule_used"] = row

    return {
        "year_applied": int(row["year_applied"]),
        "hometax_industry_code": str(row["hometax_industry_code"]),
        "standard": {
            "general_rate": float(row["standard_main_rate"]),
            "self_rate": float(row["standard_other_rate"]),
            "self_applicable": None,
        },
        "simple": {
            "general_rate": float(row["simple_rate"]),
            "self_rate": None,
            "self_applicable": None,
        },
        "meta": {
            "source_type": "official",
            "confidence": 0.9,
            "assumptions": [],
            "partial_failures": [],
        },
    }