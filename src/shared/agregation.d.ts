/**
 * Types du module partagé src/shared/agregation.js (niveaux d'agrégation).
 */

import type { NoeudModele } from "./modele-excel.js";

export const PREFIXE_RESTE: string;
export const NOM_RESTE: string;

export interface LienAgregeable {
  id?: string; source: string; target: string; value: number;
  unit?: string; bio?: number;
}

export interface Hierarchie {
  parents: Map<string, string>;
  enfants: Map<string, string[]>;
  ascendants(id: string): string[];
  profondeur(id: string): number;
  descendDe(a: string, b: string): boolean;
}

export type NoeudAffiche<N> = N & {
  order: number;
  color: string | null;
  /** Le nœud a des enfants : il porte un ⊕ (replié). */
  depliable: boolean;
  /** Le parent déplié qui encadre ce nœud, ou null. */
  parentAffiche: string | null;
  /** Nœud « (non détaillé) », jamais écrit dans le classeur. */
  virtuel?: boolean;
};

export interface LienAffiche {
  id: string; source: string; target: string; value: number; unit: string; bio: number;
  /** Les liens du modèle dont une part propre se retrouve ici. */
  liens: (string | undefined)[];
}

export interface Incoherence<L> { lien: L; total: number; detail: number; }

export function hierarchie(nodes: NoeudModele[]): Hierarchie;
export function alignerSurParents<N extends NoeudModele>(nodes: N[]): N[];
export function projeter<N extends NoeudModele & { id: string }, L extends LienAgregeable>(
  model: { nodes: N[]; links: L[] },
  deplies: Set<string> | string[] | true | null | undefined
): { nodes: NoeudAffiche<N>[]; links: LienAffiche[]; incoherences: Incoherence<L>[] };
export function depliesAuNiveau(nodes: NoeudModele[], niveau: number): Set<string>;
export function nombreDeNiveaux(nodes: NoeudModele[]): number;
