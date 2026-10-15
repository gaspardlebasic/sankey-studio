// Dépliage interactif d'un Sankey agrégé (PLAN-AGREGATION.md, étape 2).
//
// Ce module ne connaît ni l'éditeur ni Excel : il prend un SVG déjà peint par
// le moteur, et la projection qui l'a produit (src/shared/agregation.js). Il y
// pose les commandes — ⊕ sur un nœud replié, cadre ⊖ autour des enfants d'un
// parent déplié — et anime le passage d'un état à l'autre. L'aperçu du
// complément et l'export HTML interactif (étape 4) s'en servent tous les deux.
//
// Les commandes ne sont JAMAIS dans un export PNG / SVG : elles ne sont posées
// que sur le dessin à l'écran, après coup.

const SVGNS = "http://www.w3.org/2000/svg";

/** Ce que le module lit de la projection. */
export interface NoeudDepliable { id: string; name: string; depliable?: boolean; }
export interface CadreDepliage { id: string; name: string; profondeur: number; membres: string[]; }

/** Classe des éléments posés par ce module : on les retire d'un seul sélecteur. */
export const CLASSE_COMMANDES = "commandes-depliage";
const RAYON = 8;
/** Écart entre un cadre et ses nœuds ; un cadre englobant s'écarte davantage. */
const ECART_CADRE = 7;
const ECART_PAR_NIVEAU = 5;

/** Le rectangle peint d'un nœud, dans le repère de son groupe. */
function boiteDe(rc: SVGRectElement): { x: number; y: number; w: number; h: number } {
    return {
        x: Number(rc.getAttribute("x")) || 0,
        y: Number(rc.getAttribute("y")) || 0,
        w: Number(rc.getAttribute("width")) || 0,
        h: Number(rc.getAttribute("height")) || 0
    };
}

/** Les rectangles des nœuds peints, par identifiant. */
function rectsParId(svg: SVGSVGElement): Map<string, SVGRectElement> {
    const out = new Map<string, SVGRectElement>();
    svg.querySelectorAll("rect[data-id]").forEach(rc => {
        const id = rc.getAttribute("data-id");
        if (id && !out.has(id)) out.set(id, rc as SVGRectElement);
    });
    return out;
}

/** Le calque des commandes d'un groupe de dessin, créé au besoin, au-dessus de tout. */
function calqueDe(groupe: Element, calques: Map<Element, SVGGElement>): SVGGElement {
    let g = calques.get(groupe);
    if (!g) {
        g = document.createElementNS(SVGNS, "g") as SVGGElement;
        g.setAttribute("class", CLASSE_COMMANDES);
        groupe.appendChild(g);
        calques.set(groupe, g);
    }
    return g;
}

/** Un bouton rond « + » ou « − », centré en (cx, cy). */
function bouton(
    signe: "+" | "−", cx: number, cy: number, attribut: string, id: string, titre: string
): SVGGElement {
    const g = document.createElementNS(SVGNS, "g") as SVGGElement;
    g.setAttribute("class", "bouton-depliage");
    g.setAttribute(attribut, id);
    g.setAttribute("transform", `translate(${cx},${cy})`);
    g.setAttribute("role", "button");
    g.setAttribute("tabindex", "0");
    g.setAttribute("aria-label", titre);
    const t = document.createElementNS(SVGNS, "title");
    t.textContent = titre;
    g.appendChild(t);
    const c = document.createElementNS(SVGNS, "circle");
    c.setAttribute("r", String(RAYON));
    c.setAttribute("fill", "#ffffff");
    c.setAttribute("stroke", "#3a3a3a");
    c.setAttribute("stroke-width", "1.2");
    g.appendChild(c);
    // Le signe est tracé, pas écrit : il reste centré quelle que soit la police.
    const trait = (d: string) => {
        const p = document.createElementNS(SVGNS, "path");
        p.setAttribute("d", d);
        p.setAttribute("stroke", "#3a3a3a");
        p.setAttribute("stroke-width", "1.6");
        p.setAttribute("stroke-linecap", "round");
        g.appendChild(p);
    };
    trait("M-4,0 H4");
    if (signe === "+") trait("M0,-4 V4");
    return g;
}

/**
 * Pose les commandes sur un dessin déjà peint.
 *
 * - **⊕** au centre de chaque nœud replié qui a des enfants. Un produit de
 *   largeur 0 n'a pas de boîte visible : son ⊕ tombe au milieu du ruban.
 * - un **cadre** pointillé autour des enfants de chaque parent déplié, avec son
 *   nom et un **⊖** sur son bord haut.
 *
 * Les éléments portent `data-deplier` / `data-replier` : l'appelant écoute les
 * clics sur le SVG et retrouve l'identifiant par `closest`.
 */
export function poserCommandes(
    svg: SVGSVGElement, noeuds: NoeudDepliable[], cadres: CadreDepliage[]
): void {
    svg.querySelectorAll("." + CLASSE_COMMANDES).forEach(el => el.remove());
    const rects = rectsParId(svg);
    const calques = new Map<Element, SVGGElement>();
    const profondeurMax = cadres.reduce((m, c) => Math.max(m, c.profondeur), 0);

    // Les cadres d'abord (derrière les boutons), du plus large au plus proche.
    cadres.slice().sort((a, b) => a.profondeur - b.profondeur).forEach(c => {
        const membres = c.membres.map(id => rects.get(id)).filter(Boolean) as SVGRectElement[];
        if (!membres.length) return;
        const groupe = membres[0].parentNode as Element;
        const boites = membres.filter(rc => rc.parentNode === groupe).map(boiteDe);
        const e = ECART_CADRE + ECART_PAR_NIVEAU * (profondeurMax - c.profondeur);
        const x0 = Math.min(...boites.map(b => b.x)) - e;
        const x1 = Math.max(...boites.map(b => b.x + b.w)) + e;
        const y0 = Math.min(...boites.map(b => b.y)) - e;
        const y1 = Math.max(...boites.map(b => b.y + b.h)) + e;
        const calque = calqueDe((groupe.parentNode as Element | null) || groupe, calques);
        // Le calque vit dans le groupe parent des nœuds : il faut reprendre son
        // décalage pour tomber au même endroit.
        const decalage = groupe.getAttribute("transform") || "";
        const g = document.createElementNS(SVGNS, "g") as SVGGElement;
        g.setAttribute("class", "cadre-depliage");
        g.setAttribute("data-cadre", c.id);
        if (decalage) g.setAttribute("transform", decalage);
        const r = document.createElementNS(SVGNS, "rect");
        r.setAttribute("x", String(x0));
        r.setAttribute("y", String(y0));
        r.setAttribute("width", String(Math.max(0, x1 - x0)));
        r.setAttribute("height", String(Math.max(0, y1 - y0)));
        r.setAttribute("rx", "5");
        r.setAttribute("fill", "none");
        r.setAttribute("stroke", "#6b6b6b");
        r.setAttribute("stroke-width", "1");
        r.setAttribute("stroke-dasharray", "4 3");
        r.setAttribute("pointer-events", "none");
        g.appendChild(r);
        const cx = (x0 + x1) / 2;
        g.appendChild(bouton("−", cx, y0, "data-replier", c.id, `Replier « ${c.name} »`));
        const nom = document.createElementNS(SVGNS, "text");
        nom.setAttribute("x", String(cx + RAYON + 4));
        nom.setAttribute("y", String(y0 - 3));
        nom.setAttribute("font-size", "10");
        nom.setAttribute("font-family", "sans-serif");
        nom.setAttribute("fill", "#555555");
        nom.setAttribute("pointer-events", "none");
        nom.textContent = c.name;
        g.appendChild(nom);
        calque.appendChild(g);
        // Un cadre qui touche le haut du dessin aurait son ⊖ et son nom rognés
        // par le bord : ils passent alors sur son bord bas.
        const haut = svg.getBoundingClientRect().top;
        const moins = g.querySelector("[data-replier]") as SVGGElement;
        if (moins.getBoundingClientRect().top < haut + 1 || nom.getBoundingClientRect().top < haut + 1) {
            moins.setAttribute("transform", `translate(${cx},${y1})`);
            nom.setAttribute("y", String(y1 + RAYON + 4));
        }
    });

    noeuds.forEach(n => {
        if (!n.depliable) return;
        const rc = rects.get(n.id);
        if (!rc) return;
        const b = boiteDe(rc);
        const groupe = rc.parentNode as Element;
        const calque = calqueDe((groupe.parentNode as Element | null) || groupe, calques);
        const g = bouton("+", b.x + b.w / 2, b.y + b.h / 2, "data-deplier", n.id,
                         `Déplier « ${n.name} »`);
        const decalage = groupe.getAttribute("transform") || "";
        if (decalage) {
            g.setAttribute("transform", decalage + " " + g.getAttribute("transform"));
        }
        calque.appendChild(g);
    });
}

/**
 * Le geste désigné par un clic, s'il en est un : `{ deplier: id }` ou
 * `{ replier: id }`. L'appelant bascule alors l'état et redessine.
 */
export function commandeCliquee(cible: EventTarget | null): { id: string; deplier: boolean } | null {
    const el = cible instanceof Element ? cible.closest("[data-deplier], [data-replier]") : null;
    if (!el) return null;
    const d = el.getAttribute("data-deplier");
    if (d) return { id: d, deplier: true };
    return { id: el.getAttribute("data-replier") || "", deplier: false };
}

/* ------------------------------ animation ------------------------------ */

/** Ce qu'on retient d'un dessin avant de le remplacer. */
export interface Instantane {
    /** Boîtes des nœuds, en pixels de l'écran relatifs au SVG. */
    boites: Map<string, DOMRect>;
    /** Membres des cadres, pour savoir d'où vient un parent qu'on replie. */
    cadres: Map<string, string[]>;
    /** Copie du dessin, qui s'efface pendant que le nouveau apparaît. */
    copie: SVGGElement | null;
}

function boitesEcran(svg: SVGSVGElement): Map<string, DOMRect> {
    const o = svg.getBoundingClientRect();
    const out = new Map<string, DOMRect>();
    rectsParId(svg).forEach((rc, id) => {
        const b = rc.getBoundingClientRect();
        out.set(id, new DOMRect(b.x - o.x, b.y - o.y, b.width, b.height));
    });
    return out;
}

/** Relève l'état du dessin avant de le remplacer. */
export function instantane(svg: SVGSVGElement, cadres: CadreDepliage[]): Instantane {
    const copie = document.createElementNS(SVGNS, "g") as SVGGElement;
    Array.from(svg.childNodes).forEach(n => {
        if (n instanceof Element && n.classList.contains(CLASSE_COMMANDES)) return;
        copie.appendChild(n.cloneNode(true));
    });
    copie.querySelectorAll("." + CLASSE_COMMANDES).forEach(el => el.remove());
    return {
        boites: boitesEcran(svg),
        cadres: new Map(cadres.map(c => [c.id, c.membres])),
        copie
    };
}

const DUREE = 380;

function mouvementReduit(): boolean {
    try {
        return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch { return false; }
}

function union(boites: DOMRect[]): DOMRect | null {
    if (!boites.length) return null;
    const x0 = Math.min(...boites.map(b => b.x)), y0 = Math.min(...boites.map(b => b.y));
    const x1 = Math.max(...boites.map(b => b.right)), y1 = Math.max(...boites.map(b => b.bottom));
    return new DOMRect(x0, y0, x1 - x0, y1 - y0);
}

/**
 * Anime le passage de l'ancien dessin (`avant`) au nouveau, déjà peint.
 *
 * - Un nœud présent des deux côtés **glisse** de son ancienne place à la nouvelle.
 * - Les enfants d'un parent qu'on vient de **déplier** partent de la boîte du
 *   parent, chacun à sa part : le parent se scinde.
 * - Un parent qu'on vient de **replier** part de la boîte qu'occupaient ses
 *   enfants : ils se resserrent en lui.
 * - Les rubans et les étiquettes apparaissent en fondu ; l'ancien dessin
 *   s'efface par-dessus.
 *
 * Rien n'est animé si l'utilisatrice a demandé moins de mouvement.
 */
export function animerTransition(svg: SVGSVGElement, avant: Instantane, cadres: CadreDepliage[]): void {
    if (mouvementReduit() || typeof Element.prototype.animate !== "function") return;
    const apres = boitesEcran(svg);
    const rects = rectsParId(svg);
    const nouveauxCadres = new Map(cadres.map(c => [c.id, c.membres]));

    // D'où part chaque nœud nouvellement affiché.
    const depart = new Map<string, DOMRect>();
    apres.forEach((b, id) => {
        const ancienne = avant.boites.get(id);
        if (ancienne) { depart.set(id, ancienne); return; }
        // Replié à l'instant : il part de la place de ses anciens membres.
        const membres = avant.cadres.get(id);
        const u = membres && union(membres.map(m => avant.boites.get(m)).filter(Boolean) as DOMRect[]);
        if (u) depart.set(id, u);
    });
    // Déplié à l'instant : ses membres partent de sa boîte, chacun à sa part.
    nouveauxCadres.forEach((membres, parent) => {
        const p = avant.boites.get(parent);
        if (!p) return;
        const u = union(membres.map(m => apres.get(m)).filter(Boolean) as DOMRect[]);
        if (!u || u.height <= 0) return;
        const k = p.height / u.height;
        membres.forEach(m => {
            const b = apres.get(m);
            if (!b || avant.boites.has(m)) return;
            depart.set(m, new DOMRect(p.x + (b.x - u.x) * (p.width / Math.max(1, u.width)),
                                      p.y + (b.y - u.y) * k, b.width, b.height * k));
        });
    });

    const facon: KeyframeAnimationOptions = { duration: DUREE, easing: "cubic-bezier(.2,.7,.2,1)" };
    depart.forEach((de, id) => {
        const rc = rects.get(id);
        const vers = apres.get(id);
        if (!rc || !vers) return;
        const sx = vers.width > 0 ? de.width / vers.width : 1;
        const sy = vers.height > 0 ? de.height / vers.height : 1;
        const dx = de.x - vers.x, dy = de.y - vers.y;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
        (rc as unknown as HTMLElement).style.transformBox = "fill-box";
        (rc as unknown as HTMLElement).style.transformOrigin = "0 0";
        rc.animate([
            { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
            { transform: "none" }
        ], facon);
    });

    // Rubans, étiquettes, valeurs, commandes : en fondu, un peu après.
    const fondus = svg.querySelectorAll(
        "path, g[data-label-for], text, ." + CLASSE_COMMANDES);
    fondus.forEach(el => {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUREE, easing: "ease-out" });
    });

    // L'ancien dessin s'efface par-dessus — sans attraper un seul clic.
    if (avant.copie) {
        const copie = avant.copie;
        copie.setAttribute("pointer-events", "none");
        copie.setAttribute("class", "ancien-dessin");
        svg.appendChild(copie);
        const a = copie.animate([{ opacity: 1 }, { opacity: 0 }],
                                { duration: DUREE * 0.6, easing: "ease-in", fill: "forwards" });
        a.onfinish = () => copie.remove();
        // Filet de sécurité : une animation suspendue (onglet caché) ne doit
        // pas laisser l'ancien dessin par-dessus le nouveau.
        setTimeout(() => copie.remove(), DUREE * 2);
    }
}
