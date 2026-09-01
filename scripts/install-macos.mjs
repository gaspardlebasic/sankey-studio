// Installe le .app fraîchement construit dans /Applications.
// Appelé par « npm run install:app » (après electron-builder --dir).
import { existsSync, rmSync } from "fs";
import { execFileSync } from "child_process";

const SRC = "release/mac-arm64/Sankey Studio.app";
const DEST = "/Applications/Sankey Studio.app";

if (process.platform !== "darwin") {
  console.error("Cette commande est réservée à macOS.");
  process.exit(1);
}
if (!existsSync(SRC)) {
  console.error(`Introuvable : ${SRC}\nLance d'abord « npm run dist:dir ».`);
  process.exit(1);
}

// Remplacer une app en cours d'exécution laisse macOS avec un bundle incohérent :
// on la quitte d'abord. Gaspard a autorisé cette fermeture automatique (2026-08-20),
// y compris au prix d'un travail non enregistré.
function estOuverte() {
  try {
    execFileSync("pgrep", ["-f", "Sankey Studio.app/Contents/MacOS/"], { stdio: "pipe" });
    return true;
  } catch {
    return false; // pgrep sort en erreur quand rien ne correspond
  }
}
if (estOuverte()) {
  console.log("Sankey Studio est ouvert : fermeture…");
  // « quit » laisse d'abord l'app se terminer proprement.
  try { execFileSync("osascript", ["-e", 'quit app "Sankey Studio"'], { stdio: "pipe" }); } catch { /* ignoré */ }
  for (let i = 0; i < 20 && estOuverte(); i++) execFileSync("sleep", ["0.25"]);
  if (estOuverte()) {
    try { execFileSync("pkill", ["-f", "Sankey Studio.app/Contents/MacOS/"], { stdio: "pipe" }); } catch { /* ignoré */ }
    for (let i = 0; i < 20 && estOuverte(); i++) execFileSync("sleep", ["0.25"]);
  }
  if (estOuverte()) {
    console.error("Impossible de fermer Sankey Studio : ferme-la manuellement puis relance.");
    process.exit(1);
  }
}

if (existsSync(DEST)) rmSync(DEST, { recursive: true, force: true });
// ditto préserve les liens symboliques et les métadonnées du bundle (cp -R non).
execFileSync("ditto", [SRC, DEST], { stdio: "inherit" });
// Invalide le cache d'icônes de Finder/Dock, qui garderait sinon l'ancienne icône.
execFileSync("touch", [DEST]);
console.log(`Installé : ${DEST}`);
