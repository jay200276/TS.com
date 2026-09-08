# backend/app/schemas/opportunity_v1.py
from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class BusinessInfoIn(BaseModel):
    store_name: Optional[str] = None
    biz_type: str = "개인사업자"
    tax_type: str = "일반과세자"
    taxpayer_type: str = "PERSONAL"
    industry: str = "음식점업"
    industry_detail: str = "한식"
    industry_key: str = "FOODSVC"
    prior_year_sales_vat_included: int = 0
    analysis_period_label: Optional[str] = None
    region_code: str = "ALL"


class MonthlyRecordIn(BaseModel):
    month: str
    sales: int
    material_cost: int
    labor_cost: int
    rent: int
    other_cost: int
    card_sales_amount: int = 0
    cash_receipt_amount: int = 0
    exempt_agri_purchase: int = 0
    visit_count: int = 0


class AnalyzeRequest(BaseModel):
    business_info: BusinessInfoIn
    monthly: List[MonthlyRecordIn]


class SimulateRequest(BaseModel):
    business_info: BusinessInfoIn
    monthly: List[MonthlyRecordIn]
    price_pct: float = 0


class KpiCardOut(BaseModel):
    code: str
    label: str
    value: int
    unit: str
    comment: Optional[str] = None


class HealthOut(BaseModel):
    score_100: int
    grade: str


class TopChangeOut(BaseModel):
    headline: str
    detail: str


class AnalysisV2Response(BaseModel):
    business_info: Dict[str, Any]
    health: HealthOut
    kpi_cards: List[KpiCardOut]
    top_change: TopChangeOut
    diagnosis: List[Dict[str, Any]]
    opportunities: List[Dict[str, Any]]
    opportunity_summary_line: str
    scenarios: Dict[str, Any]
    monthly: List[Dict[str, Any]]
