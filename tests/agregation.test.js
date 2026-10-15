/**
 * Niveaux d'agrégation : projection du modèle sur un état de dépliage
 * (src/shared/agregation.js) et rangement en plan du classeur
 * (src/shared/modele-excel.js). Pur : aucun Excel, aucun DOM.
 *
 * La règle éprouvée ici est celle de PLAN-AGREGATION.md : un flux agrégé est un
 * TOTAL, le détail en fait partie, le reste va à « (non détaillé) ».
 */
"use strict";
const {
  projeter, alignerSurParents, depliesAuNiveau, nombreDeNiveaux, PREFIXE_RESTE
} = require("../src/shared/agregation.js");
const { buildModelRows, parentsValides, NODE_COLS } = require("../src/shared/modele-excel.js");

let ok = 0;
const echecs = [];
function test(nom, fn) {
  try { fn(); ok++; console.log("  ✓ " + nom); }
  catch (e) { echecs.push(nom); console.log("  ✗ " + nom + "\n    " + e.message); }
}
function egal(reel, att, m) {
  const a = JSON.stringify(reel), b = JSON.stringify(att);
  if (a !== b) throw new Error(`${m} : attendu ${b}, obtenu ${a}`);
}
function attendu(c, m) { if (!c) throw new Error(m); }

const noeud = (id, extra) => Object.assign(
  { id, name: id, column: 1, title: "", order: 0, lane: 1, kind: "produit",
    filiere: "Lég", color: null, parent: null }, extra);
const lien = (source, target, value, extra) =>
  Object.assign({ id: source + ">" + target, source, target, value, unit: "kt" }, extra);

/** Exploitations → Légumineuses (Pois, Féverole) → Alimentation animale. */
function modele(liens) {
  return {
    nodes: [
      noeud("Expl", { column: 1, kind: "industrie" }),
      noeud("Leg", { column: 2, color: "#2a7" }),
      noeud("Pois", { column: 2, parent: "Leg", order: 1 }),
      noeud("Fev", { column: 2, parent: "Leg", order: 2 }),
      noeud("Alim", { column: 3, kind: "industrie" })
    ],
    links: liens
  };
}
const valeur = (p, s, t) => {
  const l = p.links.find(x => x.source === s && x.target === t);
  return l ? l.value : undefined;
};
const ids = p => p.nodes.map(n => n.id);

console.log("agrégation");

test("total et détail : replié, le total ; déplié, le détail et le reste", () => {
  const m = modele([lien("Expl", "Leg", 100), lien("Expl", "Pois", 40), lien("Expl", "Fev", 25)]);
  const replie = projeter(m, []);
  egal(ids(replie), ["Expl", "Leg", "Alim"], "nœuds repliés");
  egal(valeur(replie, "Expl", "Leg"), 100, "le détail fait partie du total");
  const deplie = projeter(m, ["Leg"]);
  egal(ids(deplie), ["Expl", "Pois", "Fev", PREFIXE_RESTE + "Leg", "Alim"], "nœuds dépliés");
  egal(valeur(deplie, "Expl", "Pois"), 40, "Pois");
  egal(valeur(deplie, "Expl", "Fev"), 25, "Féverole");
  egal(valeur(deplie, "Expl", PREFIXE_RESTE + "Leg"), 35, "reste non détaillé");
  egal(deplie.incoherences.length, 0, "rien d'incohérent");
});

test("détail seul : replié, la somme ; déplié, pas de reste", () => {
  const m = modele([lien("Expl", "Pois", 40), lien("Expl", "Fev", 25)]);
  egal(valeur(projeter(m, []), "Expl", "Leg"), 65, "somme");
  const d = projeter(m, ["Leg"]);
  attendu(!ids(d).includes(PREFIXE_RESTE + "Leg"), "pas de « (non détaillé) » inutile");
});

test("total seul : déplié, tout est « (non détaillé) »", () => {
  const m = modele([lien("Expl", "Leg", 100)]);
  const d = projeter(m, ["Leg"]);
  egal(valeur(d, "Expl", PREFIXE_RESTE + "Leg"), 100, "reste");
  const reste = d.nodes.find(n => n.id === PREFIXE_RESTE + "Leg");
  egal([reste.virtuel, reste.name, reste.parentAffiche, reste.color],
       [true, "(non détaillé)", "Leg", "#2a7"], "nœud virtuel");
});

test("détail plus grand que le total : on dessine le détail, et on le signale", () => {
  const m = modele([lien("Expl", "Leg", 60), lien("Expl", "Pois", 40), lien("Expl", "Fev", 25)]);
  const p = projeter(m, []);
  egal(valeur(p, "Expl", "Leg"), 65, "le détail l'emporte");
  egal(p.incoherences.map(i => [i.lien.id, i.total, i.detail]), [["Expl>Leg", 60, 65]], "signalée");
});

test("des deux côtés : les flux sortants suivent la même règle", () => {
  const m = modele([lien("Leg", "Alim", 50), lien("Pois", "Alim", 30)]);
  egal(valeur(projeter(m, []), "Leg", "Alim"), 50, "replié");
  const d = projeter(m, ["Leg"]);
  egal([valeur(d, "Pois", "Alim"), valeur(d, PREFIXE_RESTE + "Leg", "Alim")], [30, 20], "déplié");
});

test("enfants rangés à la place du parent, dans leur ordre ; couleur héritée", () => {
  const m = modele([lien("Expl", "Pois", 1), lien("Expl", "Fev", 1)]);
  m.nodes.push(noeud("Autre", { column: 2, order: 5 }));
  m.nodes.find(n => n.id === "Pois").order = 9;    // ordre propre aux frères et sœurs
  const d = projeter(m, ["Leg"]);
  const col2 = d.nodes.filter(n => n.column === 2).sort((a, b) => a.order - b.order);
  egal(col2.map(n => n.id), ["Fev", "Pois", "Autre"], "ordre affiché");
  egal(col2.map(n => n.parentAffiche), ["Leg", "Leg", null], "cadre du parent");
  egal(col2[0].color, "#2a7", "couleur du parent");
  egal(projeter(m, []).nodes.find(n => n.id === "Leg").depliable, true, "⊕ sur le parent");
});

test("trois niveaux : niveau, dépliage partiel, part bio pondérée", () => {
  const m = modele([
    lien("Expl", "Leg", 100, { bio: 0.1 }),
    lien("Expl", "Pois", 60, { bio: 0.5 }),
    lien("Expl", "PoisH", 20)
  ]);
  m.nodes.push(noeud("PoisH", { column: 2, parent: "Pois" }));
  egal(nombreDeNiveaux(m.nodes), 3, "trois niveaux");
  egal(Array.from(depliesAuNiveau(m.nodes, 2)), ["Leg"], "niveau 2");
  const n2 = projeter(m, depliesAuNiveau(m.nodes, 2));
  egal(valeur(n2, "Expl", "Pois"), 60, "Pois replié porte son total");
  egal(valeur(n2, "Expl", PREFIXE_RESTE + "Leg"), 40, "reste de Légumineuses");
  const n3 = projeter(m, true);
  egal([valeur(n3, "Expl", "PoisH"), valeur(n3, "Expl", PREFIXE_RESTE + "Pois")], [20, 40], "niveau 3");
  const n1 = projeter(m, []);
  // 40 propres à 10 % + 40 propres à 50 % + 20 à 0 % = 24 sur 100
  egal(Math.round(n1.links[0].bio * 100), 24, "part bio pondérée par les parts propres");
});

test("un parent invalide est ignoré : autre filière, boucle, inconnu", () => {
  const nodes = [
    noeud("A", { parent: "B" }), noeud("B", { parent: "A" }),       // boucle
    noeud("C", { parent: "X" }),                                     // inconnu
    noeud("D", { parent: "E" }), noeud("E", { filiere: "Autre" }),   // autre filière
    noeud("F", { parent: "A" })                                      // mène à une boucle
  ];
  egal(Array.from(parentsValides(nodes).entries()), [["F", "A"]], "seul F garde son parent");
});

test("cas A : un enfant suit la colonne et le couloir de sa racine", () => {
  const m = modele([]);
  m.nodes.find(n => n.id === "Pois").column = 4;
  m.nodes.find(n => n.id === "Fev").lane = 2;
  egal(alignerSurParents(m.nodes).map(n => n.id), ["Pois", "Fev"], "réalignés");
  egal(m.nodes.filter(n => n.parent).map(n => [n.column, n.lane]), [[2, 1], [2, 1]], "même cellule");
  egal(alignerSurParents(m.nodes).length, 0, "plus rien à faire ensuite");
});

test("projeter ne touche pas au modèle", () => {
  const m = modele([lien("Expl", "Leg", 100), lien("Expl", "Pois", 40)]);
  const avant = JSON.stringify(m);
  projeter(m, true);
  egal(JSON.stringify(m), avant, "modèle intact");
});

console.log("classeur");

test("rangement en plan : chaque enfant sous son parent, Parent et ID parent écrits", () => {
  const m = modele([]);
  m.nodes.push(noeud("Aaa", { column: 2, order: 1 }));  // voisin du parent, ordre plus grand
  const { nodeRows } = buildModelRows(m);
  const iNom = NODE_COLS.indexOf("Noeud"), iP = NODE_COLS.indexOf("Parent"),
        iIdP = NODE_COLS.indexOf("ID parent");
  egal(nodeRows.map(r => r[iNom].v), ["Expl", "Leg", "Pois", "Fev", "Aaa", "Alim"], "plan");
  egal(nodeRows.map(r => r[iP].v), ["", "", "Leg", "Leg", "", ""], "Parent");
  egal(nodeRows.map(r => r[iIdP].v), ["", "", "Leg", "Leg", "", ""], "ID parent");
});

test("sans hiérarchie, le rangement est celui d'avant", () => {
  const nodes = [noeud("b", { column: 2 }), noeud("a", { column: 2 }), noeud("z", { column: 1, order: 3 })];
  const { nodeRows } = buildModelRows({ nodes, links: [] });
  egal(nodeRows.map(r => r[1].v), ["z", "a", "b"], "colonne, ordre, puis nom");
});

console.log(`\n${ok}/${ok + echecs.length} tests passés`);
if (echecs.length) { console.log("Échecs : " + echecs.join(", ")); process.exit(1); }
