// Petit serveur statique pour prévisualiser le rendu dans un navigateur
// (utilisé pour la vérification ; l'app réelle passe par Electron).
import { createServer } from "http";
import { readFileSync, existsSync, readdirSync } from "fs";
import { extname, join } from "path";

const root = "dist/renderer";
const port = 8811;

/** Les bancs d'essai vivent dans tests/ pour ne pas partir dans dist/. */
const BANCS = new Set([
  "/volet-essai.html", "/fenetre-essai.html", "/fenetre-cadre.html", "/faux-office-sonde.js"
]);

/**
 * La SONDE hors d'Excel (phase 6). On sert les VRAIES pages de `src/addin`, en
 * remplaçant seulement l'office.js du CDN par le faux : dupliquer leur balisage
 * ici les laisserait diverger sans qu'on le voie.
 */
function pageSonde(nom) {
  return readFileSync(join("src/addin", nom), "utf8")
    .replace(/<script src="https:\/\/appsforoffice[^"]*"><\/script>/,
             '<script src="/faux-office-sonde.js"></script>')
    .replace('src="sonde.js"', 'src="/addin-src/sonde.js"');
}

/**
 * Le bundle du complément porte une empreinte dans son nom (build.mjs) : le
 * banc de la phase 4 ne peut pas la deviner. `/addin/fenetre.js` la résout ;
 * tout le reste (dont la carte de sources) est servi tel quel.
 */
function fichierAddin(rel) {
  if (!existsSync("dist/addin")) return null;
  const direct = join("dist/addin", rel);
  if (existsSync(direct)) return direct;
  const nom = rel.replace(/\.js$/, "");
  const f = readdirSync("dist/addin").find(x => x.startsWith(nom + ".") && x.endsWith(".js"));
  return f ? join("dist/addin", f) : null;
}
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".otf": "font/otf"
};

createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  // Bancs d'essai du complément sans Excel : le renderer sous les capacités du
  // volet (volet-essai), et le couple volet + fenêtre de la phase 4
  // (fenetre-essai, qui charge fenetre-cadre dans un iframe).
  let file;
  if (p === "/sonde-essai.html" || p === "/sonde-fenetre.html") {
    const nom = p === "/sonde-essai.html" ? "sonde.html" : "sonde-fenetre.html";
    res.writeHead(200, { "Content-Type": types[".html"] });
    res.end(pageSonde(nom));
    return;
  }
  if (BANCS.has(p)) file = join("tests", p.slice(1));
  else if (p.startsWith("/addin-src/")) file = join("src/addin", p.slice("/addin-src/".length));
  else if (p.startsWith("/addin/")) file = fichierAddin(p.slice("/addin/".length));
  else file = join(root, p);
  if (!file || !existsSync(file)) {
    res.writeHead(404);
    res.end("404");
    return;
  }
  res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`preview http://localhost:${port}`));
