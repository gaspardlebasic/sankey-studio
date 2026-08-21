/**
 * Tests du module d'écriture « à chaud » (src/main/excel-live.js).
 *
 * Ces tests-ci ne parlent PAS à Excel : ils vérifient la partie déterministe —
 * la mise en forme du message envoyé à Excel et la relecture de sa réponse.
 * L'aller-retour réel se mesure avec :
 *   node scripts/proto-excel-live.mjs "/chemin/Classeur.xlsx"
 *
 * Usage : node tests/excel-live.test.js
 */
"use strict";

const live = require("../src/main/excel-live.js");
const { NODE_COLS, LINK_COLS } = require("../src/main/excel.js");

let ok = 0;
const echecs = [];
function test(nom, fn) {
  try {
    fn();
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

const modele = {
  nodes: [
    { id: "n1", name: "Féverolle", column: 1, title: "Production", order: 0, lane: 1,
      filiere: "Légumineuses", color: "#adcb47" },
    { id: "n2", name: "Lentilles sèches", column: 2, title: "Transformation", order: 3, lane: 2,
      filiere: "Légumineuses", color: null }
  ],
  links: [{ id: "l1", source: "n1", target: "n2", value: 1250.5, unit: "t" }]
};
const col = h => NODE_COLS.indexOf(h);
const colL = h => LINK_COLS.indexOf(h);

/* --------------------------- message vers Excel -------------------------- */

test("payload : classeur désigné par son nom de fichier, pas son chemin", () => {
  const p = live.construirePayload("/Users/x/OneDrive/Flux légumineuses.xlsx", modele, "Diagramme", {});
  egal(p.workbook, "Flux légumineuses.xlsx", "nom du classeur");
  egal(p.sheet, "Diagramme", "onglet");
});

test("payload : les tableaux sont retrouvés par un en-tête, pas par une adresse", () => {
  const p = live.construirePayload("/x/f.xlsx", modele, null, {});
  attendu(NODE_COLS.includes(p.nodeKey), "l'en-tête des nœuds doit exister dans NODE_COLS");
  attendu(LINK_COLS.includes(p.linkKey), "l'en-tête des liens doit exister dans LINK_COLS");
});

test("payload : les nombres restent des nombres, les textes des textes", () => {
  const p = live.construirePayload("/x/f.xlsx", modele, null, {});
  egal(p.nodes[0][col("Noeud")], "Féverolle", "nom du nœud");
  egal(p.nodes[0][col("Filière")], "Légumineuses", "filière");
  egal(p.nodes[1][col("Couleur")], "", "couleur absente -> chaîne vide, pas null");
  attendu(typeof p.nodes[0][col("Numéro de colonne d'affichage")] === "number",
    "le numéro de colonne doit rester numérique");
  attendu(typeof p.links[0][colL("Valeur du flux")] === "number",
    "la valeur du flux doit rester numérique");
});

test("payload : le couloir part avec les nœuds", () => {
  const p = live.construirePayload("/x/f.xlsx", modele, null, {});
  attendu(col("Couloir") >= 0, "« Couloir » doit faire partie des colonnes de nœuds");
  egal(p.nodes[0][col("Couloir")], 1, "couloir du premier nœud");
  egal(p.nodes[1][col("Couloir")], 2, "couloir du second nœud");
});

test("payload : un nœud sans couloir tombe dans le couloir 1", () => {
  const sansCouloir = { nodes: [{ id: "n9", name: "X", column: 1, title: "", order: 0,
                                  filiere: "", color: null }], links: [] };
  const p = live.construirePayload("/x/f.xlsx", sansCouloir, null, {});
  egal(p.nodes[0][col("Couloir")], 1, "couloir par défaut");
});

test("payload : les liens portent les noms ET les identifiants", () => {
  const p = live.construirePayload("/x/f.xlsx", modele, null, {});
  egal(p.links[0], ["Féverolle", "Lentilles sèches", 1250.5, "t", "n1", "n2"], "ligne de lien");
});

test("payload : les colonnes sont désignées par leur en-tête, pas par leur rang", () => {
  const p = live.construirePayload("/x/f.xlsx", modele, null, {});
  egal(p.nodeHeaders, NODE_COLS, "en-têtes des nœuds");
  egal(p.linkHeaders, LINK_COLS, "en-têtes des liens");
  for (const h of [p.valueHeader, p.srcIdHeader, p.dstIdHeader, p.srcNameHeader, p.dstNameHeader]) {
    attendu(LINK_COLS.includes(h), "« " + h + " » doit exister dans LINK_COLS");
  }
  egal(p.links[0][LINK_COLS.indexOf(p.valueHeader)], 1250.5, "la valeur est bien à cet index");
});

test("payload : conserver les formules est le comportement par défaut", () => {
  egal(live.construirePayload("/x/f.xlsx", modele, null, {}).preserveFormulas, true, "défaut");
  egal(live.construirePayload("/x/f.xlsx", modele, null, { preserveFormulas: false }).preserveFormulas, false, "désactivé");
  egal(live.construirePayload("/x/f.xlsx", modele, null, {}).save, false, "on n'enregistre pas sans le demander");
});

/* ---------------------------- réponse d'Excel ---------------------------- */

const lecture = {
  noeuds: {
    entetes: NODE_COLS,
    lignes: [
      ["Légumineuses", "Féverolle", 1, "Production", 0, "#adcb47", "n1", 1],
      ["Légumineuses", "Lentilles sèches", 2, "Transformation", 3, "", "n2", 3],
      ["", "", "", "", "", "", "", ""]
    ]
  },
  liens: {
    entetes: LINK_COLS,
    lignes: [["Féverolle", "Lentilles sèches", 1250.5, "t", "n1", "n2"]]
  }
};

test("lecture : les lignes vides sont ignorées", () => {
  const d = live.diagrammeDepuisTables(lecture, "Diagramme");
  egal(d.nodes.length, 2, "nœuds retenus");
  egal(d.links.length, 1, "liens retenus");
});

test("lecture : couleur absente -> null, comme readDiagram", () => {
  const d = live.diagrammeDepuisTables(lecture, "Diagramme");
  egal(d.nodes[0].color, "#adcb47", "couleur présente");
  egal(d.nodes[1].color, null, "couleur absente");
});

test("lecture : Excel rend des réels, le modèle veut des entiers de colonne", () => {
  const brut = JSON.parse(JSON.stringify(lecture));
  brut.noeuds.lignes[0][2] = 1.0;
  brut.noeuds.lignes[0][4] = 3.0;
  const d = live.diagrammeDepuisTables(brut, "Diagramme");
  egal(d.nodes[0].column, 1, "colonne entière");
  egal(d.nodes[0].order, 3, "ordre entier");
});

test("lecture : le couloir est relu, 1 par défaut", () => {
  const d = live.diagrammeDepuisTables(lecture, "Diagramme");
  egal(d.nodes[0].lane, 1, "couloir explicite");
  egal(d.nodes[1].lane, 3, "couloir explicite");
});

test("lecture : un classeur d'avant les couloirs reste lisible", () => {
  const ancien = {
    noeuds: {
      entetes: NODE_COLS.filter(h => h !== "Couloir"),
      lignes: [["Légumineuses", "Féverolle", 1, "Production", 0, "#adcb47", "n1"]]
    },
    liens: { entetes: LINK_COLS, lignes: [] }
  };
  const d = live.diagrammeDepuisTables(ancien, "Diagramme");
  egal(d.nodes.length, 1, "le nœud est lu");
  egal(d.nodes[0].lane, 1, "sans colonne Couloir, tout est dans le couloir 1");
  egal(d.hasLane, false, "l'app doit savoir que le classeur ignore les couloirs");
});

test("lecture : hasLane signale la présence de la colonne", () => {
  egal(live.diagrammeDepuisTables(lecture, "Diagramme").hasLane, true, "colonne présente");
});

test("lecture : les colonnes sont retrouvées par en-tête, pas par position", () => {
  const permute = {
    noeuds: {
      entetes: ["ID", "Noeud", "Filière", "Numéro de colonne d'affichage",
                "Intitulé de la colonne d'affichage", "Ordre vertical d'affichage", "Couleur"],
      lignes: [["n9", "Blé", "Céréales", 4, "Meunerie", 2, "#000000"]]
    },
    liens: { entetes: LINK_COLS, lignes: [] }
  };
  const d = live.diagrammeDepuisTables(permute, "Diagramme");
  egal(d.nodes[0], { id: "n9", name: "Blé", column: 4, title: "Meunerie", order: 2, lane: 1,
                     filiere: "Céréales", color: "#000000" }, "nœud relu");
});

/* ------------------------- scripts embarqués ----------------------------- */

test("script macOS : le JXA embarqué est du JavaScript valide", () => {
  new Function(live.MAC_JXA + "\nreturn typeof run;");
  new Function(live.MAC_JXA_READ + "\nreturn typeof run;");
});

test("script macOS : aucun accent grave (il casserait le littéral hôte)", () => {
  attendu(live.MAC_JXA.indexOf("`") === -1, "MAC_JXA contient un accent grave");
  attendu(live.MAC_JXA_READ.indexOf("`") === -1, "MAC_JXA_READ contient un accent grave");
});

test("script Windows : passe par une variable d'environnement, pas la ligne de commande", () => {
  attendu(live.WIN_PS.includes("$env:SANKEY_PAYLOAD"), "le chemin du message doit venir de l'environnement");
  attendu(!/\$\{/.test(live.WIN_PS), "aucune interpolation JavaScript ne doit rester dans le script");
  attendu(!/\$\{/.test(live.WIN_PS_READ), "idem pour la lecture");
});

test("script Windows : ASCII pur (stdin est décodé avec la page de code console)", () => {
  const hors = c => [...c].filter(x => x.charCodeAt(0) > 127);
  egal(hors(live.WIN_PS), [], "WIN_PS contient des caractères non-ASCII");
  egal(hors(live.WIN_PS_READ), [], "WIN_PS_READ contient des caractères non-ASCII");
});

test("script Windows : le tableau 2D est protégé du dépliage PowerShell", () => {
  attendu(live.WIN_PS.includes("return ,$a"), "To-Grid doit rendre « return ,$a », sinon PowerShell déplie la grille");
});

test("script Windows : Resize ne vide pas les lignes sorties du tableau", () => {
  attendu(/\$avant -gt \$n/.test(live.WIN_PS), "les lignes en trop doivent être effacées après un Resize réducteur");
});

test("scripts : une colonne manquante est ajoutée au tableau", () => {
  attendu(/ajouterColonnes/.test(live.MAC_JXA), "macOS doit savoir ajouter une colonne");
  attendu(/Add-Columns/.test(live.WIN_PS), "Windows doit savoir ajouter une colonne");
});

test("scripts : les deux plateformes rendent les mêmes états", () => {
  for (const etat of ["not-running", "not-open", "no-sheet", "no-tables", "no-column", "written"]) {
    attendu(live.MAC_JXA.includes("'" + etat + "'"), "macOS doit pouvoir rendre « " + etat + " »");
    attendu(live.WIN_PS.includes("'" + etat + "'"), "Windows doit pouvoir rendre « " + etat + " »");
  }
});

/* ------------------- aller-retour par le fichier .xlsx -------------------- */
// Le couloir traverse deux chemins d'écriture (fichier et « à chaud ») : on
// vérifie ici le premier, de bout en bout, sur un vrai classeur.

const { writeDiagram, readDiagram } = require("../src/main/excel.js");
const os = require("os");
const fs = require("fs");
const path = require("path");

const aller = [];
(async () => {
  const f = path.join(os.tmpdir(), `sankey-test-${process.pid}.xlsx`);
  try {
    await writeDiagram(f, modele, "Diagramme");
    const relu = await readDiagram(f, "Diagramme");
    aller.push(["classeur : le couloir fait l'aller-retour", () => {
      egal(relu.nodes.map(n => n.lane), [1, 2], "couloirs relus");
      egal(relu.hasLane, true, "le classeur écrit porte la colonne");
    }]);
    aller.push(["classeur : le reste du nœud est intact", () => {
      egal(relu.nodes[0].name, "Féverolle", "nom");
      egal(relu.nodes[0].column, 1, "colonne");
      egal(relu.nodes[1].order, 3, "ordre vertical");
      egal(relu.nodes[0].color, "#adcb47", "couleur");
    }]);
    aller.push(["classeur : une colonne vide sépare les deux tableaux", () => {
      egal(NODE_COLS.length, 8, "huit colonnes de nœuds (A..H)");
      egal(relu.links.length, 1, "le lien est relu malgré le décalage");
      egal(relu.links[0].value, 1250.5, "valeur du flux");
    }]);
  } catch (e) {
    aller.push(["classeur : aller-retour", () => { throw e; }]);
  } finally {
    try { fs.unlinkSync(f); } catch (e) { /* déjà parti */ }
  }
  aller.forEach(([nom, fn]) => test(nom, fn));

  console.log(`\n${ok}/${ok + echecs.length} tests passés`);
  if (echecs.length) {
    console.log("Échecs :\n  - " + echecs.join("\n  - "));
    process.exit(1);
  }
})();
