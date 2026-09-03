from pydantic import BaseModel

class Settings(BaseModel):
    # 초기 MVP: 하드코딩. 나중에 env로 분리 가능
    benchmarks_version: str = "v1"
    default_business_type_code: str = "FOOD_ALL"

settings = Settings()