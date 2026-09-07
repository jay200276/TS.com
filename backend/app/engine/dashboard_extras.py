"""'결과 분석' 대시보드에 필요한 부가 데이터: 예상 세금 개요, 업종 벤치마크, 데이터 입력 완성도, 할 일."""
from __future__ import annotations

from typing import Any, Dict, List

from .tax_engine import (
    EngineMeta,
    compute_income_tax,
    compute_local_income_tax,
    compute_insurance_employer_estimate,
)
from .official_db_reader import get_benchmark
from .business_type_mapper import map_detail_to_biz_code

# 업종 평균(중앙값) 기본값 - DB 벤치마크 조회 실패 시에만 쓰는 최종 폴백
# (실제 DB 값과 맞춰둠: get_benchmark(LABOR_RATIO/PROFIT_RATIO/COST_RATIO, region=ALL) 기준)
DEFAULT_BENCHMARK = {
    "LABOR_RATIO": 0.1353,
    "PROFIT_RATIO": 0.08,
    "COST_RATIO": 0.92,
}


def _vat_portion(gross: float) -> float:
    return max(0.0, gross) / 11.0


def build_tax_brief(*, business_info: Dict[str, Any], financial_summary: Dict[str, Any]) -> Dict[str, Any]:
    monthly = financial_summary["monthly"]
    months = max(1, len(monthly))
    annualize = 12.0 / months

    sum_sales = sum(m["sales"] for m in monthly)
    sum_material = sum(m["material_cost"] for m in monthly)
    sum_exempt = sum(m["exempt_agri_purchase"] for m in monthly)
    sum_rent = sum(m["rent"] for m in monthly)
    sum_other = sum(m["other_cost"] for m in monthly)
    sum_profit = sum(m["profit"] for m in monthly)
    sum_labor = sum(m["labor_cost"] for m in monthly)

    annual_taxable_base = (sum_sales / 1.1) * annualize
    output_vat = annual_taxable_base * 0.10

    taxable_purchase = max(0.0, sum_material - sum_exempt) + sum_rent + sum_other
    input_vat_credit = _vat_portion(taxable_purchase) * annualize

    vat_due_annual = max(0.0, output_vat - input_vat_credit)

    meta = EngineMeta()
    annual_profit = sum_profit * annualize
    insurance = compute_insurance_employer_estimate(
        employees_count=business_info.get("employees_count") or 2,
        payroll_total_month=(sum_labor / months),
        meta=meta,
        industry_code="FOODSVC",
        year=2026,
    )
    insurance_annual = insurance["total_employer"] * 12

    taxable_income = max(0.0, annual_profit - insurance_annual)
    income_tax = compute_income_tax(taxable_income=taxable_income, year=2026, meta=meta)
    local_income_tax = compute_local_income_tax(income_tax)

    total_burden = vat_due_annual + income_tax + local_income_tax + insurance_annual

    return {
        "vat_annual": int(round(vat_due_annual)),
        "income_local_tax_annual": int(round(income_tax + local_income_tax)),
        "insurance_annual": int(round(insurance_annual)),
        "total_burden_annual": int(round(total_burden)),
        "note": "간이 추정치입니다. 실제 신고 세액과 다를 수 있어 세무전문가 확인이 필요합니다.",
    }


def derive_size_band(revenue_vat_included: float) -> str:
    """main.py의 derive_size_band()와 동일 기준 (구버전 화면과 벤치마크 구간을 맞추기 위함)."""
    v = int(revenue_vat_included or 0)
    if v <= 10_000_000:
        return "BAND_0_10M"
    if v <= 30_000_000:
        return "BAND_10_30M"
    if v <= 50_000_000:
        return "BAND_30_50M"
    if v <= 100_000_000:
        return "BAND_50_100M"
    return "BAND_100M_PLUS"


def _real_benchmark_p50(*, metric: str, business_type_code: str, region_code: str, size_band: str) -> float:
    row = get_benchmark(
        metric=metric,
        region_code=region_code or "ALL",
        business_type_code=business_type_code or "FOOD_ALL",
        size_band=size_band,
    )
    if row and row.get("p50") is not None:
        return float(row["p50"])
    # 정확한 매출 구간에 데이터가 없으면 전체 평균(폴백)으로
    row = get_benchmark(
        metric=metric,
        region_code=region_code or "ALL",
        business_type_code=business_type_code or "FOOD_ALL",
        size_band="BAND_UNKNOWN",
    )
    if row and row.get("p50") is not None:
        return float(row["p50"])
    return DEFAULT_BENCHMARK[metric]


def build_benchmark_table(financial_summary: Dict[str, Any], business_info: Dict[str, Any]) -> List[Dict[str, Any]]:
    latest = financial_summary["latest"]
    biz_code = map_detail_to_biz_code(business_info.get("industry_detail"))
    region_code = business_info.get("region_code") or "ALL"
    size_band = derive_size_band(latest.get("sales"))

    specs = [
        ("LABOR_RATIO", "인건비율", latest.get("labor_ratio")),
        ("PROFIT_RATIO", "영업이익률", latest.get("profit_ratio")),
        ("COST_RATIO", "총비용률", 1 - (latest.get("profit_ratio") or 0)),
    ]
    rows = []
    for code, label, my_value in specs:
        bench = _real_benchmark_p50(metric=code, business_type_code=biz_code, region_code=region_code, size_band=size_band)
        diff_pp = None if my_value is None else round((my_value - bench) * 100, 1)
        rows.append(
            {
                "code": code,
                "label": label,
                "my_value_pct": round((my_value or 0) * 100, 1),
                "benchmark_pct": round(bench * 100, 1),
                "diff_pp": diff_pp,
            }
        )
    return rows


def build_data_completeness(*, business_info: Dict[str, Any], monthly: List[Dict[str, Any]]) -> Dict[str, Any]:
    checks = []
    checks.append(bool(business_info.get("store_name")))
    checks.append(bool(business_info.get("prior_year_sales_vat_included")))
    checks.append(all((m.get("card_sales_amount") or 0) > 0 for m in monthly))
    checks.append(all((m.get("cash_receipt_amount") or 0) > 0 for m in monthly))
    checks.append(all((m.get("exempt_agri_purchase") or 0) > 0 for m in monthly))
    checks.append(all((m.get("visit_count") or 0) > 0 for m in monthly))

    filled = sum(1 for c in checks if c)
    total = len(checks)
    pct = int(round(filled / total * 100))

    missing_note = None
    if not checks[4]:
        missing_note = "면세농산물 매입액이 입력되지 않아 관련 세액공제 분석 정확도가 낮습니다."
    elif not checks[1]:
        missing_note = "전년도 매출이 입력되지 않아 과세유형 판정 정확도가 낮습니다."

    return {"pct": pct, "filled": filled, "total": total, "missing_note": missing_note}


def build_todo_list(*, diagnosis: List[Dict[str, Any]], opportunities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    todos = []
    if diagnosis:
        top = diagnosis[0]
        todos.append(
            {
                "tag": "오늘",
                "title": f"{top['title']} 점검",
                "detail": top["ai_comment"],
            }
        )
    tax_opp = next((o for o in opportunities if o.get("category") == "절세 기회" and o.get("eligible")), None)
    if tax_opp:
        todos.append(
            {
                "tag": "7일",
                "title": f"{tax_opp['title']} 증빙 확인",
                "detail": (tax_opp.get("rule_meta") or {}).get("required_evidence", "관련 증빙 자료를 확인하세요."),
            }
        )
    return todos


def build_dashboard_extras(
    *,
    business_info: Dict[str, Any],
    monthly: List[Dict[str, Any]],
    financial_summary: Dict[str, Any],
    diagnosis: List[Dict[str, Any]],
    opportunities: List[Dict[str, Any]],
) -> Dict[str, Any]:
    tax_opps = [o for o in opportunities if o.get("category") == "절세 기회" and o.get("eligible")]
    max_credit = max((o.get("expected_credit", 0) for o in tax_opps), default=0)

    return {
        "tax_brief": build_tax_brief(business_info=business_info, financial_summary=financial_summary),
        "benchmark_table": build_benchmark_table(financial_summary, business_info),
        "data_completeness": build_data_completeness(business_info=business_info, monthly=monthly),
        "todo_list": build_todo_list(diagnosis=diagnosis, opportunities=opportunities),
        "opportunity_count": len(tax_opps),
        "opportunity_max_credit": int(round(max_credit)),
    }
