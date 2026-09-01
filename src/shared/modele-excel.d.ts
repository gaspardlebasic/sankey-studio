/**
 * Types du schéma partagé (src/shared/modele-excel.js).
 * Le module est en CommonJS pour être chargeable par Node ET par esbuild ;
 * ce fichier lui donne des types côté TypeScript.
 */

export type NodeKind = "produit" | "industrie";

/** Une cellule telle que buildModelRows la produit. */
export type Cellule =
  | { t: "s"; v: string }
  | { t: "n"; v: number }
  | { t: "f"; f: string; v: number };

export interface NoeudModele {
  id: string; name: string; column: number; title?: string; order?: number;
  lane?: number; kind?: NodeKind; filiere?: string; color?: string | null;
}
export interface LienModele {
  source: string; target: string; value: number; unit?: string;
}
export interface Modele { nodes: NoeudModele[]; links: LienModele[]; }

export const NODE_COLS: string[];
export const LINK_COLS: string[];
export const NODE_START: number;
export const GAP: number;
export const LINK_START: number;
export const TYPE_LABELS: { produit: string; industrie: string };

export function toInt(v: unknown, dflt: number): number;
export function toNum(v: unknown, dflt: number): number;
export function couloirDe(n: unknown): number;
export function typeDe(n: unknown): string;
export function typeDepuisTexte(v: unknown): NodeKind;
export function comparerTexte(a: unknown, b: unknown): number;
export function comparerPlacement(a: unknown, b: unknown): number;
export function filiereDuLien(sNode: unknown, tNode: unknown): string;

/**
 * formulaMap : formules « Valeur du flux » à préserver, indexées
 * `id:<IDorigine> <IDdestination>` puis `name:<Origine> <Destination>`,
 * SANS le « = » initial (convention du <f> du XML).
 */
export function buildModelRows(
  model: Modele,
  formulaMap?: Map<string, string> | null
): { nodeRows: Cellule[][]; linkRows: Cellule[][] };
