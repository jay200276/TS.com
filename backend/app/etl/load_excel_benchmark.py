import pandas as pd
from sqlalchemy import create_engine
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]

DB_PATH = BASE_DIR / "benchmark.db"
EXCEL_PATH = BASE_DIR / "data" / "분석 조사.xlsx"

engine = create_engine(f"sqlite:///{DB_PATH}")


def load_excel():

    xls = pd.ExcelFile(EXCEL_PATH)

    print("Sheets:", xls.sheet_names)

    for sheet in xls.sheet_names:

        df = pd.read_excel(EXCEL_PATH, sheet_name=sheet)

        table_name = sheet.replace(" ", "_").replace("-", "_")

        df.to_sql(
            table_name,
            engine,
            if_exists="replace",
            index=False
        )

        print(f"Loaded → {table_name}")


if __name__ == "__main__":
    load_excel()