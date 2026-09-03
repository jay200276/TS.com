# backend/etl/load_official_data.py
# -*- coding: utf-8 -*-

"""
TS (Tax Secretary) - Official Data ETL
RAW(xlsx) -> SQLite benchmarks table insert

- LOCK 원칙: 프론트(member.js/member.html) 수정 없이, "데이터 공급"만 공식 값으로 교체하기 위함.
- 이 스크립트는 backend/data/raw 안의 공식 엑셀들을 읽어 benchmarks 테이블에 적재합니다.

사용 예)
  (PowerShell)
  cd backend
  python etl/load_official_data.py --db ./local_dev.db --raw ./data/raw

중요)
  - benchmark_versions 테이블은 이미 존재한다고 가정합니다.
  - version_id는 기본적으로 benchmark_versions의 MAX(id)를 사용합니다.
    (원하면 --version-id 로 명시 가능)
"""

from __future__ import annotations

import argparse
import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

import pandas as pd


# =========================================================
# Helpers
# =========================================================

def now_iso() -> str:
    # SQLite DATETIME 기본 호환 (YYYY-MM-DD HH:MM:SS)
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def norm_str(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def is_nan(v: Any) -> bool:
    try:
        return pd.isna(v)
    except Exception:
        return v is None


def to_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)) and pd.notna(v):
        return float(v)
    s = str(v).strip()
    if not s or s.lower() in ("nan", "none"):
        return None
    # 숫자/소수/음수만 남기기
    s2 = re.sub(r"[^0-9\.\-]", "", s)
    if not s2 or s2 in ("-", ".", "-.", ".-"):
        return None
    try:
        return float(s2)
    except Exception:
        return None


def ensure_dir(p: str) -> None:
    if not os.path.isdir(p):
        raise FileNotFoundError(f"Directory not found: {p}")


@dataclass
class InsertRow:
    version_id: int
    cat1: Optional[str] = None
    cat2: Optional[str] = None
    cat3: Optional[str] = None
    cat4: Optional[str] = None
    year: Optional[int] = None
    value: Optional[float] = None
    dataset: Optional[str] = None
    metric_code: Optional[str] = None
    business_type_code: Optional[str] = None
    region_code: Optional[str] = None
    sales_band_code: Optional[str] = None
    unit: Optional[str] = None
    source: Optional[str] = None
    ts_code: Optional[str] = None
    metric: Optional[str] = None
    size_band: Optional[str] = None
    p25: Optional[float] = None
    p50: Optional[float] = None
    p75: Optional[float] = None
    created_at: str = ""


# =========================================================
# DB layer
# =========================================================

def connect(db_path: str) -> sqlite3.Connection:
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"DB not found: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def get_default_version_id(conn: sqlite3.Connection) -> int:
    cur = conn.execute("SELECT MAX(id) AS mid FROM benchmark_versions")
    row = cur.fetchone()
    if not row or row["mid"] is None:
        raise RuntimeError(
            "benchmark_versions 테이블에 row가 없습니다. "
            "먼저 benchmark_versions에 version을 생성한 뒤, --version-id 로 지정해 주세요."
        )
    return int(row["mid"])


def delete_existing_for_version(conn: sqlite3.Connection, version_id: int, metric_codes: List[str]) -> int:
    # 재실행 안전성을 위해, 이 스크립트가 넣는 metric_code들은 동일 version_id에서 삭제 후 삽입
    # (테이블에 UNIQUE가 없어서 중복 적재 방지 목적)
    if not metric_codes:
        return 0
    q_marks = ",".join(["?"] * len(metric_codes))
    sql = f"DELETE FROM benchmarks WHERE version_id=? AND metric_code IN ({q_marks})"
    cur = conn.execute(sql, [version_id] + metric_codes)
    return cur.rowcount


def bulk_insert(conn: sqlite3.Connection, rows: List[InsertRow]) -> int:
    if not rows:
        return 0

    sql = """
    INSERT INTO benchmarks (
        version_id,
        cat1, cat2, cat3, cat4,
        year,
        value,
        dataset,
        metric_code,
        business_type_code,
        region_code,
        sales_band_code,
        unit,
        source,
        ts_code,
        metric,
        size_band,
        p25, p50, p75,
        created_at
    ) VALUES (
        :version_id,
        :cat1, :cat2, :cat3, :cat4,
        :year,
        :value,
        :dataset,
        :metric_code,
        :business_type_code,
        :region_code,
        :sales_band_code,
        :unit,
        :source,
        :ts_code,
        :metric,
        :size_band,
        :p25, :p50, :p75,
        :created_at
    )
    """
    payload = []
    for r in rows:
        d = r.__dict__.copy()
        if not d.get("created_at"):
            d["created_at"] = now_iso()
        payload.append(d)

    conn.executemany(sql, payload)
    return len(rows)


# =========================================================
# Parsers: KOSIS style tables (특성별 4단 + 연도/지표 columns)
# =========================================================

def parse_kosis_wide_year_table(
    path: str,
    dataset: str,
    metric_code: str,
    value_unit: str,
    version_id: int,
    *,
    # target row filter (일반음식점/소계/소계 등)
    want_cat1: str = "업종별",
    want_cat2: str = "일반음식점",
    want_cat3: str = "소계",
    want_cat4: str = "소계",
    source: str = "KOSIS",
    ts_code: str = "FOODSVC",  # TS 내부 업종코드(네 서비스에서 쓰는 값이 따로 있으면 바꿔)
) -> List[InsertRow]:
    """
    예) kosis_foodservice_monthly_avg_sales.xlsx
        - row0: 특성별(1)~ + 연도들
        - 이후: cat columns + values
    """
    df0 = pd.read_excel(path, sheet_name="데이터", header=None)
    if df0.shape[0] < 2:
        return []

    # 첫 행: years
    header_years = df0.iloc[0].tolist()
    # 두 번째 행이 있으면(지표명), 멀티지표 처리도 가능하지만
    # 월평균 매출액처럼 단일 지표면 그냥 year만 씀.
    data = df0.copy()

    # cat columns 0~3 forward-fill
    for c in [0, 1, 2, 3]:
        data.iloc[:, c] = data.iloc[:, c].ffill()

    # 실제 데이터는 1행부터 시작(0행은 헤더)
    data = data.iloc[1:].reset_index(drop=True)

    # year columns start index: 첫 행에서 숫자로 읽히는 첫 컬럼 찾기
    year_cols_idx = []
    for idx, v in enumerate(header_years):
        if isinstance(v, (int, float)) and not is_nan(v):
            # 2017, 2018.0 같은 값
            y = int(v)
            if 1900 <= y <= 2100:
                year_cols_idx.append((idx, y))

    if not year_cols_idx:
        # 헤더가 깨진 경우: 열 이름에서 찾아보기
        return []

    rows: List[InsertRow] = []

    # 타겟 row 추출
    # cat columns: 0~3
    tgt = data[
        (data[0].astype(str) == want_cat1) &
        (data[1].astype(str) == want_cat2) &
        (data[2].astype(str) == want_cat3) &
        (data[3].astype(str) == want_cat4)
    ]
    if tgt.empty:
        return []

    # 첫 번째 매칭 row 사용
    r0 = tgt.iloc[0]

    for col_idx, year in year_cols_idx:
        val = to_float(r0[col_idx])
        if val is None:
            continue
        rows.append(InsertRow(
            version_id=version_id,
            cat1=want_cat1, cat2=want_cat2, cat3=want_cat3, cat4=want_cat4,
            year=year,
            value=val,
            dataset=dataset,
            metric_code=metric_code,
            unit=value_unit,
            source=source,
            ts_code=ts_code,
            metric=dataset,  # 사람이 보기용(원하면 더 구체적으로)
            size_band=None,
            p50=val,  # 단일값이면 p50에도 동일값
            created_at=now_iso(),
        ))
    return rows


def parse_kosis_multi_metric_row_2024(
    path: str,
    dataset: str,
    metric_code_prefix: str,
    version_id: int,
    *,
    want_cat1: str = "업종별",
    want_cat2: str = "일반음식점",
    want_cat3: str = "소계",
    want_cat4: str = "소계",
    source: str = "KOSIS",
    ts_code: str = "FOODSVC",
) -> List[InsertRow]:
    """
    예) 수익성·생산성_분석_전년도_기준__20260301084821.xlsx
        row0/row1: 헤더
        - row1에 지표명이 있고, 2024 컬럼들이 여러 개 존재
    """
    df = pd.read_excel(path, sheet_name="데이터", header=None)

    # cat columns forward-fill
    for c in [0, 1, 2, 3]:
        df.iloc[:, c] = df.iloc[:, c].ffill()

    # 지표명 행(row1)의 컬럼명 추출
    # df[4..] 열에 대한 "지표명"은 row1에 들어있음
    metric_names: Dict[int, str] = {}
    for col in range(4, df.shape[1]):
        name = norm_str(df.iloc[1, col])
        if name:
            metric_names[col] = name

    # 타겟 row 찾기
    tgt = df[
        (df[0].astype(str) == want_cat1) &
        (df[1].astype(str) == want_cat2) &
        (df[2].astype(str) == want_cat3) &
        (df[3].astype(str) == want_cat4)
    ]
    if tgt.empty:
        return []

    r0 = tgt.iloc[0]
    rows: List[InsertRow] = []

    # 이 파일들은 2024 단일 연도라 year=2024로 고정
    year = 2024

    for col, mname in metric_names.items():
        val = to_float(r0[col])
        if val is None:
            continue

        # 단위 판단: 메타정보 시트에 단위가 있는 경우가 있지만,
        # 여기서는 지표명 기반으로 대략 지정
        unit = None
        if "%" in mname:
            unit = "%"
        elif "만원" in mname:
            unit = "만원"
        else:
            unit = None

        metric_key = slug_metric_name(mname)
        rows.append(InsertRow(
            version_id=version_id,
            cat1=want_cat1, cat2=want_cat2, cat3=want_cat3, cat4=want_cat4,
            year=year,
            value=val,
            dataset=dataset,
            metric_code=f"{metric_code_prefix}:{metric_key}",
            unit=unit,
            source=source,
            ts_code=ts_code,
            metric=mname,
            p50=val,
            created_at=now_iso(),
        ))

    return rows


def slug_metric_name(name: str) -> str:
    s = norm_str(name)
    s = s.lower()
    s = s.replace("(", " ").replace(")", " ").replace("%", " pct ")
    s = re.sub(r"[^a-z0-9가-힣]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s[:80] if s else "metric"


# =========================================================
# Parsers: NTS VAT tables
# =========================================================

def parse_nts_vat_by_type(
    path: str,
    dataset: str,
    metric_code_prefix: str,
    version_id: int,
    *,
    sheet: str = "(1)",
    target_row_kor: str = "음식업",
    source: str = "NTS",
    ts_code: str = "FOODSVC",
) -> List[InsertRow]:
    """
    9-3-2 / 9-4-2 유형
    - sheet (1)에서 2024년 합계 row + 음식업 row를 사용
    - 과세표준/세액 등 컬럼을 적재 + 파생 rate도 적재
    """
    df = pd.read_excel(path, sheet_name=sheet, header=None)

    # 데이터 시작점(헤더 row) 찾기: "구분 Classification" 있는 행
    header_idx = None
    for i in range(min(80, df.shape[0])):
        s = " ".join([norm_str(x) for x in df.iloc[i].tolist() if norm_str(x)])
        if "구분" in s and "Classification" in s:
            header_idx = i
            break
    if header_idx is None:
        return []

    # 실제 데이터는 header_idx+1부터
    data = df.iloc[header_idx+1:].copy().reset_index(drop=True)

    # 컬럼 의미(이 파일 포맷 기준)
    # 0: 분류(한글), 1: 영문, 2: 신고인원(1), 3: 과세분매출 인원(2), 4: 과세표준(3), 5: 세액(4),
    # 6: 영세율 인원(5), 7: 영세율 과세표준(6),
    # 8: 면세 인원(7), 9: 면세 수입금액(8)  (일반사업자 파일 기준)
    # 간이 파일은 컬럼 수가 다를 수 있어서 안전 접근
    def row_startswith(r: pd.Series, prefix: str) -> bool:
        return norm_str(r.get(0, "")).startswith(prefix)

    # year row: "2024년 합계"
    year_row = None
    for _, r in data.iterrows():
        if row_startswith(r, "2024년 합계"):
            year_row = r
            break
    if year_row is None:
        # 없으면 최신 "YYYY년 합계" 찾아보기
        for _, r in data.iterrows():
            m = re.match(r"(\d{4})년 합계", norm_str(r.get(0, "")))
            if m:
                year_row = r
        if year_row is None:
            return []

    m = re.match(r"(\d{4})년 합계", norm_str(year_row.get(0, "")))
    year = int(m.group(1)) if m else 2024

    # target row (음식업)
    target = None
    for _, r in data.iterrows():
        if norm_str(r.get(0, "")) == target_row_kor:
            target = r
            break
    if target is None:
        return []

    # 숫자 추출 helper
    def g(col: int) -> Optional[float]:
        if col >= len(target):
            return None
        return to_float(target.iloc[col])

    # 기본 값
    n_returns = g(2)
    taxable_tax_base = g(4)
    taxable_tax_amount = g(5)

    # 파생값(세액/과세표준)
    vat_output_rate = None
    if taxable_tax_base and taxable_tax_amount is not None and taxable_tax_base != 0:
        vat_output_rate = float(taxable_tax_amount) / float(taxable_tax_base)

    rows: List[InsertRow] = []
    cat1 = "국세청"
    cat2 = dataset
    cat3 = target_row_kor
    cat4 = None

    def add(metric_key: str, val: Optional[float], unit: Optional[str]) -> None:
        if val is None:
            return
        rows.append(InsertRow(
            version_id=version_id,
            cat1=cat1, cat2=cat2, cat3=cat3, cat4=cat4,
            year=year,
            value=float(val),
            dataset=dataset,
            metric_code=f"{metric_code_prefix}:{metric_key}",
            unit=unit,
            source=source,
            ts_code=ts_code,
            metric=metric_key,
            p50=float(val),
            created_at=now_iso(),
        ))

    add("n_returns", n_returns, "건")
    add("taxable_tax_base_milwon", taxable_tax_base, "백만원")
    add("taxable_tax_amount_milwon", taxable_tax_amount, "백만원")
    add("vat_output_rate", vat_output_rate, "rate")  # 0.1 ~= 10%

    return rows


# =========================================================
# Parsers: NTS Income (종합소득세 총수입금액/소득금액)
# =========================================================

def parse_nts_income_margin(
    path: str,
    dataset: str,
    metric_code_prefix: str,
    version_id: int,
    *,
    revenue_industry_kor: str = "숙박 및 음식점업",
    income_industry_kor: str = "숙박 및 음식점업",
    source: str = "NTS",
    ts_code: str = "FOODSVC",
) -> List[InsertRow]:
    """
    3-1-2 (1) 시트에서:
      - 총수입금액 섹션의 '숙박 및 음식점업' 금액(백만원)
      - 소득금액 섹션의 '숙박 및 음식점업' 금액(백만원)
    를 추출해 소득률(소득/매출)을 계산하여 적재
    """
    df = pd.read_excel(path, sheet_name="(1)", header=None)

    # 총수입금액 섹션 시작: row where col0 == "총수입금액"
    revenue_start = None
    for i in range(min(200, df.shape[0])):
        if norm_str(df.iloc[i, 0]) == "총수입금액":
            revenue_start = i
            break
    if revenue_start is None:
        return []

    # 소득금액 섹션 시작: row where col0 == "소득금액"
    income_start = None
    for i in range(min(300, df.shape[0])):
        if norm_str(df.iloc[i, 0]) == "소득금액":
            income_start = i
            break
    if income_start is None:
        return []

    # year: "2024년 합계"가 헤더에 있으나, 이 테이블은 2024 기준으로 보임
    year = 2024

    # 총수입금액에서 업종 row 찾기: revenue_industry_kor (col0)
    revenue_amount = None
    for i in range(revenue_start + 1, min(revenue_start + 60, df.shape[0])):
        if norm_str(df.iloc[i, 0]) == revenue_industry_kor:
            revenue_amount = to_float(df.iloc[i, 3])  # (1) 테이블에서 금액 컬럼(3)
            break

    # 소득금액에서 업종 row 찾기
    income_amount = None
    for i in range(income_start + 1, min(income_start + 80, df.shape[0])):
        if norm_str(df.iloc[i, 0]) == income_industry_kor:
            income_amount = to_float(df.iloc[i, 3])
            break

    if revenue_amount is None or income_amount is None or revenue_amount == 0:
        return []

    income_margin = float(income_amount) / float(revenue_amount)

    rows: List[InsertRow] = []
    cat1 = "국세청"
    cat2 = dataset
    cat3 = revenue_industry_kor
    cat4 = None

    def add(metric_key: str, val: float, unit: Optional[str]) -> None:
        rows.append(InsertRow(
            version_id=version_id,
            cat1=cat1, cat2=cat2, cat3=cat3, cat4=cat4,
            year=year,
            value=float(val),
            dataset=dataset,
            metric_code=f"{metric_code_prefix}:{metric_key}",
            unit=unit,
            source=source,
            ts_code=ts_code,
            metric=metric_key,
            p50=float(val),
            created_at=now_iso(),
        ))

    add("total_revenue_milwon", float(revenue_amount), "백만원")
    add("taxable_income_milwon", float(income_amount), "백만원")
    add("income_margin_rate", float(income_margin), "rate")  # 0.09 == 9%

    return rows


# =========================================================
# Main ETL Orchestrator
# =========================================================

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, help="SQLite DB path (예: ./local_dev.db)")
    ap.add_argument("--raw", required=True, help="RAW directory path (예: ./data/raw)")
    ap.add_argument("--version-id", type=int, default=None, help="benchmark_versions.id (미지정시 MAX(id))")
    ap.add_argument("--dry-run", action="store_true", help="DB에 insert하지 않고 출력만")
    args = ap.parse_args()

    db_path = os.path.abspath(args.db)
    raw_dir = os.path.abspath(args.raw)

    ensure_dir(raw_dir)

    conn = connect(db_path)
    try:
        version_id = int(args.version_id) if args.version_id is not None else get_default_version_id(conn)

        print(f"[ETL] db={db_path}")
        print(f"[ETL] raw={raw_dir}")
        print(f"[ETL] version_id={version_id}")
        print(f"[ETL] dry_run={bool(args.dry_run)}")

        rows_all: List[InsertRow] = []
        metric_codes_written: List[str] = []

        def add_rows(rows: List[InsertRow]) -> None:
            nonlocal rows_all, metric_codes_written
            rows_all.extend(rows)
            for r in rows:
                if r.metric_code:
                    metric_codes_written.append(r.metric_code)

        # -----------------------------
        # 1) KOSIS 월평균 매출액 (2017~2019)
        # -----------------------------
        p_sales = os.path.join(raw_dir, "kosis_foodservice_monthly_avg_sales.xlsx")
        if os.path.exists(p_sales):
            add_rows(parse_kosis_wide_year_table(
                p_sales,
                dataset="kosis_foodservice_monthly_avg_sales",
                metric_code="KOSIS:DT_114054_030:monthly_avg_sales",
                value_unit="(원단위는 KOSIS 기준)",  # 필요하면 나중에 정확 단위로 교체
                version_id=version_id,
                source="KOSIS",
                ts_code="FOODSVC",
            ))
            print(f"[OK] loaded: {os.path.basename(p_sales)}")
        else:
            print(f"[SKIP] missing: {os.path.basename(p_sales)}")

        # -----------------------------
        # 2) KOSIS 수익성·생산성 (2024)
        # -----------------------------
        p_profit = os.path.join(raw_dir, "수익성·생산성_분석_전년도_기준__20260301084821.xlsx")
        if os.path.exists(p_profit):
            add_rows(parse_kosis_multi_metric_row_2024(
                p_profit,
                dataset="kosis_profit_productivity_2024",
                metric_code_prefix="KOSIS:DT_114054_029",
                version_id=version_id,
                source="KOSIS",
                ts_code="FOODSVC",
            ))
            print(f"[OK] loaded: {os.path.basename(p_profit)}")
        else:
            print(f"[SKIP] missing: {os.path.basename(p_profit)}")

        # -----------------------------
        # 3) KOSIS 식재료비 사용(전년도 기준) (2024, %)
        # -----------------------------
        p_ingredients = os.path.join(raw_dir, "식재료비_사용_전년도_기준__20260301084649.xlsx")
        if os.path.exists(p_ingredients):
            add_rows(parse_kosis_multi_metric_row_2024(
                p_ingredients,
                dataset="kosis_ingredients_usage_2024",
                metric_code_prefix="KOSIS:DT_114054_031",
                version_id=version_id,
                source="KOSIS",
                ts_code="FOODSVC",
            ))
            print(f"[OK] loaded: {os.path.basename(p_ingredients)}")
        else:
            print(f"[SKIP] missing: {os.path.basename(p_ingredients)}")

        # -----------------------------
        # 4) KOSIS 사업장 임차현황 (2024)
        # -----------------------------
        p_rent = os.path.join(raw_dir, "사업장_임차현황_20260301085253.xlsx")
        if os.path.exists(p_rent):
            add_rows(parse_kosis_multi_metric_row_2024(
                p_rent,
                dataset="kosis_rent_status_2024",
                metric_code_prefix="KOSIS:DT_114054_008",
                version_id=version_id,
                source="KOSIS",
                ts_code="FOODSVC",
            ))
            print(f"[OK] loaded: {os.path.basename(p_rent)}")
        else:
            print(f"[SKIP] missing: {os.path.basename(p_rent)}")

        # -----------------------------
        # 5) NTS VAT (일반사업자/간이사업자)
        # -----------------------------
        p_vat_general = os.path.join(raw_dir, "9-3-2. 일반사업자 부가가치세 신고 현황Ⅱ(업태).xlsx")
        if os.path.exists(p_vat_general):
            add_rows(parse_nts_vat_by_type(
                p_vat_general,
                dataset="nts_vat_general_by_type",
                metric_code_prefix="NTS:9-3-2",
                version_id=version_id,
                sheet="(1)",
                target_row_kor="음식업",
                source="NTS",
                ts_code="FOODSVC",
            ))
            print(f"[OK] loaded: {os.path.basename(p_vat_general)}")
        else:
            print(f"[SKIP] missing: {os.path.basename(p_vat_general)}")

        p_vat_simple = os.path.join(raw_dir, "9-4-2. 간이사업자 부가가치세 신고 현황Ⅱ(업태).xlsx")
        if os.path.exists(p_vat_simple):
            add_rows(parse_nts_vat_by_type(
                p_vat_simple,
                dataset="nts_vat_simplified_by_type",
                metric_code_prefix="NTS:9-4-2",
                version_id=version_id,
                sheet="(1)",
                target_row_kor="음식업",
                source="NTS",
                ts_code="FOODSVC",
            ))
            print(f"[OK] loaded: {os.path.basename(p_vat_simple)}")
        else:
            print(f"[SKIP] missing: {os.path.basename(p_vat_simple)}")

        # -----------------------------
        # 6) NTS Income margin (숙박 및 음식점업)
        # -----------------------------
        p_income = os.path.join(raw_dir, "3-1-2. 종합소득세 총수입금액 및 소득금액 신고 현황.xlsx")
        if os.path.exists(p_income):
            add_rows(parse_nts_income_margin(
                p_income,
                dataset="nts_income_revenue_income_2024",
                metric_code_prefix="NTS:3-1-2",
                version_id=version_id,
                revenue_industry_kor="숙박 및 음식점업",
                income_industry_kor="숙박 및 음식점업",
                source="NTS",
                ts_code="FOODSVC",
            ))
            print(f"[OK] loaded: {os.path.basename(p_income)}")
        else:
            print(f"[SKIP] missing: {os.path.basename(p_income)}")

        # -----------------------------
        # Commit
        # -----------------------------
        # 중복 방지용: 해당 version_id에서 이번에 쓰는 metric_code들 삭제 후 insert
        metric_codes_written = sorted(list(set([m for m in metric_codes_written if m])))
        print(f"[ETL] will write rows={len(rows_all)}  unique_metric_codes={len(metric_codes_written)}")

        if args.dry_run:
            # 미리보기 출력
            for r in rows_all[:20]:
                print("[DRY]", r.metric_code, r.year, r.value, r.dataset)
            print("[DRY] done.")
            return 0

        conn.execute("BEGIN")
        deleted = delete_existing_for_version(conn, version_id, metric_codes_written)
        inserted = bulk_insert(conn, rows_all)
        conn.commit()

        print(f"[DONE] deleted={deleted}, inserted={inserted}")
        return 0

    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        print("[ERROR]", str(e))
        return 2
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())