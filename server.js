const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const xray = require('./lib/xray');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('hex');

// ---------- وضعیت (کاربران + مسیر مخفی WS) ----------
function saveState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) {
    const state = {
      wsPath: '/' + crypto.randomBytes(6).toString('hex'),
      users: [
        {
          id: crypto.randomBytes(4).toString('hex'),
          name: 'default',
          uuid: process.env.INIT_UUID || crypto.randomUUID(),
        },
      ],
    };
    saveState(state);
    return state;
  }
}

const state = loadState();
xray.start(state);

// ---------- کمکی‌ها ----------
function domainOf(req) {
  return (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
}

function linkFor(user, domain, wsPath, remark) {
  const name = remark || user.name;
  const p = new URLSearchParams();
  p.set('type', 'ws');
  p.set('security', 'tls');
  p.set('encryption', 'none');
  p.set('host', domain);
  p.set('sni', domain);
  p.set('fp', 'chrome');
  p.set('path', wsPath);
  return `vless://${user.uuid}@${domain}:443?${p.toString()}#${encodeURIComponent(name)}`;
}

// ---------- اپلیکیشن ----------
const app = express();
app.use(express.json({ limit: '128kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  if ((req.headers['x-admin-token'] || '') !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'دسترسی غیرمجاز' });
  }
  next();
}

app.post('/api/login', (req, res) => {
  if ((req.body && req.body.password) !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'رمز اشتباه است' });
  }
  res.json({ token: ADMIN_PASSWORD });
});

app.get('/api/state', auth, (req, res) => {
  const domain = domainOf(req);
  res.json({
    domain,
    wsPath: state.wsPath,
    users: state.users.map((u) => ({
      id: u.id,
      name: u.name,
      uuid: u.uuid,
      link: linkFor(u, domain, state.wsPath),
      sub: `https://${req.headers.host}/sub/${u.uuid}`,
    })),
  });
});

app.post('/api/users', auth, (req, res) => {
  const name = ((req.body && req.body.name) || 'user').toString().trim().slice(0, 32) || 'user';
  const user = { id: crypto.randomBytes(4).toString('hex'), name, uuid: crypto.randomUUID() };
  state.users.push(user);
  saveState(state);
  xray.restart(state);
  const domain = domainOf(req);
  res.json({
    id: user.id,
    name: user.name,
    uuid: user.uuid,
    link: linkFor(user, domain, state.wsPath),
    sub: `https://${req.headers.host}/sub/${user.uuid}`,
  });
});

app.delete('/api/users/:id', auth, (req, res) => {
  const i = state.users.findIndex((u) => u.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'کاربر پیدا نشد' });
  if (state.users.length <= 1) return res.status(400).json({ error: 'حداقل یک کاربر باید باقی بماند' });
  state.users.splice(i, 1);
  saveState(state);
  xray.restart(state);
  res.json({ ok: true });
});

// خروجی ساب‌سکریپشن (base64) — با UUID به‌عنوان توکن، بدون نیاز به لاگین
app.get('/sub/:uuid', (req, res) => {
  const u = state.users.find((x) => x.uuid === req.params.uuid);
  if (!u) return res.status(404).send('not found');
  const domain = domainOf(req);
  const content = Buffer.from(linkFor(u, domain, state.wsPath), 'utf8').toString('base64');
  res.set('Content-Type', 'text/plain; charset=utf-8').send(content);
});

app.get('/healthz', (_req, res) => res.send('ok'));

// پنل فقط روی localhost گوش می‌دهد؛ Xray روی پورت عمومی نشسته و ترافیک را به اینجا fallback می‌کند
app.listen(xray.PANEL_PORT, '127.0.0.1', () => {
  console.log('====================================================');
  console.log(` پنل داخلی روی 127.0.0.1:${xray.PANEL_PORT}`);
  console.log(` رمز ورود پنل (ADMIN PASSWORD): ${ADMIN_PASSWORD}`);
  console.log('  (برای رمز ثابت، متغیر محیطی ADMIN_PASSWORD را ست کنید)');
  console.log('====================================================');
});
