const $ = (id) => document.getElementById(id);
let token = localStorage.getItem('adminToken') || '';
let allUsers = [];
let usersCache = [];

const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const GB = 1024 * 1024 * 1024;

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n >= GB) return (n / GB).toFixed(2) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}
function friendly(e) {
  if (e && (e.message === 'Failed to fetch' || e.name === 'TypeError')) {
    return 'به سرور وصل نشد. پنل باید از روی سرورِ در حال اجرا باز شود.';
  }
  return (e && e.message) || 'خطا';
}

// ---------- تم ----------
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  const btn = $('themeBtn');
  if (btn) btn.textContent = t === 'dark' ? '🌙' : '☀️';
}
applyTheme(localStorage.getItem('theme') || 'dark');

// ---------- توست ----------
let toastTimer;
function toast(msg, type = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast ' + type), 2200);
}

// ---------- API ----------
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    logout();
    throw new Error('نیاز به ورود مجدد');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'خطا');
  return data;
}

// ---------- ورود ----------
async function login() {
  $('loginErr').textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('password').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'خطا');
    token = data.token;
    localStorage.setItem('adminToken', token);
    showDash();
  } catch (e) {
    $('loginErr').textContent = friendly(e);
  }
}
function logout() {
  token = '';
  localStorage.removeItem('adminToken');
  $('dashView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
}

// ---------- داشبورد ----------
async function showDash() {
  $('loginView').classList.add('hidden');
  $('dashView').classList.remove('hidden');
  await refresh();
}
async function refresh() {
  try {
    const data = await api('GET', '/api/state');
    $('domainVal').textContent = data.domain || '—';
    allUsers = data.users;
    usersCache = data.users;
    updateStats();
    applyView();
  } catch (_) {}
}
function updateStats() {
  const active = allUsers.filter((u) => u.status === 'active').length;
  const totalUsed = allUsers.reduce((s, u) => s + (u.used || 0), 0);
  $('userBadge').textContent = allUsers.length;
  $('statUsers').textContent = allUsers.length;
  $('statActive').textContent = active;
  $('statUsage').textContent = fmtBytes(totalUsed);
  $('copyAllSub').classList.toggle('hidden', allUsers.length === 0);
}

// جستجو + مرتب‌سازی
function applyView() {
  const q = $('search').value.trim().toLowerCase();
  let list = allUsers.filter((u) => u.name.toLowerCase().includes(q));
  const s = $('sort').value;
  if (s === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (s === 'usage') list.sort((a, b) => b.used - a.used);
  else if (s === 'expiry') list.sort((a, b) => (a.expireAt || Infinity) - (b.expireAt || Infinity));
  else list = list.slice().reverse();
  renderUsers(list);
}

const statusText = { active: 'فعال', expired: 'منقضی', quota: 'حجم تمام', disabled: 'غیرفعال' };

function renderUsers(users) {
  const box = $('users');
  box.innerHTML = '';
  $('emptyState').classList.toggle('hidden', users.length > 0);

  users.forEach((u) => {
    const n = $('userTpl').content.cloneNode(true);
    if (u.status !== 'active') n.querySelector('.user-card').classList.add('disabled');
    n.querySelector('.avatar').textContent = (u.name || 'U').charAt(0);
    n.querySelector('.user-name').textContent = u.name;
    n.querySelector('.user-uuid').textContent = u.uuid;
    const st = n.querySelector('.status');
    st.textContent = statusText[u.status] || u.status;
    st.classList.add(u.status);
    n.querySelector('.user-link').textContent = u.link;

    const usageTxt = u.quota ? `${fmtBytes(u.used)} / ${fmtBytes(u.quota)}` : `${fmtBytes(u.used)} / ∞`;
    n.querySelector('.usage-txt').textContent = usageTxt;
    const pct = u.quota ? Math.min(100, (u.used / u.quota) * 100) : Math.min(100, (u.used / (5 * GB)) * 100);
    n.querySelector('.bar-fill').style.width = pct + '%';

    n.querySelector('.expiry-txt').textContent =
      u.daysLeft === null ? 'نامحدود' : u.daysLeft <= 0 ? 'منقضی' : `${u.daysLeft} روز`;
    n.querySelector('.quota-txt').textContent = u.quota ? fmtBytes(u.quota) : 'نامحدود';

    n.querySelector('.copy-link').onclick = () => copy(u.link, 'کانفیگ کپی شد');
    n.querySelector('.copy-sub').onclick = () => copy(b64(u.link), 'ساب متنی کپی شد');
    n.querySelector('.copy-suburl').onclick = () => copy(u.sub, 'لینک ساب URL کپی شد');
    n.querySelector('.download-qr').onclick = () => downloadQR(u);
    n.querySelector('.del').onclick = () => removeUser(u.id, u.name);

    const qrBox = n.querySelector('.qr');
    n.querySelector('.toggle-qr').onclick = () => {
      if (qrBox.classList.contains('show')) { qrBox.classList.remove('show'); qrBox.innerHTML = ''; }
      else { qrBox.classList.add('show'); new QRCode(qrBox, { text: u.link, width: 168, height: 168, correctLevel: QRCode.CorrectLevel.M }); }
    };

    const editBox = n.querySelector('.edit');
    const eDays = n.querySelector('.e-days');
    const eQuota = n.querySelector('.e-quota');
    const eEnabled = n.querySelector('.e-enabled');
    eDays.value = u.daysLeft && u.daysLeft > 0 ? u.daysLeft : 0;
    eQuota.value = u.quota ? +(u.quota / GB).toFixed(2) : 0;
    eEnabled.checked = u.enabled;
    n.querySelector('.toggle-edit').onclick = () => editBox.classList.toggle('show');
    n.querySelector('.save-edit').onclick = () =>
      patchUser(u.id, { days: Number(eDays.value) || 0, quotaGB: Number(eQuota.value) || 0, enabled: eEnabled.checked });
    n.querySelector('.reset-usage').onclick = () => patchUser(u.id, { resetUsage: true }, 'مصرف صفر شد');

    // عملیات سریع
    n.querySelector('.q-ext7').onclick = () => patchUser(u.id, { extendDays: 7 }, '۷ روز اضافه شد');
    n.querySelector('.q-ext30').onclick = () => patchUser(u.id, { extendDays: 30 }, '۳۰ روز اضافه شد');
    n.querySelector('.q-add10').onclick = () => patchUser(u.id, { addQuotaGB: 10 }, '۱۰ گیگ اضافه شد');
    n.querySelector('.q-add50').onclick = () => patchUser(u.id, { addQuotaGB: 50 }, '۵۰ گیگ اضافه شد');
    n.querySelector('.q-regen').onclick = () => {
      if (confirm('UUID جدید ساخته شود؟ کانفیگ قبلی این کاربر باطل می‌شود.')) patchUser(u.id, { regenUuid: true }, 'UUID جدید ساخته شد');
    };

    box.appendChild(n);
  });
}

// دانلود QR به‌صورت تصویر
function downloadQR(u) {
  const tmp = document.createElement('div');
  new QRCode(tmp, { text: u.link, width: 512, height: 512, correctLevel: QRCode.CorrectLevel.M });
  setTimeout(() => {
    const cv = tmp.querySelector('canvas');
    const img = tmp.querySelector('img');
    const url = cv ? cv.toDataURL('image/png') : img ? img.src : null;
    if (!url) return toast('خطا در ساخت QR', 'err');
    const a = document.createElement('a');
    a.href = url;
    a.download = `myx-${u.name}.png`;
    a.click();
    toast('QR دانلود شد');
  }, 150);
}

async function addUser() {
  $('addBtn').disabled = true;
  try {
    await api('POST', '/api/users', {
      name: $('newName').value.trim() || 'user',
      days: Number($('newDays').value) || 0,
      quotaGB: Number($('newQuota').value) || 0,
    });
    $('newName').value = $('newDays').value = $('newQuota').value = '';
    await refresh();
    toast('کاربر ساخته شد ✓');
  } catch (e) {
    toast(friendly(e), 'err');
  } finally {
    $('addBtn').disabled = false;
  }
}
async function patchUser(id, body, msg) {
  try {
    await api('PATCH', '/api/users/' + id, body);
    await refresh();
    toast(msg || 'ذخیره شد ✓');
  } catch (e) {
    toast(friendly(e), 'err');
  }
}
async function removeUser(id, name) {
  if (!confirm(`کاربر «${name}» حذف شود؟`)) return;
  try {
    await api('DELETE', '/api/users/' + id);
    await refresh();
    toast('کاربر حذف شد');
  } catch (e) {
    toast(friendly(e), 'err');
  }
}
function copy(text, msg) {
  navigator.clipboard.writeText(text).then(() => toast(msg || 'کپی شد ✓'), () => toast('کپی ناموفق', 'err'));
}

// ---------- ابزارها (مودال) ----------
function openTools() { $('toolsModal').classList.remove('hidden'); }
function closeTools() { $('toolsModal').classList.add('hidden'); }

async function changePassword() {
  const np = $('newPass').value;
  if (np.length < 4) return toast('رمز حداقل ۴ کاراکتر', 'err');
  try {
    const d = await api('POST', '/api/password', { newPassword: np });
    token = d.token;
    localStorage.setItem('adminToken', token);
    $('newPass').value = '';
    toast('رمز پنل تغییر کرد ✓');
  } catch (e) {
    toast(friendly(e), 'err');
  }
}
async function doBackup() {
  try {
    const res = await fetch('/api/backup', { headers: { 'x-admin-token': token } });
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'myx-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('بکاپ دانلود شد');
  } catch (_) {
    toast('خطا در بکاپ', 'err');
  }
}
async function doRestore(file) {
  try {
    const data = JSON.parse(await file.text());
    await api('POST', '/api/restore', { data });
    await refresh();
    toast('بازیابی انجام شد');
    closeTools();
  } catch (e) {
    toast('فایل بکاپ نامعتبر است', 'err');
  }
}
async function rotatePath() {
  if (!confirm('همه‌ی کانفیگ‌های فعلی باطل می‌شوند. مطمئنی؟')) return;
  try {
    await api('POST', '/api/wspath');
    await refresh();
    toast('مسیر جدید ساخته شد؛ کانفیگ‌ها را دوباره بگیرید');
    closeTools();
  } catch (e) {
    toast(friendly(e), 'err');
  }
}

// ---------- رویدادها ----------
$('loginBtn').addEventListener('click', login);
$('password').addEventListener('keydown', (e) => e.key === 'Enter' && login());
$('togglePass').addEventListener('click', () => {
  const p = $('password');
  p.type = p.type === 'password' ? 'text' : 'password';
});
$('logoutBtn').addEventListener('click', logout);
$('themeBtn').addEventListener('click', () =>
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark')
);
$('addBtn').addEventListener('click', addUser);
$('newName').addEventListener('keydown', (e) => e.key === 'Enter' && addUser());
$('search').addEventListener('input', applyView);
$('sort').addEventListener('change', applyView);
$('copyDomain').addEventListener('click', () => {
  const d = $('domainVal').textContent;
  if (d && d !== '—') copy(d, 'دامنه کپی شد');
});
$('copyAllSub').addEventListener('click', () => {
  if (!usersCache.length) return toast('کاربری نیست', 'err');
  copy(b64(usersCache.map((u) => u.link).join('\n')), 'ساب متنی همه کپی شد');
});

$('toolsBtn').addEventListener('click', openTools);
$('toolsClose').addEventListener('click', closeTools);
$('toolsModal').addEventListener('click', (e) => { if (e.target.id === 'toolsModal') closeTools(); });
$('savePass').addEventListener('click', changePassword);
$('backupBtn').addEventListener('click', doBackup);
$('restoreBtn').addEventListener('click', () => $('restoreFile').click());
$('restoreFile').addEventListener('change', (e) => { if (e.target.files[0]) doRestore(e.target.files[0]); e.target.value = ''; });
$('rotateBtn').addEventListener('click', rotatePath);

setInterval(() => { if (token && !$('dashView').classList.contains('hidden')) refresh(); }, 20000);

if (token) showDash();
