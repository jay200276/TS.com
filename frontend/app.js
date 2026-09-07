(() => {
  const LS_API_BASE_KEY = "ts_api_base_v1";
  const DEFAULT_API_BASE = (() => {
    const h = location.hostname;
    return (h === "localhost" || h === "127.0.0.1") ? "http://127.0.0.1:8000" : "";
  })();
  const API_BASE = (localStorage.getItem(LS_API_BASE_KEY) || DEFAULT_API_BASE || "").replace(/\/+$/, "");

  const $ = (sel) => document.querySelector(sel);
  const fmtWon = (v) => (v == null ? "-" : `${Math.round(v).toLocaleString("ko-KR")}원`);
  const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const state = { result: null, benchChart: null, donutChart: null };

  function collectBusinessInfo() {
    return {
      biz_type: $("#biz_type").value,
      tax_type: $("#tax_type").value,
      taxpayer_type: $("#biz_type").value === "법인사업자" ? "CORP" : "PERSONAL",
      industry: "음식점업",
      industry_detail: $("#industry_detail").value,
      industry_key: "FOODSVC",
      prior_year_sales_vat_included: parseInt($("#prior_year_sales").value || "0", 10) || 0,
      store_name: $("#store_name").value || null,
      region_code: "ALL",
    };
  }

  async function runSample() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v2/sample`);
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      onAnalysisReady(await res.json());
    } catch (e) {
      showError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function runUpload() {
    const file = $("#fileInput").files[0];
    if (!file) {
      showError("먼저 엑셀 파일을 선택해주세요. (또는 샘플 데이터로 체험하기를 눌러보세요)");
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const bi = collectBusinessInfo();
      fd.append("biz_type", bi.biz_type);
      fd.append("tax_type", bi.tax_type);
      fd.append("industry", bi.industry);
      fd.append("industry_detail", bi.industry_detail);
      fd.append("prior_year_sales_vat_included", String(bi.prior_year_sales_vat_included));
      if (bi.store_name) fd.append("store_name", bi.store_name);

      const res = await fetch(`${API_BASE}/api/v2/upload`, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `서버 오류 (${res.status})`);
      }
      onAnalysisReady(await res.json());
    } catch (e) {
      showError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  function setLoading(v) {
    $("#loadingBox").style.display = v ? "flex" : "none";
    $("#btnUpload").disabled = v;
    $("#btnSample").disabled = v;
  }

  function showError(msg) {
    const box = $("#errorBox");
    box.style.display = "block";
    box.textContent = msg;
  }

  function onAnalysisReady(data) {
    state.result = data;
    $("#errorBox").style.display = "none";
    renderAll(data);
    $("#screen1").classList.remove("active");
    $("#screen2").classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function levelChipClass(level) {
    const v = String(level || "").toUpperCase();
    if (v === "GOOD") return "level-chip level-good";
    if (v === "WARN") return "level-chip level-warn";
    if (v === "RISK") return "level-chip level-risk";
    return "level-chip level-neutral";
  }
  function kpiBadgeClass(level) {
    const v = String(level || "").toUpperCase();
    if (v === "GOOD") return "kpi-badge kpi-good";
    if (v === "WARN") return "kpi-badge kpi-warn";
    if (v === "RISK") return "kpi-badge kpi-risk";
    return "kpi-badge kpi-unknown";
  }
  function levelForBenchRow(row) {
    const good = row.code === "PROFIT_RATIO" ? row.diff_pp >= 0 : row.diff_pp <= 0;
    if (good) return row.diff_pp === 0 ? "WARN" : "GOOD";
    return Math.abs(row.diff_pp) >= 10 ? "RISK" : "WARN";
  }

  function renderAll(data) {
    const store = data.business_info.store_name;
    $("#dashTitle").textContent = store ? `${store} 진단 결과` : "이번 달 TS 진단";
    $("#periodLabel").textContent = `분석 기간 ${data.business_info.analysis_period_label || "-"} · 입력하신 내용을 바탕으로 분석한 결과입니다.`;
    $("#topSub").textContent = "결과 분석";

    renderRiskBanner(data);
    renderKpiCards(data);
    renderBenchmark(data);
    renderBenchChart(data);
    renderDiagnosis(data);
    renderFinancialStructure(data);
    renderOpportunities(data);
    renderSimulator(data);
    renderTaxBrief(data.tax_brief);
    renderActionSummary(data);

    $("#disclaimerFoot").textContent = "TS의 계산은 입력정보를 기반으로 한 예상치이며, 실제 신고 전 최신 법령 및 세무전문가 확인이 필요합니다.";
  }

  function renderRiskBanner(data) {
    const top = data.diagnosis[0];
    $("#riskBannerTitle").textContent = `가장 시급한 문제: ${top.title} ${top.value_to}`;
    $("#riskBannerDetail").textContent = top.ai_comment;
  }

  function renderKpiCards(data) {
    const grid = $("#kpiGrid");
    grid.innerHTML = "";
    data.benchmark_table.forEach((row) => {
      const level = levelForBenchRow(row);
      grid.insertAdjacentHTML(
        "beforeend",
        `<div class="kpi-card">
          <div class="${kpiBadgeClass(level)}">${level}</div>
          <div class="kpi-label">${escapeHtml(row.label)}</div>
          <div class="kpi-value">${row.my_value_pct}%</div>
          <div class="kpi-comment">한식 중앙값 대비 ${row.diff_pp > 0 ? "+" : ""}${row.diff_pp}%p</div>
        </div>`
      );
    });
  }

  function renderBenchmark(data) {
    const rows = data.benchmark_table;
    const body = $("#benchmarkTableBody");
    body.innerHTML = rows
      .map((r) => {
        const level = levelForBenchRow(r);
        return `<tr>
          <td>${escapeHtml(r.label)}</td>
          <td>${r.my_value_pct}%</td>
          <td>${r.benchmark_pct}%</td>
          <td>${r.diff_pp > 0 ? "+" : ""}${r.diff_pp}%p</td>
          <td><span class="${levelChipClass(level)}">${level}</span></td>
        </tr>`;
      })
      .join("");

    const worst = [...rows].sort((a, b) => Math.abs(b.diff_pp) - Math.abs(a.diff_pp))[0];
    $("#benchmarkSummaryBox").innerHTML = `
      <div class="block-title" style="margin-bottom:8px">벤치마크 해석</div>
      <ul class="report-list">
        <li>우선 점검: ${escapeHtml(worst.label)} · 중앙값 대비 ${worst.diff_pp > 0 ? "+" : ""}${worst.diff_pp}%p</li>
        <li>${escapeHtml(data.business_info.industry_detail)} 업종 기준 비교입니다.</li>
      </ul>`;
  }

  function renderBenchChart(data) {
    const rows = data.benchmark_table;
    const canvas = $("#benchChartCanvas");
    if (state.benchChart) state.benchChart.destroy();
    state.benchChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          { label: "내 값(%)", data: rows.map((r) => r.my_value_pct), backgroundColor: "#4C7BF0" },
          { label: "업종 중앙값(%)", data: rows.map((r) => r.benchmark_pct), backgroundColor: "#EF6C86" },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
    });
  }

  function renderDiagnosis(data) {
    const box = $("#diagnosisSummaryBox");
    const sentences = [
      `종합점수 ${data.health.score_100}점 · ${data.health.grade}`,
      data.top_change.headline,
      data.top_change.detail,
      ...data.diagnosis.map((d) => `${d.title}: ${d.value_to}`),
    ];
    box.innerHTML = `
      <div class="block-sub" style="margin-bottom:10px;font-size:17px">한눈에 보는 현재 상태</div>
      <div style="display:grid;gap:10px">
        ${sentences.map((s) => `<div class="risk-block"><div class="block-sub" style="font-size:15px;line-height:1.6">${escapeHtml(s)}</div></div>`).join("")}
      </div>`;
  }

  function renderFinancialStructure(data) {
    const latest = data.monthly[data.monthly.length - 1];
    const sales = latest.sales;
    const otherCost = latest.material_cost + latest.rent + latest.other_cost;
    const segments = [
      { label: "원 비용(재료+임대+기타)", ratio: otherCost / sales, amount: otherCost, icon: "₩", bg: "#ecd17a", chart: "#4C7BF0" },
      { label: "원 인건비", ratio: latest.labor_ratio, amount: latest.labor_cost, icon: "인", bg: "#efb2be", chart: "#EF6C86" },
      { label: "원 추정 이익", ratio: latest.profit_ratio, amount: latest.profit, icon: "수", bg: "#c7d7ff", chart: "#F2B84B" },
    ];

    const box = $("#financialStructureBox");
    box.innerHTML = `
      <div class="financial-summary-card">
        <div class="financial-total-label">총 매출</div>
        <div class="financial-total-value">${fmtWon(sales)}</div>
        <div class="financial-donut-row">
          <div class="financial-donut-wrap">
            <canvas id="financialDonutCanvas"></canvas>
            <div class="financial-donut-center">
              <div class="financial-donut-center-label">매출 구성</div>
              <div class="financial-donut-center-value">100%</div>
            </div>
          </div>
          <div class="financial-legend">
            ${segments.map((s) => `<div class="financial-legend-row"><span class="financial-legend-dot" style="background:${s.chart}"></span><span>${escapeHtml(s.label)} ${(s.ratio * 100).toFixed(1)}%</span></div>`).join("")}
          </div>
        </div>
        <div class="financial-list">
          ${segments.map((s) => `
            <div class="financial-item">
              <div class="financial-icon" style="background:${s.bg}">${s.icon}</div>
              <div><div class="financial-label">${escapeHtml(s.label)}</div><div class="financial-sub">매출 대비 ${(s.ratio * 100).toFixed(1)}%</div></div>
              <div class="financial-amount">${fmtWon(s.amount)}</div>
            </div>`).join("")}
        </div>
        <div class="financial-comment">ⓘ 이번 달(${latest.month}) 기준 추정치입니다.</div>
      </div>`;

    const canvas = $("#financialDonutCanvas");
    if (state.donutChart) state.donutChart.destroy();
    state.donutChart = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: segments.map((s) => s.label),
        datasets: [{ data: segments.map((s) => Math.max(0, s.ratio * 100)), backgroundColor: segments.map((s) => s.chart), borderWidth: 0 }],
      },
      options: { responsive: true, maintainAspectRatio: true, cutout: "70%", plugins: { legend: { display: false } } },
    });
  }

  function renderOpportunities(data) {
    $("#oppSummaryLine").textContent = data.opportunity_summary_line;
    const list = $("#oppList");
    list.innerHTML = "";
    data.opportunities.forEach((o) => {
      let html = `<div class="opp-card">`;
      html += `<div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0;font-size:15.5px">${escapeHtml(o.title)}</h3><span class="${kpiBadgeClass(o.applicability === "적용 가능성 높음" ? "GOOD" : o.applicability === "한도 초과 주의" ? "WARN" : "WARN")}">${escapeHtml(o.applicability)}</span></div>`;

      if (o.category === "경영 임계점") {
        html += `<div class="amt-row">
          <div><div class="lbl">현재 매출</div><div class="val">${fmtWon(o.current_sales)}</div></div>
          <div><div class="lbl">손익분기점</div><div class="val">${fmtWon(o.breakeven_sales)}</div></div>
        </div>`;
      } else {
        html += `<div class="amt-row">
          <div><div class="lbl">${escapeHtml(o.target_amount_label || "대상 금액")}</div><div class="val">${fmtWon(o.target_amount)}</div></div>
          <div><div class="lbl">${escapeHtml(o.expected_credit_label || "예상 공제액")}</div><div class="val" style="color:#2f5fe0">${fmtWon(o.expected_credit)}</div></div>
        </div>`;
      }

      html += `<p style="font-size:13px;color:var(--muted);line-height:1.6">${escapeHtml(o.why)}</p>`;

      if (o.marginal_analysis) {
        const m = o.marginal_analysis;
        html += `<div class="econ-box">
          <div class="t">경제성 판단</div>
          <div class="econ-grid">
            <div>추가 필요 지출<b>${fmtWon(m.extra_spend)}</b></div>
            <div>예상 추가 혜택<b>${fmtWon(m.extra_credit)}</b></div>
            <div>순효과<b class="neg">${fmtWon(m.net_effect)}</b></div>
          </div>
        </div>
        <div class="verdict">${escapeHtml(m.verdict)}</div>`;
      }

      if (o.rule_meta) {
        const r = o.rule_meta;
        html += `<div class="rule-foot">
          근거 ${escapeHtml(r.source_url)}<br/>
          기준일 ${escapeHtml(r.updated_at)} · 산식 ${escapeHtml(r.formula)} · 한도 ${escapeHtml(r.limit)}<br/>
          필요 증빙 ${escapeHtml(r.required_evidence)}
        </div>`;
      }
      html += `</div>`;
      list.insertAdjacentHTML("beforeend", html);
    });
  }

  function renderSimulator(data) {
    const latest = data.monthly[data.monthly.length - 1];
    const baseProfit = latest.profit;
    const slider = $("#laborSlider");
    function update() {
      const pct = parseFloat(slider.value);
      $("#simLabel").textContent = `인건비 -${pct}% 조정 시`;
      const saved = latest.labor_cost * (pct / 100);
      const after = baseProfit + saved;
      $("#simBase").textContent = fmtWon(baseProfit);
      $("#simAfter").textContent = fmtWon(after);
      $("#simAiReco").textContent = pct <= 0
        ? "슬라이더를 움직여 인건비 조정 효과를 확인해보세요."
        : `인건비를 ${pct}% 줄일 경우, 월 약 ${Math.round(saved / 10000)}만원의 추가 이익이 예상됩니다. 인력 운영 효율화를 검토해보세요.`;
    }
    slider.oninput = update;
    $("#simMinus").onclick = () => { slider.value = Math.max(0, parseFloat(slider.value) - 1); update(); };
    $("#simPlus").onclick = () => { slider.value = Math.min(20, parseFloat(slider.value) + 1); update(); };
    update();
  }

  function renderTaxBrief(tax) {
    $("#reportTaxBrief").innerHTML = `
      <div class="tax-line"><span>부가가치세</span><b>${fmtWon(tax.vat_annual)}</b></div>
      <div class="tax-line"><span>소득세·지방소득세</span><b>${fmtWon(tax.income_local_tax_annual)}</b></div>
      <div class="tax-line"><span>사업자 보험 부담</span><b>${fmtWon(tax.insurance_annual)}</b></div>
      <div class="tax-line" style="border-top:1px solid rgba(15,23,42,.1);padding-top:8px;margin-top:4px"><span>총 예상 세부담</span><b>${fmtWon(tax.total_burden_annual)}</b></div>
      <p style="font-size:11.5px;color:var(--muted);margin-top:8px">${escapeHtml(tax.note)}</p>
    `;
  }

  function renderActionSummary(data) {
    const box = $("#actionSummaryBox");
    if (!data.todo_list.length) {
      box.innerHTML = `<div class="empty-note">지금 확인할 긴급 항목이 없습니다.</div>`;
      return;
    }
    box.innerHTML = data.todo_list
      .map(
        (t) => `<div class="risk-block" style="margin-bottom:8px">
          <span class="level-chip level-warn">${escapeHtml(t.tag)}</span>
          <div class="block-sub" style="font-size:14px;margin-top:6px">${escapeHtml(t.title)}</div>
          <div style="font-size:12.5px;color:var(--muted);margin-top:2px">${escapeHtml(t.detail)}</div>
        </div>`
      )
      .join("");
  }

  // 정밀 입력 (엑셀 없이 월별 직접 입력)
  const PRECISION_COLS = [
    ["month", "text", "2026-08"],
    ["sales", "number", "39000000"],
    ["material_cost", "number", "14700000"],
    ["labor_cost", "number", "8700000"],
    ["rent", "number", "3000000"],
    ["other_cost", "number", "2100000"],
    ["card_sales_amount", "number", "31200000"],
    ["cash_receipt_amount", "number", "3900000"],
    ["exempt_agri_purchase", "number", "6200000"],
    ["visit_count", "number", "2700"],
  ];

  function addPrecisionRow() {
    const tr = document.createElement("tr");
    PRECISION_COLS.forEach(([key, type, ph]) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = type;
      input.placeholder = ph;
      input.dataset.key = key;
      td.appendChild(input);
      tr.appendChild(td);
    });
    const tdRm = document.createElement("td");
    const rmBtn = document.createElement("button");
    rmBtn.type = "button";
    rmBtn.className = "rm-row";
    rmBtn.textContent = "✕";
    rmBtn.onclick = () => tr.remove();
    tdRm.appendChild(rmBtn);
    tr.appendChild(tdRm);
    $("#precisionRows").appendChild(tr);
  }

  function collectPrecisionRows() {
    return Array.from($("#precisionRows").querySelectorAll("tr")).map((tr) => {
      const rec = {};
      tr.querySelectorAll("input").forEach((inp) => {
        rec[inp.dataset.key] = inp.type === "number" ? (parseFloat(inp.value) || 0) : (inp.value || "");
      });
      return rec;
    });
  }

  async function runPrecision() {
    const rows = collectPrecisionRows().filter((r) => r.month && r.sales > 0);
    if (!rows.length) {
      showError("최소 한 달 이상 월/매출을 입력해주세요.");
      return;
    }
    setLoading(true);
    try {
      const bi = collectBusinessInfo();
      const res = await fetch(`${API_BASE}/api/v2/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_info: bi, monthly: rows }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `서버 오류 (${res.status})`);
      }
      onAnalysisReady(await res.json());
    } catch (e) {
      showError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  $("#precisionToggle").addEventListener("click", () => {
    const body = $("#precisionBody");
    const open = body.style.display !== "none";
    body.style.display = open ? "none" : "block";
    $("#precisionArrow").textContent = open ? "펼치기 ▾" : "접기 ▴";
    if (!open && !$("#precisionRows").children.length) addPrecisionRow();
  });
  $("#btnAddRow").addEventListener("click", addPrecisionRow);
  $("#btnPrecision").addEventListener("click", runPrecision);

  // dropzone
  $("#dropzone").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", () => {
    const f = $("#fileInput").files[0];
    if (f) {
      $("#dropzone").classList.add("hasfile");
      $("#dropzone-text").textContent = `선택된 파일: ${f.name}`;
    }
  });

  $("#btnSample").addEventListener("click", runSample);
  $("#btnUpload").addEventListener("click", runUpload);
})();
