# backend/app/routers_opportunity.py
from __future__ import annotations

import io
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.schemas.opportunity_v1 import AnalyzeRequest, SimulateRequest
from app.engine.sample_data import SAMPLE_BUSINESS_INFO, SAMPLE_MONTHLY_RECORDS
from app.engine.ts_pipeline import run_full_analysis, run_slider_simulation

router = APIRouter(prefix="/api/v2", tags=["ts-v2"])

_EXCEL_COLUMN_MAP = {
    "월": "month",
    "매출": "sales",
    "원재료비": "material_cost",
    "재료비": "material_cost",
    "인건비": "labor_cost",
    "임대료": "rent",
    "기타비용": "other_cost",
    "카드매출": "card_sales_amount",
    "현금영수증": "cash_receipt_amount",
    "면세농산물매입": "exempt_agri_purchase",
    "방문객수": "visit_count",
}

_REQUIRED_KEYS = ["month", "sales", "material_cost", "labor_cost", "rent", "other_cost"]


@router.get("/sample")
def get_sample_analysis() -> Dict[str, Any]:
    return run_full_analysis(business_info=SAMPLE_BUSINESS_INFO, monthly=SAMPLE_MONTHLY_RECORDS)


@router.get("/sample-info")
def get_sample_info() -> Dict[str, Any]:
    return {"business_info": SAMPLE_BUSINESS_INFO, "monthly": SAMPLE_MONTHLY_RECORDS}


@router.post("/analyze")
def analyze(req: AnalyzeRequest) -> Dict[str, Any]:
    monthly = [m.model_dump() for m in req.monthly]
    if not monthly:
        raise HTTPException(422, "월별 데이터가 없습니다.")
    business_info = req.business_info.model_dump()
    if not business_info.get("analysis_period_label"):
        months = sorted(m["month"] for m in monthly)
        business_info["analysis_period_label"] = (
            months[0] if months[0] == months[-1] else f"{months[0]} ~ {months[-1]}"
        )
    return run_full_analysis(business_info=business_info, monthly=monthly)


@router.post("/simulate")
def simulate(req: SimulateRequest) -> Dict[str, Any]:
    monthly = [m.model_dump() for m in req.monthly]
    if not monthly:
        raise HTTPException(422, "월별 데이터가 없습니다.")
    return run_slider_simulation(
        business_info=req.business_info.model_dump(), monthly=monthly, price_pct=req.price_pct
    )


def _parse_excel_to_monthly(raw: bytes) -> List[Dict[str, Any]]:
    try:
        df = pd.read_excel(io.BytesIO(raw))
    except Exception as e:
        raise HTTPException(422, f"엑셀 파일을 읽을 수 없습니다: {e}")

    df = df.rename(columns={k: v for k, v in _EXCEL_COLUMN_MAP.items() if k in df.columns})
    missing = [k for k in _REQUIRED_KEYS if k not in df.columns]
    if missing:
        raise HTTPException(
            422,
            "필수 컬럼이 없습니다: " + ", ".join(missing) + " (예: 월, 매출, 원재료비, 인건비, 임대료, 기타비용)",
        )

    records: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        rec = {
            "month": str(row.get("month")),
            "sales": int(row.get("sales") or 0),
            "material_cost": int(row.get("material_cost") or 0),
            "labor_cost": int(row.get("labor_cost") or 0),
            "rent": int(row.get("rent") or 0),
            "other_cost": int(row.get("other_cost") or 0),
            "card_sales_amount": int(row.get("card_sales_amount") or 0),
            "cash_receipt_amount": int(row.get("cash_receipt_amount") or 0),
            "exempt_agri_purchase": int(row.get("exempt_agri_purchase") or 0),
            "visit_count": int(row.get("visit_count") or 0),
        }
        records.append(rec)

    if not records:
        raise HTTPException(422, "엑셀에 데이터 행이 없습니다.")
    return records


@router.post("/upload")
async def upload_and_analyze(
    file: UploadFile = File(...),
    biz_type: str = Form("개인사업자"),
    tax_type: str = Form("일반과세자"),
    industry: str = Form("음식점업"),
    industry_detail: str = Form("한식"),
    prior_year_sales_vat_included: int = Form(0),
    store_name: Optional[str] = Form(None),
) -> Dict[str, Any]:
    raw = await file.read()
    monthly = _parse_excel_to_monthly(raw)

    taxpayer_type = "CORP" if "법인" in biz_type else "PERSONAL"
    business_info = {
        "store_name": store_name,
        "biz_type": biz_type,
        "tax_type": tax_type,
        "taxpayer_type": taxpayer_type,
        "industry": industry,
        "industry_detail": industry_detail,
        "industry_key": "FOODSVC",
        "prior_year_sales_vat_included": prior_year_sales_vat_included,
        "analysis_period_label": f"{monthly[0]['month']} ~ {monthly[-1]['month']}",
        "region_code": "ALL",
    }

    return run_full_analysis(business_info=business_info, monthly=monthly)
