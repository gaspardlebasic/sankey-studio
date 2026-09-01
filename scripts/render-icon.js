// Rend build/icon.svg en PNG 1024 avec le moteur Chromium d'Electron
// (qlmanage rastérise les SVG trop grossièrement : courbes en escalier).
// Usage : npx electron scripts/render-icon.js
"use strict";
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "build/icon.svg");
const OUT = path.join(ROOT, "build/icon.png");
const SIZE = 1024;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE, height: SIZE, show: false,
    webPreferences: { offscreen: true },
    backgroundColor: "#00000000"
  });
  const html =
    "<style>html,body{margin:0;padding:0;background:transparent}" +
    `svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>` +
    fs.readFileSync(SRC, "utf8");
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 400)); // laisse le premier rendu se faire
  const img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());
  console.log("écrit :", OUT, img.getSize());
  app.quit();
});
