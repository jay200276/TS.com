# backend/app/engines/official_tables_kr.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional, List, Dict


# =========================
# 1) 종합소득세 누진세율표 (2023~2024 귀속 캡처 기준)
# =========================
@dataclass(frozen=True)
class IncomeTaxBracket:
    lower: int                   # inclusive
    upper: Optional[int]         # exclusive, None = infinity
    rate: float                  # e.g. 0.06
    quick_deduction: int         # 누진공제(원)

INCOME_TAX_BRACKETS_2023_2024: List[IncomeTaxBracket] = [
    IncomeTaxBracket(0,          14_000_000,   0.06, 0),
    IncomeTaxBracket(14_000_000, 50_000_000,   0.15, 1_260_000),
    IncomeTaxBracket(50_000_000, 88_000_000,   0.24, 5_760_000),
    IncomeTaxBracket(88_000_000, 150_000_000,  0.35, 15_440_000),
    IncomeTaxBracket(150_000_000,300_000_000,  0.38, 19_940_000),
    IncomeTaxBracket(300_000_000,500_000_000,  0.40, 25_940_000),
    IncomeTaxBracket(500_000_000,1_000_000_000,0.42, 35_940_000),
    IncomeTaxBracket(1_000_000_000, None,      0.45, 65_940_000),
]


# =========================
# 2) 2026 간이과세 기준 (국세청/easyLaw 캡처 기준)
#  - 간이과세 적용 상한: 직전 연도 공급대가 1억 4천만원 미만
#  - 일반과세 전환: 1억 4천만원 초과
#  - 납부의무 면제: 4,800만원 미만 (부가세 전액 면제, 주석: 세금계산서 제외 등)
#  - 2026 신규 지역 배제(캡처): 서울 강남구/서초구(전 업종) 등
# =========================
@dataclass(frozen=True)
class SimpleVatThresholds:
    simple_upper_exclusive: int     # < 이면 간이 가능
    general_switch_inclusive: int   # >= 이면 일반 전환(간이 불가)
    vat_exempt_upper_exclusive: int # < 이면 납부의무 면제(간이 기준)

SIMPLE_VAT_THRESHOLDS_2026 = SimpleVatThresholds(
    simple_upper_exclusive=140_000_000,
    general_switch_inclusive=140_000_000,
    vat_exempt_upper_exclusive=48_000_000,
)

# 지역 배제(캡처에 나온 텍스트를 "규칙형 힌트"로만 사용)
SIMPLE_VAT_EXCLUDED_RULES_2026 = [
    # (region_hint, note)
    ("SEOUL_GANGNAM_SEOCHO", "서울 강남구·서초구: 전 업종 간이과세 불가(2026 개정 캡처 기준)"),
    ("SUWON_YEONGTONG_GOYANG_ILSANDONG_ILSANSEO", "수원 영통구, 고양 일산동·서구: 음식점·소매업 간이 불가(2026 개정 캡처 기준)"),
    ("NEW_TOWN_COMMERCIAL", "신도시 상권(판교·동탄 등): 지정 업종 간이 불가(2026 개정 캡처 기준)"),
]


# =========================
# 3) 2026 의제매입세액공제 룰 (법령+고시 캡처 기준)
#  - 계산식(캡처): 의제매입세액 *공제율* 중 [과세표준 × 한도율 × 환산계수] 이내 공제
#  - 일반음식점(개인): 1억 이하 9/109 & 75%, 1~2억 9/109 & 70%, 2억 초과 9/109 & 60%
#  - 제과/베이커리(개인): 2억 이하 8/108 & 65%, 2억 초과 8/108 & 55%
#  - 유흥음식점(개인): 전체 2/102 & 30%
#  - 법인음식점(전체): 전체 6/106 & 50%
# =========================
@dataclass(frozen=True)
class DeemedInputRule:
    industry_key: str             # "FOODSVC" etc (서비스 내부키)
    taxpayer_type: str            # "PERSONAL" | "CORP"
    sales_lower: int              # inclusive (연)
    sales_upper: Optional[int]    # exclusive (연), None = infinity
    factor_num: int               # e.g. 9
    factor_den: int               # e.g. 109
    credit_rate: float            # e.g. 0.75
    cap_rate: float               # 캡처: 75%/70%/60% 등을 "공제한도율(우대연장)"로 표시 -> 동일 수치로 저장

DEEMED_INPUT_RULES_2026: List[DeemedInputRule] = [
    # 일반음식점(개인)
    DeemedInputRule("FOODSVC", "PERSONAL", 0,          100_000_000, 9, 109, 0.75, 0.75),
    DeemedInputRule("FOODSVC", "PERSONAL", 100_000_000,200_000_000, 9, 109, 0.70, 0.70),
    DeemedInputRule("FOODSVC", "PERSONAL", 200_000_000,None,        9, 109, 0.60, 0.60),

    # 제과/베이커리(개인)
    DeemedInputRule("BAKERY", "PERSONAL", 0,          200_000_000, 8, 108, 0.65, 0.65),
    DeemedInputRule("BAKERY", "PERSONAL", 200_000_000,None,        8, 108, 0.55, 0.55),

    # 유흥(개인)
    DeemedInputRule("PUB",    "PERSONAL", 0,          None,        2, 102, 0.30, 0.30),

    # 법인 음식점(전체 업종키를 FOODSVC로 묶어 처리 — 추후 세분화 가능)
    DeemedInputRule("FOODSVC","CORP",     0,          None,        6, 106, 0.50, 0.50),
]


# =========================
# 4) 2026 경비율(국세청 고시 재확인 캡처) — 일부 업종코드만
#  - 적용 매출 상한: 3,600만원 미만(연 수입금액 기준)
#  - 단순경비율/기준경비율(기타경비) 제공
# =========================
EXPENSE_RATIO_APPLY_UPPER_EXCLUSIVE_2026 = 36_000_000

EXPENSE_RATIOS_2026_BY_HOMETAX_CODE: Dict[str, Dict[str, float]] = {
    "56111": {"simple": 0.897, "standard_other": 0.101},  # 한식 일반음식점
    "56112": {"simple": 0.875, "standard_other": 0.098},  # 한식 전문
    "56113": {"simple": 0.882, "standard_other": 0.105},  # 호프/보트집
    "56121": {"simple": 0.852, "standard_other": 0.112},  # 양식
    "56122": {"simple": 0.863, "standard_other": 0.105},  # 중식
    "56123": {"simple": 0.848, "standard_other": 0.110},  # 일식/횟집
    "56191": {"simple": 0.912, "standard_other": 0.087},  # 기타음식점(분식 등)
    "56192": {"simple": 0.825, "standard_other": 0.123},  # 패스트푸드
}


# =========================
# 5) 2026 4대보험 요율/상하한(캡처 기준)
#  - 국민연금: 총 9.5% (각 4.75%), 보수월액 하 400,000 / 상 6,370,000
#  - 건강보험: 총 7.19% (각 3.595%), 보수월액 상 9,183,480 (하한은 보험료 하한 20,160원 캡처)
#  - 고용보험: 총 2.7% (근로자 0.9%, 사업주 1.8%) (상하한 없음으로 표기)
#  - 산재보험: 업종별 0.7~18.6, 음식점 평균 1.47% (사업주 전액)
# =========================
@dataclass(frozen=True)
class InsuranceTable2026:
    pension_total_rate: float
    pension_employer_rate: float
    pension_min_wage: int
    pension_max_wage: int

    health_total_rate: float
    health_employer_rate: float
    health_max_wage: int
    health_min_premium: int  # 캡처: 20,160원(보험료)

    employment_total_rate: float
    employment_employer_rate: float

    industrial_employer_rate_avg_foodsvc: float

INSURANCE_2026 = InsuranceTable2026(
    pension_total_rate=0.095,
    pension_employer_rate=0.0475,
    pension_min_wage=400_000,
    pension_max_wage=6_370_000,

    health_total_rate=0.0719,
    health_employer_rate=0.03595,
    health_max_wage=9_183_480,
    health_min_premium=20_160,

    employment_total_rate=0.027,
    employment_employer_rate=0.018,

    industrial_employer_rate_avg_foodsvc=0.0147,
)