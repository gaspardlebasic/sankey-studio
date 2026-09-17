/**
 * Pont ONLYOFFICE — expose `window.desktop` pour que le renderer (src/renderer/editor.ts)
 * fonctionne de manière transparente dans ONLYOFFICE Spreadsheet Editor.
 */

import {
  lireDiagramme, ecrireDiagramme, lireApparence, ecrireApparence,
  nomDuClasseur, ajouterColonnesManquantes
} from "./excel-onlyoffice";
import type { DonneesExcel, ResultatAjoutColonnes } from "./types";
import type { Modele } from "../shared/modele-excel.js";

export interface PontOnlyOffice {
  capacites: {
    excel: boolean;
    envoiAutomatique: boolean;
  };
  nomClasseur: string;
  readExcel: (chemin?: string | null) => Promise<{ ok: boolean; live: boolean; data?: DonneesExcel; error?: string }>;
  writeExcel: (
    model: Modele,
    _chemin?: string | null,
    feuille?: string,
    options?: { save?: boolean }
  ) => Promise<{ ok: boolean; live: boolean; path: string; remplissage?: any; error?: string }>;
  onExcelChanged: (cb: () => void) => void;
  lireApparence: () => Promise<string | null>;
  ecrireApparence: (json: string) => Promise<{ ok: boolean; error?: string }>;
  ajouterColonnesManquantes: (feuille?: string) => Promise<ResultatAjoutColonnes>;
}

let rappelChangement: (() => void) | null = null;

export function construirePontOnlyOffice(nomFichier: string): PontOnlyOffice {
  return {
    capacites: {
      excel: true,
      envoiAutomatique: false
    },
    nomClasseur: nomFichier,

    async readExcel(_chemin?: string | null) {
      try {
        const data = await lireDiagramme();
        if (!data) {
          return { ok: false, live: true, error: "Tableaux du diagramme introuvables" };
        }
        return { ok: true, live: true, data };
      } catch (e) {
        return { ok: false, live: true, error: (e as Error).message };
      }
    },

    async writeExcel(model: Modele, _chemin?: string | null, feuille?: string, options?: { save?: boolean }) {
      try {
        const res = await ecrireDiagramme(model, feuille, options);
        return {
          ok: res.ok,
          live: true,
          path: nomFichier,
          remplissage: res.remplissage,
          error: res.error
        };
      } catch (e) {
        return { ok: false, live: true, path: nomFichier, error: (e as Error).message };
      }
    },

    onExcelChanged(cb: () => void) {
      rappelChangement = cb;
    },

    lireApparence,
    ecrireApparence,
    ajouterColonnesManquantes: (feuille?: string) => ajouterColonnesManquantes(feuille)
  };
}

/**
 * Monte `window.desktop` avec le pont ONLYOFFICE.
 */
export async function installerPontOnlyOffice(): Promise<{ pont: PontOnlyOffice; nomClasseur: string }> {
  const nomFichier = await nomDuClasseur();
  const pont = construirePontOnlyOffice(nomFichier);
  (window as any).desktop = pont;
  return { pont, nomClasseur: nomFichier };
}
