"""POS/매입 데이터 -> Financial Engine -> Opportunity Rule Engine -> Scenario Engine -> AI 설명
순서로 묶어 프론트 5개 화면이 그대로 쓸 수 있는 dict를 만든다."""
from __future__ import annotations

from typing import Any, Dict, List

from .financial_engine import build_financial_summary
from .opportunity_engine import find_all_opportunities
from .scenario_engine import build_default_scenarios, simulate_price_slider
from .ai_explainer import build_top_change_headline, build_diagnosis_top3, build_opportunity_summary_line
from .dashboard_extras import build_dashboard_extras


def _fmt_won(v) -> str:
    return f"{int(round(v)):,}원"


def _fmt_pct(v) -> str:
    if v is None:
        return "-"
    return f"{v*100:.1f}%"


def run_full_analysis(*, business_info: Dict[str, Any], monthly: List[Dict[str, Any]]) -> Dict[str, Any]:
    financial_summary = build_financial_summary(monthly)
    latest = financial_summary["latest"]

    kpi_cards = [
        {"code": "SALES", "label": "매출", "value": int(round(latest["sales"])), "unit": "krw", "comment": None},
        {"code": "COST", "label": "영업비용", "value": int(round(latest["total_cost"])), "unit": "krw", "comment": None},
        {"code": "PROFIT", "label": "순이익", "value": int(round(latest["profit"])), "unit": "krw", "comment": None},
        {
            "code": "PROFIT_RATIO",
            "label": "영업이익률",
            "value": round((latest.get("profit_ratio") or 0) * 100, 1),
            "unit": "percent",
            "comment": None,
        },
        {
            "code": "BREAKEVEN",
            "label": "손익분기점",
            "value": int(round(latest.get("breakeven_sales") or 0)),
            "unit": "krw",
            "comment": None,
        },
    ]

    opportunities = find_all_opportunities(
        business_info=business_info, monthly=monthly, financial_summary=financial_summary
    )
    scenarios = build_default_scenarios(financial_summary)
    diagnosis = build_diagnosis_top3(financial_summary)

    extras = build_dashboard_extras(
        business_info=business_info,
        monthly=monthly,
        financial_summary=financial_summary,
        diagnosis=diagnosis,
        opportunities=opportunities,
    )

    return {
        "business_info": business_info,
        "health": financial_summary["health"],
        "kpi_cards": kpi_cards,
        "top_change": build_top_change_headline(financial_summary),
        "diagnosis": diagnosis,
        "opportunities": opportunities,
        "opportunity_summary_line": build_opportunity_summary_line(opportunities),
        "scenarios": scenarios,
        "monthly": financial_summary["monthly"],
        "tax_brief": extras["tax_brief"],
        "benchmark_table": extras["benchmark_table"],
        "data_completeness": extras["data_completeness"],
        "todo_list": extras["todo_list"],
        "opportunity_count": extras["opportunity_count"],
        "opportunity_max_credit": extras["opportunity_max_credit"],
    }


def run_slider_simulation(*, business_info: Dict[str, Any], monthly: List[Dict[str, Any]], price_pct: float) -> Dict[str, Any]:
    financial_summary = build_financial_summary(monthly)
    return simulate_price_slider(financial_summary, price_pct)
