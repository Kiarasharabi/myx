const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const XRAY_BIN = process.env.XRAY_BIN || path.join(__dirname, '..', 'bin', 'xray');
const CONFIG_PATH = path.join(os.tmpdir(), 'xray-config.json');
const PUBLIC_PORT = Number(process.env.PORT) || 3000; // پورتی که Railway بیرون می‌دهد
// پورت‌های داخلی (فقط localhost) — حتماً باید با پورت عمومی فرق کنند
let PANEL_PORT = 8090; // پنل داخلی
let WS_INTERNAL_PORT = 10001; // اینباند WebSocket داخلی
if (PANEL_PORT === PUBLIC_PORT) PANEL_PORT = PUBLIC_PORT + 3;
if (WS_INTERNAL_PORT === PUBLIC_PORT) WS_INTERNAL_PORT = PUBLIC_PORT + 7;

let proc = null;
let currentState = null;
let stopping = false;

// ساخت کانفیگ Xray از روی وضعیت فعلی کاربران
function buildConfig(state) {
  const clients = state.users.map((u) => ({ id: u.uuid, level: 0, email: u.name }));
  return {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        // اینباند اصلی روی پورت عمومی: خام (tcp) تا بتواند مسیر را بازرسی و fallback کند
        tag: 'gateway',
        listen: '0.0.0.0',
        port: PUBLIC_PORT,
        protocol: 'vless',
        settings: {
          clients,
          decryption: 'none',
          fallbacks: [
            { dest: PANEL_PORT }, // پیش‌فرض: پنل وب
            { path: state.wsPath, dest: WS_INTERNAL_PORT }, // مسیر مخفی: پروکسی
          ],
        },
        streamSettings: { network: 'tcp', security: 'none' },
      },
      {
        // اینباند واقعی VLESS روی WebSocket (فقط داخلی)
        tag: 'proxy',
        listen: '127.0.0.1',
        port: WS_INTERNAL_PORT,
        protocol: 'vless',
        settings: { clients, decryption: 'none' },
        streamSettings: {
          network: 'ws',
          security: 'none',
          wsSettings: { path: state.wsPath },
        },
      },
    ],
    outbounds: [
      { protocol: 'freedom', tag: 'direct' },
      { protocol: 'blackhole', tag: 'block' },
    ],
  };
}

function start(state) {
  currentState = state;
  const config = buildConfig(state);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  if (!fs.existsSync(XRAY_BIN)) {
    console.warn(`[xray] باینری در ${XRAY_BIN} پیدا نشد — پروکسی غیرفعال است (حالت توسعه‌ی محلی).`);
    return;
  }

  if (proc) {
    proc.removeAllListeners();
    try { proc.kill('SIGKILL'); } catch (_) {}
    proc = null;
  }

  proc = spawn(XRAY_BIN, ['run', '-c', CONFIG_PATH], { stdio: 'inherit' });
  proc.on('exit', (code) => {
    if (stopping) return;
    console.error(`[xray] با کد ${code} بسته شد؛ ۲ ثانیه دیگر دوباره اجرا می‌شود.`);
    setTimeout(() => start(currentState), 2000);
  });
  console.log(`[xray] اجرا شد روی پورت ${PUBLIC_PORT} (مسیر WS: ${state.wsPath})`);
}

function restart(state) {
  start(state);
}

module.exports = { start, restart, PANEL_PORT, PUBLIC_PORT };
