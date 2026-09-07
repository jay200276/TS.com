"""Scenario Engine (Action Simulator): 행동 변화 시 금액을 재계산한다. 거래량은 유지된다고 가정."""
from __future__ import annotations

from typing import Any, Dict, List


def _recompute_profit(latest: Dict[str, Any], *, labor_pct: float = 0.0, price_pct: float = 0.0, material_pct: float = 0.0) -> float:
    sales = latest["sales"] * (1 + price_pct / 100.0)
    labor = latest["labor_cost"] * (1 - labor_pct / 100.0)
    material = latest["material_cost"] * (1 - material_pct / 100.0)
    rent = latest["rent"]
    other = latest["other_cost"]
    return sales - (material + labor + rent + other)


def build_default_scenarios(financial_summary: Dict[str, Any]) -> Dict[str, Any]:
    latest = financial_summary["latest"]
    base_profit = latest["profit"]

    options = [
        {
            "action_id": "LABOR_DOWN_5",
            "label": "인건비 5% 절감",
            "params": {"labor_pct": 5, "price_pct": 0, "material_pct": 0},
        },
        {
            "action_id": "PRICE_UP_3",
            "label": "객단가 3% 상승",
            "params": {"labor_pct": 0, "price_pct": 3, "material_pct": 0},
        },
        {
            "action_id": "MATERIAL_DOWN_3",
            "label": "원재료비 3% 절감",
            "params": {"labor_pct": 0, "price_pct": 0, "material_pct": 3},
        },
    ]

    results: List[Dict[str, Any]] = []
    for opt in options:
        new_profit = _recompute_profit(latest, **opt["params"])
        results.append(
            {
                "action_id": opt["action_id"],
                "label": opt["label"],
                "base_profit": int(round(base_profit)),
                "new_profit": int(round(new_profit)),
                "profit_delta": int(round(new_profit - base_profit)),
            }
        )

    results.sort(key=lambda r: r["profit_delta"], reverse=True)
    best = results[0] if results else None

    return {
        "base_profit": int(round(base_profit)),
        "options": results,
        "recommended": best,
        "recommendation_text": (
            f"{best['label']}을(를) 우선 검토하세요. 현재 거래량을 유지한다는 가정에서 세 방안 중 순이익 개선 효과가 가장 큽니다."
            if best else "시뮬레이션할 데이터가 부족합니다."
        ),
    }


def simulate_price_slider(financial_summary: Dict[str, Any], price_pct: float) -> Dict[str, Any]:
    latest = financial_summary["latest"]
    base_profit = latest["profit"]
    new_profit = _recompute_profit(latest, price_pct=price_pct)
    return {
        "price_pct": price_pct,
        "base_profit": int(round(base_profit)),
        "new_profit": int(round(new_profit)),
        "profit_delta": int(round(new_profit - base_profit)),
    }
