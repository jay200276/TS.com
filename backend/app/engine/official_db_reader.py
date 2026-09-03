from __future__ import annotations

from typing import Any, Dict, List, Optional
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "local_dev.db"


_BAND_ORDER = {
    "BAND_0_10M": 0,
    "BAND_10_30M": 1,
    "BAND_30_50M": 2,
    "BAND_50_100M": 3,
    "BAND_100M_PLUS": 4,
}


def _band_rank(size_band: str) -> Optional[int]:
    return _BAND_ORDER.get((size_band or "").strip().upper())


def _sort_size_bands_by_distance(requested_band: str, available_bands: List[str]) -> List[str]:
    requested_rank = _band_rank(requested_band)
    normalized: List[str] = []
    seen = set()
    for band in available_bands:
        band_norm = (band or "").strip().upper()
        if not band_norm or band_norm in seen:
            continue
        seen.add(band_norm)
        normalized.append(band_norm)

    if requested_rank is None:
        return normalized

    known: List[str] = []
    unknown: List[str] = []
    for band in normalized:
        if _band_rank(band) is None:
            unknown.append(band)
        else:
            known.append(band)

    known.sort(key=lambda band: (abs(_band_rank(band) - requested_rank), _band_rank(band)))
    return known + unknown


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(str(DB_PATH))
    con.row_factory = sqlite3.Row
    return con


def _table_exists(con: sqlite3.Connection, table_name: str) -> bool:
    cur = con.cursor()
    cur.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type='table' AND name=?
        LIMIT 1
        """,
        (table_name,),
    )
    return cur.fetchone() is not None


def _resolve_latest_version_key(con: sqlite3.Connection) -> Optional[str]:
    """
    가장 먼저 official_benchmarks에서 실제 존재하는 version_key를 사용한다.
    필요할 때만 official_benchmark_versions를 fallback으로 본다.
    """
    cur = con.cursor()

    # 1) 실제 benchmark row가 들어있는 테이블에서 먼저 확인
    if _table_exists(con, "official_benchmarks"):
        try:
            cur.execute(
                """
                SELECT version_key
                FROM official_benchmarks
                WHERE version_key IS NOT NULL
                  AND TRIM(version_key) <> ''
                GROUP BY version_key
                ORDER BY MAX(id) DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()
            if row and row["version_key"]:
                return str(row["version_key"]).strip()
        except Exception:
            pass

    # 2) fallback: old version table
    if _table_exists(con, "official_benchmark_versions"):
        try:
            cur.execute(
                """
                SELECT version_key
                FROM official_benchmark_versions
                ORDER BY created_at DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()
            if row and row["version_key"]:
                return str(row["version_key"]).strip()
        except Exception:
            pass

    return None


def get_benchmark(
    *,
    metric: str,
    region_code: str,
    business_type_code: str,
    size_band: str,
    version_key: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    metric = (metric or "").strip().upper()
    region_code = (region_code or "ALL").strip().upper()
    business_type_code = (business_type_code or "").strip().upper()
    size_band = (size_band or "").strip().upper()

    if not metric or not business_type_code or not size_band:
        return None

    con = _connect()
    cur = con.cursor()

    vkey = (version_key or "").strip() or None
    if vkey is None:
        vkey = _resolve_latest_version_key(con)

    if not vkey:
        con.close()
        return None

    def _query(rc: str, bt: str) -> Optional[Dict[str, Any]]:
        def _fetch_for_band(target_band: str, *, ratio_only: bool) -> Optional[Dict[str, Any]]:
            sql = """
                SELECT
                  version_key,
                  region_code,
                  business_type_code,
                  size_band,
                  metric,
                  p25,
                  p50,
                  p75,
                  unit,
                  period
                FROM official_benchmarks
                WHERE version_key = ?
                  AND region_code = ?
                  AND business_type_code = ?
                  AND size_band = ?
                  AND metric = ?
            """
            params = [vkey, rc, bt, target_band, metric]
            if ratio_only:
                sql += " AND unit = 'ratio'"
            sql += " LIMIT 1"
            cur.execute(sql, params)
            row = cur.fetchone()
            return dict(row) if row else None

        available_bands: List[str] = []
        cur.execute(
            """
            SELECT DISTINCT size_band
            FROM official_benchmarks
            WHERE version_key = ?
              AND region_code = ?
              AND business_type_code = ?
              AND metric = ?
              AND size_band IS NOT NULL
              AND TRIM(size_band) <> ''
            """,
            (vkey, rc, bt, metric),
        )
        for row in cur.fetchall():
            available_bands.append(str(row[0]).strip().upper())

        candidate_bands = _sort_size_bands_by_distance(size_band, [size_band, *available_bands])

        for target_band in candidate_bands:
            row = _fetch_for_band(target_band, ratio_only=True)
            if row:
                return row

        for target_band in candidate_bands:
            row = _fetch_for_band(target_band, ratio_only=False)
            if row:
                return row

        return None

    # 1) exact region + exact business
    out = _query(region_code, business_type_code)
    if out:
        con.close()
        return out

    # 2) ALL region + exact business
    if region_code != "ALL":
        out = _query("ALL", business_type_code)
        if out:
            con.close()
            return out

    # 3) exact region + FOOD_ALL business
    if business_type_code != "FOOD_ALL":
        out = _query(region_code, "FOOD_ALL")
        if out:
            con.close()
            return out

    # 4) ALL region + FOOD_ALL business
    if region_code != "ALL" or business_type_code != "FOOD_ALL":
        out = _query("ALL", "FOOD_ALL")
        if out:
            con.close()
            return out

    con.close()
    return None
