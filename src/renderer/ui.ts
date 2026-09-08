/**
 * Briques d'interface partagées : surcouches ancrées sur un bouton — sélecteur
 * de couleurs (grille type Word/Excel, une teinte par colonne et les nuances en
 * lignes) et petit menu de choix (la taille d'un export, par exemple).
 *
 * Les deux partagent la même coquille (`ouvrirSurcouche`) : le voile qui ferme
 * au clic dehors, Échap, le replacement au redimensionnement, et une seule
 * surcouche ouverte à la fois.
 */

/* --------------------------- couleurs de base --------------------------- */

export interface Hue {
    name: string;
    light: string;
    dark: string;
}

/** Palette du design system : versions claires + foncées de chaque teinte. */
export const DESIGN_COLORS: Hue[] = [
    { name: "wheat", light: "#ffe141", dark: "#9e8c28" },
    { name: "peach", light: "#fdbd5d", dark: "#9d753a" },
    { name: "buckwheat", light: "#f18831", dark: "#95541e" },
    { name: "horse", light: "#b29654", dark: "#6e5d34" },
    { name: "concrete", light: "#6e7777", dark: "#444a4a" },
    { name: "pig", light: "#e794be", dark: "#8f5c76" },
    { name: "apple", light: "#e9465b", dark: "#902b38" },
    { name: "beef", light: "#ae3c4c", dark: "#6c252f" },
    { name: "oak", light: "#b97b79", dark: "#734c4b" },
    { name: "eggplant", light: "#a563a5", dark: "#663d66" },
    { name: "wine", light: "#7159a3", dark: "#463765" },
    { name: "fish", light: "#0074bd", dark: "#004875" },
    { name: "milk", light: "#00ace7", dark: "#006b8f" },
    { name: "algae", light: "#2dc5bd", dark: "#1c7a75" },
    { name: "forest", light: "#079264", dark: "#045b3e" },
    { name: "mint", light: "#7ddd8b", dark: "#4e8956" },
    { name: "field", light: "#adcb47", dark: "#6b7e2c" }
];

/** Neutres de la charte BASIC, présentés sur une ligne à part. */
export const NEUTRALS: string[] = [
    "#000000", "#3d3d3d", "#6b6b6b", "#8f8f8f",
    "#d4d4d4", "#ececec", "#f7f7f5", "#ffffff"
];

const SHADE_LABELS = [
    "très claire", "claire +", "claire (charte)",
    "intermédiaire", "foncée (charte)", "très foncée"
];

function toRgb(hex: string): [number, number, number] {
    const h = hex.replace("#", "");
    const f = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
    return [
        parseInt(f.slice(0, 2), 16) || 0,
        parseInt(f.slice(2, 4), 16) || 0,
        parseInt(f.slice(4, 6), 16) || 0
    ];
}
function toHexStr(rgb: [number, number, number]): string {
    return "#" + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}
/** Mélange `a` vers `b` : t = 0 → a, t = 1 → b. */
function mix(a: string, b: string, t: number): string {
    const A = toRgb(a);
    const B = toRgb(b);
    return toHexStr([
        A[0] + (B[0] - A[0]) * t,
        A[1] + (B[1] - A[1]) * t,
        A[2] + (B[2] - A[2]) * t
    ]);
}

/** Les 6 nuances d'une teinte, de la plus claire à la plus foncée. */
export function shadesOf(h: Hue): string[] {
    return [
        mix(h.light, "#ffffff", 0.72),
        mix(h.light, "#ffffff", 0.42),
        h.light,
        mix(h.light, h.dark, 0.5),
        h.dark,
        mix(h.dark, "#000000", 0.38)
    ];
}

/** Normalise une valeur saisie en #rrggbb (renvoie null si non reconnue). */
export function normalizeHex(v: string): string | null {
    const s = (v || "").trim();
    if (/^#?[0-9a-f]{6}$/i.test(s)) return ("#" + s.replace("#", "")).toLowerCase();
    if (/^#?[0-9a-f]{3}$/i.test(s)) {
        const h = s.replace("#", "");
        return ("#" + h.split("").map(c => c + c).join("")).toLowerCase();
    }
    return null;
}

/* -------------------------- sélecteur de couleurs ----------------------- */

export interface ColorPopoverOptions {
    /** Le bouton (ou la pastille SVG du canevas) sur lequel s'ancre la palette. */
    anchor: Element;
    value: string;
    label: string;
    /**
     * « sous » (défaut) : toujours sous le bouton, quitte à faire défiler le
     * volet — une palette ouverte vers le haut recouvrirait le champ qu'on est
     * en train de régler. « libre » : dessous, à côté ou au-dessus, là où il y
     * a la place, et sans rien faire défiler — c'est ce qu'il faut sur le
     * canevas, où défiler ferait glisser le nœud sous le curseur.
     */
    placement?: "sous" | "libre";
    /** Couleurs déjà employées dans le diagramme, proposées en premier. */
    usedColors?: string[];
    /** Appelé avant la première modification (pour l'historique undo). */
    onBeforeChange?: () => void;
    onPick: (hex: string) => void;
}

let closeCurrentPopover: (() => void) | null = null;

/**
 * Coquille commune à toutes les surcouches ancrées sur un bouton.
 *
 * Ce qui change d'une surcouche à l'autre, c'est ce qu'il y a dedans : `remplir`
 * reçoit la boîte à garnir et de quoi la fermer. Tout le reste — voile, Échap,
 * clic dehors, replacement, exclusion mutuelle — est le même partout, et le
 * dupliquer laisserait deux fermetures diverger sans qu'on le voie.
 *
 * Le garnissage a lieu AVANT la mise en page : le placement se décide sur la
 * taille réelle de la boîte, qu'une boîte vide ne donnerait pas.
 */
function ouvrirSurcouche(
    anchor: Element,
    classe: string,
    placement: "sous" | "libre",
    remplir: (pop: HTMLElement, fermer: () => void) => void
): void {
    if (closeCurrentPopover) closeCurrentPopover();

    const back = document.createElement("div");
    back.className = "cp-backdrop";
    const pop = document.createElement("div");
    pop.className = classe;
    pop.setAttribute("role", "dialog");

    remplir(pop, () => done());

    back.appendChild(pop);
    document.body.appendChild(back);
    const placer = () => (placement === "libre" ? placeLibre : place)(pop, anchor);
    placer();

    function done(): void {
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("resize", reposition);
        back.remove();
        retireCale();
        closeCurrentPopover = null;
    }
    const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") { e.stopPropagation(); done(); }
    };
    // L'ancre du canevas est refaite à chaque rendu : sans elle, ne rien bouger
    // plutôt que de renvoyer la surcouche dans un coin sur un rectangle vide.
    const reposition = () => { if (anchor.isConnected) placer(); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", reposition);
    back.addEventListener("mousedown", e => { if (e.target === back) done(); });
    closeCurrentPopover = done;
}

/** Une ligne d'un menu : son intitulé, une précision facultative, son action. */
export interface MenuItem {
    label: string;
    /** Seconde ligne, en petit — les dimensions d'un export, par exemple. */
    detail?: string;
    onPick: () => void;
}

export interface MenuPopoverOptions {
    anchor: Element;
    /** Titre du menu (« Exporter en PNG »). */
    label: string;
    items: MenuItem[];
    /** Comme pour la palette ; « libre » par défaut — un menu ne fait pas défiler. */
    placement?: "sous" | "libre";
}

/**
 * Petit menu ancré sur un bouton : une ligne par choix.
 *
 * Le menu se ferme AVANT d'exécuter le choix : une action longue (l'export
 * rastérise un SVG hors écran) le laisserait sinon ouvert pendant tout ce
 * temps, sans qu'on sache si le clic a été pris.
 */
export function openMenuPopover(o: MenuPopoverOptions): void {
    ouvrirSurcouche(o.anchor, "mp-pop", o.placement === "libre" ? "libre" : "sous", (pop, fermer) => {
        const head = document.createElement("div");
        head.className = "cp-head";
        head.textContent = o.label;
        pop.appendChild(head);
        o.items.forEach(it => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "mp-item";
            const t = document.createElement("span");
            t.className = "mp-label";
            t.textContent = it.label;
            b.appendChild(t);
            if (it.detail) {
                const d = document.createElement("span");
                d.className = "mp-detail";
                d.textContent = it.detail;
                b.appendChild(d);
            }
            b.addEventListener("click", () => { fermer(); it.onPick(); });
            pop.appendChild(b);
        });
    });
}

/** Ouvre la palette au-dessus de l'interface, ancrée sur le bouton cliqué. */
export function openColorPopover(o: ColorPopoverOptions): void {
    ouvrirSurcouche(o.anchor, "cp-pop", o.placement === "libre" ? "libre" : "sous", (pop, done) => {
        let snapped = false;
        const beforeChange = () => {
            if (!snapped && o.onBeforeChange) o.onBeforeChange();
            snapped = true;
        };

        const head = document.createElement("div");
        head.className = "cp-head";
        head.textContent = o.label;
        pop.appendChild(head);

        const swatches: HTMLButtonElement[] = [];
        let current = normalizeHex(o.value) || "#000000";

        const refresh = () => {
            swatches.forEach(sw => sw.classList.toggle("selected", sw.dataset.hex === current));
        };
        const apply = (hex: string, close: boolean) => {
            beforeChange();
            current = hex.toLowerCase();
            hexInput.value = current;
            native.value = current;
            o.onPick(current);
            refresh();
            if (close) done();
        };
        const mkSwatch = (hex: string, title: string): HTMLButtonElement => {
            const sw = document.createElement("button");
            sw.type = "button";
            sw.className = "cp-swatch";
            sw.dataset.hex = hex.toLowerCase();
            sw.title = title;
            sw.style.background = hex;
            sw.addEventListener("click", () => apply(hex, true));
            swatches.push(sw);
            return sw;
        };

        // Une colonne par teinte, une ligne par nuance.
        const grid = document.createElement("div");
        grid.className = "cp-grid";
        DESIGN_COLORS.forEach(hue => {
            const col = document.createElement("div");
            col.className = "cp-col";
            shadesOf(hue).forEach((hex, i) => {
                col.appendChild(mkSwatch(hex, `${hue.name} — ${SHADE_LABELS[i]}`));
            });
            grid.appendChild(col);
        });
        pop.appendChild(grid);

        // Couleurs du document : ce sont celles qu'on veut réutiliser le plus souvent.
        const utilisees = (o.usedColors || [])
            .map(normalizeHex)
            .filter((h): h is string => !!h);
        const uniques = Array.from(new Set(utilisees));
        if (uniques.length) {
            const sousTitre = document.createElement("div");
            sousTitre.className = "cp-sub";
            sousTitre.textContent = "Couleurs utilisées dans le document";
            pop.appendChild(sousTitre);
            const ligne = document.createElement("div");
            ligne.className = "cp-row cp-row-wrap";
            uniques.forEach(hex => ligne.appendChild(mkSwatch(hex, hex + " — déjà utilisée")));
            pop.appendChild(ligne);
        }

        const sub = document.createElement("div");
        sub.className = "cp-sub";
        sub.textContent = "Neutres";
        pop.appendChild(sub);

        const row = document.createElement("div");
        row.className = "cp-row";
        NEUTRALS.forEach(hex => row.appendChild(mkSwatch(hex, hex)));
        pop.appendChild(row);

        // Couleur libre + saisie hexadécimale
        const foot = document.createElement("div");
        foot.className = "cp-foot";
        const native = document.createElement("input");
        native.type = "color";
        native.value = current;
        native.title = "Couleur personnalisée";
        native.addEventListener("input", () => apply(native.value, false));
        const hexInput = document.createElement("input");
        hexInput.type = "text";
        hexInput.className = "cp-hex";
        hexInput.value = current;
        hexInput.spellcheck = false;
        hexInput.addEventListener("input", () => {
            const n = normalizeHex(hexInput.value);
            if (n) { beforeChange(); current = n; native.value = n; o.onPick(n); refresh(); }
        });
        const close = document.createElement("button");
        close.type = "button";
        close.className = "cp-close";
        close.textContent = "Fermer";
        close.addEventListener("click", () => done());
        foot.appendChild(native);
        foot.appendChild(hexInput);
        foot.appendChild(close);
        pop.appendChild(foot);

        refresh();
    });
}

/**
 * Cale posée en fin de volet le temps du choix : elle autorise le volet à
 * défiler un peu plus bas que son contenu, pour que le dernier champ de la
 * dernière carte puisse remonter et laisser la palette tenir dessous.
 */
let cale: HTMLElement | null = null;

function poseCale(volet: HTMLElement, px: number): void {
    if (!cale) {
        cale = document.createElement("div");
        cale.className = "cp-cale";
        cale.setAttribute("aria-hidden", "true");
        cale.style.flex = "0 0 auto";
    }
    cale.style.height = Math.ceil(px) + "px";
    volet.appendChild(cale);
}

function retireCale(): void {
    cale?.remove();
    cale = null;
}

/** Le conteneur qui défile autour du bouton (le volet), s'il y en a un. */
function ancetreDefilant(el: Element): HTMLElement | null {
    let e = el.parentElement;
    while (e && e !== document.body) {
        const oy = getComputedStyle(e).overflowY;
        if ((oy === "auto" || oy === "scroll") && e.scrollHeight > e.clientHeight) return e;
        e = e.parentElement;
    }
    return null;
}

/**
 * Place la surcouche **là où il y a la place**, sans rien faire défiler :
 * dessous d'abord — c'est là qu'on la cherche des yeux — puis à droite, à
 * gauche, au-dessus. Employé pour la pastille d'un nœud du canevas : faire
 * défiler le canevas dégagerait bien la place, mais en emportant le nœud qu'on
 * vient de cliquer.
 */
function placeLibre(pop: HTMLElement, anchor: Element): void {
    const m = 8;      // marge avec les bords de la fenêtre
    const gap = 6;    // écart entre la pastille et la palette
    const mini = 160; // en deçà, la palette n'est plus utilisable

    pop.style.maxHeight = "";
    pop.style.overflowY = "";
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const a = anchor.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;

    // À droite comme à gauche, la palette GLISSE verticalement pour tenir dans
    // la fenêtre : l'aligner sur la pastille la ferait sortir par le bas sans
    // rien y gagner — elle reste à côté d'elle, c'est ce qu'on lui demande.
    const glissee = Math.max(m, Math.min(a.top, H - m - h));
    const tientEnHauteur = h <= H - 2 * m;
    const cotes = [
        { ok: a.bottom + gap + h <= H - m, left: a.left, top: a.bottom + gap },
        { ok: tientEnHauteur && a.right + gap + w <= W - m, left: a.right + gap, top: glissee },
        { ok: tientEnHauteur && a.left - gap - w >= m, left: a.left - gap - w, top: glissee },
        { ok: a.top - gap - h >= m, left: a.left, top: a.top - gap - h }
    ];
    // Le premier côté où elle tient ENTIÈRE l'emporte : une palette rognée se
    // subit, elle ne se choisit pas.
    const choisi = cotes.find(c => c.ok);

    let left = (choisi || cotes[0]).left;
    let top = (choisi || cotes[0]).top;
    if (!choisi) {
        // Nulle part en entier : on garde le côté vertical le plus dégagé et la
        // palette défile en elle-même plutôt que de sortir de la fenêtre.
        const dessous = H - m - (a.bottom + gap);
        const dessus = a.top - gap - m;
        const hauteur = Math.max(mini, Math.max(dessous, dessus));
        pop.style.maxHeight = hauteur + "px";
        pop.style.overflowY = "auto";
        top = dessous >= dessus ? a.bottom + gap : a.top - gap - hauteur;
    }

    pop.style.left = Math.round(Math.max(m, Math.min(left, W - w - m))) + "px";
    pop.style.top = Math.round(Math.max(m, top)) + "px";
}

/**
 * Place la surcouche **sous** le bouton, jamais au-dessus : une palette qui
 * s'ouvre vers le haut recouvre le champ qu'on est en train de régler.
 * Quand le bas de la fenêtre est trop proche, on fait d'abord remonter le
 * bouton en faisant défiler le volet ; s'il manque encore de la hauteur, la
 * palette se rogne et défile en elle-même.
 */
function place(pop: HTMLElement, anchor: Element): void {
    const m = 8;      // marge avec les bords de la fenêtre
    const gap = 6;    // écart entre le bouton et la palette
    const mini = 160; // en deçà, la palette n'est plus utilisable

    pop.style.maxHeight = "";
    pop.style.overflowY = "";
    const h = pop.offsetHeight;

    const debord = anchor.getBoundingClientRect().bottom + gap + h - (window.innerHeight - m);
    if (debord > 0) {
        const volet = ancetreDefilant(anchor);
        if (volet) {
            // On ne remonte le bouton que jusqu'en haut du volet : il doit
            // rester visible pendant qu'on choisit la couleur.
            const jusquEnHaut = anchor.getBoundingClientRect().top - volet.getBoundingClientRect().top - m;
            const aRemonter = Math.max(0, Math.min(debord, jusquEnHaut));
            const reste = volet.scrollHeight - volet.clientHeight - volet.scrollTop;
            if (reste < aRemonter) poseCale(volet, aRemonter - reste);
            volet.scrollTop += aRemonter;
        }
    }

    const a = anchor.getBoundingClientRect();
    let top = a.bottom + gap;
    let hauteur = h;
    const dispo = window.innerHeight - m - top;
    if (h > dispo) {
        hauteur = Math.max(mini, dispo);
        pop.style.maxHeight = hauteur + "px";
        pop.style.overflowY = "auto";
    }
    if (top + hauteur > window.innerHeight - m) top = Math.max(m, window.innerHeight - m - hauteur);

    const w = pop.offsetWidth;
    let left = a.left;
    if (left + w > window.innerWidth - m) left = window.innerWidth - w - m;
    if (left < m) left = m;
    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
}
