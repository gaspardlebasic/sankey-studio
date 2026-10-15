"use strict";
/**
 * Niveaux d'agrégation — PROJETER le modèle sur un état de dépliage.
 *
 * Un nœud peut avoir un parent (colonne « Parent » du classeur). Replié, le
 * parent se dessine à sa place et ses enfants disparaissent ; déplié, il cède
 * sa place à ses enfants, empilés dans la même cellule (colonne × couloir).
 * Voir PLAN-AGREGATION.md.
 *
 * LA RÈGLE DU TOTAL. Un lien est COUVERT par un autre quand son origine est
 * celle de l'autre ou en descend, et sa destination aussi. Le lien couvert fait
 * PARTIE du lien qui le couvre, il ne s'y ajoute pas :
 *
 *   Exploitations → Légumineuses 100, → Pois 40, → Féverole 25
 *   replié : Légumineuses 100 · déplié : Pois 40, Féverole 25, (non détaillé) 35
 *
 * Chaque lien porte donc une PART PROPRE : sa valeur moins celle des liens qu'il
 * couvre directement. C'est elle qui se reporte sur les nœuds affichés ; quand
 * une extrémité est un parent déplié, elle va à son enfant virtuel
 * « (non détaillé) ». Un détail plus grand que son total est une INCOHÉRENCE :
 * la part propre est ramenée à 0 (on dessine le détail) et elle est signalée.
 *
 * Pur, sans DOM : éprouvé en Node (tests/agregation.test.js), regroupé par
 * esbuild dans le complément comme dans l'export HTML.
 */

const { parentsValides, toNum } = require("./modele-excel.js");

/** Préfixe de l'identifiant d'un nœud « (non détaillé) » : `nd:<id du parent>`. */
const PREFIXE_RESTE = "nd:";
const NOM_RESTE = "(non détaillé)";

/** Une hiérarchie lue une fois : parents valides, enfants, profondeur. */
function hierarchie(nodes) {
  const parents = parentsValides(nodes);
  const enfants = new Map();
  for (const n of nodes) {
    const p = parents.get(n.id);
    if (p === undefined) continue;
    if (!enfants.has(p)) enfants.set(p, []);
    enfants.get(p).push(n.id);
  }
  /** Le nœud lui-même, puis ses parents jusqu'à la racine. */
  const ascendants = id => {
    const out = [id];
    let p = parents.get(id);
    while (p !== undefined) { out.push(p); p = parents.get(p); }
    return out;
  };
  /** 0 pour une racine. */
  const profondeur = id => ascendants(id).length - 1;
  /** `a` est-il `b` ou l'un de ses descendants ? */
  const descendDe = (a, b) => ascendants(a).indexOf(b) >= 0;
  return { parents, enfants, ascendants, profondeur, descendDe };
}

/**
 * Réaligne chaque enfant sur la colonne et le couloir de sa racine (cas A : un
 * parent s'éclate dans sa propre cellule). Modifie les nœuds en place et rend
 * ceux qui ont bougé — l'appelant les signale et réécrit le classeur.
 */
function alignerSurParents(nodes) {
  const h = hierarchie(nodes);
  const parId = new Map(nodes.map(n => [n.id, n]));
  const bouges = [];
  for (const n of nodes) {
    const chaine = h.ascendants(n.id);
    if (chaine.length < 2) continue;
    const racine = parId.get(chaine[chaine.length - 1]);
    const lane = racine.lane === undefined ? n.lane : racine.lane;
    if (n.column !== racine.column || n.lane !== lane) {
      n.column = racine.column;
      n.lane = lane;
      bouges.push(n);
    }
  }
  return bouges;
}

/**
 * Pour chaque lien, celui qui le couvre DIRECTEMENT (le plus proche), ou -1.
 *
 * Deux liens qui se couvrent l'un l'autre sont le même couple d'extrémités :
 * le classeur n'en garde qu'un, mais par prudence le premier couvre le second.
 * Deux couvreurs incomparables (A → parent de Q, et parent de A → Q) : le plus
 * proche gagne — somme des écarts de profondeur —, puis le premier du tableau.
 */
function couvreurs(links, h) {
  const out = new Array(links.length).fill(-1);
  links.forEach((l, i) => {
    let meilleur = -1, ecart = Infinity;
    links.forEach((m, j) => {
      if (i === j) return;
      if (!h.descendDe(l.source, m.source) || !h.descendDe(l.target, m.target)) return;
      const memes = l.source === m.source && l.target === m.target;
      if (memes && j > i) return;              // doublon : le premier couvre le second
      const e = h.profondeur(l.source) - h.profondeur(m.source) +
                h.profondeur(l.target) - h.profondeur(m.target);
      if (e < ecart) { ecart = e; meilleur = j; }
    });
    out[i] = meilleur;
  });
  return out;
}

/**
 * Projette le modèle sur un état de dépliage.
 *
 * `deplies` : les ID des nœuds dépliés (un Set, un tableau, ou `true` pour
 * « tout déplié »). Un nœud sans enfant n'est jamais « déplié ».
 *
 * Rend :
 *  - `nodes` : les nœuds AFFICHÉS — copies, l'original n'est jamais touché —,
 *    rangés et numérotés dans leur cellule (`order` = rang affiché), avec
 *    `depliable` (il a des enfants), `parentAffiche` (le parent déplié qui les
 *    encadre, ou null) et, pour les restes, `virtuel: true`. Un enfant sans
 *    couleur prend celle de son parent.
 *  - `links` : les flux affichés, sommés par couple d'extrémités affichées.
 *  - `incoherences` : les liens dont le détail dépasse le total.
 */
function projeter(model, deplies) {
  const nodes = model.nodes;
  const h = hierarchie(nodes);
  const parId = new Map(nodes.map(n => [n.id, n]));
  const estDeplie = id =>
    h.enfants.has(id) && (deplies === true || (deplies && (
      typeof deplies.has === "function" ? deplies.has(id) : deplies.indexOf(id) >= 0)));

  // Nœud affiché qui représente `id` : le plus haut ascendant replié. Si tout
  // est déplié jusqu'à `id` compris, c'est son reste « (non détaillé) ».
  const representant = id => {
    const chaine = h.ascendants(id).reverse();   // racine d'abord
    for (const a of chaine) if (!estDeplie(a)) return a;
    return PREFIXE_RESTE + id;
  };

  /* ---- les flux ---- */
  const liens = model.links.filter(l => parId.has(l.source) && parId.has(l.target));
  const couvreur = couvreurs(liens, h);
  const detail = new Array(liens.length).fill(0);
  couvreur.forEach((j, i) => { if (j >= 0) detail[j] += toNum(liens[i].value, 0); });

  const incoherences = [];
  const flux = new Map();                         // "s t" -> lien affiché
  const restesUtiles = new Set();
  liens.forEach((l, i) => {
    const total = toNum(l.value, 0);
    let propre = total;
    if (detail[i] > 0) {
      propre = total - detail[i];
      if (propre < 0) {
        incoherences.push({ lien: l, total, detail: detail[i] });
        propre = 0;
      }
    }
    if (propre <= 0) return;
    const s = representant(l.source), t = representant(l.target);
    if (s === t) return;                          // flux interne à un nœud replié
    for (const r of [s, t]) if (r.indexOf(PREFIXE_RESTE) === 0) restesUtiles.add(r);
    const cle = s + " " + t;
    let f = flux.get(cle);
    if (!f) {
      f = { id: "agg:" + s + "->" + t, source: s, target: t, value: 0, unit: "", bio: 0, liens: [] };
      flux.set(cle, f);
    }
    // La part bio d'une part propre est celle du lien qui la porte.
    const bio = Math.max(0, Math.min(1, toNum(l.bio, 0)));
    f.bio = (f.bio * f.value + bio * propre) / (f.value + propre);
    f.value += propre;
    if (!f.unit && l.unit) f.unit = l.unit;
    f.liens.push(l.id);
  });

  /* ---- les nœuds affichés, rangés dans leur cellule ---- */
  const affiches = [];
  const couleurDe = id => {
    for (const a of h.ascendants(id)) {
      const c = parId.get(a).color;
      if (c) return c;
    }
    return null;
  };
  const comparerOrdre = (a, b) =>
    toNum(parId.get(a).order, 0) - toNum(parId.get(b).order, 0);
  const cellules = new Map();
  for (const n of nodes) {
    if (h.parents.has(n.id)) continue;
    // Une cellule est colonne × couloir, toutes filières confondues : c'est la
    // portée de l'ordre vertical, et l'aperçu non séparé les range ensemble.
    const cle = n.column + "\u0000" + (n.lane || 1);
    if (!cellules.has(cle)) cellules.set(cle, []);
    cellules.get(cle).push(n.id);
  }
  for (const racines of cellules.values()) {
    let rang = 0;
    const poser = (id, encadrant) => {
      const n = parId.get(id);
      if (estDeplie(id)) {
        h.enfants.get(id).slice().sort(comparerOrdre).forEach(e => poser(e, id));
        if (restesUtiles.has(PREFIXE_RESTE + id)) {
          affiches.push(Object.assign({}, n, {
            id: PREFIXE_RESTE + id, name: NOM_RESTE, order: rang++,
            color: couleurDe(id), depliable: false, parentAffiche: id, virtuel: true
          }));
        }
        return;
      }
      const racine = parId.get(h.ascendants(id).pop());
      affiches.push(Object.assign({}, n, {
        column: racine.column, lane: racine.lane, order: rang++,
        color: couleurDe(id), depliable: h.enfants.has(id), parentAffiche: encadrant
      }));
    };
    racines.slice().sort(comparerOrdre).forEach(id => poser(id, null));
  }

  return { nodes: affiches, links: Array.from(flux.values()), incoherences };
}

/**
 * Les nœuds à déplier pour montrer `niveau` niveaux (1 = tout replié) : ceux
 * dont la profondeur est inférieure à `niveau - 1`.
 */
function depliesAuNiveau(nodes, niveau) {
  const h = hierarchie(nodes);
  const out = new Set();
  for (const id of h.enfants.keys()) if (h.profondeur(id) < niveau - 1) out.add(id);
  return out;
}

/** Nombre de niveaux de la hiérarchie (1 = aucun parent). */
function nombreDeNiveaux(nodes) {
  const h = hierarchie(nodes);
  let max = 0;
  for (const n of nodes) max = Math.max(max, h.profondeur(n.id));
  return max + 1;
}

module.exports = {
  PREFIXE_RESTE, NOM_RESTE,
  hierarchie, alignerSurParents, projeter, depliesAuNiveau, nombreDeNiveaux
};
