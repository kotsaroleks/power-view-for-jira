/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("powerViewDesktop", {
  connect: (credentials) => ipcRenderer.invoke("desktop:connect", credentials),
  disconnect: () => ipcRenderer.invoke("desktop:disconnect"),
  hasConnection: () => ipcRenderer.invoke("desktop:has-connection"),
  sendMessage: (message) => ipcRenderer.invoke("desktop:message", message),
  storageGet: (keys) => ipcRenderer.invoke("desktop:storage-get", keys),
  storageSet: (items) => ipcRenderer.invoke("desktop:storage-set", items),
  storageRemove: (keys) => ipcRenderer.invoke("desktop:storage-remove", keys),
});
