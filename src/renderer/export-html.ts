// Export HTML interactif (PLAN-AGREGATION.md, étape 4) : une page AUTONOME —
// données, visionneuse et polices dedans —, lisible hors ligne et sans Excel.
//
// La visionneuse (src/visionneuse) est construite à part par build.mjs et
// gravée ici comme texte (__VISIONNEUSE__) : l'éditeur n'a qu'à la recopier.

declare const __VISIONNEUSE__: string;

/** Le code de la visionneuse, ou "" si le build ne l'a pas gravé. */
export const CODE_VISIONNEUSE: string =
    typeof __VISIONNEUSE__ === "string" ? __VISIONNEUSE__ : "";

/** Une graisse de Source Sans Pro, embarquée en base64. */
export interface PoliceEmbarquee { weight: number; base64: string; }

/** Fichiers de src/renderer/fonts, par graisse. */
export const FICHIERS_POLICE: Record<number, string> = {
    300: "SourceSansPro-Light.otf",
    400: "SourceSansPro-Regular.otf",
    600: "SourceSansPro-Semibold.otf",
    700: "SourceSansPro-Bold.otf"
};

/**
 * Les graisses que le diagramme emploie, ramenées à celles qu'on a en
 * fichier. La Regular toujours : c'est celle qu'on prend quand rien n'est dit.
 * Embarquer les quatre coûterait ~1,2 Mo pour rien quand deux suffisent.
 */
export function graissesEmployees(optionsJson: string): number[] {
    const out = new Set<number>([400]);
    const re = /"weight"\s*:\s*(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(optionsJson))) {
        const w = Number(m[1]);
        out.add(w <= 350 ? 300 : w < 550 ? 400 : w < 650 ? 600 : 700);
    }
    if (/"bold"\s*:\s*true/.test(optionsJson)) out.add(700);
    return Array.from(out).sort((a, b) => a - b);
}

/** Échappe un texte pour un contenu d'élément HTML. */
function echapper(t: string): string {
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * La page. Le JSON est rendu inoffensif dans un `<script>` (aucun `<` brut :
 * un nom de nœud « </script> » fermerait la balise), et le code aussi.
 */
export function pageInteractive(o: {
    titre: string; donnees: unknown; code: string; polices: PoliceEmbarquee[];
}): string {
    const json = JSON.stringify(o.donnees).replace(/</g, "\\u003c");
    const code = o.code.replace(/<\/script/gi, "<\\/script");
    const faces = o.polices.map(p =>
        `@font-face { font-family: "Source Sans Pro"; font-weight: ${p.weight}; ` +
        `src: url(data:font/otf;base64,${p.base64}) format("opentype"); }`).join("\n");
    return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Sankey Studio">
<title>${echapper(o.titre)}</title>
<style>
${faces}
html, body { margin: 0; height: 100%; background: #ffffff; color: #1a1a1a;
  font-family: "Source Sans Pro", system-ui, -apple-system, Helvetica, Arial, sans-serif; }
body { display: flex; flex-direction: column; }
header { display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 10px 16px; border-bottom: 1px solid #d9d9d9; }
h1 { font-size: 17px; font-weight: 600; margin: 0; flex: 1 1 auto; }
#niveaux { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 600; }
#niveaux[hidden] { display: none; }
#niveaux span { margin-right: 4px; }
#niveaux button { font: inherit; min-width: 30px; padding: 5px 9px; border: 2px solid #1a1a1a;
  background: #ffffff; color: #1a1a1a; cursor: pointer; }
#niveaux button.actif, #niveaux button:hover { background: #1a1a1a; color: #ffffff; }
.aide { font-size: 12px; color: #6b6b6b; }
#zone { flex: 1 1 auto; min-height: 0; position: relative; }
#diagramme { position: absolute; inset: 0; display: block; }
.bouton-depliage { cursor: pointer; }
.bouton-depliage:hover circle, .bouton-depliage:focus-visible circle { fill: #ececec; }
.bouton-depliage:focus { outline: none; }
</style>
</head>
<body>
<header>
  <h1>${echapper(o.titre)}</h1>
  <span id="niveaux" hidden></span>
  <span class="aide">⊕ déplier · ⊖ replier · survol : valeurs</span>
</header>
<div id="zone"><svg id="diagramme" xmlns="http://www.w3.org/2000/svg"></svg></div>
<script type="application/json" id="sankey-donnees">${json}</script>
<script>${code}</script>
</body>
</html>
`;
}
