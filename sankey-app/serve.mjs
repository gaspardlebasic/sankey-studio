// Petit serveur statique pour prévisualiser le rendu dans un navigateur
// (utilisé pour la vérification ; l'app réelle passe par Electron).
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { extname, join } from "path";

const root = "dist/renderer";
const port = 8811;
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
  const file = join(root, p);
  if (!existsSync(file)) {
    res.writeHead(404);
    res.end("404");
    return;
  }
  res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`preview http://localhost:${port}`));
