/**
 * Garde-fou du vidage de cache (`scripts/vider-cache-excel.mjs`).
 *
 * Ce que ce test protège : le dossier `Data/Documents/wef/` du conteneur d'Excel
 * porte le **manifeste chargé de côté**, et son nom ressemble à s'y méprendre au
 * cache des compléments (`…/Application Support/Microsoft/Office/16.0/Wef`).
 * Un `startsWith` un peu large, et la commande censée rafraîchir le complément
 * le désinstallerait — sur le poste de quelqu'un, sans rien dire.
 *
 * Le module s'importe sans rien effacer : c'est `main()`, appelée seulement
 * quand le script est lancé directement, qui agit.
 */
"use strict";
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const echecs = [];
function attendu(condition, message) {
  if (!condition) echecs.push(message);
}

(async () => {
  const mod = await import(
    pathToFileURL(path.join(__dirname, "..", "scripts", "vider-cache-excel.mjs")).href
  );
  const { estUnCache, CACHES, MANIFESTE } = mod;

  // 1. le manifeste n'est jamais effaçable, ni lui ni ce qu'il contient
  attendu(!estUnCache(MANIFESTE), "le dossier du manifeste doit être refusé");
  attendu(!estUnCache(path.join(MANIFESTE, "sankey-studio.xml")),
    "le manifeste lui-même doit être refusé");

  // 2. tous les dossiers de la liste sont, eux, reconnus comme des caches
  CACHES.forEach(([chemin, nom]) => {
    attendu(estUnCache(chemin), `« ${nom} » doit être reconnu comme un cache (${chemin})`);
  });

  // 3. rien hors des conteneurs d'Excel
  ["/", process.env.HOME, path.join(process.env.HOME || "", "Documents"),
   path.join(process.env.HOME || "", "Library/Containers/com.microsoft.Word/Data/Library/Caches")]
    .forEach(chemin => {
      attendu(!estUnCache(chemin), `un chemin hors d'Excel doit être refusé : ${chemin}`);
    });

  // 4. le conteneur lui-même n'est pas un cache : on ne vide que ses sous-dossiers
  const conteneur = MANIFESTE.replace(/\/Documents\/wef$/, "");
  attendu(!estUnCache(conteneur), "le conteneur entier ne doit pas être effaçable");

  if (echecs.length) {
    console.error("Garde-fou du vidage de cache : " + echecs.length + " échec(s)");
    echecs.forEach(m => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ok    garde-fou du vidage de cache (manifeste hors de portée)");
})();
