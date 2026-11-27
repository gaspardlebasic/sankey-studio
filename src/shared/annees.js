"use strict";
/**
 * Dimension ANNÉE des valeurs de liens — règles pures, partagées par
 * l'éditeur (aperçu, panneau, exports) et la visionneuse HTML.
 *
 * Une ligne du tableau des liens peut porter une année (colonne « Année »).
 * Plusieurs lignes peuvent décrire le même couple (origine, destination) pour
 * des années différentes : c'est la MÊME flèche du diagramme, avec une valeur
 * par année. L'aperçu n'en dessine qu'une à la fois.
 *
 * Rien ici ne touche au DOM ni à Office.js : le module est chargé tel quel par
 * Node et regroupé par esbuild. Types dans annees.d.ts.
 */

/**
 * L'année portée par une cellule du classeur, ramenée à un libellé court.
 *
 * Trois formes se rencontrent dans un vrai classeur : l'entier (« 2024 »), le
 * texte (« 2024 », « 2024-2025 ») et la DATE (« 01/01/2024 », ou son numéro de
 * série Excel quand la colonne est mise en forme en date). Une case vide ne
 * donne aucune année — elle n'est pas l'année 0.
 *
 * On ne devine pas au-delà : un texte qui ne contient pas d'année est rendu
 * tel quel, pour que l'utilisatrice voie dans le sélecteur ce qu'elle a écrit.
 */
function anneeDepuisCellule(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    return isFinite(v.getTime()) ? String(v.getFullYear()) : "";
  }
  if (typeof v === "number") {
    if (!isFinite(v)) return "";
    // Une année écrite en nombre. Les séries de dates Excel contemporaines
    // vivent entre 20 000 et 80 000 : on les convertit, sinon « 45292 »
    // s'afficherait comme une année.
    if (v >= 1000 && v <= 9999) return String(Math.trunc(v));
    if (v > 20000 && v < 80000) {
      const ms = Date.UTC(1899, 11, 30) + Math.round(v) * 86400000;
      return String(new Date(ms).getUTCFullYear());
    }
    return String(v);
  }
  const s = String(v).trim();
  if (!s) return "";
  const entier = s.match(/^(\d{4})(?:\.0+)?$/);
  if (entier) return entier[1];
  // « 2024-01-01 », « 01/01/2024 », « 2024-2025 » : la première année citée.
  const dansTexte = s.match(/(?:^|\D)(\d{4})(?:\D|$)/);
  if (dansTexte) return dansTexte[1];
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return String(new Date(t).getFullYear());
  return s;
}

/** L'année d'un lien, ou "" quand il n'en porte pas. */
function anneeDeLien(l) {
  return anneeDepuisCellule(l && l.annee);
}

/** Compare deux libellés d'année : numérique quand c'est possible. */
function comparerAnnee(a, b) {
  const na = Number(a), nb = Number(b);
  if (a !== "" && b !== "" && isFinite(na) && isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b), "fr", { numeric: true, sensitivity: "base" });
}

/**
 * Les années distinctes d'un ensemble de liens, de la plus ancienne à la plus
 * récente. Une case vide n'est pas une année : elle vaut « toutes les années ».
 */
function anneesDistinctes(liens) {
  const vues = new Set();
  (liens || []).forEach(l => {
    const a = anneeDeLien(l);
    if (a) vues.add(a);
  });
  return Array.from(vues).sort(comparerAnnee);
}

/** L'année choisie par défaut : la plus récente. */
function anneeParDefaut(annees) {
  return annees && annees.length ? annees[annees.length - 1] : "";
}

/** Clé d'une ligne de lien : le couple ET l'année. */
function cleLienAnnee(source, target, annee) {
  return String(source) + "\u0000" + String(target) + "\u0000" + (annee || "");
}

/**
 * Les liens à dessiner pour une année.
 *
 * - un lien daté de cette année-là est retenu ;
 * - un lien SANS année vaut pour toutes les années (une ligne ancienne, ou une
 *   valeur commune) — il est retenu s'il n'y a pas de ligne datée pour le même
 *   couple ;
 * - un lien daté d'une AUTRE année n'est pas retenu : c'est tout l'objet du
 *   sélecteur.
 *
 * Sans année demandée (aucune colonne, ou colonne vide), tous les liens sont
 * rendus tels quels : le diagramme d'avant la dimension année ne bouge pas.
 */
function liensPourAnnee(liens, annee) {
  const tous = liens || [];
  if (!annee) return tous.slice();
  const ordre = [];
  const parCouple = new Map();
  tous.forEach(l => {
    const couple = String(l.source) + "\u0000" + String(l.target);
    if (!parCouple.has(couple)) {
      parCouple.set(couple, { exact: null, commune: null });
      ordre.push(couple);
    }
    const place = parCouple.get(couple);
    const a = anneeDeLien(l);
    if (a === annee) {
      if (!place.exact) place.exact = l;
    } else if (!a) {
      if (!place.commune) place.commune = l;
    }
  });
  const out = [];
  ordre.forEach(couple => {
    const place = parCouple.get(couple);
    const l = place.exact || place.commune;
    if (l) out.push(l);
  });
  return out;
}

module.exports = {
  anneeDepuisCellule, anneeDeLien, comparerAnnee,
  anneesDistinctes, anneeParDefaut, cleLienAnnee, liensPourAnnee
};
