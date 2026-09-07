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
  ], { recopie: opts.recopie, normalise: opts.normalise });
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
  egal(d.hasBio, true, "hasBio");
  egal(d.links[1], {
    sourceId: "n2", targetId: "n3", sourceName: "Lait cru",
    targetName: "Transformation", value: 95, unit: "t", bio: 0
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

await test("lecture : la part bio accepte une part comme un pourcentage", async () => {
  // La colonne se remplit à la main : « 0,5 », « 50 » et une cellule mise en
  // forme « 50 % » (qu'Excel rend en 0,5) doivent toutes dire la moitié.
  classeurType({
    liens: [
      ["Lait", "Production bio", "Lait cru", 120, "t", "n1", "n2", 0.5],
      ["Lait", "Lait cru", "Transformation", 95, "t", "n2", "n3", 50]
    ]
  });
  const d = await office.lireDiagramme();
  egal(d.links.map(l => l.bio), [0.5, 0.5], "part et pourcentage disent la même chose");
});

await test("lecture : une part bio vide, absurde ou absente vaut zéro", async () => {
  classeurType({
    liens: [
      ["Lait", "Production bio", "Lait cru", 120, "t", "n1", "n2", ""],
      ["Lait", "Lait cru", "Transformation", 95, "t", "n2", "n3", "beaucoup"]
    ]
  });
  const d = await office.lireDiagramme();
  egal(d.links.map(l => l.bio), [0, 0], "rien de chiffré : aucun bandeau");

  // Un classeur d'avant la colonne : elle manque, et rien ne casse.
  classeurType({
    entetesLiens: LINK_COLS.filter(c => c !== "Part bio / durable"),
    liens: [["Lait", "Production bio", "Lait cru", 120, "t", "n1", "n2"]]
  });
  const sans = await office.lireDiagramme();
  egal(sans.hasBio, false, "hasBio faux sans la colonne");
  egal(sans.links[0].bio, 0, "part bio nulle");
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
  egal(formules[1][iVal], "=Lentilles!$C$68",
       "la formule est toujours là — ancrée, pour qu'aucun recalage ne la décale");
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
  egal(c.formulesDe("Liens")[1][LINK_COLS.indexOf("Valeur du flux")], "=Lentilles!$C$68",
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

/* --- Le décalage : les lignes sont RETRIÉES à chaque écriture. Tout ce que le
   complément n'écrit pas doit donc suivre sa ligne, sinon le repère de
   l'utilisatrice se retrouve en face d'un autre nœud, d'un autre lien. --- */

// Quatre nœuds d'une même filière, tous couloir 1 : seul le tri par colonne
// joue, ce qui rend le réordonnancement lisible.
const QUATRE = [
  { id: "n1", name: "Production bio", column: 1, title: "Production", order: 0, lane: 1, kind: "produit", filiere: "Lait", color: null },
  { id: "n2", name: "Lait cru", column: 2, title: "Collecte", order: 0, lane: 1, kind: "produit", filiere: "Lait", color: null },
  { id: "n3", name: "Transformation", column: 3, title: "Industrie", order: 0, lane: 1, kind: "industrie", filiere: "Lait", color: null },
  { id: "n4", name: "Beurre", column: 4, title: "Aval", order: 0, lane: 1, kind: "produit", filiere: "Lait", color: null }
];
const LIENS_QUATRE = [
  { source: "n1", target: "n2", value: 120, unit: "t" },
  { source: "n2", target: "n3", value: 95, unit: "t" },
  { source: "n3", target: "n4", value: 30, unit: "t" }
];
/** L'édition : « Transformation » passe en colonne 1 — l'ordre des lignes change. */
function deplaceTransformation() {
  return {
    nodes: QUATRE.map(n => (n.id === "n3" ? Object.assign({}, n, { column: 1, order: 9 }) : n)),
    links: LIENS_QUATRE.map(l => Object.assign({}, l))
  };
}
const RANGS_QUATRE = [
  ["Lait", "Production bio", 1, "Production", 0, "", "n1", 1, "Produit"],
  ["Lait", "Lait cru", 2, "Collecte", 0, "", "n2", 1, "Produit"],
  ["Lait", "Transformation", 3, "Industrie", 0, "", "n3", 1, "Industrie"],
  ["Lait", "Beurre", 4, "Aval", 0, "", "n4", 1, "Produit"]
];

await test("écriture : une colonne de l'utilisatrice suit SA ligne quand l'ordre change", async () => {
  // Le bug signalé. « Quantité brute » est à l'utilisatrice ; la formule de la
  // colonne « Valeur du flux » la vise par son adresse (=Q3*1000). Si la
  // colonne reste sur place pendant que les liens sont retriés, la formule lit
  // la ligne du voisin — et toutes les valeurs du diagramme sont fausses.
  const avecExtra = LINK_COLS.concat(["Quantité brute"]);
  const c = classeurType({
    noeuds: RANGS_QUATRE,
    entetesLiens: avecExtra,
    liens: [
      ["Lait", "Production bio", "Lait cru", { f: "=Q2*1000", v: 120 }, "t", "n1", "n2", "", 0.12],
      ["Lait", "Lait cru", "Transformation", { f: "=Q3*1000", v: 95 }, "t", "n2", "n3", "", 0.095],
      ["Lait", "Transformation", "Beurre", { f: "=Q4*1000", v: 30 }, "t", "n3", "n4", "", 0.03]
    ]
  });
  await office.ecrireDiagramme(deplaceTransformation());

  const iBrute = avecExtra.indexOf("Quantité brute");
  const iVal = avecExtra.indexOf("Valeur du flux");
  const liens = c.lignesDe("Liens");
  egal(liens.map(l => [l[1] + " -> " + l[2], l[iBrute]]), [
    ["Production bio -> Lait cru", 0.12],
    ["Transformation -> Beurre", 0.03],
    ["Lait cru -> Transformation", 0.095]
  ], "chaque quantité brute est restée avec SON lien");
  egal(c.formulesDe("Liens").map(l => l[iVal]),
       ["=$Q$2*1000", "=$Q$4*1000", "=$Q$3*1000"],
       "et chaque formule aussi, ancrée au passage");
});

await test("écriture : la colonne de l'utilisatrice suit aussi les nœuds retriés", async () => {
  const avecExtra = NODE_COLS.concat(["Commentaire"]);
  const c = classeurType({
    entetesNoeuds: avecExtra,
    noeuds: RANGS_QUATRE.map((l, i) => l.concat([["un", "deux", "trois", "quatre"][i]])),
    liens: [["Lait", "Production bio", "Lait cru", 120, "t", "n1", "n2"]]
  });
  await office.ecrireDiagramme(deplaceTransformation());

  const iCom = avecExtra.indexOf("Commentaire");
  egal(c.lignesDe("Noeuds").map(l => [l[1], l[iCom]]), [
    ["Production bio", "un"],
    ["Transformation", "trois"],
    ["Lait cru", "deux"],
    ["Beurre", "quatre"]
  ], "le commentaire suit son nœud");
});

await test("écriture : une ligne nouvelle n'hérite pas de la colonne du voisin", async () => {
  // Sans le report, la ligne insérée ramassait ce qui traînait à sa place.
  const avecExtra = LINK_COLS.concat(["Quantité brute"]);
  const c = classeurType({
    noeuds: RANGS_QUATRE,
    entetesLiens: avecExtra,
    liens: [
      ["Lait", "Lait cru", "Transformation", 95, "t", "n2", "n3", "", 0.095],
      ["Lait", "Transformation", "Beurre", 30, "t", "n3", "n4", "", 0.03]
    ]
  });
  await office.ecrireDiagramme({ nodes: QUATRE, links: LIENS_QUATRE });

  const iBrute = avecExtra.indexOf("Quantité brute");
  egal(c.lignesDe("Liens").map(l => [l[1] + " -> " + l[2], l[iBrute]]), [
    ["Production bio -> Lait cru", ""],
    ["Lait cru -> Transformation", 0.095],
    ["Transformation -> Beurre", 0.03]
  ], "le lien ajouté arrive avec une cellule vide, pas celle du voisin");
});

await test("écriture : la part bio n'est JAMAIS réécrite, formule comprise", async () => {
  // C'est une donnée de l'utilisatrice, souvent calculée. Nous la lisons ; la
  // réécrire l'écraserait, comme Excel a écrasé « Valeur du flux » chez APS.
  const c = classeurType({
    noeuds: RANGS_QUATRE,
    liens: [
      ["Lait", "Production bio", "Lait cru", 120, "t", "n1", "n2",
       { f: "=Bio!C2/Bio!D2", v: 0.4 }],
      ["Lait", "Lait cru", "Transformation", 95, "t", "n2", "n3", 0.25],
      ["Lait", "Transformation", "Beurre", 30, "t", "n3", "n4", 1]
    ]
  });
  await office.ecrireDiagramme(deplaceTransformation());

  const iBio = LINK_COLS.indexOf("Part bio / durable");
  const liens = c.lignesDe("Liens");
  egal(liens.map(l => [l[1] + " -> " + l[2], l[iBio]]), [
    ["Production bio -> Lait cru", 0.4],
    ["Transformation -> Beurre", 1],
    ["Lait cru -> Transformation", 0.25]
  ], "chaque part bio est restée avec SON lien malgré le retri");
  egal(c.formulesDe("Liens")[0][iBio], "=Bio!C2/Bio!D2",
    "et la formule de la part bio est intacte");
});


await test("écriture : une formule n'est pas recopiée sur un lien homonyme", async () => {
  // Deux filières, les mêmes noms de nœuds : le repli par noms servait la même
  // formule à deux liens. Elle appartient à UN lien — celui de sa ligne.
  const noeuds = [
    ["Lait", "Ferme", 1, "Amont", 0, "", "n1", 1, "Produit"],
    ["Lait", "Collecte", 2, "Aval", 0, "", "n2", 1, "Produit"],
    ["Blé", "Ferme", 1, "Amont", 0, "", "n3", 1, "Produit"],
    ["Blé", "Collecte", 2, "Aval", 0, "", "n4", 1, "Produit"]
  ];
  const c = classeurType({
    noeuds,
    liens: [
      // Ligne saisie à la main dans Excel : pas d'ID, donc repli par les noms.
      ["Lait", "Ferme", "Collecte", { f: "=Lentilles!C68", v: 120 }, "t", "", ""],
      ["Blé", "Ferme", "Collecte", 42, "t", "n3", "n4"]
    ]
  });
  const model = {
    nodes: [
      { id: "n1", name: "Ferme", column: 1, title: "Amont", order: 0, lane: 1, kind: "produit", filiere: "Lait", color: null },
      { id: "n2", name: "Collecte", column: 2, title: "Aval", order: 0, lane: 1, kind: "produit", filiere: "Lait", color: null },
      { id: "n3", name: "Ferme", column: 1, title: "Amont", order: 0, lane: 1, kind: "produit", filiere: "Blé", color: null },
      { id: "n4", name: "Collecte", column: 2, title: "Aval", order: 0, lane: 1, kind: "produit", filiere: "Blé", color: null }
    ],
    links: [
      { source: "n1", target: "n2", value: 120, unit: "t" },
      { source: "n3", target: "n4", value: 42, unit: "t" }
    ]
  };
  const r = await office.ecrireDiagramme(model);
  egal(r.formules, 1, "une seule formule réémise — il n'y en avait qu'une");
  const iVal = LINK_COLS.indexOf("Valeur du flux");
  const formules = c.formulesDe("Liens").map(l => l[iVal]);
  egal(formules.filter(f => f).length, 1, "le lien homonyme n'a pas hérité de la formule");
});

await test("écriture : les références d'une formule sont ancrées ($) en la réémettant", async () => {
  // Le tri déplace une formule d'une ligne à l'autre. Sans « $ », c'est le
  // genre de référence qu'Excel recale (recopie, colonne calculée) : la formule
  // se mettrait à lire une AUTRE ligne de l'onglet source. Ancrée, elle ne peut
  // plus bouger. Les onglets, les chaînes et les références structurées, elles,
  // ne doivent pas être touchées.
  const c = classeurType({
    noeuds: RANGS_QUATRE,
    liens: [
      // « T2 » est un onglet, pas la cellule T2 ; « Q4 » est une colonne, pas la
      // cellule Q4. Les deux pièges se ressemblent, et se paient cher.
      ["Lait", "Production bio", "Lait cru", { f: "=T2!B7*'Coefs 2026'!C3", v: 120 }, "t", "n1", "n2"],
      ["Lait", "Lait cru", "Transformation", { f: "=IFERROR(SUM(Lentilles!C68:C70),\"B12\")", v: 95 }, "t", "n2", "n3"],
      ["Lait", "Transformation", "Beurre", { f: "=Liens[@[Q4]]*A3", v: 30 }, "t", "n3", "n4"]
    ]
  });
  const r = await office.ecrireDiagramme({ nodes: QUATRE, links: LIENS_QUATRE });
  egal(r.formules, 3, "les trois formules sont réémises");
  const iVal = LINK_COLS.indexOf("Valeur du flux");
  egal(c.formulesDe("Liens").map(l => l[iVal]), [
    "=T2!$B$7*'Coefs 2026'!$C$3",      // « T2! » est un onglet, pas une cellule
    "=IFERROR(SUM(Lentilles!$C$68:$C$70),\"B12\")",   // « B12 » entre guillemets : du texte
    "=Liens[@[Q4]]*$A$3"               // structurée : déjà relative à SA ligne
  ], "seules les références de cellules sont ancrées");
});

/* ------------- la colonne « Valeur du flux » ne doit pas se remplir seule ------------- */

/** Quatre nœuds, trois liens, chacun avec SA formule — le cas de la vraie vie. */
function classeurAFormulesDistinctes() {
  return classeurType({
    noeuds: RANGS_QUATRE,
    liens: [
      ["Lait", "Production bio", "Lait cru", { f: "='Blé tendre'!$C$8", v: 120 }, "t", "n1", "n2"],
      ["Lait", "Lait cru", "Transformation", { f: "='Blé tendre'!$C$9", v: 95 }, "t", "n2", "n3"],
      ["Lait", "Transformation", "Beurre", { f: "='Blé tendre'!$C$10", v: 30 }, "t", "n3", "n4"]
    ]
  });
}

await test("ajout d'un nœud : les formules distinctes de la colonne valeur sont intactes", async () => {
  // Le cas signalé, dans sa forme saine. Ajouter un nœud réécrit tout le
  // classeur : chaque formule doit rester sur SA ligne, et aucune ne doit se
  // propager sur les voisines.
  const c = classeurAFormulesDistinctes();
  const avantLiens = JSON.stringify(c.lignesDe("Liens"));

  const modele = {
    nodes: QUATRE.concat([{
      id: "n5", name: "Nouveau nœud", column: 4, title: "", order: 0,
      lane: 1, kind: "produit", filiere: "Lait", color: null
    }]),
    links: LIENS_QUATRE
  };
  const r = await office.ecrireDiagramme(modele);
  attendu(r.ok, "écriture réussie");
  attendu(!r.remplissage, "aucun remplissage : le classeur était sain");

  const iVal = LINK_COLS.indexOf("Valeur du flux");
  egal(c.formulesDe("Liens").map(l => l[iVal]),
       ["='Blé tendre'!$C$8", "='Blé tendre'!$C$9", "='Blé tendre'!$C$10"],
       "chaque formule est restée sur la ligne de SON lien");
  egal(JSON.stringify(c.lignesDe("Liens")), avantLiens,
       "le tableau des liens n'a pas bougé d'une cellule : le nœud ajouté ne le concerne pas");
  egal(c.hauteurDe("Noeuds"), 5, "seul le tableau des nœuds a gagné une ligne");
});

await test("écriture : une colonne calculée d'Excel n'est pas prise pour des données", async () => {
  // LA CAUSE RACINE. Excel transforme une colonne de tableau en « colonne
  // calculée » dès que ses cellules portent la même formule : il la recopie
  // alors sur TOUTES les lignes, écrasant les valeurs. Le classeur d'AgriParis
  // Seine a fini avec 150 liens portant `='Blé tendre'!$C$8`.
  // Relire ces cellules comme autant de formules d'utilisatrice, c'est
  // réécrire la corruption — et la recréer après chaque restauration.
  const c = classeurType({
    noeuds: RANGS_QUATRE,
    liens: [
      ["Lait", "Production bio", "Lait cru", { f: "='Blé tendre'!$C$8", v: 42 }, "t", "n1", "n2"],
      ["Lait", "Lait cru", "Transformation", { f: "='Blé tendre'!$C$8", v: 42 }, "t", "n2", "n3"],
      ["Lait", "Transformation", "Beurre", { f: "='Blé tendre'!$C$8", v: 42 }, "t", "n3", "n4"]
    ]
  });
  const r = await office.ecrireDiagramme({ nodes: QUATRE, links: LIENS_QUATRE });
  attendu(r.ok, "écriture réussie");
  egal(r.remplissage, { formule: "='Blé tendre'!$C$8", liens: 3 },
       "le remplissage est signalé, avec le nombre de liens qu'il occupait");
  egal(r.formules, 0, "aucune formule réémise");
  const iVal = LINK_COLS.indexOf("Valeur du flux");
  egal(c.formulesDe("Liens").map(l => l[iVal]), ["", "", ""],
       "la colonne est réécrite en valeurs : Excel abandonne la colonne calculée");
  egal(c.lignesDe("Liens").map(l => l[iVal]),
       LIENS_QUATRE.map(l => l.value),
       "chaque lien retrouve la valeur du modèle");
});

await test("écriture : un unique lien à formule n'est pas une colonne calculée", async () => {
  // Le cas limite de la détection : quand le tableau ne compte qu'UNE ligne,
  // « toutes les lignes portent la même formule » est vrai par construction.
  // Il faut au moins deux lignes concordantes pour parler de remplissage,
  // sinon le premier lien d'un diagramme naissant perdrait sa formule.
  const c = classeurType({
    noeuds: [
      ["Lait", "Production bio", 1, "Production", 0, "", "n1", 1, "Produit"],
      ["Lait", "Lait cru", 2, "Collecte", 0, "", "n2", 1, "Produit"]
    ],
    liens: [["Lait", "Production bio", "Lait cru", { f: "='Blé tendre'!$C$8", v: 120 }, "t", "n1", "n2"]]
  });
  const modele = {
    nodes: [
      { id: "n1", name: "Production bio", column: 1, title: "Production", order: 0, lane: 1, kind: "produit", filiere: "Lait", color: null },
      { id: "n2", name: "Lait cru", column: 2, title: "Collecte", order: 0, lane: 1, kind: "produit", filiere: "Lait", color: null }
    ],
    links: [{ source: "n1", target: "n2", value: 120, unit: "t" }]
  };
  const r = await office.ecrireDiagramme(modele);
  attendu(!r.remplissage, "une ligne unique ne prouve rien");
  egal(c.formulesDe("Liens")[0][LINK_COLS.indexOf("Valeur du flux")],
       "='Blé tendre'!$C$8", "la formule du seul lien est conservée");
});

/* ------------- quand c'est NOTRE écriture qu'Excel recopie ------------- */

/**
 * Le classeur d'AgriParis Seine au moment du bug (7 septembre 2026) : la colonne
 * « Valeur du flux » est VIDE, l'utilisatrice vient de taper sa formule dans la
 * première case, et elle déplace un nœud de couloir. Le complément n'écrit
 * qu'UNE formule — les tests au-dessus le prouvent — mais Excel, lui, peut
 * l'étendre à tous les liens en faisant de la colonne une COLONNE CALCULÉE.
 * Ce qui compte alors : que les valeurs, qui viennent du modèle, soient encore
 * là après l'écriture.
 */
function classeurDUneSeuleFormule(recopie) {
  return classeurType({
    recopie,
    noeuds: RANGS_QUATRE,
    liens: [
      ["Lait", "Production bio", "Lait cru", { f: "='Blé tendre'!$C$8", v: 15126461.6 }, "t", "n1", "n2"],
      ["Lait", "Lait cru", "Transformation", "", "t", "n2", "n3"],
      ["Lait", "Transformation", "Beurre", "", "t", "n3", "n4"]
    ]
  });
}
/** L'édition signalée : un nœud change de couloir, rien d'autre. */
function deplaceBeurreDeCouloir() {
  return {
    nodes: QUATRE.map(n => (n.id === "n4" ? Object.assign({}, n, { lane: 2 }) : n)),
    links: [
      { source: "n1", target: "n2", value: 15126461.6, unit: "t" },
      { source: "n2", target: "n3", value: 0, unit: "t" },
      { source: "n3", target: "n4", value: 0, unit: "t" }
    ]
  };
}

await test("écriture : une recopie passagère d'Excel est défaite dans le même envoi", async () => {
  // Excel étend la formule à toute la colonne au moment où elle s'y pose. Les
  // nombres, reposés juste après dans le MÊME envoi, la démentent avant même le
  // sync : rien ne se voit, et la formule reste sur le lien qui est le sien.
  const c = classeurDUneSeuleFormule("passagere");
  const r = await office.ecrireDiagramme(deplaceBeurreDeCouloir());
  attendu(r.ok, "écriture réussie");
  attendu(!r.remplissage, "la recopie a été défaite sans laisser de trace");
  const iVal = LINK_COLS.indexOf("Valeur du flux");
  egal(c.formulesDe("Liens").map(l => l[iVal]), ["='Blé tendre'!$C$8", "", ""],
       "la formule est restée sur SON lien, et nulle part ailleurs");
  egal(c.lignesDe("Liens").map(l => l[iVal]), [15126461.6, 0, 0],
       "les valeurs des autres liens sont intactes");
});

await test("écriture : une colonne calculée créée par notre écriture est défaite, et dite", async () => {
  // LE CAS DU 7 SEPTEMBRE. Excel TIENT sa colonne calculée : reposer les nombres
  // ne suffit pas, il les recouvre. On relit donc après avoir écrit, et là on ne
  // peut plus garder la formule — mais les valeurs, elles, viennent du modèle :
  // on les repose toutes, la colonne perd sa dernière formule, Excel abandonne.
  // Et on le DIT, sinon l'utilisatrice croirait sa formule enregistrée.
  const c = classeurDUneSeuleFormule("colonneCalculee");
  const r = await office.ecrireDiagramme(deplaceBeurreDeCouloir());
  attendu(r.ok, "écriture réussie");
  egal(r.remplissage, { formule: "='Blé tendre'!$C$8", liens: 3, aLEcriture: true },
       "la recopie est signalée, prise sur le fait");
  egal(r.formules, 0, "aucune formule n'a survécu : ne pas prétendre le contraire");
  const iVal = LINK_COLS.indexOf("Valeur du flux");
  egal(c.formulesDe("Liens").map(l => l[iVal]), ["", "", ""],
       "plus une seule formule : Excel abandonne sa colonne calculée");
  egal(c.lignesDe("Liens").map(l => l[iVal]), [15126461.6, 0, 0],
       "AUCUNE valeur n'est perdue — elles viennent du modèle");
});

await test("écriture : chaque formule est posée sur SA cellule, jamais la colonne entière", async () => {
  // LE BUG DU 7 SEPTEMBRE 2026, AU SOIR. Affecter la colonne entière en
  // `.formulas`, c'est dire à Excel quelle est la formule DE LA COLONNE : il en
  // fait une colonne calculée et étend la première à toutes les lignes qui en
  // portaient une. Dans « Flux APS.xlsx » : dix formules distinctes, toutes
  // remplacées par la première — pendant que les lignes en nombres, reposées
  // juste après, tenaient. Preuve qu'une écriture CIBLÉE s'impose : on n'écrit
  // donc plus que des cellules.
  const c = classeurAFormulesDistinctes();
  c.classeur.recopie = "colonneEntiere";
  const r = await office.ecrireDiagramme({ nodes: QUATRE, links: LIENS_QUATRE });
  attendu(r.ok, "écriture réussie");
  attendu(!r.remplissage, "rien n'a débordé : il n'y a rien à signaler");
  egal(r.formules, 3, "les trois formules sont réémises");
  const iVal = LINK_COLS.indexOf("Valeur du flux");
  egal(c.formulesDe("Liens").map(l => l[iVal]),
       ["='Blé tendre'!$C$8", "='Blé tendre'!$C$9", "='Blé tendre'!$C$10"],
       "chaque lien garde SA formule — aucune n'est remplacée par la première");
});

await test("écriture : une formule qui déborde sur une autre formule est vue, et défaite", async () => {
  // Le filet, pour le jour où Excel débordera par un autre chemin : deux liens
  // sur lesquels on a posé des formules DIFFÉRENTES n'en rendent qu'UNE. Aucune
  // réécriture d'Excel ne confond deux formules distinctes ; une colonne
  // calculée, si. Les valeurs, elles, viennent du modèle : rien n'est perdu.
  const c = classeurAFormulesDistinctes();
  c.classeur.recopie = "colonneCalculee";       // Excel tient sa colonne
  const r = await office.ecrireDiagramme({ nodes: QUATRE, links: LIENS_QUATRE });
  attendu(r.ok, "écriture réussie");
  attendu(r.remplissage && r.remplissage.aLEcriture, "la recopie est signalée, prise sur le fait");
  egal(r.formules, 0, "aucune formule n'a survécu : ne pas prétendre le contraire");
  const iVal = LINK_COLS.indexOf("Valeur du flux");
  egal(c.lignesDe("Liens").map(l => l[iVal]), LIENS_QUATRE.map(l => l.value),
       "AUCUNE valeur n'est perdue — elles viennent du modèle");
});

await test("écriture : une formule qu'Excel réécrit à sa façon n'est pas prise pour une recopie", async () => {
  // LE FAUX POSITIF DU 7 SEPTEMBRE 2026. Excel ne rend pas les formules telles
  // qu'on les lui donne : il les range dans SA forme — noms de fonctions en
  // anglais, lien vers un autre classeur réécrit avec son chemin. Vérifier
  // l'écriture en comparant notre texte au sien, c'est crier au loup sur nos
  // propres formules et les effacer TOUTES à chaque modification.
  // Ce qui trahit une recopie, c'est une formule là où on a écrit un NOMBRE.
  const c = classeurType({
    normalise: f => f.replace("SOMME(", "SUM("),
    liens: [
      ["Lait", "Production bio", "Lait cru", 120, "t", "n1", "n2"],
      ["Lait", "Lait cru", "Transformation", { f: "=SOMME(Lentilles!C68:C70)", v: 95 }, "t", "n2", "n3"]
    ]
  });
  const r = await office.ecrireDiagramme(MODELE);
  attendu(r.ok, "écriture réussie");
  attendu(!r.remplissage, "la réécriture d'Excel n'est pas une recopie");
  egal(r.formules, 1, "la formule est réémise");
  const iVal = LINK_COLS.indexOf("Valeur du flux");
  egal(c.formulesDe("Liens").map(l => l[iVal]),
       ["", "=SUM(Lentilles!$C$68:$C$70)"],
       "elle est toujours là, dans la forme qu'Excel lui donne");
  egal(c.lignesDe("Liens").map(l => l[iVal]), [120, 95], "et les valeurs sont intactes");
});

await test("écriture : une seule formule dans la colonne reste une formule", async () => {
  // Le garde-fou de la détection : une colonne calculée se remplit ENTIÈREMENT.
  // Une formule isolée, elle, est une donnée — il ne faut pas la confondre avec
  // un remplissage et l'effacer.
  const c = classeurType();          // deux liens, un seul porte une formule
  const r = await office.ecrireDiagramme(MODELE);
  attendu(!r.remplissage, "une formule isolée n'est pas un remplissage");
  egal(r.formules, 1, "la formule est réémise");
  egal(c.formulesDe("Liens")[1][LINK_COLS.indexOf("Valeur du flux")],
       "=Lentilles!$C$68", "et elle est toujours là");
});

await test("écriture : un remplissage PARTIEL n'emporte pas les lignes rescapées", async () => {
  // Le trou que la première correction laissait. Après une restauration — ou une
  // correction faite à la main sur quelques lignes — la colonne porte des lignes
  // recopiées ET des lignes saines. L'ancien critère (« TOUTES les lignes, la
  // même formule ») déclarait la colonne saine, le complément réémettait la
  // recopie, et Excel recréait la colonne calculée : les rescapées mouraient au
  // tour suivant. On juge donc ligne par ligne.
  const c = classeurType({
    noeuds: RANGS_QUATRE,
    liens: [
      ["Lait", "Production bio", "Lait cru", { f: "='Blé tendre'!$C$8", v: 42 }, "t", "n1", "n2"],
      ["Lait", "Lait cru", "Transformation", { f: "='Blé tendre'!$C$8", v: 42 }, "t", "n2", "n3"],
      ["Lait", "Transformation", "Beurre", { f: "=Lentilles!$C$68", v: 30 }, "t", "n3", "n4"]
    ]
  });
  const r = await office.ecrireDiagramme({ nodes: QUATRE, links: LIENS_QUATRE });
  attendu(r.ok, "écriture réussie");
  egal(r.remplissage, { formule: "='Blé tendre'!$C$8", liens: 2 },
       "les deux lignes recopiées sont reconnues, malgré la troisième qui ne l'est pas");
  egal(r.formules, 1, "seule la formule de la ligne rescapée est réémise");

  const iVal = LINK_COLS.indexOf("Valeur du flux");
  egal(c.formulesDe("Liens").map(l => l[iVal]),
       ["", "", "=Lentilles!$C$68"],
       "la recopie est effacée, la formule du troisième lien est intacte");
});

await test("écriture : une vraie colonne calculée n'est pas prise pour un remplissage", async () => {
  // Le garde-fou de la détection. Une référence structurée (« [@Quantité] »)
  // porte le MÊME texte sur toutes les lignes — c'est la façon normale d'écrire
  // une colonne calculée, et ce sont des données. Ce qui la distingue d'une
  // recopie destructrice : elle donne une valeur DIFFÉRENTE à chaque ligne.
  // D'où le critère à deux moitiés : même formule ET même valeur.
  const c = classeurType({
    noeuds: RANGS_QUATRE,
    liens: [
      ["Lait", "Production bio", "Lait cru", { f: "=[@Quantité]*1000", v: 120 }, "t", "n1", "n2"],
      ["Lait", "Lait cru", "Transformation", { f: "=[@Quantité]*1000", v: 95 }, "t", "n2", "n3"],
      ["Lait", "Transformation", "Beurre", { f: "=[@Quantité]*1000", v: 30 }, "t", "n3", "n4"]
    ]
  });
  const r = await office.ecrireDiagramme({ nodes: QUATRE, links: LIENS_QUATRE });
  attendu(!r.remplissage, "des valeurs distinctes : ce sont des données, pas une recopie");
  egal(r.formules, 3, "les trois formules sont réémises");
  const iVal = LINK_COLS.indexOf("Valeur du flux");
  egal(c.formulesDe("Liens").map(l => l[iVal]),
       ["=[@Quantité]*1000", "=[@Quantité]*1000", "=[@Quantité]*1000"],
       "la colonne calculée de l'utilisatrice est rendue telle quelle");
});

await test("écriture : les lignes sans filière descendent en bas des deux tableaux", async () => {
  const c = classeurType({
    noeuds: [
      ["", "Sans filière", 1, "", 0, "", "n9", 1, "Produit"],
      ["Lait", "Production bio", 1, "Production", 0, "", "n1", 1, "Produit"],
      ["Lait", "Lait cru", 2, "Collecte", 0, "", "n2", 1, "Produit"]
    ],
    liens: [["Lait", "Production bio", "Lait cru", 120, "t", "n1", "n2"]]
  });
  const model = {
    nodes: [
      { id: "n9", name: "Sans filière", column: 1, title: "", order: 0, lane: 1, kind: "produit", filiere: "", color: null },
      { id: "n1", name: "Production bio", column: 1, title: "Production", order: 0, lane: 1, kind: "produit", filiere: "Lait", color: null },
      { id: "n2", name: "Lait cru", column: 2, title: "Collecte", order: 0, lane: 1, kind: "produit", filiere: "Lait", color: null }
    ],
    links: [
      { source: "n9", target: "n2", value: 5, unit: "t" },
      { source: "n1", target: "n2", value: 120, unit: "t" }
    ]
  };
  await office.ecrireDiagramme(model);
  egal(c.lignesDe("Noeuds").map(l => l[1]),
       ["Production bio", "Lait cru", "Sans filière"],
       "le nœud sans filière est en dernier, pas en tête");
  egal(c.lignesDe("Liens").map(l => l[1]),
       ["Production bio", "Sans filière"],
       "le lien sans filière aussi");
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
