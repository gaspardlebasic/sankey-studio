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

const commun = {
  bundle: true,
  platform: "browser",
  format: "iife",
  sourcemap: true,
  target: "es2019",
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

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  copyStatic();
  // Le complément n'est pas surveillé : il se sert par HTTPS (npm run addin:serve)
  // et sa page doit de toute façon être rechargée dans Excel.
  await buildAddin();
  console.log("esbuild: watching…");
} else {
  await esbuild.build(options);
  copyStatic();
  const bundles = await buildAddin();
  console.log("build terminé — complément : " + bundles.map(b => "dist/addin/" + b).join(", "));
}
