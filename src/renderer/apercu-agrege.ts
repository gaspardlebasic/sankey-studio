// L'aperçu d'un diagramme À NIVEAUX : ce qu'on dessine pour un état de
// dépliage, et les commandes qu'on pose dessus.
//
// Partagé par l'éditeur (aperçu du complément) et par la visionneuse de
// l'export HTML (src/visionneuse) : les deux doivent dessiner EXACTEMENT la
// même chose, et une copie de ces règles divergerait sans qu'on le voie.

import { FlowModel, FlowNode, SankeyOptions } from "./types";
import { renderSankey, renderSankeyGroups } from "./engine";
import { projeter } from "../shared/agregation.js";
import type { Cadre } from "../shared/agregation.js";
import { poserCommandes } from "./depliage";

/** Teinte du nœud « (non détaillé) » : un reste, pas une catégorie. */
export const COULEUR_RESTE = "#bdbdbd";

/** Le modèle a-t-il des niveaux ? Sinon, ni ⊕ ni boutons de niveaux. */
export function aDesNiveaux(m: FlowModel): boolean {
    return m.nodes.some(n => n.parent);
}

/**
 * Ce que l'aperçu dessine. Sans hiérarchie, le modèle TEL QUEL — c'est ce qui
 * garantit qu'un diagramme sans parent s'affiche au pixel près comme avant.
 * Avec, sa projection (src/shared/agregation.js) : un parent déplié cède sa
 * place à ses enfants, et la part de ses flux qu'ils ne détaillent pas va à son
 * « (non détaillé) », grisé.
 */
export function modeleAffiche(m: FlowModel, deplies: Set<string>): FlowModel {
    if (!aDesNiveaux(m)) return m;
    const p = projeter(m, deplies);
    const parId = new Map(m.links.map(l => [l.id, l]));
    return {
        nodes: p.nodes.map(n => n.virtuel ? { ...n, color: COULEUR_RESTE } : n),
        links: p.links.map(a => {
            // Un flux affiché qui ne vient que d'un lien en garde l'apparence
            // (couleur propre comprise) ; un flux sommé n'a que la sienne.
            const seul = a.liens.length === 1 ? parId.get(a.liens[0] || "") : undefined;
            const base = seul ? { ...seul } : { id: a.id, unit: a.unit };
            return { ...base, source: a.source, target: a.target, value: a.value, bio: a.bio };
        })
    };
}

/**
 * Un sous-diagramme par filière, dans l'ordre d'apparition des nœuds. Les liens
 * qui traversent deux filières n'appartiennent à aucun bloc : ils disparaissent
 * de l'aperçu séparé, par construction.
 */
export function groupesParFiliere(m: FlowModel): { nom: string; model: FlowModel }[] {
    const ordre: string[] = [];
    m.nodes.forEach(n => {
        const f = n.filiere || "";
        if (!ordre.includes(f)) ordre.push(f);
    });
    return ordre.map(f => {
        const ns: FlowNode[] = m.nodes.filter(n => (n.filiere || "") === f);
        const ids = new Set(ns.map(n => n.id));
        return {
            nom: f,
            model: { nodes: ns, links: m.links.filter(l => ids.has(l.source) && ids.has(l.target)) }
        };
    });
}

/** Dessine le diagramme pour un état de dépliage : un Sankey, ou un par filière. */
export function dessinerAgrege(
    svg: SVGSVGElement, m: FlowModel, options: SankeyOptions, deplies: Set<string>,
    w: number, h: number, fond = "#ffffff"
): void {
    const groupes = groupesParFiliere(m).map(g => ({ nom: g.nom, model: modeleAffiche(g.model, deplies) }));
    if (options.filieres.split && groupes.length > 1) {
        renderSankeyGroups(svg, groupes, options, w, h, fond);
    } else {
        renderSankey(svg, modeleAffiche(m, deplies), options, w, h, fond);
    }
}

/**
 * Pose les ⊕ / ⊖ sur un dessin à l'écran et rend ses cadres (pour animer le
 * geste suivant). La projection est celle de tout le modèle : elle vaut celle
 * de chaque bloc, un parent et ses enfants partageant toujours leur filière.
 */
export function poserCommandesAgregees(svg: SVGSVGElement, m: FlowModel, deplies: Set<string>): Cadre[] {
    if (!aDesNiveaux(m)) return [];
    const p = projeter(m, deplies);
    poserCommandes(svg, p.nodes, p.cadres);
    return p.cadres;
}
