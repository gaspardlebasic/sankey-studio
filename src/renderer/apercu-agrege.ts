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
import { resoudreEquilibrage } from "../shared/equilibrage.js";
import { poserCommandes } from "./depliage";
import { filtrerChaine } from "../shared/sous-flux.js";

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
 *
 * Dans les deux cas, l'équilibrage passe d'abord : une valeur de flux inconnue
 * qu'un nœud permet de déduire est calculée AVANT la projection, sinon les
 * totaux des parents repliés seraient faux. Le calcul ne touche pas le modèle
 * de l'éditeur.
 */
export function modeleAffiche(m: FlowModel, deplies: Set<string>): FlowModel {
    const resolu = resoudreEquilibrage(m).model;
    if (!aDesNiveaux(resolu)) return resolu;
    const p = projeter(resolu, deplies);
    const parId = new Map(resolu.links.map(l => [l.id, l]));
    return {
        nodes: p.nodes.map(n => n.virtuel ? { ...n, color: COULEUR_RESTE } : n),
        links: p.links.map(a => {
            // Un flux affiché qui ne vient que d'un lien en garde l'apparence
            // (couleur propre comprise) ; un flux sommé n'a que la sienne.
            const seul = a.liens.length === 1 ? parId.get(a.liens[0] || "") : undefined;
            const base = seul ? { ...seul } : { id: a.id, unit: a.unit };
            const lien: FlowModel["links"][number] = {
                ...base, source: a.source, target: a.target, value: a.value, bio: a.bio
            };
            if (a.calculee) lien.calculee = true;
            return lien;
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

/**
 * Ce que l'aperçu dessine réellement : un bloc, ou un par filière, pour un état
 * de dépliage et un filtre de sous-flux (`filtre` : les nœuds cliqués, dans
 * l'ordre — cf. src/shared/sous-flux.js). Sans filtre, exactement ce qu'on
 * dessinait avant.
 *
 * Le filtre porte sur le modèle AFFICHÉ — projeté, filières empilées comprises :
 * on filtre ce qu'on voit. Les blocs empilés sont réunis le temps du calcul
 * (aucun lien ne les relie, c'est donc le même que bloc par bloc), puis
 * redécoupés ; ceux que le filtre a vidés disparaissent.
 */
export function blocsDessines(
    m: FlowModel, options: SankeyOptions, deplies: Set<string>, filtre: string[] = []
): { empiles: boolean; blocs: { nom: string; model: FlowModel }[] } {
    /* L'équilibrage se calcule sur le diagramme ENTIER, avant de le découper
       par filière : un flux qui traverse deux filières reste un flux du nœud,
       même s'il disparaît de l'aperçu séparé. */
    const resolu = resoudreEquilibrage(m).model;
    const groupes = groupesParFiliere(resolu)
        .map(g => ({ nom: g.nom, model: modeleAffiche(g.model, deplies) }));
    const empiles = options.filieres.split && groupes.length > 1;
    if (!filtre.length) {
        return { empiles, blocs: empiles ? groupes : [{ nom: "", model: modeleAffiche(resolu, deplies) }] };
    }
    const tout = empiles ? reunir(groupes.map(g => g.model)) : modeleAffiche(resolu, deplies);
    const filtre_ = filtrerChaine(tout, filtre);
    if (!empiles) return { empiles, blocs: [{ nom: "", model: filtre_ }] };
    return { empiles, blocs: groupesParFiliere(filtre_).filter(g => g.model.nodes.length) };
}

/** Le modèle dessiné, d'un seul tenant : celui sur lequel se lit un sous-flux. */
export function modeleDessine(
    m: FlowModel, options: SankeyOptions, deplies: Set<string>, filtre: string[] = []
): FlowModel {
    return reunir(blocsDessines(m, options, deplies, filtre).blocs.map(b => b.model));
}

function reunir(modeles: FlowModel[]): FlowModel {
    if (modeles.length === 1) return modeles[0];
    return { nodes: modeles.flatMap(x => x.nodes), links: modeles.flatMap(x => x.links) };
}

/** Dessine le diagramme pour un état de dépliage : un Sankey, ou un par filière. */
export function dessinerAgrege(
    svg: SVGSVGElement, m: FlowModel, options: SankeyOptions, deplies: Set<string>,
    w: number, h: number, fond = "#ffffff", filtre: string[] = []
): void {
    const d = blocsDessines(m, options, deplies, filtre);
    if (d.empiles) {
        renderSankeyGroups(svg, d.blocs, options, w, h, fond);
    } else {
        renderSankey(svg, d.blocs[0].model, options, w, h, fond);
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
