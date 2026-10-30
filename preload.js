'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 服务状态
  status: () => ipcRenderer.invoke('svc:status'),
  start: (id) => ipcRenderer.invoke('svc:start', id),
  startAll: () => ipcRenderer.invoke('svc:startAll'),

  // 配置
  config: () => ipcRenderer.invoke('cfg:get'),
  chooseRoot: () => ipcRenderer.invoke('cfg:chooseRoot'),

  // 壳能力
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  openLog: (id) => ipcRenderer.invoke('shell:openLog', id),

  // 主进程 → 渲染进程
  onRefresh: (cb) => ipcRenderer.on('ui:refresh', () => cb()),
});
