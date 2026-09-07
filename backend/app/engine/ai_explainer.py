"""AI 설명 계층: 숫자는 절대 만들지 않는다. Financial/Opportunity/Scenario Engine이 계산한
값을 받아 "무엇이 중요한지 / 왜 문제인지 / 무엇을 해야 하는지"만 문장으로 정리한다.

지금은 결정론적 템플릿으로 구현되어 있어(외부 LLM 호출 없음) 심사 기간 중 API 장애/지연
위험이 없다. 나중에 실제 LLM 호출로 바꾸더라도, 이 계층의 입출력 형태(숫자 dict -> 문장)는
그대로 유지하면 된다.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _fmt_won(v: Optional[float]) -> str:
    if v is None:
        return "-"
    return f"{int(round(v)):,}원"


def _fmt_pct(v: Optional[float], digits: int = 1) -> str:
    if v is None:
        return "-"
    sign = "+" if v > 0 else ""
    return f"{sign}{v:.{digits}f}%"


def _fmt_pp(v: Optional[float]) -> str:
    if v is None:
        return "-"
    sign = "+" if v > 0 else ""
    return f"{sign}{v:.1f}%p"


def build_top_change_headline(financial_summary: Dict[str, Any]) -> Dict[str, str]:
    """화면② 첫 번째 WOW 포인트: 'AI가 발견한 가장 중요한 변화'."""
    trend = financial_summary["trend"]
    sales_chg = trend.get("sales_change_pct")
    labor_chg = trend.get("labor_cost_change_pct")
    labor_share = financial_summary.get("labor_share_of_profit_decline_pct")

    if financial_summary["profit_change"] < 0 and labor_share is not None:
        headline = "매출보다 비용 증가가 문제입니다."
        detail = (
            f"최근 3개월 매출 {_fmt_pct(sales_chg)} · 인건비 {_fmt_pct(labor_chg)}. "
            f"순이익 감소의 약 {labor_share:.0f}%가 인건비 증가에서 발생했습니다."
        )
    elif financial_summary["profit_change"] >= 0:
        headline = "순이익이 개선되고 있습니다."
        detail = f"최근 3개월 매출 {_fmt_pct(sales_chg)} · 순이익 {_fmt_won(financial_summary['profit_change'])} 증가."
    else:
        headline = "비용 구조 변화를 확인해야 합니다."
        detail = f"최근 3개월 매출 {_fmt_pct(sales_chg)} · 인건비 {_fmt_pct(labor_chg)}."

    return {"headline": headline, "detail": detail}


def build_diagnosis_top3(financial_summary: Dict[str, Any]) -> List[Dict[str, Any]]:
    """화면③ AI 경영진단: 정확히 3개."""
    latest = financial_summary["latest"]
    prev = financial_summary["compare"]
    trend = financial_summary["trend"]

    items: List[Dict[str, Any]] = []

    labor_ratio_prev = prev.get("labor_ratio") or 0
    labor_ratio_latest = latest.get("labor_ratio") or 0
    items.append(
        {
            "severity": "RED",
            "icon": "🔴",
            "title": "인건비 부담",
            "metric_label": "매출 대비 인건비율",
            "value_from": f"{labor_ratio_prev*100:.1f}%",
            "value_to": f"{labor_ratio_latest*100:.1f}%",
            "ai_comment": (
                "매출 감소보다 인건비 증가 속도가 빠릅니다. 현재 추세가 유지될 경우 "
                "수익성이 추가로 악화될 가능성이 있습니다."
            ),
        }
    )

    material_chg = trend.get("material_cost_change_pct") or 0
    items.append(
        {
            "severity": "ORANGE",
            "icon": "🟠",
            "title": "원재료비 상승",
            "metric_label": "최근 3개월",
            "value_from": None,
            "value_to": _fmt_pct(material_chg),
            "ai_comment": "특히 농수산물 등 매입비 증가가 원가 상승의 주요 요인입니다.",
        }
    )

    ticket_prev = prev.get("avg_ticket") or 0
    ticket_latest = latest.get("avg_ticket") or 0
    visit_chg = trend.get("visit_count_change_pct")
    if ticket_latest >= ticket_prev:
        items.append(
            {
                "severity": "GREEN",
                "icon": "🟢",
                "title": "객단가 개선",
                "metric_label": "객단가",
                "value_from": _fmt_won(ticket_prev),
                "value_to": _fmt_won(ticket_latest),
                "ai_comment": (
                    "방문객 수는 감소했지만 객단가는 상승했습니다. 가격보다 방문객 회복이 우선 과제입니다."
                    if (visit_chg or 0) < 0
                    else "객단가가 개선되는 추세입니다."
                ),
            }
        )
    else:
        items.append(
            {
                "severity": "GREEN",
                "icon": "🟢",
                "title": "객단가 점검",
                "metric_label": "객단가",
                "value_from": _fmt_won(ticket_prev),
                "value_to": _fmt_won(ticket_latest),
                "ai_comment": "객단가가 낮아지는 추세입니다. 메뉴 구성과 가격 정책을 점검해볼 필요가 있습니다.",
            }
        )

    return items


def build_opportunity_summary_line(opportunities: List[Dict[str, Any]]) -> str:
    tax_opps = [o for o in opportunities if o.get("category") == "절세 기회" and o.get("eligible")]
    total = sum(o.get("expected_credit", 0) for o in tax_opps)
    if total <= 0:
        return "현재 확인된 절세 기회가 없습니다."
    return f"💰 TS가 놓친 절세 기회를 찾았습니다. 예상 세액공제 {_fmt_won(total)}"
