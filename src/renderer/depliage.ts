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

import { cheminBande, GeometrieRuban } from "./engine";

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

/** Un ruban relevé : sa géométrie, et le décalage de son groupe à l'écran. */
interface RubanReleve { g: GeometrieRuban; ox: number; oy: number; }

/** Ce qu'on retient d'un dessin avant de le remplacer. */
export interface Instantane {
    /** Boîtes des nœuds, en pixels de l'écran relatifs au SVG. */
    boites: Map<string, DOMRect>;
    /** Membres des cadres, pour savoir d'où vient un parent qu'on replie. */
    cadres: Map<string, string[]>;
    /** Rubans (et bandeaux bio), par clé `cleRuban`. */
    rubans: Map<string, RubanReleve>;
    /** Boîtes des étiquettes des nœuds, comme `boites`. */
    etiquettes: Map<string, DOMRect>;
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

function etiquettesEcran(svg: SVGSVGElement): Map<string, DOMRect> {
    const o = svg.getBoundingClientRect();
    const out = new Map<string, DOMRect>();
    svg.querySelectorAll("g[data-label-for]").forEach(g => {
        const id = g.getAttribute("data-label-for");
        if (!id || out.has(id)) return;
        const b = g.getBoundingClientRect();
        out.set(id, new DOMRect(b.x - o.x, b.y - o.y, b.width, b.height));
    });
    return out;
}

/** Ruban ou bandeau bio, et ses deux extrémités. */
function cleRuban(el: Element, source = el.getAttribute("data-source") || "",
                  cible = el.getAttribute("data-target") || ""): string {
    return (el.classList.contains("lien-bio") ? "b" : "r") + "\u0000" + source + "\u0000" + cible;
}

/** Les rubans peints, avec leur géométrie et le décalage de leur groupe. */
function rubansPeints(svg: SVGSVGElement): Map<string, { el: SVGPathElement; r: RubanReleve }> {
    const o = svg.getBoundingClientRect();
    const out = new Map<string, { el: SVGPathElement; r: RubanReleve }>();
    svg.querySelectorAll("path[data-ruban]").forEach(el => {
        let g: GeometrieRuban;
        try { g = JSON.parse(el.getAttribute("data-ruban") || ""); } catch { return; }
        const m = (el as SVGGraphicsElement).getScreenCTM();
        out.set(cleRuban(el), {
            el: el as SVGPathElement,
            r: { g, ox: m ? m.e - o.x : 0, oy: m ? m.f - o.y : 0 }
        });
    });
    return out;
}

/** Relève l'état du dessin avant de le remplacer. */
export function instantane(svg: SVGSVGElement, cadres: CadreDepliage[]): Instantane {
    const rubans = new Map<string, RubanReleve>();
    rubansPeints(svg).forEach((v, k) => rubans.set(k, v.r));
    return {
        boites: boitesEcran(svg),
        cadres: new Map(cadres.map(c => [c.id, c.membres])),
        rubans,
        etiquettes: etiquettesEcran(svg)
    };
}

const DUREE = 520;
/** La courbe « ease » de CSS, pour les nœuds comme pour les rubans. */
const EASE = "cubic-bezier(.25,.1,.25,1)";

/** `cubic-bezier(x1, y1, x2, y2)` de CSS, évaluée en JavaScript (pour les rubans). */
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = (u: number) => ((ax * u + bx) * u + cx) * u;
    const dX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
    const Y = (u: number) => ((ay * u + by) * u + cy) * u;
    return t => {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        let u = t;
        for (let i = 0; i < 8; i++) {
            const e = X(u) - t;
            const d = dX(u);
            if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break;
            u -= e / d;
        }
        return Y(Math.max(0, Math.min(1, u)));
    };
}
const ease = bezier(.25, .1, .25, 1);

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
 * La boîte d'où part un parent qu'on REPLIE : la hauteur cumulée de ses
 * enfants et SA PROPRE largeur, centrées sur leur milieu moyen (pondéré par
 * leur hauteur). Pas la boîte qui les englobe : elle compte les écarts entre
 * eux, et le moindre décalage horizontal l'élargit — le parent naissait en
 * grand rectangle avant de se réduire.
 */
function reunies(boites: DOMRect[], largeur: number): DOMRect | null {
    if (!boites.length) return null;
    const h = boites.reduce((s, b) => s + b.height, 0);
    const poids = (b: DOMRect) => (h > 0 ? b.height : 1);
    const total = boites.reduce((s, b) => s + poids(b), 0);
    const cx = boites.reduce((s, b) => s + (b.x + b.width / 2) * poids(b), 0) / total;
    const cy = boites.reduce((s, b) => s + (b.y + b.height / 2) * poids(b), 0) / total;
    return new DOMRect(cx - largeur / 2, cy - h / 2, largeur, h);
}

/** Une géométrie ramenée dans le repère d'un autre groupe. */
function deplacee(r: RubanReleve, ox: number, oy: number): GeometrieRuban {
    const dx = r.ox - ox, dy = r.oy - oy;
    return { ...r.g, p: r.g.p.map(q => [q[0] + dx, q[1] + dy] as [number, number]) };
}

/**
 * Le même nombre de points que `modele` : un ruban qui gagne ou perd une
 * escale garde ses extrémités, et ses points intermédiaires partent de la
 * droite qui les relie.
 */
function auMemeNombre(g: GeometrieRuban, modele: GeometrieRuban): GeometrieRuban {
    if (g.p.length === modele.p.length) return g;
    const a = g.p[0], b = g.p[g.p.length - 1];
    const n = modele.p.length;
    const p = modele.p.map((q, i) => {
        if (i === 0) return [a[0], a[1]] as [number, number];
        if (i === n - 1) return [b[0], b[1]] as [number, number];
        const x0 = modele.p[0][0], x1 = modele.p[n - 1][0];
        const t = x1 !== x0 ? (q[0] - x0) / (x1 - x0) : i / (n - 1);
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as [number, number];
    });
    return { ...g, p };
}

function interpolee(a: GeometrieRuban, b: GeometrieRuban, t: number): GeometrieRuban {
    const l = (x: number, y: number) => x + (y - x) * t;
    return {
        ...b,
        p: b.p.map((q, i) => [l(a.p[i][0], q[0]), l(a.p[i][1], q[1])] as [number, number]),
        hw: l(a.hw, b.hw), de: l(a.de, b.de), a: l(a.a, b.a)
    };
}

/** Ordonnée de l'axe à un bout (0 : départ, sinon arrivée). */
const bout = (g: GeometrieRuban, fin: boolean) => g.p[fin ? g.p.length - 1 : 0];

/**
 * D'où part le ruban d'un enfant quand son parent se DÉPLIE : de SA tranche du
 * ruban qui allait au parent. Les rubans frères (même autre extrémité, même
 * parent) se partagent l'ancien ruban dans l'ordre où ils s'empilent, chacun à
 * proportion de son épaisseur — le parent se scinde.
 */
function departScinde(
    nouveau: GeometrieRuban, freres: GeometrieRuban[], ancien: GeometrieRuban
): GeometrieRuban {
    const ep = (g: GeometrieRuban) => g.a - g.de;
    const total = freres.reduce((s, g) => s + ep(g), 0);
    const k = total > 0 ? ep(ancien) / total : 1;
    // Le haut de la tranche, à un bout : les frères empilés au-dessus, à l'échelle.
    const haut = (fin: boolean) => {
        const y = (g: GeometrieRuban) => bout(g, fin)[1] + g.de;
        const avant = freres.filter(g => y(g) < y(nouveau)).reduce((s, g) => s + ep(g), 0);
        return bout(ancien, fin)[1] + ancien.de + avant * k;
    };
    const de = nouveau.de * k, a = nouveau.a * k, hw = nouveau.hw * k;
    const yDepart = haut(false) - de, yArrivee = haut(true) - de;
    const n = nouveau.p.length;
    const p = nouveau.p.map((q, i) => {
        const t = n > 1 ? i / (n - 1) : 0;
        const x = i === 0 ? bout(ancien, false)[0] : i === n - 1 ? bout(ancien, true)[0] : q[0];
        return [x, yDepart + (yArrivee - yDepart) * t] as [number, number];
    });
    return { ...nouveau, p, hw, de, a };
}

/**
 * D'où part le ruban d'un parent qu'on vient de REPLIER : de l'épaisseur
 * CUMULÉE des rubans de ses enfants, centrée, à chaque bout, sur leur position
 * moyenne (pondérée par l'épaisseur) — ils se resserrent en lui.
 *
 * Pas la bande qui les englobe : côté enfants, leurs rubans sont épars,
 * séparés par l'écart entre les nœuds et par les flux venus d'ailleurs. Cette
 * bande-là faisait naître un ruban énorme, qui se réduisait ensuite.
 */
function departReuni(nouveau: GeometrieRuban, anciens: GeometrieRuban[]): GeometrieRuban {
    const ep = (g: GeometrieRuban) => g.a - g.de;
    const total = anciens.reduce((s, g) => s + ep(g), 0);
    const centre = (fin: boolean) => total > 0
        ? anciens.reduce((s, g) => s + (bout(g, fin)[1] + (g.de + g.a) / 2) * ep(g), 0) / total
        : bout(anciens[0], fin)[1];
    const k = ep(nouveau) > 0 ? total / ep(nouveau) : 1;
    const de = nouveau.de * k, a = nouveau.a * k, hw = nouveau.hw * k;
    // L'axe passe là où le milieu de la bande [de, a] tombe sur le centre voulu.
    const axe = (fin: boolean) => centre(fin) - (de + a) / 2;
    const y0 = axe(false), y1 = axe(true);
    const n = nouveau.p.length;
    const x0 = bout(anciens[0], false)[0], x1 = bout(anciens[0], true)[0];
    const p = nouveau.p.map((q, i) => {
        const t = n > 1 ? i / (n - 1) : 0;
        const x = i === 0 ? x0 : i === n - 1 ? x1 : q[0];
        return [x, y0 + (y1 - y0) * t] as [number, number];
    });
    return { ...nouveau, p, hw, de, a };
}

/**
 * Anime le passage de l'ancien dessin (`avant`) au nouveau, déjà peint — en
 * déformant l'un en l'autre, sans fondu enchaîné :
 *
 * - Un nœud présent des deux côtés **glisse** de son ancienne place à la nouvelle.
 * - Les enfants d'un parent qu'on vient de **déplier** partent de la boîte du
 *   parent, chacun à sa part : le parent se scinde. Leurs rubans partent de
 *   leur tranche du ruban du parent.
 * - Un parent qu'on vient de **replier** part de la boîte qu'occupaient ses
 *   enfants, et ses rubans de la bande de leurs rubans : ils se resserrent en lui.
 * - Les étiquettes suivent leur nœud ; les valeurs écrites sur les rubans et
 *   les commandes apparaissent une fois le mouvement presque fini.
 *
 * Rien n'est animé si l'utilisatrice a demandé moins de mouvement.
 */
export function animerTransition(svg: SVGSVGElement, avant: Instantane, cadres: CadreDepliage[]): void {
    if (mouvementReduit() || typeof Element.prototype.animate !== "function") return;
    const apres = boitesEcran(svg);
    const rects = rectsParId(svg);
    const nouveauxCadres = new Map(cadres.map(c => [c.id, c.membres]));

    // Qui vient d'où : un nœud nouveau d'un parent déplié vient de ce parent,
    // un parent replié vient de ses anciens membres.
    const pereDe = new Map<string, string>();
    nouveauxCadres.forEach((membres, parent) => {
        if (!avant.boites.has(parent)) return;
        membres.forEach(m => { if (!avant.boites.has(m)) pereDe.set(m, parent); });
    });
    const membresDe = new Map<string, string[]>();
    avant.cadres.forEach((membres, parent) => {
        if (apres.has(parent) && !avant.boites.has(parent)) membresDe.set(parent, membres);
    });

    // --- Les nœuds.
    const depart = new Map<string, DOMRect>();
    apres.forEach((b, id) => {
        const ancienne = avant.boites.get(id);
        if (ancienne) { depart.set(id, ancienne); return; }
        const membres = membresDe.get(id);
        const r = membres && reunies(membres.map(m => avant.boites.get(m)).filter(Boolean) as DOMRect[], b.width);
        if (r) depart.set(id, r);
    });
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

    const facon: KeyframeAnimationOptions = { duration: DUREE, easing: EASE };
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

    // --- Les rubans : chacun se déforme depuis sa géométrie de départ.
    const peints = rubansPeints(svg);
    const anime: { el: SVGPathElement; de: GeometrieRuban; vers: GeometrieRuban; final: string }[] = [];
    const sansDepart: Element[] = [];
    peints.forEach(({ el, r }, cle) => {
        const [genre, s, t] = cle.split("\u0000");
        const vers = r.g;
        const releve = (k: string) => {
            const a = avant.rubans.get(k);
            return a ? deplacee(a, r.ox, r.oy) : null;
        };
        let de: GeometrieRuban | null = releve(cle);
        // Dépliage : le ruban d'un enfant part de celui qui allait à son père.
        if (!de && (pereDe.has(s) || pereDe.has(t))) {
            const cotePere = pereDe.has(s);
            const pere = (cotePere ? pereDe.get(s) : pereDe.get(t))!;
            const autre = cotePere ? t : s;
            const ancien = releve([genre, cotePere ? pere : s, cotePere ? t : pere].join("\u0000"));
            if (ancien) {
                const freres: GeometrieRuban[] = [];
                peints.forEach((v, k2) => {
                    const [g2, s2, t2] = k2.split("\u0000");
                    if (g2 !== genre) return;
                    const membre = cotePere ? s2 : t2, bout2 = cotePere ? t2 : s2;
                    if (bout2 === autre && pereDe.get(membre) === pere) freres.push(v.r.g);
                });
                de = departScinde(vers, freres, auMemeNombre(ancien, vers));
            }
        }
        // Repli : le ruban du parent part de ceux de ses anciens membres.
        if (!de && (membresDe.has(s) || membresDe.has(t))) {
            const cotePere = membresDe.has(s);
            const membres = (cotePere ? membresDe.get(s) : membresDe.get(t))!;
            const anciens = membres
                .map(m => releve([genre, cotePere ? m : s, cotePere ? t : m].join("\u0000")))
                .filter(Boolean) as GeometrieRuban[];
            if (anciens.length) de = departReuni(vers, anciens.map(g => auMemeNombre(g, vers)));
        }
        if (!de) { sansDepart.push(el); return; }
        de = auMemeNombre(de, vers);
        anime.push({ el, de, vers, final: el.getAttribute("d") || "" });
        el.setAttribute("d", cheminBande(de));        // dès cette image : pas d'éclair de l'état final
    });
    if (anime.length) {
        const t0 = performance.now();
        const pas = (now: number) => {
            const t = Math.min(1, (now - t0) / DUREE);
            const e = ease(t);
            anime.forEach(a => {
                if (!a.el.isConnected) return;
                a.el.setAttribute("d", t >= 1 ? a.final : cheminBande(interpolee(a.de, a.vers, e)));
            });
            if (t < 1) requestAnimationFrame(pas);
        };
        requestAnimationFrame(pas);
        // Filet de sécurité : une page cachée ne fait plus d'images ; le dessin
        // ne doit pas rester figé à mi-chemin.
        setTimeout(() => anime.forEach(a => a.el.setAttribute("d", a.final)), DUREE * 3);
    }
    // Un ruban sans antécédent (nouveau de part en part) apparaît en fondu.
    sansDepart.forEach(el => el.animate([{ opacity: 0 }, { opacity: 1 }], facon));

    // --- Les étiquettes suivent leur nœud.
    const nouvelles = etiquettesEcran(svg);
    svg.querySelectorAll("g[data-label-for]").forEach(g => {
        const id = g.getAttribute("data-label-for") || "";
        const vers = nouvelles.get(id);
        if (!vers) return;
        let de = avant.etiquettes.get(id);
        let naissante = false;
        if (!de && pereDe.has(id)) { de = avant.etiquettes.get(pereDe.get(id)!); naissante = true; }
        if (!de && membresDe.has(id)) {
            de = union(membresDe.get(id)!.map(m => avant.etiquettes.get(m)).filter(Boolean) as DOMRect[]) || undefined;
            naissante = true;
        }
        if (!de) {
            g.animate([{ opacity: 0 }, { opacity: 1 }], facon);
            return;
        }
        const dx = de.x + de.width / 2 - (vers.x + vers.width / 2);
        const dy = de.y + de.height / 2 - (vers.y + vers.height / 2);
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !naissante) return;
        g.animate([
            { transform: `translate(${dx}px, ${dy}px)`, opacity: naissante ? 0 : 1 },
            { transform: "none", opacity: 1 }
        ], facon);
    });

    // --- Valeurs des rubans, titres et commandes : une fois le mouvement fait.
    svg.querySelectorAll("text.link-value, ." + CLASSE_COMMANDES).forEach(el => {
        el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }],
                   { duration: DUREE, easing: "linear" });
    });
}
