// Dévoilement colonne par colonne de l'aperçu.
//
// Le dessin est TOUJOURS celui du diagramme entier : le moteur calcule une
// disposition unique, puis ce module masque les colonnes qui ne sont pas encore
// montrées. Une colonne qui arrive ne déplace donc rien — c'est l'exigence de la
// fonctionnalité, et la raison de ne pas redessiner un modèle tronqué (d3
// répartirait alors les colonnes visibles sur toute la largeur).
//
// Le moteur pose `data-layer` sur tout ce qui appartient à une colonne : nœuds,
// contours, rubans, bandeaux bio, valeurs écrites sur les rubans, étiquettes et
// entêtes. Les commandes ⊕ / ⊖, elles, ne sont posées que sur les nœuds encore
// visibles (src/renderer/depliage.ts).

/** Durée du fondu d'une colonne qui arrive. */
const DUREE = 320;
const EASE = "cubic-bezier(.25,.1,.25,1)";

/** L'utilisatrice a-t-elle demandé moins de mouvement ? */
function mouvementReduit(): boolean {
    try {
        return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
        return false;
    }
}

/**
 * Nombre de colonnes peintes dans le dessin. On le lit sur les repères
 * `data-layer` — les couches RÉELLEMENT peintes — et non sur les numéros de
 * colonne du modèle : d3 tasse les couches quand la plus longue chaîne de liens
 * est plus courte que le nombre de colonnes.
 */
export function nombreDeColonnes(svg: SVGSVGElement): number {
    let max = -1;
    svg.querySelectorAll("[data-layer]").forEach(el => {
        const couche = Number(el.getAttribute("data-layer"));
        if (isFinite(couche)) max = Math.max(max, couche);
    });
    return max + 1;
}

/**
 * Applique un état de dévoilement : les colonnes d'indice >= `visibles` sont
 * masquées, les autres montrées.
 *
 * `animerDepuis`, quand il est donné, est le premier indice à faire apparaître
 * en fondu — la ou les colonnes que les flèches viennent de demander. Une
 * colonne qu'on masque disparaît sans animation : c'est un retour en arrière,
 * il doit être immédiat.
 */
export function appliquerDevoilement(
    svg: SVGSVGElement,
    visibles: number,
    animerDepuis?: number
): void {
    const aAnimer: Element[] = [];
    svg.querySelectorAll("[data-layer]").forEach(el => {
        const couche = Number(el.getAttribute("data-layer"));
        if (!isFinite(couche)) return;
        if (couche >= visibles) {
            el.setAttribute("visibility", "hidden");
            return;
        }
        if (el.getAttribute("visibility") === "hidden") el.removeAttribute("visibility");
        if (animerDepuis !== undefined && couche >= animerDepuis) aAnimer.push(el);
    });

    if (!aAnimer.length || mouvementReduit() || typeof Element.prototype.animate !== "function") {
        return;
    }
    aAnimer.forEach(el => {
        el.animate(
            [{ opacity: 0 }, { opacity: 1 }],
            { duration: DUREE, easing: EASE }
        );
    });
}
