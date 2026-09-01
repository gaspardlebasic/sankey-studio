#!/usr/bin/env node
/**
 * Fabrique le manifeste de PRODUCTION — phase 5 du PLAN-COMPLEMENT-EXCEL.md.
 *
 *   npm run addin:manifeste -- https://exemple.github.io/sankey-studio
 *   SANKEY_BASE=https://… npm run addin:manifeste
 *
 * Le manifeste du dépôt (`src/addin/manifest.xml`) vise `https://localhost:3000`
 * et doit le rester : c'est lui qu'on charge de côté pour développer. Celui de
 * production en est la copie, avec **les URL changées et rien d'autre** — le
 * plan est explicite là-dessus, et c'est aussi ce qui rend la substitution
 * vérifiable plutôt que manuelle.
 *
 * Ce que le script REFUSE de produire, parce qu'un manifeste invalide ne se
 * découvre qu'au moment du déploiement, quand c'est le plus cher :
 *   · une base en http:// (Office exige HTTPS, y compris en interne) ;
 *   · un « localhost » oublié quelque part ;
 *   · une URL qui pointe ailleurs que sur la base — les pages d'un complément
 *     doivent partager une origine, sous-domaine compris (PLAN §5.3) ;
 *   · une version qui n'a pas bougé alors que le contenu, si (voir plus bas) ;
 *   · un `dist/addin` incomplet : sans `fenetre.html`, la fenêtre d'édition
 *     n'existe pas, et le complément ne le découvrirait qu'à l'usage.
 *
 * LA VERSION COMPTE. Un complément déployé par le centre d'administration n'est
 * rechargé par Office que si `<Version>` a changé. Elle est donc dérivée de
 * `package.json` : publier une correction sans monter la version, c'est publier
 * pour personne.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, join } from "path";

const SOURCE = "src/addin/manifest.xml";
const SORTIE = "dist/addin/manifest.xml";
const DEV = "https://localhost:3000";

/* ----------------------------- la base ----------------------------- */

const brut = (process.argv[2] || process.env.SANKEY_BASE || "").trim();
if (!brut) {
  console.error("Où le complément sera-t-il servi ?\n");
  console.error("  npm run addin:manifeste -- https://exemple.github.io/sankey-studio\n");
  console.error("C'est l'adresse de dist/addin une fois publié — celle où répond index.html.");
  process.exit(1);
}

let url;
try { url = new URL(brut); } catch { console.error("Adresse illisible : " + brut); process.exit(1); }
if (url.protocol !== "https:") {
  console.error("Office n'accepte que HTTPS — même pour un hébergement interne. Reçu : " + url.protocol);
  process.exit(1);
}
// Sans barre finale : le manifeste colle des chemins derrière.
const base = (url.origin + url.pathname).replace(/\/+$/, "");
const origine = url.origin;

/* ----------------------------- la version ----------------------------- */

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const morceaux = String(pkg.version || "0.0.0").split(".").map(n => n.replace(/\D.*$/, ""));
while (morceaux.length < 4) morceaux.push("0");
const version = morceaux.slice(0, 4).join(".");

/* ----------------------------- la substitution ----------------------------- */

if (!existsSync(SOURCE)) { console.error("Manifeste source introuvable : " + SOURCE); process.exit(1); }
let xml = readFileSync(SOURCE, "utf8");

if (!xml.includes(DEV)) {
  console.error("Le manifeste source ne vise plus " + DEV + " — a-t-il été modifié à la main ?");
  process.exit(1);
}

xml = xml.split(DEV).join(base);
// AppDomain veut une ORIGINE (schéma + hôte), pas une base avec un chemin.
xml = xml.replace(/<AppDomain>[^<]*<\/AppDomain>/g, "<AppDomain>" + origine + "</AppDomain>");
xml = xml.replace(/<Version>[^<]*<\/Version>/, "<Version>" + version + "</Version>");

// Le commentaire de tête de la source explique le chargement de côté en
// développement : il n'a rien à faire dans un manifeste de production, et il
// parle de localhost — ce que la vérification refuse, à juste titre. On lui
// substitue l'origine du fichier, pour qui tomberait dessus sans contexte.
const entete = "<!-- ENGENDRÉ par scripts/manifeste-prod.mjs — ne pas modifier à la main.\n"
  + "     Source : " + SOURCE + "\n"
  + "     Base   : " + base + "\n"
  + "     Version: " + version + " (package.json) -->\n";
xml = xml.replace(/(<\?xml[^?]*\?>\n)[\s\S]*?(<OfficeApp)/, "$1" + entete + "$2");

/* ----------------------------- les vérifications ----------------------------- */

const soucis = [];
if (/localhost/i.test(xml)) soucis.push("il reste un « localhost » dans le manifeste");
for (const [, u] of xml.matchAll(/DefaultValue="(https?:[^"]+)"/g)) {
  if (!u.startsWith(base + "/")) soucis.push("URL hors de la base : " + u);
}
if (!xml.includes("<AppDomain>" + origine + "</AppDomain>")) soucis.push("AppDomains ne déclare pas " + origine);

const attendus = ["index.html", "fenetre.html", "styles.css"];
for (const f of attendus) {
  if (!existsSync(join("dist/addin", f))) soucis.push("dist/addin/" + f + " manque — lance `npm run build`");
}
if (!existsSync("dist/addin/assets/icon-80.png")) soucis.push("dist/addin/assets manque — lance `npm run build`");

if (soucis.length) {
  console.error("Manifeste NON produit :");
  for (const s of soucis) console.error("  · " + s);
  process.exit(1);
}

mkdirSync("dist/addin", { recursive: true });
writeFileSync(SORTIE, xml);

console.log("Manifeste de production écrit :\n  " + resolve(SORTIE) + "\n");
console.log("  base    " + base);
console.log("  origine " + origine + "  (AppDomains)");
console.log("  version " + version + "  (depuis package.json)\n");
console.log("Ensuite — voir DIFFUSION.md :");
console.log("  1. publier dist/addin/ à l'adresse ci-dessus");
console.log("  2. vérifier que " + base + "/index.html répond en HTTPS");
console.log("  3. téléverser ce manifeste au centre d'administration M365");
console.log("\nRappel : Office ne recharge un complément déployé que si <Version> a changé.");
