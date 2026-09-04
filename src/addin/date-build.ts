/**
 * Date de construction du complément — celle du bundle qu'Excel fait tourner.
 *
 * Pourquoi elle est affichée : les bundles JS portent une empreinte dans leur
 * nom et se rechargent seuls, mais **les pages HTML, les styles et le
 * manifeste, non** — Excel peut servir l'ancienne page longtemps après une
 * publication (cf. `npm run excel:cache`). Sans repère visible, « ma
 * correction n'est pas là » et « Excel me sert une vieille page » se
 * ressemblent trait pour trait. La date, elle, tranche.
 *
 * Elle est GRAVÉE À LA CONSTRUCTION par `build.mjs` (`define` d'esbuild) : rien
 * ne la lit à l'exécution, il n'y a donc ni requête ni fichier à tenir à jour.
 */

/** Remplacé par une chaîne littérale au moment du bundle. */
declare const __DATE_BUILD__: string;

/**
 * Instant de la construction, en ISO 8601 — ou `""` si le bundle a été fabriqué
 * sans la gravure (un banc, un test qui compile un module isolé). `typeof` et
 * non un accès direct : une variable non déclarée lèverait.
 */
export const DATE_BUILD: string =
  typeof __DATE_BUILD__ === "string" ? __DATE_BUILD__ : "";

/**
 * La même date, telle qu'on la lit dans le volet : « 4 septembre 2026 à 15:32 ».
 *
 * Rendue dans le fuseau du poste, ce qui est bien ce qu'on veut : la question
 * posée est « est-ce que c'est la version d'après ma publication ? », et elle se
 * répond à l'heure de celle qui regarde. Une date illisible ou absente rend
 * `""` — l'appelant montre alors autre chose, plutôt qu'un « Invalid Date ».
 */
export function dateBuildLisible(iso: string = DATE_BUILD): string {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return "";
  const d = new Date(t);
  // Options explicites plutôt que `dateStyle`/`timeStyle` : les webviews
  // d'Office ne sont pas toutes récentes, et un style inconnu lève.
  const jour = d.toLocaleDateString("fr-FR",
    { day: "numeric", month: "long", year: "numeric" });
  const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${jour} à ${heure}`;
}
