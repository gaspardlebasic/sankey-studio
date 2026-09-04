"use strict";
/**
 * Tests de la DATE DE CONSTRUCTION affichée par le volet
 * (`src/addin/date-build.ts`, gravée par `build.mjs`).
 *
 * Pourquoi ce fichier existe : cette date ne sert qu'à une chose, mais elle y
 * sert seule — distinguer « ma correction n'est pas encore publiée » de
 * « Excel me sert une page en cache ». Une date fausse ou absente ne se
 * remarque pas : elle ressemble à une date. Deux choses sont donc éprouvées ici.
 *
 *  1. La GRAVURE. Si le `define` d'esbuild disparaît de `build.mjs` (renommé,
 *     oublié dans une nouvelle cible), le module retombe sur `""` et la ligne se
 *     cache — en silence. Le contrôle porte sur le bundle réellement construit.
 *  2. La MISE EN FORME. Elle est faite à l'affichage, dans le fuseau du poste :
 *     le test se place donc dans un fuseau connu et compare à une chaîne écrite
 *     à la main, jamais recalculée par la même formule que le code.
 *
 * Usage : node tests/addin-date-build.test.js  [filtre]
 */

// Avant tout appel à Date : la mise en forme dépend du fuseau, et un test qui
// passerait à Paris mais pas ailleurs ne prouverait rien.
process.env.TZ = "Europe/Paris";

const path = require("path");
const os = require("os");
const fs = require("fs");
const { execFileSync } = require("child_process");
const esbuild = require("esbuild");

const filtre = process.argv[2];
let ok = 0;
const echecs = [];
function test(nom, fn) {
  if (filtre && !nom.toLowerCase().includes(filtre.toLowerCase())) return;
  try { fn(); ok++; console.log("  ok    " + nom); }
  catch (e) { echecs.push(nom); console.log("  ÉCHEC " + nom + "\n      " + ((e && e.message) || e)); }
}
function attendu(c, m) { if (!c) throw new Error(m); }
function egal(a, b, m) {
  if (a !== b) throw new Error(m + "\n      obtenu   : " + JSON.stringify(a)
    + "\n      attendu  : " + JSON.stringify(b));
}

/** Le module compilé, avec ou sans la gravure — comme les autres bancs. */
function charger(define) {
  const sortie = path.join(os.tmpdir(),
    `sankey-date-build-${process.pid}-${Math.random().toString(36).slice(2)}.cjs`);
  esbuild.buildSync({
    entryPoints: ["src/addin/date-build.ts"], bundle: true, format: "cjs",
    platform: "node", target: "es2019", outfile: sortie, define
  });
  process.on("exit", () => { try { fs.unlinkSync(sortie); } catch (e) { /* déjà parti */ } });
  return require(sortie);
}

console.log("\ndate de construction — mise en forme\n");

const grave = charger({ __DATE_BUILD__: JSON.stringify("2026-09-04T13:32:00.000Z") });
const nu = charger({});

test("la date gravée arrive telle quelle", () => {
  egal(grave.DATE_BUILD, "2026-09-04T13:32:00.000Z", "la gravure doit traverser le bundle");
});

test("elle se lit en français, à l'heure du poste", () => {
  // 13:32 UTC, lu à Paris en septembre (UTC+2) : 15:32.
  egal(grave.dateBuildLisible(), "4 septembre 2026 à 15:32",
    "la date affichée dans le volet");
});

test("sans gravure, rien plutôt qu'une fausse date", () => {
  egal(nu.DATE_BUILD, "", "un bundle sans define n'a pas de date");
  egal(nu.dateBuildLisible(), "", "et n'en invente pas");
});

test("une date illisible ne devient pas « Invalid Date »", () => {
  egal(grave.dateBuildLisible("pas une date"), "", "texte quelconque");
  egal(grave.dateBuildLisible(""), "", "chaîne vide");
});

console.log("\ndate de construction — gravure dans le complément construit\n");

/*
 * Le bundle du volet, tel que `build.mjs` le fabrique. On le construit s'il
 * n'est pas là : `npm run test:addin` ne passe pas par `node build.mjs`, et un
 * test qui se contenterait de sauter quand `dist/` manque ne dirait jamais rien.
 */
function bundleDuVolet() {
  const dossier = "dist/addin";
  const trouver = () => (fs.existsSync(dossier) ? fs.readdirSync(dossier) : [])
    .filter(f => /^index\..*\.js$/.test(f));
  if (!trouver().length) execFileSync("node", ["build.mjs"], { stdio: "ignore" });
  const noms = trouver();
  attendu(noms.length === 1, "un seul bundle attendu pour le volet, trouvé : " + noms.join(", "));
  return fs.readFileSync(path.join(dossier, noms[0]), "utf8");
}

const bundle = bundleDuVolet();

test("build.mjs remplace bien le jeton", () => {
  attendu(!bundle.includes("__DATE_BUILD__"),
    "le jeton __DATE_BUILD__ est resté dans le bundle : le `define` de build.mjs "
    + "a disparu ou changé de nom, et le volet n'affichera aucune date");
});

test("le bundle porte un instant valide", () => {
  const m = bundle.match(/"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)"/);
  attendu(m, "aucune date ISO gravée dans le bundle du volet");
  attendu(Number.isFinite(Date.parse(m[1])), "date gravée illisible : " + m[1]);
});

console.log(`\n${ok}/${ok + echecs.length} tests passés`);
if (echecs.length) { console.log("Échecs : " + echecs.join(", ")); process.exit(1); }
