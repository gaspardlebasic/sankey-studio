import type { Cellule, FormulePreservee, Modele, NodeKind } from "../shared/modele-excel.js";

export interface NoeudExcel {
  id: string | null;
  name: string;
  column: number;
  title: string;
  order: number;
  lane: number;
  kind: NodeKind;
  filiere: string;
  color: string | null;
}

export interface LienExcel {
  sourceId: string | null;
  targetId: string | null;
  sourceName: string;
  targetName: string;
  value: number;
  unit: string;
  bio: number;
}

export interface ColonnesManquantes {
  noeuds: string[];
  liens: string[];
}

export interface DonneesExcel {
  nodes: NoeudExcel[];
  links: LienExcel[];
  hasLane?: boolean;
  hasKind?: boolean;
  hasBio?: boolean;
  sheetName?: string;
  colonnesManquantes?: ColonnesManquantes;
}

export interface ResultatAjoutColonnes {
  ok: boolean;
  message?: string;
  colonnesAjoutees?: ColonnesManquantes;
}

export interface OptionsEcriture {
  save?: boolean;
}

export interface ResultatEcriture {
  ok: boolean;
  remplissage?: {
    ecrasementFormule?: boolean;
    valeurEcrasee?: boolean;
  };
  error?: string;
}

export interface Initialisation {
  ok: boolean;
  statut: "cree" | "deja_la" | "feuille_non_vide" | "erreur";
  message?: string;
}

/** Types pour l'environnement ONLYOFFICE Plugin SDK. */
declare global {
  interface Window {
    Asc?: {
      plugin?: {
        init?: () => void;
        button?: (id: number) => void;
        callCommand?: (
          func: () => any,
          isClose?: boolean,
          isAnimate?: boolean,
          callback?: (returnValue: any) => void
        ) => void;
        executeMethod?: (methodName: string, args?: any[], callback?: (ret: any) => void) => void;
        executeCommand?: (command: string, params?: string) => void;
        attachEvent?: (event: string, fn: (...args: any[]) => void) => void;
        detachEvent?: (event: string) => void;
        info?: Record<string, any>;
      };
      scope?: Record<string, any>;
    };
  }
}
