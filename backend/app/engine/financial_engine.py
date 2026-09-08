"""Financial Engine: 매출·비용·손익 계산. 모든 수치는 여기서 코드로만 계산한다 (AI는 숫자를 만들지 않음)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _ratio(num: float, den: float) -> Optional[float]:
    if not den:
        return None
    return num / den


def compute_month_metrics(m: Dict[str, Any]) -> Dict[str, Any]:
    sales = float(m["sales"])
    material = float(m["material_cost"])
    labor = float(m["labor_cost"])
    rent = float(m["rent"])
    other = float(m["other_cost"])
    total_cost = material + labor + rent + other
    profit = sales - total_cost
    visits = float(m.get("visit_count") or 0)

    fixed_cost = labor + rent + other
    material_ratio = _ratio(material, sales)
    breakeven_sales = None
    if material_ratio is not None and material_ratio < 1:
        breakeven_sales = fixed_cost / (1 - material_ratio)

    return {
        "month": m["month"],
        "sales": sales,
        "material_cost": material,
        "labor_cost": labor,
        "rent": rent,
        "other_cost": other,
        "total_cost": total_cost,
        "profit": profit,
        "profit_ratio": _ratio(profit, sales),
        "labor_ratio": _ratio(labor, sales),
        "material_ratio": material_ratio,
        "fixed_cost": fixed_cost,
        "breakeven_sales": breakeven_sales,
        "margin_of_safety": (sales - breakeven_sales) if breakeven_sales is not None else None,
        "avg_ticket": _ratio(sales, visits),
        "visit_count": visits,
        "card_sales_amount": float(m.get("card_sales_amount") or 0),
        "cash_receipt_amount": float(m.get("cash_receipt_amount") or 0),
        "exempt_agri_purchase": float(m.get("exempt_agri_purchase") or 0),
    }


def _pct_change(new: Optional[float], old: Optional[float]) -> Optional[float]:
    if new is None or old is None or old == 0:
        return None
    return (new - old) / old * 100.0


def _pp_change(new: Optional[float], old: Optional[float]) -> Optional[float]:
    if new is None or old is None:
        return None
    return (new - old) * 100.0


def compute_health_score(latest: Dict[str, Any], trend: Dict[str, Any]) -> Dict[str, Any]:
    score = 75.0

    pr = latest.get("profit_ratio")
    if pr is not None:
        if pr >= 0.15:
            score += 15
        elif pr >= 0.08:
            score += 5
        elif pr >= 0:
            score -= 3
        else:
            score -= 25

    labor_delta_pp = trend.get("labor_ratio_delta_pp")
    if labor_delta_pp is not None:
        if labor_delta_pp >= 5:
            score -= 10
        elif labor_delta_pp >= 2:
            score -= 5

    material_change = trend.get("material_cost_change_pct")
    if material_change is not None and material_change >= 8:
        score -= 5

    sales_change = trend.get("sales_change_pct")
    if sales_change is not None and sales_change < 0:
        score -= 3

    score = int(round(_clamp(score, 0, 100)))

    if score >= 80:
        grade = "우수"
    elif score >= 65:
        grade = "양호"
    elif score >= 50:
        grade = "주의 필요"
    elif score >= 35:
        grade = "위험"
    else:
        grade = "고위험"

    return {"score_100": score, "grade": grade}


def build_financial_summary(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """records: SAMPLE_MONTHLY_RECORDS 형태 (오래된 -> 최신 순)."""
    monthly = [compute_month_metrics(m) for m in records]
    latest = monthly[-1]
    prev_idx = -4 if len(monthly) >= 4 else 0
    prev = monthly[prev_idx]

    trend = {
        "compare_month": prev["month"],
        "sales_change_pct": _pct_change(latest["sales"], prev["sales"]),
        "labor_cost_change_pct": _pct_change(latest["labor_cost"], prev["labor_cost"]),
        "material_cost_change_pct": _pct_change(latest["material_cost"], prev["material_cost"]),
        "labor_ratio_delta_pp": _pp_change(latest["labor_ratio"], prev["labor_ratio"]),
        "material_ratio_delta_pp": _pp_change(latest["material_ratio"], prev["material_ratio"]),
        "avg_ticket_change_pct": _pct_change(latest["avg_ticket"], prev["avg_ticket"]),
        "visit_count_change_pct": _pct_change(latest["visit_count"], prev["visit_count"]),
    }

    # 순이익 변화 요인 분해 (매출/재료비/인건비/임대료/기타)
    profit_change = latest["profit"] - prev["profit"]
    contrib = {
        "sales": latest["sales"] - prev["sales"],
        "material_cost": -(latest["material_cost"] - prev["material_cost"]),
        "labor_cost": -(latest["labor_cost"] - prev["labor_cost"]),
        "rent": -(latest["rent"] - prev["rent"]),
        "other_cost": -(latest["other_cost"] - prev["other_cost"]),
    }
    labor_share_of_decline = None
    if profit_change < 0:
        decline = abs(profit_change)
        labor_drag = max(0.0, -contrib["labor_cost"])
        if decline > 0:
            labor_share_of_decline = labor_drag / decline * 100.0

    # 추세 기반 안전마진 소진 시점 추정 (선형 외삽)
    months_between = 3  # prev_idx=-4 vs latest=-1
    runway_months = None
    if latest.get("margin_of_safety") is not None and prev.get("margin_of_safety") is not None:
        mos_now = latest["margin_of_safety"]
        mos_prev = prev["margin_of_safety"]
        monthly_decline = (mos_prev - mos_now) / months_between
        if monthly_decline > 0 and mos_now > 0:
            runway_months = mos_now / monthly_decline

    health = compute_health_score(latest, trend)

    return {
        "monthly": monthly,
        "latest": latest,
        "compare": prev,
        "trend": trend,
        "profit_change": profit_change,
        "labor_share_of_profit_decline_pct": labor_share_of_decline,
        "runway_months_to_breakeven": runway_months,
        "health": health,
    }
