/**
 * Sous-flux d'un nœud (src/shared/sous-flux.js) : la part de chaque lien qui
 * passe par lui, en amont et en aval, flux supposés mélangés dans chaque nœud.
 * Pur : aucun DOM.
 */
"use strict";
const { sousFlux, filtrerSousFlux, filtrerChaine, cleLien } = require("../src/shared/sous-flux.js");

let ok = 0;
const echecs = [];
function test(nom, fn) {
  try { fn(); ok++; console.log("  ✓ " + nom); }
  catch (e) { echecs.push(nom); console.log("  ✗ " + nom + "\n    " + e.message); }
}
function proche(reel, att, m) {
  if (reel === undefined || Math.abs(reel - att) > 1e-9) {
    throw new Error(`${m} : attendu ${att}, obtenu ${reel}`);
  }
}
function attendu(c, m) { if (!c) throw new Error(m); }

const noeud = id => ({ id, name: id, column: 1, title: "", order: 0, lane: 1, kind: "produit", filiere: "F", color: null });
const lien = (source, target, value) => ({ id: source + ">" + target, source, target, value, unit: "t" });
const modele = (ids, liens) => ({ nodes: ids.map(noeud), links: liens.map(l => lien(...l)) });
const val = (r, s, t) => { const x = r.get(cleLien(s, t)); return x ? x.valeur : undefined; };

/*
 *   A ─60─┐              ┌─30─ X
 *         M ─50─ N ─80─ P
 *   B ─40─┘  └50─ Z  K─20┘ └─70─ Y
 *
 * M sort 100 (50 vers N, 50 vers Z) : N en prend la moitié.
 * P reçoit 100 (80 de N, 20 de K) : N en fournit 80 %.
 */
const exemple = () => modele(
  ["A", "B", "M", "Z", "N", "K", "P", "X", "Y"],
  [["A", "M", 60], ["B", "M", 40], ["M", "N", 50], ["M", "Z", 50],
   ["N", "P", 80], ["K", "P", 20], ["P", "X", 30], ["P", "Y", 70]]
);

test("les liens qui touchent le nœud comptent en entier", () => {
  const r = sousFlux(exemple(), "N");
  proche(val(r, "M", "N"), 50, "M → N");
  proche(val(r, "N", "P"), 80, "N → P");
  proche(r.get(cleLien("M", "N")).part, 1, "part de M → N");
});

test("amont : la part du lien dans ce qui SORT du nœud précédent", () => {
  const r = sousFlux(exemple(), "N");
  // M → N vaut 50 sur 100 sortis de M : la moitié de chaque arrivée.
  proche(val(r, "A", "M"), 30, "A → M");
  proche(val(r, "B", "M"), 20, "B → M");
  proche(r.get(cleLien("A", "M")).part, 0.5, "part de A → M");
});

test("aval : la part du lien dans ce qui ARRIVE au nœud suivant", () => {
  const r = sousFlux(exemple(), "N");
  // N → P vaut 80 sur 100 arrivés en P : 80 % de chaque sortie.
  proche(val(r, "P", "X"), 24, "P → X");
  proche(val(r, "P", "Y"), 56, "P → Y");
});

test("les liens étrangers au nœud ne sont pas retenus", () => {
  const r = sousFlux(exemple(), "N");
  attendu(!r.has(cleLien("M", "Z")), "M → Z ne passe pas par N");
  attendu(!r.has(cleLien("K", "P")), "K → P ne passe pas par N");
});

test("la récurrence va jusqu'au bout du diagramme", () => {
  // S → A → B → N → C → D, chaque étage partagé avec un voisin.
  const m = modele(["S", "T", "A", "B", "N", "C", "D", "E"], [
    ["S", "A", 100], ["A", "B", 40], ["A", "T", 60],   // B prend 40 % de A
    ["B", "N", 10], ["B", "E", 30],                    // N prend 25 % de B
    ["N", "C", 10], ["E", "C", 30],                    // N fait 25 % de C
    ["C", "D", 40]
  ]);
  const r = sousFlux(m, "N");
  proche(val(r, "B", "N"), 10, "B → N entier");
  proche(val(r, "A", "B"), 10, "A → B : 25 % de 40");
  proche(val(r, "S", "A"), 10, "S → A : 10 / 100 sortis de A");
  proche(val(r, "C", "D"), 10, "C → D : 25 % de 40");
});

test("deux chemins vers le nœud s'additionnent", () => {
  // A alimente N directement ET par M : sa part est la somme des deux.
  const m = modele(["S", "A", "M", "N", "Z"], [
    ["S", "A", 100], ["A", "N", 20], ["A", "M", 30], ["A", "Z", 50],
    ["M", "N", 30]
  ]);
  const r = sousFlux(m, "N");
  proche(val(r, "A", "M"), 30, "A → M entier (M ne sort que vers N)");
  proche(val(r, "S", "A"), 50, "S → A : (20 + 30) / 100");
});

test("un lien qui contourne le nœud n'est pas retenu", () => {
  const m = modele(["A", "N", "C"], [["A", "N", 10], ["N", "C", 10], ["A", "C", 5]]);
  const r = sousFlux(m, "N");
  attendu(!r.has(cleLien("A", "C")), "A → C ne passe pas par N");
});

test("une coupe du sous-flux totalise ce qui traverse le nœud", () => {
  // Conservation : ce qui entre en N amont doit se retrouver à chaque étage.
  const r = sousFlux(exemple(), "N");
  proche(val(r, "A", "M") + val(r, "B", "M"), 50, "étage des sources");
  proche(val(r, "P", "X") + val(r, "P", "Y"), 80, "étage des puits");
});

test("un lien nul n'est jamais retenu, ni ne fait diviser par zéro", () => {
  const m = modele(["A", "M", "N"], [["A", "M", 0], ["M", "N", 0]]);
  const r = sousFlux(m, "N");
  attendu(r.size === 0, "rien ne passe : " + JSON.stringify([...r.keys()]));
});

test("une boucle ne fige pas le calcul", () => {
  const m = modele(["A", "N", "B"], [["A", "N", 10], ["N", "B", 10], ["B", "A", 5]]);
  const r = sousFlux(m, "N");
  proche(val(r, "A", "N"), 10, "A → N");
  proche(val(r, "N", "B"), 10, "N → B");
  attendu(r.get(cleLien("B", "A")).part <= 1, "aucune part au-delà du lien");
});

test("filtrer : les liens retenus, à leur valeur, et les nœuds qu'ils touchent", () => {
  const f = filtrerSousFlux(exemple(), "N");
  attendu(f.nodes.map(n => n.id).join() === "A,B,M,N,P,X,Y", "nœuds : " + f.nodes.map(n => n.id).join());
  const am = f.links.find(l => l.source === "A" && l.target === "M");
  proche(am.value, 30, "A → M ramené à sa part");
  attendu(am.id === "A>M" && am.unit === "t", "le lien garde son identité et son unité");
  attendu(exemple().links[0].value === 60, "le modèle d'origine n'est pas touché");
});

test("filtrer : un nœud absent laisse le modèle tel quel", () => {
  const m = exemple();
  attendu(filtrerSousFlux(m, "inconnu") === m, "même objet");
});

test("filtrer : un nœud isolé reste seul", () => {
  const m = modele(["A", "N"], [["A", "B", 1]]);
  const f = filtrerSousFlux(m, "N");
  attendu(f.nodes.length === 1 && f.links.length === 0, JSON.stringify(f));
});

test("filtres successifs : le second s'applique à ce que le premier a laissé", () => {
  const f = filtrerChaine(exemple(), ["N", "A"]);
  // Dans le sous-flux de N, A → M vaut 30 : tout ce qui en descend est réduit à 30 / 50.
  proche(f.links.find(l => l.source === "A").value, 30, "A → M");
  proche(f.links.find(l => l.source === "M").value, 30, "M → N : la part de A");
  proche(f.links.find(l => l.target === "Y").value, 56 * 30 / 50, "P → Y");
  attendu(!f.nodes.some(n => n.id === "B"), "B n'est plus dans le sous-flux de A");
});

console.log(`\nsous-flux : ${ok}/${ok + echecs.length} tests passés`);
if (echecs.length) process.exit(1);
