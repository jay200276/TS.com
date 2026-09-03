# backend/app/schemas/analysis_v1.py  (FULL REPLACE)
from __future__ import annotations

from typing import List, Optional, Literal
from pydantic import BaseModel


# ============================================================
# Allowed metric codes (Contract First)
# - DB official_benchmarks.metric_code 와 1:1로 맞춤
# ============================================================
BenchmarkMetric = Literal[
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
]


class ExecutiveSummary(BaseModel):
    headline: str
    summary: List[str]


class KpiCard(BaseModel):
    code: str
    label: str
    value: float
    unit: str  # "ratio" | "krw" | ...
    level: str  # "GOOD" | "OK" | "WARN" | "RISK"
    comment: str


class BenchmarkItem(BaseModel):
    metric: BenchmarkMetric
    p25: Optional[float] = None
    p50: Optional[float] = None
    p75: Optional[float] = None
    my_value: Optional[float] = None
    diff_pp: Optional[float] = None  # ratio면 퍼센트포인트(×100), 금액이면 raw diff
    level: str = "UNKNOWN"  # "LOW" | "MID" | "HIGH" | "UNKNOWN"


class Benchmarks(BaseModel):
    version_key: Optional[str] = None
    region_code: str
    size_band: str
    items: List[BenchmarkItem]


class RiskDriver(BaseModel):
    code: str
    title: str
    detail: str


class Risk(BaseModel):
    score_100: int
    grade: str
    drivers: List[RiskDriver]


class TaxBriefVat(BaseModel):
    due_month: int
    due_year: int


class TaxBriefIncomeTax(BaseModel):
    due_year: int


class TaxBriefInsurance(BaseModel):
    employer_year: int


class TaxBrief(BaseModel):
    vat: TaxBriefVat
    income_tax: TaxBriefIncomeTax
    insurance: TaxBriefInsurance
    notes: List[str]


class Action(BaseModel):
    priority: str  # "P1" | "P2" | ...
    title: str
    why: str
    how: List[str] = []
    kpi_to_track: List[str] = []


class AnalysisV1(BaseModel):
    executive_summary: ExecutiveSummary
    kpi_cards: List[KpiCard]
    benchmarks: Benchmarks
    risk: Risk
    tax_brief: TaxBrief
    actions: List[Action]