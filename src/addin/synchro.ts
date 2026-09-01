/**
 * Rythme de la synchronisation évènementielle (phase 3 du PLAN-COMPLEMENT-EXCEL).
 *
 * Deux mécanismes, volontairement séparés de Office.js pour être éprouvables
 * sans Excel (tests/addin-synchro.test.js) :
 *
 *  - **L'auto-écho.** Écrire dans le classeur déclenche `Table.onChanged`. Sans
 *    filtre, notre propre écriture nous revient, provoque une relecture, qui
 *    marque le modèle comme changé, qui réécrit… C'est l'équivalent du
 *    en deux signaux plutôt qu'un :
 *    Excel nous dit lui-même qu'il s'agit de notre écriture
 *    (`triggerSource === "ThisLocalAddin"`), et à défaut on ignore ce qui
 *    arrive juste après une écriture.
 *  - **L'anti-rebond.** Une salve de frappes ne doit provoquer qu'une relecture,
 *    comme le `notifyTimer` de `main.js`.
 */

/** Ce qu'Excel dit d'un `onChanged` — seul `triggerSource` nous intéresse. */
export interface EvenementClasseur {
  triggerSource?: string;
  source?: string;
  address?: string;
}

/** Valeur d'`Excel.EventTriggerSource` qui désigne NOTRE complément. */
export const DECLENCHEUR_NOUS = "ThisLocalAddin";

/**
 * Fenêtre pendant laquelle un évènement qui suit notre écriture est tenu pour
 * un écho. Généreuse à dessein : une écriture coûte 12 ms, un faux positif ne
 * coûte qu'une relecture manquée — et la modification suivante la rattrape —
 * tandis qu'un faux négatif fait boucler la synchro.
 */
export const FENETRE_ECHO = 1200;

export class FiltreEcho {
  private enVol = 0;
  private finEcriture = -Infinity;

  constructor(
    private fenetre: number = FENETRE_ECHO,
    private maintenant: () => number = Date.now
  ) {}

  /** À encadrer toute écriture vers le classeur. */
  debut(): void { this.enVol++; }
  fin(): void {
    if (this.enVol > 0) this.enVol--;
    this.finEcriture = this.maintenant();
  }

  /** Enveloppe `debut`/`fin` autour d'une écriture, même en cas d'échec. */
  async pendantEcriture<T>(action: () => Promise<T>): Promise<T> {
    this.debut();
    try { return await action(); } finally { this.fin(); }
  }

  /** Faut-il tenir compte de cet évènement, ou est-ce notre propre écriture ? */
  accepter(e?: EvenementClasseur): boolean {
    if (this.enVol > 0) return false;                       // écriture en cours
    if (e && e.triggerSource === DECLENCHEUR_NOUS) return false;  // Excel le dit
    return this.maintenant() - this.finEcriture > this.fenetre;
  }
}

/**
 * Regroupe les appels rapprochés en un seul, `delai` après le dernier.
 * `planifier`/`annuler` sont injectables pour les tests.
 */
export class AntiRebond {
  private jeton: unknown = null;

  constructor(
    private delai: number,
    private action: () => void,
    private planifier: (fn: () => void, ms: number) => unknown =
      (fn, ms) => setTimeout(fn, ms),
    private annuler: (jeton: unknown) => void =
      j => clearTimeout(j as ReturnType<typeof setTimeout>)
  ) {}

  declencher(): void {
    this.arreter();
    this.jeton = this.planifier(() => { this.jeton = null; this.action(); }, this.delai);
  }

  arreter(): void {
    if (this.jeton !== null) { this.annuler(this.jeton); this.jeton = null; }
  }

  get enAttente(): boolean { return this.jeton !== null; }
}
