# backend/app/engine/tax_engine.py
"""
Stable engine entry module.

backend/main.py imports:
  from app.engine.tax_engine import (
      EngineMeta,
      decide_taxpayer_type,
      compute_vat_simple,
      compute_vat_general,
      compute_income_tax,
      compute_local_income_tax,
      compute_insurance_employer_estimate,
      compute_expense_ratio_hint,
  )

Your actual implementation lives in app.engine.tax_engine_kr.
This file re-exports those names to keep imports stable (LOCK-friendly).
"""

from __future__ import annotations

# Re-export from the KR engine implementation
from app.engine.tax_engine_kr import (  # noqa: F401
    EngineMeta,
    decide_taxpayer_type,
    compute_vat_simple,
    compute_vat_general,
    compute_income_tax,
    compute_local_income_tax,
    compute_insurance_employer_estimate,
    compute_expense_ratio_hint,
)