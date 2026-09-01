/**
 * Pont Office.js — `window.desktop` tel que le VOLET le pose, au-dessus du
 * classeur ouvert. Le renderer (src/renderer/editor.ts) ne connaît que ce
 * contrat.
 *
 * Ce que le complément ne fait PAS, et pourquoi (PLAN §4) :
 *   - pas de verrou : le classeur est forcément ouvert, c'est la prémisse ;
 *   - pas de pilotage d'Excel : nous sommes DANS Excel ;
 *   - pas de choix de classeur : c'est celui qui est ouvert ;
 *   - pas de fichier projet : l'apparence vit dans le classeur (§5.2).
 * Rien de tout cela n'a de méthode ici — le renderer ne les demande pas.
 */

import {
  lireDiagramme, ecrireDiagramme, ecouterTableaux,
  type DonneesExcel, type EvenementTableau
} from "./excel-office.js";
import type { Modele } from "../shared/modele-excel.js";
import { FiltreEcho, AntiRebond } from "./synchro.js";

/** Clé de l'apparence dans le classeur (`document.settings`). */
const CLE_APPARENCE = "sankey-studio-apparence";

/** Anti-rebond de la synchro descendante : une salve de frappes = une relecture. */
const DELAI_RELECTURE = 300;

/** Le jeu d'exigences d'`onChanged`. Sondé, JAMAIS déclaré dans le manifeste. */
const JEU_EVENEMENTS: [string, string] = ["ExcelApi", "1.7"];

const filtre = new FiltreEcho();
let rappelChangement: (() => void) | null = null;

/**
 * Nom du classeur, pour l'afficher dans le panneau. `Workbook.name` exige
 * ExcelApi 1.7 ; l'URL du document est le repli — sur OneDrive c'est une
 * adresse SharePoint, dont seul le dernier segment nous intéresse.
 */
async function nomDuClasseur(): Promise<string> {
  try {
    return await Excel.run(async context => {
      const wb = context.workbook;
      wb.load("name");
      await context.sync();
      return wb.name || "Classeur Excel";
    });
  } catch {
    const url = (Office.context.document && Office.context.document.url) || "";
    const nom = decodeURIComponent(url.split("?")[0]).split(/[\\/]/).pop();
    return nom || "Classeur Excel";
  }
}

/** Un jeu d'exigences est-il là ? Sondé à l'exécution, jamais déclaré. */
export function supporte(jeu: [string, string]): boolean {
  try {
    return !!(Office.context.requirements &&
      Office.context.requirements.isSetSupported(jeu[0], jeu[1]));
  } catch {
    return false;
  }
}

/* --------------------------- apparence --------------------------- */

/**
 * L'apparence (options, couloirs nommés, filières masquées, surcharges de
 * couleur) voyage DANS le classeur : le diagramme suit le fichier, sans
 * deuxième fichier à gérer. Le modèle, lui, vient des tableaux — on ne le
 * duplique pas ici, sous peine de ressusciter des nœuds supprimés dans Excel.
 *
 * `saveAsync` ne range le réglage que dans le classeur EN MÉMOIRE : il n'atteint
 * le fichier qu'au prochain enregistrement par l'utilisatrice (mesuré en phase 0,
 * §F2). C'est dit dans l'interface.
 */
function lireApparence(): Promise<string | null> {
  return new Promise(resolve => {
    try {
      const reglages = Office.context.document && Office.context.document.settings;
      const v = reglages ? reglages.get(CLE_APPARENCE) : null;
      resolve(typeof v === "string" && v ? v : null);
    } catch {
      resolve(null);
    }
  });
}

function ecrireApparence(json: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise(resolve => {
    try {
      const reglages = Office.context.document && Office.context.document.settings;
      if (!reglages) { resolve({ ok: false, error: "document.settings indisponible" }); return; }
      reglages.set(CLE_APPARENCE, json);
      reglages.saveAsync(r => {
        resolve(r.status === Office.AsyncResultStatus.Succeeded
          ? { ok: true }
          : { ok: false, error: (r.error && r.error.message) || "échec de saveAsync" });
      });
    } catch (e) {
      resolve({ ok: false, error: (e as Error).message });
    }
  });
}

/* ----------------------------- le contrat ----------------------------- */

function construirePont(nomClasseur: string, evenements: boolean) {
  return {
    /**
     * Ce que cette coquille sait faire. `envoiAutomatique` est la seule
     * variation qui reste, et elle se SONDE (ExcelApi 1.7) : le renderer
     * demande la capacité, jamais la version d'Excel.
     */
    capacites: {
      excel: true,
      envoiAutomatique: evenements   // 12 ms l'écriture : à chaque modification
    },
    nomClasseur,

    async readExcel(): Promise<{ ok: boolean; live: boolean; data?: DonneesExcel; error?: string }> {
      try {
        const data = await lireDiagramme();
        if (!data) return { ok: false, live: true, error: "Tableaux du diagramme introuvables" };
        return { ok: true, live: true, data };
      } catch (e) {
        return { ok: false, live: true, error: (e as Error).message };
      }
    },

    async writeExcel(model: Modele, _chemin?: string | null, feuille?: string,
                     options?: { save?: boolean }) {
      try {
        // L'écriture est encadrée par le filtre : les onChanged qu'elle
        // déclenche ne doivent pas nous revenir comme une modification externe.
        const r = await filtre.pendantEcriture(() => ecrireDiagramme(model, feuille, options));
        return Object.assign({ live: true, path: nomClasseur }, r);
      } catch (e) {
        return { ok: false, live: true, error: (e as Error).message };
      }
    },

    /** Modifications faites DANS Excel. */
    onExcelChanged(cb: () => void) { rappelChangement = cb; },

    lireApparence,
    ecrireApparence
  };
}

/** Le contrat tel que cette coquille l'implémente — la cible du courtier. */
export type Pont = ReturnType<typeof construirePont>;

/* ------------------------------ montage ------------------------------ */

/**
 * Pose `window.desktop` puis branche l'écoute du classeur. À appeler APRÈS
 * `Office.onReady` et AVANT `createApp` : le renderer lit ses capacités dès
 * son démarrage.
 *
 * Le pont est aussi RENDU, parce qu'il a deux usages : l'éditeur du volet le
 * lit sur `window` (repli de compatibilité), et le courtier de la phase 4 le
 * relaie à la fenêtre d'édition (`src/addin/courtier-volet.ts`). Dans les deux
 * cas c'est le même objet : le classeur n'a qu'un seul accès.
 */
export async function installerPont(): Promise<{ pont: Pont; nomClasseur: string; evenements: boolean }> {
  const nomClasseur = await nomDuClasseur();
  const evenements = supporte(JEU_EVENEMENTS);
  const pont = construirePont(nomClasseur, evenements);
  (window as any).desktop = pont;

  if (evenements) {
    // Une salve de frappes ne provoque qu'une relecture ; nos propres écritures
    // sont écartées par le filtre d'écho.
    const relire = new AntiRebond(DELAI_RELECTURE, () => {
      if (rappelChangement) rappelChangement();
    });
    const r = await ecouterTableaux((e: EvenementTableau) => {
      if (filtre.accepter(e)) relire.declencher();
    });
    if (!r.ok) console.warn("Sankey Studio : " + (r.error || "écoute du classeur impossible"));
  } else {
    console.warn("Sankey Studio : ExcelApi 1.7 absent — pas de synchronisation " +
                 "automatique, utilise les boutons du panneau.");
  }
  return { pont, nomClasseur, evenements };
}

/**
 * Ouvre le volet aussi large qu'Excel l'autorise — 50 % de sa fenêtre, soit
 * 755 px sur le poste d'essai contre 350 px par défaut (RESULTATS-PHASE-0 §G).
 * Le confort de la largeur obtenue est l'objet de la phase 4.
 */
export async function elargirVolet(): Promise<number> {
  const api = (Office as any).extensionLifeCycle && (Office as any).extensionLifeCycle.taskpane;
  if (!api || typeof api.setWidth !== "function") return window.innerWidth;
  // Hors bornes, setWidth n'a AUCUN effet et ne lève rien (doc MS) : on descend
  // par paliers jusqu'à ce que la largeur bouge vraiment. Le volet met un
  // moment à s'élargir : sans l'attente, on lirait toujours l'ancienne largeur.
  const paliers = [Math.round(screen.availWidth * 0.5), Math.round(screen.availWidth * 0.4), 900, 700];
  for (const px of paliers) {
    const avant = window.innerWidth;
    try { api.setWidth(px); } catch { return window.innerWidth; }
    await new Promise(r => setTimeout(r, 400));
    if (window.innerWidth > avant + 20) break;
  }
  return window.innerWidth;
}
