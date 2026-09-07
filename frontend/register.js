// frontend/register.js
const LS_API_BASE_KEY = "ts_api_base_v1";
const LS_TOKEN_KEY = "ts_access_token_v1";

function $(id){ return document.getElementById(id); }

function showMsg(msg, ok=false){
  const box = $("msgBox");
  if (!box) { alert(msg); return; }
  box.style.display = "block";
  box.classList.toggle("ok", !!ok);
  box.textContent = msg;
}
function clearMsg(){
  const box = $("msgBox");
  if (!box) return;
  box.style.display = "none";
  box.classList.remove("ok");
  box.textContent = "";
}

function persistApiBase(){
  const v = ($("apiBase")?.value || "").trim();
  if (v) localStorage.setItem(LS_API_BASE_KEY, v.replace(/\/+$/, ""));
}
function defaultApiBase(){
  const h = location.hostname;
  return (h === "localhost" || h === "127.0.0.1") ? "http://127.0.0.1:8000" : "";
}
function getApiBase(){
  const v = ($("apiBase")?.value || "").trim();
  const saved = (localStorage.getItem(LS_API_BASE_KEY) || "").trim();
  const base = v || saved || defaultApiBase();
  return base.replace(/\/+$/, "");
}

async function fetchJSON(url, { method="GET", headers={}, body=null } = {}){
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!res.ok){
    const detail = data?.detail || data?.error?.message || text || `HTTP ${res.status}`;
    throw new Error(`${res.status}: ${detail}`);
  }
  return data;
}

function validatePassword(pw){
  // 10자+, 영문/숫자/특수 포함
  const okLen = pw.length >= 10;
  const hasAlpha = /[A-Za-z]/.test(pw);
  const hasNum = /[0-9]/.test(pw);
  const hasSpec = /[^A-Za-z0-9]/.test(pw);
  return okLen && hasAlpha && hasNum && hasSpec;
}

function syncAgreeAll(){
  const all = $("agreeAll");
  const items = ["agreeAge","agreeTerms","agreePrivacy"].map(id=>$(id)).filter(Boolean);
  if (!all) return;

  all.addEventListener("change", ()=>{
    items.forEach(chk=> chk.checked = all.checked);
  });
  items.forEach(chk=>{
    chk.addEventListener("change", ()=>{
      const every = items.every(x=>x.checked);
      all.checked = every;
    });
  });
}

function wireToggles(){
  $("toggleTerms")?.addEventListener("click", ()=>{
    $("termsBody")?.classList.toggle("on");
  });
  $("togglePrivacy")?.addEventListener("click", ()=>{
    $("privacyBody")?.classList.toggle("on");
  });
}

async function doRegister(){
  clearMsg();
  persistApiBase();
  const apiBase = getApiBase();

  const email = ($("email")?.value || "").trim();
  const pw = ($("password")?.value || "").trim();
  const pw2 = ($("password2")?.value || "").trim();
  const name = ($("name")?.value || "").trim();

  if (!email) return showMsg("이메일을 입력해주세요.");
  if (!pw) return showMsg("비밀번호를 입력해주세요.");
  if (!validatePassword(pw)) return showMsg("비밀번호 조건을 만족하지 않습니다. (10자+, 영문/숫자/특수문자 포함)");
  if (pw !== pw2) return showMsg("비밀번호가 일치하지 않습니다.");
  if (!name) return showMsg("이름을 입력해주세요.");

  // 필수 동의 체크
  if (!$("agreeAge")?.checked) return showMsg("[필수] 만 14세 이상에 동의해주세요.");
  if (!$("agreeTerms")?.checked) return showMsg("[필수] 최종이용자 이용약관에 동의해주세요.");
  if (!$("agreePrivacy")?.checked) return showMsg("[필수] 개인정보 수집 및 이용에 동의해주세요.");

  const btn = $("btnRegister");
  if (btn){ btn.disabled = true; btn.textContent = "회원가입 중..."; }

  try{
    // ✅ 백엔드가 name을 안 받는 경우가 있을 수 있으므로 안전하게 보냄(추가 필드여도 서버가 무시하면 OK)
    const data = await fetchJSON(`${apiBase}/auth/register`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:{ email, password: pw, name },
    });

    // 성공 UX
    showMsg("회원가입이 완료되었습니다. 로그인 화면으로 이동합니다.", true);

    // 토큰이 있다면 저장하지 않음(요청대로)
    // localStorage.removeItem(LS_TOKEN_KEY);

    setTimeout(()=> {
      window.location.href = "./login.html";
    }, 800);

  }catch(e){
    showMsg(e.message || String(e));
  }finally{
    if (btn){ btn.disabled = false; btn.textContent = "회원가입"; }
  }
}

function wire(){
  // 버튼 기본 submit 방지
  $("btnRegister")?.addEventListener("click", (e)=>{ e.preventDefault(); doRegister(); });
  $("btnGoLogin")?.addEventListener("click", (e)=>{ e.preventDefault(); window.location.href="./login.html"; });

  // Enter로 submit 방지 + 편의
  window.addEventListener("keydown", (e)=>{
    if (e.key === "Enter" && (e.target?.tagName || "").toLowerCase() === "input"){
      e.preventDefault();
      doRegister();
    }
  }, true);

  syncAgreeAll();
  wireToggles();
}

document.addEventListener("DOMContentLoaded", wire);