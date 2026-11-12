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
const CLASSE_CALQUE = "sous-flux-calque";

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
    effacerSousFlux(svg);
    svg.classList.add(CLASSE_SURVOL);

    const actifs = new Set<string>([focus]);
    retenus.forEach((_r, cle) => cle.split("\u0000").forEach(id => actifs.add(id)));

    const calques = new Map<Element, SVGGElement>();
    rubans(svg).forEach(ruban => {
        const r = retenus.get(cleLien(ruban.getAttribute("data-source") || "",
            ruban.getAttribute("data-target") || ""));
        if (!r || !(r.part > 0)) return;
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

/** Rend au dessin son état d'avant le survol. */
export function effacerSousFlux(svg: SVGSVGElement): void {
    svg.classList.remove(CLASSE_SURVOL);
    svg.querySelectorAll("." + CLASSE_CALQUE).forEach(el => el.remove());
    svg.querySelectorAll("." + CLASSE_ETEINT).forEach(el => el.classList.remove(CLASSE_ETEINT));
}
