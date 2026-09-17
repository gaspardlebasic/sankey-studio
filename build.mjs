import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "fs";

const watch = process.argv.includes("--watch");

/*
 * Deux cibles, un seul code d'édition :
 *   dist/addin     LE PRODUIT — les deux pages du complément Excel ;
 *   dist/renderer  l'éditeur nu, sans Office.js — entrée src/renderer/index.ts.
 *
 * `dist/renderer` n'est plus livré à personne : c'est le banc d'essai. Il est
 * servi par `npm run serve` et chargé par les bancs Electron (tests/run.js,
 * scripts/smoke.js), qui posent devant lui un faux pont (tests/pont-essai.js).
 * C'est le seul moyen d'éprouver l'éditeur par de vraies frappes, hors d'Excel.
 */

mkdirSync("dist/renderer", { recursive: true });

/*
 * Date de construction, gravée dans les bundles (src/addin/date-build.ts).
 * Le volet l'affiche : c'est le seul moyen de distinguer « ma correction n'est
 * pas encore publiée » de « Excel me sert une page en cache ». Un seul instant
 * pour toutes les cibles d'une même construction.
 */
const DATE_BUILD = new Date().toISOString();

const commun = {
  bundle: true,
  platform: "browser",
  format: "iife",
  sourcemap: true,
  target: "es2019",
  define: { __DATE_BUILD__: JSON.stringify(DATE_BUILD) },
  logLevel: "info"
};

const options = {
  ...commun,
  entryPoints: ["src/renderer/index.ts"],
  outfile: "dist/renderer/bundle.js"
};

function copyStatic() {
  cpSync("src/renderer/index.html", "dist/renderer/index.html");
  cpSync("src/renderer/styles.css", "dist/renderer/styles.css");
  cpSync("src/renderer/fonts", "dist/renderer/fonts", { recursive: true });
}

/*
 * Le complément a DEUX pages, sur le même domaine (PLAN §9 / phase 4) :
 *   index.html    le volet — courtier : Office.js, le classeur, l'état ;
 *   fenetre.html  la fenêtre d'édition — le renderer, sans accès au classeur.
 * Chacune a son bundle, parce qu'elles ne chargent pas le même code.
 */
const PAGES_ADDIN = [
  { entree: "src/addin/index.ts", page: "index.html" },
  { entree: "src/addin/fenetre.ts", page: "fenetre.html" }
];

/**
 * Construit le complément. Le nom de chaque bundle porte une empreinte : les
 * webviews Office cachent agressivement, et une page qui recharge l'ancien
 * bundle donne des heures de fausses pistes. Les pages sont réécrites avec le
 * nom obtenu — et les deux sont reconstruites ensemble, sans quoi le volet et
 * la fenêtre pourraient parler deux versions différentes du protocole.
 */
async function buildAddin() {
  // On repart à neuf : sinon les bundles des constructions précédentes
  // s'accumulent, et on ne sait plus lequel la page charge.
  if (existsSync("dist/addin")) rmSync("dist/addin", { recursive: true, force: true });
  mkdirSync("dist/addin", { recursive: true });

  const r = await esbuild.build({
    ...commun,
    entryPoints: PAGES_ADDIN.map(p => p.entree),
    outdir: "dist/addin",
    entryNames: "[name].[hash]",
    metafile: true
  });

  // metafile dit quelle sortie vient de quelle entrée : c'est le seul lien sûr
  // entre une page et son bundle une fois les noms hachés.
  const parEntree = {};
  for (const [chemin, info] of Object.entries(r.metafile.outputs)) {
    if (chemin.endsWith(".js") && info.entryPoint) parEntree[info.entryPoint] = chemin.split("/").pop();
  }

  const bundles = PAGES_ADDIN.map(({ entree, page }) => {
    const bundle = parEntree[entree];
    if (!bundle) throw new Error("bundle introuvable pour " + entree);
    writeFileSync("dist/addin/" + page,
      readFileSync("src/addin/" + page, "utf8").replace("__BUNDLE__", bundle));
    return bundle;
  });

  cpSync("src/renderer/styles.css", "dist/addin/styles.css");
  cpSync("src/renderer/fonts", "dist/addin/fonts", { recursive: true });
  // Les icônes du ruban vivent dans dist/ELLES AUSSI : `dist/addin` doit pouvoir
  // être publié tel quel (phase 5), sans aller rien chercher ailleurs.
  if (existsSync("build/addin")) cpSync("build/addin", "dist/addin/assets", { recursive: true });
  return bundles;
}

async function buildOnlyOffice() {
  if (existsSync("dist/onlyoffice")) rmSync("dist/onlyoffice", { recursive: true, force: true });
  mkdirSync("dist/onlyoffice", { recursive: true });

  await esbuild.build({
    ...commun,
    entryPoints: ["src/onlyoffice/index.ts"],
    outfile: "dist/onlyoffice/sankey-onlyoffice.js"
  });

  writeFileSync(
    "dist/onlyoffice/index.html",
    readFileSync("src/onlyoffice/index.html", "utf8").replace("__BUNDLE__", "sankey-onlyoffice.js")
  );
  cpSync("src/onlyoffice/config.json", "dist/onlyoffice/config.json");
  if (existsSync("src/onlyoffice/plugins.js")) {
    cpSync("src/onlyoffice/plugins.js", "dist/onlyoffice/plugins.js");
  }
  cpSync("src/renderer/styles.css", "dist/onlyoffice/styles.css");
  cpSync("src/renderer/fonts", "dist/onlyoffice/fonts", { recursive: true });
  if (existsSync("build/addin")) {
    cpSync("build/addin", "dist/onlyoffice/assets", { recursive: true });
  }

  // Création du paquet .plugin (archive zip renommée .plugin pour ONLYOFFICE)
  try {
    const pluginZip = "dist/sankey-studio.plugin";
    if (existsSync(pluginZip)) rmSync(pluginZip, { force: true });
    const { execFileSync } = await import("child_process");
    execFileSync("zip", ["-q", "-r", "../sankey-studio.plugin", "."], { cwd: "dist/onlyoffice" });
  } catch (err) {
    console.warn("Avertissement : création de dist/sankey-studio.plugin ignorée (" + err.message + ")");
  }

  return "dist/onlyoffice";
}

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  copyStatic();
  // Le complément n'est pas surveillé : il se sert par HTTPS (npm run addin:serve)
  // et sa page doit de toute façon être rechargée dans Excel.
  await buildAddin();
  await buildOnlyOffice();
  console.log("esbuild: watching…");
} else {
  await esbuild.build(options);
  copyStatic();
  const bundles = await buildAddin();
  await buildOnlyOffice();
  console.log("build terminé — Excel : " + bundles.map(b => "dist/addin/" + b).join(", "));
  console.log("build terminé — ONLYOFFICE : dist/onlyoffice (dist/sankey-studio.plugin)");
}

