/**
 * Le volet en mode COURTIER (phase 4 du PLAN-COMPLEMENT-EXCEL).
 *
 * L'éditeur ne tient pas dans un volet : mesuré en phase 0 (§G), un diagramme
 * réel fait 1 362 px de large en mode Édition, et le volet plafonne à 755 px sur
 * le poste d'essai — la moitié du diagramme, pour une activité qui consiste à
 * faire glisser des nœuds d'une colonne à l'autre. L'éditeur vit donc dans une
 * **fenêtre d'édition** (Dialog API, jusqu'à 99,5 % de l'écran, non modale), et
 * le volet garde ce qu'elle ne peut pas avoir : Office.js et le classeur.
 *
 * CE MODULE tient les deux choses que ce choix impose :
 *
 *  - **Le cycle de vie de la fenêtre.** Office n'en autorise qu'UNE à la fois,
 *    elle meurt avec le volet, et sur Excel pour le web elle doit naître d'un
 *    clic. D'où le bouton, et le retour à l'état « fermée » plutôt qu'un échec.
 *  - **Le relais.** Tout ce que la fenêtre demande est exécuté ici, sur le pont
 *    Office.js, et les changements venus d'Excel lui sont poussés.
 *
 * Ce que le volet N'AFFICHE PLUS : l'éditeur. Il affiche l'état, et un bouton.
 */

import { Courtier, type Accueil } from "./protocole.js";
import type { Pont } from "./pont.js";

/** `messageChild` (volet → fenêtre) est en 1.2. Sans lui, pas de tunnel. */
export const JEU_FENETRE: [string, string] = ["DialogApi", "1.2"];

/** Part de l'écran prise par la fenêtre. Office plafonne à 99,5 %. */
const TAILLE = 98;

/** Où en est la fenêtre d'édition, pour ce que le volet en dit. */
export type Etat = "fermee" | "ouverture" | "ouverte" | "erreur";

export interface Reglages {
  pont: Pont;
  accueil: () => Accueil;
  /** Appelé à chaque changement d'état, avec un motif quand il y en a un. */
  surEtat: (etat: Etat, motif?: string) => void;
}

/**
 * Ce qu'Office rend à `displayDialogAsync`. Les typings d'office-js décrivent
 * `Dialog`, mais pas les évènements comme on les reçoit : on reste explicite.
 */
interface Fenetre {
  addEventHandler(t: unknown, h: (arg: any) => void): void;
  messageChild(texte: string): void;
  close(): void;
}

/** Le message d'Office pour les codes d'erreur qu'on peut rencontrer. */
function motifOffice(code: number | undefined, defaut: string): string {
  switch (code) {
    case 12002: return "la fenêtre d'édition n'a pas pu charger sa page";
    case 12003: return "la page de la fenêtre doit être servie en HTTPS";
    case 12004: return "le domaine de la fenêtre n'est pas déclaré dans le manifeste";
    case 12005: return "la page de la fenêtre doit être servie en HTTPS";
    case 12007: return "une fenêtre d'édition est déjà ouverte";
    case 12009: return "Excel a bloqué l'ouverture — clique sur le bouton pour l'autoriser";
    default: return defaut;
  }
}

export class CourtierVolet {
  private fenetre: Fenetre | null = null;
  private courtier: Courtier | null = null;
  private etat: Etat = "fermee";

  constructor(private reglages: Reglages) {
    // Les changements venus d'Excel n'ont plus de destinataire dans le volet :
    // ils partent vers la fenêtre. Le rythme (anti-rebond, filtre d'auto-écho)
    // reste où il était, dans pont.ts — rien n'est dupliqué ici.
    reglages.pont.onExcelChanged(() => {
      if (this.courtier) this.courtier.pousser("excel");
    });
  }

  get ouverte(): boolean { return this.fenetre !== null; }

  /**
   * Ouvre la fenêtre d'édition. À appeler sur un clic : Excel pour le web
   * refuse une ouverture qui ne vient pas d'un geste de l'utilisatrice, et
   * l'essai automatique au démarrage n'est qu'un confort pour le bureau.
   */
  ouvrir(): void {
    if (this.fenetre) { this.poser("ouverte"); return; }
    // Deux clics rapprochés donneraient deux `displayDialogAsync`, donc un
    // 12007 (« une fenêtre est déjà ouverte ») sur le second.
    if (this.etat === "ouverture") return;
    this.poser("ouverture");
    // Même domaine que le volet, sous-domaine compris — Office l'exige, et
    // c'est ce qui rend l'adresse déductible plutôt que codée en dur.
    const url = new URL("fenetre.html", window.location.href).href;
    Office.context.ui.displayDialogAsync(
      url,
      { height: TAILLE, width: TAILLE, displayInIframe: false },
      (r: Office.AsyncResult<Office.Dialog>) => {
        if (r.status !== Office.AsyncResultStatus.Succeeded) {
          const code = r.error && (r.error.code as number);
          this.poser("erreur", motifOffice(code, (r.error && r.error.message) || "ouverture refusée"));
          return;
        }
        this.brancher(r.value as unknown as Fenetre);
      }
    );
  }

  /** Referme la fenêtre — depuis le volet, quand l'utilisatrice le demande. */
  fermer(): void {
    if (!this.fenetre) return;
    try { this.fenetre.close(); } catch { /* déjà partie */ }
    this.oublier();
  }

  private brancher(fenetre: Fenetre): void {
    this.fenetre = fenetre;
    // Le courtier relaie vers le pont : il ne connaît aucune méthode par son
    // nom, c'est la fenêtre qui demande ce dont l'éditeur a besoin.
    this.courtier = new Courtier(
      texte => { try { fenetre.messageChild(texte); } catch { /* fenêtre partie */ } },
      this.reglages.pont as unknown as Record<string, any>,
      this.reglages.accueil
    );
    fenetre.addEventHandler(Office.EventType.DialogMessageReceived, (arg: any) => {
      if (arg && typeof arg.message === "string" && this.courtier) this.courtier.recevoir(arg.message);
    });
    fenetre.addEventHandler(Office.EventType.DialogEventReceived, (arg: any) => {
      const code = arg && arg.error;
      // 12006 : l'utilisatrice a fermé la fenêtre. Ce n'est pas une erreur —
      // le modèle vit dans le classeur, rien n'est perdu, on peut rouvrir.
      this.oublier();
      if (code === 12006) this.poser("fermee");
      else this.poser("erreur", motifOffice(code, "la fenêtre d'édition s'est fermée"));
    });
    this.poser("ouverte");
  }

  private oublier(): void {
    this.fenetre = null;
    this.courtier = null;
  }

  private poser(etat: Etat, motif?: string): void {
    this.etat = etat;
    this.reglages.surEtat(etat, motif);
  }
}
