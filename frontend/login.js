// frontend/login.js
const LS_TOKEN_KEY = "ts_access_token_v1";
const LS_API_BASE_KEY = "ts_api_base_v1";

function $(id){ return document.getElementById(id); }

function showError(msg){
  const box = $("errBox");
  if (!box) return alert(msg);
  box.style.display = "block";
  box.textContent = msg;
}
function clearError(){
  const box = $("errBox");
  if (!box) return;
  box.style.display = "none";
  box.textContent = "";
}

function getApiBase(){
  const inputVal = ($("apiBase")?.value || "").trim();
  const saved = (localStorage.getItem(LS_API_BASE_KEY) || "").trim();
  const base = inputVal || saved || "http://127.0.0.1:8000";
  return base.replace(/\/+$/, "");
}
function persistApiBase(){
  const v = ($("apiBase")?.value || "").trim();
  if (v) localStorage.setItem(LS_API_BASE_KEY, v.replace(/\/+$/, ""));
}
function setToken(token){ localStorage.setItem(LS_TOKEN_KEY, token); }
function getToken(){ return localStorage.getItem(LS_TOKEN_KEY) || ""; }

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

async function doLogin(){
  clearError();
  persistApiBase();

  const apiBase = getApiBase();
  const email = ($("email")?.value || "").trim();
  const pw = ($("password")?.value || "").trim();
  if (!email || !pw){
    showError("이메일/비밀번호를 입력해주세요.");
    return;
  }

  const btn = $("btnLogin");
  if (btn){ btn.disabled = true; btn.textContent = "로그인 중..."; }

  try{
    const data = await fetchJSON(`${apiBase}/auth/login`, {
      method:"POST",
      headers: { "Content-Type":"application/json" },
      body: { email, password: pw },
    });

    const token = data?.access_token || data?.token;
    if (!token){
      showError("로그인 응답에 token이 없습니다.\n" + JSON.stringify(data, null, 2));
      return;
    }

    setToken(token);

    // ✅ 로그인 성공 → 회원 계산 페이지로 이동
    window.location.href = "./member.html";
  }catch(e){
    showError(e.message || String(e));
  }finally{
    if (btn){ btn.disabled = false; btn.textContent = "이메일로 로그인"; }
  }
}

function wire(){
  // 이미 로그인된 상태면 바로 이동
  if (getToken()){
    window.location.href = "./member.html";
    return;
  }

  const saved = localStorage.getItem(LS_API_BASE_KEY);
  if ($("apiBase") && saved) $("apiBase").value = saved;

  $("btnLogin")?.addEventListener("click", (e)=>{ e.preventDefault(); doLogin(); });

  $("btnGoRegister")?.addEventListener("click", ()=>{
    window.location.href = "./register.html";
  });

  // ✅ 간편 로그인 버튼: OAuth start URL로 이동
function goOAuth(provider){
  clearError();
  persistApiBase();
  const apiBase = getApiBase();

  // provider: "google" | "kakao" | "naver" ...
  window.location.href = `${apiBase}/auth/oauth/${provider}/start`;
}

$("btnNaver")?.addEventListener("click", ()=> goOAuth("naver"));
$("btnKakao")?.addEventListener("click", ()=> goOAuth("kakao"));
$("btnGoogle")?.addEventListener("click", ()=> goOAuth("google"));

// (없는 버튼이면 그냥 무시됨. 나중에 생기면 그때 켜면 됨)
$("btnFacebook")?.addEventListener("click", ()=> goOAuth("facebook"));
$("btnApple")?.addEventListener("click", ()=> goOAuth("apple"));

  // Enter로 submit 방지 + 버튼 클릭 유도
  window.addEventListener("keydown", (e)=>{
    if (e.key === "Enter" && (e.target?.tagName || "").toLowerCase() === "input"){
      e.preventDefault();
      doLogin();
    }
  }, true);
}

document.addEventListener("DOMContentLoaded", wire);