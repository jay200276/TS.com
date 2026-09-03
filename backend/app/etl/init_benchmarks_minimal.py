# backend/etl/init_benchmarks_minimal.py
from __future__ import annotations

import sqlite3
from pathlib import Path


DB_PATH = Path(__file__).resolve().parents[1] / "local_dev.db"


def main() -> None:
    if not DB_PATH.exists():
        raise FileNotFoundError(f"DB not found: {DB_PATH}")

    con = sqlite3.connect(str(DB_PATH))
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    # 1) tables
    cur.execute("""
    CREATE TABLE IF NOT EXISTS benchmark_versions (
        version_key TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS benchmark_ratios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_key TEXT NOT NULL,
        region_code TEXT NOT NULL,
        business_type_code TEXT NOT NULL,
        size_band TEXT NOT NULL,
        metric TEXT NOT NULL,

        p25 REAL,
        p50 REAL,
        p75 REAL,

        UNIQUE(version_key, region_code, business_type_code, size_band, metric),
        FOREIGN KEY(version_key) REFERENCES benchmark_versions(version_key)
    )
    """)

    # 2) upsert version
    version_key = "KOSIS_2024_V1"
    cur.execute("""
        INSERT INTO benchmark_versions(version_key, source, label)
        VALUES(?, ?, ?)
        ON CONFLICT(version_key) DO UPDATE SET
          source=excluded.source,
          label=excluded.label
    """, (version_key, "KOSIS", "KOSIS 2024 v1 (minimal seed)"))

    # 3) seed minimal rows (FOOD_ALL, ALL, BAND_30_50M)
    region_code = "ALL"
    business_type_code = "FOOD_ALL"
    size_band = "BAND_30_50M"

    # ✅ 너가 보여준 값 그대로 “공식 벤치”로 seed
    rows = [
        ("COST_RATIO", 0.84, 0.875, 0.91),
        ("LABOR_RATIO", 0.25, 0.275, 0.30),
        ("PROFIT_RATIO", 0.09, 0.125, 0.16),

        # 아래 3개는 “비용분해 입력 있을 때만” 비교에 의미가 있음.
        # 그래도 공식 테이블에 존재하면 later 확장에 유리해서 같이 넣어둠.
        ("MATERIAL_RATIO", 0.30, 0.325, 0.35),
        ("RENT_RATIO", 0.10, 0.125, 0.15),
        ("OTHER_RATIO", 0.05, 0.075, 0.10),

        # 참고 메트릭(없어도 됨) — analysis에서 null 허용
        ("AVG_REVENUE_ANNUAL", None, 750_000_000, None),
        ("SALES_GROWTH_YOY", None, 0.068, None),
        ("AVG_TICKET_DINEIN", None, 12_500, None),
        ("AVG_TICKET_DELIVERY", None, 13_800, None),
    ]

    for metric, p25, p50, p75 in rows:
        cur.execute("""
            INSERT INTO benchmark_ratios(
              version_key, region_code, business_type_code, size_band, metric, p25, p50, p75
            )
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(version_key, region_code, business_type_code, size_band, metric)
            DO UPDATE SET p25=excluded.p25, p50=excluded.p50, p75=excluded.p75
        """, (version_key, region_code, business_type_code, size_band, metric, p25, p50, p75))

    con.commit()

    # 4) quick check
    cur.execute("""
      SELECT version_key, region_code, business_type_code, size_band, metric, p25, p50, p75
      FROM benchmark_ratios
      WHERE version_key=? AND region_code=? AND business_type_code=? AND size_band=?
      ORDER BY metric
    """, (version_key, region_code, business_type_code, size_band))
    out = cur.fetchall()

    print("✅ benchmark seed OK")
    print(f"- DB: {DB_PATH}")
    print(f"- rows: {len(out)}")
    for r in out:
        print(dict(r))

    con.close()


if __name__ == "__main__":
    main()