'use strict';

/* ------------------------------------------------------------------ *
 * 系统定义（与主进程 main.js 保持一致）
 * ------------------------------------------------------------------ */
const MAIN = [
  {
    id: 'quant', name: '币安量化 · 交易', short: '币安量化', port: 8802,
    url: 'http://127.0.0.1:8802',
    desc: '加密币模拟/实盘交易 · SSE 实时推送',
    cmd: 'cd deliverables/binance-quant && python app.py',
  },
  {
    id: 'htf', name: 'HTF 型态终端', short: 'HTF 终端', port: 8800,
    url: 'http://127.0.0.1:8800',
    desc: '高涨旗型形态检测与下单',
    cmd: 'cd deliverables/htf/webapp && python app.py',
  },
  {
    id: 'ai', name: 'AI 决策 · 分析', short: 'AI 决策', port: 3000,
    url: 'http://localhost:3000',
    desc: 'TradingAgents 多智能体 + Kronos 预测',
    cmd: 'cd deliverables/ai_engines/tradingagents && docker compose up -d',
  },
];

const EXTRA = [
  { id: 'backend', name: 'AI 后端 API', port: 8000 },
  { id: 'kronos', name: 'Kronos 预测', port: 8001 },
];

const state = {
  running: {},        // id -> bool
  active: MAIN[0].id,
  loaded: {},         // id -> webview 是否已设 src
  starting: {},       // id -> bool
};

const $ = (sel) => document.querySelector(sel);
const sysListEl = $('#sysList');
const extraListEl = $('#extraList');
const stageEl = $('#stage');

/* ------------------------------------------------------------------ *
 * 构建侧栏 + 视图
 * ------------------------------------------------------------------ */
function buildSidebar() {
  sysListEl.innerHTML = '';
  MAIN.forEach((s) => {
    const item = document.createElement('div');
    item.className = 'sys-item';
    item.dataset.id = s.id;
    item.innerHTML = `
      <span class="led" id="led-${s.id}"></span>
      <div class="meta">
        <div class="nm">${s.short}</div>
        <div class="pt">:${s.port}</div>
      </div>`;
    item.onclick = () => activate(s.id);
    sysListEl.appendChild(item);
  });

  extraListEl.innerHTML = '';
  EXTRA.forEach((s) => {
    const item = document.createElement('div');
    item.className = 'extra-item';
    item.innerHTML = `
      <span class="led" id="led-${s.id}"></span>
      <span class="nm">${s.name}</span>
      <span class="pt">:${s.port}</span>`;
    extraListEl.appendChild(item);
  });
}

function buildViews() {
  stageEl.innerHTML = '';
  MAIN.forEach((s) => {
    const view = document.createElement('div');
    view.className = 'view';
    view.id = 'view-' + s.id;

    const wv = document.createElement('webview');
    wv.setAttribute('id', 'wv-' + s.id);
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('partition', 'persist:' + s.id);   // 各自独立会话，登录态可保留
    wv.style.display = 'none';
    view.appendChild(wv);

    // 离线遮罩
    const off = document.createElement('div');
    off.className = 'offline';
    off.id = 'off-' + s.id;
    off.innerHTML = `
      <div class="big">${s.name} 未启动</div>
      <div class="sub">端口 <code>${s.port}</code> 未监听。${s.desc}<br>
        可点击下方按钮一键启动，或手动执行：<br><code>${s.cmd}</code></div>
      <div class="row">
        <button class="btn btn-primary" data-start="${s.id}">启动该服务</button>
        <button class="btn btn-ghost" data-log="${s.id}">查看日志</button>
      </div>`;
    view.appendChild(off);

    off.querySelector('[data-start]').onclick = () => startService(s.id);
    off.querySelector('[data-log]').onclick = () => window.api.openLog(s.id);

    stageEl.appendChild(view);
  });
}

/* ------------------------------------------------------------------ *
 * 切换 / 加载
 * ------------------------------------------------------------------ */
function activate(id) {
  state.active = id;
  const sys = MAIN.find((s) => s.id === id);

  document.querySelectorAll('.sys-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === id);
  });
  document.querySelectorAll('.view').forEach((el) => {
    el.classList.toggle('active', el.id === 'view-' + id);
  });

  $('#curName').textContent = sys.name;
  $('#curUrl').textContent = sys.url;
  const led = $('#curLed');
  led.className = 'led ' + (state.running[id] ? 'on' : 'off');

  if (state.running[id]) loadWebview(id);
}

function loadWebview(id) {
  if (state.loaded[id]) return;
  const sys = MAIN.find((s) => s.id === id);
  const wv = document.getElementById('wv-' + id);
  if (!wv) return;
  wv.setAttribute('src', sys.url);
  wv.style.display = 'inline-flex';
  state.loaded[id] = true;

  wv.addEventListener('did-fail-load', (e) => {
    // -3 是被主动中断，忽略
    if (e.errorCode === -3) return;
    state.loaded[id] = false;
    wv.style.display = 'none';
    const off = document.getElementById('off-' + id);
    if (off) {
      off.style.display = 'flex';
      off.querySelector('.big').textContent = `${sys.name} 连接失败`;
      off.querySelector('.sub').innerHTML =
        `错误：${e.errorDescription || e.errorCode}<br>请确认服务已启动并监听 <code>${sys.port}</code>`;
    }
  });
}

/* ------------------------------------------------------------------ *
 * 状态刷新
 * ------------------------------------------------------------------ */
async function refreshStatus(silent = true) {
  let res;
  try {
    res = await window.api.status();
  } catch (e) {
    if (!silent) toast('状态获取失败：' + e.message);
    return;
  }

  const map = {};
  (res.services || []).forEach((s) => (map[s.id] = s));

  MAIN.concat(EXTRA).forEach((s) => {
    const info = map[s.id];
    const running = !!(info && info.running);
    state.running[s.id] = running;

    const led = document.getElementById('led-' + s.id);
    if (led) {
      led.className = 'led ' + (state.starting[s.id] ? 'wait' : running ? 'on' : 'off');
    }

    if (MAIN.includes(s)) {
      const off = document.getElementById('off-' + s.id);
      if (off) off.style.display = running ? 'none' : 'flex';
      if (running && state.active === s.id) loadWebview(s.id);
      if (!running && state.loaded[s.id]) {
        // 服务掉了：隐藏 webview，回到遮罩
        const wv = document.getElementById('wv-' + s.id);
        if (wv) { wv.style.display = 'none'; }
        state.loaded[s.id] = false;
      }
    }
  });

  const curLed = $('#curLed');
  if (curLed) curLed.className = 'led ' + (state.running[state.active] ? 'on' : 'off');

  const hint = $('#rootHint');
  if (hint) {
    hint.textContent = res.root ? '服务目录：' + res.root : '⚠ 未找到服务目录，请到「设置」指定';
    hint.title = res.root || '';
  }
}

/* ------------------------------------------------------------------ *
 * 启动服务
 * ------------------------------------------------------------------ */
async function startService(id) {
  state.starting[id] = true;
  const led = document.getElementById('led-' + id);
  if (led) led.className = 'led wait';

  toast('正在启动 ' + (MAIN.find((s) => s.id === id)?.short || id) + ' …');
  const r = await window.api.start(id);
  if (!r.ok) {
    state.starting[id] = false;
    toast('启动失败：' + r.message, 4200);
    await refreshStatus();
    return;
  }

  // 轮询等待端口起来
  let tries = 0;
  const timer = setInterval(async () => {
    tries += 1;
    await refreshStatus();
    if (state.running[id] || tries >= 20) {
      clearInterval(timer);
      state.starting[id] = false;
      if (state.running[id]) {
        toast('已就绪：' + (MAIN.find((s) => s.id === id)?.short || id));
        if (state.active === id) loadWebview(id);
      } else {
        toast('启动超时，请点「查看日志」排查', 4200);
      }
      await refreshStatus();
    }
  }, 1500);
}

/* ------------------------------------------------------------------ *
 * 交互
 * ------------------------------------------------------------------ */
$('#btnReload').onclick = () => {
  const wv = document.getElementById('wv-' + state.active);
  if (wv && state.loaded[state.active]) wv.reload();
  else refreshStatus(false);
};

$('#btnExternal').onclick = () => {
  const sys = MAIN.find((s) => s.id === state.active);
  if (sys) window.api.openExternal(sys.url);
};

$('#btnStartAll').onclick = async () => {
  toast('正在启动全部服务…');
  await window.api.startAll();
  let tries = 0;
  const timer = setInterval(async () => {
    tries += 1;
    await refreshStatus();
    const allUp = MAIN.every((s) => state.running[s.id]);
    if (allUp || tries >= 24) {
      clearInterval(timer);
      toast(allUp ? '全部服务已就绪' : '部分服务未就绪，请在对应页查看', 4000);
    }
  }, 1500);
};

$('#btnSettings').onclick = async () => {
  const cfg = await window.api.config();
  $('#rootPath').textContent = cfg.root || '未设置';
  $('#verText').textContent = 'v' + (cfg.version || '1.0.0');
  $('#modal').classList.remove('hidden');
};

$('#btnCloseModal').onclick = () => $('#modal').classList.add('hidden');

$('#btnChooseRoot').onclick = async () => {
  const r = await window.api.chooseRoot();
  if (r.ok) {
    $('#rootPath').textContent = r.root;
    toast('目录已更新');
    await refreshStatus(true);
  } else if (r.message) {
    toast(r.message, 4200);
  }
};

window.addEventListener('keydown', (e) => {
  if (e.key === 'F5') {
    e.preventDefault();
    $('#btnReload').click();
  }
  if (e.key === 'Escape') $('#modal').classList.add('hidden');
});

/* toast */
let toastTimer = null;
function toast(msg, ms = 2400) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/* 主进程触发刷新 */
if (window.api.onRefresh) window.api.onRefresh(() => $('#btnReload').click());

/* 时钟 */
setInterval(() => {
  const d = new Date();
  $('#clock').textContent =
    d.toLocaleTimeString('zh-CN', { hour12: false }) + ' · ' + d.toLocaleDateString('zh-CN');
}, 1000);

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
buildSidebar();
buildViews();
activate(MAIN[0].id);
refreshStatus();
setInterval(() => refreshStatus(), 8000);
