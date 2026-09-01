#!/usr/bin/env node
/**
 * Prototype : écrire dans le classeur OUVERT dans Excel plutôt que sur le disque.
 *
 *   node scripts/proto-excel-live.mjs "/chemin/vers/Classeur.xlsx" [Onglet]
 *
 * Le classeur doit être ouvert dans Excel. Le script :
 *   1. lit les deux tableaux directement dans Excel ;
 *   2. réécrit EXACTEMENT les mêmes valeurs à chaud (opération neutre : le
 *      contenu ne change pas, seul le chemin d'écriture est éprouvé) ;
 *   3. relit et compare cellule à cellule ;
 *   4. mesure le temps passé.
 *
 * Rien n'est enregistré : le classeur reste « modifié » dans Excel, à
 * l'utilisatrice de décider. Ctrl-Z dans Excel ne défait pas une écriture par
 * automatisation — c'est la contrepartie de la méthode.
 */

import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);
const { readDiagramLive, readTablesLive, writeDiagramLive } = require("../src/main/excel-live.js");

const fichier = process.argv[2];
const onglet = process.argv[3] || "Diagramme";
if (!fichier) {
  console.error("Usage : node scripts/proto-excel-live.mjs \"/chemin/Classeur.xlsx\" [Onglet]");
  process.exit(2);
}

const ms = t => `${Date.now() - t} ms`;

function modeleDepuis(data) {
  // readDiagramLive rend les liens sous forme (sourceId, targetId) ; le
  // modèle de l'app utilise (source, target).
  return {
    nodes: data.nodes.map(n => ({ ...n })),
    links: data.links.map(l => ({
      source: l.sourceId, target: l.targetId, value: l.value, unit: l.unit
    }))
  };
}

function diff(a, b, nom) {
  const ecarts = [];
  if (a.lignes.length !== b.lignes.length) {
    ecarts.push(`${nom} : ${a.lignes.length} lignes avant, ${b.lignes.length} après`);
    return ecarts;
  }
  for (let i = 0; i < a.lignes.length; i++) {
    for (let j = 0; j < a.entetes.length; j++) {
      const x = a.lignes[i][j], y = b.lignes[i][j];
      if (String(x) !== String(y)) {
        ecarts.push(`${nom} ligne ${i + 2}, « ${a.entetes[j]} » : ${JSON.stringify(x)} -> ${JSON.stringify(y)}`);
      }
    }
  }
  return ecarts;
}

(async () => {
  console.log(`Classeur  : ${path.basename(fichier)}`);
  console.log(`Onglet    : ${onglet}\n`);

  let t = Date.now();
  const avantBrut = await readTablesLive(fichier, onglet);
  if (!avantBrut.ok) {
    console.error(`Lecture impossible — état « ${avantBrut.state} »` +
      (avantBrut.error ? ` : ${avantBrut.error}` : ""));
    console.error(avantBrut.state === "not-open"
      ? "Ouvre le classeur dans Excel puis relance."
      : "");
    process.exit(1);
  }
  console.log(`1. Lecture à chaud       ${ms(t)} — ` +
    `${avantBrut.noeuds.lignes.length} nœuds, ${avantBrut.liens.lignes.length} liens` +
    ` (classeur ${avantBrut.enregistre ? "enregistré" : "déjà modifié"} avant l'essai)`);

  const lu = await readDiagramLive(fichier, onglet);
  const modele = modeleDepuis(lu.data);

  t = Date.now();
  const w = await writeDiagramLive(fichier, modele, onglet, { save: false });
  const totalEcriture = Date.now() - t;
  if (!w.ok) {
    console.error(`2. Écriture à chaud      ÉCHEC — état « ${w.state} »` + (w.error ? ` : ${w.error}` : ""));
    process.exit(1);
  }
  console.log(`2. Écriture à chaud      ${totalEcriture} ms au total, dont ${w.ms} ms dans Excel` +
    ` (nœuds ${w.noeuds.ms} ms, liens ${w.liens.ms} ms)` +
    (w.formules ? `, ${w.formules} formule(s) conservée(s)` : ""));

  t = Date.now();
  const apres = await readTablesLive(fichier, onglet);
  console.log(`3. Relecture             ${ms(t)}`);

  const ecarts = [...diff(avantBrut.noeuds, apres.noeuds, "Nœuds"),
                  ...diff(avantBrut.liens, apres.liens, "Liens")];
  console.log("");
  if (ecarts.length === 0) {
    const cellules = avantBrut.noeuds.lignes.length * avantBrut.noeuds.entetes.length +
                     avantBrut.liens.lignes.length * avantBrut.liens.entetes.length;
    console.log(`Aucun écart : ${cellules} cellules réécrites à l'identique.`);
    console.log(`Débit observé : ${Math.round(cellules / (w.ms / 1000))} cellules/seconde.`);
  } else {
    console.log(`${ecarts.length} écart(s) :`);
    ecarts.slice(0, 20).forEach(e => console.log("  - " + e));
    if (ecarts.length > 20) console.log(`  … et ${ecarts.length - 20} autres`);
    process.exitCode = 1;
  }
})().catch(e => { console.error(e); process.exit(1); });
