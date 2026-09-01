"use strict";
/**
 * Tests du rythme de la synchro évènementielle (phase 3) :
 *   - src/addin/synchro.ts    — auto-écho et anti-rebond, sans Excel ;
 *   - ecouterTableaux()       — sur quels tableaux on se branche, sur le faux
 *                               classeur de tests/faux-office.js.
 *
 * Ce qui est éprouvé ici, c'est la boucle qu'on veut éviter : notre propre
 * écriture revient par onChanged, provoque une relecture, qui réécrit…
 *
 * Usage : node tests/addin-synchro.test.js  [filtre]
 */

const path = require("path");
const os = require("os");
const fs = require("fs");
const esbuild = require("esbuild");

const { monterClasseur } = require("./faux-office.js");

function bundler(entree, suffixe) {
  const sortie = path.join(os.tmpdir(), `sankey-${suffixe}-${process.pid}.cjs`);
  esbuild.buildSync({
    entryPoints: [entree], bundle: true, format: "cjs",
    platform: "node", target: "es2019", outfile: sortie
  });
  process.on("exit", () => { try { fs.unlinkSync(sortie); } catch (e) { /* déjà parti */ } });
  return require(sortie);
}
const synchro = bundler("src/addin/synchro.ts", "synchro");
const office = bundler("src/addin/excel-office.ts", "office");

/* ----------------------------- harnais ----------------------------- */

const filtre = process.argv[2];
let ok = 0;
const echecs = [];
async function test(nom, fn) {
  if (filtre && !nom.toLowerCase().includes(filtre.toLowerCase())) return;
  try { await fn(); ok++; console.log("  ok    " + nom); }
  catch (e) { echecs.push(nom); console.log("  ÉCHEC " + nom + "\n      " + ((e && e.message) || e)); }
}
function attendu(c, m) { if (!c) throw new Error(m); }
function egal(reel, att, m) {
  if (JSON.stringify(reel) !== JSON.stringify(att)) {
    throw new Error(`${m}\n      attendu : ${JSON.stringify(att)}\n      obtenu  : ${JSON.stringify(reel)}`);
  }
}
const dormir = ms => new Promise(r => setTimeout(r, ms));

/** Horloge pilotée : le filtre d'écho ne doit pas dépendre du temps réel. */
function horloge(depart) {
  let t = depart || 0;
  const f = () => t;
  f.avancer = ms => { t += ms; };
  return f;
}

(async () => {

/* --------------------------- auto-écho --------------------------- */

await test("écho : un évènement hors écriture est accepté", async () => {
  const h = horloge(10000);
  const f = new synchro.FiltreEcho(1200, h);
  attendu(f.accepter({ triggerSource: "Unknown" }), "frappe de l'utilisatrice acceptée");
});

await test("écho : pendant notre écriture, tout est ignoré", async () => {
  const h = horloge(10000);
  const f = new synchro.FiltreEcho(1200, h);
  let pendant = null;
  await f.pendantEcriture(async () => {
    pendant = f.accepter({ triggerSource: "Unknown" });
  });
  egal(pendant, false, "évènement reçu pendant l'écriture : ignoré");
});

await test("écho : juste après notre écriture, ignoré ; passé la fenêtre, accepté", async () => {
  const h = horloge(10000);
  const f = new synchro.FiltreEcho(1200, h);
  await f.pendantEcriture(async () => {});
  egal(f.accepter({}), false, "l'écho immédiat est filtré");
  h.avancer(1201);
  egal(f.accepter({}), true, "passé la fenêtre, on écoute de nouveau");
});

await test("écho : Excel désigne notre complément -> ignoré même longtemps après", async () => {
  const h = horloge(10000);
  const f = new synchro.FiltreEcho(1200, h);
  await f.pendantEcriture(async () => {});
  h.avancer(60000);
  egal(f.accepter({ triggerSource: synchro.DECLENCHEUR_NOUS }), false,
       "triggerSource ThisLocalAddin : c'est nous");
  egal(f.accepter({ triggerSource: "Unknown" }), true, "…mais pas la frappe qui suit");
});

await test("écho : une écriture qui échoue ne laisse pas le filtre fermé", async () => {
  const h = horloge(10000);
  const f = new synchro.FiltreEcho(1200, h);
  let leve = false;
  try { await f.pendantEcriture(async () => { throw new Error("écriture ratée"); }); }
  catch (e) { leve = true; }
  attendu(leve, "l'erreur est propagée");
  h.avancer(1201);
  egal(f.accepter({}), true, "le filtre s'est bien rouvert");
});

/* --------------------------- anti-rebond --------------------------- */

await test("anti-rebond : une salve ne déclenche qu'une action", async () => {
  let n = 0;
  const a = new synchro.AntiRebond(20, () => { n++; });
  a.declencher(); a.declencher(); a.declencher();
  egal(n, 0, "rien avant le délai");
  await dormir(60);
  egal(n, 1, "une seule exécution pour la salve");
});

await test("anti-rebond : arreter() annule l'action en attente", async () => {
  let n = 0;
  const a = new synchro.AntiRebond(20, () => { n++; });
  a.declencher();
  attendu(a.enAttente, "une action est en attente");
  a.arreter();
  await dormir(60);
  egal(n, 0, "rien ne s'est exécuté");
});

/* ------------------------ branchement des tableaux ------------------------ */

const NODE_COLS = require("../src/shared/modele-excel.js").NODE_COLS;
const LINK_COLS = require("../src/shared/modele-excel.js").LINK_COLS;

function classeurAvecIntrus() {
  return monterClasseur([
    {
      nom: "Noeuds", entetes: NODE_COLS.slice(), c0: 0,
      lignes: [["Lait", "Lait cru", 1, "Collecte", 0, "", "n1", 1, "Produit"]]
    },
    {
      nom: "Liens", entetes: LINK_COLS.slice(), c0: 10,
      lignes: [["Lait", "Lait cru", "Lait cru", 1, "t", "n1", "n1"]]
    },
    // Le classeur réel du poste d'essai en portait un troisième, sur une AUTRE
    // feuille et avec une colonne « Origine » lui aussi — c'est lui qui a été
    // pris pour le tableau des liens au premier essai dans Excel.
    {
      nom: "flux_lait", feuille: "Flux", c0: 20,
      entetes: ["Filière", "Origine", "Destination", "Ordre vertical du lien",
                "Valeur du flux en tonnes"],
      lignes: [["Lait", "Ferme", "Laiterie", 1, 42]]
    }
  ]);
}

await test("écoute : on se branche sur les deux tableaux du diagramme, pas sur les autres", async () => {
  const c = classeurAvecIntrus();
  const r = await office.ecouterTableaux(() => {});
  attendu(r.ok, "écoute installée");
  egal(r.tables.sort(), ["Liens", "Noeuds"], "tableaux écoutés");
  egal(c.tablesEcoutees().sort(), ["Liens", "Noeuds"],
       "aucun gestionnaire sur « flux_lait », qui porte pourtant une colonne « Origine »");
});

await test("écoute : l'évènement d'un tableau du diagramme atteint le gestionnaire", async () => {
  const c = classeurAvecIntrus();
  const recus = [];
  await office.ecouterTableaux(e => recus.push(e));
  c.modifierTableau("Liens", { address: "N3", triggerSource: "Unknown" });
  egal(recus.length, 1, "un évènement reçu");
  egal(recus[0].address, "N3", "adresse transmise telle quelle");
});

await test("écoute : sans tableau de diagramme, échec explicite plutôt que silence", async () => {
  monterClasseur([{ nom: "Autre", entetes: ["Mois"], lignes: [["janvier"]] }]);
  const r = await office.ecouterTableaux(() => {});
  egal(r.ok, false, "échec signalé");
  attendu(/introuvables/.test(r.error || ""), "message explicite : " + r.error);
});

/* --------------------- écho + écoute, bout à bout --------------------- */

await test("bout à bout : notre écriture ne provoque pas de relecture", async () => {
  const c = classeurAvecIntrus();
  const h = horloge(10000);
  const f = new synchro.FiltreEcho(1200, h);
  let relectures = 0;
  await office.ecouterTableaux(e => { if (f.accepter(e)) relectures++; });

  // Une écriture du complément : Excel signale le changement pendant qu'elle
  // est encore en vol, puis juste après.
  await f.pendantEcriture(async () => {
    c.modifierTableau("Noeuds", { triggerSource: "Unknown" });
  });
  c.modifierTableau("Noeuds", { triggerSource: synchro.DECLENCHEUR_NOUS });
  egal(relectures, 0, "aucune relecture déclenchée par notre propre écriture");

  // Une vraie frappe, plus tard : elle, doit passer.
  h.avancer(2000);
  c.modifierTableau("Liens", { triggerSource: "Unknown" });
  egal(relectures, 1, "la frappe de l'utilisatrice est bien vue");
});

/* ------------------------------ bilan ------------------------------ */

console.log(`\n${ok}/${ok + echecs.length} tests passés`);
if (echecs.length) { console.log("Échecs : " + echecs.join(", ")); process.exit(1); }

})();
