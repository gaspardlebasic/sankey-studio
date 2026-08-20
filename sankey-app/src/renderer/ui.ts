/**
 * Briques d'interface partagées : boîtes de dialogue modales et sélecteur de
 * couleurs en surcouche (grille type Word/Excel — une teinte par colonne,
 * les nuances en lignes).
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

/* ------------------------------- modales -------------------------------- */

export interface ModalButton {
    label: string;
    value: string;
    kind?: "primary" | "ghost" | "danger";
}
export interface ModalOptions {
    title: string;
    lines: string[];
    buttons: ModalButton[];
    checkbox?: { label: string; checked: boolean };
}
export interface ModalResult {
    value: string | null; // null = fermée sans choisir (Échap / clic hors de la boîte)
    checked: boolean;
}

/** Boîte de dialogue modale ; se résout sur le bouton cliqué. */
export function openModal(o: ModalOptions): Promise<ModalResult> {
    return new Promise(resolve => {
        const back = document.createElement("div");
        back.className = "ov-backdrop";

        const box = document.createElement("div");
        box.className = "ov-modal";
        box.setAttribute("role", "dialog");
        box.setAttribute("aria-modal", "true");

        const h = document.createElement("h2");
        h.className = "ov-title";
        h.textContent = o.title;
        box.appendChild(h);

        o.lines.forEach(text => {
            const p = document.createElement("p");
            p.className = "ov-text";
            p.textContent = text;
            box.appendChild(p);
        });

        let check: HTMLInputElement | null = null;
        if (o.checkbox) {
            const lab = document.createElement("label");
            lab.className = "ov-check";
            check = document.createElement("input");
            check.type = "checkbox";
            check.checked = o.checkbox.checked;
            const sp = document.createElement("span");
            sp.textContent = o.checkbox.label;
            lab.appendChild(check);
            lab.appendChild(sp);
            box.appendChild(lab);
        }

        const foot = document.createElement("div");
        foot.className = "ov-actions";
        const done = (value: string | null) => {
            window.removeEventListener("keydown", onKey, true);
            back.remove();
            resolve({ value, checked: check ? check.checked : false });
        };
        o.buttons.forEach(b => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "ov-btn" + (b.kind ? " " + b.kind : "");
            btn.textContent = b.label;
            btn.addEventListener("click", () => done(b.value));
            foot.appendChild(btn);
        });
        box.appendChild(foot);

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.stopPropagation(); done(null); }
        };
        window.addEventListener("keydown", onKey, true);
        back.addEventListener("mousedown", e => { if (e.target === back) done(null); });

        back.appendChild(box);
        document.body.appendChild(back);
        const first = foot.querySelector("button") as HTMLButtonElement | null;
        if (first) first.focus();
    });
}

/* -------------------------- sélecteur de couleurs ----------------------- */

export interface ColorPopoverOptions {
    anchor: HTMLElement;
    value: string;
    label: string;
    /** Appelé avant la première modification (pour l'historique undo). */
    onBeforeChange?: () => void;
    onPick: (hex: string) => void;
}

let closeCurrentPopover: (() => void) | null = null;

/** Ouvre la palette au-dessus de l'interface, ancrée sur le bouton cliqué. */
export function openColorPopover(o: ColorPopoverOptions): void {
    if (closeCurrentPopover) closeCurrentPopover();

    let snapped = false;
    const beforeChange = () => {
        if (!snapped && o.onBeforeChange) o.onBeforeChange();
        snapped = true;
    };

    const back = document.createElement("div");
    back.className = "cp-backdrop";
    const pop = document.createElement("div");
    pop.className = "cp-pop";
    pop.setAttribute("role", "dialog");

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
    back.appendChild(pop);
    document.body.appendChild(back);
    place(pop, o.anchor);

    function done(): void {
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("resize", reposition);
        back.remove();
        closeCurrentPopover = null;
    }
    const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") { e.stopPropagation(); done(); }
    };
    const reposition = () => place(pop, o.anchor);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", reposition);
    back.addEventListener("mousedown", e => { if (e.target === back) done(); });
    closeCurrentPopover = done;
}

/** Place la surcouche sous le bouton, en la ramenant dans la fenêtre. */
function place(pop: HTMLElement, anchor: HTMLElement): void {
    const a = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const m = 8;
    let left = a.left;
    let top = a.bottom + 6;
    if (left + w > window.innerWidth - m) left = window.innerWidth - w - m;
    if (left < m) left = m;
    if (top + h > window.innerHeight - m) top = Math.max(m, a.top - h - 6);
    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
}
