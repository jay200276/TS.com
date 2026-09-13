# backend/app/engine/business_type_mapper.py  (FULL REPLACE)
from __future__ import annotations

from typing import Optional


def _norm(s: Optional[str]) -> str:
    """
    사용자 UI의 한글 라벨을 최대한 안전하게 정규화.
    - 공백/슬래시/괄호/이모지 등은 대충 무시하고 매칭되게
    """
    if not s:
        return ""
    x = str(s).strip().lower()
    for ch in [" ", "\t", "\n", "/", "·", "(", ")", "[", "]", "{", "}", "-", "_"]:
        x = x.replace(ch, "")
    # 이모지/특수문자 일부 제거(완전 제거는 아니고 핵심만)
    x = x.replace("🍚", "").replace("🍜", "").replace("🍣", "").replace("🥘", "")
    x = x.replace("🍖", "").replace("🍗", "").replace("🍕", "").replace("🍔", "")
    x = x.replace("🍩", "").replace("🍰", "").replace("☕", "").replace("🍺", "")
    x = x.replace("🥃", "")
    return x


# ✅ UI 세부 업종(라벨) -> 내부 대표 business_type_code 로 매핑.
# official_benchmarks에 업종별(KOREAN/CHINESE/JAPANESE/...) 데이터가 실제로 존재하므로
# (analysis_engine.py의 _normalize_industry_detail과 동일 기준으로 맞춤),
# 예전처럼 전부 FOOD_ALL로 뭉뚱그리지 않고 세부 업종 데이터를 그대로 활용한다.
_DETAIL_TO_BIZ: dict[str, str] = {
    # ----- 음식점(세분) -----
    _norm("백반/한식"): "KOREAN",
    _norm("찜,탕"): "KOREAN",
    _norm("고기"): "KOREAN",
    _norm("도시락"): "KOREAN",
    _norm("족발"): "KOREAN",
    _norm("기타(일반)"): "KOREAN",
    _norm("중식"): "CHINESE",
    _norm("일식"): "JAPANESE",
    _norm("치킨"): "CHICKEN",
    _norm("피자"): "PIZZA",
    _norm("패스트푸드"): "FASTFOOD",
    _norm("간식"): "SNACK",
    _norm("야식"): "SNACK",
    _norm("아시아"): "ASIAN_OTHER",
    _norm("양식"): "WESTERN",
    _norm("기타"): "FOOD_ALL",

    # ----- 카페/베이커리 -----
    _norm("카페"): "CAFE",
    _norm("디저트"): "DESSERT",
    _norm("베이커리"): "BAKERY",
    _norm("제과/베이커리"): "BAKERY",

    # ----- 주점/기타 -----
    _norm("주점"): "PUB",
}


def map_detail_to_biz_code(detail_label: Optional[str], fallback: str = "FOOD_ALL") -> str:
    """
    UI에서 선택된 세부 업종 라벨을,
    공식 벤치마크 조회에 사용할 대표 business_type_code로 변환.

    - 매칭되면: KOREAN / CHINESE / JAPANESE / CHICKEN / PIZZA / FASTFOOD / SNACK /
      ASIAN_OTHER / WESTERN / CAFE / DESSERT / BAKERY / PUB / FOOD_ALL 중 하나
    - 매칭 안 되면: fallback(기본은 FOOD_ALL)
    """
    key = _norm(detail_label)
    if not key:
        return str(fallback or "FOOD_ALL")

    mapped = _DETAIL_TO_BIZ.get(key)
    if mapped:
        return mapped

    # 키워드 기반 약매칭(안전하게)
    # "디저트카페" 같은 값이 들어와도 잡히게
    if "카페" in key or "디저트" in key or "베이커리" in key:
        return "CAFE"
    if "주점" in key or "술" in key or "호프" in key or "바" in key:
        return "PUB"

    return str(fallback or "FOOD_ALL")