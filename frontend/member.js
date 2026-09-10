// frontend/member.js  (FULL REPLACE)
(() => {
  if (window.__TS_MEMBER_BOUND) return;
  window.__TS_MEMBER_BOUND = true;

  const $ = (id) => document.getElementById(id);
  const goDashNav = (which) => document.querySelector(`[data-dash-nav="${which}"]`)?.click();

  const LS_TOKEN_KEY = "ts_access_token_v1";
  const LS_API_BASE_KEY = "ts_api_base_v1";
  const LS_MEMBER_DRAFT_KEY = "ts_member_calc_draft_v1";
  const LS_ACTION_CHECK_KEY = "ts_action_check_v1";
  const LS_TODO_CUSTOM_KEY = "ts_dash_todo_custom_v1";
  const LS_TODO_OVERRIDE_KEY = "ts_dash_todo_override_v1";
  const LS_TODO_DELETED_KEY = "ts_dash_todo_deleted_v1";
  const LS_MONTH_GOAL_KEY = "ts_month_goal_v1";
  const LS_SAVE_SCENARIOS_KEY = "ts_save_scenarios_v1";
  const LS_EVIDENCE_REMINDER_KEY = "ts_evidence_reminder_v1";
  const LS_ALERT_THRESHOLD_KEY = "ts_alert_threshold_v1";
  const DEFAULT_ALERT_THRESHOLD_PP = 10;
  const METRIC_WORSE_WHEN_HIGH = {
    COST_RATIO: true,
    LABOR_RATIO: true,
    MATERIAL_RATIO: true,
    RENT_RATIO: true,
    OTHER_RATIO: true,
    PROFIT_RATIO: false,
  };

  const DEFAULT_API_BASE = (() => {
    const h = location.hostname;
    return (h === "localhost" || h === "127.0.0.1") ? "http://127.0.0.1:8000" : "";
  })();

  let reportTrendChart = null;
  let reportTrendMetric = "sales";
  let lastResponse = null;
  let lastV2Data = null;

  function normalizeBase(v) {
    const s = String(v || "").trim();
    return s ? s.replace(/\/+$/g, "") : "";
  }
  function getApiBase() {
    return normalizeBase(localStorage.getItem(LS_API_BASE_KEY)) || DEFAULT_API_BASE;
  }
  function getToken() {
    return String(localStorage.getItem(LS_TOKEN_KEY) || "").trim();
  }

  // Render 무료 플랜은 트래픽이 몰리면 연결이 끊기는 경우(ERR_CONNECTION_CLOSED 등)가 있어,
  // HTTP 응답을 받기 전에 네트워크 단에서 실패하면 짧게 재시도한다. (HTTP 에러 상태는 재시도하지 않음)
  async function fetchWithRetry(url, options, retries = 2, delayMs = 1000) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetch(url, options);
      } catch (e) {
        if (attempt >= retries) throw e;
        console.warn(`[TS] fetch failed (attempt ${attempt + 1}/${retries + 1}), retrying:`, e);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  const UI_INDUSTRY_MAP = {
    "백반/한식": { industry_code: "5611", business_type_code: "FOOD_ALL", hometax_industry_code: "5611" },
    "찜·탕":     { industry_code: "5611", business_type_code: "FOOD_ALL", hometax_industry_code: "5611" },
    "고기":       { industry_code: "5611", business_type_code: "FOOD_ALL", hometax_industry_code: "5611" },
    "도시락":     { industry_code: "5611", business_type_code: "FOOD_ALL", hometax_industry_code: "5611" },
    "족발":       { industry_code: "5611", business_type_code: "FOOD_ALL", hometax_industry_code: "5611" },
    "기타(일반)": { industry_code: "5611", business_type_code: "FOOD_ALL", hometax_industry_code: "5611" },

    "중식": { industry_code: "5612", business_type_code: "FOOD_ALL", hometax_industry_code: "5612" },
    "일식": { industry_code: "5613", business_type_code: "FOOD_ALL", hometax_industry_code: "5613" },

    "치킨": { industry_code: "5621", business_type_code: "FOOD_ALL", hometax_industry_code: "5621" },
    "피자": { industry_code: "5622", business_type_code: "FOOD_ALL", hometax_industry_code: "5622" },
    "패스트푸드": { industry_code: "5622", business_type_code: "FOOD_ALL", hometax_industry_code: "5622" },

    "간식": { industry_code: "5623", business_type_code: "FOOD_ALL", hometax_industry_code: "5623" },
    "야식": { industry_code: "5623", business_type_code: "FOOD_ALL", hometax_industry_code: "5623" },

    "아시아": { industry_code: "5611", business_type_code: "FOOD_ALL", hometax_industry_code: "5611", _temp: true },
    "양식":   { industry_code: "5611", business_type_code: "FOOD_ALL", hometax_industry_code: "5611", _temp: true },

    "카페": { industry_code: null, business_type_code: "FOOD_ALL", hometax_industry_code: null, _pending: true },
    "디저트": { industry_code: null, business_type_code: "FOOD_ALL", hometax_industry_code: null, _pending: true },
    "제과/베이커리": { industry_code: null, business_type_code: "FOOD_ALL", hometax_industry_code: null, _pending: true },
    "주점": { industry_code: null, business_type_code: "FOOD_ALL", hometax_industry_code: null, _pending: true },
  };

  function isLikelyIndustryCode(v) {
    const s = String(v || "").trim();
    if (!s) return false;
    return /^[0-9]{4,6}$/.test(s) || /^[A-Z_]{3,20}$/.test(s);
  }

  function resolveIndustrySelection(selValue) {
    const raw = String(selValue || "").trim();
    if (!raw) {
      return {
        ui_industry_label: null,
        industry_code: null,
        business_type_code: "FOOD_ALL",
        hometax_industry_code: null,
        _unknown: true
      };
    }

    if (isLikelyIndustryCode(raw) && !UI_INDUSTRY_MAP[raw]) {
      return {
        ui_industry_label: raw,
        industry_code: raw,
        business_type_code: "FOOD_ALL",
        hometax_industry_code: null,
        _legacy: true
      };
    }

    const m = UI_INDUSTRY_MAP[raw];
    if (m) {
      return {
        ui_industry_label: raw,
        industry_code: m.industry_code ?? null,
        business_type_code: m.business_type_code ?? "FOOD_ALL",
        hometax_industry_code: m.hometax_industry_code ?? null,
        _temp: !!m._temp,
        _pending: !!m._pending
      };
    }

    return {
      ui_industry_label: raw,
      industry_code: null,
      business_type_code: "FOOD_ALL",
      hometax_industry_code: null,
      _unknown: true
    };
  }

  const tabInput = $("tabInput");
  const tabResult = $("tabResult");
  const panelInput = $("panelInput");
  const panelResult = $("panelResult");

  function setTab(which) {
    const isInput = which === "input";
    tabInput.classList.toggle("active", isInput);
    tabResult.classList.toggle("active", !isInput);
    panelInput.classList.toggle("hidden", !isInput);
    panelResult.classList.toggle("hidden", isInput);
  }

  tabInput.addEventListener("click", (e) => {
    e.preventDefault();
    setTab("input");
  });
  tabResult.addEventListener("click", (e) => {
    e.preventDefault();
    setTab("result");
  });

  const inpMonth = $("inpMonth");
  const selRegion = $("selRegion");
  const selIndustry = $("selIndustry");
  const inpSales = $("inpSales");
  const inpCostTotal = $("inpCostTotal");
  const inpLabor = $("inpLabor");
  const inpEmployees = $("inpEmployees");
  const selTaxpayerGuess = $("selTaxpayerGuess");

  const inpMaterial = $("inpMaterial");
  const inpRent = $("inpRent");
  const inpOther = $("inpOther");
  const inpPurchaseTaxInvoice = $("inpPurchaseTaxInvoice");
  const inpPurchaseCard = $("inpPurchaseCard");
  const inpPurchaseCashReceipt = $("inpPurchaseCashReceipt");
  const inpPurchaseExemptAgri = $("inpPurchaseExemptAgri");
  const inpPriorYearSales = $("inpPriorYearSales");
  const inpPayrollTotal = $("inpPayrollTotal");
  const inpIndustryCodeManual = $("inpIndustryCodeManual");
  const inpCardSalesAmount = $("inpCardSalesAmount");
  const inpCashReceiptSalesAmount = $("inpCashReceiptSalesAmount");
  const inpVisitCount = $("inpVisitCount");

  const btnMonthToday = $("btnMonthToday");
  const inpMonthDisplay = $("inpMonthDisplay");
  const monthPopover = $("monthPopover");
  const monthPopoverYear = $("monthPopoverYear");
  const monthPopoverGrid = $("monthPopoverGrid");
  const btnMonthPrevYear = $("btnMonthPrevYear");
  const btnMonthNextYear = $("btnMonthNextYear");
  const btnMonthThis = $("btnMonthThis");
  const btnMonthClear = $("btnMonthClear");
  const btnFillExample = $("btnFillExample");
  const btnGoPro = $("btnGoPro");
  const btnRun = $("btnRun");
  const btnHistoryPrevYear = $("btnHistoryPrevYear");
  const btnHistoryNextYear = $("btnHistoryNextYear");
  const btnHistoryThis = $("btnHistoryThis");
  const btnHistoryClear = $("btnHistoryClear");
  const btnLogout = $("btnLogout");
  const precisionWizard = $("precisionWizard");
  const btnClosePro = $("btnClosePro");
  const btnProPrev = $("btnProPrev");
  const btnProNext = $("btnProNext");
  const btnRunPro = $("btnRunPro");
  const wizardQuickSummary = $("wizardQuickSummary");
  const wizardProSummary = $("wizardProSummary");
  const wizardPanels = [1, 2, 3, 4].map((n) => $(`wizardStep${n}`)).filter(Boolean);
  const wizardStepChips = Array.from(document.querySelectorAll("[data-step-chip]"));

  const sumSummary = $("sumSummary");
  const sumSave = $("sumSave");
  const sumScore = $("sumScore");
  const sumGrade = $("sumGrade");
  const sumConfidence = $("sumConfidence");
  const sumInsight = $("sumInsight");
  const tagLine = $("tagLine");
  const btnScoreGuide = $("btnScoreGuide");
  const btnGradeGuide = $("btnGradeGuide");
  const btnConfidenceGuide = $("btnConfidenceGuide");
  const criteriaGuideModal = $("criteriaGuideModal");
  const criteriaGuideTitle = $("criteriaGuideTitle");
  const criteriaGuideDesc = $("criteriaGuideDesc");
  const criteriaGuideMeta = $("criteriaGuideMeta");
  const criteriaGuideContent = $("criteriaGuideContent");
  const btnCloseCriteriaGuide = $("btnCloseCriteriaGuide");

  const prePayload = $("prePayload");
  const errorBox = $("errorBox");
  const errorText = $("errorText");

  const costMismatchBox = $("costMismatchBox");
  const costMismatchText = $("costMismatchText");

  function showError(msg) {
    errorText.textContent = String(msg || "오류가 발생했습니다.");
    errorBox.classList.remove("hidden");
  }
  function clearError() {
    errorBox.classList.add("hidden");
    errorText.textContent = "";
  }
  let monthPickerYear = new Date().getFullYear();

  function formatMonthDisplay(raw) {
    const s = String(raw || "").trim();
    const m = s.match(/^(\d{4})-(\d{2})$/);
    if (!m) return "";
    return `${m[1]}년 ${m[2]}월`;
  }

  function setMonthValue(raw, { save = true } = {}) {
    const value = String(raw || "").trim();
    inpMonth.value = value;
    if (inpMonthDisplay) inpMonthDisplay.value = formatMonthDisplay(value);
    if (save) saveDraft();
    updateWizardSummary();
  }

  function renderMonthPopover() {
    if (!monthPopoverGrid || !monthPopoverYear) return;
    monthPopoverYear.textContent = String(monthPickerYear);
    const selected = String(inpMonth.value || "");
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    monthPopoverGrid.innerHTML = "";
    for (let month = 1; month <= 12; month += 1) {
      const mm = String(month).padStart(2, "0");
      const raw = `${monthPickerYear}-${mm}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "month-popover-month";
      if (raw === selected) btn.classList.add("active");
      if (monthPickerYear === currentYear && month === currentMonth) btn.classList.add("current");
      btn.textContent = `${month}월`;
      btn.addEventListener("click", () => {
        setMonthValue(raw);
        closeMonthPopover();
      });
      monthPopoverGrid.appendChild(btn);
    }
  }

  function openMonthPopover() {
    if (!monthPopover) return;
    const match = String(inpMonth.value || "").match(/^(\d{4})-(\d{2})$/);
    monthPickerYear = match ? Number(match[1]) : new Date().getFullYear();
    renderMonthPopover();
    monthPopover.classList.remove("hidden");
  }

  function closeMonthPopover() {
    monthPopover?.classList.add("hidden");
  }

  function toggleMonthPopover() {
    if (!monthPopover) return;
    if (monthPopover.classList.contains("hidden")) openMonthPopover();
    else closeMonthPopover();
  }

  let precisionStep = 1;
  let precisionOpen = false;

  function keepDigits(value) {
    return String(value || "").replace(/[^\d]/g, "");
  }

  function formatWonLiveInput(el) {
    if (!el) return;
    const raw = keepDigits(el.value);
    if (!raw) {
      el.value = "";
      return;
    }
    const num = Number(raw);
    el.value = Number.isFinite(num) ? num.toLocaleString("ko-KR") : "";
  }

  function updateWizardSummary() {
    if (wizardQuickSummary) {
      const month = safeMonthValue() || "-";
      const region = String(selRegion?.selectedOptions?.[0]?.textContent || "전국").trim() || "전국";
      const industry = String(selIndustry?.selectedOptions?.[0]?.textContent || "업종 미선택").trim();
      const sales = formatWon(getWonInput(inpSales));
      const cost = formatWon(getWonInput(inpCostTotal));
      const labor = formatWon(getWonInput(inpLabor));
      const employees = String(inpEmployees?.value || "0").replace(/[^\d]/g, "") || "0";
      wizardQuickSummary.innerHTML = [
        `월: ${month}`,
        `지역/업종: ${region} · ${industry}`,
        `매출 ${sales || "0"}원 / 비용 ${cost || "0"}원 / 인건비 ${labor || "0"}원`,
        `직원 수: ${employees}명`
      ].join("<br />");
    }

    if (wizardProSummary) {
      const parts = [];
      const material = getWonInput(inpMaterial);
      const rent = getWonInput(inpRent);
      const other = getWonInput(inpOther);
      const taxInvoice = getWonInput(inpPurchaseTaxInvoice);
      const card = getWonInput(inpPurchaseCard);
      const cashReceipt = getWonInput(inpPurchaseCashReceipt);
      const exemptAgri = getWonInput(inpPurchaseExemptAgri);
      const priorYear = getWonInput(inpPriorYearSales);
      const payroll = getWonInput(inpPayrollTotal);
      const manualCode = String(inpIndustryCodeManual?.value || "").trim();

      if (material || rent || other) parts.push(`비용 분해: 재료 ${formatWon(material)} / 임대 ${formatWon(rent)} / 기타 ${formatWon(other)}`);
      if (taxInvoice || card || cashReceipt) parts.push(`매입 증빙: 세금계산서 ${formatWon(taxInvoice)} / 카드 ${formatWon(card)} / 현금영수증 ${formatWon(cashReceipt)}`);
      if (exemptAgri) parts.push(`면세 농산물 매입: ${formatWon(exemptAgri)}원`);
      if (priorYear) parts.push(`직전연도 매출: ${formatWon(priorYear)}원`);
      if (payroll) parts.push(`급여 총액: ${formatWon(payroll)}원`);
      if (manualCode) parts.push(`직접 입력 업종코드: ${manualCode}`);

      wizardProSummary.innerHTML = parts.length ? parts.join("<br />") : "아직 정밀 입력 전";
    }
  }

  function renderPrecisionStep() {
    wizardPanels.forEach((panel, idx) => panel.classList.toggle("active", idx + 1 === precisionStep));
    wizardStepChips.forEach((chip, idx) => {
      chip.classList.toggle("active", idx + 1 === precisionStep);
      chip.classList.toggle("done", idx + 1 < precisionStep);
    });
    if (btnProPrev) btnProPrev.disabled = precisionStep === 1;
    if (btnProNext) btnProNext.classList.toggle("hidden", precisionStep === 4);
    if (btnRunPro) btnRunPro.classList.toggle("hidden", precisionStep !== 4);
    updateWizardSummary();
  }

  function openPrecisionWizard(step = 1) {
    precisionOpen = true;
    precisionStep = Math.max(1, Math.min(4, Number(step) || 1));
    document.body.classList.add("precision-open");
    precisionWizard?.classList.remove("hidden");
    renderPrecisionStep();
  }

  function closePrecisionWizard() {
    precisionOpen = false;
    precisionStep = 1;
    document.body.classList.remove("precision-open");
    precisionWizard?.classList.add("hidden");
    renderPrecisionStep();
  }

  function goPrecisionStep(delta) {
    precisionStep = Math.max(1, Math.min(4, precisionStep + delta));
    renderPrecisionStep();
  }

  function parseWon(v) {
    const s = String(v || "").replace(/[,\s]/g, "").trim();
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }
  function formatWon(n) {
    const x = Number(n || 0);
    if (!Number.isFinite(x)) return "";
    return x.toLocaleString("ko-KR");
  }
  function setWonInput(el, n) {
    if (!el) return;
    el.value = formatWon(n);
  }
  function getWonInput(el) {
    if (!el) return 0;
    return parseWon(el.value);
  }

  function safeMonthValue() {
    const v = String(inpMonth.value || "").trim();
    return v || "";
  }

  function normalizeOptionalNumber(n) {
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function countPositive(...vals) {
    return vals.filter((v) => Number(v || 0) > 0).length;
  }

  function detectMode({
    manual_industry_code,
    material_cost_vat_included,
    rent_cost_vat_included,
    other_cost_vat_included,
    purchase_tax_invoice_vat_included,
    purchase_card_vat_included,
    purchase_cash_receipt_vat_included,
    purchase_exempt_agri_vat_exempt,
    prior_year_sales_vat_included,
    payroll_total_month
  }) {
    const detailedCostCount = countPositive(
      material_cost_vat_included,
      rent_cost_vat_included,
      other_cost_vat_included
    );

    const hasPurchaseEvidence = countPositive(
      purchase_tax_invoice_vat_included,
      purchase_card_vat_included,
      purchase_cash_receipt_vat_included
    ) >= 1;

    const hasPrecisionSignals =
      !!manual_industry_code ||
      detailedCostCount >= 2 ||
      hasPurchaseEvidence ||
      Number(purchase_exempt_agri_vat_exempt || 0) > 0 ||
      Number(prior_year_sales_vat_included || 0) > 0 ||
      Number(payroll_total_month || 0) > 0;

    return hasPrecisionSignals ? "pro" : "quick";
  }

  function getCostDiffInfo() {
    const enteredTotalCost = getWonInput(inpCostTotal);
    const material = getWonInput(inpMaterial);
    const rent = getWonInput(inpRent);
    const other = getWonInput(inpOther);

    const detailedSum = material + rent + other;
    const diff = enteredTotalCost - detailedSum;
    const absDiff = Math.abs(diff);

    return {
      enteredTotalCost,
      detailedSum,
      diff,
      absDiff,
      hasTotal: enteredTotalCost > 0,
      hasDetailed: detailedSum > 0,
      isMismatch: enteredTotalCost > 0 && detailedSum > 0 && absDiff > 500000
    };
  }

  function renderCostMismatchWarning() {
    const info = getCostDiffInfo();

    if (!info.hasTotal || !info.hasDetailed || !info.isMismatch) {
      costMismatchBox.classList.add("hidden");
      costMismatchText.textContent = "";
      return;
    }

    costMismatchBox.classList.remove("hidden");
    costMismatchText.textContent =
      `총비용과 세부비용 합계가 다릅니다. 총비용 ${formatWon(info.enteredTotalCost)}원 / 세부합 ${formatWon(info.detailedSum)}원 / 차이 ${formatWon(info.absDiff)}원`;
  }

  function buildPayload(options = {}) {
    const month = safeMonthValue();
    const region_code = String(selRegion.value || "").trim() || "ALL";
    const industrySel = String(selIndustry.value || "").trim();
    const resolved = resolveIndustrySelection(industrySel);

    const forcedMode = String(options.forceMode || "").trim().toLowerCase();
    const manualIndustryCode = String(inpIndustryCodeManual?.value || "").trim();
    const baseIndustryCode = resolved.industry_code || null;
    const industry_code = manualIndustryCode || baseIndustryCode || null;

    const revenue_vat_included = getWonInput(inpSales);
    const labor_cost = getWonInput(inpLabor);

    const material_cost_vat_included = getWonInput(inpMaterial);
    const rent_cost_vat_included = getWonInput(inpRent);
    const other_cost_vat_included = getWonInput(inpOther);

    const detailedCostSum =
      material_cost_vat_included +
      rent_cost_vat_included +
      other_cost_vat_included;

    const enteredTotalCost = getWonInput(inpCostTotal);
    const cost_vat_included =
      enteredTotalCost > 0 ? enteredTotalCost : detailedCostSum;

    const employees_raw = parseInt(String(inpEmployees.value || "0").replace(/[^\d]/g, ""), 10);
    const employees_count = Number.isFinite(employees_raw) ? Math.max(0, employees_raw) : 0;

    const purchase_tax_invoice_vat_included = getWonInput(inpPurchaseTaxInvoice);
    const purchase_card_vat_included = getWonInput(inpPurchaseCard);
    const purchase_cash_receipt_vat_included = getWonInput(inpPurchaseCashReceipt);
    const purchase_exempt_agri_vat_exempt = getWonInput(inpPurchaseExemptAgri);
    const prior_year_sales_vat_included = getWonInput(inpPriorYearSales);
    const payroll_total_month = getWonInput(inpPayrollTotal);

    const detectedMode = detectMode({
      manual_industry_code: manualIndustryCode,
      material_cost_vat_included,
      rent_cost_vat_included,
      other_cost_vat_included,
      purchase_tax_invoice_vat_included,
      purchase_card_vat_included,
      purchase_cash_receipt_vat_included,
      purchase_exempt_agri_vat_exempt,
      prior_year_sales_vat_included,
      payroll_total_month
    });

    const mode =
      forcedMode === "quick" ? "quick" :
      forcedMode === "pro" ? "pro" :
      detectedMode;

    const includePrecision = mode === "pro";

    return {
      month,
      region_code,

      revenue_vat_included,
      cost_vat_included,
      labor_cost,
      business_type_code: resolved.business_type_code || "FOOD_ALL",

      mode,
      industry_code,
      employees_count: normalizeOptionalNumber(employees_count) ?? 0,
      business_type_detail: resolved.ui_industry_label || null,

      material_cost_vat_included: includePrecision ? normalizeOptionalNumber(material_cost_vat_included) : null,
      rent_cost_vat_included: includePrecision ? normalizeOptionalNumber(rent_cost_vat_included) : null,
      other_cost_vat_included: includePrecision ? normalizeOptionalNumber(other_cost_vat_included) : null,

      purchase_tax_invoice_vat_included: includePrecision ? normalizeOptionalNumber(purchase_tax_invoice_vat_included) : null,
      purchase_card_vat_included: includePrecision ? normalizeOptionalNumber(purchase_card_vat_included) : null,
      purchase_cash_receipt_vat_included: includePrecision ? normalizeOptionalNumber(purchase_cash_receipt_vat_included) : null,
      purchase_exempt_agri_vat_exempt: includePrecision ? normalizeOptionalNumber(purchase_exempt_agri_vat_exempt) : null,

      prior_year_sales_vat_included: includePrecision ? normalizeOptionalNumber(prior_year_sales_vat_included) : null,
      payroll_total_month: includePrecision ? normalizeOptionalNumber(payroll_total_month) : null,

      client: {
        app: "frontend-member",
        version: "2026-03-06-stage6-analysis-upgrade-v1",
        ui_industry_label: resolved.ui_industry_label,
        ui_industry_flags: {
          legacy: !!resolved._legacy,
          temp: !!resolved._temp,
          pending: !!resolved._pending,
          unknown: !!resolved._unknown,
        },
        hometax_industry_code: resolved.hometax_industry_code ?? null,
        entered_total_cost: enteredTotalCost,
        detailed_cost_sum: detailedCostSum,
        auto_mode: mode,
        detected_mode: detectedMode,
      }
    };
  }

  function validatePayload(p) {
    if (!p.month) return "과세기간(월)을 선택해주세요.";
    if (!p.revenue_vat_included || p.revenue_vat_included <= 0) return "월 매출을 입력해주세요.";
    if (!p.business_type_detail) return "업종을 선택해주세요.";
    if (!p.cost_vat_included || p.cost_vat_included <= 0) return "월 비용(총합)을 입력해주세요.";
    return "";
  }

  function saveDraft() {
    const draft = {
      period: inpMonth.value || "",
      region: selRegion.value || "",
      industry: selIndustry.value || "",
      sales: inpSales.value || "",
      cost: inpCostTotal.value || "",
      labor: inpLabor.value || "",
      employees: inpEmployees.value || "",
      taxpayer: selTaxpayerGuess.value || "",

      material: inpMaterial?.value || "",
      rent: inpRent?.value || "",
      other: inpOther?.value || "",
      purchaseTaxInvoice: inpPurchaseTaxInvoice?.value || "",
      purchaseCard: inpPurchaseCard?.value || "",
      purchaseCashReceipt: inpPurchaseCashReceipt?.value || "",
      purchaseExemptAgri: inpPurchaseExemptAgri?.value || "",
      priorYearSales: inpPriorYearSales?.value || "",
      payrollTotal: inpPayrollTotal?.value || "",
      industryCodeManual: inpIndustryCodeManual?.value || "",
      cardSalesAmount: inpCardSalesAmount?.value || "",
      cashReceiptSalesAmount: inpCashReceiptSalesAmount?.value || "",
      visitCount: inpVisitCount?.value || ""
    };
    localStorage.setItem(LS_MEMBER_DRAFT_KEY, JSON.stringify(draft));
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(LS_MEMBER_DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.period) inpMonth.value = d.period;
      if (d.region) selRegion.value = d.region;
      if (d.industry) selIndustry.value = d.industry;
      if (typeof d.sales === "string") inpSales.value = d.sales;
      if (typeof d.cost === "string") inpCostTotal.value = d.cost;
      if (typeof d.labor === "string") inpLabor.value = d.labor;
      if (typeof d.employees === "string") inpEmployees.value = d.employees;
      if (typeof d.taxpayer === "string") selTaxpayerGuess.value = d.taxpayer;

      if (typeof d.material === "string" && inpMaterial) inpMaterial.value = d.material;
      if (typeof d.rent === "string" && inpRent) inpRent.value = d.rent;
      if (typeof d.other === "string" && inpOther) inpOther.value = d.other;
      if (typeof d.purchaseTaxInvoice === "string" && inpPurchaseTaxInvoice) inpPurchaseTaxInvoice.value = d.purchaseTaxInvoice;
      if (typeof d.purchaseCard === "string" && inpPurchaseCard) inpPurchaseCard.value = d.purchaseCard;
      if (typeof d.purchaseCashReceipt === "string" && inpPurchaseCashReceipt) inpPurchaseCashReceipt.value = d.purchaseCashReceipt;
      if (typeof d.purchaseExemptAgri === "string" && inpPurchaseExemptAgri) inpPurchaseExemptAgri.value = d.purchaseExemptAgri;
      if (typeof d.priorYearSales === "string" && inpPriorYearSales) inpPriorYearSales.value = d.priorYearSales;
      if (typeof d.payrollTotal === "string" && inpPayrollTotal) inpPayrollTotal.value = d.payrollTotal;
      if (typeof d.industryCodeManual === "string" && inpIndustryCodeManual) inpIndustryCodeManual.value = d.industryCodeManual;
      if (typeof d.cardSalesAmount === "string" && inpCardSalesAmount) inpCardSalesAmount.value = d.cardSalesAmount;
      if (typeof d.cashReceiptSalesAmount === "string" && inpCashReceiptSalesAmount) inpCashReceiptSalesAmount.value = d.cashReceiptSalesAmount;
      if (typeof d.visitCount === "string" && inpVisitCount) inpVisitCount.value = d.visitCount;
    } catch (_) {}
  }

  [
    inpMonth, selRegion, selIndustry,
    inpSales, inpCostTotal, inpLabor,
    inpEmployees, selTaxpayerGuess,
    inpMaterial, inpRent, inpOther,
    inpPurchaseTaxInvoice, inpPurchaseCard, inpPurchaseCashReceipt,
    inpPurchaseExemptAgri, inpPriorYearSales, inpPayrollTotal, inpIndustryCodeManual,
    inpCardSalesAmount, inpCashReceiptSalesAmount, inpVisitCount
  ].filter(Boolean).forEach((el) => {
    el.addEventListener("input", () => {
      saveDraft();
      renderCostMismatchWarning();
      updateWizardSummary();
    });
    el.addEventListener("change", () => {
      saveDraft();
      renderCostMismatchWarning();
      updateWizardSummary();
    });
  });

  [
    inpSales, inpCostTotal, inpLabor,
    inpMaterial, inpRent, inpOther,
    inpPurchaseTaxInvoice, inpPurchaseCard, inpPurchaseCashReceipt,
    inpPurchaseExemptAgri, inpPriorYearSales, inpPayrollTotal,
    inpCardSalesAmount, inpCashReceiptSalesAmount
  ].filter(Boolean).forEach((el) => {
    el.addEventListener("input", () => {
      formatWonLiveInput(el);
    });
  });

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (!t.matches("button.chip[data-add][data-amt]")) return;

    e.preventDefault();
    const kind = t.getAttribute("data-add");
    const amt = Number(t.getAttribute("data-amt") || "0");
    if (!Number.isFinite(amt) || amt <= 0) return;

    const map = {
      sales: inpSales,
      cost: inpCostTotal,
      labor: inpLabor,
      material: inpMaterial,
      rent: inpRent,
      other: inpOther
    };
    const el = map[kind];
    if (!el) return;

    const current = getWonInput(el);
    setWonInput(el, current + amt);
    saveDraft();
    renderCostMismatchWarning();
  });

  [
    inpSales, inpCostTotal, inpLabor,
    inpMaterial, inpRent, inpOther,
    inpPurchaseTaxInvoice, inpPurchaseCard, inpPurchaseCashReceipt,
    inpPurchaseExemptAgri, inpPriorYearSales, inpPayrollTotal
  ].filter(Boolean).forEach((el) => {
    el.addEventListener("blur", () => {
      setWonInput(el, getWonInput(el));
      renderCostMismatchWarning();
    });
  });

  btnMonthToday?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMonthPopover();
  });

  inpMonthDisplay?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMonthPopover();
  });

  btnMonthPrevYear?.addEventListener("click", () => {
    monthPickerYear -= 1;
    renderMonthPopover();
  });

  btnMonthNextYear?.addEventListener("click", () => {
    monthPickerYear += 1;
    renderMonthPopover();
  });

  btnMonthThis?.addEventListener("click", () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    setMonthValue(`${yyyy}-${mm}`);
    closeMonthPopover();
  });

  btnMonthClear?.addEventListener("click", () => {
    setMonthValue("");
    closeMonthPopover();
  });

  btnFillExample.addEventListener("click", async (e) => {
    e.preventDefault();
    clearError();

    // 샘플 데이터(성수한식당, 2026-08 최신월)와 동일한 값으로 채운다 —
    // 이래야 "TS가 찾은 기회"/AI 진단/이전 기록 추이가 전부 같은 스토리로 이어진다.
    setMonthValue("2026-08");
    selRegion.value = "ALL";
    if (!selIndustry.value) selIndustry.value = "백반/한식";

    setWonInput(inpSales, 70600000);
    setWonInput(inpCostTotal, 42400000);
    setWonInput(inpLabor, 23100000);

    setWonInput(inpMaterial, 28300000);
    setWonInput(inpRent, 9500000);
    setWonInput(inpOther, 4600000);

    setWonInput(inpPurchaseTaxInvoice, 8000000);
    setWonInput(inpPurchaseCard, 5000000);
    setWonInput(inpPurchaseCashReceipt, 2000000);
    setWonInput(inpPurchaseExemptAgri, 11500000);
    setWonInput(inpPriorYearSales, 820000000);
    setWonInput(inpPayrollTotal, 23100000);

    inpEmployees.value = "4";
    selTaxpayerGuess.value = "";
    if (inpIndustryCodeManual) inpIndustryCodeManual.value = "";

    if (inpCardSalesAmount) setWonInput(inpCardSalesAmount, 56900000);
    if (inpCashReceiptSalesAmount) setWonInput(inpCashReceiptSalesAmount, 7320000);
    if (inpVisitCount) inpVisitCount.value = "4950";

    saveDraft();
    renderCostMismatchWarning();

    // 예시값을 다 채웠으니 우리가 보여줄 수 있는 결과(구버전 리포트 + TS가 찾은 기회 +
    // AI 진단 + 액션 시뮬레이터 + 이전 기록 추이)를 전부 정밀 모드로 바로 계산해서 보여준다.
    await runCalc("pro");
    await runV2Sample();
  });

  btnGoPro.addEventListener("click", (e) => {
    e.preventDefault();
    openPrecisionWizard(1);
  });

  btnClosePro?.addEventListener("click", (e) => {
    e.preventDefault();
    closePrecisionWizard();
  });

  btnProPrev?.addEventListener("click", (e) => {
    e.preventDefault();
    goPrecisionStep(-1);
  });

  btnProNext?.addEventListener("click", (e) => {
    e.preventDefault();
    goPrecisionStep(1);
  });

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (monthPopover && !monthPopover.classList.contains("hidden")) {
      if (!(t instanceof HTMLElement) || (!monthPopover.contains(t) && t !== btnMonthToday && t !== inpMonthDisplay)) closeMonthPopover();
    }
    if (criteriaGuideModal && !criteriaGuideModal.classList.contains("hidden")) {
      if (t instanceof HTMLElement && (t.dataset.closeCriteria === "true" || t === criteriaGuideModal)) closeCriteriaGuide();
    }
    if (precisionOpen && t instanceof HTMLElement && t === document.body) closePrecisionWizard();
  });

  btnScoreGuide?.addEventListener("click", (e) => { e.preventDefault(); openCriteriaGuide("score"); });
  btnGradeGuide?.addEventListener("click", (e) => { e.preventDefault(); openCriteriaGuide("grade"); });
  btnConfidenceGuide?.addEventListener("click", (e) => { e.preventDefault(); openCriteriaGuide("confidence"); });
  btnCloseCriteriaGuide?.addEventListener("click", (e) => { e.preventDefault(); closeCriteriaGuide(); });


  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMonthPopover();
      closeCriteriaGuide();
      if (precisionOpen) closePrecisionWizard();
    }
  });

  if (!getToken()) {
    $("guestModeBadge")?.classList.remove("hidden");
    btnLogout.textContent = "로그인";
  }

  btnLogout.addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.removeItem(LS_TOKEN_KEY);
    window.location.href = "./login.html";
  });

  function setTags(tags) {
    tagLine.innerHTML = "";
    if (!tags || !Array.isArray(tags) || tags.length === 0) {
      const s = document.createElement("span");
      s.className = "tag";
      s.textContent = "ready";
      tagLine.appendChild(s);
      return;
    }
    tags.slice(0, 8).forEach((x) => {
      const s = document.createElement("span");
      s.className = "tag";
      s.textContent = String(x);
      tagLine.appendChild(s);
    });
  }

  function closeCriteriaGuide() {
    criteriaGuideModal?.classList.add("hidden");
  }

  function scoreReasonItems(resp) {
    const items = [];
    const analysis = resp?.analysis || {};
    const kpi = resp?.kpi || {};
    const v = getMonthlyValuesFromResponse(resp);
    items.push(`현재 종합 점수는 ${kpi?.score_100 ?? "-"}점입니다.`);
    items.push(`총비용률은 매출 대비 ${(v.totalCostRatio * 100).toFixed(1)}%입니다.`);
    items.push(`월 추정 이익률은 ${(v.profitRatio * 100).toFixed(1)}%입니다.`);
    const drivers = Array.isArray(analysis?.risk?.drivers) ? analysis.risk.drivers.slice(0, 3) : [];
    drivers.forEach((driver) => {
      const txt = [driver?.title, driver?.reason].filter(Boolean).join(" · ");
      if (txt) items.push(txt);
    });
    if (items.length <= 3) items.push("점수는 입력값, 비용 구조, 수익성, 벤치마크 차이와 리스크 신호를 종합해 계산됩니다.");
    return items;
  }

  function openCriteriaGuide(kind) {
    if (!criteriaGuideModal || !criteriaGuideContent) return;
    const resp = lastResponse || {};
    const kpi = resp?.kpi || {};
    const confVal = Number(resp?.meta?.confidence);
    const confPct = Number.isFinite(confVal) ? Math.round(confVal * 100) : null;

    if (kind === "score") {
      criteriaGuideTitle.textContent = "점수 해석 가이드";
      criteriaGuideDesc.textContent = "현재 점수가 왜 나왔는지와 점수 구간을 함께 보여줍니다.";
      criteriaGuideMeta.textContent = `현재 점수: ${kpi?.score_100 ?? "-"}점`;
      const reasons = scoreReasonItems(resp);
      criteriaGuideContent.innerHTML = `
        <div class="criteria-guide-card">
          <h4>현재 점수 설명</h4>
          <ul class="criteria-list">${reasons.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
        </div>
        <div class="criteria-guide-card">
          <h4>점수 해석 가이드</h4>
          <table class="criteria-table">
            <thead><tr><th>구간</th><th>해석</th></tr></thead>
            <tbody>
              <tr><td>80점 이상</td><td>구조가 비교적 안정적입니다.</td></tr>
              <tr><td>60~79점</td><td>핵심 항목은 유지되지만 일부 점검이 필요합니다.</td></tr>
              <tr><td>60점 미만</td><td>비용 구조·수익성·증빙 입력을 우선 점검해보는 것이 좋습니다.</td></tr>
            </tbody>
          </table>
        </div>`;
    } else if (kind === "grade") {
      criteriaGuideTitle.textContent = "등급 해석표";
      criteriaGuideDesc.textContent = "현재 등급이 어떤 의미인지 바로 확인할 수 있습니다.";
      criteriaGuideMeta.textContent = `현재 등급: ${kpi?.grade ?? "-"}`;
      criteriaGuideContent.innerHTML = `
        <div class="criteria-guide-card">
          <h4>등급 기준표</h4>
          <table class="criteria-table">
            <thead><tr><th>등급</th><th>의미</th></tr></thead>
            <tbody>
              <tr><td>A</td><td>상대적으로 양호한 상태</td></tr>
              <tr><td>B</td><td>주의 관찰 구간</td></tr>
              <tr><td>C</td><td>구조 점검 필요</td></tr>
              <tr><td>D</td><td>즉시 점검 필요</td></tr>
              <tr><td>E</td><td>리스크가 큰 상태</td></tr>
            </tbody>
          </table>
        </div>
        <div class="criteria-guide-card"><h4>현재 등급 설명</h4><p>${escapeHtml(kpi?.grade ? `${kpi.grade} 등급은 ${gradeTone(kpi.grade)} 흐름으로 읽으면 됩니다.` : "계산 후 등급이 표시됩니다.")}</p></div>`;
    } else {
      criteriaGuideTitle.textContent = "신뢰도 구간표";
      criteriaGuideDesc.textContent = "입력값과 fallback 여부를 바탕으로 결과 신뢰도를 안내합니다.";
      criteriaGuideMeta.textContent = `현재 신뢰도: ${confPct != null ? `${confPct}%` : "-"}`;
      criteriaGuideContent.innerHTML = `
        <div class="criteria-guide-card">
          <h4>신뢰도 구간</h4>
          <table class="criteria-table">
            <thead><tr><th>구간</th><th>표시</th><th>해석</th></tr></thead>
            <tbody>
              <tr><td>85% 이상</td><td>신뢰도 높음</td><td>핵심 입력이 비교적 충분한 상태</td></tr>
              <tr><td>65~84%</td><td>신뢰도 보통</td><td>주요 계산은 가능하지만 일부 입력 보강이 도움이 됨</td></tr>
              <tr><td>65% 미만</td><td>신뢰도 제한</td><td>정밀 입력 부족 또는 fallback 영향이 큼</td></tr>
            </tbody>
          </table>
        </div>
        <div class="criteria-guide-card"><h4>현재 신뢰도 설명</h4><p>${escapeHtml(confPct != null ? confidenceText(confVal) : "계산 후 신뢰도가 표시됩니다.")}</p></div>`;
    }

    criteriaGuideModal.classList.remove("hidden");
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function ratioToPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return `${(n * 100).toFixed(1)}%`;
  }

  function ppText(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(1)}%p`;
  }

  function metricLabel(metric) {
    const map = {
      COST_RATIO: "총비용률",
      LABOR_RATIO: "인건비율",
      MATERIAL_RATIO: "재료비율",
      RENT_RATIO: "임대료율",
      OTHER_RATIO: "기타비용률",
      PROFIT_RATIO: "영업이익률",
      AVG_REVENUE_ANNUAL: "연환산 매출",
      SALES_GROWTH_YOY: "매출 성장률",
      AVG_TICKET_DINEIN: "객단가(홀)",
      AVG_TICKET_DELIVERY: "객단가(배달)",
      MARGIN_RATIO: "매출총이익률",
      TAX_BURDEN_RATIO: "세부담률"
    };
    return map[metric] || metric;
  }

  function ensureDynamicUi() {
    if (!panelResult) return;

    if (!$("tsDashShell")) {
      const shell = document.createElement("div");
      shell.id = "tsDashShell";
      shell.className = "ts-dash-shell";
      shell.innerHTML = `
        <div class="ts-dash-main" id="tsDashMain">
          <nav class="ts-dash-nav">
            <a class="ts-dash-nav-item active" href="#" data-dash-nav="home"><svg viewBox="0 0 24 24" fill="none"><path d="M4 11.5L12 4l8 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>결과 분석</a>
            <a class="ts-dash-nav-item" href="#" data-dash-nav="ledger"><svg viewBox="0 0 24 24" fill="none"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18a1 1 0 0 1 1 1v15.5a1 1 0 0 1-1 1H6.5A1.5 1.5 0 0 1 5 19V4.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M5 17.5A1.5 1.5 0 0 1 6.5 16H19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>장부 관리</a>
            <a class="ts-dash-nav-item" href="#" data-dash-nav="tax"><svg viewBox="0 0 24 24" fill="none"><path d="M6 3h9l3 3v15H6z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 12h6M9 16h6M9 8h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>세금 신고</a>
            <a class="ts-dash-nav-item" href="#" data-dash-nav="save"><svg viewBox="0 0 24 24" fill="none"><path d="M9 18h6M10 21h4M8 14.5A5 5 0 1 1 16 14.5c-.6.9-1.4 1.6-1.6 2.5H9.6c-.2-.9-1-1.6-1.6-2.5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>절세 도우미</a>
            <a class="ts-dash-nav-item" href="#" data-dash-nav="report"><svg viewBox="0 0 24 24" fill="none"><path d="M3 17l6-6 4 4 8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7h6v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>경영 리포트</a>
          </nav>

          <div id="dashHomeView">
            <div class="ts-dash-header">
              <div><h2 id="dashHomeGreeting">사장님, 이번 달도 수고 많으셨어요!</h2></div>
              <div id="dashHomeDate" class="ts-dash-date-badge">-</div>
            </div>

            <div id="dashHomeSummaryRow" class="ts-home-kpi-grid"></div>

            <div id="dashAlertSettings" class="ts-alert-settings"></div>

            <div id="dashHomeAlert" class="ts-home-alert hidden">
              <div class="ts-home-alert-ic"><img src="./icon-dash-alert.png" alt="" /></div>
              <div>
                <div class="ts-home-alert-title" id="dashHomeAlertTitle">-</div>
                <div class="ts-home-alert-detail" id="dashHomeAlertDetail">-</div>
                <div class="ts-home-alert-actions">
                  <button class="ts-home-alert-btn solid" type="button" id="dashHomeAlertBtn">상세 분석 보기 →</button>
                </div>
              </div>
            </div>

            <div class="report-card">
              <h3>🎯 이번 달 목표</h3>
              <div id="dashGoalBody"></div>
            </div>

            <div class="report-card">
              <h3>💡 TS가 찾은 기회</h3>
              <div id="dashOppTeaser"></div>
            </div>

            <div class="report-card">
              <h3>바꾸면 얼마나 달라질까요?</h3>
              <div id="dashSimTeaser"></div>
            </div>

            <div class="report-card">
              <h3>이번 주 할 일</h3>
              <div id="dashTodoTop" class="ts-tax-ba-note" style="margin-bottom:10px;"></div>
              <div id="dashTodoList"></div>
            </div>

            <div class="report-card">
              <h3>예상 세금</h3>
              <div id="dashTaxSummary"></div>
              <button class="ts-ledger-side-link" type="button" id="dashBtnGoTax" style="margin-top:12px;">세금 신고에서 자세히 보기 →</button>
            </div>

            <div class="report-card">
              <h3>데이터 완성도</h3>
              <div id="dashCompletenessBody"></div>
            </div>
          </div>

          <div id="dashLedgerView" class="hidden">
            <div class="ts-dash-header">
              <div><h2>장부 관리</h2></div>
            </div>

            <div class="ts-ledger-summary" id="ledgerSummaryLine"></div>

            <div class="ts-ledger-quick-row">
              <button class="ts-ledger-quick-btn primary" type="button" id="ledgerBtnAdd">+ 거래 직접 등록</button>
              <button class="ts-ledger-quick-btn" type="button" id="ledgerBtnExcel">엑셀 업로드</button>
              <button class="ts-ledger-quick-btn" type="button" id="ledgerBtnReceipt">영수증 추가</button>
              <button class="ts-ledger-quick-btn" type="button" id="ledgerBtnUnclassified">미분류 거래 확인</button>
            </div>

            <div class="ts-ledger-ai-banner">
              <div class="ts-ledger-ai-ic"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3.2v5.3c0 4.6-3 8.8-7 10-4-1.2-7-5.4-7-10V6.2L12 3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></div>
              <div style="flex:1;">
                <div class="ts-ledger-ai-title">TS가 장부를 자동으로 정리했어요</div>
                <div class="ts-ledger-ai-detail" id="ledgerAiDetail">-</div>
              </div>
            </div>

            <div class="ts-ledger-filter-row">
              <div class="ts-ledger-tabs" id="ledgerTypeTabs">
                <button class="ts-ledger-tab active" data-type="all" type="button">전체</button>
                <button class="ts-ledger-tab" data-type="income" type="button">수입</button>
                <button class="ts-ledger-tab" data-type="expense" type="button">지출</button>
              </div>
              <select class="ts-ledger-select" id="ledgerCategoryFilter">
                <option value="all">전체 카테고리</option>
                <option value="재료비">재료비</option>
                <option value="인건비">인건비</option>
                <option value="임차료">임차료</option>
                <option value="공과금">공과금</option>
                <option value="광고비">광고비</option>
                <option value="배달매출">배달매출</option>
                <option value="기타">기타</option>
              </select>
              <select class="ts-ledger-select" id="ledgerEvidenceFilter">
                <option value="all">증빙 전체</option>
                <option value="has">증빙 있음</option>
                <option value="none">증빙 없음</option>
              </select>
              <select class="ts-ledger-select" id="ledgerStatusFilter">
                <option value="all">상태 전체</option>
                <option value="done">자동분류</option>
                <option value="review">확인 필요</option>
              </select>
              <input type="text" class="ts-ledger-search" id="ledgerSearchInput" placeholder="거래처 또는 거래내용 검색" />
            </div>

            <div class="ts-ledger-main">
              <div class="ts-ledger-table-wrap">
                <table class="ts-ledger-table">
                  <thead>
                    <tr><th>날짜</th><th>거래처</th><th>내용</th><th>금액</th><th>구분</th><th>카테고리</th><th>증빙</th><th>상태</th></tr>
                  </thead>
                  <tbody id="ledgerTableBody"></tbody>
                </table>
                <div id="ledgerEmptyNote" class="empty-note hidden" style="padding:20px; text-align:center;">조건에 맞는 거래가 없습니다.</div>
              </div>

              <div class="ts-ledger-side" id="ledgerSidePanel"></div>
            </div>
          </div>

          <div id="dashTaxView" class="hidden">
            <div class="ts-dash-header">
              <div><h2>세금 신고</h2></div>
              <button class="ts-ledger-quick-btn primary" type="button" id="taxBtnPdf">홈택스 참고서식 PDF</button>
            </div>

            <div class="ts-ledger-summary" id="taxSummaryLine"></div>

            <div class="report-card ts-tax-cta" id="taxCtaCard"></div>

            <div class="ts-dash-two-col">
              <div class="report-card">
                <h3>신고 준비 체크리스트</h3>
                <div id="taxChecklist"></div>
              </div>
              <div class="report-card">
                <h3>TS가 찾은 절세 공제</h3>
                <div id="taxOppBox"></div>
              </div>
            </div>

            <div class="report-card">
              <h3>신고 전 확인이 필요해요</h3>
              <div id="taxReviewList"></div>
            </div>

            <div class="report-card">
              <h3>간이과세자 ↔ 일반과세자 비교</h3>
              <div id="taxTypeSimBox"></div>
            </div>

            <div class="ts-dash-two-col">
              <div class="report-card">
                <h3>신고 자료 준비</h3>
                <div id="taxDocsList"></div>
              </div>
              <div class="report-card">
                <h3>신고 일정</h3>
                <div id="taxScheduleList"></div>
              </div>
            </div>

            <div class="report-card">
              <h3>신고 이력</h3>
              <table class="ts-home-hist-table">
                <thead><tr><th>신고 유형</th><th>기간</th><th>상태</th></tr></thead>
                <tbody id="taxHistoryBody"></tbody>
              </table>
            </div>
          </div>

          <div id="dashSaveView" class="hidden">
            <div class="ts-dash-header">
              <div><h2>절세 도우미</h2></div>
            </div>

            <div class="report-card ts-save-hero" id="saveHeroCard"></div>

            <div class="report-card">
              <h3>TS가 찾은 절세 기회</h3>
              <div id="saveOppList"></div>
            </div>

            <div class="report-card hidden" id="saveThresholdCard">
              <h3>가장 큰 절세 기회 판단</h3>
              <div id="saveThresholdBox"></div>
            </div>

            <div class="report-card">
              <h3>절세 시뮬레이션</h3>
              <div id="saveSimBox"></div>
            </div>

            <div class="report-card">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
                <h3 style="margin:0;">놓친 증빙 찾기</h3>
                <button class="ts-card-link" type="button" id="saveEvidenceReminderBtn">🔔 알림 받기</button>
              </div>
              <div id="saveEvidenceList"></div>
            </div>

            <div class="report-card">
              <h3>이번 달 절세 체크리스트</h3>
              <div id="saveChecklist"></div>
            </div>

            <div class="report-card">
              <h3>절세 이력</h3>
              <div id="saveHistorySummary" style="font-size:12.5px; font-weight:800; color:var(--muted); margin-bottom:8px;"></div>
              <table class="ts-home-hist-table">
                <thead><tr><th>기간</th><th>절세 항목</th><th>절감액</th></tr></thead>
                <tbody id="saveHistoryBody"></tbody>
              </table>
            </div>
          </div>

          <div id="dashReportView" class="hidden">
            <div class="ts-dash-header">
              <div><h2>경영 리포트</h2><p>이번 달 우리 가게의 성적과 다음 달 개선 포인트를 한눈에 확인하세요.</p></div>
              <div style="display:flex; align-items:center; gap:8px;">
                <div id="reportDateBadge" class="ts-dash-date-badge">-</div>
                <button class="ts-ledger-quick-btn" type="button" id="reportBtnCsv">CSV 다운로드</button>
                <button class="ts-ledger-quick-btn primary" type="button" id="reportBtnPdf">PDF 저장</button>
              </div>
            </div>

            <div class="report-card ts-report-headline" id="reportHeadlineCard"></div>

            <div class="report-card">
              <h3>전월 대비 변화</h3>
              <div id="reportChangeList"></div>
              <div id="reportChangeNote" class="ts-tax-ba-note"></div>
            </div>

            <div class="report-card">
              <h3>이번 달 돈의 흐름</h3>
              <div id="reportFlowBox"></div>
            </div>

            <div class="report-card">
              <h3>업종 Benchmark</h3>
              <div id="reportBenchTable"></div>
            </div>

            <div class="report-card">
              <h3>개선 시뮬레이션</h3>
              <div id="reportSimBox"></div>
            </div>

            <div class="report-card">
              <h3>다음 달 목표</h3>
              <div id="reportGoalList"></div>
            </div>

            <div class="report-card">
              <h3>최근 추이</h3>
              <div class="ts-ledger-tabs" id="reportTrendTabs">
                <button class="ts-ledger-tab active" data-metric="sales" type="button">매출</button>
                <button class="ts-ledger-tab" data-metric="cost" type="button">비용</button>
                <button class="ts-ledger-tab" data-metric="profit" type="button">영업이익</button>
                <button class="ts-ledger-tab" data-metric="profit_ratio" type="button">이익률</button>
              </div>
              <div style="height:220px; position:relative; margin-top:12px;"><canvas id="reportTrendCanvas"></canvas></div>
              <div id="reportTrendEmpty" class="empty-note hidden" style="padding:20px; text-align:center;">추이를 보려면 2개월 이상의 데이터가 필요합니다.</div>
              <div id="reportTrendNote" class="ts-tax-ba-note"></div>
            </div>
          </div>
        </div>
      `;
      panelResult.appendChild(shell);

      const main = $("tsDashMain");
      const homeView = $("dashHomeView");

      const ledgerView = $("dashLedgerView");
      const taxView = $("dashTaxView");
      const saveView = $("dashSaveView");
      const reportView = $("dashReportView");

      function setDashNav(which) {
        main.querySelectorAll("[data-dash-nav]").forEach((el) => {
          if (el.tagName === "A") el.classList.toggle("active", el.getAttribute("data-dash-nav") === which);
        });
        homeView.classList.toggle("hidden", which !== "home");
        ledgerView.classList.toggle("hidden", which !== "ledger");
        taxView.classList.toggle("hidden", which !== "tax");
        saveView.classList.toggle("hidden", which !== "save");
        reportView.classList.toggle("hidden", which !== "report");
        if (which === "ledger") renderDashLedger();
        if (which === "tax") renderDashTaxFiling();
        if (which === "save") renderDashSaveHelper();
        if (which === "report") renderDashReport();
      }

      main.querySelectorAll("[data-dash-nav]").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          setDashNav(el.getAttribute("data-dash-nav"));
        });
      });

      $("reportBtnPdf")?.addEventListener("click", () => exportPdfReport());
      $("taxBtnPdf")?.addEventListener("click", () => exportTaxFilingPdf());
      $("saveEvidenceReminderBtn")?.addEventListener("click", () => toggleEvidenceReminder());
      $("reportBtnCsv")?.addEventListener("click", () => exportReportCsv());
      $("reportTrendTabs")?.querySelectorAll("[data-metric]").forEach((btn) => {
        btn.addEventListener("click", () => {
          $("reportTrendTabs").querySelectorAll("[data-metric]").forEach((b) => b.classList.toggle("active", b === btn));
          renderReportTrendChart(btn.getAttribute("data-metric"));
        });
      });

      $("dashHomeAlertBtn")?.addEventListener("click", () => goDashNav("report"));
      $("dashBtnGoTax")?.addEventListener("click", () => goDashNav("tax"));
    }
  }

  function safeNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function getMonthlyValuesFromResponse(resp) {
    const result = resp?.result || {};
    const annual = result?.annualized || {};
    const derived = result?.derived || {};

    const revenue = safeNumber(annual?.revenue_vat_included) / 12;
    const cost = safeNumber(annual?.cost_vat_included) / 12;
    const labor = safeNumber(annual?.labor_cost) / 12;

    let profit = safeNumber(derived?.monthly_profit_estimate, NaN);
    if (!Number.isFinite(profit)) {
      profit = revenue - cost - labor;
    }

    const costRatio = revenue > 0 ? cost / revenue : 0;
    const laborRatio = revenue > 0 ? labor / revenue : 0;
    const totalCostRatio = revenue > 0 ? (cost + labor) / revenue : 0;
    const profitRatio = revenue > 0 ? profit / revenue : 0;

    return {
      revenue,
      cost,
      labor,
      profit,
      costRatio,
      laborRatio,
      totalCostRatio,
      profitRatio
    };
  }

  function confidenceText(conf) {
    const n = Number(conf);
    if (!Number.isFinite(n)) return "신뢰도 정보 없음";
    if (n >= 0.85) return "신뢰도 높음";
    if (n >= 0.65) return "신뢰도 보통";
    return "신뢰도 제한";
  }

  function gradeTone(grade) {
    const g = String(grade || "").toUpperCase();
    if (g === "A") return "상대적으로 양호";
    if (g === "B") return "주의 관찰 구간";
    if (g === "C") return "구조 점검 필요";
    if (g === "D" || g === "E") return "즉시 점검 필요";
    return "평가 정보 제한";
  }

  function analyzeBenchmarkHighlights(analysis) {
    const items = Array.isArray(analysis?.benchmarks?.items) ? analysis.benchmarks.items : [];
    const ratioItems = items.filter((x) => Number.isFinite(Number(x?.diff_pp)));

    const riskItems = ratioItems
      .filter((x) => String(x?.level || "").toUpperCase() === "RISK")
      .sort((a, b) => Math.abs(Number(b?.diff_pp || 0)) - Math.abs(Number(a?.diff_pp || 0)));

    const goodItems = ratioItems
      .filter((x) => String(x?.level || "").toUpperCase() === "GOOD")
      .sort((a, b) => Math.abs(Number(b?.diff_pp || 0)) - Math.abs(Number(a?.diff_pp || 0)));

    return {
      worst: riskItems[0] || null,
      best: goodItems[0] || null,
      riskCount: riskItems.length,
      totalCount: ratioItems.length
    };
  }

  function getActionCheckState() {
    try {
      return JSON.parse(localStorage.getItem(LS_ACTION_CHECK_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function setActionCheckState(state) {
    localStorage.setItem(LS_ACTION_CHECK_KEY, JSON.stringify(state));
  }

  function actionKey(a) {
    return `${a?.priority || "P?"}__${a?.title || "ACTION"}`;
  }

  function bindActionCheckboxes() {
    const boxes = document.querySelectorAll("[data-action-key]");
    const state = getActionCheckState();

    boxes.forEach((el) => {
      el.addEventListener("change", () => {
        const key = el.getAttribute("data-action-key");
        state[key] = !!el.checked;
        setActionCheckState(state);
        updateActionProgress();
      });
    });

    updateActionProgress();
  }

  function updateActionProgress() {
    const progress = $("actionProgressBox");
    if (!progress) return;
    const all = [...document.querySelectorAll("[data-action-key]")];
    if (all.length === 0) {
      progress.textContent = "체크 가능한 액션이 없습니다.";
      return;
    }
    const done = all.filter((x) => x.checked).length;
    progress.textContent = `실행 체크리스트 진행률: ${done}/${all.length}`;
  }

  function buildPdfHtml(resp, v2Data) {
    const analysis = resp?.analysis || {};
    const meta = resp?.meta || {};
    const assumptions = Array.isArray(meta?.assumptions) ? meta.assumptions : [];
    const failures = Array.isArray(meta?.partial_failures) ? meta.partial_failures : [];
    const bench = Array.isArray(analysis?.benchmarks?.items) ? analysis.benchmarks.items : [];
    const tax = analysis?.tax_brief || {};
    const v = getMonthlyValuesFromResponse(resp);
    const kpi = resp?.kpi || {};
    const worst = analyzeBenchmarkHighlights(analysis).worst;

    const opportunities = Array.isArray(v2Data?.opportunities) ? v2Data.opportunities : [];
    const scenarioOptions = Array.isArray(v2Data?.scenarios?.options) ? v2Data.scenarios.options : [];
    const scenarioReco = v2Data?.scenarios?.recommendation_text || "";
    const monthly = Array.isArray(v2Data?.monthly) ? v2Data.monthly : [];
    const latestMonth = monthly.length ? monthly[monthly.length - 1] : null;

    const levelColor = (level) => {
      const lv = String(level || "").toUpperCase();
      if (lv === "GOOD") return "#16a34a";
      if (lv === "WARN") return "#b45309";
      if (lv === "RISK") return "#dc2626";
      return "#64748b";
    };
    const levelBadge = (level) => {
      const lv = String(level || "UNKNOWN").toUpperCase();
      const c = levelColor(lv);
      return `<span class="badge" style="color:${c}; border-color:${c};">${escapeHtml(lv)}</span>`;
    };

    const todayStr = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });

    const riskBannerHtml = worst
      ? `<div class="risk-callout">⚠️ 가장 시급한 문제: <strong>${escapeHtml(metricLabel(worst.metric))} ${escapeHtml(ratioToPercent(worst.my_value))}</strong> · 중앙값 대비 ${escapeHtml(ppText(worst.diff_pp))} · 우선 점검이 필요합니다.</div>`
      : "";

    const assumptionHtml = assumptions.length
      ? `<ul>${assumptions.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
      : `<p class="muted">없음</p>`;

    const failureHtml = failures.length
      ? failures.map((f) => `
          <div class="box">
            <strong>${escapeHtml(f?.code || "PARTIAL_FAILURE")}</strong>
            <div>${escapeHtml(f?.message || "-")}</div>
            ${f?.detail ? `<div class="muted">${escapeHtml(f.detail)}</div>` : ""}
          </div>
        `).join("")
      : `<p class="muted">없음</p>`;

    const flowHtml = latestMonth
      ? `
        <div class="box"><strong>매출</strong><div class="kpi-value">${formatWon(latestMonth.sales || 0)}원</div></div>
        <div class="box"><strong>재료비</strong><div class="kpi-value">${formatWon(latestMonth.material_cost || 0)}원</div></div>
        <div class="box"><strong>인건비</strong><div class="kpi-value">${formatWon(latestMonth.labor_cost || 0)}원</div></div>
        <div class="box"><strong>임차료</strong><div class="kpi-value">${formatWon(latestMonth.rent || 0)}원</div></div>
        <div class="box"><strong>기타비용</strong><div class="kpi-value">${formatWon(latestMonth.other_cost || 0)}원</div></div>
        <div class="box"><strong>영업이익</strong><div class="kpi-value">${formatWon(latestMonth.profit || 0)}원</div></div>
      `
      : `
        <div class="box"><strong>매출</strong><div class="kpi-value">${formatWon(v.revenue)}원</div></div>
        <div class="box"><strong>비용+인건비</strong><div class="kpi-value">${formatWon(v.cost + v.labor)}원</div></div>
        <div class="box"><strong>영업이익</strong><div class="kpi-value">${formatWon(v.profit)}원</div></div>
      `;

    const benchRows = bench.length
      ? bench.map((b) => `
          <tr>
            <td>${escapeHtml(metricLabel(b?.metric))}</td>
            <td>${escapeHtml(ratioToPercent(b?.my_value))}</td>
            <td>${escapeHtml(ratioToPercent(b?.p50))}</td>
            <td>${escapeHtml(ratioToPercent(b?.p75))}</td>
            <td>${escapeHtml(ratioToPercent(b?.p25))}</td>
            <td>${escapeHtml(ppText(b?.diff_pp))}</td>
            <td>${levelBadge(b?.level)}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="7">없음</td></tr>`;

    const oppHtml = opportunities.length
      ? opportunities.map((o) => {
          const amount = o?.category === "경영 임계점" ? o?.breakeven_sales : o?.expected_credit;
          const amountLabel = o?.category === "경영 임계점" ? "손익분기점" : (o?.expected_credit_label || "예상 공제액");
          return `
          <div class="box">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <strong>${escapeHtml(o?.title || "절세 기회")}</strong>
              <span class="badge" style="color:#2563eb; border-color:#2563eb;">${escapeHtml(o?.applicability || "-")}</span>
            </div>
            <div class="kpi-value">${amountLabel} ${fmtWonFull(amount)}</div>
            <div class="muted">${escapeHtml(o?.why || "-")}</div>
          </div>`;
        }).join("")
      : "<p class=\"muted\">현재 발견된 절세 기회가 없습니다.</p>";

    const scenarioHtml = scenarioOptions.length
      ? scenarioOptions.map((opt) => `
          <div class="box">
            <strong>${escapeHtml(opt?.label || "시나리오")}</strong>
            <div class="kpi-value">+${fmtWonFull(opt?.profit_delta)}</div>
          </div>
        `).join("") + (scenarioReco ? `<p class="muted">🎯 ${escapeHtml(scenarioReco)}</p>` : "")
      : "<p class=\"muted\">시뮬레이션에 필요한 데이터가 부족합니다.</p>";

    return `
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>TS 리포트</title>
<style>
  :root{ --navy:#182459; --navy2:#0E1638; --line:#e2e5ea; }
  *{ box-sizing:border-box; }
  body{
    font-family: "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", Arial, sans-serif;
    color:#0b1220;
    margin:0;
    padding:36px;
    line-height:1.55;
  }
  .pdf-header{
    display:flex; align-items:center; justify-content:space-between;
    border-bottom:2px solid var(--navy);
    padding-bottom:14px; margin-bottom:18px;
  }
  .pdf-brand{ display:flex; align-items:center; gap:10px; }
  .pdf-logo{ width:34px; height:34px; border-radius:10px; background:linear-gradient(135deg,var(--navy),var(--navy2)); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:14px; }
  .pdf-brand-text{ font-size:18px; font-weight:900; letter-spacing:-.3px; }
  .pdf-meta{ text-align:right; font-size:12px; color:#64748b; }
  h1{font-size:22px; margin:0 0 4px; letter-spacing:-.4px;}
  h2{font-size:15px; margin:26px 0 10px; padding-bottom:6px; border-bottom:1px solid var(--line); color:var(--navy);}
  .sub{color:#6b7280; font-size:13px; margin-bottom:6px;}
  .risk-callout{
    background:#fef2f2; border:1px solid #fca5a5; color:#991b1b;
    border-radius:12px; padding:12px 14px; font-size:13px; font-weight:700; margin:14px 0;
  }
  .grid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .box{
    border:1px solid var(--line);
    border-radius:10px;
    padding:12px;
    margin-bottom:8px;
    background:#fafbfc;
  }
  .kpi-value{ font-size:18px; font-weight:900; margin:4px 0; }
  .muted{color:#6b7280; font-size:12px; margin-top:4px;}
  .badge{ font-size:10.5px; font-weight:800; border:1px solid; border-radius:999px; padding:2px 8px; }
  table{ width:100%; border-collapse:collapse; font-size:11.5px; }
  th, td{ border:1px solid var(--line); padding:7px 8px; text-align:left; }
  th{background:#f3f4f6; font-weight:800; color:#374151;}
  ul{margin:6px 0 0; padding-left:18px;}
  li{margin-bottom:6px;}
  .pdf-footer{ margin-top:30px; padding-top:12px; border-top:1px solid var(--line); font-size:10.5px; color:#94a3b8; }
  @media print{
    body{padding:18px;}
    .page-break{page-break-before:always;}
  }
</style>
</head>
<body>
  <div class="pdf-header">
    <div class="pdf-brand">
      <div class="pdf-logo">TS</div>
      <div class="pdf-brand-text">TS (tax secretary)</div>
    </div>
    <div class="pdf-meta">생성일: ${escapeHtml(todayStr)}</div>
  </div>

  <h1>세무·경영 진단 리포트</h1>
  <div class="sub">
    대상월: ${escapeHtml(resp?.result?.month || "-")} · 업종: ${escapeHtml(resp?.result?.business_type?.label || "-")} · 지역: ${escapeHtml(resp?.result?.region?.label || "-")}
    · 종합점수 ${escapeHtml(kpi?.score_100 ?? "-")}점 (${escapeHtml(kpi?.grade || "-")}등급)
  </div>

  ${riskBannerHtml}

  <h2>종합 요약</h2>
  <div class="grid">
    <div class="box"><strong>월 매출</strong><div class="kpi-value">${formatWon(v.revenue)}원</div></div>
    <div class="box"><strong>월 추정 이익</strong><div class="kpi-value">${formatWon(v.profit)}원</div></div>
    <div class="box"><strong>총비용률</strong><div class="kpi-value">${ratioToPercent(v.totalCostRatio)}</div></div>
    <div class="box"><strong>이익률</strong><div class="kpi-value">${ratioToPercent(v.profitRatio)}</div></div>
  </div>

  <h2>이번 달 돈의 흐름</h2>
  <div class="grid">${flowHtml}</div>

  <h2>세금 신고 요약</h2>
  <div class="grid">
    <div class="box"><strong>월 부가세 추정</strong><div class="kpi-value">${formatWon(tax?.vat?.due_month || 0)}원</div></div>
    <div class="box"><strong>연 부가세/납부 추정</strong><div class="kpi-value">${formatWon(tax?.vat?.due_year || 0)}원</div></div>
    <div class="box"><strong>연 소득세+지방세 추정</strong><div class="kpi-value">${formatWon(tax?.income_tax?.due_year || 0)}원</div></div>
    <div class="box"><strong>연 4대보험 사업주부담 추정</strong><div class="kpi-value">${formatWon(tax?.insurance?.employer_year || 0)}원</div></div>
  </div>

  <div class="page-break"></div>

  <h2>TS가 찾은 절세 기회</h2>
  ${oppHtml}

  <h2>개선 시뮬레이션</h2>
  ${scenarioHtml}

  <h2>업종 Benchmark</h2>
  <table>
    <thead>
      <tr>
        <th>지표</th>
        <th>내 값</th>
        <th>중간값</th>
        <th>상위 25%</th>
        <th>하위 25%</th>
        <th>차이(%p)</th>
        <th>레벨</th>
      </tr>
    </thead>
    <tbody>${benchRows}</tbody>
  </table>

  <h2>가정 / 제한사항</h2>
  ${assumptionHtml}
  ${failureHtml}

  <div class="pdf-footer">
    본 리포트는 입력값 기준(가정) 추정 결과이며, 확정 세액은 실제 신고·상담을 통해 확인이 필요합니다. © TS (tax secretary)
  </div>
</body>
</html>
    `;
  }

  function exportPdfReport() {
    if (!lastResponse) {
      showError("먼저 계산을 실행해주세요.");
      return;
    }

    const html = buildPdfHtml(lastResponse, lastV2Data);
    const win = window.open("", "_blank", "width=1100,height=900");
    if (!win) {
      showError("팝업이 차단되어 PDF 저장 창을 열 수 없습니다.");
      return;
    }

    win.document.open();
    win.document.write(html);
    win.document.close();

    setTimeout(() => {
      win.focus();
      win.print();
    }, 300);
  }

  function buildTaxFilingPdfHtml() {
    const resp = lastResponse;
    const analysis = resp?.analysis || {};
    const breakdown = resp?.result?.tax_estimate?.breakdown || {};
    const vat = breakdown.vat || {};
    const income = breakdown.income || {};
    const insurance = breakdown.insurance || {};
    const sim = breakdown.taxpayer_type_simulation || null;
    const typeLabel = (t) => (t === "SIMPLE" ? "간이과세자" : "일반과세자");

    const now = new Date();
    const vatNext = nextVatFiling(now);
    const incomeNext = nextIncomeTaxFiling(now);
    const withholdingNext = nextWithholdingFiling(now);

    const rows = ledgerAllRows();
    const reviewRows = rows.filter((r) => !r.evidence || r.status === "review").slice(0, 10);

    const oppEligible = (Array.isArray(lastV2Data?.opportunities) ? lastV2Data.opportunities : [])
      .filter((o) => o.category === "절세 기회" && o.eligible);

    const todayStr = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });

    const vatRows = vat.taxpayer_type === "SIMPLE"
      ? `
        <tr><td>과세유형</td><td>간이과세자</td></tr>
        <tr><td>연 환산 매출(공급대가)</td><td>${formatWon(vat.sales_annual_gross)}원</td></tr>
        <tr><td>부가가치율 적용 실효세율</td><td>${((vat.simple_effective_rate || 0) * 100).toFixed(2)}%</td></tr>
        <tr><td>납부의무 면제 여부</td><td>${vat.is_exempt ? "면제 대상" : "면제 대상 아님"}</td></tr>
        <tr><td><b>월 예상 납부세액</b></td><td><b>${formatWon(vat.vat_due_month)}원</b></td></tr>
      `
      : `
        <tr><td>과세유형</td><td>일반과세자</td></tr>
        <tr><td>과세표준(월)</td><td>${formatWon(vat.taxable_base_month)}원</td></tr>
        <tr><td>매출세액(월)</td><td>${formatWon(vat.output_vat_month)}원</td></tr>
        <tr><td>매입세액공제(월, 추정)</td><td>${formatWon(vat.input_vat_credit_month_est)}원</td></tr>
        <tr><td>의제매입세액공제(월)</td><td>${formatWon(vat.deemed_input_credit_month)}원</td></tr>
        <tr><td><b>월 예상 납부세액</b></td><td><b>${formatWon(vat.vat_due_month)}원</b></td></tr>
      `;

    const simRow = sim
      ? `<div class="risk-callout" style="background:#eff6ff; border-color:#bfdbfe; color:#1e3a8a;">
          참고: ${escapeHtml(typeLabel(sim.alt_type))}였다면 연 부가세 ${formatWon(sim.alt_vat_due_year)}원 (현재 ${escapeHtml(typeLabel(sim.current_type))} 연 ${formatWon(sim.current_vat_due_year)}원)
        </div>`
      : "";

    const oppHtml = oppEligible.length
      ? oppEligible.map((o) => `
          <div class="box">
            <strong>${escapeHtml(o?.title || "절세 기회")}</strong>
            <div class="kpi-value">${fmtWonFull(o?.expected_credit)}</div>
            <div class="muted">${escapeHtml(o?.why || "-")}</div>
          </div>`).join("")
      : "<p class=\"muted\">현재 발견된 절세 기회가 없습니다.</p>";

    const reviewHtml = reviewRows.length
      ? `<table><thead><tr><th>날짜</th><th>거래처</th><th>내용</th><th>금액</th><th>증빙</th></tr></thead><tbody>
          ${reviewRows.map((r) => `
            <tr>
              <td>${escapeHtml(r.date)}</td>
              <td>${escapeHtml(r.vendor)}</td>
              <td>${escapeHtml(r.desc)}</td>
              <td>${formatWon(Math.abs(r.amount))}원</td>
              <td>${r.evidence ? escapeHtml(r.evidence) : "없음"}</td>
            </tr>
          `).join("")}
        </tbody></table>`
      : "<p class=\"muted\">확인이 필요한 거래가 없습니다.</p>";

    const scheduleHtml = [vatNext, incomeNext, withholdingNext]
      .sort((a, b) => a.date - b.date)
      .map((it) => `<li>${escapeHtml(it.label)} — ${fmtMD(it.date)} (${escapeHtml(ddayText(it.date))})</li>`)
      .join("");

    return `
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>TS 세금 신고 참고서식</title>
<style>
  :root{ --navy:#182459; --navy2:#0E1638; --line:#e2e5ea; }
  *{ box-sizing:border-box; }
  body{
    font-family: "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", Arial, sans-serif;
    color:#0b1220; margin:0; padding:36px; line-height:1.55;
  }
  .pdf-header{ display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid var(--navy); padding-bottom:14px; margin-bottom:18px; }
  .pdf-brand{ display:flex; align-items:center; gap:10px; }
  .pdf-logo{ width:34px; height:34px; border-radius:10px; background:linear-gradient(135deg,var(--navy),var(--navy2)); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:14px; }
  .pdf-brand-text{ font-size:18px; font-weight:900; letter-spacing:-.3px; }
  .pdf-meta{ text-align:right; font-size:12px; color:#64748b; }
  h1{font-size:22px; margin:0 0 4px; letter-spacing:-.4px;}
  h2{font-size:15px; margin:26px 0 10px; padding-bottom:6px; border-bottom:1px solid var(--line); color:var(--navy);}
  .sub{color:#6b7280; font-size:13px; margin-bottom:6px;}
  .risk-callout{ background:#fef2f2; border:1px solid #fca5a5; color:#991b1b; border-radius:12px; padding:12px 14px; font-size:13px; font-weight:700; margin:14px 0; }
  .box{ border:1px solid var(--line); border-radius:10px; padding:12px; margin-bottom:8px; background:#fafbfc; }
  .kpi-value{ font-size:16px; font-weight:900; margin:4px 0; }
  .muted{color:#6b7280; font-size:12px; margin-top:4px;}
  table{ width:100%; border-collapse:collapse; font-size:12px; }
  th, td{ border:1px solid var(--line); padding:7px 8px; text-align:left; }
  th{background:#f3f4f6; font-weight:800; color:#374151;}
  ul{margin:6px 0 0; padding-left:18px;}
  li{margin-bottom:6px;}
  .pdf-footer{ margin-top:30px; padding-top:12px; border-top:1px solid var(--line); font-size:10.5px; color:#94a3b8; }
  @media print{ body{padding:18px;} }
</style>
</head>
<body>
  <div class="pdf-header">
    <div class="pdf-brand">
      <div class="pdf-logo">TS</div>
      <div class="pdf-brand-text">TS (tax secretary)</div>
    </div>
    <div class="pdf-meta">생성일: ${escapeHtml(todayStr)}</div>
  </div>

  <h1>세금 신고 참고서식</h1>
  <div class="sub">
    대상월: ${escapeHtml(resp?.result?.month || "-")} · 업종: ${escapeHtml(resp?.result?.business_type?.label || "-")} · 지역: ${escapeHtml(resp?.result?.region?.label || "-")}
  </div>

  <h2>부가가치세 신고 참고 수치</h2>
  <table>${vatRows}</table>
  ${simRow}

  <h2>종합소득세 참고 수치</h2>
  <table>
    <tr><td>추정 과세표준(연)</td><td>${formatWon(income.taxable_income_est)}원</td></tr>
    <tr><td>추정 종합소득세(연)</td><td>${formatWon(income.income_tax_est)}원</td></tr>
    <tr><td>추정 지방소득세(연)</td><td>${formatWon(income.local_income_tax_est)}원</td></tr>
  </table>

  <h2>4대보험(사업주 부담 추정)</h2>
  <table>
    <tr><td>월 예상 부담액</td><td>${formatWon(insurance.employer_month_est)}원</td></tr>
    <tr><td>연 예상 부담액</td><td>${formatWon(insurance.employer_year_est)}원</td></tr>
  </table>

  <h2>TS가 찾은 절세 공제</h2>
  ${oppHtml}

  <h2>신고 전 확인이 필요한 거래</h2>
  ${reviewHtml}

  <h2>신고 일정</h2>
  <ul>${scheduleHtml}</ul>

  <div class="pdf-footer">
    본 서식은 홈택스 신고 전 참고용으로 정리한 추정 자료이며, 실제 제출은 국세청 홈택스에서 직접 진행해야 합니다. 확정 세액은 실제 신고·상담을 통해 확인이 필요합니다. © TS (tax secretary)
  </div>
</body>
</html>
    `;
  }

  function exportTaxFilingPdf() {
    if (!lastResponse) {
      showError("먼저 계산을 실행해주세요.");
      return;
    }

    const html = buildTaxFilingPdfHtml();
    const win = window.open("", "_blank", "width=1100,height=900");
    if (!win) {
      showError("팝업이 차단되어 PDF 저장 창을 열 수 없습니다.");
      return;
    }

    win.document.open();
    win.document.write(html);
    win.document.close();

    setTimeout(() => {
      win.focus();
      win.print();
    }, 300);
  }

  function csvEscape(v) {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportReportCsv() {
    const monthly = Array.isArray(v2LastMonthly) ? v2LastMonthly : [];
    if (monthly.length === 0) {
      showError("먼저 계산을 실행해주세요.");
      return;
    }

    const headers = [
      "월", "매출", "재료비", "인건비", "임차료", "기타비용", "총비용",
      "영업이익", "영업이익률(%)", "인건비율(%)", "재료비율(%)", "손익분기매출", "객단가", "방문자수",
    ];
    const lines = [headers.map(csvEscape).join(",")];
    monthly.forEach((m) => {
      const row = [
        m.month,
        Math.round(safeNumber(m.sales)),
        Math.round(safeNumber(m.material_cost)),
        Math.round(safeNumber(m.labor_cost)),
        Math.round(safeNumber(m.rent)),
        Math.round(safeNumber(m.other_cost)),
        Math.round(safeNumber(m.total_cost)),
        Math.round(safeNumber(m.profit)),
        (safeNumber(m.profit_ratio) * 100).toFixed(1),
        (safeNumber(m.labor_ratio) * 100).toFixed(1),
        (safeNumber(m.material_ratio) * 100).toFixed(1),
        Math.round(safeNumber(m.breakeven_sales)),
        Math.round(safeNumber(m.avg_ticket)),
        Math.round(safeNumber(m.visit_count)),
      ];
      lines.push(row.map(csvEscape).join(","));
    });

    const csvContent = "﻿" + lines.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const monthLabel = String(inpMonth?.value || "report").replace(/[^0-9-]/g, "");
    const a = document.createElement("a");
    a.href = url;
    a.download = `TS_경영리포트_${monthLabel || "report"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function renderDashboardHome() {
    if (!$("dashHomeView")) return;
    const analysis = lastResponse?.analysis || null;
    renderDashHomeSummary(analysis);
    renderDashHomeAlert(analysis);
    renderDashGoal();
    renderDashOppTeaser(lastV2Data);
    renderDashSimTeaser(lastV2Data);
    renderDashTodo(analysis);
    renderDashTaxSummary(analysis);
    renderDashCompleteness(lastV2Data);
  }

  function getMonthGoals() {
    try { return JSON.parse(localStorage.getItem(LS_MONTH_GOAL_KEY) || "{}"); } catch { return {}; }
  }
  function setMonthGoals(obj) {
    localStorage.setItem(LS_MONTH_GOAL_KEY, JSON.stringify(obj));
  }

  function renderDashGoal() {
    const box = $("dashGoalBody");
    if (!box) return;

    const m = String(inpMonth?.value || "").match(/^(\d{4})-(\d{2})$/);
    const monthKey = m ? `${m[1]}-${m[2]}` : "";
    if (!monthKey) {
      box.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      return;
    }

    const goals = getMonthGoals();
    const goal = goals[monthKey];

    const monthly = Array.isArray(v2LastMonthly) ? v2LastMonthly : [];
    const cur = monthly[monthly.length - 1] || null;
    const curRevenue = cur ? safeNumber(cur.sales) : safeNumber(lastResponse?.result?.annualized?.revenue_vat_included || 0) / 12;
    const curProfit = cur ? safeNumber(cur.profit) : null;

    if (!goal) {
      box.innerHTML = `
        <div class="empty-note" style="margin-bottom:10px;">이번 달 매출·이익 목표를 설정하면 달성률을 확인할 수 있어요.</div>
        <div class="ts-goal-input-row">
          <input type="text" id="dashGoalRevenueInput" placeholder="목표 매출(원)" inputmode="numeric" />
          <input type="text" id="dashGoalProfitInput" placeholder="목표 이익(원, 선택)" inputmode="numeric" />
          <button class="ts-ledger-quick-btn primary" type="button" id="dashGoalSaveBtn">목표 설정</button>
        </div>
      `;
      [$("dashGoalRevenueInput"), $("dashGoalProfitInput")].forEach((el) => {
        el?.addEventListener("input", () => formatWonLiveInput(el));
      });
      $("dashGoalSaveBtn")?.addEventListener("click", () => {
        const revenueGoal = getWonInput($("dashGoalRevenueInput"));
        const profitGoal = getWonInput($("dashGoalProfitInput"));
        if (!revenueGoal && !profitGoal) return;
        const all = getMonthGoals();
        all[monthKey] = { revenue: revenueGoal || 0, profit: profitGoal || 0 };
        setMonthGoals(all);
        renderDashGoal();
      });
      return;
    }

    const progressRow = (label, actual, target) => {
      if (!target) return "";
      const pct = Math.max(0, Math.min(100, Math.round((actual / target) * 100)));
      return `
        <div class="ts-completeness-stat" style="margin-bottom:12px;">
          <div class="ts-completeness-top"><span class="pct">${pct}%</span><span class="lbl">${escapeHtml(label)} ${fmtWonFull(actual)} / ${fmtWonFull(target)}</span></div>
          <div class="ts-completeness-bar"><div class="ts-completeness-bar-fill" style="width:${pct}%;"></div></div>
        </div>
      `;
    };

    box.innerHTML = `
      ${progressRow("매출", curRevenue, goal.revenue)}
      ${progressRow("이익", curProfit, goal.profit)}
      <button class="ts-card-link" type="button" id="dashGoalEditBtn">목표 수정 →</button>
    `;
    $("dashGoalEditBtn")?.addEventListener("click", () => {
      const all = getMonthGoals();
      delete all[monthKey];
      setMonthGoals(all);
      renderDashGoal();
    });
  }

  function renderDashOppTeaser(data) {
    const box = $("dashOppTeaser");
    if (!box) return;

    const opps = (Array.isArray(data?.opportunities) ? data.opportunities : [])
      .filter((o) => o.category === "절세 기회" && o.eligible);

    if (opps.length === 0) {
      box.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      return;
    }

    const total = opps.reduce((s, o) => s + (o.expected_credit || 0), 0);
    const top = [...opps].sort((a, b) => (b.expected_credit || 0) - (a.expected_credit || 0))[0];

    box.innerHTML = `
      <div class="ts-opp-teaser-main"><span class="cnt">절세 기회 ${opps.length}건</span><span class="amt">최대 ${fmtWonFull(total)}</span></div>
      <div class="ts-opp-teaser-row">
        <span class="ts-opp-teaser-top">가장 큰 기회: ${escapeHtml(top?.title || "")}</span>
        <button class="ts-card-link" type="button" id="dashBtnGoSave">절세 도우미에서 확인 →</button>
      </div>
    `;
    $("dashBtnGoSave")?.addEventListener("click", () => goDashNav("save"));
  }

  function renderDashSimTeaser(data) {
    const box = $("dashSimTeaser");
    if (!box) return;

    const rec = data?.scenarios?.recommended;
    if (!rec) {
      box.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      return;
    }

    box.innerHTML = `
      <div class="ts-report-sim-base">${escapeHtml(rec.label)}</div>
      <div class="ts-tax-ba">
        <div class="ts-tax-ba-col"><div class="l">현재 영업이익</div><div class="v">${fmtWonFull(rec.base_profit)}</div></div>
        <div class="ts-tax-ba-arrow">→</div>
        <div class="ts-tax-ba-col after"><div class="l">예상 영업이익</div><div class="v">${fmtWonFull(rec.new_profit)}</div></div>
      </div>
      <div class="ts-sim-result-banner"><span class="arrow">⬆</span><b>+${fmtWonFull(rec.profit_delta)}</b><span>세 방안 중 순이익 개선 효과가 가장 큽니다.</span></div>
      <button class="ts-ledger-side-link" type="button" id="dashBtnGoReport" style="margin-top:10px;">더 많은 시나리오 보기 → 경영 리포트</button>
    `;
    $("dashBtnGoReport")?.addEventListener("click", () => goDashNav("report"));
  }

  function renderDashCompleteness(data) {
    const box = $("dashCompletenessBody");
    if (!box) return;

    const dc = data?.data_completeness;
    if (!dc) {
      box.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      return;
    }

    const failures = Array.isArray(lastResponse?.meta?.partial_failures) ? lastResponse.meta.partial_failures : [];

    box.innerHTML = `
      <div class="ts-completeness-row">
        <div class="ts-completeness-stat">
          <div class="ts-completeness-top"><span class="pct">${dc.pct}%</span><span class="lbl">${dc.filled}/${dc.total}개 입력 완료</span></div>
          <div class="ts-completeness-bar"><div class="ts-completeness-bar-fill" style="width:${dc.pct}%;"></div></div>
        </div>
        <button class="ts-card-link" type="button" id="dashBtnAddInfo">정보 입력하기 →</button>
      </div>
      ${dc.missing_note ? `<div class="ts-completeness-note" style="margin-top:10px;">${escapeHtml(dc.missing_note)}</div>` : ""}
      ${failures.length ? `
        <details class="ts-dash-details" style="margin-top:12px;">
          <summary>분석 기준 및 가정 보기</summary>
          <div class="ts-dash-details-body">
            ${failures.map((f) => `<div class="ts-report-good-item">${escapeHtml(f.message || "-")}</div>`).join("")}
          </div>
        </details>
      ` : ""}
    `;
    $("dashBtnAddInfo")?.addEventListener("click", () => {
      setTab("input");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function renderDashHomeSummary(analysis) {
    const wrap = $("dashHomeSummaryRow");
    if (!wrap) return;

    const dateEl = $("dashHomeDate");
    if (dateEl) {
      const m = String(inpMonth?.value || "").match(/^(\d{4})-(\d{2})$/);
      dateEl.textContent = m ? `${m[1]}년 ${Number(m[2])}월` : "-";
    }

    const monthly = Array.isArray(v2LastMonthly) ? v2LastMonthly : [];
    const cur = monthly[monthly.length - 1] || null;
    const prev = monthly.length >= 2 ? monthly[monthly.length - 2] : null;

    const kpi = lastResponse?.kpi || {};
    const oppCount = Array.isArray(lastV2Data?.opportunities)
      ? lastV2Data.opportunities.filter((o) => o.eligible).length
      : (Number.isFinite(lastV2Data?.opportunity_count) ? lastV2Data.opportunity_count : null);

    const tb = analysis?.tax_brief || {};
    const vatMonth = safeNumber(tb?.vat?.due_month || 0);
    const incomeYearCombined = safeNumber(tb?.income_tax?.due_year || 0);
    const incomeLocalMonth = incomeYearCombined / 12;
    const taxMonthTotal = vatMonth + incomeLocalMonth;

    const pctChange = (a, b) => {
      if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
      return ((a - b) / Math.abs(b)) * 100;
    };

    const deltaHtml = (v, goodWhenUp = true) => {
      if (v == null || !Number.isFinite(v)) return "";
      const up = v > 0;
      const cls = (up === goodWhenUp) ? "up" : (v === 0 ? "flat" : "down");
      const arrow = up ? "▲" : (v < 0 ? "▼" : "-");
      return `<div class="ts-home-kpi-sub ${cls}">${arrow} ${Math.abs(v).toFixed(1)}% 전월 대비</div>`;
    };

    const cardHtml = (iconClass, iconSvg, label, value, deltaInner) => `
      <div class="ts-home-kpi-card">
        <div class="ts-home-kpi-ic ${iconClass}">${iconSvg}</div>
        <div class="ts-home-kpi-label">${escapeHtml(label)}</div>
        <div class="ts-home-kpi-value">${value}</div>
        ${deltaInner || ""}
      </div>
    `;

    const salesIcon = `<img src="./icon-dash-sales.png" alt="" />`;
    const costIcon = `<img src="./icon-dash-cost.png" alt="" />`;
    const taxIcon = `<img src="./icon-dash-tax.png" alt="" />`;
    const riskIcon = `<img src="./icon-dash-risk.png" alt="" />`;
    const oppIcon = `<img src="./icon-dash-opportunity.png" alt="" />`;

    const salesDelta = cur && prev ? pctChange(cur.sales, prev.sales) : null;
    const costDelta = cur && prev ? pctChange(cur.total_cost, prev.total_cost) : null;

    const cards = [
      cardHtml("blue", salesIcon, "이번 달 매출", cur ? fmtWonFull(cur.sales) : "-", deltaHtml(salesDelta, true)),
      cardHtml("amber", costIcon, "이번 달 비용", cur ? fmtWonFull(cur.total_cost) : "-", deltaHtml(costDelta, false)),
      cardHtml("green", taxIcon, "예상 세금(월)", taxMonthTotal > 0 ? fmtWonFull(taxMonthTotal) : "-", ""),
      cardHtml("red", riskIcon, "위험도 등급", kpi?.grade != null ? String(kpi.grade) : "-", `<div class="ts-home-kpi-sub flat">${kpi?.score_100 != null ? kpi.score_100 + "점" : "-"}</div>`),
      cardHtml("blue", oppIcon, "절세 기회", oppCount != null ? `${oppCount}건` : "-", ""),
    ];

    const yoyCard = Array.isArray(analysis?.kpi_cards)
      ? analysis.kpi_cards.find((k) => k?.code === "SALES_GROWTH_YOY")
      : null;
    if (yoyCard) {
      const yoyPct = Number(yoyCard.value) * 100;
      const up = yoyPct > 0;
      const cls = up ? "up" : (yoyPct < 0 ? "down" : "flat");
      const arrow = up ? "▲" : (yoyPct < 0 ? "▼" : "-");
      cards.push(
        cardHtml(
          "blue",
          salesIcon,
          "전년 대비 매출",
          `${up ? "+" : ""}${yoyPct.toFixed(1)}%`,
          `<div class="ts-home-kpi-sub ${cls}">${arrow} 연환산 기준</div>`
        )
      );
    }

    wrap.innerHTML = cards.join("");
  }

  function getAlertThreshold() {
    const v = Number(localStorage.getItem(LS_ALERT_THRESHOLD_KEY));
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_ALERT_THRESHOLD_PP;
  }
  function setAlertThreshold(v) {
    localStorage.setItem(LS_ALERT_THRESHOLD_KEY, String(v));
  }

  function findAlertWorstItem(analysis) {
    const items = Array.isArray(analysis?.benchmarks?.items) ? analysis.benchmarks.items : [];
    const threshold = getAlertThreshold();
    const candidates = items
      .filter((x) => Number.isFinite(Number(x?.diff_pp)) && Object.prototype.hasOwnProperty.call(METRIC_WORSE_WHEN_HIGH, x?.metric))
      .map((x) => {
        const worseWhenHigh = METRIC_WORSE_WHEN_HIGH[x.metric];
        const badness = worseWhenHigh ? Number(x.diff_pp) : -Number(x.diff_pp);
        return { item: x, badness };
      })
      .filter((x) => x.badness >= threshold)
      .sort((a, b) => b.badness - a.badness);
    return candidates[0]?.item || null;
  }

  function renderDashAlertSettings() {
    const box = $("dashAlertSettings");
    if (!box) return;
    const threshold = getAlertThreshold();
    box.innerHTML = `
      <span>⚙ 알림 기준: 업종 평균보다 <b>${threshold}%p</b> 이상 차이나면 알려드려요</span>
      <button class="ts-card-link" type="button" id="dashAlertSettingsEditBtn">수정</button>
    `;
    $("dashAlertSettingsEditBtn")?.addEventListener("click", () => {
      box.innerHTML = `
        <span>알림 기준(%p):</span>
        <input type="text" id="dashAlertThresholdInput" inputmode="numeric" value="${threshold}" style="width:56px;" />
        <button class="ts-ledger-quick-btn primary" type="button" id="dashAlertThresholdSaveBtn">저장</button>
      `;
      $("dashAlertThresholdInput")?.focus();
      $("dashAlertThresholdSaveBtn")?.addEventListener("click", () => {
        const raw = Number(String($("dashAlertThresholdInput")?.value || "").replace(/[^\d.]/g, ""));
        const next = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ALERT_THRESHOLD_PP;
        setAlertThreshold(next);
        renderDashAlertSettings();
        renderDashHomeAlert(lastResponse?.analysis || null);
      });
    });
  }

  function renderDashHomeAlert(analysis) {
    const box = $("dashHomeAlert");
    if (!box) return;

    renderDashAlertSettings();

    const worst = findAlertWorstItem(analysis || {});

    if (!worst) {
      box.classList.add("hidden");
      return;
    }

    const worseWhenHigh = METRIC_WORSE_WHEN_HIGH[worst.metric];
    const directionWord = worseWhenHigh ? "높습니다" : "낮습니다";

    const titleEl = $("dashHomeAlertTitle");
    const detailEl = $("dashHomeAlertDetail");
    if (titleEl) titleEl.textContent = `${metricLabel(worst.metric)}이 업종 평균보다 ${Math.abs(Number(worst.diff_pp)).toFixed(1)}%p ${directionWord}`;

    const monthly = Array.isArray(v2LastMonthly) ? v2LastMonthly : [];
    const cur = monthly[monthly.length - 1];
    const annualRevenue = cur ? cur.sales * 12 : safeNumber(lastResponse?.result?.annualized?.revenue_vat_included || 0);
    const estSave = annualRevenue > 0 ? Math.round(annualRevenue * (Number(worst.diff_pp) / 100)) : 0;
    if (detailEl) {
      detailEl.textContent = estSave > 0
        ? `현재 구조를 조정하면 연간 약 ${fmtWonFull(estSave)} 절감할 수 있는 것으로 분석됩니다.`
        : `우선 점검이 필요한 항목입니다.`;
    }
    box.classList.remove("hidden");
  }

  function getTodoCustom() {
    try { return JSON.parse(localStorage.getItem(LS_TODO_CUSTOM_KEY) || "[]"); } catch { return []; }
  }
  function setTodoCustom(arr) { localStorage.setItem(LS_TODO_CUSTOM_KEY, JSON.stringify(arr)); }
  function getTodoOverrides() {
    try { return JSON.parse(localStorage.getItem(LS_TODO_OVERRIDE_KEY) || "{}"); } catch { return {}; }
  }
  function setTodoOverrides(obj) { localStorage.setItem(LS_TODO_OVERRIDE_KEY, JSON.stringify(obj)); }
  function getTodoDeleted() {
    try { return JSON.parse(localStorage.getItem(LS_TODO_DELETED_KEY) || "[]"); } catch { return []; }
  }
  function setTodoDeleted(arr) { localStorage.setItem(LS_TODO_DELETED_KEY, JSON.stringify(arr)); }

  function renderDashTodo(analysis) {
    const box = $("dashTodoList");
    if (!box) return;

    const autoActions = Array.isArray(analysis?.actions) ? analysis.actions.slice(0, 4) : [];
    const overrides = getTodoOverrides();
    const deletedList = getTodoDeleted();
    const deleted = new Set(deletedList);
    const deadlineTag = { P1: "오늘", P2: "이번 주", P3: "이번 달" };

    const autoItems = autoActions.map((a) => {
      const key = actionKey(a);
      const priority = String(a?.priority || "P?").toUpperCase();
      return { key, text: overrides[key] ?? (a?.title || "실행 액션"), tag: deadlineTag[priority] || "확인" };
    }).filter((it) => !deleted.has(it.key));

    const customItems = getTodoCustom()
      .filter((c) => !deleted.has(c.id))
      .map((c) => ({ key: c.id, text: overrides[c.id] ?? c.text, tag: c.tag || "직접 추가" }));

    const items = [...autoItems, ...customItems];
    const state = getActionCheckState();

    const listHtml = items.length === 0
      ? `<div class="empty-note">할 일이 없습니다. 아래에서 직접 추가해보세요.</div>`
      : items.map((it) => `
          <div class="ts-home-todo-item" data-todo-key="${escapeHtml(it.key)}">
            <input type="checkbox" data-action-key="${escapeHtml(it.key)}" ${state[it.key] ? "checked" : ""} />
            <span class="ts-home-todo-tag">${escapeHtml(it.tag)}</span>
            <span class="ts-home-todo-text" contenteditable="true" data-todo-key="${escapeHtml(it.key)}">${escapeHtml(it.text)}</span>
            <button class="ts-home-todo-del" type="button" data-todo-key="${escapeHtml(it.key)}" aria-label="삭제">✕</button>
          </div>
        `).join("");

    box.innerHTML = `
      ${listHtml}
      <div class="ts-home-todo-add">
        <input type="text" id="dashTodoNewInput" placeholder="+ 할 일 입력 후 Enter" />
      </div>
    `;

    const topEl = $("dashTodoTop");
    if (topEl) topEl.textContent = items[0] ? `가장 먼저: ${items[0].text}` : "";

    bindActionCheckboxes();
    bindDashTodoEvents();
  }

  function bindDashTodoEvents() {
    const box = $("dashTodoList");
    if (!box) return;

    box.querySelectorAll(".ts-home-todo-text[contenteditable]").forEach((el) => {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); el.blur(); }
      });
      el.addEventListener("blur", () => {
        const key = el.getAttribute("data-todo-key");
        const val = el.textContent.trim();
        if (!key) return;
        if (!val) { renderDashTodo(lastResponse?.analysis || null); return; }
        const overrides = getTodoOverrides();
        overrides[key] = val;
        setTodoOverrides(overrides);
      });
    });

    box.querySelectorAll(".ts-home-todo-del").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-todo-key");
        if (!key) return;
        const deletedList = getTodoDeleted();
        if (!deletedList.includes(key)) deletedList.push(key);
        setTodoDeleted(deletedList);
        renderDashTodo(lastResponse?.analysis || null);
      });
    });

    const newInput = $("dashTodoNewInput");
    if (newInput) {
      newInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && newInput.value.trim()) {
          const custom = getTodoCustom();
          custom.push({ id: `custom_${Date.now()}`, text: newInput.value.trim(), tag: "직접 추가" });
          setTodoCustom(custom);
          renderDashTodo(lastResponse?.analysis || null);
        }
      });
    }
  }

  function renderDashTaxSummary(analysis) {
    const box = $("dashTaxSummary");
    if (!box) return;

    const tb = analysis?.tax_brief || {};
    const total = safeNumber(tb?.vat?.due_year || 0) + safeNumber(tb?.income_tax?.due_year || 0) + safeNumber(tb?.insurance?.employer_year || 0);

    box.innerHTML = total > 0
      ? `<div class="ts-report-flow-row total"><span>연 예상 세부담</span><b>${fmtWonFull(total)}</b></div>`
      : `<div class="empty-note">계산 후 표시됩니다.</div>`;
  }

  // ---------------------------------------------------------------------
  // 장부 관리 (Ledger) — 데모용 샘플 거래 데이터 기반 화면
  // ---------------------------------------------------------------------
  const LEDGER_SAMPLE = [
    { id: "t20", date: "2026-08-31", vendor: "농협유통", desc: "식자재 구입", amount: -540000, type: "expense", category: "재료비", evidence: "카드매출전표", method: "사업용 카드", status: "done", taxNote: "과세 매입", aiNote: "정기 식자재 매입 거래로 판단되어 재료비로 자동 분류했습니다." },
    { id: "t19", date: "2026-08-30", vendor: "배달의민족", desc: "매출 정산", amount: 1820000, type: "income", category: "배달매출", evidence: "정산내역서", method: "플랫폼 정산", status: "done", taxNote: "과세 매출", aiNote: "배달 플랫폼 정산 내역으로 판단되어 배달매출로 자동 분류했습니다." },
    { id: "t18", date: "2026-08-29", vendor: "○○수산", desc: "생선 매입", amount: -830000, type: "expense", category: "면세농산물", evidence: "매입계산서.pdf", method: "사업용 카드", status: "review", taxNote: "관련 공제 검토 가능", aiNote: "면세농산물 의제매입세액공제 대상일 수 있어 확인이 필요합니다." },
    { id: "t17", date: "2026-08-28", vendor: "신한카드", desc: "카드 매출 정산", amount: 2150000, type: "income", category: "카드매출", evidence: "정산내역서", method: "카드사 정산", status: "done", taxNote: "과세 매출", aiNote: "카드사 매출 정산 입금으로 판단되어 카드매출로 자동 분류했습니다." },
    { id: "t16", date: "2026-08-27", vendor: "한전", desc: "8월 전기요금", amount: -410000, type: "expense", category: "공과금", evidence: "고지서", method: "자동이체", status: "done", taxNote: "과세 매입", aiNote: "정기 공과금 이체 내역으로 판단되어 공과금으로 자동 분류했습니다." },
    { id: "t15", date: "2026-08-26", vendor: "요기요", desc: "매출 정산", amount: 980000, type: "income", category: "배달매출", evidence: "정산내역서", method: "플랫폼 정산", status: "done", taxNote: "과세 매출", aiNote: "배달 플랫폼 정산 내역으로 판단되어 배달매출로 자동 분류했습니다." },
    { id: "t14", date: "2026-08-25", vendor: "이마트", desc: "주방용품 구입", amount: -125000, type: "expense", category: "기타", evidence: null, method: "사업용 카드", status: "review", taxNote: "증빙 확인 필요", aiNote: "주방용품 구입으로 추정되나 증빙이 첨부되지 않아 확인이 필요합니다." },
    { id: "t13", date: "2026-08-24", vendor: "서울도시가스", desc: "8월 가스요금", amount: -186000, type: "expense", category: "공과금", evidence: "고지서", method: "사업용 카드", status: "done", taxNote: "과세 매입", aiNote: "정기 공과금 이체 내역으로 판단되어 공과금으로 자동 분류했습니다." },
    { id: "t12", date: "2026-08-23", vendor: "급여 이체", desc: "8월 직원 급여", amount: -4200000, type: "expense", category: "인건비", evidence: "이체내역서", method: "계좌이체", status: "done", taxNote: "원천세 신고 대상", aiNote: "정기 급여 이체 내역으로 판단되어 인건비로 자동 분류했습니다." },
    { id: "t11", date: "2026-08-22", vendor: "○○청과", desc: "채소 매입", amount: -390000, type: "expense", category: "면세농산물", evidence: null, method: "현금", status: "review", taxNote: "증빙 확인 필요", aiNote: "식자재 매입으로 추정되나 증빙이 없어 면세농산물 공제 여부 확인이 필요합니다." },
    { id: "t10", date: "2026-08-21", vendor: "현금 매출", desc: "현금 매출분", amount: 560000, type: "income", category: "현금매출", evidence: "현금영수증", method: "현금", status: "done", taxNote: "과세 매출", aiNote: "현금영수증이 발급된 현금 매출로 자동 분류했습니다." },
    { id: "t9", date: "2026-08-20", vendor: "네이버", desc: "플레이스 광고비", amount: -150000, type: "expense", category: "광고비", evidence: "세금계산서", method: "사업용 카드", status: "done", taxNote: "과세 매입", aiNote: "온라인 광고 집행 내역으로 판단되어 광고비로 자동 분류했습니다." },
    { id: "t8", date: "2026-08-19", vendor: "○○부동산", desc: "8월 임차료", amount: -1900000, type: "expense", category: "임차료", evidence: "계좌이체 내역", method: "계좌이체", status: "done", taxNote: "과세 매입", aiNote: "정기 임차료 이체 내역으로 판단되어 임차료로 자동 분류했습니다." },
    { id: "t7", date: "2026-08-18", vendor: "배달의민족", desc: "매출 정산", amount: 1650000, type: "income", category: "배달매출", evidence: "정산내역서", method: "플랫폼 정산", status: "done", taxNote: "과세 매출", aiNote: "배달 플랫폼 정산 내역으로 판단되어 배달매출로 자동 분류했습니다." },
    { id: "t6", date: "2026-08-17", vendor: "□□축산", desc: "고기 매입", amount: -720000, type: "expense", category: "재료비", evidence: "세금계산서", method: "사업용 카드", status: "done", taxNote: "과세 매입", aiNote: "정기 식자재 매입 거래로 판단되어 재료비로 자동 분류했습니다." },
    { id: "t5", date: "2026-08-16", vendor: "신한카드", desc: "카드 매출 정산", amount: 1980000, type: "income", category: "카드매출", evidence: "정산내역서", method: "카드사 정산", status: "done", taxNote: "과세 매출", aiNote: "카드사 매출 정산 입금으로 판단되어 카드매출로 자동 분류했습니다." },
    { id: "t4", date: "2026-08-15", vendor: "다이소", desc: "소모품 구입", amount: -68000, type: "expense", category: "기타", evidence: null, method: "사업용 카드", status: "review", taxNote: "증빙 확인 필요", aiNote: "소모품 구입으로 추정되나 증빙이 첨부되지 않아 확인이 필요합니다." },
    { id: "t3", date: "2026-08-13", vendor: "농협유통", desc: "식자재 구입", amount: -610000, type: "expense", category: "재료비", evidence: "카드매출전표", method: "사업용 카드", status: "done", taxNote: "과세 매입", aiNote: "정기 식자재 매입 거래로 판단되어 재료비로 자동 분류했습니다." },
    { id: "t2", date: "2026-08-11", vendor: "요기요", desc: "매출 정산", amount: 890000, type: "income", category: "배달매출", evidence: "정산내역서", method: "플랫폼 정산", status: "done", taxNote: "과세 매출", aiNote: "배달 플랫폼 정산 내역으로 판단되어 배달매출로 자동 분류했습니다." },
    { id: "t1", date: "2026-08-10", vendor: "거래처 미확인", desc: "계좌 입금", amount: 250000, type: "income", category: "기타", evidence: null, method: "계좌이체", status: "review", taxNote: "거래 목적 확인 필요", aiNote: "거래 목적을 특정할 수 없어 확인이 필요합니다. 매출인지 개인 입금인지 확인해주세요." },
  ];
  const LEDGER_CUSTOM_KEY = "ts_ledger_custom_v1";
  const LEDGER_RECURRING_KEY = "ts_ledger_recurring_v1";
  const LEDGER_LEARNED_KEY = "ts_ledger_learned_v1";
  const LEDGER_CATEGORIES = ["재료비", "인건비", "임차료", "공과금", "광고비", "배달매출", "카드매출", "면세농산물", "현금매출", "기타"];

  let ledgerFilter = { type: "all", category: "all", evidence: "all", status: "all", q: "" };
  let ledgerSelectedId = null;
  let ledgerReclassifyOpen = false;

  function getLedgerRecurring() {
    try { return JSON.parse(localStorage.getItem(LEDGER_RECURRING_KEY) || "[]"); } catch { return []; }
  }
  function setLedgerRecurring(arr) { localStorage.setItem(LEDGER_RECURRING_KEY, JSON.stringify(arr)); }

  function getLedgerLearned() {
    try { return JSON.parse(localStorage.getItem(LEDGER_LEARNED_KEY) || "{}"); } catch { return {}; }
  }
  function setLedgerLearned(obj) { localStorage.setItem(LEDGER_LEARNED_KEY, JSON.stringify(obj)); }

  function getLedgerCustom() {
    try { return JSON.parse(localStorage.getItem(LEDGER_CUSTOM_KEY) || "[]"); } catch { return []; }
  }
  function setLedgerCustom(arr) { localStorage.setItem(LEDGER_CUSTOM_KEY, JSON.stringify(arr)); }

  function ledgerAllRows() {
    const learned = getLedgerLearned();
    return [...getLedgerCustom(), ...LEDGER_SAMPLE].map((r) => {
      const rule = learned[r.vendor];
      if (!rule || r.status !== "review") return r;
      return {
        ...r,
        category: rule.category,
        status: "done",
        aiNote: `이전에 "${escapeHtml(r.vendor)}" 거래를 ${rule.category}(으)로 직접 분류하신 내역을 학습해 자동 적용했습니다.`,
      };
    });
  }

  function ledgerToast(msg) {
    let box = $("ledgerToastBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "ledgerToastBox";
      box.style.cssText = "position:fixed; left:50%; bottom:28px; transform:translateX(-50%); background:#0b1220; color:#fff; font-size:12.5px; font-weight:800; padding:10px 18px; border-radius:999px; z-index:9999; box-shadow:0 14px 30px rgba(0,0,0,.28); opacity:0; transition:opacity .2s ease;";
      document.body.appendChild(box);
    }
    box.textContent = msg;
    box.style.opacity = "1";
    clearTimeout(box._t);
    box._t = setTimeout(() => { box.style.opacity = "0"; }, 1800);
  }

  function renderDashLedger() {
    if (!$("dashLedgerView")) return;

    const rows = ledgerAllRows();
    const income = rows.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0);
    const expense = rows.filter((r) => r.type === "expense").reduce((s, r) => s - r.amount, 0);
    const reviewCount = rows.filter((r) => r.status === "review").length;
    const missingCount = rows.filter((r) => !r.evidence).length;
    const doneCount = rows.length - reviewCount;

    const summaryEl = $("ledgerSummaryLine");
    if (summaryEl) {
      summaryEl.innerHTML = `
        <span>수입 <b>${fmtWonFull(income)}</b></span><span class="sep">·</span>
        <span>지출 <b>${fmtWonFull(expense)}</b></span><span class="sep">·</span>
        <span>확인 필요 <b class="warn">${reviewCount}건</b></span><span class="sep">·</span>
        <span>증빙 누락 <b class="warn">${missingCount}건</b></span>
      `;
    }

    const aiDetail = $("ledgerAiDetail");
    if (aiDetail) aiDetail.textContent = `${rows.length}건 중 ${doneCount}건 자동 분류 · ${reviewCount}건만 확인해주세요.`;

    const q = ledgerFilter.q.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (ledgerFilter.type !== "all" && r.type !== ledgerFilter.type) return false;
      if (ledgerFilter.category !== "all" && r.category !== ledgerFilter.category) return false;
      if (ledgerFilter.evidence === "has" && !r.evidence) return false;
      if (ledgerFilter.evidence === "none" && r.evidence) return false;
      if (ledgerFilter.status !== "all" && r.status !== ledgerFilter.status) return false;
      if (q && !(`${r.vendor} ${r.desc}`.toLowerCase().includes(q))) return false;
      return true;
    });

    const body = $("ledgerTableBody");
    const emptyNote = $("ledgerEmptyNote");
    if (body) {
      body.innerHTML = filtered.map((r) => `
        <tr data-ledger-row="${escapeHtml(r.id)}" class="${r.id === ledgerSelectedId ? "selected" : ""}">
          <td>${escapeHtml(r.date.slice(5).replace("-", "/"))}</td>
          <td>${escapeHtml(r.vendor)}</td>
          <td>${escapeHtml(r.desc)}</td>
          <td class="ts-ledger-amt ${r.type}">${r.amount > 0 ? "+" : "-"}${fmtWonFull(Math.abs(r.amount))}</td>
          <td><span class="ts-ledger-type-chip ${r.type}">${r.type === "income" ? "수입" : "지출"}</span></td>
          <td>${escapeHtml(r.category)}</td>
          <td class="ts-ledger-evidence ${r.evidence ? "" : "none"}">${r.evidence ? escapeHtml(r.evidence) : "없음"}</td>
          <td><span class="ts-ledger-status-chip ${r.status}">${r.status === "done" ? "완료" : "확인 필요"}</span></td>
        </tr>
      `).join("");
      emptyNote?.classList.toggle("hidden", filtered.length > 0);
    }

    renderLedgerSide(rows);
    bindLedgerEvents();
  }

  function renderLedgerSide(rows) {
    const side = $("ledgerSidePanel");
    if (!side) return;

    const selected = rows.find((r) => r.id === ledgerSelectedId);

    if (selected) {
      side.innerHTML = `
        <div class="ts-ledger-side-card">
          <button class="ts-ledger-detail-close" type="button" id="ledgerDetailClose">✕ 닫기</button>
          <div class="ts-ledger-detail-title">${escapeHtml(selected.vendor)} · ${escapeHtml(fmtWonFull(Math.abs(selected.amount)))}</div>
          <div class="ts-ledger-detail-amt">${escapeHtml(selected.desc)}</div>

          <div class="ts-ledger-detail-row"><div class="k">거래일</div><div class="v">${escapeHtml(selected.date.replace(/-/g, "."))}</div></div>
          <div class="ts-ledger-detail-row">
            <div class="k">분류</div>
            ${ledgerReclassifyOpen ? `
              <div class="ts-ledger-reclassify-row">
                <select id="ledgerReclassifySelect">
                  ${LEDGER_CATEGORIES.map((c) => `<option value="${escapeHtml(c)}" ${c === selected.category ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
                </select>
                <button class="ts-ledger-quick-btn primary" type="button" id="ledgerReclassifySave">저장</button>
                <button class="ts-card-link" type="button" id="ledgerReclassifyCancel">취소</button>
              </div>
            ` : `<div class="v">${selected.type === "income" ? "수입" : "지출"} &gt; ${escapeHtml(selected.category)}</div>`}
          </div>
          <div class="ts-ledger-detail-row"><div class="k">결제수단</div><div class="v">${escapeHtml(selected.method)}</div></div>
          <div class="ts-ledger-detail-row"><div class="k">증빙</div><div class="v">${selected.evidence ? escapeHtml(selected.evidence) : "없음"}</div></div>
          <div class="ts-ledger-detail-row"><div class="k">세금 처리</div><div class="v">${escapeHtml(selected.taxNote)}</div></div>

          <div class="ts-ledger-detail-ai">🤖 AI 판단: ${escapeHtml(selected.aiNote)}</div>

          <div class="ts-ledger-detail-actions">
            <button class="ts-ledger-detail-btn" type="button" id="ledgerBtnReclassify">분류 수정</button>
            <button class="ts-ledger-detail-btn" type="button" id="ledgerBtnAddEvidence">증빙 추가</button>
            <button class="ts-ledger-detail-btn" type="button" id="ledgerBtnSaveRecurring">🔁 반복거래로 저장</button>
          </div>
        </div>
      `;
      $("ledgerReclassifySave")?.addEventListener("click", () => {
        const newCategory = $("ledgerReclassifySelect")?.value || selected.category;
        const learned = getLedgerLearned();
        learned[selected.vendor] = { category: newCategory, type: selected.type };
        setLedgerLearned(learned);
        ledgerReclassifyOpen = false;
        ledgerToast(`"${selected.vendor}" 거래를 ${newCategory}(으)로 분류했어요. 같은 거래처의 다른 미분류 거래에도 자동 적용됩니다.`);
        renderDashLedger();
      });
      $("ledgerReclassifyCancel")?.addEventListener("click", () => {
        ledgerReclassifyOpen = false;
        renderDashLedger();
      });
      $("ledgerBtnSaveRecurring")?.addEventListener("click", () => {
        const recurring = getLedgerRecurring();
        const dup = recurring.some((t) => t.vendor === selected.vendor && t.desc === selected.desc && t.amount === selected.amount);
        if (dup) {
          ledgerToast("이미 반복거래로 저장돼 있어요.");
          return;
        }
        recurring.push({
          id: `recur_${Date.now()}`,
          vendor: selected.vendor,
          desc: selected.desc,
          amount: selected.amount,
          type: selected.type,
          category: selected.category,
          method: selected.method,
        });
        setLedgerRecurring(recurring);
        ledgerToast("반복거래로 저장했어요. 다음 달에도 한 번에 등록할 수 있어요.");
      });
      return;
    }

    const missingCount = rows.filter((r) => !r.evidence).length;
    const taxDocMissing = rows.filter((r) => r.status === "review" && r.evidence).length;
    const purposeUnclear = rows.filter((r) => r.status === "review" && !r.evidence && r.category === "기타").length;
    const recurring = getLedgerRecurring();

    side.innerHTML = `
      <div class="ts-ledger-side-card">
        <h4>증빙이 필요한 거래</h4>
        <div class="ts-ledger-evi-row"><span>영수증·증빙 누락</span><span class="v">${missingCount}건</span></div>
        <div class="ts-ledger-evi-row"><span>세금계산서 확인 필요</span><span class="v">${taxDocMissing}건</span></div>
        <div class="ts-ledger-evi-row"><span>거래 목적 확인 필요</span><span class="v">${purposeUnclear}건</span></div>
        <button class="ts-ledger-side-link" type="button" id="ledgerLinkMissing" style="margin-top:10px;">누락 증빙 확인 →</button>
      </div>
      <div class="ts-ledger-side-card">
        <h4>🔁 반복거래</h4>
        ${recurring.length === 0
          ? `<div class="empty-note">거래 상세에서 "반복거래로 저장"을 누르면 월세·급여처럼 매달 반복되는 거래를 여기서 한 번에 등록할 수 있어요.</div>`
          : recurring.map((t) => `
              <div class="ts-ledger-recurring-row" data-recurring-id="${escapeHtml(t.id)}">
                <div>
                  <div class="ts-ledger-recurring-vendor">${escapeHtml(t.vendor)}</div>
                  <div class="ts-ledger-recurring-amt">${t.amount > 0 ? "+" : "-"}${fmtWonFull(Math.abs(t.amount))}</div>
                </div>
                <div class="ts-ledger-recurring-actions">
                  <button class="ts-ledger-side-link" type="button" data-recurring-add="${escapeHtml(t.id)}">추가</button>
                  <button class="ts-ledger-recurring-del" type="button" data-recurring-del="${escapeHtml(t.id)}" aria-label="삭제">✕</button>
                </div>
              </div>
            `).join("")
        }
      </div>
      <div class="ts-ledger-side-card">
        <h4>8월 장부 준비도</h4>
        <div class="ts-ledger-progress-ring">91%</div>
        <div class="ts-ledger-check-item"><span class="ok">✅</span>거래 분류 완료</div>
        <div class="ts-ledger-check-item"><span class="ok">✅</span>매출 자료 확인</div>
        <div class="ts-ledger-check-item"><span class="warn">⚠</span>증빙 누락 ${missingCount}건</div>
        <button class="ts-ledger-side-link" type="button" id="ledgerBtnCloseMonth" style="margin-top:6px;">장부 마감 준비하기</button>
      </div>
    `;

    side.querySelectorAll("[data-recurring-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-recurring-add");
        const t = getLedgerRecurring().find((x) => x.id === id);
        if (!t) return;
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const custom = getLedgerCustom();
        custom.push({
          id: `custom_${Date.now()}`,
          date: dateStr,
          vendor: t.vendor,
          desc: t.desc,
          amount: t.amount,
          type: t.type,
          category: t.category,
          evidence: null,
          method: t.method,
          status: "review",
          taxNote: "반복거래로 등록된 거래입니다.",
          aiNote: "반복거래 템플릿에서 자동으로 추가됐어요. 이번 달 금액이 맞는지 확인해주세요.",
        });
        setLedgerCustom(custom);
        ledgerToast(`${t.vendor} 거래를 이번 달에 추가했어요.`);
        renderDashLedger();
      });
    });
    side.querySelectorAll("[data-recurring-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-recurring-del");
        setLedgerRecurring(getLedgerRecurring().filter((x) => x.id !== id));
        renderDashLedger();
      });
    });
  }

  function bindLedgerEvents() {
    const view = $("dashLedgerView");
    if (!view || view.dataset.bound === "1") {
      bindLedgerRowClicks();
      bindLedgerSideActions();
      return;
    }
    view.dataset.bound = "1";

    view.querySelectorAll(".ts-ledger-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        ledgerFilter.type = tab.getAttribute("data-type");
        view.querySelectorAll(".ts-ledger-tab").forEach((t) => t.classList.toggle("active", t === tab));
        renderDashLedger();
      });
    });

    $("ledgerCategoryFilter")?.addEventListener("change", (e) => { ledgerFilter.category = e.target.value; renderDashLedger(); });
    $("ledgerEvidenceFilter")?.addEventListener("change", (e) => { ledgerFilter.evidence = e.target.value; renderDashLedger(); });
    $("ledgerStatusFilter")?.addEventListener("change", (e) => { ledgerFilter.status = e.target.value; renderDashLedger(); });
    $("ledgerSearchInput")?.addEventListener("input", (e) => { ledgerFilter.q = e.target.value; renderDashLedger(); });

    $("ledgerBtnUnclassified")?.addEventListener("click", () => {
      ledgerFilter.status = "review";
      const sel = $("ledgerStatusFilter");
      if (sel) sel.value = "review";
      renderDashLedger();
    });
    $("ledgerBtnExcel")?.addEventListener("click", () => {
      setTab("input");
      $("excelImportCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("ledgerBtnReceipt")?.addEventListener("click", () => ledgerToast("데모 화면에서는 영수증 업로드가 지원되지 않아요."));
    $("ledgerBtnAdd")?.addEventListener("click", openLedgerAddRow);

    bindLedgerRowClicks();
    bindLedgerSideActions();
  }

  function bindLedgerRowClicks() {
    $("ledgerTableBody")?.querySelectorAll("tr[data-ledger-row]").forEach((tr) => {
      tr.addEventListener("click", () => {
        const id = tr.getAttribute("data-ledger-row");
        ledgerSelectedId = ledgerSelectedId === id ? null : id;
        ledgerReclassifyOpen = false;
        renderDashLedger();
      });
    });
  }

  function bindLedgerSideActions() {
    $("ledgerDetailClose")?.addEventListener("click", () => { ledgerSelectedId = null; ledgerReclassifyOpen = false; renderDashLedger(); });
    $("ledgerBtnReclassify")?.addEventListener("click", () => {
      ledgerReclassifyOpen = true;
      renderDashLedger();
    });
    $("ledgerBtnAddEvidence")?.addEventListener("click", () => ledgerToast("증빙 추가 기능은 준비 중이에요."));
    $("ledgerLinkMissing")?.addEventListener("click", () => {
      ledgerFilter.evidence = "none";
      const sel = $("ledgerEvidenceFilter");
      if (sel) sel.value = "none";
      renderDashLedger();
    });
    $("ledgerBtnCloseMonth")?.addEventListener("click", () => ledgerToast("장부 마감 기능은 준비 중이에요."));
  }

  function openLedgerAddRow() {
    const body = $("ledgerTableBody");
    if (!body || $("ledgerAddRow")) return;
    const tr = document.createElement("tr");
    tr.id = "ledgerAddRow";
    tr.className = "ts-ledger-add-row";
    tr.innerHTML = `
      <td><input type="date" id="ledgerAddDate" value="2026-08-31" /></td>
      <td><input type="text" id="ledgerAddVendor" placeholder="거래처" /></td>
      <td><input type="text" id="ledgerAddDesc" placeholder="내용" /></td>
      <td><input type="number" id="ledgerAddAmount" placeholder="금액" /></td>
      <td>
        <select id="ledgerAddType">
          <option value="expense">지출</option>
          <option value="income">수입</option>
        </select>
      </td>
      <td>
        <select id="ledgerAddCategory">
          <option value="재료비">재료비</option>
          <option value="인건비">인건비</option>
          <option value="임차료">임차료</option>
          <option value="공과금">공과금</option>
          <option value="광고비">광고비</option>
          <option value="배달매출">배달매출</option>
          <option value="카드매출">카드매출</option>
          <option value="기타">기타</option>
        </select>
      </td>
      <td colspan="2"><button class="ts-ledger-add-save" type="button" id="ledgerAddSave">등록</button></td>
    `;
    body.insertBefore(tr, body.firstChild);
    $("ledgerAddVendor")?.focus();

    $("ledgerAddSave")?.addEventListener("click", () => {
      const vendor = $("ledgerAddVendor")?.value.trim();
      const amountRaw = Number($("ledgerAddAmount")?.value || 0);
      if (!vendor || !amountRaw) {
        ledgerToast("거래처와 금액을 입력해주세요.");
        return;
      }
      const type = $("ledgerAddType")?.value || "expense";
      const custom = getLedgerCustom();
      custom.push({
        id: `custom_${Date.now()}`,
        date: $("ledgerAddDate")?.value || "2026-08-31",
        vendor,
        desc: $("ledgerAddDesc")?.value.trim() || "직접 등록 거래",
        amount: type === "income" ? Math.abs(amountRaw) : -Math.abs(amountRaw),
        type,
        category: $("ledgerAddCategory")?.value || "기타",
        evidence: null,
        method: "직접 등록",
        status: "review",
        taxNote: "직접 등록된 거래입니다.",
        aiNote: "사장님이 직접 등록한 거래로, 아직 AI 분류 검토 전입니다.",
      });
      setLedgerCustom(custom);
      ledgerToast("거래가 등록됐어요.");
      renderDashLedger();
    });
  }

  // ---------------------------------------------------------------------
  // 세금 신고 (Tax Filing)
  // ---------------------------------------------------------------------
  function ddayText(target) {
    const today = new Date();
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diff = Math.round((target - t0) / 86400000);
    return diff <= 0 ? "D-DAY" : `D-${diff}`;
  }
  function fmtMD(d) { return `${d.getMonth() + 1}월 ${d.getDate()}일`; }
  function daysUntil(target) {
    const today = new Date();
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((target - t0) / 86400000);
  }

  function nextVatFiling(now) {
    const y = now.getFullYear();
    const list = [
      { date: new Date(y, 0, 25), label: "부가가치세 확정신고 (2기)" },
      { date: new Date(y, 3, 25), label: "부가가치세 예정신고 (1기)" },
      { date: new Date(y, 6, 25), label: "부가가치세 확정신고 (1기)" },
      { date: new Date(y, 9, 25), label: "부가가치세 예정신고 (2기)" },
      { date: new Date(y + 1, 0, 25), label: "부가가치세 확정신고 (2기)" },
    ];
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return list.find((x) => x.date.getTime() >= today.getTime());
  }
  function nextIncomeTaxFiling(now) {
    const y = now.getFullYear();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d = new Date(y, 4, 31);
    return { date: d.getTime() >= today.getTime() ? d : new Date(y + 1, 4, 31), label: "종합소득세 확정신고" };
  }
  function nextWithholdingFiling(now) {
    const y = now.getFullYear(), m = now.getMonth();
    const today = new Date(y, m, now.getDate());
    let d = new Date(y, m, 10);
    if (d.getTime() < today.getTime()) d = new Date(y, m + 1, 10);
    return { date: d, label: "원천세 신고 (급여 지급분)" };
  }

  function renderDashTaxFiling() {
    if (!$("dashTaxView")) return;
    const analysis = lastResponse?.analysis || null;
    const tb = analysis?.tax_brief || {};
    const now = new Date();

    const vatMonth = safeNumber(tb?.vat?.due_month || 0);
    const incomeYearCombined = safeNumber(tb?.income_tax?.due_year || 0);
    const annualTotal = safeNumber(tb?.vat?.due_year || 0) + incomeYearCombined;

    const rows = ledgerAllRows();
    const missingCount = rows.filter((r) => !r.evidence).length;
    const reviewRows = rows.filter((r) => !r.evidence || r.status === "review");
    const oppEligible = (Array.isArray(lastV2Data?.opportunities) ? lastV2Data.opportunities : [])
      .filter((o) => o.category === "절세 기회" && o.eligible);
    const oppCredit = oppEligible.reduce((s, o) => s + (o.expected_credit || 0), 0);
    const hasData = !!(analysis && Array.isArray(v2LastMonthly) && v2LastMonthly.length);

    const checklist = [
      { ok: hasData, label: "매출·비용 자료 확인", note: hasData ? "확인 완료" : "데이터 입력 필요" },
      { ok: missingCount === 0, label: "증빙 자료 첨부", note: missingCount === 0 ? "확인 완료" : `${missingCount}건 미첨부` },
      { ok: oppEligible.length === 0, label: "공제 항목 검토", note: oppEligible.length === 0 ? "확인 완료" : `${oppEligible.length}건 검토 필요` },
      { ok: false, label: "신고서 제출", note: "홈택스에서 제출" },
    ];
    const readyCount = checklist.filter((c) => c.ok).length;
    const readyPct = Math.round((readyCount / checklist.length) * 100);

    // 상단 요약
    const summaryEl = $("taxSummaryLine");
    if (summaryEl) {
      summaryEl.innerHTML = annualTotal > 0
        ? `예상 세금(연) <b>${fmtWonFull(annualTotal)}</b><span class="sep">·</span>확인 필요 <b class="${reviewRows.length ? "warn" : ""}">${reviewRows.length}건</b><span class="sep">·</span>신고 준비도 <b>${readyPct}%</b>`
        : `계산 후 표시됩니다.`;
    }

    // 메인 CTA: 가장 임박한 신고
    const vatNext = nextVatFiling(now);
    const incomeNext = nextIncomeTaxFiling(now);
    const nearest = vatNext.date.getTime() <= incomeNext.date.getTime() ? vatNext : incomeNext;
    const isVat = nearest === vatNext;
    const ctaAmount = isVat ? vatMonth * 3 : incomeYearCombined;
    const ctaBox = $("taxCtaCard");
    if (ctaBox) {
      ctaBox.innerHTML = `
        <div class="ts-tax-cta-dday"><span class="n">${escapeHtml(ddayText(nearest.date))}</span><span class="l">${fmtMD(nearest.date)}</span></div>
        <div class="ts-tax-cta-body">
          <div class="ts-tax-cta-title">가장 먼저 해야 할 신고: ${escapeHtml(nearest.label)}</div>
          <div class="ts-tax-cta-sub">신고 전에 빠진 자료와 놓친 공제를 TS가 먼저 확인해드립니다.</div>
          <div class="ts-tax-cta-amt">${ctaAmount > 0 ? `예상 납부세액 ${fmtWonFull(ctaAmount)}` : "계산 후 표시됩니다."}</div>
        </div>
        <button class="ts-tax-cta-btn" type="button" id="taxBtnPrepare">신고 준비하기</button>
      `;
      $("taxBtnPrepare")?.addEventListener("click", () => {
        $("taxChecklist")?.closest(".report-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    // 신고 준비 체크리스트
    const checklistBox = $("taxChecklist");
    if (checklistBox) {
      checklistBox.innerHTML = checklist.map((c) => `
        <div class="ts-tax-check-item">
          <span class="dot ${c.ok ? "ok" : "warn"}">${c.ok ? "✓" : "!"}</span>
          <span style="flex:1;">${escapeHtml(c.label)}</span>
          <span style="color:var(--muted);">${escapeHtml(c.note)}</span>
        </div>
      `).join("");
    }

    // TS가 찾은 절세 공제 (Before/After)
    const oppBox = $("taxOppBox");
    if (oppBox) {
      if (oppEligible.length === 0 || annualTotal <= 0) {
        oppBox.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      } else {
        const after = Math.max(0, annualTotal - oppCredit);
        const top = oppEligible[0];
        oppBox.innerHTML = `
          <div class="ts-tax-ba">
            <div class="ts-tax-ba-col"><div class="l">공제 반영 전</div><div class="v">${fmtWonFull(annualTotal)}</div></div>
            <div class="ts-tax-ba-arrow">→</div>
            <div class="ts-tax-ba-col after"><div class="l">공제 반영 후</div><div class="v">${fmtWonFull(after)}</div></div>
          </div>
          <div class="ts-tax-ba-note">${oppEligible.length}건의 공제로 연 ${fmtWonFull(oppCredit)} 절세 가능 · ${escapeHtml(top?.title || "")}</div>
        `;
      }
    }

    // 신고 전 확인이 필요해요
    const reviewBox = $("taxReviewList");
    if (reviewBox) {
      const top5 = [...reviewRows].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
      if (top5.length === 0) {
        reviewBox.innerHTML = `<div class="empty-note">확인이 필요한 거래가 없습니다.</div>`;
      } else {
        reviewBox.innerHTML = top5.map((r) => `
          <div class="ts-tax-review-row">
            <span>${escapeHtml(r.vendor)} · ${escapeHtml(r.desc)}</span>
            <span class="amt">${fmtWonFull(Math.abs(r.amount))}</span>
          </div>
        `).join("") + `<button class="ts-ledger-side-link" type="button" id="taxBtnGoLedger" style="margin-top:10px;">장부 관리에서 전체 보기 →</button>`;
        $("taxBtnGoLedger")?.addEventListener("click", () => goDashNav("ledger"));
      }
    }

    // 간이과세자 ↔ 일반과세자 전환 시뮬레이션
    const simBox = $("taxTypeSimBox");
    if (simBox) {
      const sim = lastResponse?.result?.tax_estimate?.breakdown?.taxpayer_type_simulation;
      if (!sim) {
        simBox.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      } else {
        const typeLabel = (t) => (t === "SIMPLE" ? "간이과세자" : "일반과세자");
        const currentYear = safeNumber(sim.current_vat_due_year);
        const altYear = safeNumber(sim.alt_vat_due_year);
        const diff = altYear - currentYear;
        const better = diff < 0;
        simBox.innerHTML = `
          <div class="ts-tax-ba">
            <div class="ts-tax-ba-col"><div class="l">현재: ${escapeHtml(typeLabel(sim.current_type))}</div><div class="v">${fmtWonFull(currentYear)}</div></div>
            <div class="ts-tax-ba-arrow">vs</div>
            <div class="ts-tax-ba-col ${better ? "after" : ""}"><div class="l">${escapeHtml(typeLabel(sim.alt_type))}라면</div><div class="v">${fmtWonFull(altYear)}</div></div>
          </div>
          <div class="ts-tax-ba-note">
            ${diff === 0
              ? "두 유형의 연 부가세 부담이 동일하게 추정됩니다."
              : better
                ? `${escapeHtml(typeLabel(sim.alt_type))}였다면 연 부가세를 약 ${fmtWonFull(Math.abs(diff))} 더 적게 낼 것으로 추정됩니다.`
                : `${escapeHtml(typeLabel(sim.alt_type))}였다면 연 부가세를 약 ${fmtWonFull(Math.abs(diff))} 더 많이 낼 것으로 추정됩니다. 현재 ${escapeHtml(typeLabel(sim.current_type))} 분류가 유리합니다.`
            }
          </div>
          <div class="ts-tax-ba-note" style="margin-top:6px; opacity:.7;">※ 실제 과세유형은 직전연도 매출 기준으로 법적으로 결정되며, 전환 시 매입세액공제 방식도 함께 바뀝니다. 참고용 추정치입니다.</div>
        `;
      }
    }

    // 신고 자료 준비
    const docsBox = $("taxDocsList");
    if (docsBox) {
      const docs = [
        { ok: hasData, label: "매출 자료 (카드·현금영수증 정산내역)" },
        { ok: missingCount === 0, label: "증빙 자료 (세금계산서·영수증)" },
        { ok: true, label: "인건비 자료 (급여대장·원천세)" },
      ];
      docsBox.innerHTML = docs.map((d) => `
        <div class="ts-tax-check-item">
          <span class="dot ${d.ok ? "ok" : "warn"}">${d.ok ? "✓" : "!"}</span>
          <span>${escapeHtml(d.label)}</span>
        </div>
      `).join("");
    }

    // 신고 일정
    const scheduleBox = $("taxScheduleList");
    if (scheduleBox) {
      const items = [vatNext, incomeNext, nextWithholdingFiling(now)].sort((a, b) => a.date - b.date);
      scheduleBox.innerHTML = items.map((it) => {
        const d = daysUntil(it.date);
        return `
          <div class="ts-tax-schedule-row">
            <span>${escapeHtml(it.label)}</span>
            <span>${fmtMD(it.date)}</span>
            <span class="ts-tax-schedule-dday ${d <= 14 ? "soon" : ""}">${escapeHtml(ddayText(it.date))}</span>
          </div>
        `;
      }).join("");
    }

    // 신고 이력
    const histBody = $("taxHistoryBody");
    if (histBody) {
      histBody.innerHTML = `
        <tr><td>부가가치세 예정신고 (1기)</td><td>2026.01 ~ 03</td><td><span class="ts-home-hist-status">완료</span></td></tr>
        <tr><td>부가가치세 확정신고 (1기)</td><td>2026.04 ~ 06</td><td><span class="ts-home-hist-status">완료</span></td></tr>
        <tr><td>종합소득세 확정신고</td><td>2025년 귀속</td><td><span class="ts-home-hist-status">완료</span></td></tr>
      `;
    }
  }

  // ---------------------------------------------------------------------
  // 절세 도우미 (Tax-Saving Helper)
  // ---------------------------------------------------------------------
  const saveSimCheckedIds = new Set();
  const saveSimSeenIds = new Set();

  function difficultyOf(o) {
    return o.applicability === "적용 가능성 높음" ? "쉬움" : "보통";
  }

  function getSaveScenarios() {
    try { return JSON.parse(localStorage.getItem(LS_SAVE_SCENARIOS_KEY) || "[]"); } catch { return []; }
  }
  function setSaveScenarios(arr) { localStorage.setItem(LS_SAVE_SCENARIOS_KEY, JSON.stringify(arr)); }

  function getEvidenceReminder() {
    try { return JSON.parse(localStorage.getItem(LS_EVIDENCE_REMINDER_KEY) || "{}"); } catch { return {}; }
  }
  function setEvidenceReminder(obj) { localStorage.setItem(LS_EVIDENCE_REMINDER_KEY, JSON.stringify(obj)); }

  function todayStrLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function checkEvidenceReminder(missingCount) {
    const pref = getEvidenceReminder();
    if (!pref.enabled || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (missingCount <= 0) return;
    if (pref.lastShownDate === todayStrLocal()) return;

    try {
      const n = new Notification("TS · 증빙 누락 알림", {
        body: `장부에서 증빙이 빠진 거래가 ${missingCount}건 있어요. 확인해보세요.`,
      });
      n.onclick = () => { window.focus(); };
    } catch (e) {
      console.warn("[TS] notification failed:", e);
    }
    setEvidenceReminder({ ...pref, lastShownDate: todayStrLocal() });
  }

  function renderEvidenceReminderBtn() {
    const btn = $("saveEvidenceReminderBtn");
    if (!btn) return;
    const pref = getEvidenceReminder();
    const enabled = !!pref.enabled && typeof Notification !== "undefined" && Notification.permission === "granted";
    btn.textContent = enabled ? "🔔 알림 켜짐" : "🔕 알림 받기";
  }

  function toggleEvidenceReminder() {
    if (typeof Notification === "undefined") {
      ledgerToast("이 브라우저는 알림을 지원하지 않아요.");
      return;
    }
    if (Notification.permission === "granted") {
      const cur = getEvidenceReminder();
      const next = !cur.enabled;
      setEvidenceReminder({ ...cur, enabled: next });
      ledgerToast(next ? "증빙 누락 알림을 켰어요." : "증빙 누락 알림을 껐어요.");
      renderDashSaveHelper();
      return;
    }
    if (Notification.permission === "denied") {
      ledgerToast("브라우저 알림 권한이 차단되어 있어요. 브라우저 설정에서 허용해주세요.");
      return;
    }
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") {
        setEvidenceReminder({ enabled: true, lastShownDate: null });
        ledgerToast("증빙 누락 알림을 켰어요.");
      } else {
        ledgerToast("알림 권한이 허용되지 않았어요.");
      }
      renderDashSaveHelper();
    });
  }

  function renderDashSaveHelper() {
    if (!$("dashSaveView")) return;
    const analysis = lastResponse?.analysis || null;
    const tb = analysis?.tax_brief || {};
    const annualTotal = safeNumber(tb?.vat?.due_year || 0) + safeNumber(tb?.income_tax?.due_year || 0);
    const hasData = !!(analysis && Array.isArray(v2LastMonthly) && v2LastMonthly.length);

    const rawOpps = Array.isArray(lastV2Data?.opportunities) ? lastV2Data.opportunities : [];
    const taxOpps = rawOpps.filter((o) => o.category === "절세 기회" && o.eligible);

    const rows = ledgerAllRows();
    const missingRows = rows.filter((r) => !r.evidence);
    const evidenceOpp = missingRows.length > 0 ? {
      opportunity_id: "EVIDENCE_GAP",
      title: "비용 증빙 보완",
      applicability: "증빙 확인 필요",
      isEvidence: true,
      expected_credit: Math.round(missingRows.reduce((s, r) => s + Math.abs(r.amount), 0) / 11),
      expected_credit_label: "증빙 보완 시 추가 매입세액공제 추정",
      why: `비용 인정 가능성이 있는 거래 ${missingRows.length}건이 확인되었습니다.`,
    } : null;

    const allOpps = [...taxOpps, ...(evidenceOpp ? [evidenceOpp] : [])]
      .sort((a, b) => (b.expected_credit || 0) - (a.expected_credit || 0));

    const totalSaveable = allOpps.reduce((s, o) => s + (o.expected_credit || 0), 0);

    // 히어로 요약
    const hero = $("saveHeroCard");
    if (hero) {
      hero.innerHTML = totalSaveable > 0 ? `
        <div class="ts-save-hero-label">연간 최대 절감 가능액</div>
        <div class="ts-save-hero-value">${fmtWonFull(totalSaveable)}</div>
        <div class="ts-save-hero-stats">
          <span>발견된 기회 <b>${allOpps.length}건</b></span>
          <span class="sep">·</span>
          <span>확인 필요 <b class="${missingRows.length ? "warn" : ""}">${missingRows.length}건</b></span>
        </div>
      ` : `<div class="empty-note">계산 후 표시됩니다.</div>`;
    }

    // TS가 찾은 절세 기회
    const oppList = $("saveOppList");
    if (oppList) {
      if (allOpps.length === 0) {
        oppList.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      } else {
        oppList.innerHTML = allOpps.map((o, i) => `
          <div class="ts-save-opp-card">
            <div class="ts-save-opp-top">
              <span class="ts-save-opp-rank">${i + 1}</span>
              <span class="ts-save-opp-title">${escapeHtml(o.title)}</span>
              <span class="ts-save-opp-diff">${o.isEvidence ? "보통" : escapeHtml(difficultyOf(o))}</span>
            </div>
            <div class="ts-save-opp-amt">${fmtWonFull(o.expected_credit)}</div>
            <div class="ts-save-opp-note">${escapeHtml(o.why || "")}</div>
            ${o.rule_meta ? `
              <details class="why-details">
                <summary>적용 근거 보기</summary>
                <div class="ts-ledger-detail-ai">
                  필요 증빙 ${escapeHtml(o.rule_meta.required_evidence)}<br/>
                  산식 ${escapeHtml(o.rule_meta.formula)} · 한도 ${escapeHtml(o.rule_meta.limit)}<br/>
                  기준일 ${escapeHtml(o.rule_meta.updated_at)}
                </div>
              </details>
            ` : ""}
          </div>
        `).join("");
      }
    }

    // 가장 큰 절세 기회 판단 (임계점 경제성 분석)
    const deemedOpp = taxOpps.find((o) => o.opportunity_id === "DEEMED_INPUT_VAT_CREDIT" && o.marginal_analysis);
    const thresholdCard = $("saveThresholdCard");
    const thresholdBox = $("saveThresholdBox");
    if (thresholdCard && thresholdBox) {
      thresholdCard.classList.toggle("hidden", !deemedOpp);
      if (deemedOpp) {
        const m = deemedOpp.marginal_analysis;
        thresholdBox.innerHTML = `
          <div class="ts-tax-ba">
            <div class="ts-tax-ba-col"><div class="l">가정 추가 매입액</div><div class="v">${fmtWonFull(m.extra_spend)}</div></div>
            <div class="ts-tax-ba-arrow">→</div>
            <div class="ts-tax-ba-col after"><div class="l">예상 추가 공제</div><div class="v">${fmtWonFull(m.extra_credit)}</div></div>
          </div>
          <div class="ts-tax-ba-note" style="color:#991b1b; font-weight:900;">${escapeHtml(m.verdict)}</div>
          <div class="ts-tax-ba-note">순효과 ${fmtWonFull(m.net_effect)} · 절세만을 목적으로 한 추가 지출은 권장하지 않습니다.</div>
        `;
      }
    }

    // 절세 시뮬레이션
    allOpps.forEach((o) => { if (!saveSimSeenIds.has(o.opportunity_id)) { saveSimSeenIds.add(o.opportunity_id); saveSimCheckedIds.add(o.opportunity_id); } });
    const simBox = $("saveSimBox");
    if (simBox) {
      if (allOpps.length === 0 || annualTotal <= 0) {
        simBox.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      } else {
        simBox.innerHTML = `
          <div class="ts-tax-ba">
            <div class="ts-tax-ba-col"><div class="l">현재 예상 세금</div><div class="v">${fmtWonFull(annualTotal)}</div></div>
            <div class="ts-tax-ba-arrow">→</div>
            <div class="ts-tax-ba-col after"><div class="l">공제 반영 후</div><div class="v" id="saveSimAfter"></div></div>
          </div>
          <div id="saveSimChecks" style="margin-top:6px;">
            ${allOpps.map((o) => `
              <label class="ts-tax-check-item" style="cursor:pointer;">
                <input type="checkbox" data-sim-id="${escapeHtml(o.opportunity_id)}" ${saveSimCheckedIds.has(o.opportunity_id) ? "checked" : ""} />
                <span style="flex:1;">${escapeHtml(o.title)} 적용</span>
                <span style="color:var(--good-text); font-weight:900;">-${fmtWonFull(o.expected_credit)}</span>
              </label>
            `).join("")}
          </div>
          <button class="ts-card-link" type="button" id="saveSimSaveBtn" style="margin-top:10px;">🔖 이 시나리오 저장하기 →</button>
        `;
        const updateSim = () => {
          const checkedTotal = allOpps
            .filter((o) => saveSimCheckedIds.has(o.opportunity_id))
            .reduce((s, o) => s + (o.expected_credit || 0), 0);
          const after = Math.max(0, annualTotal - checkedTotal);
          const afterEl = $("saveSimAfter");
          if (afterEl) afterEl.textContent = fmtWonFull(after);
        };
        simBox.querySelectorAll("[data-sim-id]").forEach((cb) => {
          cb.addEventListener("change", () => {
            const id = cb.getAttribute("data-sim-id");
            if (cb.checked) saveSimCheckedIds.add(id); else saveSimCheckedIds.delete(id);
            updateSim();
          });
        });
        updateSim();

        $("saveSimSaveBtn")?.addEventListener("click", () => {
          const checkedOpps = allOpps.filter((o) => saveSimCheckedIds.has(o.opportunity_id));
          if (checkedOpps.length === 0) {
            ledgerToast("적용할 절세 항목을 먼저 선택해주세요.");
            return;
          }
          const monthKey = String(inpMonth?.value || "").trim();
          const checkedTotal = checkedOpps.reduce((s, o) => s + (o.expected_credit || 0), 0);
          const scenario = {
            id: `scn_${Date.now()}`,
            month: monthKey || "-",
            savedAt: new Date().toISOString(),
            items: checkedOpps.map((o) => ({ title: o.title, amount: o.expected_credit || 0 })),
            total: checkedTotal,
          };
          const scenarios = getSaveScenarios().filter((s) => s.month !== monthKey);
          scenarios.unshift(scenario);
          setSaveScenarios(scenarios.slice(0, 24));
          ledgerToast(`${monthKey || "이번 달"} 절세 시나리오를 저장했어요.`);
          renderDashSaveHelper();
        });
      }
    }

    // 놓친 증빙 찾기
    renderEvidenceReminderBtn();
    checkEvidenceReminder(missingRows.length);
    const evBox = $("saveEvidenceList");
    if (evBox) {
      const top5 = [...missingRows].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
      if (top5.length === 0) {
        evBox.innerHTML = `<div class="empty-note">확인이 필요한 거래가 없습니다.</div>`;
      } else {
        evBox.innerHTML = top5.map((r) => `
          <div class="ts-tax-review-row">
            <span>${escapeHtml(r.vendor)} · ${escapeHtml(r.desc)}</span>
            <span>${fmtWonFull(Math.abs(r.amount))}</span>
          </div>
        `).join("") + `<button class="ts-ledger-side-link" type="button" id="saveBtnGoLedger" style="margin-top:10px;">증빙 확인하기 →</button>`;
        $("saveBtnGoLedger")?.addEventListener("click", () => goDashNav("ledger"));
      }
    }

    // 이번 달 절세 체크리스트
    const checklist = [
      { ok: hasData, label: "카드매출 자료 확인", note: hasData ? "확인 완료" : "데이터 입력 필요" },
      { ok: rows.filter((r) => r.status === "review").length === 0, label: "주요 비용 분류 완료", note: rows.filter((r) => r.status === "review").length === 0 ? "확인 완료" : `${rows.filter((r) => r.status === "review").length}건 확인 필요` },
      { ok: missingRows.length === 0, label: "증빙 누락 확인", note: missingRows.length === 0 ? "확인 완료" : `${missingRows.length}건 누락` },
      { ok: false, label: "세액공제 최종 확인", note: "확인 전" },
    ];
    const readyPct = Math.round((checklist.filter((c) => c.ok).length / checklist.length) * 100);
    const checklistBox = $("saveChecklist");
    if (checklistBox) {
      checklistBox.innerHTML = checklist.map((c) => `
        <div class="ts-tax-check-item">
          <span class="dot ${c.ok ? "ok" : "warn"}">${c.ok ? "✓" : "!"}</span>
          <span style="flex:1;">${escapeHtml(c.label)}</span>
          <span style="color:var(--muted);">${escapeHtml(c.note)}</span>
        </div>
      `).join("") + `<div class="ts-ledger-summary" style="margin-top:10px;">절세 준비도 <b>${readyPct}%</b></div>`;
    }
    if (hero && totalSaveable > 0) {
      const statsEl = hero.querySelector(".ts-save-hero-stats");
      if (statsEl) statsEl.innerHTML += `<span class="sep">·</span><span>절세 준비도 <b>${readyPct}%</b></span>`;
    }

    // 절세 이력 (저장된 시나리오 기반 — 실제 사용자가 "시나리오 저장"을 누른 기록만 표시)
    const savedScenarios = getSaveScenarios()
      .slice()
      .sort((a, b) => (a.month < b.month ? 1 : -1));
    const histBody = $("saveHistoryBody");
    if (histBody) {
      histBody.innerHTML = savedScenarios.length === 0
        ? `<tr><td colspan="3" class="empty-note" style="padding:14px;">아직 저장된 절세 시나리오가 없습니다. 위 "절세 시뮬레이션"에서 항목을 선택하고 저장해보세요.</td></tr>`
        : savedScenarios.map((s) => {
            const itemLabel = s.items.length <= 2
              ? s.items.map((it) => it.title).join(", ")
              : `${s.items[0].title} 외 ${s.items.length - 1}건`;
            return `<tr><td>${escapeHtml(s.month)}</td><td>${escapeHtml(itemLabel)}</td><td>${fmtWonFull(s.total)}</td></tr>`;
          }).join("");
    }
    const histSum = $("saveHistorySummary");
    if (histSum) {
      const cum = savedScenarios.reduce((s, h) => s + (h.total || 0), 0);
      histSum.textContent = savedScenarios.length === 0
        ? "아직 저장된 절세 기록이 없습니다."
        : `저장된 시나리오 절세 효과 합계 ${fmtWonFull(cum)}`;
    }
  }

  // ---------------------------------------------------------------------
  // 경영 리포트 (Management Report)
  // ---------------------------------------------------------------------
  function levelKoText(level, metric) {
    const v = String(level || "").toUpperCase();
    if (v === "GOOD") return "양호";
    if (v === "RISK") return "위험";
    if (v === "WARN") return metric === "PROFIT_RATIO" ? "개선 필요" : "주의";
    return "확인 필요";
  }
  function fmtPctSigned(n) {
    if (!Number.isFinite(n)) return "—";
    return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  }
  function reportDeltaChip(text, bad) {
    if (text === "—") return `<span class="ts-dash-kpi-delta flat">—</span>`;
    return `<span class="ts-dash-kpi-delta ${bad ? "risk" : "good"}">${escapeHtml(text)}</span>`;
  }

  function renderDashReport() {
    if (!$("dashReportView")) return;
    const analysis = lastResponse?.analysis || null;
    const data = lastV2Data;
    const monthly = Array.isArray(v2LastMonthly) ? v2LastMonthly : [];
    const cur = monthly[monthly.length - 1] || null;
    const prev = monthly.length >= 2 ? monthly[monthly.length - 2] : null;

    const dateEl = $("reportDateBadge");
    if (dateEl) {
      const m = String(inpMonth?.value || "").match(/^(\d{4})-(\d{2})$/);
      dateEl.textContent = m ? `${m[1]}년 ${Number(m[2])}월` : "-";
    }

    const emptyIds = [
      "reportHeadlineCard", "reportChangeList", "reportFlowBox",
      "reportBenchTable", "reportSimBox", "reportGoalList",
    ];
    if (!analysis || !cur) {
      emptyIds.forEach((id) => { const el = $(id); if (el) el.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`; });
      return;
    }

    const items = Array.isArray(analysis?.benchmarks?.items) ? analysis.benchmarks.items : [];
    const findItem = (metric) => items.find((x) => String(x?.metric) === metric);
    const laborItem = findItem("LABOR_RATIO");
    const materialItem = findItem("MATERIAL_RATIO");
    const profitItem = findItem("PROFIT_RATIO");

    const pctDelta = (a, b) => (b == null ? null : ((a - b) / (Math.abs(b) || 1)) * 100);
    const salesPct = pctDelta(cur.sales, prev?.sales);
    const costPct = pctDelta(cur.total_cost, prev?.total_cost);
    const profitPct = pctDelta(cur.profit, prev?.profit);

    // 헤드라인
    const head = $("reportHeadlineCard");
    if (head) {
      const headline = data?.top_change?.headline || (profitPct != null ? (profitPct >= 0 ? "수익성이 개선되고 있습니다." : "수익성이 악화되고 있습니다.") : "이번 달 분석이 완료됐습니다.");
      head.innerHTML = `
        <div class="ts-report-headline-text">${escapeHtml(headline)}</div>
        <div class="ts-report-headline-sub">
          매출 ${fmtPctSigned(salesPct)}<span class="sep">·</span>비용 ${fmtPctSigned(costPct)}<span class="sep">·</span>영업이익 ${fmtPctSigned(profitPct)}
        </div>
      `;
    }

    // 전월 대비 변화
    const changeList = $("reportChangeList");
    const changeNote = $("reportChangeNote");
    if (changeList) {
      const diagnosis = Array.isArray(data?.diagnosis) ? data.diagnosis : [];
      if (diagnosis.length === 0) {
        changeList.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      } else {
        changeList.innerHTML = diagnosis.map((d) => `
          <div class="ts-report-change-row">
            <span class="ts-report-change-ic">${d.icon || "•"}</span>
            <span class="ts-report-change-title">${escapeHtml(d.title)}</span>
            <span class="ts-report-change-val">${d.value_from ? `${escapeHtml(d.value_from)} → ` : ""}${escapeHtml(d.value_to || "")}</span>
          </div>
        `).join("");
      }
      if (changeNote) changeNote.textContent = diagnosis.find((d) => d.severity === "RED")?.ai_comment || diagnosis[0]?.ai_comment || "";
    }

    // 4. 이번 달 돈의 흐름
    const flowBox = $("reportFlowBox");
    if (flowBox) {
      const parts = [
        { label: "재료비", value: safeNumber(cur.material_cost), color: "#FF6B6B" },
        { label: "인건비", value: safeNumber(cur.labor_cost), color: "#1A6DFF" },
        { label: "임차료", value: safeNumber(cur.rent), color: "#16a34a" },
        { label: "기타비용", value: safeNumber(cur.other_cost), color: "#FFAB00" },
      ].filter((p) => p.value > 0);
      const sales = safeNumber(cur.sales);
      flowBox.innerHTML = `
        <div class="ts-report-flow-row"><span>매출</span><b>${fmtWonFull(sales)}</b></div>
        <div class="ts-report-flow-bar">
          ${parts.map((p) => `<span style="width:${sales > 0 ? (p.value / sales) * 100 : 0}%; background:${p.color};" title="${escapeHtml(p.label)}"></span>`).join("")}
        </div>
        <div class="ts-report-flow-legend">
          ${parts.map((p) => `<div class="ts-report-flow-item"><span><span class="dot" style="background:${p.color};"></span>${escapeHtml(p.label)}</span><b>${fmtWonFull(p.value)}</b></div>`).join("")}
        </div>
        <div class="ts-report-flow-row total"><span>남은 영업이익</span><b>${fmtWonFull(cur.profit)}</b></div>
      `;
    }

    // 5. 업종 Benchmark
    const benchBox = $("reportBenchTable");
    if (benchBox) {
      const rows = [laborItem, materialItem, profitItem].filter(Boolean);
      if (rows.length === 0) {
        benchBox.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      } else {
        benchBox.innerHTML = `
          <table class="ts-home-hist-table">
            <thead><tr><th>지표</th><th>우리 매장</th><th>업종 중앙값</th><th>평가</th></tr></thead>
            <tbody>
              ${rows.map((it) => `
                <tr>
                  <td>${escapeHtml(metricLabel(it.metric))}</td>
                  <td>${ratioToPercent(it.my_value)}</td>
                  <td>${ratioToPercent(it.p50)}</td>
                  <td>${escapeHtml(levelKoText(it.level, it.metric))}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `;
      }
    }

    // 개선 시뮬레이션
    const simBox = $("reportSimBox");
    if (simBox) {
      const options = data?.scenarios?.options || [];
      if (options.length === 0) {
        simBox.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      } else {
        const recommendedId = data?.scenarios?.recommended?.action_id;
        simBox.innerHTML = `
          <div class="ts-report-sim-base">현재 영업이익 <b>${fmtWonFull(data.scenarios.base_profit)}</b></div>
          <div class="ts-report-sim-row">
            ${options.map((o) => `
              <div class="ts-report-sim-card ${o.action_id === recommendedId ? "best" : ""}">
                <div class="lbl">${escapeHtml(o.label)}</div>
                <div class="val">${fmtWonFull(o.new_profit)}</div>
                <div class="delta">+${fmtWonFull(o.profit_delta)}</div>
              </div>
            `).join("")}
          </div>
          ${data.scenarios.recommendation_text ? `<div class="ts-tax-ba-note">${escapeHtml(data.scenarios.recommendation_text)}</div>` : ""}
        `;
      }
    }

    // 다음 달 목표
    const goalBox = $("reportGoalList");
    if (goalBox) {
      const goals = [laborItem, materialItem, profitItem].filter(Boolean).map((it) => ({
        label: metricLabel(it.metric),
        from: ratioToPercent(it.my_value),
        to: ratioToPercent(it.p50),
      }));
      goalBox.innerHTML = goals.length === 0
        ? `<div class="empty-note">계산 후 표시됩니다.</div>`
        : goals.map((g) => `
            <div class="ts-report-goal-row">
              <span>${escapeHtml(g.label)}</span>
              <span>${escapeHtml(g.from)} → <b>${escapeHtml(g.to)}</b></span>
            </div>
          `).join("");
    }

    // 최근 추이
    renderReportTrendChart(reportTrendMetric);
  }

  function renderReportTrendChart(metric) {
    reportTrendMetric = metric;
    const canvas = $("reportTrendCanvas");
    const emptyBox = $("reportTrendEmpty");
    const noteBox = $("reportTrendNote");
    if (!canvas) return;
    const monthly = Array.isArray(v2LastMonthly) ? v2LastMonthly : [];

    if (reportTrendChart) { reportTrendChart.destroy(); reportTrendChart = null; }

    if (monthly.length < 2 || typeof Chart === "undefined") {
      if (emptyBox) emptyBox.classList.remove("hidden");
      canvas.style.display = "none";
      if (noteBox) noteBox.textContent = "";
      return;
    }
    if (emptyBox) emptyBox.classList.add("hidden");
    canvas.style.display = "block";

    const specs = {
      sales: { label: "매출", data: monthly.map((m) => safeNumber(m.sales)), fmt: (v) => formatWon(v) + "원" },
      cost: { label: "비용", data: monthly.map((m) => safeNumber(m.total_cost)), fmt: (v) => formatWon(v) + "원" },
      profit: { label: "영업이익", data: monthly.map((m) => safeNumber(m.profit)), fmt: (v) => formatWon(v) + "원" },
      profit_ratio: { label: "이익률", data: monthly.map((m) => safeNumber(m.profit_ratio) * 100), fmt: (v) => v.toFixed(0) + "%" },
    };
    const spec = specs[metric] || specs.sales;

    reportTrendChart = new Chart(canvas, {
      type: "line",
      data: {
        labels: monthly.map((m) => m.month),
        datasets: [{
          label: spec.label,
          data: spec.data,
          borderColor: "#1A6DFF",
          backgroundColor: "rgba(26,109,255,.10)",
          fill: true,
          tension: 0.35,
          pointRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: spec.fmt } } },
      },
    });

    if (noteBox) {
      const first = spec.data[0];
      const last = spec.data[spec.data.length - 1];
      const trendUp = last >= first;
      noteBox.textContent = metric === "cost"
        ? (trendUp ? "최근 비용이 지속적으로 증가하고 있습니다." : "최근 비용이 안정적으로 관리되고 있습니다.")
        : (trendUp ? `${spec.label}은 최근 상승 추세입니다.` : `${spec.label}은 최근 하락 추세입니다.`);
    }
  }

  function renderSummaryFromResponse(resp) {
    lastResponse = resp;

    const kpi = resp?.kpi || {};
    const meta = resp?.meta || resp?.debug || {};
    const result = resp?.result || resp;

    sumSummary.textContent = "계산 완료";
    sumSave.textContent = resp?.saved ? "저장됨" : "-";
    sumScore.textContent = (kpi?.score_100 != null) ? String(kpi.score_100) : "-";
    sumGrade.textContent = (kpi?.grade != null) ? String(kpi.grade) : "-";

    const conf = (meta?.confidence != null) ? Number(meta.confidence) : null;
    sumConfidence.textContent =
      (conf != null && Number.isFinite(conf)) ? `${Math.round(conf * 100)}%` : "-";

    const insight =
      resp?.insight_summary ||
      resp?.insight?.summary ||
      result?.insight_summary ||
      "리포트를 확인해주세요.";
    sumInsight.textContent = String(insight);

    if (Array.isArray(resp?.insights) && resp.insights.length > 0) {
      const top = resp.insights[0];
      if (top?.title && top?.message) {
        sumInsight.textContent = `${top.title} — ${top.message}`;
      }
    }

    const tags =
      resp?.insight_tags ||
      resp?.insight?.tags ||
      result?.insight_tags ||
      ["ready"];
    setTags(tags);

    renderDashboardHome();
  }

  async function runCalc(forceMode = null) {
    clearError();

    const payload = buildPayload({ forceMode });
    prePayload.textContent = JSON.stringify(payload, null, 2);

    const err = validatePayload(payload);
    if (err) {
      showError(err);
      return;
    }

    const runId = `run_${Date.now()}`;
    sessionStorage.setItem("ts_last_run_id", runId);
    console.log("[TS] run start:", runId);

    btnRun.disabled = true;
    if (btnRunPro) btnRunPro.disabled = true;
    btnRun.textContent = forceMode === "pro" ? "정밀 계산 중…" : "계산 중…";
    if (btnRunPro) btnRunPro.textContent = "정밀 계산 중…";

    try {
      const base = getApiBase();
      let token = getToken();
      let url = `${base}${token ? "/api/v1/calc/run" : "/api/v1/calc/run-guest"}`;

      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      let res = await fetchWithRetry(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        cache: "no-store",
      });

      // 로그인 토큰이 만료/무효한 경우, 저장된 토큰을 지우고 게스트 계산으로 자동 재시도한다.
      if (res.status === 401 && token) {
        localStorage.removeItem(LS_TOKEN_KEY);
        token = "";
        url = `${base}/api/v1/calc/run-guest`;
        res = await fetchWithRetry(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
        });
      }

      const text = await res.text();
      let data = null;

      try {
        data = JSON.parse(text);
      } catch (_) {
        data = null;
      }

      console.log("[TS] fetch done:", runId, res.status);

      if (!res.ok) {
        const msg =
          data?.detail ||
          data?.message ||
          data?.error?.message ||
          `계산 API 오류 (${res.status}) — ${text.slice(0, 500)}`;
        console.error("[TS] calc api error:", msg, data, text);
        showError(msg);
        return;
      }

      if (!data) {
        console.error("[TS] response is not json:", text);
        showError(`서버 응답이 JSON이 아닙니다. 응답 본문: ${text.slice(0, 500)}`);
        return;
      }

      console.log("[TS] calc response:", runId, data);

      sessionStorage.setItem("ts_last_response_v1", JSON.stringify(data));

      try {
        await runV2Opportunity(payload);
      } catch (e) {
        console.warn("[TS] v2 opportunity fetch failed:", e);
      }

      setTab("result");

      sumSummary.textContent = "계산 완료";
      sumSave.textContent = data?.saved ? "저장됨" : "-";
      sumScore.textContent =
        data?.kpi?.score_100 != null ? String(data.kpi.score_100) : "-";
      sumGrade.textContent =
        data?.kpi?.grade != null ? String(data.kpi.grade) : "-";
      sumConfidence.textContent = "-";
      sumInsight.textContent = "응답 수신 완료";
      setTags(["response_ok", runId]);

      try {
        renderSummaryFromResponse(data);
        console.log("[TS] render success:", runId);
      } catch (renderErr) {
        console.error("[TS] render error:", renderErr, data);
        showError(`응답 렌더링 중 오류: ${renderErr?.message || renderErr}`);
      }
    } catch (e) {
      console.error("[TS] runCalc fatal error:", e);
      showError(`서버 연결이 불안정합니다. 잠시 후 다시 시도해주세요. (${e?.message || e})`);
    } finally {
      btnRun.disabled = false;
      if (btnRunPro) btnRunPro.disabled = false;
      btnRun.textContent = "일반 계산 실행";
      if (btnRunPro) btnRunPro.textContent = "정밀 계산 실행";
      console.log("[TS] run end");
    }
  }

  // ---------------------------------------------------------------------
  // 엑셀로 여러 달 한 번에 등록
  // ---------------------------------------------------------------------
  const inpExcelFile = $("inpExcelFile");
  const excelFileName = $("excelFileName");
  if (inpExcelFile && excelFileName) {
    inpExcelFile.addEventListener("change", () => {
      const f = inpExcelFile.files?.[0];
      excelFileName.textContent = f ? f.name : "선택된 파일 없음";
    });
  }
  const btnExcelPreview = $("btnExcelPreview");
  const excelImportError = $("excelImportError");
  const excelPreviewBox = $("excelPreviewBox");
  const excelPreviewSummary = $("excelPreviewSummary");
  const excelPreviewList = $("excelPreviewList");
  const btnExcelCancel = $("btnExcelCancel");
  const btnExcelCommit = $("btnExcelCommit");
  const excelCommitResultBox = $("excelCommitResultBox");

  // ============================================================
  // v2 Opportunity Finder / Action Simulator (기존 입력값 재사용)
  // ============================================================
  const fmtWonFull = (v) => (v == null ? "-" : `${Math.round(v).toLocaleString("ko-KR")}원`);
  let v2LastMonthly = null;

  function buildV2BusinessInfo(payload) {
    return {
      store_name: null,
      biz_type: "개인사업자",
      tax_type: payload.mode === "pro" && selTaxpayerGuess.value === "SIMPLE" ? "간이과세자" : "일반과세자",
      taxpayer_type: "PERSONAL",
      industry: "음식점업",
      industry_detail: String(payload.business_type_detail || "한식").replace(/^[^가-힣]*/, "").trim() || "한식",
      industry_key: "FOODSVC",
      prior_year_sales_vat_included: Number(payload.prior_year_sales_vat_included || 0),
      analysis_period_label: payload.month || null,
      region_code: payload.region_code || "ALL",
    };
  }

  function buildV2Monthly(payload) {
    const materialCost = Number(payload.material_cost_vat_included || 0);
    const rent = Number(payload.rent_cost_vat_included || 0);
    const other = Number(payload.other_cost_vat_included || 0);
    const detailedSum = materialCost + rent + other;
    const cost = Number(payload.cost_vat_included || 0);
    const fallbackMaterial = detailedSum > 0 ? materialCost : Math.round(cost * 0.6);
    const fallbackRent = detailedSum > 0 ? rent : Math.round(cost * 0.2);
    const fallbackOther = detailedSum > 0 ? other : Math.max(0, cost - fallbackMaterial - fallbackRent);

    return {
      month: payload.month || "2026-01",
      sales: Number(payload.revenue_vat_included || 0),
      material_cost: fallbackMaterial,
      labor_cost: Number(payload.labor_cost || 0),
      rent: fallbackRent,
      other_cost: fallbackOther,
      card_sales_amount: getWonInput(inpCardSalesAmount),
      cash_receipt_amount: getWonInput(inpCashReceiptSalesAmount),
      exempt_agri_purchase: Number(payload.purchase_exempt_agri_vat_exempt || 0),
      visit_count: parseInt(String(inpVisitCount?.value || "0").replace(/[^\d]/g, ""), 10) || 0,
    };
  }

  async function runV2Opportunity(payload) {
    const business_info = buildV2BusinessInfo(payload);
    const monthly = [buildV2Monthly(payload)];
    v2LastMonthly = monthly;

    const base = getApiBase();
    const res = await fetchWithRetry(`${base}/api/v2/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_info, monthly }),
    });
    if (!res.ok) {
      lastV2Data = null;
      renderDashboardHome();
      return;
    }
    const data = await res.json();
    lastV2Data = data;
    if (Array.isArray(data.monthly) && data.monthly.length) v2LastMonthly = data.monthly;
    renderDashboardHome();
  }

  // "샘플 데이터로 체험하기" 성격: 백엔드의 6개월치 샘플(성수한식당)을 그대로 가져와
  // 폼에서 만든 단일월 데이터 대신 진짜 추이가 있는 결과로 덮어씌운다.
  async function runV2Sample() {
    const base = getApiBase();
    const res = await fetchWithRetry(`${base}/api/v2/sample`, {});
    if (!res.ok) {
      lastV2Data = null;
      renderDashboardHome();
      return;
    }
    const data = await res.json();
    v2LastMonthly = data.monthly;
    lastV2Data = data;
    renderDashboardHome();
  }

  let excelValidPayloads = [];

  function showExcelImportError(msg) {
    if (!excelImportError) return;
    excelImportError.textContent = String(msg || "");
    excelImportError.classList.toggle("hidden", !msg);
  }

  function resetExcelPreview() {
    excelValidPayloads = [];
    excelPreviewBox?.classList.add("hidden");
    excelCommitResultBox?.classList.add("hidden");
    if (excelPreviewList) excelPreviewList.innerHTML = "";
    if (excelPreviewSummary) excelPreviewSummary.textContent = "";
    if (excelCommitResultBox) excelCommitResultBox.innerHTML = "";
    if (btnExcelCommit) btnExcelCommit.disabled = false;
  }

  function renderExcelPreview(data) {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    excelValidPayloads = rows.filter((r) => r.ok && r.payload).map((r) => r.payload);

    if (excelPreviewSummary) {
      excelPreviewSummary.textContent =
        `총 ${rows.length}행 중 저장 가능 ${data?.valid_count ?? excelValidPayloads.length}행, ` +
        `오류 ${data?.error_count ?? 0}행입니다. 아래 내용을 확인한 뒤 저장을 눌러주세요.`;
    }

    if (excelPreviewList) {
      excelPreviewList.innerHTML = rows.map((r) => {
        if (!r.ok) {
          return `
            <div class="excel-preview-row is-error">
              <span class="epr-month">${escapeHtml(String(r.row_index))}행</span>
              <span class="epr-detail">${escapeHtml(r.error || "오류")}</span>
            </div>`;
        }
        const p = r.payload || {};
        const detail =
          `매출 ${formatWon(p.revenue_vat_included)}원 · 비용 ${formatWon(p.cost_vat_included)}원` +
          (p.labor_cost ? ` · 인건비 ${formatWon(p.labor_cost)}원` : "");
        const tag = r.will_overwrite
          ? `<span class="epr-tag">기존 기록 덮어쓰기</span>`
          : `<span class="epr-tag">새로 저장</span>`;
        return `
          <div class="excel-preview-row${r.will_overwrite ? " is-overwrite" : ""}">
            <span class="epr-month">${escapeHtml(p.month || "-")}</span>
            <span class="epr-detail">${escapeHtml(detail)}</span>
            ${tag}
          </div>`;
      }).join("");
    }

    excelPreviewBox?.classList.remove("hidden");
    excelCommitResultBox?.classList.add("hidden");
    if (btnExcelCommit) btnExcelCommit.disabled = excelValidPayloads.length === 0;
  }

  btnExcelPreview?.addEventListener("click", async (e) => {
    e.preventDefault();
    showExcelImportError("");

    const file = inpExcelFile?.files?.[0];
    if (!file) {
      showExcelImportError("엑셀 파일을 먼저 선택해주세요.");
      return;
    }

    const token = getToken();
    if (!token) {
      showExcelImportError("로그인이 필요합니다.");
      return;
    }

    btnExcelPreview.disabled = true;
    btnExcelPreview.textContent = "미리보기 불러오는 중…";

    try {
      const base = getApiBase();
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(`${base}/api/v1/calc/import/preview`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: fd,
        cache: "no-store",
      });

      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) { data = null; }

      if (!res.ok) {
        const msg = data?.detail || `엑셀 미리보기 실패 (${res.status})`;
        showExcelImportError(msg);
        return;
      }
      if (!data) {
        showExcelImportError("서버 응답을 해석할 수 없습니다.");
        return;
      }

      renderExcelPreview(data);
    } catch (err) {
      console.error("[TS] excel preview error:", err);
      showExcelImportError("엑셀 미리보기 중 오류가 발생했습니다.");
    } finally {
      btnExcelPreview.disabled = false;
      btnExcelPreview.textContent = "엑셀 미리보기";
    }
  });

  btnExcelCancel?.addEventListener("click", (e) => {
    e.preventDefault();
    resetExcelPreview();
    if (inpExcelFile) inpExcelFile.value = "";
    if (excelFileName) excelFileName.textContent = "선택된 파일 없음";
  });

  btnExcelCommit?.addEventListener("click", async (e) => {
    e.preventDefault();
    showExcelImportError("");

    if (excelValidPayloads.length === 0) {
      showExcelImportError("저장할 수 있는 행이 없습니다.");
      return;
    }

    const token = getToken();
    if (!token) {
      showExcelImportError("로그인이 필요합니다.");
      return;
    }

    btnExcelCommit.disabled = true;
    btnExcelCommit.textContent = "저장 중…";

    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/v1/calc/import/commit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ rows: excelValidPayloads }),
        cache: "no-store",
      });

      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) { data = null; }

      if (!res.ok) {
        const msg = data?.detail || `저장 실패 (${res.status})`;
        showExcelImportError(msg);
        return;
      }
      if (!data) {
        showExcelImportError("서버 응답을 해석할 수 없습니다.");
        return;
      }

      const results = Array.isArray(data.results) ? data.results : [];
      if (excelCommitResultBox) {
        excelCommitResultBox.innerHTML =
          `<div class="empty-note">${data.saved_count ?? 0}건 저장 완료, ${data.failed_count ?? 0}건 실패</div>` +
          results.map((r) => `
            <div class="excel-commit-row ${r.ok ? "ok" : "fail"}">
              <span>${escapeHtml(r.month)}${r.overwritten ? " (덮어씀)" : ""}</span>
              <span>${r.ok ? "저장됨" : escapeHtml(r.error || "실패")}</span>
            </div>
          `).join("");
        excelCommitResultBox.classList.remove("hidden");
      }

      excelPreviewBox?.classList.add("hidden");
      btnExcelCommit.disabled = true;
    } catch (err) {
      console.error("[TS] excel commit error:", err);
      showExcelImportError("저장 중 오류가 발생했습니다.");
    } finally {
      btnExcelCommit.textContent = "확인한 내용대로 저장";
    }
  });

  btnRun.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    await runCalc("quick");
    return false;
  });

  btnRunPro?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    await runCalc("pro");
    return false;
  });

  window.addEventListener("error", (e) => {
    console.error("[TS] window error:", e.error || e.message || e);
  });

  window.addEventListener("unhandledrejection", (e) => {
    console.error("[TS] unhandled rejection:", e.reason || e);
  });

  window.addEventListener("beforeunload", () => {
    console.warn("[TS] beforeunload fired");
  });

  window.addEventListener("pageshow", () => {
    const lastRunId = sessionStorage.getItem("ts_last_run_id");
    if (lastRunId) {
      console.log("[TS] pageshow after run:", lastRunId);
    }
  });

  loadDraft();
  setMonthValue(inpMonth.value || "", { save: false });
  updateWizardSummary();
  ensureDynamicUi();
  renderDashboardHome();
  renderCostMismatchWarning();

  const lastRunId = sessionStorage.getItem("ts_last_run_id");
  const lastResponseRaw = sessionStorage.getItem("ts_last_response_v1");

  if (lastResponseRaw) {
    try {
      const restored = JSON.parse(lastResponseRaw);
      renderSummaryFromResponse(restored);
      setTab("result");
      console.log("[TS] restored cached response:", lastRunId || "no-run-id");
    } catch (e) {
      console.error("[TS] restore failed:", e);

      setTab("input");
      sumSummary.textContent = "계산 전";
      sumSave.textContent = "-";
      sumScore.textContent = "-";
      sumGrade.textContent = "-";
      sumConfidence.textContent = "-";
      sumInsight.textContent = "계산을 실행하면 표시됩니다.";
      setTags(["ready"]);
      prePayload.textContent = "{}";
    }
  } else {
    setTab("input");
    sumSummary.textContent = "계산 전";
    sumSave.textContent = "-";
    sumScore.textContent = "-";
    sumGrade.textContent = "-";
    sumConfidence.textContent = "-";
    sumInsight.textContent = "계산을 실행하면 표시됩니다.";
    setTags(["ready"]);
    prePayload.textContent = "{}";
  }
})();