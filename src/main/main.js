"use strict";

const { app, BrowserWindow, ipcMain, dialog, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const { writeDiagram, readDiagram, isWorkbookLocked, readValueFormulas } = require("./excel");
const { saveAndCloseInExcel, workbookState, forgetOpenState } = require("./excel-control");
const { writeDiagramLive, readDiagramLive } = require("./excel-live");

// Écrire dans le classeur ouvert suppose de piloter Excel : macOS et Windows.
const PILOTAGE = ["darwin", "win32"].includes(process.platform);

/**
 * Ajoute à l'état du classeur le drapeau « live » : l'app peut-elle écrire
 * dans le classeur pendant qu'Excel le tient ouvert ?
 *
 * Optimiste à dessein. On ne le vérifie pas par un aller-retour supplémentaire
 * vers Excel : si l'autorisation d'automatisation manque, l'écriture à chaud
 * rendra « denied » et l'app repassera par l'avertissement habituel.
 */
function avecPilotage(etat) {
  return Object.assign({}, etat, { live: PILOTAGE && !!etat.locked });
}

let excelWatcher = null;
let excelPoll = null;
let lastWriteTs = 0;
let lockPresent = false;
let notifyTimer = null;

async function pollExcelState(win, filePath) {
  forgetOpenState();
  const etat = await workbookState(filePath);
  if (etat.locked !== lockPresent) {
    lockPresent = etat.locked;
    if (!win.isDestroyed()) {
      win.webContents.send("excel:lock", avecPilotage(etat));
    }
  }
}

function startExcelWatch(win, filePath) {
  stopExcelWatch();
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  lockPresent = isWorkbookLocked(filePath);
  // fs.watch ne voit rien quand le classeur est sur OneDrive (aucun fichier
  // verrou n'y est créé) : on interroge Excel à intervalle régulier.
  excelPoll = setInterval(() => {
    pollExcelState(win, filePath).catch(() => { /* Excel muet : on réessaiera */ });
  }, 4000);
  pollExcelState(win, filePath).catch(() => { /* ignoré */ });
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
  if (excelPoll) {
    clearInterval(excelPoll);
    excelPoll = null;
  }
}

/* ------------------------------------------------------------------ */
/* Ouverture par double-clic sur un fichier .sankey                    */
/* ------------------------------------------------------------------ */

// Chemin reçu avant que la fenêtre ne sache l'accueillir. Le renderer vient
// le chercher (project:pending) dès qu'il est prêt.
let projetEnAttente = null;

function estFichierProjet(p) {
  return typeof p === "string" && /\.(sankey|json)$/i.test(p);
}

/** Premier argument de ligne de commande désignant un projet (Windows, Linux). */
function projetDansArgv(argv) {
  return argv.slice(1).find(a => !a.startsWith("-") && estFichierProjet(a)) || null;
}

/**
 * Achemine un fichier vers la fenêtre, ou le met en attente si le renderer
 * n'est pas encore là (cas du double-clic qui lance l'app).
 */
function ouvrirFichierProjet(filePath) {
  if (!estFichierProjet(filePath) || !fs.existsSync(filePath)) return;
  projetEnAttente = filePath;
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  // Page encore en cours de chargement : le renderer n'écoute pas encore.
  // Il viendra chercher le fichier lui-même via « project:pending ».
  if (win.webContents.isLoading()) return;
  const projet = litProjetEnAttente();
  if (projet) win.webContents.send("project:opened", projet);
}

/** Lit et consomme le fichier en attente. Renvoie null s'il n'y en a pas. */
function litProjetEnAttente() {
  const filePath = projetEnAttente;
  projetEnAttente = null;
  if (!filePath) return null;
  try {
    return { path: filePath, content: fs.readFileSync(filePath, "utf8") };
  } catch (e) {
    return null;
  }
}

// macOS : l'évènement peut survenir avant « ready », d'où l'inscription ici.
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  ouvrirFichierProjet(filePath);
});

// Windows / Linux : une seconde instance transmet son argument à la première.
if (process.platform !== "darwin") {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on("second-instance", (_e, argv) => {
      const f = projetDansArgv(argv);
      if (f) ouvrirFichierProjet(f);
    });
    projetEnAttente = projetDansArgv(process.argv);
  }
}

// Le renderer réclame le fichier à ouvrir au démarrage.
ipcMain.handle("project:pending", () => litProjetEnAttente());

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
//
// Deux chemins, selon qu'Excel tient le classeur ou non :
//
//  - classeur OUVERT dans Excel -> on demande à Excel d'écrire (excel-live.js).
//    Écrire le .xlsx sur le disque serait ici sans effet : Excel garde sa copie
//    en mémoire et l'écraserait à sa prochaine sauvegarde (c'était la cause de
//    la « perte des couleurs »), et pour un fichier SharePoint il n'ouvre même
//    pas la copie locale.
//  - classeur FERMÉ -> écriture directe du fichier (excel.js).
//
// Si l'écriture à chaud échoue (automatisation refusée, boîte de dialogue
// ouverte…), on renvoie « locked » comme avant : l'app avertit et diffère.
ipcMain.handle("excel:write", async (_e, model, filePath, sheetName, options) => {
  try {
    // Dernière ligne de défense : l'état vu par le renderer peut dater.
    const etat = await workbookState(filePath);
    if (etat.locked) {
      if (!PILOTAGE) {
        return { ok: false, error: "Classeur ouvert dans Excel", locked: true, mode: etat.mode };
      }
      const live = await writeDiagramLive(filePath, model, sheetName || "Diagramme", {
        save: !!(options && options.save)
      });
      if (live.ok) {
        // Si Excel a enregistré, le fichier vient de changer sous nos pieds :
        // on marque l'horodatage pour ne pas se notifier soi-même.
        if (live.save) lastWriteTs = Date.now();
        return {
          ok: true, live: true, path: filePath, sheetName: sheetName || "Diagramme",
          enregistre: live.save, formules: live.formules, ms: live.ms
        };
      }
      // « not-open » : Excel a fermé le classeur entre-temps -> on écrit le fichier.
      if (live.state !== "not-open" && live.state !== "not-running") {
        return {
          ok: false, error: "Classeur ouvert dans Excel", locked: true,
          mode: etat.mode, liveState: live.state, liveError: live.error
        };
      }
      forgetOpenState();
    }
    lastWriteTs = Date.now();
    const res = await writeDiagram(filePath, model, sheetName || "Diagramme");
    lastWriteTs = Date.now();
    return { ok: true, live: false, path: res.path, sheetName: res.sheetName };
  } catch (err) {
    const msg = String((err && err.message) || err);
    const locked = /EBUSY|EACCES|EPERM|resource busy|locked/i.test(msg);
    return { ok: false, error: msg, locked };
  }
});

// Lecture du diagramme depuis le classeur.
// Quand Excel tient le classeur, le .xlsx sur le disque est en retard sur ce
// que l'utilisatrice voit à l'écran (et, pour un fichier SharePoint, Excel ne
// l'a même pas ouvert) : on lit alors directement dans Excel.
ipcMain.handle("excel:read", async (_e, filePath, sheetName) => {
  try {
    if (PILOTAGE) {
      const etat = await workbookState(filePath);
      if (etat.locked) {
        const live = await readDiagramLive(filePath, sheetName || "Diagramme");
        if (live.ok) return { ok: true, live: true, data: live.data };
      }
    }
    const data = await readDiagram(filePath, sheetName || "Diagramme");
    return { ok: true, live: false, data };
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

// Formules « Valeur du flux » du classeur, pour la copie presse-papier
ipcMain.handle("excel:formulas", async (_e, filePath, sheetName) => {
  try {
    return { ok: true, formules: await readValueFormulas(filePath, sheetName || "Diagramme") };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Copie dans le presse-papier (format texte / TSV)
ipcMain.handle("clipboard:write", (_e, text) => {
  try {
    clipboard.writeText(text);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Surveillance du classeur (changements externes + verrou)
ipcMain.handle("excel:watch", (e, filePath) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && filePath) startExcelWatch(win, filePath);
  return { ok: true, locked: filePath ? isWorkbookLocked(filePath) : false };
});

ipcMain.handle("excel:isLocked", async (_e, filePath) => avecPilotage(await workbookState(filePath)));

// Demande à Excel d'enregistrer puis de fermer le classeur (option explicite
// de l'utilisateur). On revérifie le verrou ensuite : Excel met un instant à
// libérer le fichier ~$…, d'où les quelques tentatives espacées.
ipcMain.handle("excel:closeInExcel", async (_e, filePath) => {
  if (!filePath) return { ok: false, state: "error", error: "Aucun classeur." };
  const res = await saveAndCloseInExcel(filePath);
  forgetOpenState();
  if (!res.ok) return Object.assign(avecPilotage(await workbookState(filePath)), res);
  for (let i = 0; i < 12; i++) {
    forgetOpenState();
    const etat = await workbookState(filePath);
    if (!etat.locked) return Object.assign(avecPilotage(etat), res);
    await new Promise(r => setTimeout(r, 250));
  }
  return Object.assign(avecPilotage(await workbookState(filePath)), res);
});
