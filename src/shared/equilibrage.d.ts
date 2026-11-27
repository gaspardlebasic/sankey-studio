/**
 * Types du module partagé src/shared/equilibrage.js (équilibrage des nœuds).
 */

import type { FlowLink, FlowModel } from "../renderer/types";

/** Un lien à équilibrer : une valeur, une unité, et le drapeau « inconnue ». */
export interface LienEquilibrable {
  source: string;
  target: string;
  value: number;
  unit?: string;
  /** La valeur est absente du classeur (case « Valeur du flux » vide). */
  inconnue?: boolean;
  /** La valeur affichée a été déduite de l'équilibre du nœud. */
  calculee?: boolean;
}

/** Ce que l'équilibrage dit d'un nœud. */
export interface EtatNoeudEquilibre {
  id: string;
  inconnuesEntrantes: number;
  inconnuesSortantes: number;
  inconnues: number;
  etat: "aucune" | "resolue" | "indeterminee" | "boucle" | "unites" | "desequilibre" | "isole" | "conflit";
  /** Valeur déduite pour l'unique inconnue, quand elle l'est. */
  valeur?: number;
}

export interface ResumeEquilibrage {
  /** Nœuds qui touchent au moins une inconnue. */
  noeuds: number;
  /** Flux distincts dont la valeur manque (un lien touché par ses deux bouts ne compte qu'une fois). */
  inconnues: number;
  /** Inconnues déduites par l'équilibre entrées = sorties. */
  resolues: number;
  /** Nœuds qui gardent une inconnue non déduite. */
  indeterminees: number;
}

export interface ResultatEquilibrage<M> {
  /** Le modèle, avec les valeurs déduites (le modèle reçu n'est pas modifié). */
  model: M;
  noeuds: EtatNoeudEquilibre[];
  resume: ResumeEquilibrage;
}

export function resoudreEquilibrage<M extends { nodes: { id: string }[]; links: LienEquilibrable[] }>(
  model: M
): ResultatEquilibrage<M>;

export function estInconnue(l: { inconnue?: boolean } | null | undefined): boolean;

/** Le type du modèle d'édition, pour les appelants TypeScript. */
export type ModeleEquilibre = FlowModel;
export type LienEquilibre = FlowLink;
