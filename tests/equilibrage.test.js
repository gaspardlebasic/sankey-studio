/**
 * Équilibrage des nœuds : une valeur de flux inconnue (case « Valeur du flux »
 * vide) se déduit quand le nœud n'en porte qu'une (src/shared/equilibrage.js).
 * Pur : aucun Excel, aucun DOM.
 *
 * On éprouve aussi ce que la déduction NE fait pas : deux inconnues, des unités
 * qui ne s'accordent pas, un reste négatif, deux extrémités qui se contredisent,
 * et l'écriture dans le classeur — qui doit laisser la case VIDE.
 */
"use strict";
const { resoudreEquilibrage } = require("../src/shared/equilibrage.js");
const { projeter } = require("../src/shared/agregation.js");
const { buildModelRows } = require("../src/shared/modele-excel.js");

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

const noeud = id => ({ id, name: id, column: 1, title: "", order: 0, lane: 1,
  kind: "produit", filiere: "Lait", color: null, x: 0, y: 0 });
const lien = (source, target, value, extra) => Object.assign(
  { id: source + ">" + target, source, target, value, unit: "t" }, extra);
const vide = (source, target, extra) =>
  lien(source, target, 0, Object.assign({ inconnue: true }, extra));
const modele = (links, ids) => ({
  nodes: (ids || ["A", "B", "C", "D"]).map(noeud),
  links
});
const parPaire = (m, s, t) => m.links.find(l => l.source === s && l.target === t);
const etat = (r, id) => r.noeuds.find(e => e.id === id);

console.log("équilibrage");

test("une inconnue SORTANTE se déduit de ce qui entre moins ce qui sort", () => {
  const m = modele([
    lien("A", "B", 100),
    lien("B", "D", 30),
    vide("B", "C")
  ]);
  const r = resoudreEquilibrage(m);
  egal(parPaire(r.model, "B", "C").value, 70, "100 entrés − 30 sortis = 70");
  egal(parPaire(r.model, "B", "C").calculee, true, "le lien est marqué déduit");
  egal(etat(r, "B"), {
    id: "B", inconnuesEntrantes: 0, inconnuesSortantes: 1, inconnues: 1,
    resolues: 1, etat: "resolue", valeur: 70
  }, "état du nœud qui calcule");
  // Le nœud d'arrivée ne calcule rien lui-même, mais la valeur est connue.
  egal(etat(r, "C").etat, "resolue", "l'autre bout sait la valeur");
  egal(etat(r, "C").valeur, 70, "et c'est la même");
  egal(r.resume, { noeuds: 2, inconnues: 1, resolues: 1, indeterminees: 0 },
    "un flux inconnu, déduit, qui touche deux nœuds");
});

test("une inconnue ENTRANTE se déduit de ce qui sort moins ce qui entre", () => {
  const m = modele([
    lien("A", "B", 20),
    vide("C", "B"),
    lien("B", "D", 80)
  ]);
  const r = resoudreEquilibrage(m);
  egal(parPaire(r.model, "C", "B").value, 60, "80 sortis − 20 entrés = 60");
});

test("un lien déduit débloque l'inconnue suivante du même nœud", () => {
  // A n'a qu'une inconnue et la déduit (100). B en avait DEUX au départ :
  // A→B et B→C. A→B connue, B n'en a plus qu'une et la déduit à son tour (70).
  const m = modele([
    lien("X", "A", 100),
    vide("A", "B"),
    vide("B", "C"),
    lien("B", "D", 30)
  ], ["A", "B", "C", "D", "X"]);
  const r = resoudreEquilibrage(m);
  egal(parPaire(r.model, "A", "B").value, 100, "A déduit son lien sortant");
  egal(parPaire(r.model, "B", "C").value, 70, "B déduit le sien, débloqué par A");
  egal(etat(r, "B").inconnues, 2, "B avait deux inconnues au départ");
  egal(etat(r, "B").resolues, 2, "les deux ont été déduites");
  egal(etat(r, "B").etat, "resolue", "B est entièrement résolu");
  egal(etat(r, "B").valeur, undefined, "pas de valeur unique à afficher pour B");
  egal(r.resume, { noeuds: 3, inconnues: 2, resolues: 2, indeterminees: 0 },
    "deux flux déduits, trois nœuds concernés");
});

test("la propagation traverse plusieurs nœuds, de proche en proche", () => {
  const m = modele([
    lien("X", "A", 100),
    vide("A", "B"),
    vide("B", "C"),
    lien("C", "D", 100)
  ], ["A", "B", "C", "D", "X"]);
  const r = resoudreEquilibrage(m);
  egal(parPaire(r.model, "A", "B").value, 100, "A déduit le premier flux");
  egal(parPaire(r.model, "B", "C").value, 100, "B déduit le second, sans autre donnée");
  egal(r.resume.resolues, 2, "deux flux déduits");
});

test("le modèle reçu n'est jamais modifié", () => {
  const m = modele([lien("A", "B", 100), vide("B", "C")]);
  const avant = JSON.stringify(m);
  const r = resoudreEquilibrage(m);
  egal(JSON.stringify(m), avant, "le modèle d'origine reste intact");
  attendu(r.model !== m, "le résultat est une copie");
  egal(parPaire(r.model, "B", "C").value, 100, "la copie porte la valeur déduite");
});

test("sans inconnue, le modèle est rendu TEL QUEL", () => {
  const m = modele([lien("A", "B", 100), lien("B", "C", 100)]);
  const r = resoudreEquilibrage(m);
  attendu(r.model === m, "même objet : aucun calcul d'affichage à faire");
  egal(r.resume, { noeuds: 0, inconnues: 0, resolues: 0, indeterminees: 0 }, "bilan vide");
});

test("deux inconnues au même nœud ne se tranchent pas", () => {
  const m = modele([lien("A", "B", 100), vide("B", "C"), vide("B", "D")]);
  const r = resoudreEquilibrage(m);
  egal(parPaire(r.model, "B", "C").value, 0, "aucune valeur inventée");
  egal(parPaire(r.model, "B", "D").value, 0, "ni pour l'autre");
  egal(etat(r, "B").etat, "indeterminee", "l'état le dit");
  egal(etat(r, "B").inconnues, 2, "deux inconnues comptées");
});

test("des unités qui ne s'accordent pas ne s'additionnent pas", () => {
  const m = modele([
    lien("A", "B", 100, { unit: "t" }),
    lien("B", "D", 30, { unit: "t" }),
    vide("B", "C", { unit: "L" })
  ]);
  const r = resoudreEquilibrage(m);
  egal(parPaire(r.model, "B", "C").value, 0, "aucune déduction");
  egal(etat(r, "B").etat, "unites", "l'unité de l'inconnue diffère");
});

test("une unité vide se lit dans celle des autres flux", () => {
  const m = modele([
    lien("A", "B", 100, { unit: "t" }),
    lien("B", "D", 30, { unit: "t" }),
    vide("B", "C", { unit: "" })
  ]);
  const r = resoudreEquilibrage(m);
  egal(parPaire(r.model, "B", "C").value, 70, "l'unité vide ne contredit rien");
});

test("un reste nul ou négatif est une incohérence, pas un flux", () => {
  const m = modele([lien("A", "B", 50), lien("B", "D", 80), vide("B", "C")]);
  const r = resoudreEquilibrage(m);
  egal(parPaire(r.model, "B", "C").value, 0, "on ne dessine pas un flux négatif");
  egal(etat(r, "B").etat, "desequilibre", "l'état le dit");
  egal(etat(r, "B").valeur, -30, "le déséquilibre est connu");
});

test("sans flux connu en face, il n'y a rien à quoi l'égaler", () => {
  const m = modele([vide("A", "B")], ["A", "B"]);
  const r = resoudreEquilibrage(m);
  egal(parPaire(r.model, "A", "B").value, 0, "aucune valeur inventée");
  egal(etat(r, "A").etat, "isole", "la source n'a que l'inconnue");
  egal(etat(r, "B").etat, "isole", "la destination aussi");
});

test("deux extrémités qui se contredisent : ni l'une ni l'autre", () => {
  // A déduit 100 (rien n'entre, 100 sort) ; B déduit 80 (80 entre, rien ne sort).
  const m = modele([
    vide("A", "B"),
    lien("B", "D", 80),
    lien("C", "A", 100)
  ]);
  const r = resoudreEquilibrage(m);
  egal(parPaire(r.model, "A", "B").value, 0, "aucune valeur arbitraire");
  egal(etat(r, "A").etat, "conflit", "le premier bout signale le conflit");
  egal(etat(r, "B").etat, "conflit", "le second aussi");
  egal(r.resume.resolues, 0, "rien de déduit");
});

test("un bout qui donne un reste négatif contredit l'autre : conflit", () => {
  // A déduit 100 ; B, avec 120 entrés et 80 sortis, en déduirait −40.
  const m = modele([
    lien("C", "A", 100),
    vide("A", "B"),
    lien("C", "B", 120),
    lien("B", "D", 80)
  ]);
  const r = resoudreEquilibrage(m);
  egal(parPaire(r.model, "A", "B").value, 0, "aucune valeur arbitraire");
  egal(etat(r, "A").etat, "conflit", "le bout qui calculait 100 signale le conflit");
  egal(etat(r, "B").etat, "conflit", "celui qui calculait −40 aussi");
});

test("une boucle sur le nœud n'est contrainte par rien", () => {
  const m = modele([lien("A", "B", 50), vide("B", "B")]);
  const r = resoudreEquilibrage(m);
  egal(etat(r, "B").inconnues, 1, "la boucle compte pour UNE inconnue");
  egal(etat(r, "B").etat, "boucle", "et ne se déduit pas");
  egal(parPaire(r.model, "B", "B").value, 0, "aucune valeur inventée");
});

test("les deux bouts d'accord ne comptent qu'un flux déduit", () => {
  const m = modele([lien("C", "A", 100), vide("A", "B"), lien("B", "D", 100)]);
  const r = resoudreEquilibrage(m);
  egal(parPaire(r.model, "A", "B").value, 100, "les deux disent 100");
  egal(r.resume.resolues, 1, "un flux, pas deux");
  egal(r.resume.indeterminees, 0, "aucun nœud laissé en plan");
});

test("la projection d'un flux déduit garde la marque", () => {
  const m = modele([
    lien("C", "A", 100),
    vide("A", "B"),
    lien("B", "D", 100)
  ], ["A", "B", "C", "D"]);
  m.nodes[1].parent = "A";
  m.nodes[1].column = 2;
  const resolu = resoudreEquilibrage(m).model;
  const p = projeter(resolu, ["A"]);
  const flux = p.links.find(l => l.source === "A" || l.source === "nd:A");
  attendu(!!flux, "un flux est projeté");
  egal(flux.calculee, true, "la marque « déduite » traverse la projection");
});

test("le classeur garde la case VIDE : la valeur déduite ne s'y écrit pas", () => {
  const m = modele([lien("A", "B", 100), vide("B", "C")]);
  const resolu = resoudreEquilibrage(m).model;
  const { linkRows } = buildModelRows(resolu, null);
  const ligne = linkRows.find(r => r[1].v === "B" && r[2].v === "C");
  attendu(!!ligne, "la ligne du lien inconnu existe");
  egal(ligne[3], { t: "s", v: "" }, "valeur vide, jamais 0 ni 100");
});

test("une inconnue déjà résolue se recalcule sur les données du moment", () => {
  const m = modele([lien("A", "B", 100), vide("B", "C"), lien("B", "D", 30)]);
  const premier = resoudreEquilibrage(m).model;
  egal(parPaire(premier, "B", "C").value, 70, "premier calcul");
  // Le classeur a changé : plus que 20 sortent vers D.
  const change = Object.assign({}, premier, {
    links: premier.links.map(l => l.target === "D" ? Object.assign({}, l, { value: 20 }) : l)
  });
  const second = resoudreEquilibrage(change).model;
  egal(parPaire(second, "B", "C").value, 80, "le second calcul suit la donnée");
});

console.log(`\n${ok}/${ok + echecs.length} tests passés`);
if (echecs.length) process.exit(1);
