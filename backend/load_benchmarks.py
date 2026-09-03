import csv
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "local_dev.db"
CSV_PATH = BASE_DIR / "data" / "benchmark_v1_band_10_30m.csv"

def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    inserted = 0
    updated = 0

    for r in rows:

        version_key = r["version_key"]
        region_code = r["region_code"]
        size_band = r["size_band"]
        business_type_code = r["business_type_code"]
        metric = r["metric"]

        p25 = float(r["p25"]) if r["p25"] else None
        p50 = float(r["p50"]) if r["p50"] else None
        p75 = float(r["p75"]) if r["p75"] else None

        exists = cur.execute("""
            SELECT id
            FROM official_benchmarks
            WHERE version_key = ?
            AND region_code = ?
            AND size_band = ?
            AND business_type_code = ?
            AND metric = ?
        """, (
            version_key,
            region_code,
            size_band,
            business_type_code,
            metric
        )).fetchone()

        if exists:

            cur.execute("""
                UPDATE official_benchmarks
                SET p25 = ?, p50 = ?, p75 = ?
                WHERE id = ?
            """, (
                p25,
                p50,
                p75,
                exists[0]
            ))

            updated += 1

        else:

            cur.execute("""
                INSERT INTO official_benchmarks (
                    version_key,
                    region_code,
                    size_band,
                    business_type_code,
                    metric,
                    p25,
                    p50,
                    p75,
                    unit,
                    period
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                version_key,
                region_code,
                size_band,
                business_type_code,
                metric,
                p25,
                p50,
                p75,
                "ratio",
                "2024"
            ))

            inserted += 1

    conn.commit()
    conn.close()

    print(f"done - inserted={inserted}, updated={updated}, total_csv={len(rows)}")


if __name__ == "__main__":
    main()