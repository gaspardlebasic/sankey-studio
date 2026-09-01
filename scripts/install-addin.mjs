#!/usr/bin/env node
/**
 * Charge le complément de côté dans Excel — macOS et Windows.
 *
 *   npm run addin:install               le complément DE DÉVELOPPEMENT (localhost:3000)
 *   npm run addin:install -- --enligne  le complément PUBLIÉ (aucun serveur local)
 *   npm run addin:install -- --sonde    la sonde (phases 0 et 6)
 *   npm run addin:install -- --retirer  retire les deux
 *
 * `--enligne` installe le manifeste de PRODUCTION (dist/addin/manifest.xml,
 * engendré par `npm run addin:manifeste`) : la page vient de l'hébergeur, donc
 * ni serveur local, ni certificat, ni dépôt sur le poste. C'est le mode de
 * diffusion de qui n'a pas les droits d'administration M365 — poste par poste,
 * mais sans rien demander à personne (DIFFUSION.md §6).
 *
 * Deux mécanismes, parce qu'Office n'en offre pas un seul :
 *
 *   macOS   — déposer le manifeste dans le dossier `wef` du conteneur d'Excel.
 *   Windows — inscrire le CHEMIN du manifeste sous la clé de développement
 *             `HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer`.
 *
 * Dans les deux cas : rien à l'échelle du système, rien qui demande des droits
 * d'administration, et rien qui survive à un retrait. Si une stratégie
 * d'entreprise verrouille la clé du Registre, le repli documenté par Microsoft
 * est le **catalogue de confiance** — un dossier PARTAGÉ (chemin UNC) déclaré
 * dans le Centre de gestion de la confidentialité ; le script l'explique.
 *
 * Le chemin Windows n'a **jamais été exécuté** : c'est l'objet de la phase 6.
 */

import { copyFileSync, mkdirSync, existsSync, rmSync, readFileSync } from "fs";
import { execFileSync } from "child_process";
import { join, resolve, dirname } from "path";
import { homedir, platform } from "os";

const CIBLES = {
  complement: { source: "src/addin/manifest.xml", nom: "sankey-studio.xml", titre: "Sankey Studio" },
  // Même NOM de fichier que le complément de développement, et même <Id> : le
  // second remplace le premier au lieu de cohabiter avec lui. Deux manifestes
  // de même identité dans `wef` donneraient un doublon dans le ruban.
  enligne: { source: "dist/addin/manifest.xml", nom: "sankey-studio.xml", titre: "Sankey Studio" },
  sonde: { source: "src/addin/manifest-sonde.xml", nom: "sankey-sonde.xml", titre: "Sankey Studio — sonde" }
};

const sonde = process.argv.includes("--sonde");
const enligne = process.argv.includes("--enligne");
const retirer = process.argv.includes("--retirer");
if (sonde && enligne) {
  console.error("--sonde et --enligne s'excluent : la sonde n'est pas publiée.");
  process.exit(1);
}
const choix = sonde ? CIBLES.sonde : enligne ? CIBLES.enligne : CIBLES.complement;
const os_ = platform();

if (os_ !== "darwin" && os_ !== "win32") {
  console.error("Le chargement de côté n'existe que sur macOS et Windows.");
  process.exit(1);
}

/* ------------------------------- macOS ------------------------------- */

const WEF = join(homedir(), "Library/Containers/com.microsoft.Excel/Data/Documents/wef");

function installerMac(source) {
  if (!existsSync(join(homedir(), "Library/Containers/com.microsoft.Excel"))) {
    console.error("Conteneur d'Excel introuvable — Excel pour Mac est-il installé et lancé une fois ?");
    process.exit(1);
  }
  const cible = join(WEF, choix.nom);
  mkdirSync(WEF, { recursive: true });
  copyFileSync(source, cible);
  return cible;
}

function retirerMac() {
  let n = 0;
  for (const c of Object.values(CIBLES)) {
    const cible = join(WEF, c.nom);
    if (existsSync(cible)) { rmSync(cible); console.log("Retiré : " + cible); n++; }
  }
  return n;
}

/* ------------------------------ Windows ------------------------------ */

/**
 * La clé de développement. `16.0` couvre tout Office moderne (2016 → M365) :
 * Microsoft n'a pas changé ce numéro depuis, et c'est celui que ses propres
 * outils écrivent.
 */
const CLE = "HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer";

function reg(args) {
  return execFileSync("reg", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function installerWindows(source) {
  // La VALEUR porte le chemin du manifeste ; son NOM n'est qu'une étiquette.
  // Office relit le fichier à chaque démarrage : le laisser dans le dépôt est
  // voulu, une modification du manifeste est prise au redémarrage d'Excel.
  try {
    reg(["add", CLE, "/v", choix.nom, "/t", "REG_SZ", "/d", source, "/f"]);
  } catch (e) {
    console.error("Écriture dans le Registre refusée : " + ((e && e.message) || e));
    console.error("\nUne stratégie d'entreprise verrouille peut-être la clé. Repli :");
    expliquerCatalogue(source);
    process.exit(1);
  }
  return CLE + "  →  " + choix.nom;
}

function retirerWindows() {
  let n = 0;
  for (const c of Object.values(CIBLES)) {
    try {
      reg(["delete", CLE, "/v", c.nom, "/f"]);
      console.log("Retiré du Registre : " + c.nom);
      n++;
    } catch { /* la valeur n'existait pas : rien à dire */ }
  }
  return n;
}

/** Le repli documenté par Microsoft quand le Registre est verrouillé. */
function expliquerCatalogue(source) {
  console.error("");
  console.error("  1. Partage le dossier " + dirname(source));
  console.error("     (clic droit ▸ Propriétés ▸ Partage) et note son chemin réseau,");
  console.error("     de la forme \\\\<poste>\\<partage>");
  console.error("  2. Excel ▸ Fichier ▸ Options ▸ Centre de gestion de la confidentialité ▸");
  console.error("     Paramètres du Centre… ▸ Catalogues de compléments approuvés");
  console.error("  3. Colle le chemin réseau, Ajouter le catalogue, coche « Afficher dans le menu »");
  console.error("  4. OK, puis redémarre Excel complètement");
  console.error("  5. Insertion ▸ Mes compléments ▸ DOSSIER PARTAGÉ ▸ « " + choix.titre + " »");
}

/* ------------------------------ exécution ------------------------------ */

if (retirer) {
  const n = os_ === "darwin" ? retirerMac() : retirerWindows();
  if (!n) console.log("Rien à retirer.");
  console.log("Redémarre Excel pour que le complément disparaisse.");
  process.exit(0);
}

const source = resolve(choix.source);
if (!existsSync(source)) {
  console.error("Manifeste introuvable : " + source);
  if (enligne) {
    console.error("\nLe manifeste de production s'engendre, il ne s'écrit pas à la main :\n");
    console.error("  npm run addin:manifeste -- https://<hôte>/<chemin>\n");
    console.error("Voir DIFFUSION.md.");
  }
  process.exit(1);
}

// Un manifeste de production qui vise encore localhost transformerait une
// installation « sans serveur » en page blanche, et rien ne le dirait dans
// Excel : on le refuse ici, pendant qu'on peut encore l'expliquer.
let adresse = null;
if (enligne) {
  const xml = readFileSync(source, "utf8");
  const m = /<SourceLocation DefaultValue="([^"]+)"/.exec(xml);
  adresse = m ? m[1] : null;
  if (!adresse || !adresse.startsWith("https://") || /localhost|127\.0\.0\.1/.test(adresse)) {
    console.error("Ce manifeste ne vise pas un hébergeur : " + (adresse || "aucune SourceLocation"));
    console.error("\nIl faut l'engendrer avec l'adresse du site :\n");
    console.error("  npm run addin:manifeste -- https://<hôte>/<chemin>\n");
    process.exit(1);
  }
}

const ou = os_ === "darwin" ? installerMac(source) : installerWindows(source);

console.log("Manifeste installé :\n  " + ou + "\n");
if (enligne) {
  // Aucune des étapes de développement ne s'applique : c'est tout l'intérêt.
  console.log("Il vise le site publié :\n  " + adresse + "\n");
  console.log("Ni serveur local, ni certificat, ni dépôt : la page vient de l'hébergeur.");
  console.log("\nEnsuite :");
  console.log("  1. Quitte Excel COMPLÈTEMENT, puis rouvre-le");
  console.log("  2. Ouvre ton classeur");
  console.log("  3. Accueil ▸ « Diagramme de flux »");
  console.log("\nÀ savoir : la page venant d'Internet, le complément ne charge pas hors ligne.");
  console.log("Après une republication, ferme et rouvre le volet pour prendre la nouvelle version.");
} else {
  console.log("Ensuite :");
  console.log("  1. npm run addin:certs         (UNE FOIS : certificat HTTPS de développement)");
  console.log("  2. npm run build               (construit dist/addin)");
  console.log("  3. npm run addin:serve         (dans un autre terminal, à laisser tourner)");
  console.log("  4. Quitte Excel complètement, puis rouvre-le");
  console.log("  5. Ouvre ton classeur" + (sonde ? " — une COPIE : la sonde réécrit les tableaux" : ""));
  console.log(sonde
    ? "  6. Insertion ▸ Mes compléments ▸ Compléments de développement ▸ « " + choix.titre + " »"
    : "  6. Accueil ▸ « Diagramme de flux » (ou Insertion ▸ Mes compléments ▸ Compléments de développement)");
}

if (os_ === "win32") {
  console.log("\nSi le complément n'apparaît pas dans « Compléments de développement »,");
  console.log("c'est que la clé du Registre est ignorée. Repli par catalogue de confiance :");
  expliquerCatalogue(source);
}

console.log("\nPour retirer : npm run addin:install -- --retirer");
