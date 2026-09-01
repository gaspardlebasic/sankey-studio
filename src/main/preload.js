"use strict";

const { contextBridge, ipcRenderer, clipboard } = require("electron");

// Pont sécurisé exposé au renderer, en regard de src/addin/pont.ts qui offre le
// MÊME contrat au-dessus d'Office.js. Le renderer ne teste pas la plateforme :
// il consulte `capacites` (cf. `caps()` dans src/renderer/editor.ts).
contextBridge.exposeInMainWorld("desktop", {
  isElectron: true,
  capacites: {
    fichiers: true,               // dialogues natifs, projets .sankey, .xlsx choisi
    excel: true,
    classeurImpose: false,        // le classeur se choisit
    classeurVerrouillable: true,  // Excel peut le tenir : garde-fou d'édition
    // Une écriture à chaud coûte ~1 s et ferait téléverser OneDrive à chaque
    // frappe : l'envoi reste explicite (« App → Excel »).
    envoiAutomatique: false,
    apparenceDansClasseur: false  // l'apparence vit dans le fichier .sankey
  },
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
  copyToClipboard: text => ipcRenderer.invoke("clipboard:write", text),
  excelFormulas: (filePath, sheetName) =>
    ipcRenderer.invoke("excel:formulas", filePath, sheetName),
  exportSave: (name, data, binary) =>
    ipcRenderer.invoke("export:save", name, data, binary),
  // Fichier .sankey ouvert par double-clic (au démarrage, puis à chaud).
  pendingProject: () => ipcRenderer.invoke("project:pending"),
  onProjectOpened: cb => ipcRenderer.on("project:opened", (_e, payload) => cb(payload)),
  onExcelChanged: cb => ipcRenderer.on("excel:changed", () => cb()),
  onExcelLock: cb => ipcRenderer.on("excel:lock", (_e, payload) => cb(payload))
});
