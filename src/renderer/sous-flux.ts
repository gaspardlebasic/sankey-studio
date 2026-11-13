// Sous-flux d'un nœud, peint PAR-DESSUS l'aperçu au survol.
//
// Le calcul vit dans src/shared/sous-flux.js (pur) ; ici, on ne fait que le
// montrer sur un dessin déjà en place. Comme le repère de sélection et les
// ⊕ / ⊖, rien de tout ça n'est connu du moteur : il fait aussi les exports, où
// un survol n'a rien à faire. Le tracé de chaque bande est repris de la
// géométrie que le moteur sérialise sur chaque ruban (`data-ruban`) — la
// même que celle de l'animation du dépliage —, donc il épouse exactement le
// ruban : escales, courbure, pointe de flèche.
//
// Ne connaît ni l'éditeur ni Excel.

import { cheminBande, GeometrieRuban } from "./engine";
import { cleLien, Retenu } from "../shared/sous-flux.js";

const SVGNS = "http://www.w3.org/2000/svg";
/** Classe posée sur le SVG le temps du survol : elle estompe tout le dessin. */
export const CLASSE_SURVOL = "survol-sous-flux";
/** Classe des bandes peintes par-dessus les rubans. */
export const CLASSE_BANDE = "sous-flux-bande";
/** Classe des éléments qui ne participent pas au sous-flux. */
const CLASSE_ETEINT = "sous-flux-eteint";
/**
 * Classe des rubans (et bandeaux bio) dont RIEN ne passe par le nœud : ils
 * s'estompent davantage que les rubans dont une part seulement est retenue —
 * le reste de ceux-là se lit encore, en pâle, sous la bande.
 */
export const CLASSE_EXCLU = "sous-flux-exclu";
const CLASSE_CALQUE = "sous-flux-calque";
/** Ruban dont une part au moins passe par le nœud (sert aux tests et au débogage). */
const CLASSE_RETENU = "sous-flux-retenu";
/** Calque qui s'efface en fondu avant d'être retiré (cf. styles.css). */
const CLASSE_PARTANT = "sous-flux-partant";
/** Durée des fondus, la même que la transition CSS de la transparence. */
const DUREE_FONDU_MS = 300;

/** Les rubans peints (pas les bandeaux bio, pas nos propres bandes). */
function rubans(svg: SVGSVGElement): SVGPathElement[] {
    return Array.from(svg.querySelectorAll<SVGPathElement>(
        "path[data-ruban][data-source][data-target]:not(.lien-bio)"
    ));
}

/**
 * Peint le sous-flux de `focus` : chaque ruban concerné reçoit, sur sa tranche
 * haute, une bande de sa propre couleur à hauteur de sa part ; le reste du
 * dessin s'estompe. `retenus` vient de `sousFlux()` sur le modèle DESSINÉ.
 */
export function peindreSousFlux(svg: SVGSVGElement, focus: string, retenus: Map<string, Retenu>): void {
    // D'un nœud à l'autre, les bandes précédentes partent sur-le-champ : seule
    // la transparence du dessin glisse d'un état à l'autre.
    svg.querySelectorAll("." + CLASSE_CALQUE).forEach(el => el.remove());
    remettre(svg);
    svg.classList.add(CLASSE_SURVOL);

    const actifs = new Set<string>([focus]);
    retenus.forEach((_r, cle) => cle.split("\u0000").forEach(id => actifs.add(id)));

    const calques = new Map<Element, SVGGElement>();
    rubans(svg).forEach(ruban => {
        const r = retenus.get(cleLien(ruban.getAttribute("data-source") || "",
            ruban.getAttribute("data-target") || ""));
        if (!r || !(r.part > 0)) return;
        ruban.classList.add(CLASSE_RETENU);
        let g: GeometrieRuban;
        try { g = JSON.parse(ruban.getAttribute("data-ruban") || ""); } catch { return; }
        // Juste au-dessus du groupe des rubans : par-dessus tous, sous les nœuds.
        const groupe = ruban.parentNode as Element;
        let calque = calques.get(groupe);
        if (!calque) {
            calque = document.createElementNS(SVGNS, "g") as SVGGElement;
            calque.setAttribute("class", CLASSE_CALQUE);
            calque.setAttribute("pointer-events", "none");
            groupe.parentNode?.insertBefore(calque, groupe.nextSibling);
            calques.set(groupe, calque);
        }
        const bande = document.createElementNS(SVGNS, "path");
        bande.setAttribute("class", CLASSE_BANDE);
        bande.setAttribute("d", cheminBande({ ...g, a: g.de + (g.a - g.de) * Math.min(1, r.part) }));
        ["fill", "fill-opacity", "visibility", "data-source", "data-target", "data-layer"].forEach(a => {
            const v = ruban.getAttribute(a);
            if (v !== null) bande.setAttribute(a, v);
        });
        bande.setAttribute("data-part", String(r.part));
        calque.appendChild(bande);
    });

    // Rubans et bandeaux bio dont rien ne passe par le nœud : les plus pâles.
    svg.querySelectorAll("path[data-ruban][data-source][data-target]").forEach(el => {
        const r = retenus.get(cleLien(el.getAttribute("data-source") || "", el.getAttribute("data-target") || ""));
        if (!r || !(r.part > 0)) el.classList.add(CLASSE_EXCLU);
    });

    // Ce qui ne participe pas s'estompe : nœuds, contours, étiquettes, et les
    // valeurs écrites sur les rubans dont on ne montre qu'une part (le chiffre
    // dirait le flux entier, pas celui qui passe par le nœud).
    svg.querySelectorAll("rect[data-id], rect[data-outline-for], g[data-label-for]").forEach(el => {
        const id = el.getAttribute("data-id") || el.getAttribute("data-outline-for")
            || el.getAttribute("data-label-for") || "";
        if (!actifs.has(id)) el.classList.add(CLASSE_ETEINT);
    });
    svg.querySelectorAll(".link-value").forEach(el => {
        const r = retenus.get(cleLien(el.getAttribute("data-source") || "", el.getAttribute("data-target") || ""));
        if (!r || r.part < 1 - 1e-9) el.classList.add(CLASSE_ETEINT);
    });
}

/**
 * Rend au dessin son état d'avant le survol. La transparence revient par la
 * transition CSS ; les bandes, elles, s'effacent en fondu (calque « partant »)
 * puis sont retirées — les ôter d'un coup ferait sauter le ruban d'un cran
 * avant même que sa transparence ait commencé à remonter.
 */
export function effacerSousFlux(svg: SVGSVGElement): void {
    remettre(svg);
    svg.querySelectorAll("." + CLASSE_CALQUE + ":not(." + CLASSE_PARTANT + ")").forEach(el => {
        el.classList.add(CLASSE_PARTANT);
        // Plus de repères : une bande qui s'efface n'est plus le sous-flux de personne.
        el.querySelectorAll("[data-source]").forEach(b => {
            b.removeAttribute("data-source");
            b.removeAttribute("data-target");
        });
        setTimeout(() => el.remove(), DUREE_FONDU_MS);
    });
}

/** Retire les marques du survol (classes), sans toucher aux calques. */
function remettre(svg: SVGSVGElement): void {
    svg.classList.remove(CLASSE_SURVOL);
    [CLASSE_ETEINT, CLASSE_EXCLU, CLASSE_RETENU].forEach(c =>
        svg.querySelectorAll("." + c).forEach(el => el.classList.remove(c)));
}

/* ---- Transition d'un clic : le diagramme global s'efface, le sous-flux
   prend sa place à sa nouvelle échelle ----
   La déformation elle-même est celle du dépliage (animerTransition) : les
   nœuds qui restent glissent vers leur nouvelle boîte, les rubans retenus
   partent de leur bande. Ici, deux choses seulement : dire de quelle part
   chaque ruban repart, et garder un FANTÔME de l'ancien dessin qui s'efface
   sous le nouveau. */

/**
 * La part peinte au survol, par lien — d'où chaque ruban du sous-flux repart.
 * Rien si le survol n'était pas peint (clic au clavier, survol déjà effacé).
 */
export function partsPeintes(svg: SVGSVGElement): ((source: string, cible: string) => number | undefined) | undefined {
    const parts = new Map<string, number>();
    svg.querySelectorAll("." + CLASSE_CALQUE + ":not(." + CLASSE_PARTANT + ") ." + CLASSE_BANDE).forEach(b => {
        const p = parseFloat(b.getAttribute("data-part") || "");
        if (p > 0) parts.set(cleLien(b.getAttribute("data-source") || "", b.getAttribute("data-target") || ""), p);
    });
    if (!parts.size) return undefined;
    return (s, t) => parts.get(cleLien(s, t));
}

/** Classe du fantôme de l'ancien dessin, le temps de son effacement. */
export const CLASSE_FANTOME = "sous-flux-fantome";

/**
 * Copie FIGÉE de ce qui, dans le dessin en place, ne survit pas au filtre :
 * les rubans (tels qu'estompés), les nœuds, contours, étiquettes et valeurs
 * éteints, les titres. Les nœuds retenus n'y sont pas — ils glissent dans le
 * nouveau dessin. À relever AVANT que le dessin soit remplacé.
 *
 * La copie ne porte plus aucun repère (`data-*`, classes) : ni les tests, ni
 * le dévoilement, ni l'animation ne doivent la prendre pour le dessin.
 */
export function fantomeDuDessin(svg: SVGSVGElement): SVGGElement {
    const fantome = document.createElementNS(SVGNS, "g") as SVGGElement;
    fantome.setAttribute("class", CLASSE_FANTOME);
    fantome.setAttribute("pointer-events", "none");
    const garde = (el: Element): boolean => {
        if (el.classList.contains(CLASSE_CALQUE)) return false;
        if (el.matches("rect[data-id], rect[data-outline-for], g[data-label-for], .link-value")) {
            return el.classList.contains(CLASSE_ETEINT);
        }
        // Repère de sélection, ⊕ / ⊖ : ils seront reposés sur le nouveau dessin.
        return !el.matches(".apercu-selection, .commandes-depliage, title");
    };
    Array.from(svg.children).forEach((enfant, i) => {
        if (i === 0 && enfant.tagName.toLowerCase() === "rect") return;      // le fond
        if (!garde(enfant)) return;
        fantome.appendChild(copieFigee(enfant, garde));
    });
    return fantome;
}

/** Copie profonde d'un élément, transparence peinte comprise, sans repères. */
function copieFigee(el: Element, garde: (el: Element) => boolean): Element {
    const copie = el.cloneNode(false) as Element;
    Array.from(copie.attributes).forEach(a => {
        if (a.name.startsWith("data-") || a.name === "class") copie.removeAttribute(a.name);
    });
    // La transparence venait des classes du survol, qui ne suivent pas la copie.
    const o = parseFloat(getComputedStyle(el).opacity);
    if (o < 1) (copie as SVGElement).style.opacity = String(o);
    Array.from(el.childNodes).forEach(n => {
        if (n.nodeType === 1) {
            if (garde(n as Element)) copie.appendChild(copieFigee(n as Element, garde));
        } else {
            copie.appendChild(n.cloneNode(false));
        }
    });
    return copie;
}

/**
 * Pose le fantôme SOUS le nouveau dessin (juste après son fond) et l'efface en
 * `DUREE_FONDU_MS`, puis le retire. Rien si l'utilisatrice a demandé moins de
 * mouvement : le dessin change alors d'un coup, comme avant.
 */
export function poserFantome(svg: SVGSVGElement, fantome: SVGGElement): void {
    if (moinsDeMouvement() || typeof Element.prototype.animate !== "function") return;
    const fond = svg.firstElementChild;
    svg.insertBefore(fantome, fond && fond.tagName.toLowerCase() === "rect" ? fond.nextSibling : fond);
    const retirer = () => { if (fantome.isConnected) fantome.remove(); };
    const a = fantome.animate([{ opacity: 1 }, { opacity: 0 }],
        { duration: DUREE_FONDU_MS, easing: "ease-out", fill: "forwards" });
    a.onfinish = retirer;
    // Filet : une page cachée ne fait plus d'images, l'animation ne finirait pas.
    setTimeout(retirer, DUREE_FONDU_MS * 3);
}

function moinsDeMouvement(): boolean {
    try { return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches; }
    catch { return false; }
}

