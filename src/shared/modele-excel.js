"use strict";
/**
 * Schéma du classeur Sankey — SOURCE DE VÉRITÉ UNIQUE.
 *
 * Y vit tout ce qui est PUR : ordre des colonnes, ordre de tri des lignes,
 * lecture/écriture des types, et buildModelRows. Rien qui touche à Office.js —
 * c'est ce qui permet de l'éprouver en Node, sans Excel.
 *
 * CommonJS : Node le charge tel quel pour les tests, esbuild le regroupe dans
 * le paquet du complément. Types dans modele-excel.d.ts.
 *
 * NE PAS dupliquer ces règles ailleurs : c'est la seule description du classeur
 * que le complément écrit, et elle doit rester unique.
 */

// Voir GAP plus bas : l'écriture « à chaud » ajoute cette colonne dans le
// classeur ouvert, où le tableau des liens n'a pas encore de colonne vide avant
// lui — c'est sans conséquence, les tableaux se retrouvent par leurs en-têtes.
const NODE_COLS = [
  "Filière",
  "Noeud",
  "Numéro de colonne d'affichage",
  "Intitulé de la colonne d'affichage",
  "Ordre vertical d'affichage",
  "Couleur",
  "ID",
  "Couloir",
  "Type"
];
// Un lien est identifié par le couple (ID origine, ID destination) — aucune
// donnée « externe » : les deux IDs vivent dans le tableau des nœuds.
const LINK_COLS = [
  "Filière",
  "Origine",
  "Destination",
  "Valeur du flux",
  "Unité",
  "ID origine",
  "ID destination"
];

const NODE_START = 1; // colonne A
// Une colonne vide sépare les deux tableaux : elle aère la lecture et laisse de
// la place au tableau des nœuds pour gagner une colonne sans bousculer son
// voisin. Les tableaux étant retrouvés par leurs EN-TÊTES et non par leur
// adresse, un classeur déjà écrit (liens en I) reste lisible ; il n'adopte la
// colonne vide qu'à la prochaine réécriture complète du fichier.
const GAP = 1;
const LINK_START = NODE_START + NODE_COLS.length + GAP; // colonne K

/* ----------------------------- utilitaires ----------------------------- */

function toInt(v, dflt) {
  const n = parseInt(v, 10);
  return isNaN(n) ? dflt : n;
}
function toNum(v, dflt) {
  const n = Number(v);
  return isNaN(n) ? dflt : n;
}


/** Couloir d'un nœud, ramené à un entier >= 1 (1 par défaut). */
function couloirDe(n) {
  const v = Math.round(Number(n && n.lane));
  return isFinite(v) && v >= 1 ? v : 1;
}

// Le type de nœud est écrit en clair dans le classeur : c'est une colonne que
// l'utilisatrice lit et remplit elle-même, pas un code interne.
const TYPE_LABELS = { produit: "Produit", industrie: "Industrie" };

/** Intitulé Excel du type d'un nœud (« Produit » par défaut). */
function typeDe(n) {
  return n && n.kind === "industrie" ? TYPE_LABELS.industrie : TYPE_LABELS.produit;
}

/**
 * Type d'un nœud lu dans une cellule. Tolérant à la casse, aux accents et aux
 * formulations : « Industrie », « industriel », « Étape de transformation »,
 * « commercialisation » désignent tous une industrie ; tout le reste (cellule
 * vide comprise) est un produit.
 */
function typeDepuisTexte(v) {
  const s = String(v === undefined || v === null ? "" : v)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return /indus|etape|transform|commerc/.test(s) ? "industrie" : "produit";
}

/** Compare deux textes comme les lit une francophone : casse et accents ignorés. */
function comparerTexte(a, b) {
  const t = v => String(v === undefined || v === null ? "" : v);
  return t(a).localeCompare(t(b), "fr", { sensitivity: "base" });
}

/** Compare le placement de deux nœuds : colonne, puis couloir, puis ordre vertical. */
function comparerPlacement(a, b) {
  return (
    toInt(a && a.column, 0) - toInt(b && b.column, 0) ||
    couloirDe(a) - couloirDe(b) ||
    toNum(a && a.order, 0) - toNum(b && b.order, 0)
  );
}

/** Filière portée par un lien : celle de son origine, sinon celle de sa destination. */
function filiereDuLien(sNode, tNode) {
  return (sNode && sNode.filiere) || (tNode && tNode.filiere) || "";
}

/** Construit les données de nœuds/liens en lignes de cellules.
 *  formulaMap (facultatif) : préserve les formules « Valeur du flux » existantes. */
function buildModelRows(model, formulaMap) {
  const nodeById = new Map(model.nodes.map(n => [n.id, n]));
  const nameById = new Map(model.nodes.map(n => [n.id, n.name]));
  const nomDe = (node, id) => (node && node.name) || nameById.get(id) || "";
  // Le classeur est fait pour être LU : nœuds et liens y descendent filière par
  // filière, puis colonne, couloir et ordre vertical — l'ordre dans lequel on
  // les voit à l'écran. Un lien se range d'après son origine, puis sa
  // destination. On trie des copies : le modèle de l'app n'est pas touché.
  const noeuds = model.nodes.slice().sort(
    (a, b) =>
      comparerTexte(a.filiere, b.filiere) ||
      comparerPlacement(a, b) ||
      comparerTexte(a.name, b.name)
  );
  const liens = model.links.slice().sort((a, b) => {
    const sa = nodeById.get(a.source), ta = nodeById.get(a.target);
    const sb = nodeById.get(b.source), tb = nodeById.get(b.target);
    return (
      comparerTexte(filiereDuLien(sa, ta), filiereDuLien(sb, tb)) ||
      comparerPlacement(sa, sb) ||
      comparerPlacement(ta, tb) ||
      comparerTexte(nomDe(sa, a.source), nomDe(sb, b.source)) ||
      comparerTexte(nomDe(ta, a.target), nomDe(tb, b.target))
    );
  });
  const nodeRows = noeuds.map(n => [
    { t: "s", v: n.filiere || "" },
    { t: "s", v: n.name },
    { t: "n", v: n.column },
    { t: "s", v: n.title || "" },
    { t: "n", v: typeof n.order === "number" ? n.order : 0 },
    { t: "s", v: n.color || "" },
    { t: "s", v: n.id },
    { t: "n", v: couloirDe(n) },
    { t: "s", v: typeDe(n) }
  ]);
  const linkRows = liens.map(l => {
    const sNode = nodeById.get(l.source);
    const tNode = nodeById.get(l.target);
    const filiere = filiereDuLien(sNode, tNode);
    const sName = nomDe(sNode, l.source);
    const tName = nomDe(tNode, l.target);
    // Si la valeur était une formule, on la conserve (ne pas écraser un calcul).
    const formula = formulaMap
      ? formulaMap.get("id:" + l.source + " " + l.target) ||
        formulaMap.get("name:" + sName + " " + tName)
      : null;
    const valueCell = formula
      ? { t: "f", f: formula, v: l.value }
      : { t: "n", v: l.value };
    return [
      { t: "s", v: filiere },
      { t: "s", v: sName },
      { t: "s", v: tName },
      valueCell,
      { t: "s", v: l.unit || "" },
      { t: "s", v: l.source }, // ID origine
      { t: "s", v: l.target } // ID destination
    ];
  });
  return { nodeRows, linkRows };
}

module.exports = {
  NODE_COLS, LINK_COLS, NODE_START, GAP, LINK_START,
  toInt, toNum, couloirDe, TYPE_LABELS, typeDe, typeDepuisTexte,
  comparerTexte, comparerPlacement, filiereDuLien, buildModelRows
};
