/**
 * 开发用：启动客户端并截图，便于验证 UI。
 * 用法：npx electron tools/shot.js
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

require('../main.js');

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const img = await win.webContents.capturePage();
        const out = path.join(__dirname, '..', 'shot.png');
        fs.writeFileSync(out, img.toPNG());
        console.log('SHOT_SAVED', out);
      } catch (err) {
        console.error('SHOT_FAIL', err);
      }
      app.quit();
    }, 5000);
  });
});
