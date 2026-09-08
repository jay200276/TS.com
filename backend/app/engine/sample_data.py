"""데모/체험용 샘플 POS·매입 데이터 (성수 한식당, 2026.03~08)."""
from __future__ import annotations

SAMPLE_BUSINESS_INFO = {
    "store_name": "성수한식당",
    "biz_type": "개인사업자",
    "tax_type": "일반과세자",
    "taxpayer_type": "PERSONAL",  # PERSONAL | CORP
    "industry": "음식점업",
    "industry_detail": "한식",
    "industry_key": "FOODSVC",
    "prior_year_sales_vat_included": 820_000_000,
    "analysis_period_label": "2026년 3월 ~ 8월",
    "region_code": "ALL",
}

SAMPLE_MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]

# 전부 부가세 포함(VAT-included) 금액, 원 단위
SAMPLE_MONTHLY_RECORDS = [
    {
        "month": "2026-03", "sales": 72_000_000, "material_cost": 24_800_000,
        "labor_cost": 18_400_000, "rent": 9_500_000, "other_cost": 4_600_000,
        "card_sales_amount": 58_000_000, "cash_receipt_amount": 7_500_000,
        "exempt_agri_purchase": 10_200_000, "visit_count": 5_180,
    },
    {
        "month": "2026-04", "sales": 71_600_000, "material_cost": 25_300_000,
        "labor_cost": 18_900_000, "rent": 9_500_000, "other_cost": 4_550_000,
        "card_sales_amount": 57_700_000, "cash_receipt_amount": 7_450_000,
        "exempt_agri_purchase": 10_450_000, "visit_count": 5_140,
    },
    {
        "month": "2026-05", "sales": 71_200_000, "material_cost": 25_900_000,
        "labor_cost": 19_500_000, "rent": 9_500_000, "other_cost": 4_600_000,
        "card_sales_amount": 57_400_000, "cash_receipt_amount": 7_400_000,
        "exempt_agri_purchase": 10_700_000, "visit_count": 5_100,
    },
    {
        "month": "2026-06", "sales": 70_900_000, "material_cost": 26_600_000,
        "labor_cost": 20_600_000, "rent": 9_500_000, "other_cost": 4_580_000,
        "card_sales_amount": 57_150_000, "cash_receipt_amount": 7_380_000,
        "exempt_agri_purchase": 10_950_000, "visit_count": 5_050,
    },
    {
        "month": "2026-07", "sales": 70_700_000, "material_cost": 27_400_000,
        "labor_cost": 21_800_000, "rent": 9_500_000, "other_cost": 4_560_000,
        "card_sales_amount": 57_000_000, "cash_receipt_amount": 7_350_000,
        "exempt_agri_purchase": 11_200_000, "visit_count": 5_000,
    },
    {
        "month": "2026-08", "sales": 70_600_000, "material_cost": 28_300_000,
        "labor_cost": 23_100_000, "rent": 9_500_000, "other_cost": 4_600_000,
        "card_sales_amount": 56_900_000, "cash_receipt_amount": 7_320_000,
        "exempt_agri_purchase": 11_500_000, "visit_count": 4_950,
    },
]
