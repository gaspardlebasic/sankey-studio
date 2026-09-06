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
  "ID destination",
  "Part bio / durable"
];

/**
 * La colonne que le complément LIT SANS JAMAIS L'ÉCRIRE.
 *
 * La part bio est une donnée de modélisation, comme la valeur du flux : elle se
 * saisit dans le classeur, et très souvent par un calcul (« =C8/C7 »). Or nous
 * réécrivons chaque colonne que nous nous attribuons, ce qui effacerait ce
 * calcul. La laisser hors des colonnes écrites la range parmi les colonnes de
 * l'utilisatrice : elle n'est jamais recalculée, sa formule survit, et elle
 * VOYAGE AVEC SA LIGNE au retri (reporterEtrangeres). Elle reste dans
 * `LINK_COLS` pour qu'un classeur préparé par le complément la porte d'emblée.
 */
const LINK_COL_BIO = "Part bio / durable";

/**
 * Colonnes des liens réellement écrites — et l'ordre exact des cellules que
 * `buildModelRows` produit pour chaque lien. Toute colonne en lecture seule
 * doit rester EN FIN de `LINK_COLS`, sans quoi cet alignement se romprait.
 */
const LINK_COLS_ECRITES = LINK_COLS.filter(c => c !== LINK_COL_BIO);

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

/**
 * Part du flux qui est bio / durable, lue dans une cellule : un nombre de 0 à 1.
 *
 * La colonne se remplit à la main, et de deux façons également naturelles :
 * « 0,5 » (une part) ou « 50 » (des pour cent) — Excel rend d'ailleurs 0,5 pour
 * une cellule mise en forme « 50 % ». D'où la règle, qui les accepte toutes :
 * **au-delà de 1, c'est un pourcentage**. Tout ce qui n'est pas un nombre
 * (cellule vide, texte, colonne absente) vaut 0 : le lien se dessine alors
 * exactement comme avant l'arrivée de cette colonne.
 */
function partBioDepuisTexte(v) {
  const n = Number(String(v === undefined || v === null ? "" : v).replace(",", "."));
  if (!isFinite(n) || n <= 0) return 0;
  return Math.min(1, n > 1 ? n / 100 : n);
}

/**
 * Ancre les références A1 d'une formule : « Lentilles!C68 » -> « Lentilles!$C$68 ».
 *
 * POURQUOI. Les lignes sont retriées à chaque écriture, et une formule suit son
 * lien : elle change donc de ligne. Une référence SANS `$` est celle qu'Excel
 * recale dès qu'elle est recopiée ou qu'une colonne calculée se remplit toute
 * seule — la formule se met alors à lire une autre ligne de l'onglet source.
 * Ancrée, elle ne peut plus bouger, où qu'on la pose.
 *
 * Ce qu'on ne touche pas : les chaînes littérales ("A1"), les noms d'onglets
 * (cités ou non : `Data2!A1` garde son `2`), les références structurées
 * (`[@[Quantité]]`, qui sont DÉJÀ relatives à leur ligne et doivent le rester)
 * et les appels de fonction (`LOG10(` n'est pas la cellule LOG10).
 */
const REF_A1 = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![!\w.(])/;
/** Un caractère qui, devant une référence, empêche d'y voir une référence. */
function colle(ch) {
  return /[A-Za-z0-9_.]/.test(ch);
}
function ancrerFormule(f) {
  const src = String(f === undefined || f === null ? "" : f);
  let out = "", i = 0, profondeur = 0;
  while (i < src.length) {
    const ch = src.charAt(i);

    if (ch === '"' || ch === "'") {              // chaîne littérale, onglet cité
      const fin = src.indexOf(ch, i + 1);
      const j = fin < 0 ? src.length : fin + 1;  // guillemet non refermé : on prend tout
      out += src.slice(i, j);
      i = j;
      continue;
    }
    if (ch === "[") { profondeur++; out += ch; i++; continue; }
    if (ch === "]") { if (profondeur) profondeur--; out += ch; i++; continue; }

    const debut = profondeur === 0 && (i === 0 || !colle(src.charAt(i - 1)));
    const m = debut ? REF_A1.exec(src.slice(i)) : null;
    if (m) {
      out += "$" + m[2] + "$" + m[4];
      i += m[0].length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Compare deux textes comme les lit une francophone : casse et accents ignorés. */
function comparerTexte(a, b) {
  const t = v => String(v === undefined || v === null ? "" : v);
  return t(a).localeCompare(t(b), "fr", { sensitivity: "base" });
}

/**
 * Compare deux filières. Une filière VIDE descend en bas du tableau : ce sont
 * les lignes à reprendre, on les veut ensemble et au bout, pas en tête.
 */
function comparerFiliere(a, b) {
  const va = String(a === undefined || a === null ? "" : a).trim();
  const vb = String(b === undefined || b === null ? "" : b).trim();
  if (!va !== !vb) return va ? -1 : 1;
  return comparerTexte(va, vb);
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
 *  formulaMap (facultatif) : préserve les formules « Valeur du flux » existantes,
 *  sous la forme clé -> { f, source } — `source` désigne la LIGNE du classeur
 *  d'où vient la formule, pour qu'elle ne serve pas deux fois. */
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
      comparerFiliere(a.filiere, b.filiere) ||
      comparerPlacement(a, b) ||
      comparerTexte(a.name, b.name)
  );
  const liens = model.links.slice().sort((a, b) => {
    const sa = nodeById.get(a.source), ta = nodeById.get(a.target);
    const sb = nodeById.get(b.source), tb = nodeById.get(b.target);
    return (
      comparerFiliere(filiereDuLien(sa, ta), filiereDuLien(sb, tb)) ||
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
  // Extrémités résolues une fois : l'appariement des formules s'en sert deux fois.
  const bouts = liens.map(l => {
    const sNode = nodeById.get(l.source);
    const tNode = nodeById.get(l.target);
    return {
      filiere: filiereDuLien(sNode, tNode),
      sName: nomDe(sNode, l.source),
      tName: nomDe(tNode, l.target)
    };
  });

  // Une formule appartient à UN lien, et à un seul. D'où deux passes, et un
  // jeton de ligne consommé : sans cela, deux liens qui portent les mêmes NOMS
  // d'extrémités (le même « Transport → Pertes » dans deux filières) se
  // partageraient la formule du premier — elle serait recopiée sur le second,
  // qui n'en avait pas. La passe par ID vient en premier pour que le lien
  // vraiment désigné serve avant qu'un homonyme ne prenne sa place.
  const formules = new Array(liens.length).fill(null);
  if (formulaMap) {
    const prises = new Set();
    const prendre = (i, cle) => {
      if (formules[i]) return;
      const e = formulaMap.get(cle);
      if (!e || prises.has(e.source)) return;
      prises.add(e.source);
      formules[i] = e.f;
    };
    liens.forEach((l, i) => prendre(i, "id:" + l.source + " " + l.target));
    liens.forEach((l, i) => prendre(i, "name:" + bouts[i].sName + " " + bouts[i].tName));
  }

  const linkRows = liens.map((l, i) => {
    const { filiere, sName, tName } = bouts[i];
    // Si la valeur était une formule, on la conserve (ne pas écraser un calcul).
    const formula = formules[i];
    const valueCell = formula
      ? { t: "f", f: ancrerFormule(formula), v: l.value }
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
  NODE_COLS, LINK_COLS, LINK_COL_BIO, LINK_COLS_ECRITES, NODE_START, GAP, LINK_START,
  toInt, toNum, couloirDe, TYPE_LABELS, typeDe, typeDepuisTexte, partBioDepuisTexte,
  comparerTexte, comparerFiliere, comparerPlacement, filiereDuLien,
  ancrerFormule, buildModelRows
};
