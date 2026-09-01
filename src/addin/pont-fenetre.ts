/**
 * `window.desktop` vu depuis la FENÊTRE D'ÉDITION (phase 4).
 *
 * C'est la troisième implémentation du même contrat, après `src/main/preload.js`
 * (Electron) et `src/addin/pont.ts` (volet Excel) — et de loin la plus mince :
 * une fenêtre de dialogue Office n'a pas `Excel.run`, donc tout ce qui touche au
 * classeur est passé au volet par le tunnel (`protocole.ts`). Le reste est fait
 * sur place, parce qu'il n'a jamais eu besoin d'Excel.
 *
 * DEUX PRÉCAUTIONS qui n'ont pas d'équivalent dans les deux autres ponts :
 *
 *  - **Aucune méthode ne lève.** Un tunnel peut expirer, ce qu'un appel direct
 *    à Office.js ne fait jamais. Chaque méthode rend donc la forme d'échec que
 *    le renderer sait déjà lire (`{ ok: false, error }`), au lieu de rejeter :
 *    l'éditeur affiche une erreur, il ne casse pas.
 *  - **Les capacités arrivent AVANT la construction.** Le renderer les lit de
 *    façon synchrone dès `createApp` ; elles viennent de la poignée de main,
 *    et c'est pourquoi `installerPontFenetre` est attendu avant lui.
 */

import { Mandataire, type Accueil } from "./protocole.js";
import { copierPressePapier } from "./navigateur.js";
import type { Modele } from "../shared/modele-excel.js";

/** Le rappel du renderer pour « le classeur a changé ». */
let rappelChangement: (() => void) | null = null;

/**
 * Passe un appel au volet et, s'il échoue, rend `secours` — la forme d'échec
 * attendue par l'appelant, avec le motif dedans.
 */
async function tunnel<T extends Record<string, unknown>>(
  mandataire: Mandataire, methode: string, args: unknown[], secours: T
): Promise<T> {
  try {
    return await mandataire.appeler(methode, ...args) as T;
  } catch (e) {
    return Object.assign({}, secours, { error: (e as Error).message }) as T;
  }
}

function construirePontFenetre(mandataire: Mandataire, accueil: Accueil) {
  return {
    isElectron: false,
    // Telles que le volet les a déclarées : c'est lui qui sait ce qu'Excel
    // permet ici (`envoiAutomatique` dépend d'ExcelApi 1.7, sondé là-bas).
    capacites: accueil.capacites,
    nomClasseur: accueil.nomClasseur,
    canControlExcel: false,

    readExcel: () => tunnel(mandataire, "readExcel", [],
      { ok: false, live: true } as { ok: boolean; live: boolean; data?: unknown; error?: string }),

    writeExcel: (model: Modele, chemin?: string | null, feuille?: string,
                 options?: { save?: boolean }) =>
      tunnel(mandataire, "writeExcel", [model, chemin ?? null, feuille, options],
        { ok: false, live: true } as { ok: boolean; live: boolean; error?: string }),

    excelFormulas: () => tunnel(mandataire, "excelFormulas", [],
      { ok: false, formules: {} } as { ok: boolean; formules: Record<string, string>; error?: string }),

    // Le classeur est ouvert par construction : rien ne traverse pour ça.
    async isExcelLocked() { return { locked: false, live: true, mode: "complement" }; },
    async watchExcel() { return { locked: false, live: true, mode: "complement" }; },
    async closeExcelWorkbook() { return { locked: false, state: "closed" }; },

    /** Le volet nous pousse l'évènement ; ici on ne fait que le retenir. */
    onExcelChanged(cb: () => void) { rappelChangement = cb; },

    // Sur place : la fenêtre est un contexte de navigateur ordinaire, et elle a
    // le focus — le presse-papier y marche mieux que dans le volet.
    copyToClipboard: copierPressePapier,

    async lireApparence(): Promise<string | null> {
      try { return await mandataire.appeler("lireApparence") as string | null; }
      catch { return null; }                    // pas d'apparence ≠ échec fatal
    },

    ecrireApparence: (json: string) => tunnel(mandataire, "ecrireApparence", [json],
      { ok: false } as { ok: boolean; error?: string })
  };
}

/**
 * Poignée de main, puis `window.desktop`. À appeler après `Office.onReady` et
 * AVANT `createApp` — même règle d'ordre que dans le volet, pour la même
 * raison : les capacités sont lues au démarrage du renderer.
 */
export async function installerPontFenetre(mandataire: Mandataire): Promise<Accueil> {
  const accueil = await mandataire.bonjour();
  (window as any).desktop = construirePontFenetre(mandataire, accueil);
  mandataire.surPousse(nom => {
    if (nom === "excel" && rappelChangement) rappelChangement();
  });
  return accueil;
}
