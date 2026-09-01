#!/usr/bin/env node
/**
 * Serveur HTTPS local du complément (PLAN-COMPLEMENT-EXCEL.md).
 *
 *   npm run addin:serve
 *
 * Sert trois choses sur le même domaine — un complément doit tout charger
 * depuis le sien, sous-domaine compris :
 *
 *   /                 le complément construit (dist/addin, cf. build.mjs)
 *   /sonde.html       le banc d'essai des phases 0 et 6 (src/addin, sans bundle)
 *   /assets/…         les icônes du ruban — servies depuis dist/addin comme en
 *                     production : `dist/addin` doit se publier tel quel (§5.3),
 *                     donc le développement doit voir exactement la même arborescence.
 *
 * Un complément Office ne se charge QU'EN HTTPS, y compris depuis localhost.
 * Les certificats viennent de `office-addin-dev-certs`, qui installe une
 * autorité de confiance dans le trousseau — cette installation demande le mot
 * de passe et doit être lancée par toi :
 *
 *   npm run addin:certs
 *
 * C'est un besoin de DÉVELOPPEMENT seulement : en production le complément est
 * servi par un hébergeur statique public (PLAN §5.3), sans aucun certificat à
 * installer sur les postes.
 */

import { createServer } from "https";
import { readFileSync, existsSync } from "fs";
import { extname, join, resolve } from "path";
import { homedir } from "os";

// Le manifeste code l'adresse en dur : le port par défaut n'est pas négociable.
// SANKEY_PORT ne sert qu'à essayer le serveur quand 3000 est déjà pris.
const PORT = Number(process.env.SANKEY_PORT || 3000);
const complement = resolve("dist/addin");
const sonde = resolve("src/addin");
const certDir = join(homedir(), ".office-addin-dev-certs");
const certFile = join(certDir, "localhost.crt");
const keyFile = join(certDir, "localhost.key");

if (!existsSync(certFile) || !existsSync(keyFile)) {
  console.error(`Certificats introuvables dans ${certDir}\n`);
  console.error("Lance d'abord (il demandera ton mot de passe) :\n");
  console.error("  npm run addin:certs\n");
  process.exit(1);
}
if (!existsSync(join(complement, "index.html"))) {
  console.error("dist/addin est vide — construis d'abord le complément :\n");
  console.error("  npm run build\n");
  process.exit(1);
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".otf": "font/otf",
  ".xml": "text/xml; charset=utf-8"
};

/** À quel dossier appartient cette adresse ? (rien hors de ces trois-là) */
function fichierPour(chemin) {
  if (chemin === "/") return join(complement, "index.html");
  if (/^\/sonde(\.|-)/.test(chemin) || chemin === "/manifest-sonde.xml") {
    return join(sonde, chemin);
  }
  return join(complement, chemin);
}

/**
 * Une ligne par requête : c'est le seul moyen de voir ce que la webview
 * d'Office demande VRAIMENT (et ce qu'elle ne demande pas) pendant un essai
 * dans Excel. Sans ça, un 404 dans le volet est invisible depuis ici.
 */
function journal(req, code) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`${t}  ${code}  ${req.method} ${req.url}`);
}

createServer(
  { cert: readFileSync(certFile), key: readFileSync(keyFile) },
  (req, res) => {
    const chemin = decodeURIComponent(req.url.split("?")[0]);
    const fichier = fichierPour(chemin);
    const permis = [complement, sonde].some(r => fichier.startsWith(r + "/"));
    if (!permis) { journal(req, 403); res.writeHead(403); res.end("403"); return; }
    if (!existsSync(fichier)) { journal(req, 404); res.writeHead(404); res.end("404 " + chemin); return; }
    journal(req, 200);
    res.writeHead(200, {
      "Content-Type": types[extname(fichier)] || "application/octet-stream",
      // Les webviews Office cachent agressivement. Le bundle porte déjà une
      // empreinte dans son nom ; pour le reste (page, styles), jamais de cache.
      "Cache-Control": "no-store"
    });
    res.end(readFileSync(fichier));
  }
).on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`Le port ${PORT} est déjà pris — un autre serveur du complément tourne`);
    console.error("(ou la sonde). Arrête-le, ou lance :\n");
    console.error(`  SANKEY_PORT=3100 npm run addin:serve\n`);
    process.exit(1);
  }
  throw err;
}).listen(PORT, () => {
  console.log(`Complément servi sur https://localhost:${PORT}/`);
  console.log(`Sonde (phases 0 et 6) https://localhost:${PORT}/sonde.html`);
  console.log("Laisse ce serveur tourner tant que le volet est ouvert dans Excel.");
});
