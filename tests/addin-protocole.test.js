"use strict";
/**
 * Tests du tunnel entre le volet et la fenêtre d'édition (phase 4) :
 *   - src/addin/protocole.ts    — poignée de main, appels, poussées, versions ;
 *   - src/addin/pont-fenetre.ts — le contrat `window.desktop` côté fenêtre.
 *
 * Ce qui est éprouvé ici, c'est ce qu'une fenêtre de dialogue Office impose et
 * que les deux autres ponts n'ont pas : le canal peut être branché en retard,
 * il peut expirer, et les deux pages peuvent ne pas être de la même version.
 * Aucun de ces cas ne doit casser l'éditeur.
 *
 * Usage : node tests/addin-protocole.test.js  [filtre]
 */

const path = require("path");
const os = require("os");
const fs = require("fs");
const esbuild = require("esbuild");

function bundler(entree, suffixe) {
  const sortie = path.join(os.tmpdir(), `sankey-${suffixe}-${process.pid}.cjs`);
  esbuild.buildSync({
    entryPoints: [entree], bundle: true, format: "cjs",
    platform: "node", target: "es2019", outfile: sortie
  });
  process.on("exit", () => { try { fs.unlinkSync(sortie); } catch (e) { /* déjà parti */ } });
  return require(sortie);
}

// pont-fenetre pose `window.desktop` : il lui faut un `window`.
global.window = global.window || {};

const proto = bundler("src/addin/protocole.ts", "protocole");
const pontFenetre = bundler("src/addin/pont-fenetre.ts", "pont-fenetre");

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
/** Laisse les promesses déjà résolues s'écouler (le tunnel est asynchrone). */
const respirer = () => new Promise(r => setImmediate(r));

/**
 * Horloge pilotée pour les minuteurs du mandataire : un délai de garde ne doit
 * pas se mesurer en temps réel dans un test.
 */
function ordonnanceur() {
  let t = 0, n = 1;
  const taches = new Map();
  return {
    planifier: (fn, ms) => { const id = n++; taches.set(id, { fn, quand: t + ms }); return id; },
    annuler: id => { taches.delete(id); },
    async avancer(ms) {
      t += ms;
      for (const [id, tache] of [...taches]) {
        if (tache.quand <= t) { taches.delete(id); tache.fn(); }
      }
      await respirer();
    },
    get enAttente() { return taches.size; }
  };
}

/** Le pont Office.js du volet, en toc : on n'éprouve que le tunnel. */
function fauxPont() {
  return {
    journal: [],
    capacites: {
      fichiers: false, excel: true, classeurImpose: true,
      classeurVerrouillable: false, envoiAutomatique: true, apparenceDansClasseur: true
    },
    async readExcel() {
      this.journal.push("readExcel");
      return { ok: true, live: true, data: { nodes: [{ id: "n1" }], links: [], hasLane: true } };
    },
    async writeExcel(model, chemin, feuille, options) {
      this.journal.push({ m: "writeExcel", noeuds: model.nodes.length, chemin, feuille, options });
      return { ok: true, live: true, ms: 12 };
    },
    async excelFormulas() { throw new Error("classeur illisible"); },
    async lireApparence() { return "{\"version\":1}"; },
    async ecrireApparence(json) { this.journal.push({ m: "ecrireApparence", taille: json.length }); return { ok: true }; }
  };
}

/**
 * Relie un mandataire et un courtier par un canal en toc. `branche` à false
 * simule ce qui arrive vraiment : la fenêtre a fini de charger avant que le
 * volet n'écoute.
 */
function relier(pont, options) {
  const o = options || {};
  const horloge = ordonnanceur();
  const accueil = () => ({ capacites: pont.capacites, nomClasseur: "Flux lait.xlsx", evenements: true });
  let branche = o.branche !== false;
  let versLaFenetre = null;

  const mandataire = new proto.Mandataire(
    texte => { if (branche && courtier) courtier.recevoir(texte); },
    o.delai || 20000, horloge.planifier, horloge.annuler
  );
  const courtier = new proto.Courtier(
    texte => { if (versLaFenetre) versLaFenetre(texte); else mandataire.recevoir(texte); },
    pont, accueil
  );
  versLaFenetre = texte => mandataire.recevoir(texte);

  return {
    mandataire, courtier, horloge,
    brancher() { branche = true; },
    /** Le volet répond avec une AUTRE version du protocole. */
    depuisUnAutreVolet(corps) { mandataire.recevoir(JSON.stringify(corps)); }
  };
}

(async () => {

console.log("\nprotocole — poignée de main\n");

await test("la fenêtre reçoit les capacités et le nom du classeur", async () => {
  const c = relier(fauxPont());
  const accueil = await c.mandataire.bonjour();
  egal(accueil.nomClasseur, "Flux lait.xlsx", "le nom du classeur traverse");
  egal(accueil.capacites.excel, true, "les capacités traversent");
  egal(accueil.evenements, true, "l'état de la synchro traverse");
  egal(c.horloge.enAttente, 0, "aucun minuteur ne reste en l'air");
});

await test("le bonjour est redit tant que le volet n'écoute pas", async () => {
  const c = relier(fauxPont(), { branche: false });
  const promesse = c.mandataire.bonjour();
  let recu = false;
  promesse.then(() => { recu = true; });
  await c.horloge.avancer(900);
  attendu(!recu, "rien ne peut arriver tant que le canal est coupé");
  c.brancher();
  await c.horloge.avancer(900);          // le bonjour suivant passe
  await respirer();
  attendu(recu, "la poignée de main aboutit dès que le volet écoute");
});

await test("sans réponse, la poignée de main échoue en le disant", async () => {
  const c = relier(fauxPont(), { branche: false, delai: 5000 });
  let motif = null;
  c.mandataire.bonjour().catch(e => { motif = e.message; });
  await c.horloge.avancer(5000);
  attendu(motif && motif.includes("volet"), "le motif nomme le volet : " + motif);
  egal(c.horloge.enAttente, 0, "les bonjour répétés s'arrêtent");
});

console.log("\nprotocole — appels\n");

await test("un appel traverse et rend le résultat du pont", async () => {
  const pont = fauxPont();
  const c = relier(pont);
  await c.mandataire.bonjour();
  const r = await c.mandataire.appeler("readExcel");
  egal(r.ok, true, "le résultat revient");
  egal(r.data.nodes.length, 1, "les données traversent entières");
  egal(pont.journal, ["readExcel"], "le pont a bien été appelé une fois");
});

await test("les arguments traversent dans l'ordre, y compris les objets", async () => {
  const pont = fauxPont();
  const c = relier(pont);
  await c.mandataire.bonjour();
  await c.mandataire.appeler("writeExcel",
    { nodes: [{ id: "n1" }, { id: "n2" }], links: [] }, null, "Diagramme", { save: false });
  egal(pont.journal[0],
    { m: "writeExcel", noeuds: 2, chemin: null, feuille: "Diagramme", options: { save: false } },
    "les quatre arguments arrivent tels quels");
});

await test("deux appels en vol ne se mélangent pas", async () => {
  const pont = fauxPont();
  // Réponses volontairement inversées : seule la corrélation par identifiant
  // peut rendre le bon résultat au bon appelant.
  const attentes = [];
  pont.lent = function (valeur) { return new Promise(r => attentes.push(() => r(valeur))); };
  const c = relier(pont);
  await c.mandataire.bonjour();
  const a = c.mandataire.appeler("lent", "premier");
  const b = c.mandataire.appeler("lent", "second");
  await respirer();
  attentes[1](); attentes[0]();
  egal(await a, "premier", "le premier appel reçoit sa réponse");
  egal(await b, "second", "le second appel reçoit la sienne");
});

await test("une erreur du pont revient comme un rejet, pas comme un plantage", async () => {
  const c = relier(fauxPont());
  await c.mandataire.bonjour();
  let motif = null;
  await c.mandataire.appeler("excelFormulas").catch(e => { motif = e.message; });
  egal(motif, "classeur illisible", "le message d'Excel traverse");
});

await test("une méthode inconnue est refusée en le nommant", async () => {
  const c = relier(fauxPont());
  await c.mandataire.bonjour();
  let motif = null;
  await c.mandataire.appeler("fermerExcel").catch(e => { motif = e.message; });
  attendu(motif && motif.includes("fermerExcel"), "le motif nomme la méthode : " + motif);
});

await test("un appel sans réponse expire au lieu d'attendre pour toujours", async () => {
  const pont = fauxPont();
  pont.lent = () => new Promise(() => { /* jamais */ });
  const c = relier(pont, { delai: 20000 });
  await c.mandataire.bonjour();
  let motif = null;
  c.mandataire.appeler("lent").catch(e => { motif = e.message; });
  await c.horloge.avancer(20000);
  attendu(motif && motif.includes("lent"), "le motif nomme la méthode : " + motif);
});

console.log("\nprotocole — poussées, versions, intrus\n");

await test("un changement du classeur est poussé vers la fenêtre", async () => {
  const c = relier(fauxPont());
  await c.mandataire.bonjour();
  const recus = [];
  c.mandataire.surPousse(nom => recus.push(nom));
  c.courtier.pousser("excel");
  egal(recus, ["excel"], "la poussée arrive");
});

await test("un volet d'une autre version rompt le tunnel avec un message clair", async () => {
  const c = relier(fauxPont());
  await c.mandataire.bonjour();
  let prevenu = 0;
  c.mandataire.surDesaccord(() => prevenu++);
  const pont = fauxPont();
  pont.lent = () => new Promise(() => { /* jamais */ });
  const enVol = c.mandataire.appeler("readExcel");
  c.depuisUnAutreVolet({ p: "sankey", v: 99, t: "desaccord", sienne: 99 });
  let motif = null;
  await enVol.catch(e => { motif = e.message; });
  attendu(motif && motif.includes("version"), "l'appel en vol échoue en disant pourquoi : " + motif);
  egal(prevenu, 1, "la fenêtre est prévenue une fois");
  await c.mandataire.appeler("readExcel").catch(e => { motif = e.message; });
  attendu(motif.includes("version"), "plus rien ne part après la rupture");
});

await test("le courtier refuse un message d'une autre version", async () => {
  const envoyes = [];
  const courtier = new proto.Courtier(t => envoyes.push(JSON.parse(t)), fauxPont(),
    () => ({ capacites: {}, nomClasseur: "x", evenements: false }));
  courtier.recevoir(JSON.stringify({ p: "sankey", v: 99, t: "bonjour" }));
  egal(envoyes.length, 1, "il répond");
  egal(envoyes[0].t, "desaccord", "et il répond un désaccord, pas un accueil");
});

await test("ce qui n'est pas à nous est ignoré sans bruit", async () => {
  const envoyes = [];
  const courtier = new proto.Courtier(t => envoyes.push(t), fauxPont(),
    () => ({ capacites: {}, nomClasseur: "x", evenements: false }));
  courtier.recevoir("bonjour");                                  // pas du JSON
  courtier.recevoir(JSON.stringify({ hello: "world" }));         // pas notre marque
  courtier.recevoir(JSON.stringify({ p: "autre", v: 1, t: "appel", id: 1, m: "readExcel", a: [] }));
  egal(envoyes, [], "rien n'a été répondu");
});

console.log("\npont de la fenêtre\n");

await test("le contrat est posé avec les capacités du volet", async () => {
  const c = relier(fauxPont());
  const accueil = await pontFenetre.installerPontFenetre(c.mandataire);
  egal(accueil.nomClasseur, "Flux lait.xlsx", "la poignée de main a eu lieu");
  const d = global.window.desktop;
  egal(d.isElectron, false, "ce n'est pas Electron");
  egal(d.nomClasseur, "Flux lait.xlsx", "le nom du classeur est là avant createApp");
  egal(d.capacites.excel, true, "les capacités viennent du volet");
  egal((await d.isExcelLocked()).locked, false, "le classeur n'est jamais verrouillé");
});

await test("une lecture traverse jusqu'au pont du volet", async () => {
  const pont = fauxPont();
  const c = relier(pont);
  await pontFenetre.installerPontFenetre(c.mandataire);
  const r = await global.window.desktop.readExcel();
  egal(r.ok, true, "la lecture aboutit");
  egal(r.data.hasLane, true, "hasLane survit au voyage — c'est la compat des vieux classeurs");
});

await test("un tunnel qui expire rend un échec, il ne lève pas", async () => {
  const pont = fauxPont();
  pont.readExcel = () => new Promise(() => { /* jamais */ });
  const c = relier(pont, { delai: 20000 });
  await pontFenetre.installerPontFenetre(c.mandataire);
  const promesse = global.window.desktop.readExcel();
  await c.horloge.avancer(20000);
  const r = await promesse;
  egal(r.ok, false, "l'éditeur reçoit un échec en bonne et due forme");
  attendu(typeof r.error === "string" && r.error.length > 0, "avec un motif : " + r.error);
  egal(r.live, true, "et la forme attendue par le renderer est préservée");
});

await test("une poussée du volet réveille le rappel du renderer", async () => {
  const c = relier(fauxPont());
  await pontFenetre.installerPontFenetre(c.mandataire);
  let reveils = 0;
  global.window.desktop.onExcelChanged(() => reveils++);
  c.courtier.pousser("excel");
  await respirer();
  egal(reveils, 1, "la modification faite dans Excel arrive jusqu'à l'éditeur");
});

/* ------------------------------ bilan ------------------------------ */

console.log(`\n${ok}/${ok + echecs.length} tests passés`);
if (echecs.length) { console.log("Échecs : " + echecs.join(", ")); process.exit(1); }

})();
