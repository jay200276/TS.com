// frontend/member.js  (FULL REPLACE)
(() => {
  if (window.__TS_MEMBER_BOUND) return;
  window.__TS_MEMBER_BOUND = true;

  const $ = (id) => document.getElementById(id);

  const LS_TOKEN_KEY = "ts_access_token_v1";
  const LS_API_BASE_KEY = "ts_api_base_v1";
  const LS_MEMBER_DRAFT_KEY = "ts_member_calc_draft_v1";
  const LS_ACTION_CHECK_KEY = "ts_action_check_v1";

  const DEFAULT_API_BASE = (() => {
    const h = location.hostname;
    return (h === "localhost" || h === "127.0.0.1") ? "http://127.0.0.1:8000" : "";
  })();

  let benchShowAll = false;
  let benchChart = null;
  let financialChart = null;
  let historyTrendChart = null;
  let lastResponse = null;
  let lastRecords = [];
  let historySelectedMonth = "";
  let historyPickerYear = new Date().getFullYear();

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

  const preJson = $("preJson");
  const preMeta = $("preMeta");
  const prePayload = $("prePayload");
  const errorBox = $("errorBox");
  const errorText = $("errorText");

  const costMismatchBox = $("costMismatchBox");
  const costMismatchText = $("costMismatchText");

  const reportExecutive = $("reportExecutive");
  const reportTaxBrief = $("reportTaxBrief");
  const reportRisk = $("reportRisk");
  const reportActions = $("reportActions");

  const kpiCardsWrap = $("kpiCardsWrap");
  const benchmarkMeta = $("benchmarkMeta");
  const benchmarkTableBody = $("benchmarkTableBody");
  const metaAssumptions = $("metaAssumptions");
  const metaFailures = $("metaFailures");

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
      closeHistoryMonthPopover();
      closeCriteriaGuide();
      if (precisionOpen) closePrecisionWizard();
    }
  });

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    if (t.id === "btnHistoryCalendar" || t.closest("#btnHistoryCalendar")) {
      e.preventDefault();
      e.stopPropagation();
      toggleHistoryMonthPopover();
      return;
    }

    if (t.id === "btnHistoryPrevYear" || t.closest("#btnHistoryPrevYear")) {
      e.preventDefault();
      historyPickerYear -= 1;
      renderHistoryMonthPopover();
      return;
    }

    if (t.id === "btnHistoryNextYear" || t.closest("#btnHistoryNextYear")) {
      e.preventDefault();
      historyPickerYear += 1;
      renderHistoryMonthPopover();
      return;
    }

    if (t.id === "btnHistoryThis" || t.closest("#btnHistoryThis")) {
      e.preventDefault();
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      historySelectedMonth = `${yyyy}-${mm}`;
      if (lastResponse) renderHistoryComparison(lastResponse);
      closeHistoryMonthPopover();
      return;
    }

    if (t.id === "btnHistoryClear" || t.closest("#btnHistoryClear")) {
      e.preventDefault();
      historySelectedMonth = "";
      if (lastResponse) renderHistoryComparison(lastResponse);
      closeHistoryMonthPopover();
      return;
    }

    const pop = $("historyMonthPopover");
    if (pop && !pop.classList.contains("hidden") && !pop.contains(t)) {
      closeHistoryMonthPopover();
    }
  });

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

  function levelChipClass(level) {
    const v = String(level || "").toUpperCase();
    if (v === "GOOD" || v === "LOW") return "level-chip level-good";
    if (v === "WARN" || v === "MID") return "level-chip level-warn";
    if (v === "RISK" || v === "HIGH") return "level-chip level-risk";
    return "level-chip level-neutral";
  }

  function ensureDynamicUi() {
    if (!panelResult) return;

    const assumptionsCard = metaAssumptions?.closest(".meta-card");
    if (assumptionsCard) assumptionsCard.style.display = "none";

    const metaGrid = metaFailures?.closest(".meta-grid");
    const failuresCard = metaFailures?.closest(".meta-card");
    if (metaGrid) metaGrid.style.display = "none";
    if (failuresCard) {
      failuresCard.id = "failuresSection";
      failuresCard.style.marginTop = "12px";
      failuresCard.style.marginBottom = "0";
      panelResult.appendChild(failuresCard);
    }

    if (benchmarkMeta) {
      benchmarkMeta.textContent = "";
      benchmarkMeta.style.display = "none";
    }

    if (!$("riskBanner")) {
      const banner = document.createElement("div");
      banner.id = "riskBanner";
      banner.className = "risk-banner hidden";
      banner.innerHTML = `
        <span class="risk-banner-icon">⚠️</span>
        <div class="risk-banner-text">
          <div class="risk-banner-title" id="riskBannerTitle">-</div>
          <div class="risk-banner-detail" id="riskBannerDetail">-</div>
        </div>
      `;
      panelResult.insertBefore(banner, panelResult.firstElementChild);
    }

    if (!$("diagnosticSection")) {
      const diag = document.createElement("div");
      diag.id = "diagnosticSection";
      diag.style.display = "grid";
      diag.style.gridTemplateColumns = "1.1fr .9fr";
      diag.style.gap = "12px";
      diag.style.marginBottom = "12px";
      diag.innerHTML = `
        <div class="report-card">
          <h3>종합 진단</h3>
          <div id="diagnosisSummaryBox" class="empty-note">계산 후 표시됩니다.</div>
        </div>
        <div class="report-card">
          <h3>재무 구조 요약</h3>
          <div id="financialStructureBox" class="empty-note">계산 후 표시됩니다.</div>
        </div>
      `;
      const first = panelResult.firstElementChild;
      panelResult.insertBefore(diag, first);
    }

    if (!$("historySection")) {
      const card = document.createElement("div");
      card.id = "historySection";
      card.className = "report-card";
      card.style.marginBottom = "12px";
      card.innerHTML = `
        <div class="history-head"><div class="history-title-inline"><h3 style="margin:0;">이전 기록</h3></div><div class="history-month-control"><button id="btnHistoryCalendar" class="history-calendar-btn" type="button" title="이전 기록 조회">🗓️</button><div id="historyMonthPopover" class="history-month-popover hidden"><div class="history-month-popover-head"><button id="btnHistoryPrevYear" class="history-month-nav-btn" type="button" aria-label="이전 연도">‹</button><div id="historyMonthPopoverYear" class="history-month-popover-year">2026</div><button id="btnHistoryNextYear" class="history-month-nav-btn" type="button" aria-label="다음 연도">›</button></div><div id="historyMonthPopoverGrid" class="history-month-popover-grid"></div><div class="history-month-popover-foot"><button id="btnHistoryClear" class="history-month-foot-btn" type="button">지우기</button><button id="btnHistoryThis" class="history-month-foot-btn primary" type="button">이번 달</button></div></div></div></div>
        <div id="historyTrendWrap" style="margin-bottom:16px;">
          <div id="historyTrendEmpty" class="empty-note">2개월 이상 기록이 쌓이면 추이 차트가 표시됩니다.</div>
          <div id="historyTrendChartBox" style="height:220px; display:none;"><canvas id="historyTrendCanvas"></canvas></div>
        </div>
        <div id="historyCompareBox" class="empty-note">오른쪽 달력 버튼을 눌러 비교할 월을 선택해주세요.</div>
      `;
      panelResult.appendChild(card);
    }

    if (!$("chartSection")) {
      const chartWrap = document.createElement("div");
      chartWrap.id = "chartSection";
      chartWrap.style.marginBottom = "12px";

      const benchCard = document.createElement("div");
      benchCard.className = "report-card";
      benchCard.innerHTML = `
        <h3>핵심 Benchmark 비교</h3>
        <div style="height:300px;"><canvas id="benchChartCanvas"></canvas></div>
      `;

      chartWrap.appendChild(benchCard);

      const firstReportGrid = panelResult.querySelector(".report-grid");
      if (firstReportGrid) {
        panelResult.insertBefore(chartWrap, firstReportGrid);
      } else {
        panelResult.appendChild(chartWrap);
      }
    }

    if (!$("riskSummaryBox")) {
      const riskCard = reportRisk?.closest(".report-card");
      if (riskCard) {
        const box = document.createElement("div");
        box.id = "riskSummaryBox";
        box.style.marginBottom = "10px";
        riskCard.insertBefore(box, reportRisk);
      }
    }

    if (!$("actionProgressBox")) {
      const actionsCard = reportActions?.closest(".report-card");
      if (actionsCard) {
        const box = document.createElement("div");
        box.id = "actionProgressBox";
        box.style.marginTop = "10px";
        box.style.fontSize = "12px";
        box.style.fontWeight = "900";
        box.style.color = "rgba(11,18,32,.62)";
        actionsCard.appendChild(box);
      }
    }

    if (!$("benchmarkSummaryBox")) {
      const benchCard = benchmarkMeta?.closest(".benchmark-card") || benchmarkMeta?.closest(".report-card");
      if (benchCard && benchmarkMeta) {
        const box = document.createElement("div");
        box.id = "benchmarkSummaryBox";
        box.style.margin = "10px 0 12px";
        box.style.padding = "12px";
        box.style.borderRadius = "14px";
        box.style.background = "rgba(247,249,252,.9)";
        box.style.border = "1px solid rgba(15,23,42,.08)";
        benchmarkMeta.insertAdjacentElement("afterend", box);
      }
    }

    if (!$("benchmarkToggleBtn")) {
      const benchCard = benchmarkMeta?.closest(".benchmark-card") || benchmarkMeta?.closest(".report-card");
      const h3 = benchCard?.querySelector("h3");
      if (benchCard && h3) {
        const bar = document.createElement("div");
        bar.style.display = "flex";
        bar.style.justifyContent = "space-between";
        bar.style.alignItems = "center";
        bar.style.gap = "10px";
        h3.parentNode.insertBefore(bar, h3);
        bar.appendChild(h3);

        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.gap = "8px";
        wrap.style.alignItems = "center";

        const btn = document.createElement("button");
        btn.id = "benchmarkToggleBtn";
        btn.type = "button";
        btn.textContent = "전체 보기";
        btn.style.border = "1px solid rgba(15,23,42,.12)";
        btn.style.background = "rgba(255,255,255,.92)";
        btn.style.borderRadius = "999px";
        btn.style.padding = "8px 12px";
        btn.style.fontWeight = "900";
        btn.style.cursor = "pointer";
        btn.addEventListener("click", () => {
          benchShowAll = !benchShowAll;
          btn.textContent = benchShowAll ? "핵심만 보기" : "전체 보기";
          if (lastResponse) {
            renderBenchmarks(lastResponse.analysis || {});
            renderBenchmarkSummary(lastResponse.analysis || {});
            renderBenchmarkChart(lastResponse.analysis || {});
          }
        });
        wrap.appendChild(btn);

        const pdfBtn = document.createElement("button");
        pdfBtn.id = "btnExportPdf";
        pdfBtn.type = "button";
        pdfBtn.textContent = "PDF 저장";
        pdfBtn.style.border = "none";
        pdfBtn.style.background = "linear-gradient(135deg, #182459, #0E1638)";
        pdfBtn.style.color = "#fff";
        pdfBtn.style.borderRadius = "999px";
        pdfBtn.style.padding = "8px 12px";
        pdfBtn.style.fontWeight = "900";
        pdfBtn.style.cursor = "pointer";
        pdfBtn.addEventListener("click", () => exportPdfReport());
        wrap.appendChild(pdfBtn);

        bar.appendChild(wrap);
      }
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

  function renderDiagnosis(resp) {
    const box = $("diagnosisSummaryBox");
    if (!box) return;

    const analysis = resp?.analysis || {};
    const kpi = resp?.kpi || {};
    const meta = resp?.meta || {};
    const riskDrivers = Array.isArray(analysis?.risk?.drivers) ? analysis.risk.drivers : [];
    const v = getMonthlyValuesFromResponse(resp);
    const bench = analyzeBenchmarkHighlights(analysis);
    const hasBenchmark = Array.isArray(analysis?.benchmarks?.items) && analysis.benchmarks.items.length > 0;

    const sentences = [];
    const highOutlier = v.profitRatio <= -1 || v.totalCostRatio >= 2 || v.laborRatio >= 1;
    const seriousRisk = v.profitRatio < 0 || v.totalCostRatio >= 1 || v.laborRatio >= 0.4 || riskDrivers.length > 0;

    sentences.push(
      `종합점수 ${escapeHtml(kpi?.score_100 ?? "-")}점 · ${escapeHtml(kpi?.grade || "-")}등급 · ${escapeHtml(gradeTone(kpi?.grade))}`
    );

    if (highOutlier) {
      sentences.push(`수익 구조 매우 불안정 · 입력값 확인 필요`);
    } else if (v.profitRatio >= 0.15) {
      sentences.push(`월 추정 이익률 ${ratioToPercent(v.profitRatio)} · 안정적`);
    } else if (v.profitRatio >= 0.05) {
      sentences.push(`월 추정 이익률 ${ratioToPercent(v.profitRatio)} · 비용 구조 개선 여지`);
    } else if (v.profitRatio >= 0) {
      sentences.push(`월 추정 이익률 ${ratioToPercent(v.profitRatio)} · 낮음, 비용 통제 필요`);
    } else {
      sentences.push(`월 추정 이익률 ${ratioToPercent(v.profitRatio)} · 적자, 즉시 점검 필요`);
    }

    if (v.totalCostRatio >= 1) {
      sentences.push(`총비용 ${ratioToPercent(v.totalCostRatio)} · 매출 초과`);
    } else if (v.totalCostRatio >= 0.85) {
      sentences.push(`총비용 ${ratioToPercent(v.totalCostRatio)} · 부담 확대`);
    }

    if (v.laborRatio >= 1) {
      sentences.push(`인건비 ${ratioToPercent(v.laborRatio)} · 입력값 확인 필요`);
    } else if (v.laborRatio >= 0.4) {
      sentences.push(`인건비 ${ratioToPercent(v.laborRatio)} · 부담`);
    }

    if (bench.worst) {
      sentences.push(`최대 편차: ${metricLabel(bench.worst.metric)} ${ppText(bench.worst.diff_pp)}`);
    } else if (!hasBenchmark && seriousRisk) {
      sentences.push(`벤치마크 없음 · 입력값 기준 고위험 신호`);
    } else if (!hasBenchmark) {
      sentences.push(`벤치마크 데이터 없음`);
    }

    if (riskDrivers.length >= 3) {
      sentences.push(`핵심 리스크 ${riskDrivers.length}건 · 우선순위 액션 필요`);
    } else if (riskDrivers.length >= 1) {
      sentences.push(`핵심 리스크 ${riskDrivers.length}건`);
    } else if (seriousRisk) {
      sentences.push(`즉시 점검 필요 신호 있음`);
    } else {
      sentences.push(`이상 징후 크지 않음`);
    }

    sentences.push(`${confidenceText(meta?.confidence)}`);

    box.innerHTML = `
      <div class="block-sub" style="margin-bottom:10px; font-size:17px;">한눈에 보는 현재 상태</div>
      <div style="display:grid; gap:10px;">
        ${sentences.map((s) => `<div class="risk-block"><div class="block-sub" style="font-size:15px; line-height:1.6;">${escapeHtml(s)}</div></div>`).join("")}
      </div>
    `;
  }

  function renderFinancialStructure(resp) {
    const box = $("financialStructureBox");
    if (!box) return;

    const v = getMonthlyValuesFromResponse(resp);
    const segments = [
      { label: "원 비용", ratio: v.costRatio, amount: v.cost, icon: "₩", bg: "#ecd17a", chart: "#4C7BF0" },
      { label: "원 인건비", ratio: v.laborRatio, amount: v.labor, icon: "인", bg: "#efb2be", chart: "#EF6C86" },
      { label: "원 추정 이익", ratio: v.profitRatio, amount: v.profit, icon: "수", bg: "#c7d7ff", chart: "#F2B84B" }
    ];

    box.innerHTML = `
      <div class="financial-summary-card">
        <div class="financial-total-label">총 매출</div>
        <div class="financial-total-value">${formatWon(v.revenue)}원</div>
        <div class="financial-donut-row">
          <div class="financial-donut-wrap">
            <canvas id="financialDonutCanvas"></canvas>
            <div class="financial-donut-center">
              <div class="financial-donut-center-label">매출 구성</div>
              <div class="financial-donut-center-value">100%</div>
            </div>
          </div>
          <div class="financial-legend">
            ${segments.map((item) => `
              <div class="financial-legend-row">
                <span class="financial-legend-dot" style="background:${item.chart};"></span>
                <span>${escapeHtml(item.label)} ${ratioToPercent(item.ratio)}</span>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="financial-list">
          ${segments.map((item) => `
            <div class="financial-item">
              <div class="financial-icon" style="background:${item.bg};">${item.icon}</div>
              <div>
                <div class="financial-label">${escapeHtml(item.label)}</div>
                <div class="financial-sub">매출 대비 ${ratioToPercent(item.ratio)}</div>
              </div>
              <div class="financial-amount">${formatWon(item.amount)}원</div>
            </div>
          `).join("")}
        </div>
        <div class="financial-comment">ⓘ 수치는 입력값 기준 추정치입니다.</div>
      </div>
    `;

    const canvas = $("financialDonutCanvas");
    if (financialChart) {
      financialChart.destroy();
      financialChart = null;
    }
    if (canvas && typeof Chart !== "undefined") {
      financialChart = new Chart(canvas, {
        type: "doughnut",
        data: {
          labels: segments.map((s) => s.label),
          datasets: [{
            data: segments.map((s) => Math.max(0, s.ratio * 100)),
            backgroundColor: segments.map((s) => s.chart),
            borderWidth: 2,
            borderColor: "#ffffff"
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "72%",
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "rgba(15,23,42,0.92)",
              padding: 10,
              cornerRadius: 10,
              callbacks: {
                label: (context) => `${context.label}: ${context.formattedValue}%`
              }
            }
          }
        }
      });
    }
  }

  function renderExecutive(analysis) {
  const exec = analysis?.executive_summary;
  if (!exec || !Array.isArray(exec.summary) || exec.summary.length === 0) {
    reportExecutive.innerHTML = `<div class="empty-note">요약 리포트가 아직 없습니다.</div>`;
    return;
  }

  const headline = exec.headline ? `<div class="block-title">${escapeHtml(exec.headline)}</div>` : "";

  const filteredSummary = exec.summary.filter(
    (x) => !String(x || "").includes("공식 benchmark 비교를 수행했습니다")
  );

  const items = filteredSummary.map((x) => `<li>${escapeHtml(x)}</li>`).join("");

  reportExecutive.innerHTML = `${headline}<ul class="report-list">${items}</ul>`;
}

  function renderTaxBrief(analysis) {
    const tb = analysis?.tax_brief;
    if (!tb) {
      reportTaxBrief.innerHTML = `<div class="empty-note">세금 브리프가 아직 없습니다.</div>`;
      const signalBox = $("taxSignalBox");
      if (signalBox) signalBox.innerHTML = "";
      return;
    }

    const vatMonth = Number(tb?.vat?.due_month || 0);
    const vatYear = Number(tb?.vat?.due_year || 0);
    const incomeYear = Number(tb?.income_tax?.due_year || 0);
    const insuranceYear = Number(tb?.insurance?.employer_year || 0);
    reportTaxBrief.innerHTML = `
      <div class="brief-item">
        <div class="brief-k">월 부가세 추정</div>
        <div class="brief-v">${formatWon(vatMonth)}원</div>
      </div>
      <div class="brief-item">
        <div class="brief-k">연 부가세/납부 추정</div>
        <div class="brief-v">${formatWon(vatYear)}원</div>
      </div>
      <div class="brief-item">
        <div class="brief-k">연 소득세+지방세 추정</div>
        <div class="brief-v">${formatWon(incomeYear)}원</div>
      </div>
      <div class="brief-item">
        <div class="brief-k">연 4대보험 사업주부담 추정</div>
        <div class="brief-v">${formatWon(insuranceYear)}원</div>
      </div>
    `;

    renderTaxSignals(lastResponse || {});
  }

  function renderTaxSignals(resp) {
    const signalBox = $("taxSignalBox");
    if (!signalBox) return;

    const analysis = resp?.analysis || {};
    const tb = analysis?.tax_brief || {};

    const annualRevenue = safeNumber(resp?.result?.annualized?.revenue_vat_included || 0);
    const vatYear = safeNumber(tb?.vat?.due_year || 0);
    const incomeYear = safeNumber(tb?.income_tax?.due_year || 0);
    const insuranceYear = safeNumber(tb?.insurance?.employer_year || 0);
    const totalTaxBurden = vatYear + incomeYear + insuranceYear;

    if (!annualRevenue || annualRevenue <= 0) {
      signalBox.innerHTML = `<div class="empty-note">세금 부담 해석 정보가 아직 없습니다.</div>`;
      return;
    }

    const totalRatio = totalTaxBurden / annualRevenue;

    let tone = "관리 가능한 수준";
    if (totalRatio >= 0.18) tone = "부담 큼 · 납부 일정 관리 필요";
    else if (totalRatio >= 0.12) tone = "적지 않음 · 자금 계획 권장";

    signalBox.innerHTML = `
      <div class="brief-item">
        <div class="brief-k">연 부가세 추정</div>
        <div class="brief-v">${formatWon(vatYear)}원</div>
      </div>
      <div class="brief-item">
        <div class="brief-k">연 소득세+지방세 추정</div>
        <div class="brief-v">${formatWon(incomeYear)}원</div>
      </div>
      <div class="brief-item">
        <div class="brief-k">연 사업주 보험부담 추정</div>
        <div class="brief-v">${formatWon(insuranceYear)}원</div>
      </div>
      <div class="brief-item">
        <div class="brief-k">연 총 세부담 추정</div>
        <div class="brief-v">${formatWon(totalTaxBurden)}원</div>
      </div>
      <div class="block-sub" style="margin-top:8px;">${escapeHtml(tone)}</div>
    `;
  }

  function renderRisk(analysis) {
    const drivers = analysis?.risk?.drivers;
    const riskSummaryBox = $("riskSummaryBox");
    const v = getMonthlyValuesFromResponse(lastResponse || {});

    if (!Array.isArray(drivers) || drivers.length === 0) {
      const fallback = [];
      if (v.profitRatio < 0) fallback.push({ title: "적자 구조 리스크", detail: `월 추정 이익률이 ${ratioToPercent(v.profitRatio)}로 음수입니다. 비용 구조를 다시 확인해 주세요.` });
      if (v.totalCostRatio >= 1) fallback.push({ title: "총비용 과다 리스크", detail: `총비용이 매출의 ${ratioToPercent(v.totalCostRatio)} 수준으로 계산되었습니다.` });
      if (v.laborRatio >= 0.4) fallback.push({ title: "인건비 부담 리스크", detail: `인건비가 매출의 ${ratioToPercent(v.laborRatio)}로 높게 나타났습니다.` });

      if (fallback.length === 0) {
        if (riskSummaryBox) {
          riskSummaryBox.innerHTML = `<div class="block-sub">현재 입력 기준 주요 리스크 없음</div>`;
        }
        reportRisk.innerHTML = `<div class="empty-note">현재 입력 기준으로 주요 리스크가 감지되지 않았습니다.</div>`;
        return;
      }

      if (riskSummaryBox) {
        riskSummaryBox.innerHTML = `
          <div class="brief-item">
            <div class="brief-k">감지 리스크 수</div>
            <div class="brief-v">${fallback.length}건</div>
          </div>
          <div class="brief-item">
            <div class="brief-k">중점 확인 필요</div>
            <div class="brief-v">${fallback.length}건</div>
          </div>
          <div class="block-sub" style="margin-top:8px;">가장 먼저 볼 항목: ${escapeHtml(fallback[0].title)}</div>
        `;
      }

      reportRisk.innerHTML = fallback.map((d) => `
        <div class="risk-block">
          <div class="block-title">${escapeHtml(d.title)}</div>
          <div class="block-sub">${escapeHtml(d.detail)}</div>
        </div>
      `).join("");
      return;
    }

    const highCount = drivers.filter((d) => {
      const txt = `${d?.title || ""} ${d?.detail || ""}`.toLowerCase();
      return txt.includes("즉시") || txt.includes("높") || txt.includes("위험") || txt.includes("리스크") || txt.includes("확인 필요");
    }).length;

    if (riskSummaryBox) {
      const top = drivers[0];
      riskSummaryBox.innerHTML = `
        <div class="brief-item">
          <div class="brief-k">감지 리스크 수</div>
          <div class="brief-v">${drivers.length}건</div>
        </div>
        <div class="brief-item">
          <div class="brief-k">중점 확인 필요</div>
          <div class="brief-v">${highCount}건</div>
        </div>
        <div class="block-sub" style="margin-top:8px;">
          가장 먼저 볼 항목: ${escapeHtml(top?.title || top?.code || "리스크")}
        </div>
      `;
    }

    reportRisk.innerHTML = drivers.map((d) => `
      <div class="risk-block">
        <div class="block-title">${escapeHtml(d?.title || d?.code || "리스크")}</div>
        <div class="block-sub">${escapeHtml(d?.detail || "-")}</div>
      </div>
    `).join("");
  }

  function renderRiskBanner(analysis) {
    const banner = $("riskBanner");
    if (!banner) return;

    const bench = analyzeBenchmarkHighlights(analysis);
    const worst = bench.worst;

    if (!worst) {
      banner.classList.add("hidden");
      return;
    }

    const titleEl = $("riskBannerTitle");
    const detailEl = $("riskBannerDetail");
    if (titleEl) titleEl.textContent = `가장 시급한 문제: ${metricLabel(worst.metric)} ${ratioToPercent(worst.my_value)}`;
    if (detailEl) detailEl.textContent = `중앙값 대비 ${ppText(worst.diff_pp)} · 우선 점검이 필요합니다.`;
    banner.classList.remove("hidden");
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

  function renderActions(analysis) {
    const actions = analysis?.actions;
    const actionSummaryBox = $("actionSummaryBox");

    if (!Array.isArray(actions) || actions.length === 0) {
      if (actionSummaryBox) {
        actionSummaryBox.innerHTML = `<div class="block-sub">현재 규칙 기준 실행 액션 없음</div>`;
      }
      reportActions.innerHTML = `<div class="empty-note">현재 규칙 기준으로 우선 실행 액션이 없습니다.</div>`;
      updateActionProgress();
      return;
    }

    const p1 = actions.filter((a) => String(a?.priority || "").toUpperCase() === "P1").length;
    const p2 = actions.filter((a) => String(a?.priority || "").toUpperCase() === "P2").length;
    const p3 = actions.filter((a) => String(a?.priority || "").toUpperCase() === "P3").length;
    const top = actions[0];

    if (actionSummaryBox) {
      actionSummaryBox.innerHTML = `
        <div class="action-stat-grid">
          <div class="action-stat-tile">
            <div class="action-stat-icon">📌</div>
            <div class="action-stat-value">${p1}건</div>
            <div class="action-stat-label">추천 실행</div>
          </div>
          <div class="action-stat-tile">
            <div class="action-stat-icon">⚡</div>
            <div class="action-stat-value">${p2}건</div>
            <div class="action-stat-label">즉시 개선</div>
          </div>
          <div class="action-stat-tile">
            <div class="action-stat-icon">🗂️</div>
            <div class="action-stat-value">${p3}건</div>
            <div class="action-stat-label">관리 과제</div>
          </div>
        </div>
      `;
    }

    const state = getActionCheckState();
    const deadlineTag = { P1: "7일", P2: "30일", P3: "90일" };

    const how = Array.isArray(top?.how) ? top.how : [];
    const key = actionKey(top);
    const priority = String(top?.priority || "P?").toUpperCase();
    const howHtml = how.length
      ? `<ul class="mini-list">${how.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
      : `<div class="block-sub">실행 방법 정보 없음</div>`;

    reportActions.innerHTML = `
      <div class="top-action-card">
        <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer;">
          <input type="checkbox" data-action-key="${escapeHtml(key)}" ${state[key] ? "checked" : ""} style="margin-top:3px;" />
          <div style="flex:1;">
            <span class="top-action-tag">[${escapeHtml(deadlineTag[priority] || "확인")}]</span>
            <span class="block-title">${escapeHtml(top?.title || "액션")}</span>
            <div class="block-sub" style="margin-top:6px;">${escapeHtml(top?.why || "-")}</div>
            ${howHtml}
          </div>
        </label>
      </div>
    `;

    bindActionCheckboxes();
  }

  function renderKpiCards(analysis) {
    const items = Array.isArray(analysis?.kpi_cards) ? analysis.kpi_cards : [];
    if (items.length === 0) {
      kpiCardsWrap.innerHTML = `
        <div class="report-card" style="grid-column:1/-1;">
          <div class="empty-note">KPI 카드가 아직 없습니다.</div>
        </div>
      `;
      return;
    }

    const badgeClass = (level) => {
      const v = String(level || "").toUpperCase();
      if (v === "GOOD") return "kpi-badge kpi-good";
      if (v === "WARN") return "kpi-badge kpi-warn";
      if (v === "RISK") return "kpi-badge kpi-risk";
      return "kpi-badge kpi-unknown";
    };

    const valueText = (item) => {
      if (item?.unit === "ratio") return ratioToPercent(item?.value);
      return String(item?.value ?? "-");
    };

    const commentText = (item) => {
      const metric = String(item?.code || "").toUpperCase();
      const raw = String(item?.comment || "").trim();
      if (!raw) return "-";
      if (
        ["MARGIN_RATIO", "TAX_BURDEN_RATIO"].includes(metric) &&
        raw.includes("공식 benchmark 데이터가 아직 연결되지 않아 현재 값만 표시합니다.")
      ) {
        return "";
      }
      return raw;
    };

    kpiCardsWrap.innerHTML = items.map((item) => `
      <div class="kpi-card">
        <div class="${badgeClass(item?.level)}">${escapeHtml(item?.level || "UNKNOWN")}</div>
        <div class="kpi-label">${escapeHtml(item?.label || item?.code || "KPI")}</div>
        <div class="kpi-value">${escapeHtml(valueText(item))}</div>
        <div class="kpi-comment">${escapeHtml(commentText(item))}</div>
      </div>
    `).join("");
  }

  function filteredBenchItems(items) {
    if (benchShowAll) return items;
    const core = ["COST_RATIO", "LABOR_RATIO", "MATERIAL_RATIO", "RENT_RATIO", "PROFIT_RATIO"];
    return items.filter((x) => core.includes(String(x?.metric || "")));
  }

  function renderBenchmarks(analysis) {
    const block = analysis?.benchmarks || {};
    const rawItems = Array.isArray(block?.items) ? block.items : [];
    const items = filteredBenchItems(rawItems);
    const v = getMonthlyValuesFromResponse(lastResponse || {});

    if (benchmarkMeta) {
      benchmarkMeta.textContent = "";
      benchmarkMeta.style.display = "none";
    }

    if (items.length === 0) {
      const reason = (v.profitRatio <= -1 || v.totalCostRatio >= 2 || v.laborRatio >= 1)
        ? "입력값이 일반적인 범위를 크게 벗어나 공식 비교가 제한되었을 가능성이 있습니다."
        : "현재 업종·지역·매출구간 조합에 해당하는 공식 비교 데이터가 아직 충분하지 않습니다.";
      benchmarkTableBody.innerHTML = `
        <tr>
          <td>공식 벤치마크 비교</td>
          <td colspan="6" class="empty-note" style="padding:14px; text-align:left;">
            제공되지 않음 · ${escapeHtml(reason)}<br>
            현재는 입력값 절대 기준 리스크 진단을 우선 제공합니다.
          </td>
        </tr>
      `;
      return;
    }

    benchmarkTableBody.innerHTML = items.map((item) => {
      const isRevenueMetric = String(item?.metric || "") === "AVG_REVENUE_ANNUAL";
      const valueCell = isRevenueMetric ? formatWon(item?.my_value || 0) + "원" : ratioToPercent(item?.my_value);
      const p50Cell = isRevenueMetric ? (item?.p50 != null ? `${formatWon(item.p50)}원` : "-") : ratioToPercent(item?.p50);
      const p25Cell = isRevenueMetric ? (item?.p25 != null ? `${formatWon(item.p25)}원` : "-") : ratioToPercent(item?.p25);
      const p75Cell = isRevenueMetric ? (item?.p75 != null ? `${formatWon(item.p75)}원` : "-") : ratioToPercent(item?.p75);
      const diffCell = isRevenueMetric ? "-" : ppText(item?.diff_pp);

      return `
        <tr>
          <td>${escapeHtml(metricLabel(item?.metric))}</td>
          <td>${escapeHtml(valueCell)}</td>
          <td>${escapeHtml(p50Cell)}</td>
          <td>${escapeHtml(p75Cell)}</td>
          <td>${escapeHtml(p25Cell)}</td>
          <td>${escapeHtml(diffCell)}</td>
          <td><span class="${levelChipClass(item?.level)}">${escapeHtml(item?.level || "UNKNOWN")}</span></td>
        </tr>
      `;
    }).join("");
  }

  function renderBenchmarkSummary(analysis) {
    const box = $("benchmarkSummaryBox");
    if (!box) return;

    const items = Array.isArray(analysis?.benchmarks?.items) ? analysis.benchmarks.items : [];
    const core = filteredBenchItems(items).filter((x) => Number.isFinite(Number(x?.diff_pp)));
    const v = getMonthlyValuesFromResponse(lastResponse || {});

    if (core.length === 0) {
      const seriousRisk = v.profitRatio < 0 || v.totalCostRatio >= 1 || v.laborRatio >= 0.4;
      box.innerHTML = `
        <div class="block-title" style="margin-bottom:8px;">벤치마크 해석</div>
        <ul class="report-list">
          <li>공식 벤치마크 비교는 제공되지 않았습니다.</li>
          <li>${escapeHtml(seriousRisk ? "다만 현재 입력값만으로도 적자 구조·비용 과다·인건비 부담 여부를 우선 해석할 수 있습니다." : "현재는 입력값 기준 해석을 우선 제공하며, 공식 데이터가 연결되면 비교 분석이 강화됩니다.")}</li>
        </ul>
      `;
      return;
    }

    const riskItems = core
      .filter((x) => String(x?.level || "").toUpperCase() === "RISK")
      .sort((a, b) => Math.abs(Number(b?.diff_pp || 0)) - Math.abs(Number(a?.diff_pp || 0)));

    const warnItems = core
      .filter((x) => String(x?.level || "").toUpperCase() === "WARN")
      .sort((a, b) => Math.abs(Number(b?.diff_pp || 0)) - Math.abs(Number(a?.diff_pp || 0)));

    const goodItems = core
      .filter((x) => String(x?.level || "").toUpperCase() === "GOOD")
      .sort((a, b) => Math.abs(Number(b?.diff_pp || 0)) - Math.abs(Number(a?.diff_pp || 0)));

    const lines = [];

    if (riskItems[0]) {
      lines.push(`우선 점검: ${metricLabel(riskItems[0].metric)} · 평균 대비 ${ppText(riskItems[0].diff_pp)}`);
    } else if (warnItems[0]) {
      lines.push(`${metricLabel(warnItems[0].metric)} 추가 관찰 필요, 그 외 평균 부근`);
    } else {
      lines.push(`핵심 지표 안정적`);
    }

    if (goodItems[0]) {
      lines.push(`강점: ${metricLabel(goodItems[0].metric)}`);
    }

    lines.push(`GOOD ${goodItems.length} · WARN ${warnItems.length} · RISK ${riskItems.length}`);

    box.innerHTML = `
      <div class="block-title" style="margin-bottom:8px;">벤치마크 해석</div>
      <ul class="report-list">
        ${lines.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}
      </ul>
    `;
  }

  function renderMeta(resp) {
    const meta = resp?.meta || {};
    const failures = Array.isArray(meta?.partial_failures) ? meta.partial_failures : [];

    if (metaAssumptions) metaAssumptions.innerHTML = "";

    metaFailures.innerHTML = failures.length
      ? failures.map((f) => `
          <div class="risk-block">
            <div class="block-title">${escapeHtml(f?.code || "PARTIAL_FAILURE")}</div>
            <div class="block-sub">${escapeHtml(f?.message || "-")}</div>
            ${f?.detail ? `<ul class="mini-list"><li>${escapeHtml(f.detail)}</li></ul>` : ""}
          </div>
        `).join("")
      : `<div class="empty-note">제한사항 / 부분 실패 없음</div>`;
  }

  function destroyCharts() {
    if (benchChart) {
      benchChart.destroy();
      benchChart = null;
    }
  }

  function renderBenchmarkChart(analysis) {
    const canvas = $("benchChartCanvas");
    if (!canvas || typeof Chart === "undefined") return;

    const raw = Array.isArray(analysis?.benchmarks?.items) ? analysis.benchmarks.items : [];
    const core = raw.filter((x) =>
      ["COST_RATIO", "LABOR_RATIO", "MATERIAL_RATIO", "RENT_RATIO", "PROFIT_RATIO"].includes(String(x?.metric || ""))
    );

    if (core.length === 0) return;

    benchChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: core.map((x) => metricLabel(x?.metric)),
        datasets: [
          {
            label: "내 값(%)",
            data: core.map((x) => Number(x?.my_value || 0) * 100),
            backgroundColor: "#1A6DFF",
            hoverBackgroundColor: "#3B82F6",
            borderColor: "#0F4FD6",
            borderWidth: 1,
            borderRadius: 8,
            borderSkipped: false,
            maxBarThickness: 42
          },
          {
            label: "평균(%)",
            data: core.map((x) => Number(x?.p50 || 0) * 100),
            backgroundColor: "#FF6B6B",
            hoverBackgroundColor: "#FF8787",
            borderColor: "#E04848",
            borderWidth: 1,
            borderRadius: 8,
            borderSkipped: false,
            maxBarThickness: 42
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false
        },
        animation: {
          duration: 700,
          easing: "easeOutQuart"
        },
        plugins: {
          legend: {
            display: true,
            labels: {
              usePointStyle: true,
              pointStyle: "rectRounded",
              padding: 16,
              color: "rgba(11,18,32,.72)",
              font: {
                weight: "700"
              }
            }
          },
          tooltip: {
            backgroundColor: "rgba(15,23,42,0.92)",
            titleColor: "#ffffff",
            bodyColor: "#e5e7eb",
            padding: 12,
            cornerRadius: 12,
            displayColors: true,
            callbacks: {
              label: (context) => `${context.dataset.label}: ${context.formattedValue}%`
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false,
              drawBorder: false
            },
            ticks: {
              color: "rgba(11,18,32,.72)",
              font: {
                weight: "700"
              }
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: "rgba(15,23,42,.08)",
              drawBorder: false
            },
            ticks: {
              color: "rgba(11,18,32,.58)",
              callback: (value) => `${value}%`
            }
          }
        }
      }
    });
  }

  function renderCharts(analysis) {
    destroyCharts();
    renderBenchmarkChart(analysis);
  }

  function buildPdfHtml(resp) {
    const analysis = resp?.analysis || {};
    const meta = resp?.meta || {};
    const assumptions = Array.isArray(meta?.assumptions) ? meta.assumptions : [];
    const failures = Array.isArray(meta?.partial_failures) ? meta.partial_failures : [];
    const kpis = Array.isArray(analysis?.kpi_cards) ? analysis.kpi_cards : [];
    const bench = Array.isArray(analysis?.benchmarks?.items) ? analysis.benchmarks.items : [];
    const risks = Array.isArray(analysis?.risk?.drivers) ? analysis.risk.drivers : [];
    const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
    const exec = Array.isArray(analysis?.executive_summary?.summary) ? analysis.executive_summary.summary : [];
    const tax = analysis?.tax_brief || {};
    const v = getMonthlyValuesFromResponse(resp);
    const kpi = resp?.kpi || {};
    const worst = analyzeBenchmarkHighlights(analysis).worst;

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

    const kpiHtml = kpis.length
      ? kpis.map((k) => `
          <div class="box" style="border-left:4px solid ${levelColor(k?.level)};">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <strong>${escapeHtml(k?.label || k?.code || "KPI")}</strong>
              ${levelBadge(k?.level)}
            </div>
            <div class="kpi-value">${escapeHtml(k?.unit === "ratio" ? ratioToPercent(k?.value) : String(k?.value ?? "-"))}</div>
            <div class="muted">${escapeHtml(k?.comment || "-")}</div>
          </div>
        `).join("")
      : "<p class=\"muted\">없음</p>";

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

    const riskHtml = risks.length
      ? risks.map((r) => `<li><strong>${escapeHtml(r?.title || r?.code || "리스크")}</strong> — ${escapeHtml(r?.detail || "-")}</li>`).join("")
      : "<li>현재 규칙 기준 주요 리스크 없음</li>";

    const priorityColor = { P1: "#dc2626", P2: "#b45309", P3: "#2563eb" };
    const actionHtml = actions.length
      ? actions.map((a) => {
          const pr = String(a?.priority || "P?").toUpperCase();
          const how = Array.isArray(a?.how) ? a.how : [];
          const howHtml = how.length ? `<ul>${how.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : "";
          return `
          <div class="box" style="border-left:4px solid ${priorityColor[pr] || "#64748b"};">
            <strong>[${escapeHtml(pr)}] ${escapeHtml(a?.title || "액션")}</strong>
            <div class="muted" style="margin-top:4px;">${escapeHtml(a?.why || "-")}</div>
            ${howHtml}
          </div>`;
        }).join("")
      : "<p class=\"muted\">현재 규칙 기준 실행 액션 없음</p>";

    const execHtml = exec.length
      ? `<ul>${exec.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
      : "<p class=\"muted\">없음</p>";

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

  <h2>요약 리포트</h2>
  ${execHtml}

  <h2>KPI 상세</h2>
  <div class="grid">${kpiHtml}</div>

  <h2>세금 브리프</h2>
  <div class="grid">
    <div class="box"><strong>월 부가세 추정</strong><div class="kpi-value">${formatWon(tax?.vat?.due_month || 0)}원</div></div>
    <div class="box"><strong>연 부가세/납부 추정</strong><div class="kpi-value">${formatWon(tax?.vat?.due_year || 0)}원</div></div>
    <div class="box"><strong>연 소득세+지방세 추정</strong><div class="kpi-value">${formatWon(tax?.income_tax?.due_year || 0)}원</div></div>
    <div class="box"><strong>연 4대보험 사업주부담 추정</strong><div class="kpi-value">${formatWon(tax?.insurance?.employer_year || 0)}원</div></div>
  </div>

  <h2>Benchmark 비교</h2>
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

  <div class="page-break"></div>

  <h2>리스크 드라이버</h2>
  <ul>${riskHtml}</ul>

  <h2>실행 액션</h2>
  ${actionHtml}

  <h2>가정</h2>
  ${assumptionHtml}

  <h2>제한사항 / 부분 실패</h2>
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

    const html = buildPdfHtml(lastResponse);
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

  async function fetchRecords() {
    try {
      const base = getApiBase();
      const token = getToken();
      if (!token) return [];

      const res = await fetch(`${base}/api/v1/records`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        cache: "no-store"
      });

      if (!res.ok) {
        console.warn("[TS] records fetch failed:", res.status);
        return [];
      }

      const data = await res.json();
      return Array.isArray(data?.items) ? data.items : [];
    } catch (e) {
      console.warn("[TS] records fetch error:", e);
      return [];
    }
  }

  function renderHistoryMonthPopover() {
    const grid = $("historyMonthPopoverGrid");
    const yearEl = $("historyMonthPopoverYear");
    if (!grid || !yearEl) return;

    yearEl.textContent = String(historyPickerYear);
    grid.innerHTML = "";

    const selected = String(historySelectedMonth || "");
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    for (let month = 1; month <= 12; month += 1) {
      const mm = String(month).padStart(2, "0");
      const raw = `${historyPickerYear}-${mm}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "history-month-popover-month";
      if (raw === selected) btn.classList.add("active");
      if (historyPickerYear === currentYear && month === currentMonth) btn.classList.add("current");
      btn.textContent = `${month}월`;
      btn.addEventListener("click", () => {
        historySelectedMonth = raw;
        if (lastResponse) renderHistoryComparison(lastResponse);
        closeHistoryMonthPopover();
      });
      grid.appendChild(btn);
    }
  }

  function openHistoryMonthPopover() {
    const pop = $("historyMonthPopover");
    if (!pop) return;
    const match = String(historySelectedMonth || "").match(/^(\d{4})-(\d{2})$/);
    historyPickerYear = match ? Number(match[1]) : new Date().getFullYear();
    renderHistoryMonthPopover();
    pop.classList.remove("hidden");
  }

  function closeHistoryMonthPopover() {
    $("historyMonthPopover")?.classList.add("hidden");
  }

  function toggleHistoryMonthPopover() {
    const pop = $("historyMonthPopover");
    if (!pop) return;
    if (pop.classList.contains("hidden")) openHistoryMonthPopover();
    else closeHistoryMonthPopover();
  }

  function monthlyProfitFromRecord(r) {
    const rev = Number(r?.revenue_vat_included || 0);
    const cost = Number(r?.cost_vat_included || 0);
    const labor = Number(r?.labor_cost || 0);
    return rev - cost - labor;
  }

  function deltaText(curr, prev) {
    const diff = Number(curr || 0) - Number(prev || 0);
    const sign = diff > 0 ? "+" : "";
    return `${sign}${formatWon(diff)}원`;
  }

  function ratioDeltaText(curr, prev) {
    const diff = (Number(curr || 0) - Number(prev || 0)) * 100;
    const sign = diff > 0 ? "+" : "";
    return `${sign}${diff.toFixed(1)}%p`;
  }

  function buildHistoryComment(curr, prev) {
    const currProfit = monthlyProfitFromRecord(curr);
    const prevProfit = monthlyProfitFromRecord(prev);

    const currCostRatio = Number(curr?.revenue_vat_included || 0) > 0
      ? (Number(curr?.cost_vat_included || 0) + Number(curr?.labor_cost || 0)) / Number(curr?.revenue_vat_included || 1)
      : 0;
    const prevCostRatio = Number(prev?.revenue_vat_included || 0) > 0
      ? (Number(prev?.cost_vat_included || 0) + Number(prev?.labor_cost || 0)) / Number(prev?.revenue_vat_included || 1)
      : 0;

    const currLaborRatio = Number(curr?.revenue_vat_included || 0) > 0
      ? Number(curr?.labor_cost || 0) / Number(curr?.revenue_vat_included || 1)
      : 0;
    const prevLaborRatio = Number(prev?.revenue_vat_included || 0) > 0
      ? Number(prev?.labor_cost || 0) / Number(prev?.revenue_vat_included || 1)
      : 0;

    const parts = [];

    if (currProfit > prevProfit) {
      parts.push("이전 기록 대비 추정 이익이 증가했습니다.");
    } else if (currProfit < prevProfit) {
      parts.push("이전 기록 대비 추정 이익이 감소했습니다.");
    } else {
      parts.push("이전 기록 대비 추정 이익은 유사합니다.");
    }

    if (currCostRatio < prevCostRatio) {
      parts.push("총비용률이 낮아져 수익성 측면에서 긍정적입니다.");
    } else if (currCostRatio > prevCostRatio) {
      parts.push("총비용률이 높아져 비용 구조 점검이 필요할 수 있습니다.");
    }

    if (currLaborRatio < prevLaborRatio) {
      parts.push("인건비율은 이전 기록보다 낮아졌습니다.");
    } else if (currLaborRatio > prevLaborRatio) {
      parts.push("인건비율은 이전 기록보다 높아졌습니다.");
    }

    if (currProfit < 0 && prevProfit >= 0) {
      parts.push("흑자 구조에서 적자 구조로 바뀐 것으로 보여 즉시 원가·인건비 점검이 필요합니다.");
    } else if (currProfit >= 0 && prevProfit < 0) {
      parts.push("직전 적자 구간에서 벗어난 점은 긍정적입니다.");
    }

    return parts.join(" ");
  }

  function renderHistoryTrend(records) {
    const emptyBox = $("historyTrendEmpty");
    const chartBox = $("historyTrendChartBox");
    const canvas = $("historyTrendCanvas");
    if (!emptyBox || !chartBox || !canvas) return;

    const rows = (Array.isArray(records) ? records : [])
      .filter((r) => r?.month)
      .slice()
      .sort((a, b) => String(a.month).localeCompare(String(b.month)));

    if (historyTrendChart) {
      historyTrendChart.destroy();
      historyTrendChart = null;
    }

    if (rows.length < 2 || typeof Chart === "undefined") {
      emptyBox.style.display = "block";
      chartBox.style.display = "none";
      return;
    }

    emptyBox.style.display = "none";
    chartBox.style.display = "block";

    const labels = rows.map((r) => String(r.month || "-"));
    const revenue = rows.map((r) => safeNumber(r?.revenue_vat_included || 0));
    const cost = rows.map((r) => safeNumber(r?.cost_vat_included || 0));
    const profit = rows.map((r) => safeNumber(r?.revenue_vat_included || 0) - safeNumber(r?.cost_vat_included || 0) - safeNumber(r?.labor_cost || 0));

    historyTrendChart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "매출",
            data: revenue,
            borderColor: "#4C7BF0",
            backgroundColor: "rgba(76,123,240,.10)",
            tension: 0.3,
            fill: true,
            pointRadius: 3
          },
          {
            label: "총비용",
            data: cost,
            borderColor: "#EF6C86",
            backgroundColor: "rgba(239,108,134,.08)",
            tension: 0.3,
            fill: false,
            pointRadius: 3
          },
          {
            label: "추정 이익",
            data: profit,
            borderColor: "#22A06B",
            backgroundColor: "rgba(34,160,107,.10)",
            tension: 0.3,
            fill: false,
            pointRadius: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: "easeOutQuart" },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            display: true,
            labels: { usePointStyle: true, pointStyle: "circle", padding: 14, color: "rgba(11,18,32,.72)", font: { weight: "700" } }
          },
          tooltip: {
            backgroundColor: "rgba(15,23,42,0.92)",
            padding: 12,
            cornerRadius: 12,
            callbacks: {
              label: (context) => `${context.dataset.label}: ${formatWon(context.parsed.y)}원`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: "rgba(11,18,32,.62)", font: { weight: "700" } } },
          y: {
            grid: { color: "rgba(15,23,42,.08)" },
            ticks: { color: "rgba(11,18,32,.58)", callback: (v) => `${formatWon(v)}` }
          }
        }
      }
    });
  }

  function renderHistoryComparison(currentResp) {
    const box = $("historyCompareBox");
    if (!box) return;

    if (!historySelectedMonth) {
      box.innerHTML = `<div class="empty-note">오른쪽 달력 버튼을 눌러 비교할 월을 선택해주세요.</div>`;
      return;
    }

    const current = currentResp?.result;
    if (!current) {
      box.innerHTML = `<div class="empty-note">비교할 현재 결과가 없습니다.</div>`;
      return;
    }

    const currentRecordId = currentResp?.meta?.record_id || null;
    const candidates = Array.isArray(lastRecords)
      ? lastRecords.filter((r) => r?.record_id && r.record_id !== currentRecordId && String(r?.month || "").slice(0, 7) === historySelectedMonth)
      : [];

    if (candidates.length === 0) {
      box.innerHTML = `<div class="empty-note">선택한 ${escapeHtml(historySelectedMonth)} 월의 저장 기록이 없어 비교할 수 없습니다.</div>`;
      return;
    }

    const prev = candidates[0];

    const currRev = Number(current?.annualized?.revenue_vat_included || 0) / 12;
    const currCost = Number(current?.annualized?.cost_vat_included || 0) / 12;
    const currLabor = Number(current?.annualized?.labor_cost || 0) / 12;
    const currProfit = Number(current?.derived?.monthly_profit_estimate || (currRev - currCost - currLabor));

    const prevRev = Number(prev?.revenue_vat_included || 0);
    const prevCost = Number(prev?.cost_vat_included || 0);
    const prevLabor = Number(prev?.labor_cost || 0);
    const prevProfit = monthlyProfitFromRecord(prev);

    const currCostRatio = currRev > 0 ? (currCost + currLabor) / currRev : 0;
    const prevCostRatio = prevRev > 0 ? (prevCost + prevLabor) / prevRev : 0;

    const currLaborRatio = currRev > 0 ? currLabor / currRev : 0;
    const prevLaborRatio = prevRev > 0 ? prevLabor / prevRev : 0;

    const comment = buildHistoryComment(
      { revenue_vat_included: currRev, cost_vat_included: currCost, labor_cost: currLabor },
      prev
    );

    box.innerHTML = `
      <div class="brief-item">
        <div class="brief-k">비교 기준</div>
        <div class="brief-v">선택 월 기록 (${escapeHtml(prev?.month || "-")})</div>
      </div>
      <div class="brief-item">
        <div class="brief-k">월 매출 변화</div>
        <div class="brief-v">${deltaText(currRev, prevRev)}</div>
      </div>
      <div class="brief-item">
        <div class="brief-k">월 총비용 변화</div>
        <div class="brief-v">${deltaText(currCost + currLabor, prevCost + prevLabor)}</div>
      </div>
      <div class="brief-item">
        <div class="brief-k">월 인건비 변화</div>
        <div class="brief-v">${deltaText(currLabor, prevLabor)}</div>
      </div>
      <div class="brief-item">
        <div class="brief-k">월 추정 이익 변화</div>
        <div class="brief-v">${deltaText(currProfit, prevProfit)}</div>
      </div>
      <div class="brief-item">
        <div class="brief-k">총비용률 변화</div>
        <div class="brief-v">${ratioDeltaText(currCostRatio, prevCostRatio)}</div>
      </div>
      <div class="brief-item">
        <div class="brief-k">인건비율 변화</div>
        <div class="brief-v">${ratioDeltaText(currLaborRatio, prevLaborRatio)}</div>
      </div>
      <div style="margin-top:10px;" class="block-sub">${escapeHtml(comment)}</div>
    `;
  }

  function renderAnalysisCards(resp) {
    const analysis = resp?.analysis || {};
    renderRiskBanner(analysis);
    renderDiagnosis(resp);
    renderFinancialStructure(resp);
    renderExecutive(analysis);
    renderTaxBrief(analysis);
    renderRisk(analysis);
    renderActions(analysis);
    renderKpiCards(analysis);
    renderBenchmarks(analysis);
    renderBenchmarkSummary(analysis);
    renderMeta(resp);
    renderCharts(analysis);
    renderHistoryComparison(resp);
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

    renderAnalysisCards(resp);

    preJson.textContent = JSON.stringify(resp, null, 2);
    preMeta.textContent = JSON.stringify({ meta, kpi }, null, 2);
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

      let res = await fetch(url, {
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
        res = await fetch(url, {
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

      try {
        lastRecords = await fetchRecords();
        console.log("[TS] records loaded:", lastRecords.length);
      } catch (recordsErr) {
        console.warn("[TS] records load failed:", recordsErr);
        lastRecords = [];
      }
      renderHistoryTrend(lastRecords);

      setTab("result");

      preJson.textContent = JSON.stringify(data, null, 2);
      preMeta.textContent = JSON.stringify(
        {
          meta: data?.meta || data?.debug || {},
          kpi: data?.kpi || {},
          run_id: runId
        },
        null,
        2
      );

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

        reportExecutive.innerHTML = `<div class="empty-note">렌더링 오류가 발생했습니다.</div>`;
        reportTaxBrief.innerHTML = `<div class="empty-note">렌더링 오류가 발생했습니다.</div>`;
        reportRisk.innerHTML = `<div class="empty-note">렌더링 오류가 발생했습니다.</div>`;
        reportActions.innerHTML = `<div class="empty-note">렌더링 오류가 발생했습니다.</div>`;
      }
    } catch (e) {
      console.error("[TS] runCalc fatal error:", e);
      showError(`API 연결 실패: ${e?.message || e}`);
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
  const firstSentence = (s) => String(s || "").split(/(?<=[.!?])\s+/)[0] || "";
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
    const res = await fetch(`${base}/api/v2/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_info, monthly }),
    });
    if (!res.ok) {
      $("oppTotalCredit").textContent = "-";
      $("oppList").innerHTML = `<div class="empty-note">절세 기회 분석에 필요한 정보가 부족합니다. (매출·인건비 등 기본 입력을 확인해주세요)</div>`;
      return;
    }
    const data = await res.json();
    renderV2WowBanner(data);
    renderV2Diagnosis(data);
    renderV2Opportunities(data);
    renderV2ScenarioCards(data);
    renderV2Simulator(data);
    renderV2History(data);
  }

  // "샘플 데이터로 체험하기" 성격: 백엔드의 6개월치 샘플(성수한식당)을 그대로 가져와
  // 폼에서 만든 단일월 데이터 대신 진짜 추이가 있는 결과로 덮어씌운다.
  async function runV2Sample() {
    const base = getApiBase();
    const res = await fetch(`${base}/api/v2/sample`);
    if (!res.ok) return;
    const data = await res.json();
    v2LastMonthly = data.monthly;
    renderV2WowBanner(data);
    renderV2Diagnosis(data);
    renderV2Opportunities(data);
    renderV2ScenarioCards(data);
    renderV2Simulator(data);
    renderV2History(data);
  }

  function renderV2History(data) {
    const rows = (data.monthly || []).map((m) => ({
      month: m.month,
      revenue_vat_included: m.sales,
      cost_vat_included: (m.material_cost || 0) + (m.rent || 0) + (m.other_cost || 0),
      labor_cost: m.labor_cost,
    }));
    renderHistoryTrend(rows);
  }

  function renderV2WowBanner(data) {
    const box = $("wowBanner");
    if (!data.top_change) { box.style.display = "none"; return; }
    box.style.display = "block";
    $("wowHeadline").textContent = data.top_change.headline;
    $("wowDetail").textContent = data.top_change.detail;
  }

  function renderV2Diagnosis(data) {
    const grid = $("aiDiagGrid");
    grid.innerHTML = "";
    (data.diagnosis || []).forEach((d) => {
      const valueLine = d.value_from ? `${d.value_from} → ${d.value_to}` : d.value_to;
      grid.insertAdjacentHTML(
        "beforeend",
        `<div class="diag-card">
          <div class="icon">${d.icon}</div>
          <div class="val">${escapeHtml(valueLine)}</div>
          <div class="lbl">${escapeHtml(d.title)}</div>
          <div class="cmt">${escapeHtml(firstSentence(d.ai_comment))}</div>
        </div>`
      );
    });
  }

  function renderV2ScenarioCards(data) {
    const row = $("simCardsRow");
    row.innerHTML = "";
    const options = data.scenarios?.options || [];
    const recommendedId = data.scenarios?.recommended?.action_id;
    options.forEach((opt) => {
      const isBest = opt.action_id === recommendedId;
      row.insertAdjacentHTML(
        "beforeend",
        `<div class="sim-mini-card ${isBest ? "best" : ""}">
          <div class="lbl">${escapeHtml(opt.label)}</div>
          <div class="delta">+${fmtWonFull(opt.profit_delta)}</div>
        </div>`
      );
    });
    const recoBox = $("simRecoBox");
    if (data.scenarios?.recommendation_text) {
      recoBox.style.display = "flex";
      $("simRecoText").textContent = data.scenarios.recommendation_text;
    } else {
      recoBox.style.display = "none";
    }
  }

  function renderV2Opportunities(data) {
    const totalCredit = (data.opportunities || [])
      .filter((o) => o.category === "절세 기회" && o.eligible)
      .reduce((sum, o) => sum + (o.expected_credit || 0), 0);
    $("oppTotalCredit").textContent = fmtWonFull(totalCredit);

    const list = $("oppList");
    list.innerHTML = "";
    data.opportunities.forEach((o) => {
      let html = `<div class="opp-card">`;
      html += `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h3 style="margin:0;font-size:15.5px">${escapeHtml(o.title)}</h3><span class="${levelChipClass(o.applicability === "적용 가능성 높음" ? "GOOD" : "WARN")}">${escapeHtml(o.applicability)}</span></div>`;

      if (o.category === "경영 임계점") {
        html += `<div class="amt-row">
          <div><div class="lbl">현재 매출</div><div class="val">${fmtWonFull(o.current_sales)}</div></div>
          <div><div class="lbl">손익분기점</div><div class="val val-green">${fmtWonFull(o.breakeven_sales)}</div></div>
        </div>`;
      } else {
        html += `<div class="amt-row">
          <div><div class="lbl">${escapeHtml(o.target_amount_label || "대상 금액")}</div><div class="val">${fmtWonFull(o.target_amount)}</div></div>
          <div><div class="lbl">${escapeHtml(o.expected_credit_label || "예상 공제액")}</div><div class="val val-green">${fmtWonFull(o.expected_credit)}</div></div>
        </div>`;
      }

      // 핵심 경고(순효과가 마이너스라 권장하지 않는 경우)는 항상 보이게, 나머지 설명은 토글 하나로 통일
      if (o.marginal_analysis) {
        html += `<div class="verdict">${escapeHtml(o.marginal_analysis.verdict)}</div>`;
      }

      html += `<details class="why-details"><summary>자세히 보기</summary>`;
      html += `<p>${escapeHtml(o.why)}</p>`;

      if (o.marginal_analysis) {
        const m = o.marginal_analysis;
        html += `<div class="econ-box">
          <div class="t">경제성 판단</div>
          <div class="econ-grid">
            <div>추가 필요 지출<b>${fmtWonFull(m.extra_spend)}</b></div>
            <div>예상 추가 혜택<b>${fmtWonFull(m.extra_credit)}</b></div>
            <div>순효과<b class="neg">${fmtWonFull(m.net_effect)}</b></div>
          </div>
        </div>`;
      }

      if (o.rule_meta) {
        const r = o.rule_meta;
        html += `<div class="rule-foot">
          📜 근거 ${escapeHtml(r.source_url)}<br/>
          기준일 ${escapeHtml(r.updated_at)} · 산식 ${escapeHtml(r.formula)} · 한도 ${escapeHtml(r.limit)}<br/>
          필요 증빙 ${escapeHtml(r.required_evidence)}
        </div>`;
      }
      html += `</details>`;
      html += `</div>`;
      list.insertAdjacentHTML("beforeend", html);
    });
  }

  function renderV2Simulator(data) {
    const latest = data.monthly[data.monthly.length - 1];
    const baseProfit = latest.profit;
    const slider = $("laborSlider");
    function update() {
      const pct = parseFloat(slider.value);
      $("simLabel").textContent = `인건비 -${pct}% 조정 시`;
      const saved = latest.labor_cost * (pct / 100);
      const after = baseProfit + saved;
      $("simBase").textContent = fmtWonFull(baseProfit);
      $("simAfter").textContent = fmtWonFull(after);
      $("simAiReco").textContent = pct <= 0
        ? "슬라이더를 움직여 인건비 조정 효과를 확인해보세요."
        : `인건비를 ${pct}% 줄일 경우, 월 약 ${Math.round(saved / 10000)}만원의 추가 이익이 예상됩니다. 인력 운영 효율화를 검토해보세요.`;
    }
    slider.oninput = update;
    $("simMinus").onclick = () => { slider.value = Math.max(0, parseFloat(slider.value) - 1); update(); };
    $("simPlus").onclick = () => { slider.value = Math.min(20, parseFloat(slider.value) + 1); update(); };
    update();
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

      try {
        lastRecords = await fetchRecords();
        renderHistoryTrend(lastRecords);
      } catch (recordsErr) {
        console.warn("[TS] records reload after import failed:", recordsErr);
      }
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
  renderCostMismatchWarning();

  const lastRunId = sessionStorage.getItem("ts_last_run_id");
  const lastResponseRaw = sessionStorage.getItem("ts_last_response_v1");

  if (lastResponseRaw) {
    try {
      const restored = JSON.parse(lastResponseRaw);

      fetchRecords()
        .then((items) => {
          lastRecords = items;
          renderHistoryTrend(lastRecords);
          renderSummaryFromResponse(restored);
          setTab("result");
          console.log("[TS] restored cached response:", lastRunId || "no-run-id");
        })
        .catch((e) => {
          console.warn("[TS] restore records fetch failed:", e);
          lastRecords = [];
          renderSummaryFromResponse(restored);
          setTab("result");
          console.log("[TS] restored cached response without records:", lastRunId || "no-run-id");
        });
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

      reportExecutive.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      reportTaxBrief.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      reportRisk.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      reportActions.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      kpiCardsWrap.innerHTML = `
        <div class="report-card" style="grid-column:1/-1;">
          <div class="empty-note">계산 후 표시됩니다.</div>
        </div>
      `;
      benchmarkMeta.textContent = "계산 후 표시됩니다.";
      benchmarkTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-note" style="padding:14px;">계산 후 표시됩니다.</td>
        </tr>
      `;
      if (metaAssumptions) metaAssumptions.innerHTML = ``;
      metaFailures.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      const diag = $("diagnosisSummaryBox");
      if (diag) diag.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      const fs = $("financialStructureBox");
      if (fs) fs.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      const hs = $("historyCompareBox");
      if (hs) hs.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      const bs = $("benchmarkSummaryBox");
      if (bs) bs.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      const ts = $("taxSignalBox");
      if (ts) ts.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      const rs = $("riskSummaryBox");
      if (rs) rs.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
      const as = $("actionSummaryBox");
      if (as) as.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
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

    reportExecutive.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
    reportTaxBrief.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
    reportRisk.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
    reportActions.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
    kpiCardsWrap.innerHTML = `
      <div class="report-card" style="grid-column:1/-1;">
        <div class="empty-note">계산 후 표시됩니다.</div>
      </div>
    `;
    benchmarkMeta.textContent = "계산 후 표시됩니다.";
    benchmarkTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-note" style="padding:14px;">계산 후 표시됩니다.</td>
      </tr>
    `;
    if (metaAssumptions) metaAssumptions.innerHTML = ``;
    metaFailures.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
    const diag = $("diagnosisSummaryBox");
    if (diag) diag.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
    const fs = $("financialStructureBox");
    if (fs) fs.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
    const hs = $("historyCompareBox");
    if (hs) hs.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
    const bs = $("benchmarkSummaryBox");
    if (bs) bs.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
    const ts = $("taxSignalBox");
    if (ts) ts.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
    const rs = $("riskSummaryBox");
    if (rs) rs.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
    const as = $("actionSummaryBox");
    if (as) as.innerHTML = `<div class="empty-note">계산 후 표시됩니다.</div>`;
  }
})();