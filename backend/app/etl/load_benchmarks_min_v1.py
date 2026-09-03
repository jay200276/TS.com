# backend/etl/load_benchmarks_min_v1.py
from __future__ import annotations

import argparse
import csv
import sqlite3
from pathlib import Path


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS official_benchmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            year INTEGER NOT NULL,
            metric_code TEXT NOT NULL,
            business_type_code TEXT NOT NULL,
            region_code TEXT NOT NULL DEFAULT 'ALL',
            sales_band_code TEXT NOT NULL DEFAULT 'ALL',
            p25 REAL,
            p50 REAL,
            p75 REAL,
            value REAL,
            unit TEXT,
            dataset TEXT,
            source TEXT,
            version_key TEXT,
            note TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_official_benchmarks_lookup
        ON official_benchmarks(year, metric_code, business_type_code, region_code, sales_band_code);
        """
    )
    conn.commit()


def to_float(s: str | None):
    if s is None:
        return None
    s = str(s).strip()
    if s == "":
        return None
    return float(s)


def to_int(s: str | None):
    if s is None:
        return None
    s = str(s).strip()
    if s == "":
        return None
    return int(s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, help="path to sqlite db (e.g. ./local_dev.db)")
    ap.add_argument("--csv", required=True, help="path to csv file (e.g. ./data/benchmarks_min_v1.csv)")
    args = ap.parse_args()

    db_path = Path(args.db)
    csv_path = Path(args.csv)

    if not db_path.exists():
        raise SystemExit(f"[ERR] DB not found: {db_path}")
    if not csv_path.exists():
        raise SystemExit(f"[ERR] CSV not found: {csv_path}")

    conn = sqlite3.connect(str(db_path))
    ensure_table(conn)

    inserted = 0
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        required = [
            "year","metric_code","business_type_code","region_code","sales_band_code",
            "p25","p50","p75","value","unit","dataset","source","version_key","note"
        ]
        for k in required:
            if k not in reader.fieldnames:
                raise SystemExit(f"[ERR] CSV missing column: {k}")

        for row in reader:
            year = to_int(row["year"])
            metric_code = (row["metric_code"] or "").strip()
            biz = (row["business_type_code"] or "").strip()
            region = (row["region_code"] or "ALL").strip() or "ALL"
            band = (row["sales_band_code"] or "ALL").strip() or "ALL"

            if year is None or not metric_code or not biz:
                raise SystemExit(f"[ERR] invalid row (year/metric_code/business_type_code required): {row}")

            conn.execute(
                """
                INSERT INTO official_benchmarks
                (year, metric_code, business_type_code, region_code, sales_band_code,
                 p25, p50, p75, value, unit, dataset, source, version_key, note)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    year, metric_code, biz, region, band,
                    to_float(row["p25"]), to_float(row["p50"]), to_float(row["p75"]),
                    to_float(row["value"]),
                    (row["unit"] or "").strip() or None,
                    (row["dataset"] or "").strip() or None,
                    (row["source"] or "").strip() or None,
                    (row["version_key"] or "").strip() or None,
                    (row["note"] or "").strip() or None,
                )
            )
            inserted += 1

    conn.commit()

    cur = conn.execute(
        "SELECT metric_code, COUNT(*) FROM official_benchmarks GROUP BY metric_code ORDER BY COUNT(*) DESC"
    )
    counts = cur.fetchall()
    conn.close()

    print(f"[DONE] inserted={inserted}")
    print("[COUNTS]")
    for metric_code, n in counts:
        print(f"- {metric_code}: {n}")


if __name__ == "__main__":
    main()