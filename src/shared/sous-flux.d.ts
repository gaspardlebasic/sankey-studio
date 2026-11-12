import type { FlowModel } from "../renderer/types";

/** Ce qui passe d'un lien par le nœud visé : le flux retenu et sa fraction du lien. */
export interface Retenu {
    valeur: number;
    part: number;
}

export function cleLien(source: string, target: string): string;
export function sousFlux(model: FlowModel, focus: string): Map<string, Retenu>;
export function filtrerSousFlux(model: FlowModel, focus: string): FlowModel;
export function filtrerChaine(model: FlowModel, chaine: string[]): FlowModel;
