# backend/app/etl/load_official_csv.py
from __future__ import annotations

import argparse
import csv
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Optional


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _read_csv(path: Path) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows: List[Dict[str, str]] = []
        for r in reader:
            rows.append({k: (v if v is not None else "") for k, v in r.items()})
        return rows


def _ensure_dir(p: Path):
    if not p.exists():
        raise FileNotFoundError(f"CSV directory not found: {p}")


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def _exec(conn: sqlite3.Connection, sql: str):
    conn.execute(sql)


def _create_tables(conn: sqlite3.Connection):
    _exec(
        conn,
        """
        CREATE TABLE IF NOT EXISTS official_vat_simple_thresholds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            year_applied INTEGER NOT NULL,
            effective_from TEXT NOT NULL,
            annual_sales_upper_vat_included INTEGER NOT NULL,
            annual_sales_vat_exempt_upper_vat_included INTEGER,
            source_title TEXT,
            source_url TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(year_applied, effective_from)
        );
        """,
    )

    _exec(
        conn,
        """
        CREATE TABLE IF NOT EXISTS official_simple_excluded_areas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            effective_from TEXT NOT NULL,
            si_do TEXT NOT NULL,
            si_gun_gu TEXT NOT NULL,
            eup_myeon_dong TEXT NOT NULL,
            note TEXT,
            source_title TEXT,
            source_url TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(effective_from, si_do, si_gun_gu, eup_myeon_dong)
        );
        """,
    )

    _exec(
        conn,
        """
        CREATE TABLE IF NOT EXISTS official_deemed_input_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            year_applied INTEGER NOT NULL,
            business_entity TEXT NOT NULL,
            industry_group TEXT NOT NULL,
            tax_base_band TEXT NOT NULL,
            rate_numerator INTEGER NOT NULL,
            rate_denominator INTEGER NOT NULL,
            limit_ratio REAL NOT NULL,
            source_title TEXT,
            source_url TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(year_applied, business_entity, industry_group, tax_base_band)
        );
        """,
    )

    _exec(
        conn,
        """
        CREATE TABLE IF NOT EXISTS official_expense_ratio_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            year_applied INTEGER NOT NULL,
            hometax_industry_code TEXT NOT NULL,
            industry_label TEXT,
            simple_rate REAL,
            standard_main_rate REAL,
            standard_other_rate REAL,
            source_title TEXT,
            source_url TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(year_applied, hometax_industry_code)
        );
        """,
    )

    # ✅ FIX: SQLite는 UNIQUE에 COALESCE 같은 "표현식" 금지
    # → industry_code_norm 컬럼을 만들어 빈값을 ""로 저장하고 UNIQUE에 사용
    _exec(
        conn,
        """
        CREATE TABLE IF NOT EXISTS official_insurance_rates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            year_applied INTEGER NOT NULL,
            item TEXT NOT NULL,
            employer_rate REAL NOT NULL,
            employee_rate REAL NOT NULL,
            lower_bound INTEGER,
            upper_bound INTEGER,
            industry_code TEXT,
            industry_code_norm TEXT NOT NULL DEFAULT '',
            source_title TEXT,
            source_url TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(year_applied, item, industry_code_norm)
        );
        """,
    )


def _to_int(v: str, default: int = 0) -> int:
    s = (v or "").strip()
    if not s:
        return default
    return int(float(s))


def _to_float(v: str, default: float = 0.0) -> float:
    s = (v or "").strip()
    if not s:
        return default
    return float(s)


def _to_text(v: str) -> Optional[str]:
    s = (v or "").strip()
    return s if s != "" else None


def _upsert_many(conn: sqlite3.Connection, table: str, cols: List[str], rows: List[Tuple]):
    if not rows:
        return 0

    placeholders = ",".join(["?"] * len(cols))
    col_list = ",".join(cols)

    update_cols = [c for c in cols if c != "created_at"]
    update_set = ",".join([f"{c}=excluded.{c}" for c in update_cols])

    sql = f"""
    INSERT INTO {table} ({col_list})
    VALUES ({placeholders})
    ON CONFLICT DO UPDATE SET
    {update_set}
    ;
    """

    cur = conn.cursor()
    cur.executemany(sql, rows)
    return cur.rowcount


def load_vat_simple_thresholds(conn: sqlite3.Connection, csv_dir: Path) -> int:
    path = csv_dir / "vat_simple_thresholds.csv"
    data = _read_csv(path)
    now = _now_iso()

    cols = [
        "year_applied",
        "effective_from",
        "annual_sales_upper_vat_included",
        "annual_sales_vat_exempt_upper_vat_included",
        "source_title",
        "source_url",
        "created_at",
        "updated_at",
    ]
    rows = []
    for r in data:
        rows.append(
            (
                _to_int(r.get("year_applied", "")),
                str(r.get("effective_from", "")).strip(),
                _to_int(r.get("annual_sales_upper_vat_included", "")),
                _to_int(r.get("annual_sales_vat_exempt_upper_vat_included", "")) or None,
                _to_text(r.get("source_title", "")),
                _to_text(r.get("source_url", "")),
                now,
                now,
            )
        )
    return _upsert_many(conn, "official_vat_simple_thresholds", cols, rows)


def load_simple_excluded_areas(conn: sqlite3.Connection, csv_dir: Path) -> int:
    path = csv_dir / "simple_excluded_areas.csv"
    data = _read_csv(path)
    now = _now_iso()

    cols = [
        "effective_from",
        "si_do",
        "si_gun_gu",
        "eup_myeon_dong",
        "note",
        "source_title",
        "source_url",
        "created_at",
        "updated_at",
    ]
    rows = []
    for r in data:
        rows.append(
            (
                str(r.get("effective_from", "")).strip(),
                str(r.get("si_do", "")).strip(),
                str(r.get("si_gun_gu", "")).strip(),
                str(r.get("eup_myeon_dong", "")).strip(),
                _to_text(r.get("note", "")),
                _to_text(r.get("source_title", "")),
                _to_text(r.get("source_url", "")),
                now,
                now,
            )
        )
    return _upsert_many(conn, "official_simple_excluded_areas", cols, rows)


def load_deemed_input_rules(conn: sqlite3.Connection, csv_dir: Path) -> int:
    path = csv_dir / "deemed_input_rules.csv"
    data = _read_csv(path)
    now = _now_iso()

    cols = [
        "year_applied",
        "business_entity",
        "industry_group",
        "tax_base_band",
        "rate_numerator",
        "rate_denominator",
        "limit_ratio",
        "source_title",
        "source_url",
        "created_at",
        "updated_at",
    ]
    rows = []
    for r in data:
        rows.append(
            (
                _to_int(r.get("year_applied", "")),
                str(r.get("business_entity", "")).strip().upper(),
                str(r.get("industry_group", "")).strip().upper(),
                str(r.get("tax_base_band", "")).strip().upper(),
                _to_int(r.get("rate_numerator", "")),
                _to_int(r.get("rate_denominator", "")),
                _to_float(r.get("limit_ratio", "")),
                _to_text(r.get("source_title", "")),
                _to_text(r.get("source_url", "")),
                now,
                now,
            )
        )
    return _upsert_many(conn, "official_deemed_input_rules", cols, rows)


def load_expense_ratio_rules(conn: sqlite3.Connection, csv_dir: Path) -> int:
    path = csv_dir / "expense_ratio_rules.csv"
    data = _read_csv(path)
    now = _now_iso()

    cols = [
        "year_applied",
        "hometax_industry_code",
        "industry_label",
        "simple_rate",
        "standard_main_rate",
        "standard_other_rate",
        "source_title",
        "source_url",
        "created_at",
        "updated_at",
    ]
    rows = []
    for r in data:
        rows.append(
            (
                _to_int(r.get("year_applied", "")),
                str(r.get("hometax_industry_code", "")).strip(),
                _to_text(r.get("industry_label", "")),
                _to_float(r.get("simple_rate", ""), default=0.0),
                _to_float(r.get("standard_main_rate", ""), default=0.0),
                _to_float(r.get("standard_other_rate", ""), default=0.0),
                _to_text(r.get("source_title", "")),
                _to_text(r.get("source_url", "")),
                now,
                now,
            )
        )
    return _upsert_many(conn, "official_expense_ratio_rules", cols, rows)


def load_insurance_rates(conn: sqlite3.Connection, csv_dir: Path) -> int:
    path = csv_dir / "insurance_rates.csv"
    data = _read_csv(path)
    now = _now_iso()

    cols = [
        "year_applied",
        "item",
        "employer_rate",
        "employee_rate",
        "lower_bound",
        "upper_bound",
        "industry_code",
        "industry_code_norm",
        "source_title",
        "source_url",
        "created_at",
        "updated_at",
    ]
    rows = []
    for r in data:
        raw_ind = (r.get("industry_code", "") or "").strip()
        ind_norm = raw_ind  # 없으면 "" 로 저장됨

        rows.append(
            (
                _to_int(r.get("year_applied", "")),
                str(r.get("item", "")).strip().upper(),
                _to_float(r.get("employer_rate", "")),
                _to_float(r.get("employee_rate", "")),
                (_to_int(r.get("lower_bound", ""), default=0) if (r.get("lower_bound", "") or "").strip() else None),
                (_to_int(r.get("upper_bound", ""), default=0) if (r.get("upper_bound", "") or "").strip() else None),
                (raw_ind if raw_ind != "" else None),
                ind_norm,
                _to_text(r.get("source_title", "")),
                _to_text(r.get("source_url", "")),
                now,
                now,
            )
        )
    return _upsert_many(conn, "official_insurance_rates", cols, rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=r".\local_dev.db", help="SQLite db path (e.g., .\\local_dev.db)")
    ap.add_argument("--dir", default=r".\data\official", help="CSV directory (e.g., .\\data\\official)")
    args = ap.parse_args()

    db_path = Path(args.db).resolve()
    csv_dir = Path(args.dir).resolve()
    _ensure_dir(csv_dir)

    conn = _connect(db_path)
    try:
        _create_tables(conn)

        conn.execute("BEGIN;")
        c1 = load_vat_simple_thresholds(conn, csv_dir)
        c2 = load_simple_excluded_areas(conn, csv_dir)
        c3 = load_deemed_input_rules(conn, csv_dir)
        c4 = load_expense_ratio_rules(conn, csv_dir)
        c5 = load_insurance_rates(conn, csv_dir)
        conn.commit()

        print("[DONE] DB:", db_path)
        print("[DONE] CSV:", csv_dir)
        print("[OK] vat_simple_thresholds:", c1)
        print("[OK] simple_excluded_areas:", c2)
        print("[OK] deemed_input_rules:", c3)
        print("[OK] expense_ratio_rules:", c4)
        print("[OK] insurance_rates:", c5)

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()