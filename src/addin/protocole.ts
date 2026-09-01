/**
 * Le tunnel entre le volet et la fenêtre d'édition (phase 4 du PLAN-COMPLEMENT-EXCEL).
 *
 * POURQUOI il existe. Une fenêtre de dialogue Office est aveugle : elle ne
 * dispose que de `messageParent` et `isSetSupported` — ni `Excel.run`, ni
 * `document.settings`. Le volet garde donc Office.js et devient **courtier** ;
 * la fenêtre, qui héberge l'éditeur, lui passe commande.
 *
 * CE QUI TRAVERSE, et c'est peu : cinq méthodes du contrat `window.desktop`
 * (`readExcel`, `writeExcel`, `excelFormulas`, `lireApparence`,
 * `ecrireApparence`), un évènement (« le classeur a changé ») et une poignée de
 * main. Tout le reste — presse-papier, export d'image, constantes de verrou —
 * reste local à la fenêtre : ces méthodes-là n'ont jamais eu besoin d'Excel.
 *
 * TROIS CONTRAINTES portées ici, et nulle part ailleurs :
 *
 *  - **Tout est chaîne de caractères.** `messageParent`/`messageChild` ne
 *    transportent que du texte, et aucune limite de taille n'est documentée par
 *    Microsoft. Le modèle d'un vrai classeur pèse ~34 Ko par aller-retour :
 *    c'est mesurable (`tests/fenetre-essai.html`) et c'est à surveiller.
 *  - **Deux contextes séparés**, donc deux caches, donc une **dérive de version**
 *    possible (volet en N, fenêtre encore en N-1). D'où `VERSION_PROTOCOLE` et
 *    le message `desaccord` : mieux vaut un refus clair qu'un comportement
 *    inexplicable.
 *  - **Rien ne garantit l'ordre d'amorçage.** La fenêtre redit « bonjour » tant
 *    que le volet n'a pas répondu.
 *
 * Ce module ne connaît ni Office ni le DOM : il reçoit une fonction d'envoi et
 * des chaînes reçues. C'est ce qui le rend éprouvable sans Excel
 * (`tests/addin-protocole.test.js`), comme `synchro.ts` avant lui.
 */

/** À incrémenter dès que la forme des messages change. Cf. `desaccord`. */
export const VERSION_PROTOCOLE = 1;

/** Marque nos messages : le canal peut en porter d'autres (essais, hôte). */
export const MARQUE = "sankey";

/** Au-delà, un appel est perdu. Une écriture coûte 12 ms : c'est large. */
export const DELAI_APPEL = 20000;

/** Rythme des « bonjour » répétés tant que le volet n'a pas répondu. */
export const DELAI_BONJOUR = 800;

/** Ce que le volet dit de lui-même à l'ouverture de la fenêtre. */
export interface Accueil {
    /** Les capacités de la coquille, telles que `caps()` les attend. */
    capacites: Record<string, boolean>;
    nomClasseur: string;
    /** `Table.onChanged` est-il disponible (ExcelApi 1.7) ? */
    evenements: boolean;
}

/** Le corps d'un message, sans l'enveloppe `p`/`v` que `ecrire` ajoute. */
type Corps =
    | { t: "bonjour" }
    | { t: "accueil"; accueil: Accueil }
    | { t: "appel"; id: number; m: string; a: unknown[] }
    | { t: "reponse"; id: number; r?: unknown; e?: string }
    | { t: "pousse"; n: string }
    /** `sienne` : la version du protocole de l'expéditeur du refus. */
    | { t: "desaccord"; sienne: number };

type Message = Corps & { p: string; v: number };

type Planifier = (fn: () => void, ms: number) => unknown;
type Annuler = (jeton: unknown) => void;

const PLANIFIER_DEFAUT: Planifier = (fn, ms) => setTimeout(fn, ms);
const ANNULER_DEFAUT: Annuler = j => clearTimeout(j as ReturnType<typeof setTimeout>);

/** N'accepte que nos messages, et jamais un texte mal formé. */
function lire(texte: string): Message | null {
    let o: any;
    try { o = JSON.parse(texte); } catch { return null; }
    if (!o || o.p !== MARQUE || typeof o.t !== "string") return null;
    return o as Message;
}

function ecrire(m: Corps): string {
    return JSON.stringify(Object.assign({ p: MARQUE, v: VERSION_PROTOCOLE }, m));
}

/* ------------------------- côté fenêtre (client) ------------------------- */

/**
 * Le mandataire vit dans la fenêtre d'édition : il passe commande au volet.
 * Il ne sait rien du canal — `envoyer` est `Office.context.ui.messageParent`
 * dans Excel, un `postMessage` sur le banc d'essai.
 */
export class Mandataire {
    private prochainId = 1;
    private attentes = new Map<number, {
        resoudre: (v: unknown) => void; rejeter: (e: Error) => void; minuteur: unknown;
    }>();
    private accueilli: ((a: Accueil) => void) | null = null;
    private jetonBonjour: unknown = null;
    private bonjourFini = false;
    private surPousseCb: ((nom: string) => void) | null = null;
    private surDesaccordCb: ((versionDuVolet: number) => void) | null = null;
    private rompu: string | null = null;

    constructor(
        private envoyer: (texte: string) => void,
        private delai: number = DELAI_APPEL,
        private planifier: Planifier = PLANIFIER_DEFAUT,
        private annuler: Annuler = ANNULER_DEFAUT
    ) {}

    /**
     * Se présente au volet et attend ses capacités. Le renderer les lit de
     * façon SYNCHRONE dès `createApp` (`editor.ts:caps`) : rien ne peut démarrer
     * avant cette réponse. Le « bonjour » est répété, car rien ne garantit que
     * le volet écoutait déjà quand la fenêtre a fini de charger.
     */
    bonjour(): Promise<Accueil> {
        return new Promise<Accueil>((resoudre, rejeter) => {
            const echeance = this.planifier(
                () => { this.arreterBonjour(); rejeter(new Error("le volet Excel n'a pas répondu")); },
                this.delai
            );
            this.accueilli = a => {
                this.annuler(echeance);
                this.arreterBonjour();
                resoudre(a);
            };
            // Le minuteur suivant est armé AVANT l'envoi : selon le canal, la
            // réponse peut revenir dans la foulée de `envoyer`, et il faut
            // qu'`arreterBonjour` trouve ce minuteur-là pour le désarmer.
            const redire = () => {
                if (this.bonjourFini) return;
                this.jetonBonjour = this.planifier(redire, DELAI_BONJOUR);
                this.envoyer(ecrire({ t: "bonjour" }));
            };
            redire();
        });
    }

    private arreterBonjour(): void {
        this.bonjourFini = true;
        if (this.jetonBonjour !== null) { this.annuler(this.jetonBonjour); this.jetonBonjour = null; }
        this.accueilli = null;
    }

    /** Un appel du contrat `window.desktop`, exécuté par le volet. */
    appeler(methode: string, ...args: unknown[]): Promise<unknown> {
        if (this.rompu) return Promise.reject(new Error(this.rompu));
        return new Promise((resoudre, rejeter) => {
            const id = this.prochainId++;
            const minuteur = this.planifier(() => {
                this.attentes.delete(id);
                rejeter(new Error(`le volet Excel n'a pas répondu (${methode})`));
            }, this.delai);
            this.attentes.set(id, { resoudre, rejeter, minuteur });
            this.envoyer(ecrire({ t: "appel", id, m: methode, a: args }));
        });
    }

    /** Le classeur a changé sous nos pieds (`Table.onChanged` côté volet). */
    surPousse(cb: (nom: string) => void): void { this.surPousseCb = cb; }

    /** Les deux pages ne sont pas de la même version : la fenêtre doit le dire. */
    surDesaccord(cb: (versionDuVolet: number) => void): void { this.surDesaccordCb = cb; }

    /** Un texte arrivé du volet. Tout ce qui n'est pas à nous est ignoré. */
    recevoir(texte: string): void {
        const m = lire(texte);
        if (!m) return;
        if (m.t === "desaccord") { this.rompre(m.sienne); return; }
        if (m.v !== VERSION_PROTOCOLE) { this.rompre(m.v); return; }
        if (m.t === "accueil") { if (this.accueilli) this.accueilli(m.accueil); return; }
        if (m.t === "pousse") { if (this.surPousseCb) this.surPousseCb(m.n); return; }
        if (m.t === "reponse") {
            const attente = this.attentes.get(m.id);
            if (!attente) return;                     // déjà expirée : rien à faire
            this.attentes.delete(m.id);
            this.annuler(attente.minuteur);
            if (m.e) attente.rejeter(new Error(m.e));
            else attente.resoudre(m.r);
        }
    }

    /**
     * Coupe le tunnel : plus rien ne partira, et les appels en vol échouent
     * tout de suite plutôt qu'au bout du délai de garde.
     */
    private rompre(versionDuVolet: number): void {
        if (this.rompu) return;
        this.rompu = "Le volet et la fenêtre d'édition ne sont pas de la même version "
            + `(volet ${versionDuVolet}, fenêtre ${VERSION_PROTOCOLE}) — referme la fenêtre `
            + "et rouvre-la depuis le volet.";
        this.arreterBonjour();
        for (const [, a] of this.attentes) { this.annuler(a.minuteur); a.rejeter(new Error(this.rompu)); }
        this.attentes.clear();
        if (this.surDesaccordCb) this.surDesaccordCb(versionDuVolet);
    }
}

/* ------------------------- côté volet (serveur) ------------------------- */

/**
 * Le courtier vit dans le volet : il exécute pour la fenêtre. `cible` est le
 * pont Office.js lui-même (`src/addin/pont.ts`) — le courtier ne connaît aucune
 * méthode par son nom, il ne fait que relayer ce que la fenêtre demande.
 */
export class Courtier {
    constructor(
        private envoyer: (texte: string) => void,
        private cible: Record<string, any>,
        private accueil: () => Accueil
    ) {}

    /** Un texte arrivé de la fenêtre. */
    recevoir(texte: string): void {
        const m = lire(texte);
        if (!m) return;
        if (m.v !== VERSION_PROTOCOLE) {
            this.envoyer(ecrire({ t: "desaccord", sienne: VERSION_PROTOCOLE }));
            return;
        }
        if (m.t === "bonjour") { this.envoyer(ecrire({ t: "accueil", accueil: this.accueil() })); return; }
        if (m.t === "appel") this.executer(m.id, m.m, m.a);
    }

    /** Prévient la fenêtre d'un changement venu d'Excel. */
    pousser(nom: string): void { this.envoyer(ecrire({ t: "pousse", n: nom })); }

    private async executer(id: number, methode: string, args: unknown[]): Promise<void> {
        const fn = this.cible[methode];
        if (typeof fn !== "function") {
            this.envoyer(ecrire({ t: "reponse", id, e: `méthode inconnue : ${methode}` }));
            return;
        }
        try {
            const r = await fn.apply(this.cible, args);
            this.envoyer(ecrire({ t: "reponse", id, r }));
        } catch (e) {
            this.envoyer(ecrire({ t: "reponse", id, e: (e as Error).message || String(e) }));
        }
    }
}
