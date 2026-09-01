"use strict";

/**
 * `window.desktop` pour les BANCS ELECTRON (`tests/run.js`, `scripts/smoke.js`).
 *
 * Ce n'est pas une coquille du produit : Sankey Studio est un complément Excel,
 * et son seul vrai pont est `src/addin/pont.ts`. Electron ne sert plus ici que
 * de navigateur pilotable — c'est le seul moyen de conduire l'éditeur par de
 * vrais évènements souris/clavier, ce qu'aucun banc HTML ne permet.
 *
 * Il déclare donc les MÊMES capacités que le volet, au-dessus de bouchons IPC
 * tenus par le banc. Si le contrat de `pont.ts` change, il change ici aussi,
 * sinon les tests éprouveraient un contrat qui n'existe plus.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  capacites: {
    excel: true,
    envoiAutomatique: true
  },
  nomClasseur: "Classeur d'essai.xlsx",
  readExcel: () => ipcRenderer.invoke("excel:read"),
  writeExcel: (model, chemin, feuille, options) =>
    ipcRenderer.invoke("excel:write", model, chemin, feuille, options),
  onExcelChanged: cb => ipcRenderer.on("excel:changed", () => cb()),
  lireApparence: () => ipcRenderer.invoke("apparence:lire"),
  ecrireApparence: json => ipcRenderer.invoke("apparence:ecrire", json)
});
