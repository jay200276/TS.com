# backend/app/engine/official_db_kr.py
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple
from sqlalchemy import text
from app.db import engine


def _fetchone(sql: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    with engine.connect() as conn:
        row = conn.execute(text(sql), params).mappings().first()
        return dict(row) if row else None


def _fetchall(sql: str, params: Dict[str, Any]) -> list[Dict[str, Any]]:
    with engine.connect() as conn:
        rows = conn.execute(text(sql), params).mappings().all()
        return [dict(r) for r in rows]


# ------------------------------------------------------------
# (1) 간이과세 매출 상한 (연매출, VAT 포함)
# ------------------------------------------------------------
def get_simple_threshold(year: int) -> Optional[Dict[str, Any]]:
    return _fetchone(
        """
        SELECT year_applied, effective_from, annual_sales_upper_vat_included,
               annual_sales_vat_exempt_upper_vat_included, source_title, source_url
        FROM official_vat_simple_thresholds
        WHERE year_applied = :year
        ORDER BY effective_from DESC
        LIMIT 1
        """,
        {"year": int(year)},
    )


# ------------------------------------------------------------
# (2) 간이과세 배제 지역 (현재는 "시/구/동" 단위 매칭)
# ------------------------------------------------------------
def is_simple_excluded_area(effective_date: str, si_do: str, si_gun_gu: str, eup_myeon_dong: str) -> Tuple[bool, Optional[Dict[str, Any]]]:
    row = _fetchone(
        """
        SELECT effective_from, si_do, si_gun_gu, eup_myeon_dong, note, source_title, source_url
        FROM official_simple_excluded_areas
        WHERE effective_from <= :d
          AND si_do = :sido
          AND si_gun_gu = :sigungu
          AND eup_myeon_dong = :emd
        ORDER BY effective_from DESC
        LIMIT 1
        """,
        {"d": effective_date, "sido": si_do, "sigungu": si_gun_gu, "emd": eup_myeon_dong},
    )
    return (row is not None), row


# ------------------------------------------------------------
# (3) 의제매입세액공제 룰 (연매출 밴드별)
# ------------------------------------------------------------
def get_deemed_rule(year: int, business_entity: str, industry_group: str, tax_base_band: str) -> Optional[Dict[str, Any]]:
    return _fetchone(
        """
        SELECT year_applied, business_entity, industry_group, tax_base_band,
               rate_numerator, rate_denominator, limit_ratio, source_title, source_url
        FROM official_deemed_input_rules
        WHERE year_applied = :year
          AND business_entity = :be
          AND industry_group = :ig
          AND tax_base_band = :band
        LIMIT 1
        """,
        {"year": int(year), "be": business_entity, "ig": industry_group, "band": tax_base_band},
    )


# ------------------------------------------------------------
# (4) 기준/단순 경비율 (홈택스 업종코드 기준)
# ------------------------------------------------------------
def get_expense_ratio_rule(year: int, hometax_industry_code: str) -> Optional[Dict[str, Any]]:
    return _fetchone(
        """
        SELECT year_applied, hometax_industry_code, industry_label,
               simple_rate, standard_main_rate, standard_other_rate,
               source_title, source_url
        FROM official_expense_ratio_rules
        WHERE year_applied = :year
          AND hometax_industry_code = :code
        LIMIT 1
        """,
        {"year": int(year), "code": str(hometax_industry_code)},
    )


# ------------------------------------------------------------
# (5) 4대보험 요율 (연도+항목)
# ------------------------------------------------------------
def get_insurance_rates(year: int) -> list[Dict[str, Any]]:
    return _fetchall(
        """
        SELECT year_applied, item, employer_rate, employee_rate,
               lower_bound, upper_bound, industry_code, source_title, source_url
        FROM official_insurance_rates
        WHERE year_applied = :year
        """,
        {"year": int(year)},
    )