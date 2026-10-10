const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const API = 'https://www.googleapis.com/drive/v3';
const TOKEN_KEY = 'hv_token';
const $app = document.getElementById('app');
const fileId = new URLSearchParams(location.search).get('id');

class AuthError extends Error {}

// ---- 토큰 (localStorage에 만료시각과 함께 저장) ----
function loadToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY));
    if (t && t.exp > Date.now() + 60_000) return t.value;
  } catch {}
  return null;
}
function saveToken(value, expiresIn) {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ value, exp: Date.now() + expiresIn * 1000 })); } catch {}
}
function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

// ---- Google Identity Services ----
let tokenClient, pending;
const gisReady = new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.onload = resolve;
  s.onerror = () => reject(new Error('구글 로그인 스크립트를 불러오지 못했어요.'));
  document.head.appendChild(s);
}).then(() => {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: SCOPE,
    callback: (r) => {
      if (r.error) return pending?.reject(new Error(r.error_description || r.error));
      if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) {
        return pending?.reject(new Error('로그인할 때 "Google Drive 파일 보기" 권한에 체크해야 해요. 다시 로그인해서 체크해 주세요.'));
      }
      saveToken(r.access_token, Number(r.expires_in));
      pending?.resolve(r.access_token);
    },
    error_callback: (e) => pending?.reject(new Error(e.type === 'popup_closed' ? '로그인 창이 닫혔어요.' : e.message || e.type)),
  });
});

// 팝업 차단을 피하려면 클릭 핸들러 안에서 동기적으로 호출해야 함
function login() {
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

// ---- Drive API ----
async function drive(path, token, asText = false) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { clearToken(); throw new AuthError(); }
  if (!res.ok) {
    let detail = '';
    try {
      const { error } = await res.json();
      detail = [error.errors?.[0]?.reason || error.status, error.message].filter(Boolean).join(': ');
    } catch {}
    if (res.status === 403 && /insufficient|scope/i.test(detail)) clearToken();
    const msg =
      res.status === 404 ? '문서를 찾을 수 없거나 열람 권한이 없어요.'
      : res.status === 403 && /insufficient|scope/i.test(detail) ? '드라이브 읽기 권한이 허용되지 않았어요. 다시 로그인해서 "Google Drive 파일 보기"에 체크해 주세요.'
      : res.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used/i.test(detail) ? 'Google Cloud 프로젝트에서 Drive API가 꺼져 있어요.'
      : res.status === 403 ? '이 문서를 볼 권한이 없어요.'
      : `불러오기 실패 (${res.status})`;
    const err = new Error(detail ? `${msg}\n\n(${detail})` : msg);
    err.status = res.status;
    throw err;
  }
  return asText ? res.text() : res.json();
}

// ---- 유틸 ----
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const viewerLink = (id) => `${location.origin}${location.pathname}?id=${encodeURIComponent(id)}`;
const docName = (name) => name.replace(/\.html?$/i, '');

function extractId(input) {
  const s = input.trim();
  const m = s.match(/\/(?:d|folders)\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(s) ? s : null;
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const prev = btn.textContent;
    btn.textContent = '복사됨!';
    setTimeout(() => (btn.textContent = prev), 1200);
  } catch {
    prompt('링크를 복사하세요', text);
  }
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

// ---- 화면 ----
function renderMessage(title, body = '', action = '') {
  $app.innerHTML = `
    <main class="center">
      <div class="card">
        <h1>${esc(title)}</h1>
        ${body ? `<p>${esc(body)}</p>` : ''}
        ${action}
      </div>
    </main>`;
}

function renderLogin() {
  renderMessage(
    fileId ? '문서를 보려면 로그인하세요' : '우리 문서함',
    '구글 드라이브에서 공유받은 계정으로 로그인해 주세요.',
    `<button id="login" class="primary" disabled>불러오는 중…</button>`
  );
  const btn = document.getElementById('login');
  gisReady.then(() => {
    btn.disabled = false;
    btn.textContent = 'Google로 로그인';
    btn.onclick = () => login().then(run).catch((e) => renderError(e));
  }).catch(renderError);
}

function renderError(e) {
  if (e instanceof AuthError) return renderLogin();
  renderMessage('앗', e.message || String(e),
    `<div class="row"><a class="button" href="./">목록으로</a><button id="retry">다시 로그인</button></div>`);
  document.getElementById('retry').onclick = () => { clearToken(); renderLogin(); };
}

// srcdoc 문서에선 href="#섹션"이 부모 URL 기준으로 해석돼 iframe이 다른 페이지로 이동해버림 → 클릭을 가로채 스크롤만 함
const HASH_LINK_FIX = `<script>document.addEventListener('click',function(e){
  if (e.defaultPrevented) return;
  var a = e.target.closest && e.target.closest('a[href^="#"]');
  if (!a) return;
  e.preventDefault();
  var id = decodeURIComponent(a.getAttribute('href').slice(1));
  var el = id && (document.getElementById(id) || document.getElementsByName(id)[0]);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
  else if (!id) window.scrollTo({ top: 0, behavior: 'smooth' });
});</script>`;

function withHashLinkFix(html) {
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i < 0 ? html + HASH_LINK_FIX : html.slice(0, i) + HASH_LINK_FIX + html.slice(i);
}

const GDOC = 'application/vnd.google-apps.document';
const FOLDER = 'application/vnd.google-apps.folder';

async function showDoc(token) {
  $app.innerHTML = `<main class="center"><p class="muted">불러오는 중…</p></main>`;
  const q = `/files/${encodeURIComponent(fileId)}`;
  const meta = await drive(`${q}?fields=name,mimeType&supportsAllDrives=true`, token);

  if (meta.mimeType === FOLDER) return showList(token, fileId, meta.name);
  let html;
  if (meta.mimeType === GDOC) {
    // 업로드 시 'Google Docs로 변환' 설정이 켜져 있으면 HTML이 구글 문서가 됨 → HTML로 내보내서 표시
    html = await drive(`${q}/export?mimeType=text/html`, token, true);
  } else if (meta.mimeType.startsWith('application/vnd.google-apps.')) {
    throw new Error(`HTML 파일이 아니에요. (${meta.name})`);
  } else {
    html = await drive(`${q}?alt=media&supportsAllDrives=true`, token, true);
  }
  document.title = docName(meta.name);

  $app.innerHTML = `
    <div class="viewer">
      <header>
        <a href="./" class="back" title="목록">←</a>
        <span class="title">${esc(docName(meta.name))}</span>
        <button id="copy" class="small">링크 복사</button>
      </header>
      <iframe title="${esc(meta.name)}"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads"></iframe>
    </div>`;
  document.getElementById('copy').onclick = (e) => copy(viewerLink(fileId), e.currentTarget);

  // allow-same-origin을 주지 않아 문서 속 스크립트는 이 페이지(토큰)에 접근할 수 없음.
  // blob URL은 iOS 사파리 sandbox iframe에서 안 열려서 srcdoc을 씀
  $app.querySelector('iframe').srcdoc = withHashLinkFix(html);
}

async function showList(token, folderId = CONFIG.FOLDER_ID, folderName = '') {
  $app.innerHTML = `<main class="center"><p class="muted">불러오는 중…</p></main>`;
  const q = [`(mimeType='text/html' or mimeType='${GDOC}')`, 'trashed=false'];
  if (folderId) q.unshift(`'${folderId}' in parents`);
  const params = new URLSearchParams({
    q: q.join(' and '),
    orderBy: 'modifiedTime desc',
    pageSize: '200',
    fields: 'files(id,name,modifiedTime)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const { files } = await drive(`/files?${params}`, token);

  $app.innerHTML = `
    <main class="list">
      <header class="top">
        <h1>${esc(folderName || '우리 문서함')}</h1>
        <button id="logout" class="small">로그아웃</button>
      </header>

      <form id="convert" class="convert">
        <input id="driveUrl" placeholder="드라이브 링크를 붙여넣으면 공유 링크로 바꿔줘요" autocomplete="off">
        <button class="primary">변환</button>
      </form>
      <div id="converted"></div>

      ${files.length ? `<ul class="docs">${files.map((f) => `
        <li>
          <a href="?id=${encodeURIComponent(f.id)}">
            <span class="name">${esc(docName(f.name))}</span>
            <span class="muted">${esc(formatDate(f.modifiedTime))}</span>
          </a>
          <button class="small" data-id="${esc(f.id)}">링크 복사</button>
        </li>`).join('')}</ul>`
      : `<p class="muted empty">아직 문서가 없어요.</p>`}
    </main>`;

  document.getElementById('logout').onclick = () => {
    google.accounts.oauth2.revoke(token, () => {});
    clearToken();
    renderLogin();
  };
  $app.querySelectorAll('.docs button').forEach((b) => (b.onclick = () => copy(viewerLink(b.dataset.id), b)));
  document.getElementById('convert').onsubmit = (e) => {
    e.preventDefault();
    const id = extractId(document.getElementById('driveUrl').value);
    const out = document.getElementById('converted');
    if (!id) { out.innerHTML = `<p class="error">파일 ID를 찾지 못했어요.</p>`; return; }
    const link = viewerLink(id);
    out.innerHTML = `<div class="result"><a href="${esc(link)}">${esc(link)}</a><button class="small">복사</button></div>`;
    const btn = out.querySelector('button');
    btn.onclick = () => copy(link, btn);
    copy(link, btn);
  };
}

async function run(token) {
  try {
    await (fileId ? showDoc(token) : showList(token));
  } catch (e) {
    renderError(e);
  }
}

// 구글은 카톡 등 인앱 브라우저에서 로그인을 막음(disallowed_useragent)
const UA = navigator.userAgent;
const inApp = /KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER\(inapp|DaumApps|everytimeApp/i.test(UA);

if (inApp) {
  const external = /KAKAOTALK/i.test(UA)
    ? `<a class="button primary" href="kakaotalk://web/openExternal?url=${encodeURIComponent(location.href)}">외부 브라우저로 열기</a>`
    : '';
  renderMessage('브라우저에서 열어주세요',
    '앱 안에서는 구글 로그인이 막혀 있어요. 오른쪽 위 메뉴(⋮ 또는 공유)에서 "다른 브라우저로 열기" / "Safari로 열기"를 눌러주세요.',
    external);
} else if (!CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.startsWith('YOUR_')) {
  renderMessage('설정이 필요해요', 'config.js에 CLIENT_ID를 넣어주세요.');
} else {
  const token = loadToken();
  token ? run(token) : renderLogin();
}
