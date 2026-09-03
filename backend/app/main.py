# backend/app/main.py
"""
Uvicorn entrypoint shim.

- backend/main.py 에서 생성한 FastAPI app을 그대로 re-export 한다.
- 라우터 include는 backend/main.py에서 이미 처리하므로 여기서 추가로 붙이지 않는다.
  (없는 모듈 import로 부팅이 깨지는 것을 방지)
"""

from main import app  # ✅ backend/main.py의 app을 그대로 사용