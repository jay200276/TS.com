# -*- coding: utf-8 -*-
"""
TS(세무비서) 세금 계산 방법론 문서 생성 스크립트.
backend/app/engine/tax_engine_kr.py, official_tables_kr.py, backend/data/official/*.csv
에 실제로 반영되어 있는 계산식/기준값을 그대로 옮겨 기록한다.
"""
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

wb = Workbook()

NAVY = "182459"
NAVY2 = "0E1638"
LIGHT = "EEF1F8"
WHITE = "FFFFFF"
GRAY = "6B7280"
GREEN = "0E7C3F"
RED = "B3261E"

title_font = Font(name="맑은 고딕", size=16, bold=True, color=WHITE)
h1_font = Font(name="맑은 고딕", size=13, bold=True, color=WHITE)
h2_font = Font(name="맑은 고딕", size=11, bold=True, color=NAVY)
label_font = Font(name="맑은 고딕", size=10, bold=True, color=WHITE)
body_font = Font(name="맑은 고딕", size=10, color="111827")
note_font = Font(name="맑은 고딕", size=9, italic=True, color=GRAY)
mono_font = Font(name="Consolas", size=10, color="111827")

title_fill = PatternFill("solid", fgColor=NAVY)
h1_fill = PatternFill("solid", fgColor=NAVY)
label_fill = PatternFill("solid", fgColor=NAVY2)
alt_fill = PatternFill("solid", fgColor=LIGHT)

thin = Side(style="thin", color="D1D5DB")
border = Border(left=thin, right=thin, top=thin, bottom=thin)

wrap = Alignment(wrap_text=True, vertical="top")
wrap_center = Alignment(wrap_text=True, vertical="center")


def style_title_row(ws, row, text, span, height=30):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = title_font
    c.fill = title_fill
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[row].height = height
    for col in range(1, span + 1):
        ws.cell(row=row, column=col).fill = title_fill


def style_section(ws, row, text, span):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = h1_font
    c.fill = h1_fill
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[row].height =22
    for col in range(1, span + 1):
        ws.cell(row=row, column=col).fill = h1_fill


def header_row(ws, row, headers, widths=None):
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=row, column=i, value=h)
        c.font = label_font
        c.fill = label_fill
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = border
    ws.row_dimensions[row].height = 26


def data_row(ws, row, values, alt=False, bold_first=False):
    for i, v in enumerate(values, start=1):
        c = ws.cell(row=row, column=i, value=v)
        c.font = Font(name="맑은 고딕", size=10, bold=(bold_first and i == 1), color="111827")
        c.alignment = wrap
        c.border = border
        if alt:
            c.fill = alt_fill


def note(ws, row, text, span):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = note_font
    c.alignment = wrap


def set_widths(ws, widths):
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


# ============================================================
# 0) 표지 / 개요
# ============================================================
ws = wb.active
ws.title = "개요"
set_widths(ws, [26, 60, 20, 20])

style_title_row(ws, 1, "TS(세무비서) 세금 계산 방법론 및 근거자료", 4, height=40)
ws.cell(row=2, column=1, value="문서 목적").font = h2_font
note(ws, 3,
     "TS 서비스가 부가가치세·종합소득세·4대보험을 어떤 계산식과 어떤 공식 기준값으로 추정하는지 정리한 근거 문서입니다. "
     "모든 계산식과 기준값은 backend/app/engine/tax_engine_kr.py, official_tables_kr.py, backend/data/official/*.csv 에 "
     "실제로 구현되어 있는 코드를 그대로 옮긴 것입니다(설명용 재작성이 아님).", 4)

r = 5
ws.cell(row=r, column=1, value="기준일").font = label_font
ws.cell(row=r, column=1).fill = label_fill
ws.cell(row=r, column=2, value="2026-09-03").font = body_font
r += 1
ws.cell(row=r, column=1, value="적용 대상").font = label_font
ws.cell(row=r, column=1).fill = label_fill
ws.cell(row=r, column=2, value="음식점업 개인사업자(간이과세자/일반과세자), quick(기본) 계산 모드 기준").font = body_font
r += 1
ws.cell(row=r, column=1, value="근거 코드").font = label_font
ws.cell(row=r, column=1).fill = label_fill
ws.cell(row=r, column=2, value="backend/app/engine/tax_engine_kr.py, official_tables_kr.py, official_db_kr.py").font = mono_font
r += 1
ws.cell(row=r, column=1, value="근거 데이터").font = label_font
ws.cell(row=r, column=1).fill = label_fill
ws.cell(row=r, column=2, value="backend/data/official/vat_simple_thresholds.csv, deemed_input_rules.csv, expense_ratio_rules.csv, insurance_rates.csv").font = mono_font

r += 2
style_section(ws, r, "이 문서에 포함된 시트", 4)
r += 1
sheet_list = [
    ("부가세_간이과세", "간이과세 판정 기준, 부가가치율, 납부의무 면제, 계산식과 예시"),
    ("부가세_일반과세", "매출세액-매입세액-의제매입세액공제 계산식, 의제매입세액공제율표, 예시"),
    ("종합소득세", "누진세율표, 계산식, 예시, 반영되지 않은 항목(한계) 명시"),
    ("지방소득세_4대보험", "지방소득세 10%, 4대보험(국민연금/건강보험/고용보험/산재보험) 요율표"),
    ("경비율", "국세청 고시 경비율표(업종코드별, 일부만 등록됨)"),
    ("검증사례", "실제 서버에 요청을 보내 확인한 계산 결과 — 오류 수정 전/후 비교 포함"),
    ("출처", "각 기준값의 법령/공식 출처"),
]
header_row(ws, r, ["시트명", "내용"])
r += 1
for i, (a, b) in enumerate(sheet_list):
    data_row(ws, r, [a, b], alt=(i % 2 == 1))
    r += 1

r += 1
style_section(ws, r, "핵심 한계(반드시 함께 읽어주세요)", 4)
r += 1
limits = [
    "모든 결과는 입력값 기준 추정치이며, 실제 신고세액과 다를 수 있습니다.",
    "종합소득세 과세표준은 quick 모드에서 '매출-비용(추정 순이익)'을 그대로 사용합니다. "
    "기본공제(1인당 150만원)·국민연금보험료 소득공제·세액공제 등 인적공제는 반영되지 않습니다.",
    "간이/일반과세 판정은 원칙적으로 전년도 매출 기준입니다. 전년도 매출을 입력하지 않으면 "
    "이번 달 매출을 연 환산한 값을 대체 추정치로 사용합니다(2026-09-03 수정, 검증사례 시트 참고).",
    "일반과세자 매입세액공제는 사용자가 매입 세부 내역(카드/현금영수증/세금계산서)을 입력하지 않으면 "
    "입력한 총비용(cost_vat_included)을 매입액으로 대신 사용합니다 — 실제 매입세액공제 가능액보다 클 수 있습니다.",
]
for i, t in enumerate(limits):
    data_row(ws, r, [f"{i+1}", t], alt=(i % 2 == 1))
    ws.row_dimensions[r].height = 30
    r += 1
ws.column_dimensions["A"].width = 26
ws.column_dimensions["B"].width = 70

# ============================================================
# 1) 부가세_간이과세
# ============================================================
ws = wb.create_sheet("부가세_간이과세")
set_widths(ws, [30, 30, 30, 30])
style_title_row(ws, 1, "부가가치세 - 간이과세자", 4)

r = 3
style_section(ws, r, "1. 간이/일반과세 판정 기준", 4); r += 1
header_row(ws, r, ["항목", "기준값", "출처", "코드 위치"]); r += 1
rows = [
    ("간이과세 적용 상한", "직전연도 공급대가 140,000,000원 미만", "부가가치세법 시행령 간이과세 기준", "vat_simple_thresholds.csv"),
    ("일반과세 전환", "직전연도 공급대가 140,000,000원 이상", "〃", "〃"),
    ("납부의무 면제", "직전연도 공급대가 48,000,000원 미만 → 부가세 0원", "부가가치세법 시행령 납부의무 면제 기준", "vat_simple_thresholds.csv (2026-09-03 추가)"),
    ("간이과세 배제지역", "서울 강남구·서초구 등 지정 지역은 매출 무관 일반과세", "2026 개정 캡처 기준", "simple_excluded_areas.csv"),
]
for i, row in enumerate(rows):
    data_row(ws, r, list(row), alt=(i % 2 == 1)); r += 1

r += 1
style_section(ws, r, "2. 계산식", 4); r += 1
formula_lines = [
    "① 연매출 판정 기준값 = 전년도 매출(입력 시) 없으면 이번 달 매출×12(대체 추정치, 실제 판정은 전년도 기준)",
    "② 연매출 < 48,000,000원 → 부가세 납부액 = 0원 (납부의무 면제)",
    "③ 48,000,000원 ≤ 연매출 < 140,000,000원 → 월 부가세 = 월매출(부가세포함) × 1.5%",
    "   * 1.5% = 음식점업 부가가치율 15% × 세율 10% (부가가치세법 시행령 별표, 음식점업 15% 가정)",
]
for i, t in enumerate(formula_lines):
    data_row(ws, r, [t, "", "", ""], alt=(i % 2 == 1))
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=4)
    r += 1

r += 1
style_section(ws, r, "3. 계산 예시", 4); r += 1
header_row(ws, r, ["월매출(VAT포함)", "연환산 매출", "판정", "월 부가세"]); r += 1
examples = [
    ("3,000,000원", "36,000,000원", "간이 · 납부의무 면제", "0원"),
    ("8,000,000원", "96,000,000원", "간이 · 일반 부과", "120,000원"),
    ("11,600,000원", "139,200,000원", "간이 · 일반 부과(상한 근접)", "174,000원"),
]
for i, row in enumerate(examples):
    data_row(ws, r, list(row), alt=(i % 2 == 1)); r += 1
note(ws, r + 1, "예시는 backend/app/engine/tax_engine_kr.py compute_vat_simple() 실제 실행 결과입니다(2026-09-03 확인).", 4)

# ============================================================
# 2) 부가세_일반과세
# ============================================================
ws = wb.create_sheet("부가세_일반과세")
set_widths(ws, [26, 22, 16, 16, 16, 30])
style_title_row(ws, 1, "부가가치세 - 일반과세자", 6)

r = 3
style_section(ws, r, "1. 계산식", 6); r += 1
gen_lines = [
    "① 과세표준(월) = 월매출(VAT포함) ÷ 1.1",
    "② 매출세액 = 과세표준(월) × 10%",
    "③ 매입세액공제 = 매입액(VAT포함, 세금계산서·카드·현금영수증 합계) ÷ 11",
    "④ 의제매입세액공제 = min( 면세농산물 매입액 × (분자/분모), 과세표준(월) × 한도율 )  — 아래 2번 표 참고",
    "⑤ 납부세액 = 매출세액 − 매입세액공제 − 의제매입세액공제 (0원 미만은 0원)",
]
for i, t in enumerate(gen_lines):
    data_row(ws, r, [t] + [""] * 5, alt=(i % 2 == 1))
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
    r += 1

r += 1
style_section(ws, r, "2. 의제매입세액공제율표 (음식점업, 개인사업자)", 6); r += 1
header_row(ws, r, ["업종", "사업자 구분", "연매출 구간", "공제율(분자/분모)", "공제 한도율", "출처"]); r += 1
deemed = [
    ("일반음식점", "개인", "1억원 이하", "9/109", "75%", "법령+국세청 고시 캡처"),
    ("일반음식점", "개인", "1억원 초과 ~ 2억원 이하", "9/109", "70%", "〃"),
    ("일반음식점", "개인", "2억원 초과", "9/109", "60%", "〃"),
    ("제과·베이커리", "개인", "2억원 이하", "8/108", "65%", "〃"),
    ("제과·베이커리", "개인", "2억원 초과", "8/108", "55%", "〃"),
    ("유흥음식점", "개인", "전체", "2/102", "30%", "〃"),
    ("음식점 전체", "법인", "전체", "6/106", "50%", "〃"),
]
for i, row in enumerate(deemed):
    data_row(ws, r, list(row), alt=(i % 2 == 1)); r += 1
note(ws, r + 1, "출처: backend/app/engine/official_tables_kr.py DEEMED_INPUT_RULES_2026 / deemed_input_rules.csv", 6)
r += 3

style_section(ws, r, "3. 계산 예시", 6); r += 1
header_row(ws, r, ["월매출(VAT포함)", "매입액(VAT포함)", "과세표준", "매출세액", "매입세액공제", "월 납부세액"]); r += 1
gen_examples = [
    ("50,000,000원", "40,000,000원(총비용 대입)", "45,454,545원", "4,545,455원", "3,636,364원", "909,090원"),
]
for i, row in enumerate(gen_examples):
    data_row(ws, r, list(row), alt=(i % 2 == 1)); r += 1
note(ws, r + 1, "매입 세부 내역(세금계산서/카드/현금영수증)을 입력하지 않으면 입력한 총비용을 매입액으로 대신 사용합니다 — 실제보다 매입세액공제가 과대 추정될 수 있습니다.", 6)

# ============================================================
# 3) 종합소득세
# ============================================================
ws = wb.create_sheet("종합소득세")
set_widths(ws, [22, 22, 12, 16, 26])
style_title_row(ws, 1, "종합소득세 · 지방소득세", 5)

r = 3
style_section(ws, r, "1. 종합소득세 누진세율표", 5); r += 1
header_row(ws, r, ["과세표준 구간(이상)", "과세표준 구간(미만)", "세율", "누진공제액", "산출세액 계산식"]); r += 1
brackets = [
    (0, 14_000_000, "6%", 0),
    (14_000_000, 50_000_000, "15%", 1_260_000),
    (50_000_000, 88_000_000, "24%", 5_760_000),
    (88_000_000, 150_000_000, "35%", 15_440_000),
    (150_000_000, 300_000_000, "38%", 19_940_000),
    (300_000_000, 500_000_000, "40%", 25_940_000),
    (500_000_000, 1_000_000_000, "42%", 35_940_000),
    (1_000_000_000, None, "45%", 65_940_000),
]
for i, (lo, hi, rate, ded) in enumerate(brackets):
    hi_s = f"{hi:,}원" if hi else "제한 없음"
    data_row(ws, r, [f"{lo:,}원", hi_s, rate, f"{ded:,}원", "과세표준×세율−누진공제액"], alt=(i % 2 == 1))
    r += 1
note(ws, r + 1, "출처: backend/app/engine/official_tables_kr.py INCOME_TAX_BRACKETS_2023_2024 (2023년 이후 개정 세율, 2026-09-03 기준 코드에 그대로 사용 중). "
                "파일 내부 주석은 '2023~2024 귀속 캡처'로 되어 있어 2026년 기준 최신 여부는 국세청 공식 자료로 재확인을 권장합니다.", 5)
r += 3

style_section(ws, r, "2. 과세표준 산정 방식(quick 모드)", 5); r += 1
tb_lines = [
    "① 연 추정 순이익 = (월매출 − 월비용 − 인건비) × 12",
    "② 과세표준(원안) = 연 추정 순이익 (0원 미만은 0원)",
    "③ 보정: quick 모드 & 업종코드 미입력 시, 과세표준이 공식 벤치마크(PROFIT_RATIO 상위 75% 값) 초과분은 "
    "그 상한으로 낮춰서 계산 — 비현실적으로 높은 추정치를 방지하기 위한 보수적 보정",
    "④ 지방소득세 = 종합소득세 산출세액 × 10%",
]
for i, t in enumerate(tb_lines):
    data_row(ws, r, [t] + [""] * 4, alt=(i % 2 == 1))
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=5)
    r += 1
r += 1
style_section(ws, r, "3. 반영되지 않은 항목(한계)", 5); r += 1
missing = [
    "기본공제(본인 및 부양가족 1인당 150만원)",
    "국민연금보험료 등 사회보험료 소득공제",
    "노란우산공제 등 소득공제형 절세상품",
    "자녀세액공제 등 각종 세액공제",
    "기준경비율/단순경비율을 통한 실제 필요경비 산정 (업종코드 입력 시에만 참고용으로 별도 제공, 세액 계산엔 미반영)",
]
for i, t in enumerate(missing):
    data_row(ws, r, [t] + [""] * 4, alt=(i % 2 == 1))
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=5)
    r += 1
r += 1
style_section(ws, r, "4. 계산 예시", 5); r += 1
header_row(ws, r, ["연 추정 순이익", "보정 후 과세표준", "적용 구간", "산출세액", "지방소득세"]); r += 1
inc_examples = [
    ("48,000,000원", "31,320,000원(벤치마크 상한 보정)", "15% 구간", "3,438,000원", "343,800원"),
]
for i, row in enumerate(inc_examples):
    data_row(ws, r, list(row), alt=(i % 2 == 1)); r += 1
note(ws, r + 1, "예시: 월매출 20,000,000원 · 월비용 16,000,000원 · KOREAN 업종, 2026-09-03 실제 서버 실행 결과.", 5)

# ============================================================
# 4) 지방소득세_4대보험
# ============================================================
ws = wb.create_sheet("지방소득세_4대보험")
set_widths(ws, [20, 18, 18, 20, 20, 26])
style_title_row(ws, 1, "지방소득세 · 4대보험(사업주 부담분)", 6)

r = 3
style_section(ws, r, "1. 지방소득세", 6); r += 1
header_row(ws, r, ["항목", "계산식", "", "", "", ""]); r += 1
data_row(ws, r, ["지방소득세", "종합소득세 산출세액 × 10%", "", "", "", ""], alt=False)
ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=6)
r += 2

style_section(ws, r, "2. 4대보험 사업주 부담분 (2026년 기준)", 6); r += 1
header_row(ws, r, ["보험 종류", "전체 요율", "사업주 부담 요율", "기준소득월액 하한", "기준소득월액 상한", "비고"]); r += 1
ins = [
    ("국민연금", "9.5%", "4.75%", "400,000원", "6,370,000원", ""),
    ("건강보험", "7.19%", "3.595%", "-", "9,183,480원", "보험료 하한 20,160원"),
    ("고용보험", "2.7%", "1.8%", "-", "-", "근로자 부담 0.9%"),
    ("산재보험", "업종별 상이", "전액 사업주 부담", "-", "-", "음식점업 평균 1.47%"),
]
for i, row in enumerate(ins):
    data_row(ws, r, list(row), alt=(i % 2 == 1)); r += 1
note(ws, r + 1, "출처: backend/app/engine/official_tables_kr.py INSURANCE_2026 / insurance_rates.csv", 6)

# ============================================================
# 5) 경비율
# ============================================================
ws = wb.create_sheet("경비율")
set_widths(ws, [16, 26, 16, 18])
style_title_row(ws, 1, "국세청 고시 경비율 (2026년 귀속, 등록된 업종코드만)", 4)

r = 3
note(ws, r, "적용 매출 상한: 연 수입금액 36,000,000원 미만. 결과 화면의 '경비율 힌트'는 참고용이며 세액 계산에는 반영되지 않습니다(업종코드를 별도 입력해야 조회됨).", 4)
r += 2
header_row(ws, r, ["국세청 업종코드", "업종", "단순경비율", "기준경비율(기타경비)"]); r += 1
exp = [
    ("56111", "한식 일반음식점", "89.7%", "10.1%"),
    ("56112", "한식 전문", "87.5%", "9.8%"),
    ("56113", "호프/포장마차", "88.2%", "10.5%"),
    ("56121", "양식", "85.2%", "11.2%"),
    ("56122", "중식", "86.3%", "10.5%"),
    ("56123", "일식/횟집", "84.8%", "11.0%"),
    ("56191", "기타음식점(분식 등)", "91.2%", "8.7%"),
    ("56192", "패스트푸드", "82.5%", "12.3%"),
]
for i, row in enumerate(exp):
    data_row(ws, r, list(row), alt=(i % 2 == 1)); r += 1
note(ws, r + 1, "출처: backend/app/engine/official_tables_kr.py EXPENSE_RATIOS_2026_BY_HOMETAX_CODE / expense_ratio_rules.csv (일부 업종코드만 등록되어 있어 확장이 필요한 상태입니다.)", 4)

# ============================================================
# 6) 검증사례
# ============================================================
ws = wb.create_sheet("검증사례")
set_widths(ws, [30, 20, 22, 22, 30])
style_title_row(ws, 1, "실제 서버 실행 검증 사례 (2026-09-03)", 5)

r = 3
note(ws, r, "아래 값은 설명/추정이 아니라, 로컬 서버(POST /api/v1/calc/run-guest)에 실제 요청을 보내 받은 응답값입니다.", 5)
r += 2

style_section(ws, r, "A. 벤치마크(매출구간별 비용/이익률) 확장 검증", 5); r += 1
header_row(ws, r, ["월매출", "매출구간(size_band)", "총비용률(COST_RATIO) 중간값", "영업이익률(PROFIT_RATIO) 중간값", "비고"]); r += 1
bench_v = [
    ("5,000,000원", "BAND_0_10M", "92.0%", "8.0%", "2026-09-03 신규 반영(2025 외식업체 경영실태조사 실측)"),
    ("20,000,000원", "BAND_10_30M", "91.04%", "8.96%", "기존 실측값 유지(KOREAN 업종 기준)"),
    ("70,000,000원", "BAND_50_100M", "91.6%", "8.4%", "2026-09-03 신규 반영"),
]
for i, row in enumerate(bench_v):
    data_row(ws, r, list(row), alt=(i % 2 == 1)); r += 1
r += 1

style_section(ws, r, "B. 부가세 판정 오류 수정 전/후", 5); r += 1
header_row(ws, r, ["케이스", "연매출(환산)", "수정 전", "수정 후", "설명"]); r += 1
fix_v = [
    ("월 5,000만원, 전년도매출 미입력", "600,000,000원", "간이과세 · 월 750,000원", "일반과세 · 월 909,090원", "간이과세 상한(1.4억) 초과인데도 간이로 오판정되던 문제 수정"),
    ("월 300만원", "36,000,000원", "간이과세 · 월 45,000원", "간이과세 · 0원(면제)", "납부의무 면제 기준(4,800만원) 미반영되던 문제 수정"),
    ("월 800만원", "96,000,000원", "간이과세 · 월 120,000원", "간이과세 · 월 120,000원", "정상 구간 — 수정으로 인한 변화 없음(회귀 확인)"),
]
for i, row in enumerate(fix_v):
    data_row(ws, r, list(row), alt=(i % 2 == 1))
    ws.row_dimensions[r].height = 30
    r += 1
note(ws, r + 1, "근거 코드: backend/app/engine/tax_engine_kr.py decide_taxpayer_type(), compute_vat_simple()", 5)

# ============================================================
# 7) 출처
# ============================================================
ws = wb.create_sheet("출처")
set_widths(ws, [22, 46, 16, 30])
style_title_row(ws, 1, "기준값 출처 목록", 4)

r = 3
header_row(ws, r, ["구분", "출처", "적용연도", "비고"]); r += 1
sources = [
    ("간이과세 기준·납부의무 면제", "부가가치세법 시행령", "2026", "vat_simple_thresholds.csv"),
    ("간이과세 배제지역", "2026 개정 캡처 자료", "2026", "simple_excluded_areas.csv"),
    ("의제매입세액공제율", "부가가치세법 + 국세청 고시", "2026", "deemed_input_rules.csv"),
    ("종합소득세 누진세율표", "소득세법 (2023년 개정 세율)", "2023~2024 귀속 캡처", "official_tables_kr.py — 최신 연도 라벨 재확인 권장"),
    ("경비율(단순/기준)", "국세청 고시", "2026", "expense_ratio_rules.csv — 일부 업종코드만 등록"),
    ("4대보험 요율/상하한", "국민연금법/국민건강보험법/고용보험법/산재보험법", "2026", "insurance_rates.csv"),
    ("외식업 매출구간별 비용·이익 벤치마크", "농림축산식품부/한국농촌경제연구원(KREI) 2025 외식업체 경영실태 조사 보고서", "2025", "benchmark_v1_band_10_30m.csv"),
]
for i, row in enumerate(sources):
    data_row(ws, r, list(row), alt=(i % 2 == 1)); r += 1

r += 2
note(ws, r, "이 문서는 backend 코드/데이터가 바뀌면 함께 갱신이 필요합니다. 최종 갱신: 2026-09-03.", 4)

wb.save("tax_methodology.xlsx")
print("saved")
