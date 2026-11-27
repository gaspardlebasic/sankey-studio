"use strict";
/**
 * Équilibrage des nœuds — déduire une valeur de flux inconnue.
 *
 * Une valeur laissée VIDE dans la colonne « Valeur du flux » du classeur est une
 * INCONNUE. À un nœud, les flux entrants et sortants doivent s'équilibrer :
 *
 *   somme(entrants) = somme(sortants)
 *
 * Une seule inconnue sur les flux d'un nœud se déduit donc de cette égalité.
 * Deux inconnues ou plus ne se déduisent pas (une équation, deux inconnues) ;
 * des unités qui ne s'accordent pas non plus (additionner des tonnes et des
 * litres ne dit rien) ; un reste négatif non plus (un flux ne peut pas être
 * négatif : les données sont incohérentes, on ne fabrique pas un chiffre).
 *
 * La déduction est un CALCUL D'AFFICHAGE : le classeur garde sa case vide, et
 * la valeur déduite ne s'y réécrit jamais. L'appelant marque le lien déduit
 * (`calculee`) pour que l'aperçu l'écrive en italique.
 *
 * Pur, sans DOM ni Office.js : éprouvé en Node (tests/equilibrage.test.js),
 * regroupé par esbuild dans le complément comme dans l'export HTML.
 */

/** Ce que vaut une valeur de flux connue : un nombre fini et positif, sinon 0. */
function valeurConnue(l) {
  const v = Number(l && l.value);
  return isFinite(v) && v > 0 ? v : 0;
}

/** Une cellule « Valeur du flux » vide : le lien porte une inconnue. */
function estInconnue(l) {
  return !!(l && l.inconnue);
}

/** L'unité d'un lien, ramenée à une forme comparable (casse et espaces exclus). */
function uniteDe(l) {
  return String((l && l.unit) || "").trim().toLowerCase();
}

/**
 * Les unités des flux connus d'un nœud s'accordent-elles avec celle de
 * l'inconnue ? Une unité vide ne contredit rien : elle se lit dans celle des
 * autres. Deux unités non vides différentes, si.
 */
function unitesCompatibles(liens, inconnue) {
  const vues = new Set();
  for (const l of liens) {
    if (l === inconnue) continue;
    const u = uniteDe(l);
    if (u) vues.add(u);
  }
  const sienne = uniteDe(inconnue);
  if (sienne) {
    if (vues.size && !vues.has(sienne)) return false;
    vues.add(sienne);
  }
  return vues.size <= 1;
}

/**
 * Équilibre le modèle : rend une copie dont les inconnues déductibles portent
 * leur valeur (`calculee: true`), et l'état de CHAQUE nœud.
 *
 * Ne touche jamais le modèle reçu. Sans aucune inconnue, rend le modèle TEL
 * QUEL — c'est ce qui garantit qu'un diagramme complet s'affiche au pixel près
 * comme avant.
 *
 * `noeuds` contient une entrée par nœud qui touche au moins un lien :
 *   { id, inconnuesEntrantes, inconnuesSortantes, inconnues, etat, valeur? }
 * `etat` vaut :
 *   - « aucune »       : rien à équilibrer ;
 *   - « resolue »      : une inconnue, déduite (`valeur`) ;
 *   - « indeterminee » : deux inconnues ou plus ;
 *   - « boucle »       : l'inconnue est une boucle sur elle-même ;
 *   - « unites »       : les unités ne s'accordent pas ;
 *   - « desequilibre » : la valeur déduite serait nulle ou négative ;
 *   - « isole »        : aucun flux connu en face, rien à quoi l'égaler ;
 *   - « conflit »      : ses deux extrémités déduisent des valeurs différentes.
 */
function resoudreEquilibrage(model) {
  const nodes = Array.isArray(model && model.nodes) ? model.nodes : [];
  const links = Array.isArray(model && model.links) ? model.links : [];

  /** Les liens qui touchent chaque nœud, dans les deux sens. */
  const entrants = new Map();
  const sortants = new Map();
  const ajouter = (carte, id, l) => {
    if (!carte.has(id)) carte.set(id, []);
    carte.get(id).push(l);
  };
  for (const l of links) {
    ajouter(sortants, l.source, l);
    ajouter(entrants, l.target, l);
  }

  const solutions = new Map();          // lien -> valeur déduite
  /* Une même inconnue peut être déduite par ses DEUX extrémités. On garde les
     valeurs proposées : si les deux s'accordent, la valeur est sûre ; si elles
     divergent, le classeur se contredit et l'on ne fabrique pas un chiffre. */
  const candidats = new Map();          // lien -> { valeurs: number[], etats: [] }
  const etats = new Map();              // id de nœud -> état

  for (const n of nodes) {
    const ent = entrants.get(n.id) || [];
    const sor = sortants.get(n.id) || [];
    const incEnt = ent.filter(estInconnue);
    const incSor = sor.filter(estInconnue);
    // Une boucle se trouve des deux côtés : c'est UNE inconnue, pas deux.
    const inconnues = new Set(incEnt.concat(incSor)).size;
    if (!inconnues) {
      etats.set(n.id, {
        id: n.id, inconnuesEntrantes: 0, inconnuesSortantes: 0, inconnues: 0, etat: "aucune"
      });
      continue;
    }

    const etat = {
      id: n.id,
      inconnuesEntrantes: incEnt.length,
      inconnuesSortantes: incSor.length,
      inconnues,
      etat: "indeterminee"
    };
    etats.set(n.id, etat);

    if (inconnues > 1) continue;

    const inconnue = incEnt[0] || incSor[0];
    // Une boucle se trouve des deux côtés : elle s'annule dans l'équation, sa
    // valeur n'est donc contrainte par rien.
    if (inconnue.source === inconnue.target) {
      etat.etat = "boucle";
      continue;
    }
    if (!unitesCompatibles(ent.concat(sor), inconnue)) {
      etat.etat = "unites";
      continue;
    }

    // La valeur d'une inconnue ne compte jamais dans les flux CONNUS, même si
    // elle porte déjà un chiffre déduit d'un calcul précédent : on repart de la
    // donnée du classeur, sinon le calcul dériverait à chaque rendu.
    const somme = liste => liste.reduce(
      (t, l) => t + (estInconnue(l) ? 0 : valeurConnue(l)), 0);
    const entrees = somme(ent);
    const sorties = somme(sor);
    // On ne déduit que ce que l'AUTRE côté contraint : une inconnue dont le côté
    // opposé est vide pourrait valoir n'importe quoi.
    const enEntree = incEnt.length === 1;
    const opposé = enEntree ? sorties : entrees;
    const connu = enEntree ? entrees : sorties;
    if (opposé <= 0) {
      etat.etat = "isole";
      continue;
    }
    const valeur = opposé - connu;
    if (!(valeur > 0)) {
      etat.etat = "desequilibre";
      etat.valeur = valeur;
      continue;
    }
    if (!candidats.has(inconnue)) candidats.set(inconnue, { valeurs: [], etats: [] });
    const c = candidats.get(inconnue);
    c.valeurs.push(valeur);
    c.etats.push(etat);
  }

  // Les deux bouts d'une même inconnue doivent dire la même chose.
  let resolues = 0;
  for (const [lien, c] of candidats) {
    const v0 = c.valeurs[0];
    const accord = c.valeurs.every(v =>
      Math.abs(v - v0) <= 1e-9 * Math.max(1, Math.abs(v), Math.abs(v0)));
    if (!accord) {
      c.etats.forEach(e => { e.etat = "conflit"; delete e.valeur; });
      continue;
    }
    solutions.set(lien, v0);
    resolues++;
    c.etats.forEach(e => { e.etat = "resolue"; e.valeur = v0; });
  }

  /* Un nœud dont l'inconnue est déduite par l'AUTRE bout n'a rien calculé
     lui-même — sa valeur n'en est pas moins connue, et il ne doit pas rester
     affiché comme indéterminé. */
  const inconnueDuNoeud = new Map();
  for (const l of links) {
    if (!estInconnue(l)) continue;
    inconnueDuNoeud.set(l.source, l);
    if (l.target !== l.source) inconnueDuNoeud.set(l.target, l);
  }
  for (const e of etats.values()) {
    if (e.inconnues !== 1 || e.etat === "resolue" || e.etat === "conflit") continue;
    const l = inconnueDuNoeud.get(e.id);
    if (l && solutions.has(l)) {
      e.etat = "resolue";
      e.valeur = solutions.get(l);
    }
  }

  const noeuds = Array.from(etats.values());
  const resume = {
    noeuds: noeuds.filter(e => e.inconnues > 0).length,
    // Une inconnue touche deux nœuds : le bilan global compte les FLUX, pas
    // les bouts.
    inconnues: new Set(links.filter(estInconnue)).size,
    resolues,
    indeterminees: noeuds.filter(e => e.inconnues > 0 && e.etat !== "resolue").length
  };

  if (!solutions.size) {
    return { model, noeuds, resume };
  }

  const liens = links.map(l => {
    const v = solutions.get(l);
    if (v === undefined) return l;
    // `inconnue` reste vrai : le classeur, lui, garde sa case vide. C'est
    // `calculee` qui dit que le chiffre affiché vient de l'équilibrage.
    return Object.assign({}, l, { value: v, calculee: true });
  });
  return { model: Object.assign({}, model, { links: liens }), noeuds, resume };
}

module.exports = { resoudreEquilibrage, estInconnue };
