"use strict";
/**
 * Équilibrage des nœuds — déduire les valeurs de flux inconnues.
 *
 * Une valeur laissée VIDE dans la colonne « Valeur du flux » du classeur est une
 * INCONNUE. À un nœud, les flux entrants et sortants doivent s'équilibrer :
 *
 *   somme(entrants) = somme(sortants)
 *
 * Une seule inconnue sur les flux d'un nœud se déduit donc de cette égalité.
 * La déduction est RÉCURSIVE : une valeur calculée à un nœud devient une donnée
 * connue pour l'autre extrémité du lien, qui peut à son tour n'avoir plus qu'une
 * inconnue et la déduire. On répète jusqu'à ce que plus rien ne change (point
 * fixe). Une chaîne A → B → C se remplit ainsi de proche en proche.
 *
 * Rien n'est inventé quand la déduction n'a pas de sens : deux inconnues qui
 * restent au même nœud, unités qui ne s'accordent pas, reste nul ou négatif,
 * aucun flux connu en face, boucle sur le nœud, ou deux bouts qui se
 * contredisent. Un lien contredit est retiré des solutions et l'on recalcule le
 * reste sans lui : une valeur fausse ne se propage pas plus loin.
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
 * Les unités des flux qui ONT une valeur s'accordent-elles avec celle de
 * l'inconnue ? `valeurs` contient les inconnues déjà déduites : une valeur
 * calculée est une donnée comme une autre pour l'unité.
 *
 * Une unité vide ne contredit rien : elle se lit dans celle des autres. Deux
 * unités non vides différentes, si.
 */
function unitesCompatibles(liens, inconnue, valeurs) {
  const vues = new Set();
  for (const l of liens) {
    if (l === inconnue) continue;
    if (estInconnue(l) && !valeurs.has(l)) continue;   // inconnue non résolue
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

/** Les inconnues d'un nœud, chacune une fois (une boucle se voit des deux côtés). */
function inconnuesDuNoeud(ent, sor) {
  return Array.from(new Set(ent.concat(sor).filter(estInconnue)));
}

/**
 * Une passe de propagation, jusqu'à ce qu'aucun nœud ne puisse plus déduire.
 *
 * `interdits` : les liens qu'une passe précédente a déclarés contradictoires.
 * Ils restent des inconnues — on ne les déduit pas, et l'on recalcule le reste
 * sans eux.
 *
 * Rend les valeurs déduites, le nœud qui a déduit chacune (`solveur`), les
 * raisons des nœuds bloqués, et `suspect` : le premier lien déduit qu'un nœud
 * contredit (ses flux connus ne s'équilibrent plus avec cette valeur).
 */
function propager(nodes, links, interdits) {
  const incidents = new Map();
  nodes.forEach(n => incidents.set(n.id, { ent: [], sor: [] }));
  for (const l of links) {
    const s = incidents.get(l.source);
    const t = incidents.get(l.target);
    if (s) s.sor.push(l);
    if (t) t.ent.push(l);
  }

  const listes = new Map();
  nodes.forEach(n => {
    const { ent, sor } = incidents.get(n.id);
    listes.set(n.id, inconnuesDuNoeud(ent, sor));
  });

  const valeurs = new Map();      // lien inconnu -> valeur déduite
  const solveur = new Map();      // lien inconnu -> id du nœud qui l'a déduit
  const raisons = new Map();      // id de nœud -> pourquoi il est bloqué
  const impossibles = new Map();  // id de nœud -> reste négatif calculé
  const restantes = new Map();    // id -> inconnues non résolues (interdites comprises)
  const aResoudre = new Map();    // id -> inconnues encore déductibles (hors interdites)

  for (const n of nodes) {
    const list = listes.get(n.id);
    restantes.set(n.id, list.length);
    aResoudre.set(n.id, list.filter(l => !interdits.has(l)).length);
  }

  const file = [];
  const enFile = new Set();
  const enfiler = id => {
    if (enFile.has(id) || aResoudre.get(id) !== 1) return;
    enFile.add(id);
    file.push(id);
  };
  nodes.forEach(n => enfiler(n.id));

  /** Somme des flux qui ont une valeur ; `u` (l'inconnue à déduire) est exclue. */
  const somme = (liste, u) => liste.reduce((t, l) => {
    if (l === u) return t;
    if (valeurs.has(l)) return t + valeurs.get(l);
    if (estInconnue(l)) return t;                 // encore inconnue : ne compte pas
    return t + valeurConnue(l);
  }, 0);

  while (file.length) {
    const id = file.shift();
    enFile.delete(id);
    if (aResoudre.get(id) !== 1) continue;        // débloqué entre-temps

    const { ent, sor } = incidents.get(id);
    const restantesListe = listes.get(id).filter(l => !valeurs.has(l));
    if (restantesListe.length !== 1) continue;
    const u = restantesListe[0];

    // Une boucle se trouve des deux côtés : elle s'annule dans l'équation, sa
    // valeur n'est donc contrainte par rien.
    if (u.source === u.target) { raisons.set(id, "boucle"); continue; }
    if (!unitesCompatibles(ent.concat(sor), u, valeurs)) {
      raisons.set(id, "unites");
      continue;
    }

    const entrees = somme(ent, u);
    const sorties = somme(sor, u);
    // On ne déduit que ce que l'AUTRE côté contraint : une inconnue dont le côté
    // opposé est vide pourrait valoir n'importe quoi.
    const enEntree = ent.indexOf(u) >= 0;
    const oppose = enEntree ? sorties : entrees;
    const connu = enEntree ? entrees : sorties;
    if (oppose <= 0) { raisons.set(id, "isole"); continue; }
    const valeur = oppose - connu;
    if (!(valeur > 0)) {
      raisons.set(id, "desequilibre");
      impossibles.set(id, valeur);
      continue;
    }

    valeurs.set(u, valeur);
    solveur.set(u, id);
    // Le lien est maintenant connu AUX DEUX BOUTS : chacun peut avoir gagné
    // sa dernière inconnue et se remettre dans la file.
    for (const bout of new Set([u.source, u.target])) {
      restantes.set(bout, restantes.get(bout) - 1);
      aResoudre.set(bout, aResoudre.get(bout) - 1);
      enfiler(bout);
    }
  }

  /* Un nœud dont TOUTES les inconnues ont reçu une valeur doit s'équilibrer.
     S'il ne le fait pas, un des chiffres déduits est faux : les deux bouts se
     contredisent. On désigne le lien déduit par l'AUTRE bout — celui du nœud
     lui-même s'équilibrait au moment où il l'a calculé. */
  let suspect = null;
  for (const n of nodes) {
    const list = listes.get(n.id);
    if (!list.length) continue;
    if (list.some(l => !valeurs.has(l))) continue; // il reste une inconnue : pas de bilan
    const { ent, sor } = incidents.get(n.id);
    /* Une source ou un puits n'a de flux que d'un côté : son « équilibre »
       n'est pas une contrainte, et un chiffre venu de l'autre bout n'y est pas
       contredit. Seul un nœud qui a des flux DES DEUX CÔTÉS peut se plaindre. */
    if (!ent.length || !sor.length) continue;
    const e = somme(ent, null);
    const s = somme(sor, null);
    if (Math.abs(e - s) <= 1e-9 * Math.max(1, Math.abs(e), Math.abs(s))) continue;
    const candidat = list.find(l => valeurs.has(l) && solveur.get(l) !== n.id)
      || list.find(l => valeurs.has(l));
    if (candidat) { suspect = candidat; break; }
  }

  return {
    valeurs, solveur, raisons, impossibles, incidents, listes, suspect
  };
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
 *   { id, inconnuesEntrantes, inconnuesSortantes, inconnues, resolues, etat, valeur? }
 * `inconnues` est le nombre d'inconnues AU DÉPART ; `resolues` celles que la
 * propagation a déduites ; `etat` vaut :
 *   - « aucune »       : rien à équilibrer ;
 *   - « resolue »      : toutes les inconnues du nœud sont déduites (`valeur`
 *                        quand il n'en avait qu'une) ;
 *   - « indeterminee » : deux inconnues ou plus restent ;
 *   - « boucle »       : l'inconnue est une boucle sur elle-même ;
 *   - « unites »       : les unités ne s'accordent pas ;
 *   - « desequilibre » : la valeur déduite serait nulle ou négative ;
 *   - « isole »        : aucun flux connu en face, rien à quoi l'égaler ;
 *   - « conflit »      : ses deux extrémités déduisent des valeurs différentes.
 */
function resoudreEquilibrage(model) {
  const nodes = Array.isArray(model && model.nodes) ? model.nodes : [];
  const links = Array.isArray(model && model.links) ? model.links : [];

  const inconnues = links.filter(estInconnue);
  const aucun = () => ({
    model,
    noeuds: nodes.map(n => ({
      id: n.id, inconnuesEntrantes: 0, inconnuesSortantes: 0,
      inconnues: 0, resolues: 0, etat: "aucune"
    })),
    resume: { noeuds: 0, inconnues: 0, resolues: 0, indeterminees: 0 }
  });
  if (!inconnues.length) return aucun();

  /* Propagation, puis recalcul sans les liens qu'un nœud contredit. Chaque tour
     interdit un lien de plus : le nombre de tours est borné par le nombre
     d'inconnues, et l'on ne propage jamais un chiffre faux. */
  const interdits = new Set();
  let passe = propager(nodes, links, interdits);
  let garde = 0;
  while (passe.suspect && garde++ <= inconnues.length) {
    interdits.add(passe.suspect);
    passe = propager(nodes, links, interdits);
  }

  const noeuds = nodes.map(n => {
    const list = passe.listes.get(n.id) || [];
    const initial = list.length;
    const { ent, sor } = passe.incidents.get(n.id);
    const incEnt = ent.filter(estInconnue);
    const incSor = sor.filter(estInconnue);
    if (!initial) {
      return {
        id: n.id, inconnuesEntrantes: 0, inconnuesSortantes: 0,
        inconnues: 0, resolues: 0, etat: "aucune"
      };
    }

    const resolues = list.filter(l => passe.valeurs.has(l)).length;
    const restantes = initial - resolues;
    let etat;
    if (restantes === 0) etat = "resolue";
    else if (list.some(l => interdits.has(l))) etat = "conflit";
    else if (restantes === 1) etat = passe.raisons.get(n.id) || "indeterminee";
    else etat = "indeterminee";

    const resultat = {
      id: n.id,
      inconnuesEntrantes: incEnt.length,
      inconnuesSortantes: incSor.length,
      inconnues: initial,
      resolues,
      etat
    };
    // Une valeur unique ne se dit que s'il n'y avait qu'une inconnue. Un nœud
    // dont plusieurs inconnues ont été déduites les porte sur ses liens.
    if (initial === 1 && restantes === 0) {
      resultat.valeur = passe.valeurs.get(list[0]);
    } else if (etat === "desequilibre" && passe.impossibles.has(n.id)) {
      resultat.valeur = passe.impossibles.get(n.id);
    }
    return resultat;
  });

  const resume = {
    noeuds: noeuds.filter(e => e.inconnues > 0).length,
    // Une inconnue touche deux nœuds : le bilan global compte les FLUX, pas
    // les bouts.
    inconnues: inconnues.length,
    resolues: passe.valeurs.size,
    indeterminees: noeuds.filter(e => e.inconnues > 0 && e.etat !== "resolue").length
  };

  if (!passe.valeurs.size) return { model, noeuds, resume };

  const liens = links.map(l => {
    const v = passe.valeurs.get(l);
    if (v === undefined) return l;
    // `inconnue` reste vrai : le classeur, lui, garde sa case vide. C'est
    // `calculee` qui dit que le chiffre affiché vient de l'équilibrage.
    return Object.assign({}, l, { value: v, calculee: true });
  });
  return { model: Object.assign({}, model, { links: liens }), noeuds, resume };
}

module.exports = { resoudreEquilibrage, estInconnue };
