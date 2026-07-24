"use strict";

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { writeDiagram, readDiagram, isWorkbookLocked } = require("./excel");

let excelWatcher = null;
let lastWriteTs = 0;
let lockPresent = false;
let notifyTimer = null;

function startExcelWatch(win, filePath) {
  stopExcelWatch();
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  lockPresent = isWorkbookLocked(filePath);
  try {
    excelWatcher = fs.watch(dir, (_evt, fname) => {
      const nowLock = isWorkbookLocked(filePath);
      if (nowLock !== lockPresent) {
        lockPresent = nowLock;
        win.webContents.send("excel:lock", { locked: nowLock });
      }
      if (fname === base && Date.now() - lastWriteTs > 1500) {
        clearTimeout(notifyTimer);
        notifyTimer = setTimeout(() => win.webContents.send("excel:changed"), 300);
      }
    });
  } catch (e) {
    /* dossier non surveillable : ignoré */
  }
}
function stopExcelWatch() {
  if (excelWatcher) {
    excelWatcher.close();
    excelWatcher = null;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    title: "Sankey Studio",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(app.getAppPath(), "dist/renderer/index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* ------------------------------------------------------------------ */
/* Projet : enregistrement / ouverture (fichier .sankey = JSON)       */
/* ------------------------------------------------------------------ */

ipcMain.handle("project:save", async (_e, jsonString, currentPath) => {
  let filePath = currentPath;
  if (!filePath) {
    const r = await dialog.showSaveDialog({
      title: "Enregistrer le projet",
      defaultPath: "diagramme.sankey",
      filters: [{ name: "Projet Sankey", extensions: ["sankey", "json"] }]
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    filePath = r.filePath;
  }
  fs.writeFileSync(filePath, jsonString, "utf8");
  return { canceled: false, path: filePath };
});

ipcMain.handle("project:open", async () => {
  const r = await dialog.showOpenDialog({
    title: "Ouvrir un projet",
    properties: ["openFile"],
    filters: [{ name: "Projet Sankey", extensions: ["sankey", "json"] }]
  });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const content = fs.readFileSync(r.filePaths[0], "utf8");
  return { canceled: false, path: r.filePaths[0], content };
});

/* ------------------------------------------------------------------ */
/* Pont Excel                                                         */
/* ------------------------------------------------------------------ */

// Nouveau classeur (ou emplacement d'enregistrement)
ipcMain.handle("excel:choose", async () => {
  const r = await dialog.showSaveDialog({
    title: "Nouveau classeur Excel",
    defaultPath: "diagramme-flux.xlsx",
    filters: [{ name: "Classeur Excel", extensions: ["xlsx"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"]
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  return { canceled: false, path: r.filePath };
});

// Ouvrir un classeur EXISTANT
ipcMain.handle("excel:openExisting", async () => {
  const r = await dialog.showOpenDialog({
    title: "Ouvrir un classeur Excel existant",
    filters: [{ name: "Classeur Excel", extensions: ["xlsx"] }],
    properties: ["openFile"]
  });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  return { canceled: false, path: r.filePaths[0] };
});

// Écriture (création ou mise à jour de l'onglet géré) du diagramme.
// IMPORTANT : si Excel tient le classeur ouvert (verrou « ~$… »), on n'écrit
// PAS : sur macOS l'écriture réussirait sur le disque, mais Excel garde sa
// copie en mémoire et écraserait tout à sa prochaine sauvegarde (perte des
// couleurs & co). On renvoie « locked » -> l'app diffère l'écriture jusqu'à
// la fermeture du classeur.
ipcMain.handle("excel:write", async (_e, model, filePath, sheetName) => {
  try {
    if (fs.existsSync(filePath) && isWorkbookLocked(filePath)) {
      return { ok: false, error: "Classeur ouvert dans Excel", locked: true };
    }
    lastWriteTs = Date.now();
    const res = await writeDiagram(filePath, model, sheetName || "Diagramme");
    lastWriteTs = Date.now();
    return { ok: true, path: res.path, sheetName: res.sheetName };
  } catch (err) {
    const msg = String((err && err.message) || err);
    const locked = /EBUSY|EACCES|EPERM|resource busy|locked/i.test(msg);
    return { ok: false, error: msg, locked };
  }
});

// Lecture du diagramme depuis le classeur
ipcMain.handle("excel:read", async (_e, filePath, sheetName) => {
  try {
    const data = await readDiagram(filePath, sheetName || "Diagramme");
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Export d'image (PNG binaire base64, ou SVG texte)
ipcMain.handle("export:save", async (_e, defaultName, data, binary) => {
  const ext = defaultName.split(".").pop();
  const r = await dialog.showSaveDialog({
    title: "Exporter le Sankey",
    defaultPath: defaultName,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  try {
    if (binary) fs.writeFileSync(r.filePath, Buffer.from(data, "base64"));
    else fs.writeFileSync(r.filePath, data, "utf8");
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Surveillance du classeur (changements externes + verrou)
ipcMain.handle("excel:watch", (e, filePath) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && filePath) startExcelWatch(win, filePath);
  return true;
});
