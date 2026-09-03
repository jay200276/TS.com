# backend/init_db.py
"""
빈 환경(신규 배포 등)에서 local_dev.db를 처음부터 구성하는 통합 초기화 스크립트.

실행:
    cd backend
    python init_db.py

하는 일:
  1) SQLAlchemy 테이블(users/access_tokens/records) 생성 — main.py import 시 자동 실행됨
  2) 국세청/법령 기준값 테이블(간이과세 기준, 의제매입세액공제, 경비율, 4대보험) 생성 + CSV 적재
  3) 업종별 매출구간 벤치마크 테이블(official_benchmarks) 생성 + CSV 적재 + 출처 메타데이터 등록

Render 등 새 환경에 배포할 때 build/start 이전에 한 번 실행하면
로컬에서 이번 세션 동안 채워온 실제 데이터가 그대로 재현됩니다.
"""
from __future__ import annotations

import csv
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "local_dev.db"
OFFICIAL_CSV_DIR = BASE_DIR / "data" / "official"
BENCHMARK_CSV_PATH = BASE_DIR / "data" / "benchmark_v1_band_10_30m.csv"


def step1_sqlalchemy_tables():
    print("[1/3] users/access_tokens/records 테이블 생성 중...")
    import main  # noqa: F401  (import 시점에 Base.metadata.create_all 실행됨)
    print("      -> 완료")


def step2_official_reference_tables():
    print("[2/3] 국세청/법령 기준값 테이블 생성 및 CSV 적재 중...")
    import sys
    sys.path.insert(0, str(BASE_DIR))
    from app.etl.load_official_csv import (
        _connect,
        _create_tables,
        load_vat_simple_thresholds,
        load_simple_excluded_areas,
        load_deemed_input_rules,
        load_expense_ratio_rules,
        load_insurance_rates,
    )

    conn = _connect(DB_PATH)
    try:
        _create_tables(conn)
        conn.execute("BEGIN;")
        c1 = load_vat_simple_thresholds(conn, OFFICIAL_CSV_DIR)
        c2 = load_simple_excluded_areas(conn, OFFICIAL_CSV_DIR)
        c3 = load_deemed_input_rules(conn, OFFICIAL_CSV_DIR)
        c4 = load_expense_ratio_rules(conn, OFFICIAL_CSV_DIR)
        c5 = load_insurance_rates(conn, OFFICIAL_CSV_DIR)
        conn.commit()
        print(f"      -> vat_simple_thresholds={c1}, simple_excluded_areas={c2}, "
              f"deemed_input_rules={c3}, expense_ratio_rules={c4}, insurance_rates={c5}")
    finally:
        conn.close()


BENCHMARK_VERSION_TITLE = "외식업 규모구간 벤치마크 (5개 매출구간, 부분 실측)"
BENCHMARK_VERSION_SOURCE = (
    "MAFRA/KREI 2025 외식업체 경영실태 조사 통계보고서(정책브리핑 정부간행물 등록번호 11-1543000-100559-10)"
)
BENCHMARK_VERSION_NOTES = (
    "P50(중간값)은 표95~104(외식업체 경영실태조사 통계보고서) 및 표3-41-1(2025 외식업체 경영실태 조사 보고서, "
    "\"업종별·지역별·매출액·운영 형태별 수익성·생산성 분석\") 기준 실측치를 반영. "
    "BAND_10_30M(월매출 1천만~3천만원)은 업종별(KOREAN/CAFE 등) 세부 실측값 사용, "
    "P25/P75는 원본 데이터가 없어 기존 임시치의 P50 대비 스프레드 비율을 그대로 적용(근사). "
    "BAND_0_10M은 표3-41-1의 연매출 \"5천만원~1억원미만\"(n=152) 전체 평균(영업이익률 8.0%), "
    "BAND_50_100M/BAND_100M_PLUS는 \"5억원 이상\"(n=243) 전체 평균(영업이익률 8.4%)을 COST_RATIO/PROFIT_RATIO에만 적용 — "
    "업종별 교차표가 report에 없어 전 업종 동일 P50 사용, P25/P75는 각 업종의 BAND_10_30M 스프레드 비율을 적용한 근사치. "
    "BAND_30_50M은 별도 실측 없음 — 동일 연매출 구간(1억~5억원)에 속해 BAND_10_30M 값을 최근접 밴드로 자동 재사용(app 로직). "
    "LABOR_RATIO/MATERIAL_RATIO/RENT_RATIO는 신규 밴드에서 채우지 않음 — report에 매출구간별 분리 비율표가 없어 "
    "BAND_10_30M 값을 최근접 밴드로 계속 재사용. 2026-09-03 갱신."
)


def step3_benchmark_tables():
    print("[3/3] 벤치마크 테이블 생성 및 CSV 적재 중...")
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS official_benchmark_versions (
          version_key TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          source_name TEXT NOT NULL,
          year INTEGER,
          notes TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS official_benchmarks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version_key TEXT NOT NULL,
          region_code TEXT NOT NULL,
          business_type_code TEXT NOT NULL,
          size_band TEXT NOT NULL,
          metric TEXT NOT NULL,
          p25 REAL,
          p50 REAL,
          p75 REAL,
          unit TEXT NOT NULL,
          period TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(version_key, region_code, business_type_code, size_band, metric)
        )
    """)

    cur.execute("""
        INSERT INTO official_benchmark_versions (version_key, title, source_name, year, notes)
        VALUES ('OFFICIAL_BENCH_V1', ?, ?, 2025, ?)
        ON CONFLICT(version_key) DO UPDATE SET
            title=excluded.title, source_name=excluded.source_name,
            year=excluded.year, notes=excluded.notes
    """, (BENCHMARK_VERSION_TITLE, BENCHMARK_VERSION_SOURCE, BENCHMARK_VERSION_NOTES))

    with open(BENCHMARK_CSV_PATH, "r", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    inserted = 0
    for r in rows:
        p25 = float(r["p25"]) if r["p25"] else None
        p50 = float(r["p50"]) if r["p50"] else None
        p75 = float(r["p75"]) if r["p75"] else None
        cur.execute("""
            INSERT INTO official_benchmarks
                (version_key, region_code, size_band, business_type_code, metric, p25, p50, p75, unit, period)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ratio', '2024')
            ON CONFLICT(version_key, region_code, business_type_code, size_band, metric) DO UPDATE SET
                p25=excluded.p25, p50=excluded.p50, p75=excluded.p75
        """, (r["version_key"], r["region_code"], r["size_band"], r["business_type_code"], r["metric"], p25, p50, p75))
        inserted += 1

    conn.commit()
    conn.close()
    print(f"      -> official_benchmarks rows upserted: {inserted}")


if __name__ == "__main__":
    step1_sqlalchemy_tables()
    step2_official_reference_tables()
    step3_benchmark_tables()
    print("\n[DONE] DB 초기화 완료:", DB_PATH)
