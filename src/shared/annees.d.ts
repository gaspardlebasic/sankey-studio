/**
 * Types de la dimension année (src/shared/annees.js).
 * CommonJS pour Node et esbuild ; ce fichier donne les types à TypeScript.
 */

export interface LienDate {
  source: string;
  target: string;
  annee?: string | number | null;
}

/** L'année d'une cellule du classeur, ou "" pour une case vide. */
export function anneeDepuisCellule(v: unknown): string;

/** L'année d'un lien, ou "". */
export function anneeDeLien(l: { annee?: string | number | null } | null | undefined): string;

/** Comparaison de deux libellés d'année (numérique si possible). */
export function comparerAnnee(a: string, b: string): number;

/** Les années distinctes, de la plus ancienne à la plus récente. */
export function anneesDistinctes(liens: LienDate[]): string[];

/** L'année par défaut : la plus récente, ou "". */
export function anneeParDefaut(annees: string[]): string;

/** Clé d'une ligne de lien (couple + année). */
export function cleLienAnnee(source: string, target: string, annee?: string | null): string;

/**
 * Les liens à dessiner pour une année : les lignes datées de cette année, plus
 * les lignes sans année quand le couple n'a pas de ligne datée.
 */
export function liensPourAnnee<T extends LienDate>(liens: T[], annee: string): T[];
