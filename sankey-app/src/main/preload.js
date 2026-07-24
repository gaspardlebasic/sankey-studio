"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Pont sécurisé exposé au renderer. Le pont Excel sera ajouté ici (étape 3).
contextBridge.exposeInMainWorld("desktop", {
  isElectron: true,
  saveProject: (jsonString, currentPath) =>
    ipcRenderer.invoke("project:save", jsonString, currentPath),
  openProject: () => ipcRenderer.invoke("project:open"),
  chooseExcel: () => ipcRenderer.invoke("excel:choose"),
  openExistingExcel: () => ipcRenderer.invoke("excel:openExisting"),
  writeExcel: (model, filePath, sheetName) =>
    ipcRenderer.invoke("excel:write", model, filePath, sheetName),
  readExcel: (filePath, sheetName) =>
    ipcRenderer.invoke("excel:read", filePath, sheetName),
  watchExcel: filePath => ipcRenderer.invoke("excel:watch", filePath),
  exportSave: (name, data, binary) =>
    ipcRenderer.invoke("export:save", name, data, binary),
  onExcelChanged: cb => ipcRenderer.on("excel:changed", () => cb()),
  onExcelLock: cb => ipcRenderer.on("excel:lock", (_e, payload) => cb(payload))
});
