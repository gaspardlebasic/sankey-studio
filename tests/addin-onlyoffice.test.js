"use strict";
/**
 * Tests de l'adaptateur ONLYOFFICE (src/onlyoffice/excel-onlyoffice.ts).
 * Éprouve la lecture, l'écriture, la préservation des formules, l'initialisation,
 * et la persistance de l'apparence sur un faux environnement ONLYOFFICE en mémoire.
 */

const path = require("path");
const os = require("os");
const fs = require("fs");
const esbuild = require("esbuild");

const { monterClasseurOnlyOffice, FauxEnvironnementOnlyOffice } = require("./faux-onlyoffice.js");
const { NODE_COLS, LINK_COLS } = require("../src/shared/modele-excel.js");

// Compilation temporaire de l'adaptateur TypeScript en CommonJS pour Node
const sortie = path.join(os.tmpdir(), `sankey-onlyoffice-${process.pid}.cjs`);
esbuild.buildSync({
  entryPoints: ["src/onlyoffice/excel-onlyoffice.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2019",
  outfile: sortie
});
const onlyoffice = require(sortie);
process.on("exit", () => { try { fs.unlinkSync(sortie); } catch (e) {} });

/* ----------------------------- harnais ----------------------------- */

let ok = 0;
const echecs = [];
async function test(nom, fn) {
  try {
    await fn();
    ok++;
    console.log("  ok    " + nom);
  } catch (e) {
    echecs.push(nom);
    console.log("  ÉCHEC " + nom + "\n      " + ((e && e.message) || e));
  }
}
function attendu(c, m) { if (!c) throw new Error(m); }
function egal(reel, att, m) {
  if (JSON.stringify(reel) !== JSON.stringify(att)) {
    throw new Error(`${m}\n      attendu : ${JSON.stringify(att)}\n      obtenu  : ${JSON.stringify(reel)}`);
  }
}

/* ----------------------------- fixtures ----------------------------- */

const LIENS_C0 = 10;

function fixtureClasseur(opts) {
  opts = opts || {};
  const entetesNoeuds = opts.entetesNoeuds || NODE_COLS.slice();
  const entetesLiens = opts.entetesLiens || LINK_COLS.slice();

  return monterClasseurOnlyOffice([
    {
      nom: "Noeuds",
      entetes: entetesNoeuds,
      c0: 0,
      lignes: opts.noeuds || [
        ["Lait", "Production bio", 1, "Production", 0, "#adcb47", "n1", 2, "Produit"],
        ["Lait", "Lait cru", 2, "Collecte", 0, "", "n2", 2, "Produit"],
        ["Lait", "Transformation", 3, "Industrie", 0, "", "n3", 1, "Industrie"]
      ]
    },
    {
      nom: "Liens",
      entetes: entetesLiens,
      c0: LIENS_C0,
      lignes: opts.liens || [
        ["Lait", "Production bio", "Lait cru", 120, "t", "n1", "n2", 0.5],
        ["Lait", "Lait cru", "Transformation", "=D2*0.9", "t", "n2", "n3", 0.1]
      ]
    }
  ]);
}

/* ------------------------------ tests ------------------------------ */

async function main() {
  console.log("\n--- Tests Adaptateur ONLYOFFICE ---\n");

  await test("diagrammePresent détecte les tableaux présents", async () => {
    fixtureClasseur();
    const present = await onlyoffice.diagrammePresent();
    attendu(present === true, "Le diagramme devrait être détecté comme présent");
  });

  await test("diagrammePresent renvoie false sur classeur vierge", async () => {
    const env = new FauxEnvironnementOnlyOffice();
    env.monterGlobal();
    const present = await onlyoffice.diagrammePresent();
    attendu(present === false, "Le diagramme ne devrait pas être présent sur un classeur vierge");
  });

  await test("initialiserClasseur crée la feuille et les en-têtes sur classeur vierge", async () => {
    const env = new FauxEnvironnementOnlyOffice();
    env.monterGlobal();
    const res = await onlyoffice.initialiserClasseur();
    attendu(res.ok === true, "L'initialisation doit réussir");
    attendu(res.statut === "cree", "Le statut doit être 'cree'");

    const ws = env.sheets[0];
    attendu(ws.GetRangeByNumber(0, 0).GetValue() === "Filière", "En-tête A1 doit être 'Filière'");
    attendu(ws.GetRangeByNumber(0, 1).GetValue() === "Noeud", "En-tête B1 doit être 'Noeud'");
    attendu(ws.GetRangeByNumber(0, LIENS_C0 + 1).GetValue() === "Origine", "En-tête liens doit contenir 'Origine'");

    const present = await onlyoffice.diagrammePresent();
    attendu(present === true, "Le diagramme doit être détecté comme présent après initialisation");
  });

  await test("lireDiagramme extrait correctement les nœuds et les liens", async () => {
    fixtureClasseur();
    const donnees = await onlyoffice.lireDiagramme();
    attendu(donnees !== null, "Données non nulles attendues");
    attendu(donnees.nodes.length === 3, "3 nœuds attendus");
    attendu(donnees.links.length === 2, "2 liens attendus");

    const n1 = donnees.nodes.find(n => n.id === "n1");
    attendu(n1 && n1.name === "Production bio", "Nœud n1 attendu");
    attendu(n1.column === 1, "Colonne 1");
    attendu(n1.lane === 2, "Couloir 2");
    attendu(n1.color === "#adcb47", "Couleur #adcb47");

    const l1 = donnees.links.find(l => l.sourceId === "n1");
    attendu(l1 && l1.targetId === "n2", "Lien n1 -> n2 attendu");
    attendu(l1.value === 120, "Valeur 120");
    attendu(l1.bio === 0.5, "Part bio 0.5");
  });

  await test("ecrireDiagramme écrit les données et préserve les formules", async () => {
    const env = fixtureClasseur();
    const modele = {
      nodes: [
        { id: "n1", name: "Production bio", column: 1, title: "Production", order: 0, lane: 2, kind: "produit", filiere: "Lait", color: "#adcb47" },
        { id: "n2", name: "Lait cru", column: 2, title: "Collecte", order: 0, lane: 2, kind: "produit", filiere: "Lait", color: null },
        { id: "n3", name: "Transformation", column: 3, title: "Industrie", order: 0, lane: 1, kind: "industrie", filiere: "Lait", color: null }
      ],
      links: [
        { source: "Production bio", target: "Lait cru", value: 150, unit: "t" },
        { source: "Lait cru", target: "Transformation", value: 100, unit: "t" }
      ]
    };

    const res = await onlyoffice.ecrireDiagramme(modele);
    attendu(res.ok === true, "Écriture réussie attendue");

    const ws = env.sheets[0];
    // La formule =D2*0.9 du 2e lien doit être préservée
    const formuleCell = ws.GetRangeByNumber(2, LIENS_C0 + 3).GetFormula();
    attendu(formuleCell.includes("D2*0.9"), "La formule =D2*0.9 doit avoir été préservée, obtenu : " + formuleCell);
  });

  await test("ajouterColonnesManquantes ajoute Couloir et Type si absents", async () => {
    // Classeur sans Couloir ni Type
    const entetesSans = NODE_COLS.filter(c => c !== "Couloir" && c !== "Type");
    const env = fixtureClasseur({
      entetesNoeuds: entetesSans,
      noeuds: [["Lait", "Prod", 1, "Col", 0, "", "n1"]]
    });

    const donneesAvant = await onlyoffice.lireDiagramme();
    attendu(donneesAvant.hasLane === false, "hasLane doit être faux");

    const res = await onlyoffice.ajouterColonnesManquantes();
    attendu(res.ok === true, "Ajout réussi");
    attendu(res.colonnesAjoutees.noeuds.includes("Couloir"), "Couloir ajouté");
    attendu(res.colonnesAjoutees.noeuds.includes("Type"), "Type ajouté");

    const donneesApres = await onlyoffice.lireDiagramme();
    attendu(donneesApres.hasLane === true, "hasLane doit être vrai après ajout");
  });

  await test("lireApparence et ecrireApparence gèrent les CustomProperties", async () => {
    fixtureClasseur();
    const vide = await onlyoffice.lireApparence();
    attendu(vide === null, "Apparence vide attendue au départ");

    const json = JSON.stringify({ couleurFiliere: { Lait: "#123456" } });
    const ecrit = await onlyoffice.ecrireApparence(json);
    attendu(ecrit.ok === true, "Écriture de l'apparence réussie");

    const lu = await onlyoffice.lireApparence();
    attendu(lu === json, "L'apparence lue doit correspondre exactement au JSON écrit");
  });

  await test("config.json ONLYOFFICE est valide et supporte les feuilles de calcul", async () => {
    const configPath = path.join(__dirname, "..", "src", "onlyoffice", "config.json");
    attendu(fs.existsSync(configPath), "config.json doit exister");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

    attendu(typeof config.guid === "string" && config.guid.startsWith("asc."), "GUID asc.* requis");
    attendu(Array.isArray(config.variations) && config.variations.length > 0, "Au moins une variation requise");

    const v = config.variations[0];
    attendu(Array.isArray(v.EditorsSupport) && v.EditorsSupport.includes("cell"), "EditorsSupport doit inclure 'cell'");
    attendu(v.type === "window", "type doit être 'window'");
    attendu(v.url === "index.html", "url doit être 'index.html'");
    attendu(Array.isArray(v.size) && v.size[0] >= 800, "Taille de fenêtre suffisante requise");
  });

  console.log(`\n${ok}/${ok + echecs.length} tests ONLYOFFICE passés\n`);
  if (echecs.length > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Erreur inattendue :", err);
  process.exit(1);
});
