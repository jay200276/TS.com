"""Opportunity Rule Engine: 절세·공제·비용절감 등 놓친 기회를 법령 기반 Rule로 판정한다.

모든 룰은 rule_id/effective_from/eligibility/threshold/formula/limit/required_evidence/
source_url/updated_at 메타데이터를 갖는다 (세법이 바뀌어도 이 값만 갱신하면 됨).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .official_tables_kr import DEEMED_INPUT_RULES_2026

CARD_RECEIPT_CREDIT_RATE_2026 = 0.013
CARD_RECEIPT_CREDIT_ANNUAL_CAP_2026 = 10_000_000


def _rule_meta(
    rule_id: str,
    rule_name: str,
    *,
    effective_from: str,
    effective_to: Optional[str],
    eligibility: str,
    threshold: str,
    formula: str,
    limit: str,
    required_evidence: str,
    source_url: str,
) -> Dict[str, Any]:
    return {
        "rule_id": rule_id,
        "rule_name": rule_name,
        "effective_from": effective_from,
        "effective_to": effective_to,
        "eligibility": eligibility,
        "threshold": threshold,
        "formula": formula,
        "limit": limit,
        "required_evidence": required_evidence,
        "source_url": source_url,
        "updated_at": "2026-09-07",
    }


def _find_deemed_rule(taxpayer_type: str, industry_key: str, annual_sales: float):
    candidates = [
        r for r in DEEMED_INPUT_RULES_2026
        if r.industry_key == industry_key and r.taxpayer_type == taxpayer_type
    ]
    for r in candidates:
        upper = r.sales_upper if r.sales_upper is not None else float("inf")
        if r.sales_lower <= annual_sales < upper:
            return r
    return candidates[-1] if candidates else None


def find_deemed_input_opportunity(
    *, business_info: Dict[str, Any], monthly: List[Dict[str, Any]]
) -> Dict[str, Any]:
    taxpayer_type = business_info.get("taxpayer_type", "PERSONAL")
    industry_key = business_info.get("industry_key", "FOODSVC")
    annual_sales = float(business_info.get("prior_year_sales_vat_included") or 0)

    rule = _find_deemed_rule(taxpayer_type, industry_key, annual_sales)

    period_purchase = sum(float(m.get("exempt_agri_purchase") or 0) for m in monthly)
    period_sales_gross = sum(float(m.get("sales") or 0) for m in monthly)
    taxable_base = period_sales_gross / 1.1

    if not rule:
        return {
            "opportunity_id": "DEEMED_INPUT_VAT_CREDIT",
            "title": "면세농산물 등 의제매입세액공제",
            "eligible": False,
            "applicability": "확인 필요",
            "why": "현재 업종·과세유형 조합에 대한 공제 룰을 찾지 못했습니다.",
        }

    candidate = period_purchase * (rule.factor_num / rule.factor_den)
    limit_amount = taxable_base * rule.cap_rate
    credit_amount = max(0.0, min(candidate, limit_amount))
    limit_binding = candidate > limit_amount

    meta = _rule_meta(
        "DEEMED_INPUT_VAT_CREDIT",
        "면세농산물 등 의제매입세액공제",
        effective_from="2026-01-01",
        effective_to=None,
        eligibility=f"{('법인' if taxpayer_type=='CORP' else '개인')} 음식점업 사업자가 면세 농·축·수·임산물을 원재료로 사용",
        threshold=(
            f"직전 연도 매출(공급대가) {rule.sales_lower:,}원 이상 ~ {rule.sales_upper:,}원 미만 구간"
            if rule.sales_upper
            else f"직전 연도 매출(공급대가) {rule.sales_lower:,}원 이상 구간"
        ),
        formula=f"의제매입세액 = 면세 원재료 매입액 × {rule.factor_num}/{rule.factor_den}",
        limit=f"공제 한도 = 과세표준 × {rule.cap_rate*100:.0f}%",
        required_evidence="계산서·신용카드매출전표·현금영수증 등 적격증빙",
        source_url="https://www.law.go.kr/법령/부가가치세법/제42조",
    )

    return {
        "opportunity_id": "DEEMED_INPUT_VAT_CREDIT",
        "title": "면세농산물 등 의제매입세액공제",
        "category": "절세 기회",
        "eligible": True,
        "applicability": "적용 가능성 높음",
        "target_amount": int(round(period_purchase)),
        "target_amount_label": "확인된 대상 매입",
        "expected_credit": int(round(credit_amount)),
        "expected_credit_label": "예상 적용 가능 공제액",
        "limit_binding": limit_binding,
        "why": (
            f"{business_info.get('industry_detail','음식점')} 사업자로서 면세농산물 등을 원재료로 사용하고 있으며, "
            f"현재 입력된 사업자 정보와 거래내역 기준으로 공제 대상 가능성이 확인되었습니다. "
            f"2026년 현행 부가가치세법은 면세 농·축·수·임산물을 원재료로 사용하는 사업자에게 의제매입세액공제를 두고 있고, "
            f"음식점업은 사업자 유형과 과세표준에 따라 공제율이 달라집니다."
        ),
        "rule_meta": meta,
        "marginal_analysis": _deemed_input_marginal_analysis(rule, extra_amount=1_300_000),
        "disclaimer": "TS의 계산은 입력정보를 기반으로 한 예상치이며 실제 신고 전 최신 법령 및 세무전문가 확인이 필요합니다.",
    }


def _deemed_input_marginal_analysis(rule, *, extra_amount: float) -> Dict[str, Any]:
    """'기준 근접 알림' 대신, 이 공제는 언제나 매입액 < 공제액이므로(공제율<100%)
    절세만을 목적으로 한 추가 구매가 경제적으로 이득이 될 수 없음을 항상 계산으로 보여준다."""
    extra_credit = extra_amount * (rule.factor_num / rule.factor_den)
    net_effect = extra_credit - extra_amount
    return {
        "extra_spend": int(round(extra_amount)),
        "extra_credit": int(round(extra_credit)),
        "net_effect": int(round(net_effect)),
        "recommend": False,
        "verdict": "❌ 절세만을 위해 추가 구매하는 것은 권장하지 않습니다.",
        "note": "💡 다만 이미 계획된 지출이라면, 구매 시기를 이번 분석기간 내로 조정하는 것은 검토할 가치가 있습니다.",
    }


def find_card_receipt_opportunity(*, monthly: List[Dict[str, Any]]) -> Dict[str, Any]:
    period_card = sum(float(m.get("card_sales_amount") or 0) for m in monthly)
    period_cash = sum(float(m.get("cash_receipt_amount") or 0) for m in monthly)
    period_total = period_card + period_cash

    months = max(1, len(monthly))
    annualized_total = period_total / months * 12
    annualized_credit = annualized_total * CARD_RECEIPT_CREDIT_RATE_2026
    period_credit_raw = period_total * CARD_RECEIPT_CREDIT_RATE_2026

    over_cap = annualized_credit > CARD_RECEIPT_CREDIT_ANNUAL_CAP_2026
    capped_annual_credit = min(annualized_credit, CARD_RECEIPT_CREDIT_ANNUAL_CAP_2026)
    # 분석기간 비중만큼 한도를 안분
    period_credit = capped_annual_credit * (months / 12)

    meta = _rule_meta(
        "CARD_CASH_RECEIPT_CREDIT",
        "신용카드·현금영수증 발행 세액공제",
        effective_from="2026-01-01",
        effective_to="2026-12-31",
        eligibility="법인이 아닌 사업자로서 소매업·음식점업 등 소비자 상대 업종",
        threshold="연간 발행금액 기준, 매출 규모·법인 여부 등 제외조건 있음",
        formula="세액공제 = 신용카드·현금영수증 발행금액 × 1.3%",
        limit="연간 한도 1,000만원 (2026.12.31까지)",
        required_evidence="카드매출전표·현금영수증 발행 내역(POS 연동)",
        source_url="https://www.law.go.kr/법령/조세특례제한법/제126조의3",
    )

    return {
        "opportunity_id": "CARD_CASH_RECEIPT_CREDIT",
        "title": "신용카드·현금영수증 발행 세액공제",
        "category": "절세 기회",
        "eligible": True,
        "applicability": "한도 초과 주의" if over_cap else "적용 가능성 높음",
        "target_amount": int(round(period_total)),
        "target_amount_label": "분석기간 카드·현금영수증 발행액",
        "expected_credit": int(round(period_credit)),
        "expected_credit_label": "예상 적용 가능 공제액(분석기간 기준)",
        "annualized_credit_raw": int(round(annualized_credit)),
        "annual_cap": CARD_RECEIPT_CREDIT_ANNUAL_CAP_2026,
        "over_cap": over_cap,
        "why": (
            "POS 카드매출과 현금영수증 발행 내역 기준으로 연 환산 공제액을 추정했습니다. "
            + (
                f"연 환산 예상 공제액이 법정 한도(1,000만원)를 초과할 것으로 보여, 초과분은 공제받지 못할 수 있습니다."
                if over_cap
                else "현재 추세면 연간 한도 내에서 공제를 받을 수 있을 것으로 보입니다."
            )
        ),
        "rule_meta": meta,
        "disclaimer": "TS의 계산은 입력정보를 기반으로 한 예상치이며 실제 신고 전 최신 법령 및 세무전문가 확인이 필요합니다.",
    }


def find_breakeven_opportunity(*, financial_summary: Dict[str, Any]) -> Dict[str, Any]:
    latest = financial_summary["latest"]
    runway = financial_summary.get("runway_months_to_breakeven")
    mos = latest.get("margin_of_safety")
    bep = latest.get("breakeven_sales")

    if mos is None or bep is None:
        return {
            "opportunity_id": "BREAKEVEN_THRESHOLD",
            "title": "손익분기점 임계점",
            "eligible": False,
            "applicability": "확인 필요",
            "why": "손익분기점을 계산할 데이터가 부족합니다.",
        }

    is_above = mos >= 0

    if is_above and runway is not None and runway <= 6:
        why = (
            f"현재 매출은 손익분기점보다 {int(round(mos)):,}원 높지만, 최근 3개월 추세(인건비·원재료비 상승)가 "
            f"이어지면 약 {runway:.1f}개월 내 손익분기점 아래로 떨어질 수 있습니다."
        )
        applicability = "확인 필요"
    elif is_above:
        why = f"현재 매출은 손익분기점보다 {int(round(mos)):,}원 높아 안전마진을 확보하고 있습니다."
        applicability = "양호"
    else:
        why = f"현재 매출이 손익분기점보다 {int(round(abs(mos))):,}원 부족합니다."
        applicability = "확인 필요"

    return {
        "opportunity_id": "BREAKEVEN_THRESHOLD",
        "title": "손익분기점 임계점",
        "category": "경영 임계점",
        "eligible": True,
        "applicability": applicability,
        "breakeven_sales": int(round(bep)),
        "current_sales": int(round(latest["sales"])),
        "margin_of_safety": int(round(mos)),
        "runway_months": round(runway, 1) if runway is not None else None,
        "why": why,
        "rule_meta": None,
        "disclaimer": "세법에 근거한 계산이 아닌, 입력된 매출·비용 데이터를 기반으로 한 경영지표 추정치입니다.",
    }


def find_all_opportunities(
    *, business_info: Dict[str, Any], monthly: List[Dict[str, Any]], financial_summary: Dict[str, Any]
) -> List[Dict[str, Any]]:
    return [
        find_deemed_input_opportunity(business_info=business_info, monthly=monthly),
        find_card_receipt_opportunity(monthly=monthly),
        find_breakeven_opportunity(financial_summary=financial_summary),
    ]
