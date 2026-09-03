#!/usr/bin/env node
/**
 * Vide le cache d'Excel pour Mac, pour que le complément publié soit rechargé
 * depuis GitHub Pages au lieu de la version gardée sur le disque.
 *
 * Pourquoi ce script existe : les webviews d'Office cachent durement. Les
 * bundles JS portent une empreinte dans leur nom et échappent au problème, mais
 * **les pages HTML, les styles et le manifeste, non** : après une publication,
 * Excel peut continuer à servir l'ancienne page pendant longtemps.
 *
 * Ce qu'il efface (le CONTENU des dossiers, jamais les dossiers eux-mêmes) :
 * le cache HTTP du conteneur d'Excel, celui de WebKit, et le cache des
 * compléments d'Office (« Wef » sous Application Support).
 *
 * **Ce qu'il ne touche jamais** : `Data/Documents/wef/`, qui porte le manifeste
 * chargé de côté (`sankey-studio.xml`). L'effacer désinstallerait le complément
 * du poste — c'est le seul dossier « wef » qui ne soit pas un cache, et les deux
 * ne se distinguent que par leur chemin. D'où le garde-fou `estUnCache()`.
 *
 * Usage :
 *   npm run excel:cache
 *   npm run excel:cache -- --strict   refuse d'agir si Excel est ouvert
 */
import { rmSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const CONTENEUR = join(homedir(), "Library/Containers/com.microsoft.Excel/Data");
const OSF_WEB_HOST = join(homedir(), "Library/Containers/com.Microsoft.OsfWebHost/Data");

/** Dossiers dont on vide le contenu, du plus utile au plus accessoire. */
export const CACHES = [
    [join(CONTENEUR, "Library/Caches/com.microsoft.Excel"), "cache HTTP d'Excel"],
    [join(CONTENEUR, "Library/Caches/WebKit"), "cache WebKit"],
    [join(CONTENEUR, "Library/WebKit"), "données WebKit"],
    [join(CONTENEUR, "Library/HTTPStorages/com.microsoft.Excel"), "stockage HTTP"],
    [join(CONTENEUR, "Library/Application Support/Microsoft/Office/16.0/Wef"),
     "cache des compléments Office"],
    // Ancien hôte des compléments : absent des versions récentes, présent sur
    // les postes qui ont connu les deux.
    [OSF_WEB_HOST, "ancien hôte des compléments (OsfWebHost)"]
];

/** Le manifeste chargé de côté : à ne JAMAIS effacer. */
export const MANIFESTE = join(CONTENEUR, "Documents/wef");

/**
 * Un chemin n'est effaçable que s'il est dans un conteneur d'Excel ET hors du
 * dossier du manifeste. Deux conditions plutôt qu'une : la première seule
 * laisserait passer `Documents/wef`, dont le nom ressemble à s'y méprendre au
 * cache des compléments.
 */
export function estUnCache(chemin) {
    const dansExcel = chemin.startsWith(CONTENEUR + "/") || chemin.startsWith(OSF_WEB_HOST);
    return dansExcel && !chemin.startsWith(MANIFESTE);
}

function tailleDe(chemin) {
    try {
        return parseInt(execFileSync("du", ["-sk", chemin], { encoding: "utf8" }).trim(), 10) || 0;
    } catch {
        return 0;
    }
}

function lisible(ko) {
    if (ko >= 1024) return (ko / 1024).toFixed(1) + " Mo";
    return ko + " Ko";
}

function excelOuvert() {
    try {
        execFileSync("pgrep", ["-x", "Microsoft Excel"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

/** Vide le CONTENU d'un dossier ; renvoie les kilo-octets libérés. */
function viderDossier(chemin) {
    if (!estUnCache(chemin)) {
        throw new Error("refus d'effacer un chemin qui n'est pas un cache d'Excel : " + chemin);
    }
    if (!existsSync(chemin) || !statSync(chemin).isDirectory()) return null;
    const avant = tailleDe(chemin);
    let echecs = 0;
    for (const entree of readdirSync(chemin)) {
        try {
            rmSync(join(chemin, entree), { recursive: true, force: true });
        } catch {
            echecs++; // fichier tenu ouvert par Excel : on le signale, on n'insiste pas
        }
    }
    return { libere: Math.max(0, avant - tailleDe(chemin)), echecs };
}

/* Tout ce qui efface vit dans `main()`, appelée seulement si le script est lancé
   directement : le test du garde-fou importe ce module, et un module qui agirait
   au chargement viderait le cache du poste rien qu'à être éprouvé — ou, avec un
   `process.exit()` à l'import, ferait passer le test sans rien assurer. */
function main(argv) {
    const strict = argv.includes("--strict");
    const ouvert = excelOuvert();

    if (ouvert && strict) {
        console.error("Excel est ouvert : rien n'a été effacé (--strict). Quitte Excel et relance.");
        return 1;
    }
    if (!existsSync(CONTENEUR)) {
        console.error("Aucun conteneur Excel pour Mac sur ce poste (" + CONTENEUR + ").");
        return 1;
    }

    console.log("Vidage du cache d'Excel pour Mac");
    if (ouvert) {
        console.log("  ⚠  Excel est OUVERT : le cache est vidé, mais il faut le quitter puis");
        console.log("     le rouvrir pour que le complément reparte de la version publiée.");
    }

    let total = 0;
    let bloques = 0;
    for (const [chemin, nom] of CACHES) {
        const r = viderDossier(chemin);
        if (r === null) {
            console.log(`  –  ${nom} : absent`);
            continue;
        }
        total += r.libere;
        bloques += r.echecs;
        console.log(`  ✓  ${nom} : ${lisible(r.libere)}`
            + (r.echecs ? ` (${r.echecs} élément(s) tenus par Excel)` : ""));
    }

    // Le manifeste doit avoir survécu : c'est lui qui déclare le complément.
    const manifestePresent = existsSync(join(MANIFESTE, "sankey-studio.xml"));
    console.log(`  ·  manifeste chargé de côté : ${manifestePresent ? "intact" : "absent"}`
        + (manifestePresent ? "" : " (npm run addin:install -- --enligne pour le reposer)"));

    console.log(`\n${lisible(total)} libéré(s).`);
    if (bloques) {
        console.log("Des fichiers étaient tenus par Excel : relance après l'avoir quitté.");
    }
    console.log("Rappel : GitHub Pages garde les pages HTML ~10 min. Publier puis vider dans la");
    console.log("minute peut ramener l'ancienne page — dans ce cas, attendre et recommencer.");
    if (ouvert) {
        console.log("Excel étant ouvert : quitte-le et rouvre-le pour voir la nouvelle version.");
    }
    return 0;
}

if (process.argv[1] && process.argv[1].endsWith("vider-cache-excel.mjs")) {
    process.exit(main(process.argv.slice(2)));
}
