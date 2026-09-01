"use strict";
/**
 * Tests de l'adaptateur Office.js (src/addin/excel-office.ts).
 *
 * Ils ne parlent PAS à Excel : un faux classeur en mémoire (tests/faux-office.js)
 * reproduit le différé de `load`/`sync` et le décalage limité aux colonnes du
 * tableau. Ce qui se vérifie ici, c'est la partie déterministe : ce qu'on lit,
 * ce qu'on écrit, où, et ce qu'on ne touche pas.
 *
 * L'aller-retour réel se mesure dans Excel avec la sonde (src/addin/sonde.html).
 *
 * Usage : node tests/addin-office.test.js  [filtre]
 */

const path = require("path");
const os = require("os");
const fs = require("fs");
const esbuild = require("esbuild");

const { monterClasseur } = require("./faux-office.js");
const { buildModelRows, NODE_COLS, LINK_COLS } = require("../src/shared/modele-excel.js");

// L'adaptateur est en TypeScript et en modules ES : on le regroupe en CommonJS
// pour l'exécuter ici. Au passage, ça prouve qu'il se bundle.
const sortie = path.join(os.tmpdir(), `sankey-addin-${process.pid}.cjs`);
esbuild.buildSync({
  entryPoints: ["src/addin/excel-office.ts"],
  bundle: true, format: "cjs", platform: "node", target: "es2019", outfile: sortie
});
const office = require(sortie);
process.on("exit", () => { try { fs.unlinkSync(sortie); } catch (e) { /* déjà parti */ } });

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

/* ----------------------------- fixtures ----------------------------- */

// Colonnes des liens : Filière | Origine | Destination | Valeur | Unité | ID org | ID dest
const LIENS_C0 = 10;

function classeurType(opts) {
  opts = opts || {};
  const entetesNoeuds = opts.entetesNoeuds || NODE_COLS.slice();
  return monterClasseur([
    {
      nom: "Noeuds", entetes: entetesNoeuds, c0: 0,
      lignes: opts.noeuds || [
        ["Lait", "Production bio", 1, "Production", 0, "#adcb47", "n1", 2, "Produit"],
        ["Lait", "Lait cru", 2, "Collecte", 0, "", "n2", 2, "Produit"],
        ["Lait", "Transformation", 3, "Industrie", 0, "", "n3", 1, "Industrie"]
      ]
    },
    {
      nom: "Liens", entetes: opts.entetesLiens || LINK_COLS.slice(), c0: LIENS_C0,
      lignes: opts.liens || [
        ["Lait", "Production bio", "Lait cru", 120, "t", "n1", "n2"],
        ["Lait", "Lait cru", "Transformation", { f: "=Lentilles!C68", v: 95 }, "t", "n2", "n3"]
      ]
    }
  ]);
}

const MODELE = {
  nodes: [
    { id: "n1", name: "Production bio", column: 1, title: "Production", order: 0, lane: 2, kind: "produit", filiere: "Lait", color: "#adcb47" },
    { id: "n2", name: "Lait cru", column: 2, title: "Collecte", order: 0, lane: 2, kind: "produit", filiere: "Lait", color: null },
    { id: "n3", name: "Transformation", column: 3, title: "Industrie", order: 0, lane: 1, kind: "industrie", filiere: "Lait", color: null }
  ],
  links: [
    { source: "n1", target: "n2", value: 120, unit: "t" },
    { source: "n2", target: "n3", value: 95, unit: "t" }
  ]
};

/**
 * Ce qu'on DOIT trouver dans le classeur : les lignes de buildModelRows,
 * projetées sur l'ordre d'en-têtes réel du classeur. C'est l'assertion forte —
 * elle vérifie chaque cellule à sa place, pas seulement quelques valeurs.
 */
function attenduPour(entetes, cellules, nosCols) {
  return cellules.map(ligne => entetes.map(h => {
    const i = nosCols.indexOf(h);
    return i < 0 ? null : ligne[i].v;      // null = colonne étrangère, non écrite
  }));
}
/** Compare le tableau au résultat attendu, en ignorant les colonnes étrangères. */
function verifierTableau(c, nom, entetes, cellules, nosCols, msg) {
  const att = attenduPour(entetes, cellules, nosCols);
  const reel = c.lignesDe(nom);
  egal(reel.length, att.length, msg + " : nombre de lignes");
  att.forEach((ligneAtt, r) => {
    ligneAtt.forEach((v, col) => {
      if (v === null) return;
      egal(reel[r][col], v,
        `${msg} : ligne ${r + 1}, colonne « ${entetes[col]} » (indice ${col})`);
    });
  });
}

/* ------------------------------ LECTURE ------------------------------ */

(async () => {

await test("lecture : nœuds et liens, avec couloirs et types", async () => {
  classeurType();
  const d = await office.lireDiagramme();
  egal(d.nodes.length, 3, "trois nœuds");
  egal(d.links.length, 2, "deux liens");
  egal(d.hasLane, true, "hasLane");
  egal(d.hasKind, true, "hasKind");
  egal(d.nodes[0], {
    id: "n1", name: "Production bio", column: 1, title: "Production", order: 0,
    lane: 2, kind: "produit", filiere: "Lait", color: "#adcb47"
  }, "premier nœud");
  egal(d.links[1], {
    sourceId: "n2", targetId: "n3", sourceName: "Lait cru",
    targetName: "Transformation", value: 95, unit: "t"
  }, "second lien : la valeur calculée est lue, pas la formule");
});

await test("lecture : sans « Couloir » ni « Type », l'app garde les siennes", async () => {
  const sansExtras = NODE_COLS.filter(c => c !== "Couloir" && c !== "Type");
  classeurType({
    entetesNoeuds: sansExtras,
    noeuds: [["Lait", "Production bio", 1, "Production", 0, "#adcb47", "n1"]]
  });
  const d = await office.lireDiagramme();
  egal(d.hasLane, false, "hasLane faux");
  egal(d.hasKind, false, "hasKind faux");
  egal(d.nodes[0].lane, 1, "couloir par défaut");
  egal(d.nodes[0].kind, "produit", "type par défaut");
});

await test("lecture : un ordre de colonnes différent est lu correctement", async () => {
  // Les colonnes sont retrouvées par leur EN-TÊTE : l'ordre du classeur importe peu.
  classeurType({
    entetesNoeuds: ["ID", "Noeud", "Type", "Couloir", "Filière",
                    "Numéro de colonne d'affichage", "Intitulé de la colonne d'affichage",
                    "Ordre vertical d'affichage", "Couleur"],
    noeuds: [["n7", "Fromage", "Industrie", 3, "Lait", 4, "Aval", 2, "#c62828"]]
  });
  const d = await office.lireDiagramme();
  egal(d.nodes[0], {
    id: "n7", name: "Fromage", column: 4, title: "Aval", order: 2,
    lane: 3, kind: "industrie", filiere: "Lait", color: "#c62828"
  }, "nœud lu malgré l'ordre inhabituel");
});

await test("lecture : lignes vides et incomplètes ignorées", async () => {
  classeurType({
    noeuds: [
      ["Lait", "Production bio", 1, "Production", 0, "", "n1", 1, "Produit"],
      ["", "", "", "", "", "", "", "", ""],
      ["Lait", "", 2, "Sans nom", 0, "", "n9", 1, "Produit"]
    ],
    liens: [
      ["Lait", "Production bio", "", 10, "t", "n1", ""],
      ["Lait", "", "Lait cru", 10, "t", "", "n2"]
    ]
  });
  const d = await office.lireDiagramme();
  egal(d.nodes.length, 1, "seul le nœud nommé est retenu");
  egal(d.links.length, 0, "un lien sans origine ou sans destination est ignoré");
});

await test("lecture : classeur sans nos tableaux -> null", async () => {
  monterClasseur([{ nom: "Autre", entetes: ["Mois", "Chiffre"], lignes: [["janvier", 3]] }]);
  const d = await office.lireDiagramme();
  egal(d, null, "aucun tableau reconnu");
});

/* -------------------------- INITIALISATION -------------------------- */
/*
 * `initialiserClasseur()` est la seule fonction de l'adaptateur qui écrive dans
 * un classeur dont on ne sait RIEN — un classeur que l'utilisatrice n'a pas
 * préparé. Ses refus comptent donc autant que sa réussite.
 */

await test("initialisation : un classeur nu reçoit la feuille et les deux tableaux", async () => {
  const c = monterClasseur([
    { nom: "Autre", feuille: "Ventes", entetes: ["Mois", "Chiffre"], lignes: [["janvier", 3]] }
  ]);
  const r = await office.initialiserClasseur();
  attendu(r.ok, "initialisation faite : " + (r.error || ""));
  egal(r.feuille, "Diagramme", "feuille créée");
  egal(c.tablesDe("Diagramme").length, 2, "deux tableaux sur la feuille");
  const [n, l] = c.tablesDe("Diagramme");
  egal(c.entetesDe(n), NODE_COLS.slice(), "en-têtes des nœuds");
  egal(c.entetesDe(l), LINK_COLS.slice(), "en-têtes des liens");
  egal(c.tablesDe("Ventes"), ["Autre"], "la feuille voisine est intacte");
});

await test("initialisation : le classeur préparé est aussitôt lisible", async () => {
  // C'est la vraie assertion : ce qu'on a créé doit passer le repérage, sinon
  // le bouton produirait un classeur que le complément ne saurait pas relire.
  monterClasseur([{ nom: "Autre", feuille: "Ventes", entetes: ["Mois"], lignes: [["janvier"]] }]);
  attendu(!(await office.diagrammePresent()), "rien à lire avant");
  await office.initialiserClasseur();
  attendu(await office.diagrammePresent(), "diagramme présent après");
  const d = await office.lireDiagramme();
  attendu(d !== null, "le classeur se lit");
  egal(d.nodes.length, 0, "aucun nœud");
  egal(d.links.length, 0, "aucun lien");
  egal(d.hasLane, true, "la colonne Couloir est là");
  egal(d.hasKind, true, "la colonne Type est là");
});

await test("initialisation : on peut écrire dans le classeur qu'on vient de préparer", async () => {
  const c = monterClasseur([{ nom: "Autre", feuille: "Ventes", entetes: ["Mois"], lignes: [["j"]] }]);
  await office.initialiserClasseur();
  const r = await office.ecrireDiagramme(MODELE);
  attendu(r.ok, "écriture faite : " + (r.error || ""));
  const [n, l] = c.tablesDe("Diagramme");
  egal(c.hauteurDe(n), 3, "trois nœuds écrits");
  egal(c.hauteurDe(l), 2, "deux liens écrits");
});

await test("initialisation : un classeur déjà préparé n'est pas touché", async () => {
  const c = classeurType();
  const avant = JSON.stringify(c.lignesDe("Noeuds")) + JSON.stringify(c.lignesDe("Liens"));
  const r = await office.initialiserClasseur();
  egal(r.ok, false, "refus");
  egal(r.deja, true, "et il dit pourquoi : c'était déjà fait");
  egal(JSON.stringify(c.lignesDe("Noeuds")) + JSON.stringify(c.lignesDe("Liens")), avant,
       "rien n'a bougé");
  egal(c.tablesDe("Diagramme").length, 2, "aucun tableau ajouté");
});

await test("initialisation : une feuille « Diagramme » NON VIDE est refusée, pas écrasée", async () => {
  // Le cas dangereux : quelqu'un a une feuille de ce nom qui sert à autre chose.
  const c = monterClasseur([
    { nom: "Budget", feuille: "Diagramme", entetes: ["Poste", "Montant"],
      lignes: [["Loyer", 900]] }
  ]);
  const r = await office.initialiserClasseur();
  egal(r.ok, false, "refus");
  attendu(/n'est pas vide/.test(r.error || ""), "message explicite : " + r.error);
  egal(c.tablesDe("Diagramme"), ["Budget"], "le tableau de l'utilisatrice est seul et intact");
  egal(c.lignesDe("Budget"), [["Loyer", 900]], "son contenu est intact");
});

await test("initialisation : un demi-diagramme est refusé plutôt que complété au jugé", async () => {
  const c = monterClasseur([
    { nom: "Noeuds", entetes: NODE_COLS.slice(), c0: 0,
      lignes: [["Lait", "Lait cru", 1, "", 0, "", "n1", 1, "Produit"]] }
  ]);
  const r = await office.initialiserClasseur();
  egal(r.ok, false, "refus");
  egal(c.tablesDe("Diagramme"), ["Noeuds"], "aucun tableau ajouté");
});

await test("initialisation : les noms de tableaux déjà pris sont contournés", async () => {
  // Excel refuse deux tableaux de même nom dans tout le classeur : sans
  // `nomLibre`, l'initialisation lèverait ici. Le nom n'a aucune importance
  // pour la suite — tout se retrouve par les en-têtes — mais il doit exister.
  // Les NOMS sont pris, mais par des tableaux sans rapport : rien à repérer.
  const c = monterClasseur([
    { nom: "Noeuds", feuille: "Ventes", entetes: ["Mois", "Chiffre"], c0: 0, lignes: [["j", 1]] },
    { nom: "Liens", feuille: "Ventes", entetes: ["Poste", "Montant"], c0: 20, lignes: [["x", 2]] }
  ]);
  const r = await office.initialiserClasseur();
  attendu(r.ok, "initialisation faite malgré les noms pris : " + (r.error || ""));
  const noms = c.tablesDe("Diagramme");
  egal(noms.length, 2, "deux tableaux créés");
  attendu(noms.indexOf("Noeuds") < 0 && noms.indexOf("Liens") < 0,
          "des noms libres ont été choisis : " + noms.join(", "));
  attendu(await office.diagrammePresent(), "et le diagramme se repère quand même");
});

/* ---------------------------- REPÉRAGE ---------------------------- */
/*
 * Le premier essai dans Excel (2026-09-01) a lu 32 liens là où le classeur en
 * portait 129 : une feuille « Flux » y porte un tableau `flux_lait` qui a lui
 * aussi une colonne « Origine », et il vient AVANT ceux du diagramme. Le
 * repérage prenait le premier venu, dans tout le classeur. Écrit, il aurait
 * écrasé un tableau de l'utilisatrice.
 */

/** Le classeur du poste d'essai : l'intrus vient en premier, sur sa feuille. */
function classeurAvecIntrus(opts) {
  opts = opts || {};
  const feuilleDiagramme = opts.feuille || "Diagramme";
  const tables = [
    {
      nom: "flux_lait", feuille: "Flux", c0: 30,
      entetes: ["Filière", "Origine", "Destination", "Ordre vertical du lien",
                "Valeur du flux en tonnes"],
      lignes: [["Lait", "Ferme", "Laiterie", 1, 42], ["Lait", "Laiterie", "Magasin", 2, 40]]
    },
    {
      nom: "Noeuds", feuille: feuilleDiagramme, entetes: NODE_COLS.slice(), c0: 0,
      lignes: [
        ["Lait", "Production bio", 1, "Production", 0, "#adcb47", "n1", 2, "Produit"],
        ["Lait", "Lait cru", 2, "Collecte", 0, "", "n2", 2, "Produit"],
        ["Lait", "Transformation", 3, "Industrie", 0, "", "n3", 1, "Industrie"]
      ]
    }
  ];
  if (!opts.sansLiens) {
    tables.push({
      nom: "Liens", feuille: feuilleDiagramme, entetes: LINK_COLS.slice(), c0: LIENS_C0,
      lignes: [
        ["Lait", "Production bio", "Lait cru", 120, "t", "n1", "n2"],
        ["Lait", "Lait cru", "Transformation", 95, "t", "n2", "n3"]
      ]
    });
  }
  return monterClasseur(tables);
}

await test("repérage : un tableau étranger portant « Origine » n'est pas pris pour les liens", async () => {
  classeurAvecIntrus();
  const d = await office.lireDiagramme();
  egal(d.links.length, 2, "les liens viennent du tableau « Liens », pas de « flux_lait »");
  egal(d.links[0].sourceId, "n1", "premier lien du diagramme");
  egal(d.sheetName, "Diagramme", "feuille du diagramme");
});

await test("repérage : les deux tableaux viennent de la MÊME feuille", async () => {
  // Le diagramme n'a pas de tableau de liens : celui d'à côté ne doit pas
  // servir de remplaçant, sinon on écrirait dedans.
  classeurAvecIntrus({ sansLiens: true });
  const d = await office.lireDiagramme();
  egal(d.nodes.length, 3, "les nœuds sont lus");
  egal(d.links.length, 0, "aucun lien : on ne cueille pas celui d'une autre feuille");
});

await test("repérage : un diagramme sur une feuille au nom inattendu est trouvé quand même", async () => {
  // « Diagramme » n'existe pas ici : on retient alors la feuille qui porte LES
  // DEUX tableaux, jamais deux moitiés prises sur deux feuilles.
  classeurAvecIntrus({ feuille: "Mon diagramme" });
  const d = await office.lireDiagramme();
  egal(d.links.length, 2, "les deux liens du diagramme");
  egal(d.sheetName, "Mon diagramme", "feuille retenue");
});

await test("repérage : écrire ne touche pas le tableau étranger", async () => {
  const c = classeurAvecIntrus();
  const avant = JSON.stringify(c.lignesDe("flux_lait"));
  const r = await office.ecrireDiagramme(MODELE);
  attendu(r.ok, "écriture faite");
  egal(c.lignesDe("flux_lait"), JSON.parse(avant), "« flux_lait » intact");
});

/* ------------------------------ ÉCRITURE ------------------------------ */

await test("écriture : aller-retour neutre — réécrire ce qu'on a lu ne change rien", async () => {
  const c = classeurType();
  const avant = JSON.stringify(c.lignesDe("Noeuds")) + JSON.stringify(c.lignesDe("Liens"));
  const r = await office.ecrireDiagramme(MODELE);
  attendu(r.ok, "écriture réussie : " + (r.error || ""));
  const apres = JSON.stringify(c.lignesDe("Noeuds")) + JSON.stringify(c.lignesDe("Liens"));
  egal(apres, avant, "les cellules sont identiques après un aller-retour neutre");
});

await test("écriture : la formule « Valeur du flux » est préservée", async () => {
  const c = classeurType();
  const r = await office.ecrireDiagramme(MODELE);
  egal(r.formules, 1, "une formule réémise");
  const formules = c.formulesDe("Liens");
  const iVal = LINK_COLS.indexOf("Valeur du flux");
  egal(formules[1][iVal], "=Lentilles!C68", "la formule est toujours là");
  egal(c.lignesDe("Liens")[1][iVal], 95, "et sa valeur calculée n'a pas été écrasée");
});

await test("écriture : l'ordre des lignes est celui de buildModelRows", async () => {
  const c = classeurType();
  await office.ecrireDiagramme(MODELE);
  const { nodeRows } = buildModelRows(MODELE, null);
  const attendus = nodeRows.map(l => l.map(cel => cel.v));
  egal(c.lignesDe("Noeuds"), attendus,
       "même tri que l'écriture du .xlsx — sinon les deux chemins divergeraient");
});

await test("écriture : ajouter des nœuds agrandit le tableau sans décaler son voisin", async () => {
  const c = classeurType();
  const gros = {
    nodes: MODELE.nodes.concat([
      { id: "n4", name: "Beurre", column: 4, title: "Aval", order: 1, lane: 1, kind: "produit", filiere: "Lait", color: null },
      { id: "n5", name: "Crème", column: 4, title: "Aval", order: 2, lane: 1, kind: "produit", filiere: "Lait", color: null }
    ]),
    links: MODELE.links
  };
  await office.ecrireDiagramme(gros);
  egal(c.hauteurDe("Noeuds"), 5, "cinq nœuds");
  egal(c.hauteurDe("Liens"), 2, "le tableau des liens n'a pas bougé");
  const liens = c.lignesDe("Liens");
  egal(liens[0][1], "Production bio", "et son contenu est intact");
  egal(liens.length, 2, "toujours deux lignes de liens");
});

await test("écriture : supprimer des nœuds rétrécit le tableau sans décaler son voisin", async () => {
  const c = classeurType();
  const petit = {
    nodes: [MODELE.nodes[0]],
    links: []
  };
  await office.ecrireDiagramme(petit);
  egal(c.hauteurDe("Noeuds"), 1, "un seul nœud");
  const liens = c.lignesDe("Liens");
  egal(liens.length, 1, "un tableau Excel ne peut pas avoir zéro ligne : on en garde une");
  egal(liens[0].every(v => v === ""), true, "et elle est vide");
});

await test("écriture : rétrécir les nœuds ne remonte pas les lignes des liens", async () => {
  // Le piège : supprimer des lignes sur toute leur largeur, et non sur les
  // seules colonnes du tableau, ferait remonter le tableau voisin avec lui.
  // Il faut donc que le tableau des liens ait du CONTENU à préserver pendant
  // que celui des nœuds rétrécit — sinon le test ne peut rien voir.
  const c = classeurType({
    noeuds: [
      ["Lait", "Production bio", 1, "Production", 0, "#adcb47", "n1", 2, "Produit"],
      ["Lait", "Lait cru", 2, "Collecte", 0, "", "n2", 2, "Produit"],
      ["Lait", "Transformation", 3, "Industrie", 0, "", "n3", 1, "Industrie"],
      ["Lait", "Beurre", 4, "Aval", 1, "", "n4", 1, "Produit"],
      ["Lait", "Crème", 4, "Aval", 2, "", "n5", 1, "Produit"]
    ]
  });
  egal(c.hauteurDe("Noeuds"), 5, "cinq nœuds au départ");
  const liensAvant = JSON.stringify(c.lignesDe("Liens"));

  await office.ecrireDiagramme(MODELE);        // le modèle n'a que trois nœuds

  egal(c.hauteurDe("Noeuds"), 3, "le tableau des nœuds a rétréci");
  egal(c.hauteurDe("Liens"), 2, "celui des liens garde ses deux lignes");
  egal(JSON.stringify(c.lignesDe("Liens")), liensAvant,
       "et son contenu n'a pas bougé d'une ligne");
  egal(c.formulesDe("Liens")[1][LINK_COLS.indexOf("Valeur du flux")], "=Lentilles!C68",
       "la formule du second lien est toujours à sa place");
});

await test("écriture : sans aucun nœud, une ligne vide subsiste", async () => {
  const c = classeurType();
  await office.ecrireDiagramme({ nodes: [], links: [] });
  egal(c.hauteurDe("Noeuds"), 1, "une ligne conservée");
  egal(c.lignesDe("Noeuds")[0].every(v => v === ""), true, "vide");
});

await test("écriture : une colonne inconnue du classeur n'est pas écrasée", async () => {
  const avecExtra = NODE_COLS.concat(["Commentaire"]);
  const c = classeurType({
    entetesNoeuds: avecExtra,
    noeuds: [
      ["Lait", "Production bio", 1, "Production", 0, "#adcb47", "n1", 2, "Produit", "à revoir"],
      ["Lait", "Lait cru", 2, "Collecte", 0, "", "n2", 2, "Produit", "ok"],
      ["Lait", "Transformation", 3, "Industrie", 0, "", "n3", 1, "Industrie", ""]
    ]
  });
  await office.ecrireDiagramme(MODELE);
  const lignes = c.lignesDe("Noeuds");
  const iCom = avecExtra.indexOf("Commentaire");
  egal(lignes.map(l => l[iCom]), ["à revoir", "ok", ""],
       "la colonne ajoutée par l'utilisatrice survit à l'écriture");
  const { nodeRows } = buildModelRows(MODELE, null);
  verifierTableau(c, "Noeuds", avecExtra, nodeRows, NODE_COLS, "colonne étrangère");
});

await test("écriture : une colonne absente du classeur est simplement ignorée", async () => {
  const sansCouloir = NODE_COLS.filter(c => c !== "Couloir");
  const c = classeurType({
    entetesNoeuds: sansCouloir,
    noeuds: [["Lait", "Production bio", 1, "Production", 0, "#adcb47", "n1", "Produit"]]
  });
  const r = await office.ecrireDiagramme(MODELE);
  attendu(r.ok, "écriture réussie malgré la colonne manquante");
  const { nodeRows } = buildModelRows(MODELE, null);
  // Sans « Couloir », toutes les colonnes qui la suivent glissent d'un cran :
  // écrire par position au lieu du nom d'en-tête décalerait « Type » hors du tableau.
  verifierTableau(c, "Noeuds", sansCouloir, nodeRows, NODE_COLS, "colonne manquante");
  egal(c.cellule(1, sansCouloir.length).v, "",
       "rien n'a été écrit à DROITE du tableau");
});

await test("écriture : un ordre de colonnes inhabituel est respecté", async () => {
  // Le pendant en écriture du test de lecture : les colonnes se retrouvent par
  // leur en-tête. Écrire par position produirait ici un classeur brouillé.
  const melange = ["ID", "Noeud", "Type", "Couloir", "Filière",
                   "Numéro de colonne d'affichage", "Intitulé de la colonne d'affichage",
                   "Ordre vertical d'affichage", "Couleur"];
  const c = classeurType({
    entetesNoeuds: melange,
    noeuds: [["n1", "Production bio", "Produit", 2, "Lait", 1, "Production", 0, "#adcb47"]]
  });
  const r = await office.ecrireDiagramme(MODELE);
  attendu(r.ok, "écriture réussie");
  const { nodeRows } = buildModelRows(MODELE, null);
  verifierTableau(c, "Noeuds", melange, nodeRows, NODE_COLS, "ordre inhabituel");
});

await test("écriture : l'enregistrement n'a lieu que si on le demande", async () => {
  const c1 = classeurType();
  const r1 = await office.ecrireDiagramme(MODELE);
  egal(r1.enregistre, false, "pas d'enregistrement par défaut");
  egal(c1.enregistrements(), 0, "workbook.save() n'a pas été appelé");

  const c2 = classeurType();
  const r2 = await office.ecrireDiagramme(MODELE, "Diagramme", { save: true });
  egal(r2.enregistre, true, "enregistrement demandé");
  egal(c2.enregistrements(), 1, "workbook.save() appelé une fois");
});

await test("écriture : tableaux introuvables -> ok faux et message clair", async () => {
  monterClasseur([{ nom: "Autre", entetes: ["Mois"], lignes: [["janvier"]] }]);
  const r = await office.ecrireDiagramme(MODELE);
  egal(r.ok, false, "échec signalé");
  attendu(/introuvables/.test(r.error || ""), "message explicite : " + r.error);
});

/* ------------------------------ bilan ------------------------------ */

console.log(`\n${ok}/${ok + echecs.length} tests passés`);
if (echecs.length) { console.log("Échecs : " + echecs.join(", ")); process.exit(1); }

})();
