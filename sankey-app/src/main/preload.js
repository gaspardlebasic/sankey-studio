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
  // options.save : demander à Excel d'enregistrer après une écriture à chaud.
  writeExcel: (model, filePath, sheetName, options) =>
    ipcRenderer.invoke("excel:write", model, filePath, sheetName, options),
  readExcel: (filePath, sheetName) =>
    ipcRenderer.invoke("excel:read", filePath, sheetName),
  watchExcel: filePath => ipcRenderer.invoke("excel:watch", filePath),
  isExcelLocked: filePath => ipcRenderer.invoke("excel:isLocked", filePath),
  closeExcelWorkbook: filePath => ipcRenderer.invoke("excel:closeInExcel", filePath),
  canControlExcel: ["darwin", "win32"].includes(process.platform),
  exportSave: (name, data, binary) =>
    ipcRenderer.invoke("export:save", name, data, binary),
  onExcelChanged: cb => ipcRenderer.on("excel:changed", () => cb()),
  onExcelLock: cb => ipcRenderer.on("excel:lock", (_e, payload) => cb(payload))
});
