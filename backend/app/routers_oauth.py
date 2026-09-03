# backend/app/routers_oauth.py
from __future__ import annotations

from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import os
import secrets
import uuid

from dotenv import load_dotenv, dotenv_values
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import RedirectResponse, HTMLResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User, AccessToken
from app.security import generate_token, hash_token, hash_password


# ---------------------------------------------------------------------
# .env load
# ---------------------------------------------------------------------
# 현재 파일 위치: backend/app/routers_oauth.py
# .env 위치:      backend/.env
BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"

# ✅ 기존 환경변수보다 .env 값을 우선 반영
load_dotenv(ENV_PATH, override=True)

# ✅ 혹시 os.environ 반영이 꼬여도 직접 .env 값을 읽을 수 있게 보조 맵 확보
ENV_FILE_VALUES = {
    str(k): str(v).strip()
    for k, v in dotenv_values(ENV_PATH).items()
    if v is not None
}

router = APIRouter(prefix="/auth/oauth", tags=["oauth"])


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------
def _required_env(name: str) -> str:
    # 1차: 프로세스 환경변수
    v = (os.getenv(name) or "").strip()
    if v:
        return v

    # 2차: .env 파일 직접 fallback
    v2 = (ENV_FILE_VALUES.get(name) or "").strip()
    if v2:
        return v2

    raise HTTPException(status_code=500, detail=f"Missing env: {name}")


def _optional_env(name: str, default: str = "") -> str:
    v = (os.getenv(name) or "").strip()
    if v:
        return v
    return (ENV_FILE_VALUES.get(name) or default).strip()


def _json_request(url: str, method: str = "GET", headers: dict | None = None, data: bytes | None = None) -> dict:
    req = Request(url=url, data=data, headers=headers or {}, method=method)
    try:
        with urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body)
    except HTTPError as e:
        try:
            raw = e.read().decode("utf-8")
        except Exception:
            raw = str(e)
        raise HTTPException(status_code=502, detail=f"OAuth upstream HTTPError: {raw}")
    except URLError as e:
        raise HTTPException(status_code=502, detail=f"OAuth upstream URLError: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OAuth request failed: {e}")


def _frontend_member_url() -> str:
    return _optional_env("FRONTEND_MEMBER_URL", "http://127.0.0.1:5500/frontend/member.html")


def _frontend_login_url() -> str:
    return _optional_env("FRONTEND_LOGIN_URL", "http://127.0.0.1:5500/frontend/login.html")


def _issue_service_token_for_user(db: Session, user: User) -> str:
    token = generate_token()
    token_h = hash_token(token)

    at = AccessToken(token_hash=token_h, user_id=user.id)
    db.add(at)
    db.commit()

    return token


def _token_redirect_html(token: str, target_url: str) -> HTMLResponse:
    safe_target = json.dumps(target_url, ensure_ascii=False)
    safe_token = json.dumps(token, ensure_ascii=False)

    html = f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>로그인 처리 중...</title>
</head>
<body>
  <script>
    try {{
      localStorage.setItem("ts_access_token_v1", {safe_token});
      window.location.replace({safe_target});
    }} catch (e) {{
      document.body.innerHTML = "로그인 저장 중 오류가 발생했습니다: " + String(e);
    }}
  </script>
</body>
</html>"""
    return HTMLResponse(content=html, status_code=200)


# ---------------------------------------------------------------------
# Start Routes
# ---------------------------------------------------------------------
@router.get("/kakao/start")
def kakao_start():
    client_id = _required_env("KAKAO_CLIENT_ID")
    redirect_uri = _required_env("KAKAO_REDIRECT_URI")

    q = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
    }
    url = "https://kauth.kakao.com/oauth/authorize?" + urlencode(q)
    return RedirectResponse(url)


@router.get("/naver/start")
def naver_start():
    client_id = _required_env("NAVER_CLIENT_ID")
    redirect_uri = _required_env("NAVER_REDIRECT_URI")

    state = _optional_env("NAVER_OAUTH_STATE", "ts_state")

    q = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
    }
    url = "https://nid.naver.com/oauth2.0/authorize?" + urlencode(q)
    return RedirectResponse(url)


@router.get("/google/start")
def google_start():
    client_id = _required_env("GOOGLE_CLIENT_ID")
    redirect_uri = _required_env("GOOGLE_REDIRECT_URI")

    q = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "prompt": "select_account",
    }
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(q)
    return RedirectResponse(url)


# ---------------------------------------------------------------------
# Callback Routes
# ---------------------------------------------------------------------
@router.get("/kakao/callback")
def kakao_callback(code: str = ""):
    return {"ok": True, "provider": "kakao", "code": code}


@router.get("/naver/callback")
def naver_callback(
    code: str = "",
    state: str = "",
    error: str = "",
    error_description: str = "",
    db: Session = Depends(get_db),
):
    if error:
        raise HTTPException(status_code=400, detail=f"Naver OAuth error: {error} / {error_description}")

    if not code:
        raise HTTPException(status_code=400, detail="Missing code from Naver callback")

    expected_state = _optional_env("NAVER_OAUTH_STATE", "ts_state")
    if state != expected_state:
        raise HTTPException(status_code=400, detail="Invalid naver state")

    client_id = _required_env("NAVER_CLIENT_ID")
    client_secret = _required_env("NAVER_CLIENT_SECRET")
    redirect_uri = _required_env("NAVER_REDIRECT_URI")

    token_query = {
        "grant_type": "authorization_code",
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "state": state,
        "redirect_uri": redirect_uri,
    }
    token_url = "https://nid.naver.com/oauth2.0/token?" + urlencode(token_query)
    token_payload = _json_request(token_url, method="GET")

    access_token = str(token_payload.get("access_token") or "").strip()
    if not access_token:
        raise HTTPException(status_code=502, detail=f"Naver token exchange failed: {token_payload}")

    me_payload = _json_request(
        "https://openapi.naver.com/v1/nid/me",
        method="GET",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    response_obj = me_payload.get("response") or {}
    email = str(response_obj.get("email") or "").strip().lower()

    if not email:
        raise HTTPException(
            status_code=400,
            detail="Naver account did not return email. Check Naver app permission settings for email.",
        )

    user = db.query(User).filter(User.email == email).first()

    if not user:
        random_password = f"naver-social-{uuid.uuid4().hex}-{secrets.token_hex(8)}"
        user = User(
            email=email,
            password_hash=hash_password(random_password),
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    service_token = _issue_service_token_for_user(db, user)
    target_url = _frontend_member_url()
    return _token_redirect_html(service_token, target_url)


@router.get("/google/callback")
def google_callback(
    code: str = "",
    error: str = "",
    db: Session = Depends(get_db),
):
    if error:
        raise HTTPException(status_code=400, detail=f"Google OAuth error: {error}")

    if not code:
        raise HTTPException(status_code=400, detail="Missing code from Google callback")

    client_id = _required_env("GOOGLE_CLIENT_ID")
    client_secret = _required_env("GOOGLE_CLIENT_SECRET")
    redirect_uri = _required_env("GOOGLE_REDIRECT_URI")

    # 1️⃣ code → access token 교환
    token_data = urlencode({
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }).encode()

    token_payload = _json_request(
        "https://oauth2.googleapis.com/token",
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data=token_data,
    )

    access_token = str(token_payload.get("access_token") or "").strip()

    if not access_token:
        raise HTTPException(status_code=502, detail=f"Google token exchange failed: {token_payload}")

    # 2️⃣ 사용자 정보 조회
    me_payload = _json_request(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        method="GET",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    email = str(me_payload.get("email") or "").strip().lower()

    if not email:
        raise HTTPException(status_code=400, detail="Google account did not return email")

    # 3️⃣ 기존 유저 조회
    user = db.query(User).filter(User.email == email).first()

    # 4️⃣ 없으면 자동 생성
    if not user:
        random_password = f"google-social-{uuid.uuid4().hex}-{secrets.token_hex(8)}"

        user = User(
            email=email,
            password_hash=hash_password(random_password),
        )

        db.add(user)
        db.commit()
        db.refresh(user)

    # 5️⃣ TS 서비스 토큰 발급
    service_token = _issue_service_token_for_user(db, user)

    target_url = _frontend_member_url()

    return _token_redirect_html(service_token, target_url)