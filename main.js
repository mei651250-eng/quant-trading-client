'use strict';

const { app, BrowserWindow, ipcMain, shell, Menu, Tray, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

const APP_NAME = '量化交易客户端';

/* ------------------------------------------------------------------ *
 * 服务定义：客户端只做「跳板 + 启动器」，各系统仍独立运行
 * ------------------------------------------------------------------ */
const SERVICES = [
  {
    id: 'quant',
    name: '币安量化 · 交易',
    short: '币安量化',
    port: 8802,
    url: 'http://127.0.0.1:8802',
    desc: '加密币模拟/实盘交易 · SSE 实时推送',
    dir: 'binance-quant',
    args: ['app.py'],
    kind: 'python',
  },
  {
    id: 'htf',
    name: 'HTF 型态终端',
    short: 'HTF 终端',
    port: 8800,
    url: 'http://127.0.0.1:8800',
    desc: '高涨旗型形态检测与下单',
    dir: path.join('htf', 'webapp'),
    args: ['app.py'],
    kind: 'python',
  },
  {
    id: 'ai',
    name: 'AI 决策 · 分析',
    short: 'AI 决策',
    port: 3000,
    url: 'http://localhost:3000',
    desc: 'TradingAgents 多智能体 + Kronos 预测',
    dir: path.join('ai_engines', 'tradingagents'),
    args: null,
    kind: 'docker',
    dockerArgs: ['compose', 'up', '-d'],
  },
];

// 只做健康探测、不提供界面的附属服务
const EXTRAS = [
  { id: 'backend', name: 'AI 后端 API', port: 8000 },
  {
    id: 'kronos',
    name: 'Kronos 预测服务',
    port: 8001,
    dir: path.join('ai_engines', 'kronos', 'kronos_service'),
    args: ['-m', 'uvicorn', 'app:app', '--host', '0.0.0.0', '--port', '8001'],
    kind: 'python',
  },
];

/* ------------------------------------------------------------------ *
 * 配置：服务代码所在根目录（打包后不随客户端分发，由用户指定）
 * ------------------------------------------------------------------ */
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');
const LOG_DIR = () => path.join(app.getPath('userData'), 'logs');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  const cfg = { ...readConfig(), ...patch };
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true });
    fs.writeFileSync(CONFIG_PATH(), JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    console.error('写配置失败', e);
  }
  return cfg;
}

function looksLikeRoot(dir) {
  if (!dir) return false;
  try {
    return (
      fs.existsSync(path.join(dir, 'binance-quant')) &&
      fs.existsSync(path.join(dir, 'htf', 'webapp'))
    );
  } catch {
    return false;
  }
}

function guessRoots() {
  const cands = [];
  if (process.env.QUANT_SERVICES_ROOT) cands.push(process.env.QUANT_SERVICES_ROOT);
  const cfg = readConfig();
  if (cfg.servicesRoot) cands.push(cfg.servicesRoot);

  // 开发态：desktop-client 与 deliverables 同级
  cands.push(path.resolve(__dirname, '..', 'deliverables'));
  cands.push(path.resolve(__dirname, 'deliverables'));
  // 便携版：exe 同级目录
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    cands.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'deliverables'));
  }
  cands.push(path.resolve('D:/Trae CN/2026-10-04-17-11-31/deliverables'));
  cands.push(path.join(app.getPath('documents'), 'deliverables'));
  return cands;
}

function resolveRoot() {
  for (const c of guessRoots()) {
    if (looksLikeRoot(c)) return c;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 端口探测
 * ------------------------------------------------------------------ */
function checkPort(port, timeout = 900) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    try {
      sock.connect(port, '127.0.0.1');
    } catch {
      finish(false);
    }
  });
}

async function collectStatus() {
  const root = resolveRoot();
  const out = [];
  for (const s of [...SERVICES, ...EXTRAS]) {
    out.push({
      id: s.id,
      name: s.name,
      port: s.port,
      running: await checkPort(s.port),
      dirExists: s.dir && root ? fs.existsSync(path.join(root, s.dir)) : null,
    });
  }
  return { root, services: out };
}

/* ------------------------------------------------------------------ *
 * 启动服务
 * ------------------------------------------------------------------ */
function openLog(id) {
  try {
    fs.mkdirSync(LOG_DIR(), { recursive: true });
    const p = path.join(LOG_DIR(), `${id}.log`);
    return { path: p, fd: fs.openSync(p, 'a') };
  } catch {
    return { path: null, fd: 'ignore' };
  }
}

function startService(id) {
  return new Promise((resolve) => {
    const def = [...SERVICES, ...EXTRAS].find((s) => s.id === id);
    if (!def) return resolve({ ok: false, message: '未知服务' });

    const root = resolveRoot();
    if (!root) {
      return resolve({
        ok: false,
        message: '未找到服务代码目录，请在「设置」中指定 deliverables 路径',
      });
    }
    if (!def.dir) return resolve({ ok: false, message: '该服务不支持从客户端启动' });

    const cwd = path.join(root, def.dir);
    if (!fs.existsSync(cwd)) {
      return resolve({ ok: false, message: `目录不存在：${cwd}` });
    }

    const { path: logPath, fd } = openLog(id);
    const stamp = new Date().toISOString();
    fs.writeFileSync(logPath, `\n===== ${stamp} start ${id} (${cwd}) =====\n`, { flag: 'a' });

    try {
      let child;
      if (def.kind === 'docker') {
        child = spawn('docker', def.dockerArgs, {
          cwd,
          detached: true,
          stdio: ['ignore', fd, fd],
          windowsHide: true,
        });
      } else {
        const py = process.env.QUANT_PYTHON || 'python';
        child = spawn(py, def.args, {
          cwd,
          detached: true,
          stdio: ['ignore', fd, fd],
          windowsHide: true,
        });
      }
      child.on('error', (e) => {
        resolve({ ok: false, message: `启动失败：${e.message}` });
      });
      child.unref();
      // 给进程一点时间，稍后由前端轮询状态确认
      setTimeout(() => resolve({ ok: true, message: '已下发启动命令', log: logPath }), 300);
    } catch (e) {
      resolve({ ok: false, message: `启动异常：${e.message}` });
    }
  });
}

/* ------------------------------------------------------------------ *
 * 窗口
 * ------------------------------------------------------------------ */
let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#0b0f14',
    title: APP_NAME,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 外链一律用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开服务代码目录',
          click: () => {
            const root = resolveRoot();
            if (root) shell.openPath(root);
            else dialog.showMessageBox({ message: '未找到服务代码目录，请在客户端设置中指定。' });
          },
        },
        { type: 'separator' },
        { label: '退出', accelerator: 'Ctrl+Q', role: 'quit' },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '刷新当前页',
          accelerator: 'F5',
          click: () => mainWindow && mainWindow.webContents.send('ui:refresh'),
        },
        {
          label: '全屏',
          accelerator: 'F11',
          click: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen()),
        },
        { type: 'separator' },
        { label: '开发者工具', accelerator: 'Ctrl+Shift+I', role: 'toggleDevTools' },
        { label: '重置缩放', accelerator: 'Ctrl+0', role: 'resetZoom' },
      ],
    },
    {
      label: '服务',
      submenu: [
        {
          label: '全部启动',
          click: async () => {
            for (const s of SERVICES) await startService(s.id);
            if (mainWindow) mainWindow.webContents.send('ui:refresh');
          },
        },
        { type: 'separator' },
        ...SERVICES.map((s) => ({
          label: `启动 ${s.name}`,
          click: () => startService(s.id),
        })),
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于',
              message: `${APP_NAME} v${app.getVersion()}`,
              detail:
                '在一个窗口内切换多个本地量化系统。\n\n' +
                '各系统仍独立运行，客户端只做聚合与启动管理。\n' +
                '服务代码目录可在客户端「设置」中修改。',
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'build', 'tray.png');
    const img = nativeImage.createFromPath(iconPath);
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
    tray.setToolTip(APP_NAME);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示窗口', click: () => (mainWindow ? mainWindow.show() : createWindow()) },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ])
    );
    tray.on('double-click', () => (mainWindow ? mainWindow.show() : createWindow()));
  } catch (e) {
    console.error('托盘创建失败', e);
  }
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */
ipcMain.handle('svc:status', async () => collectStatus());
ipcMain.handle('svc:start', async (_e, id) => startService(id));
ipcMain.handle('svc:startAll', async () => {
  const res = [];
  for (const s of SERVICES) res.push({ id: s.id, ...(await startService(s.id)) });
  return res;
});
ipcMain.handle('cfg:get', async () => {
  const root = resolveRoot();
  return { root, configPath: CONFIG_PATH(), version: app.getVersion() };
});
ipcMain.handle('cfg:chooseRoot', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择 deliverables 目录（包含 binance-quant、htf 的目录）',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  const dir = r.filePaths[0];
  if (!looksLikeRoot(dir)) {
    return {
      ok: false,
      message: '该目录下没有找到 binance-quant 与 htf/webapp，请确认选择的是 deliverables 目录',
    };
  }
  writeConfig({ servicesRoot: dir });
  return { ok: true, root: dir };
});
ipcMain.handle('shell:open', async (_e, url) => {
  if (/^https?:/.test(url)) await shell.openExternal(url);
  return true;
});
ipcMain.handle('shell:openLog', async (_e, id) => {
  const p = path.join(LOG_DIR(), `${id}.log`);
  if (fs.existsSync(p)) return shell.openPath(p);
  return '暂无日志';
});

/* ------------------------------------------------------------------ *
 * 生命周期
 * ------------------------------------------------------------------ */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
