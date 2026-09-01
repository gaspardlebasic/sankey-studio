import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "fs";

const watch = process.argv.includes("--watch");

/*
 * Deux cibles, un seul renderer (PLAN-COMPLEMENT-EXCEL §2) :
 *   dist/renderer  application Electron   — entrée src/renderer/index.ts
 *   dist/addin     volet Excel            — entrée src/addin/index.ts
 * La seconde ajoute le pont Office.js autour du MÊME code d'édition.
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
