"use strict";
/**
 * Sous-flux d'un nœud — la part de chaque lien du diagramme qui passe PAR lui.
 *
 * Les liens qui touchent le nœud comptent en entier. Au-delà, on remonte et on
 * descend en supposant les flux MÉLANGÉS dans chaque nœud :
 *
 *   - en amont, si M → N pèse x % de ce qui SORT de M, on retient x % de
 *     chaque lien qui ARRIVE à M, et ainsi de suite jusqu'aux sources ;
 *   - en aval, si N → P pèse y % de ce qui ARRIVE à P, on retient y % de
 *     chaque lien qui SORT de P, et ainsi de suite jusqu'aux puits.
 *
 * Plusieurs chemins s'additionnent : un nœud amont qui alimente N par deux
 * détours voit sa part faite de la somme des deux. La part d'un nœud se calcule
 * donc une fois tous ses liens vers le sous-flux connus — d'où un parcours dans
 * l'ordre topologique.
 *
 * Un lien qui contourne le nœud (un ancêtre relié directement à un
 * descendant) ne passe pas par lui : il n'est pas retenu.
 *
 * Pur, sans DOM : éprouvé en Node (tests/sous-flux.test.js), regroupé par
 * esbuild dans le complément.
 */

/** Clé d'un lien : le couple (origine, destination), qui l'identifie. */
function cleLien(source, target) {
  return source + "\u0000" + target;
}

function valeur(l) {
  const v = Number(l.value);
  return isFinite(v) && v > 0 ? v : 0;
}

/**
 * Parcourt le graphe depuis `focus` dans un sens et rend, pour chaque lien
 * rencontré, la valeur retenue. `sens` vaut "amont" ou "aval".
 *
 * amont : part(v) = retenu sortant de v / total sortant de v
 * aval  : part(v) = retenu entrant dans v / total entrant dans v
 * Le nœud de départ a une part de 1.
 */
function parcourir(liens, focus, sens) {
  const amont = sens === "amont";
  const proche = l => (amont ? l.target : l.source);   // côté déjà parcouru
  const loin = l => (amont ? l.source : l.target);     // côté à parcourir
  const versLoin = new Map();     // nœud -> liens qui s'en éloignent du focus
  const total = new Map();        // nœud -> total du côté qui fait la part
  for (const l of liens) {
    if (l.source === l.target) continue;
    const p = proche(l);
    if (!versLoin.has(p)) versLoin.set(p, []);
    versLoin.get(p).push(l);
    const t = loin(l);              // le total de t se lit du côté du focus
    total.set(t, (total.get(t) || 0) + valeur(l));
  }

  // Le sous-graphe atteignable, et pour chacun le nombre de liens qui y
  // mènent depuis le focus : un nœud n'est prêt qu'une fois tous reçus.
  const atteints = new Set([focus]);
  const pile = [focus];
  while (pile.length) {
    const v = pile.pop();
    for (const l of versLoin.get(v) || []) {
      const t = loin(l);
      if (!atteints.has(t)) { atteints.add(t); pile.push(t); }
    }
  }
  const attente = new Map();
  for (const v of atteints) {
    for (const l of versLoin.get(v) || []) {
      const t = loin(l);
      if (t !== focus) attente.set(t, (attente.get(t) || 0) + 1);
    }
  }

  const retenu = new Map();       // nœud -> flux retenu (côté du focus)
  const parLien = new Map();      // cleLien -> valeur retenue
  const traites = new Set();
  const prets = [focus];
  const traiter = v => {
    traites.add(v);
    const part = v === focus ? 1 : Math.min(1, (retenu.get(v) || 0) / (total.get(v) || 1));
    for (const l of versLoin.get(v) || []) {
      const t = loin(l);
      if (t === focus) continue;    // une boucle revient au départ : on l'arrête
      const r = valeur(l) * part;
      const cle = cleLien(l.source, l.target);
      parLien.set(cle, (parLien.get(cle) || 0) + r);
      retenu.set(t, (retenu.get(t) || 0) + r);
      const reste = (attente.get(t) || 0) - 1;
      attente.set(t, reste);
      if (reste === 0 && !traites.has(t)) prets.push(t);
    }
  };
  while (prets.length) traiter(prets.pop());
  // Une boucle laisse des nœuds en attente pour toujours : on les traite
  // tels quels, avec ce qu'ils ont reçu. Un diagramme de flux n'en a pas,
  // mais un classeur peut en porter une par erreur — il ne doit pas tout figer.
  for (const v of atteints) if (!traites.has(v)) traiter(v);
  return parLien;
}

/**
 * La part de chaque lien qui passe par `focus`.
 * Rend une Map cleLien(origine, destination) -> { valeur, part } où `valeur`
 * est le flux retenu et `part` sa fraction du lien (0 < part <= 1). Les liens
 * dont rien ne passe par le nœud n'y figurent pas.
 */
function sousFlux(model, focus) {
  const liens = (model && model.links) || [];
  const brut = new Map();
  for (const l of liens) brut.set(cleLien(l.source, l.target), valeur(l));
  const out = new Map();
  const ajouter = parLien => {
    parLien.forEach((v, cle) => {
      if (!(v > 0)) return;
      const b = brut.get(cle) || 0;
      // Un lien n'est jamais retenu deux fois : un nœud ne peut être à la
      // fois en amont et en aval qu'à travers une boucle.
      const prec = out.get(cle);
      const valeurRetenue = Math.min(b, Math.max(v, prec ? prec.valeur : 0));
      out.set(cle, { valeur: valeurRetenue, part: b > 0 ? valeurRetenue / b : 0 });
    });
  };
  ajouter(parcourir(liens, focus, "amont"));
  ajouter(parcourir(liens, focus, "aval"));
  return out;
}

/**
 * Le diagramme réduit au sous-flux de `focus` : les liens retenus, à leur
 * valeur retenue, et les nœuds qu'ils touchent (plus le focus lui-même), dans
 * l'ordre du modèle. Un nœud absent du modèle laisse le modèle tel quel.
 */
function filtrerSousFlux(model, focus) {
  if (!model.nodes.some(n => n.id === focus)) return model;
  const retenus = sousFlux(model, focus);
  const links = [];
  const gardes = new Set([focus]);
  for (const l of model.links) {
    const r = retenus.get(cleLien(l.source, l.target));
    if (!r) continue;
    links.push(Object.assign({}, l, { value: r.valeur }));
    gardes.add(l.source);
    gardes.add(l.target);
  }
  return { nodes: model.nodes.filter(n => gardes.has(n.id)), links };
}

/**
 * Filtres successifs : le sous-flux du premier nœud, puis, dans ce qui reste,
 * celui du suivant… C'est ce que fait un clic dans un diagramme déjà filtré.
 */
function filtrerChaine(model, chaine) {
  return (chaine || []).reduce((m, id) => filtrerSousFlux(m, id), model);
}

module.exports = { cleLien, sousFlux, filtrerSousFlux, filtrerChaine };
