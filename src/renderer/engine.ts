// Moteur de rendu Sankey — porté depuis le visuel Power BI (visual.ts),
// rendu indépendant de tout framework, dans un élément <svg>.

import { select } from "d3-selection";
import { sankey } from "d3-sankey";
import {
    FlowModel, SankeyOptions, NodeKind, NodeTypeStyle, NodeTypeFont, NodeOutline,
    NodeLabelPosition, NODE_LABEL_POSITIONS, kindOf, defaultTypeStyle, texteAffiche
} from "./types";

interface ENode {
    id: string;
    name: string;
    layer: number;
    lane: number;
    order: number;
    kind: NodeKind;
    color: string | null;
    /** Nœud de passage : place réservée à un ruban qui ne fait que traverser
     *  cette colonne. Il occupe de la hauteur mais ne se dessine jamais. */
    passage?: boolean;
    /** Ordonnée visée par un nœud de passage — départage deux passages qui
     *  tombent au même rang dans la même cellule. */
    yEstime?: number;
    x0?: number;
    x1?: number;
    y0?: number;
    y1?: number;
    value?: number;
    sourceLinks?: ELink[];
    targetLinks?: ELink[];
}

/** Point de passage d'un ruban dans une colonne qu'il ne fait que traverser. */
interface Passage {
    x0: number;
    x1: number;
    y: number; // ordonnée de l'AXE du ruban à cet endroit
}

interface ELink {
    id: string;
    source: string | ENode;
    target: string | ENode;
    value: number;
    unit: string;
    colorOverride: string | null;
    y0?: number;
    y1?: number;
    width?: number;
    /** Colonnes traversées, de gauche à droite (vide pour un lien d'une colonne
     *  à la suivante). Le ruban passe par ces places au lieu d'aller tout droit. */
    passages?: Passage[];
}

/** Couloir d'un nœud, ramené à un entier >= 1. */
function laneOf(n: { lane?: number }): number {
    const v = Math.round(n.lane as number);
    return isFinite(v) && v >= 1 ? v : 1;
}

/* ------------------------- apparence par type ------------------------- */

/** Réglages d'un type de nœud, complétés si le projet en ignore une partie. */
function styleDuType(opt: SankeyOptions, kind: NodeKind): NodeTypeStyle {
    const t = opt.nodeTypes && opt.nodeTypes[kind];
    if (!t) return defaultTypeStyle();
    return {
        width: typeof t.width === "number" ? t.width : null,
        font: t.font || null,
        position: positionValide(t.position),
        outline: Object.assign(defaultTypeStyle().outline, t.outline || {})
    };
}

/** Une position d'étiquette connue, sinon null (= suivre le réglage global). */
function positionValide(p: unknown): NodeLabelPosition | null {
    return NODE_LABEL_POSITIONS.some(([v]) => v === p) ? (p as NodeLabelPosition) : null;
}

/**
 * Largeur d'un type de nœud. Sans réglage propre, c'est la largeur globale —
 * bornée comme avant (1..60) pour ne rien déplacer dans un projet existant ;
 * un réglage propre va jusqu'à 0 (le nœud se réduit à un trait) et 200.
 */
function largeurDuType(opt: SankeyOptions, kind: NodeKind): number {
    const w = styleDuType(opt, kind).width;
    return w === null ? clamp(opt.nodes.nodeWidth, 1, 60) : clamp(w, 0, 200);
}

/** Police d'un type de nœud, à défaut celle des étiquettes. */
export function policeDuType(opt: SankeyOptions, kind: NodeKind): NodeTypeFont {
    const f = styleDuType(opt, kind).font;
    if (f) return f;
    const NL = opt.nodeLabels;
    return {
        fontFamily: NL.fontFamily,
        fontSize: NL.fontSize,
        fontColor: NL.fontColor,
        weight: typeof NL.weight === "number" ? NL.weight : 400,
        italic: NL.italic,
        uppercase: !!NL.uppercase
    };
}

/** Position de l'étiquette d'un type, à défaut celle des étiquettes. */
export function positionDuType(opt: SankeyOptions, kind: NodeKind): NodeLabelPosition {
    return styleDuType(opt, kind).position ?? opt.nodeLabels.position;
}

/** Assombrit une couleur #rrggbb de `pct` % (0 = inchangée, 100 = noir). */
function assombrir(hex: string, pct: number): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return "#000000";
    const k = 1 - clamp(pct, 0, 100) / 100;
    const n = parseInt(m[1], 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        .map(v => Math.max(0, Math.min(255, Math.round(v * k))));
    return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
}

/** Trait du contour : couleur du nœud assombrie, ou noir rendu transparent. */
function traitContour(o: NodeOutline, couleurNoeud: string): { color: string; opacity: number } {
    if (o.mode === "noir") return { color: "#000000", opacity: clamp(o.intensity, 0, 100) / 100 };
    return { color: assombrir(couleurNoeud, o.intensity), opacity: 1 };
}

/**
 * Numéros de colonne -> indices contigus (0, 1, 2…). Une colonne 1 puis 5 sans
 * rien entre les deux donne deux couches voisines, pas cinq.
 */
function denseColonnes(colonnes: number[]): Map<number, number> {
    const d = new Map<number, number>();
    Array.from(new Set(colonnes))
        .sort((a, b) => a - b)
        .forEach((c, i) => d.set(c, i));
    return d;
}

/**
 * Couche de chaque nœud : plus long chemin depuis la gauche, borné par la
 * colonne demandée. Un nœud est décalé d'une colonne vers la droite si un lien
 * l'exige (cible après source), ce qui garantit un flux gauche→droite valide
 * même si deux nœuds reliés partagent le même numéro de colonne.
 */
function couchesModele(model: FlowModel, dense: Map<number, number>): Map<string, number> {
    const existe = new Set(model.nodes.map(n => n.id));
    const couches = new Map<string, number>();
    model.nodes.forEach(n => couches.set(n.id, dense.get(n.column) ?? 0));
    const liens = model.links.filter(l => existe.has(l.source) && existe.has(l.target));
    let change = true;
    let garde = 0;
    while (change && garde++ < model.nodes.length + 5) {
        change = false;
        for (const l of liens) {
            const besoin = (couches.get(l.source) ?? 0) + 1;
            if (besoin > (couches.get(l.target) ?? 0)) {
                couches.set(l.target, besoin);
                change = true;
            }
        }
    }
    return couches;
}

/**
 * Grille commune à plusieurs diagrammes empilés : même correspondance
 * colonne -> couche et même nombre de couches, pour que la colonne 3 de chaque
 * filière tombe à la même abscisse.
 */
export interface GrilleColonnes {
    dense: Map<number, number>;
    nCols: number;
}

export function renderSankey(
    svgEl: SVGSVGElement,
    model: FlowModel,
    opt: SankeyOptions,
    width: number,
    height: number,
    fond: string = "#ffffff"
): void {
    const svg = select(svgEl);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    // Fond (blanc pour l'aperçu, "none" pour un export transparent)
    if (fond !== "none") {
        svg.append("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", width)
            .attr("height", height)
            .attr("fill", fond);
    }

    if (!model.links.length || !model.nodes.length) {
        return;
    }

    const haut = clamp(opt.chart.marginTop, 0, 2000);
    const bas = clamp(opt.chart.marginBottom, 0, 2000);
    const utile = Math.max(40, height - haut - bas);
    drawSankey(svg.append("g").attr("transform", `translate(0,${haut})`), model, opt, width, utile);
}

/**
 * Poids d'un diagramme : total de flux de sa colonne la plus chargée, et nombre
 * maximal de nœuds dans une colonne. Ces deux mesures suffisent à donner la même
 * échelle à plusieurs diagrammes — d3-sankey étire la colonne la plus chargée sur
 * la hauteur disponible, moins les espaces entre nœuds.
 */
/** Échelle obtenue par d3-sankey pour ce modèle à cette hauteur, sans rien afficher. */
function mesurerEchelle(
    model: FlowModel,
    opt: SankeyOptions,
    width: number,
    height: number,
    grille?: GrilleColonnes
): number {
    const detache = select(document.createElementNS("http://www.w3.org/2000/svg", "g"));
    return drawSankey(detache, model, opt, width, height, grille);
}

/**
 * Empile un Sankey par filière : titre, diagramme, espace, titre suivant…
 * Chaque bloc reçoit une part égale de la hauteur disponible.
 */
export function renderSankeyGroups(
    svgEl: SVGSVGElement,
    groupes: { nom: string; model: FlowModel }[],
    opt: SankeyOptions,
    width: number,
    height: number,
    fond: string = "#ffffff"
): void {
    const svg = select(svgEl);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    if (fond !== "none") {
        svg.append("rect")
            .attr("x", 0).attr("y", 0)
            .attr("width", width).attr("height", height)
            .attr("fill", fond);
    }

    const utiles = groupes.filter(g => g.model.nodes.length && g.model.links.length);
    if (!utiles.length) return;

    /* Grille de colonnes COMMUNE à tous les diagrammes : sans elle, chacun
       répartit ses propres colonnes sur toute la largeur et la colonne 3 d'une
       filière ne tombe pas en face de la colonne 3 de la suivante. */
    const dense = denseColonnes(
        utiles.reduce<number[]>((t, g) => t.concat(g.model.nodes.map(n => n.column)), [])
    );
    let nCols = 1;
    utiles.forEach(g => {
        couchesModele(g.model, dense).forEach(c => { nCols = Math.max(nCols, c + 1); });
    });
    const grille: GrilleColonnes = { dense, nCols };

    const F = opt.filieres;
    const taille = clamp(F.fontSize, 4, 60);
    const sousTitre = clamp(F.titleSpace, 0, 200);
    const ecart = clamp(F.gap, 0, 400);
    const margeHaut = clamp(opt.chart.marginTop, 0, 2000);
    const margeBas = clamp(opt.chart.marginBottom, 0, 2000);
    const hauteurTitre = F.showTitle ? taille + sousTitre : 0;
    const dispo =
        height - margeHaut - margeBas
        - utiles.length * hauteurTitre
        - (utiles.length - 1) * ecart;

    /* Hauteur de chaque bloc.
       - échelle commune : la hauteur est proportionnelle au flux, si bien qu'une
         même unité occupe la même épaisseur dans tous les diagrammes ;
       - sinon : chacun reçoit la même part et remplit sa case. */
    let hauteurs: number[];
    if (F.sameScale && utiles.length > 1) {
        /* On mesure l'échelle que d3-sankey obtient à deux hauteurs d'essai plutôt
           que de tenter de la prédire : pour un diagramme donné elle est affine en
           la hauteur, échelle(h) = a·h + b. On résout ensuite la hauteur à donner à
           chacun pour que tous partagent la même échelle. */
        const H1 = 300;
        const H2 = 600;
        const coef = utiles.map(g => {
            const e1 = mesurerEchelle(g.model, opt, width, H1, grille);
            const e2 = mesurerEchelle(g.model, opt, width, H2, grille);
            const a = (e2 - e1) / (H2 - H1);
            return { a, b: e1 - a * H1 };
        });
        if (coef.every(c => c.a > 0)) {
            const sommeInv = coef.reduce((s, c) => s + 1 / c.a, 0);
            const sommeRap = coef.reduce((s, c) => s + c.b / c.a, 0);
            const k = (dispo + sommeRap) / sommeInv;
            hauteurs = coef.map(c => Math.max(40, (k - c.b) / c.a));
        } else {
            hauteurs = utiles.map(() => Math.max(40, dispo / utiles.length));
        }
    } else {
        hauteurs = utiles.map(() => Math.max(40, dispo / utiles.length));
    }

    const ancre = F.align === "centre" ? "middle" : F.align === "droite" ? "end" : "start";
    const xTitre = F.align === "centre" ? width / 2 : F.align === "droite" ? width - 12 : 12;

    let y = margeHaut;
    utiles.forEach((g, i) => {
        if (F.showTitle) {
            svg.append("text")
                .attr("x", xTitre)
                .attr("y", y + taille)
                .attr("text-anchor", ancre)
                .attr("fill", F.fontColor)
                .style("font-family", F.fontFamily)
                .style("font-size", taille + "px")
                .style("font-weight", String(F.weight))
                .style("font-style", F.italic ? "italic" : "normal")
                .text(texteAffiche(g.nom || "(sans filière)", F));
            y += hauteurTitre;
        }
        const bloc = svg.append("g").attr("transform", `translate(0,${y})`);
        drawSankey(bloc, g.model, opt, width, hauteurs[i], grille);
        y += hauteurs[i];
        if (i < utiles.length - 1) y += ecart;
    });
}

/**
 * Range les nœuds en couloirs horizontaux.
 *
 * d3-sankey empile tous les nœuds d'une colonne d'un bloc ; on reprend ici les
 * hauteurs qu'il a calculées (proportionnelles au flux) et on les redistribue :
 * une bande par couloir, chaque bande aussi haute que sa colonne la plus
 * chargée, les bandes séparées par `opt.lanes.gap`.
 *
 * Si l'ensemble ne tient pas dans la hauteur disponible, tout est réduit d'un
 * même facteur — nœuds ET rubans — pour que les épaisseurs restent comparables
 * entre elles.
 */
function placerParCouloirs(
    graph: { nodes: ENode[]; links: ELink[] },
    couloirs: number[],
    opt: SankeyOptions,
    top: number,
    bottom: number,
    nodePadding: number
): void {
    const ecart = clamp(opt.lanes.gap, 0, 400);
    const dispo = bottom - top;
    const gaps = (couloirs.length - 1) * ecart;

    // Cellules (couloir, couche), chacune triée par ordre d'affichage.
    const cellules = new Map<string, ENode[]>();
    graph.nodes.forEach(n => {
        const cle = n.lane + "|" + n.layer;
        if (!cellules.has(cle)) cellules.set(cle, []);
        cellules.get(cle)!.push(n);
    });
    cellules.forEach(list => list.sort((a, b) => a.order - b.order));

    const hauteurCellule = (list: ENode[], k: number) =>
        list.reduce((t, n) => t + ((n.y1 ?? 0) - (n.y0 ?? 0)) * k, 0)
        + (list.length - 1) * nodePadding;

    // Hauteur d'un couloir = celle de sa colonne la plus chargée.
    const hauteurCouloir = (lane: number, k: number) => {
        let h = 0;
        cellules.forEach((list, cle) => {
            if (list[0].lane !== lane) return;
            h = Math.max(h, hauteurCellule(list, k));
        });
        return h;
    };

    let k = 1;
    const besoin = () => couloirs.reduce((t, l) => t + hauteurCouloir(l, k), 0) + gaps;
    // Réduction : le besoin est affine en k, deux passes suffisent largement.
    for (let i = 0; i < 3 && besoin() > dispo; i++) {
        const utile = Math.max(1, dispo - gaps);
        const total = Math.max(1, besoin() - gaps);
        k *= utile / total;
    }
    if (k !== 1) {
        graph.nodes.forEach(n => {
            n.y1 = (n.y0 ?? 0) + ((n.y1 ?? 0) - (n.y0 ?? 0)) * k;
        });
        graph.links.forEach(l => { l.width = (l.width ?? 0) * k; });
        k = 1; // les hauteurs sont désormais à l'échelle : plus rien à mettre à l'échelle
    }

    const hauteurs = new Map<number, number>();
    couloirs.forEach(l => hauteurs.set(l, hauteurCouloir(l, 1)));
    const total = couloirs.reduce((t, l) => t + (hauteurs.get(l) ?? 0), 0) + gaps;

    let y = top + Math.max(0, (dispo - total) / 2);
    couloirs.forEach(lane => {
        const hBande = hauteurs.get(lane) ?? 0;
        cellules.forEach(list => {
            if (list[0].lane !== lane) return;
            // Chaque colonne est centrée dans la bande de son couloir.
            let yy = y + (hBande - hauteurCellule(list, 1)) / 2;
            list.forEach(n => {
                const h = (n.y1 ?? 0) - (n.y0 ?? 0);
                n.y0 = yy;
                n.y1 = yy + h;
                yy += h + nodePadding;
            });
        });
        y += hBande + ecart;
    });
}

/** Cadre de dessin et grille des colonnes : ce dont la disposition a besoin. */
interface Cadre {
    left: number;
    right: number;
    top: number;
    bottom: number;
    nCols: number;
    nodeWidth: number;
    nodePadding: number;
    /** Largeur peinte d'un nœud — elle dépend de son type. */
    largeurDe: (n: ENode) => number;
    /** Abscisse de l'axe d'une colonne. */
    axeColonne: (layer: number) => number;
}

/**
 * Place nœuds et rubans dans le cadre : d3-sankey pour les épaisseurs et
 * l'empilement, puis abscisses forcées par la colonne, couloirs, et ancrage des
 * rubans sur les bords des nœuds.
 *
 * Renvoie null si d3 refuse le graphe (lien circulaire, par exemple) — c'est à
 * l'appelant d'afficher le message.
 */
function disposer(
    noeuds: ENode[],
    liens: ELink[],
    opt: SankeyOptions,
    cadre: Cadre
): { nodes: ENode[]; links: ELink[] } | null {
    const gen = sankey<ENode, ELink>()
        .nodeId((d: ENode) => d.id)
        // Les abscisses sont réécrites juste après : d3 n'a besoin que d'une
        // largeur non nulle pour ne pas dégénérer.
        .nodeWidth(Math.max(1, cadre.nodeWidth))
        .nodePadding(cadre.nodePadding)
        .nodeAlign((n: ENode) => n.layer)
        .extent([[cadre.left, cadre.top], [cadre.right, cadre.bottom]]);

    // Ordre vertical des nœuds dans chaque colonne : couloir d'abord (les bandes
    // s'empilent de haut en bas), puis node.order à l'intérieur du couloir. À
    // ordre égal — deux nœuds de passage glissés au même rang — c'est l'ordonnée
    // visée qui tranche, sans quoi leurs rubans se croiseraient.
    gen.nodeSort((a: ENode, b: ENode) =>
        a.lane - b.lane || a.order - b.order || (a.yEstime ?? 0) - (b.yEstime ?? 0));

    let graph: { nodes: ENode[]; links: ELink[] };
    try {
        graph = gen({
            nodes: noeuds.map(n => Object.assign({}, n)),
            links: liens.map(l => Object.assign({}, l))
        }) as { nodes: ENode[]; links: ELink[] };
    } catch (e) {
        return null;
    }

    // Position horizontale forcée par la couche du nœud, chaque nœud centré sur
    // l'axe de sa colonne (cf. `nodeWidth` : la largeur dépend du type).
    (graph.nodes as ENode[]).forEach(n => {
        const w = cadre.largeurDe(n);
        const c = cadre.axeColonne(n.layer);
        n.x0 = c - w / 2;
        n.x1 = c + w / 2;
    });

    const couloirs = Array.from(new Set((graph.nodes as ENode[]).map(n => n.lane)))
        .sort((a, b) => a - b);

    if (couloirs.length > 1) {
        placerParCouloirs(graph, couloirs, opt, cadre.top, cadre.bottom, cadre.nodePadding);
    } else {
        // Centrage vertical de chaque colonne (mise en page historique : on ne
        // touche pas à l'espacement obtenu par d3, seulement à sa position).
        const colBounds = new Map<number, { min: number; max: number }>();
        (graph.nodes as ENode[]).forEach(n => {
            const b = colBounds.get(n.layer) ?? { min: Infinity, max: -Infinity };
            b.min = Math.min(b.min, n.y0 ?? 0);
            b.max = Math.max(b.max, n.y1 ?? 0);
            colBounds.set(n.layer, b);
        });
        const colDelta = new Map<number, number>();
        colBounds.forEach((b, c) =>
            colDelta.set(c, cadre.top + (cadre.bottom - cadre.top - (b.max - b.min)) / 2 - b.min)
        );
        (graph.nodes as ENode[]).forEach(n => {
            const d = colDelta.get(n.layer) ?? 0;
            n.y0 = (n.y0 ?? 0) + d;
            n.y1 = (n.y1 ?? 0) + d;
        });
    }

    /* Empilement des rubans à chaque nœud, du plus haut au plus bas nœud d'en face.
       Un flux qui vient d'en haut arrive en haut du nœud, un flux qui vient d'en
       bas arrive en bas : c'est ce qui empêche deux rubans de se croiser.

       Le tri porte sur la position verticale FINALE du nœud d'en face, jamais sur
       son `order` : l'ordre vertical est propre à une cellule (colonne × couloir),
       si bien que deux nœuds de couloirs — ou de colonnes — différents peuvent
       porter le même, et les comparer n'a aucun sens. */
    const parHauteur = (a: ENode, b: ENode) =>
        (a.y0 ?? 0) - (b.y0 ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

    (graph.nodes as ENode[]).forEach(n => {
        const out = (n.sourceLinks ?? []).slice().sort(
            (a, b) => parHauteur(a.target as ENode, b.target as ENode)
        );
        let sy = n.y0 ?? 0;
        out.forEach(l => {
            l.y0 = sy + (l.width ?? 0) / 2;
            sy += l.width ?? 0;
        });
        const inc = (n.targetLinks ?? []).slice().sort(
            (a, b) => parHauteur(a.source as ENode, b.source as ENode)
        );
        let ty = n.y0 ?? 0;
        inc.forEach(l => {
            l.y1 = ty + (l.width ?? 0) / 2;
            ty += l.width ?? 0;
        });
    });

    return graph;
}

/* --------------- liens qui sautent une colonne : les passages ---------------

   Un lien A(col 1) -> C(col 3) traverse la colonne 2, où B l'attend : tracé tout
   droit, son ruban recouvre B. La parade est de le traiter comme ce qu'il est —
   un flux qui TRAVERSE la colonne 2 — en lui réservant une place dans cette
   colonne, exactement comme à un nœud : une escale, haute comme le ruban, qui
   s'insère dans l'empilement de la colonne et l'écarte des vrais nœuds.

   Trois conséquences, toutes voulues :
   - le ruban ne peut plus recouvrir un nœud, ni dans le cas A-B-C, ni dans le cas
     a-b-c-d + a-d (une escale par colonne traversée) ;
   - la colonne traversée compte enfin le flux qui la traverse : une coupe
     verticale du diagramme totalise le même flux partout, comme il se doit ;
   - l'escale se glisse là où le ruban voulait passer, si bien qu'un flux qui
     longe le haut du diagramme continue de le longer, sans croisement inutile.
*/

/** Place à réserver dans une colonne traversée, pour un lien donné. */
interface PlacePassage {
    layer: number;
    lane: number;
    order: number;
    yEstime: number;
}

/**
 * Décide, à partir d'une première disposition, où chaque lien qui saute une
 * colonne doit s'y glisser : couloir, puis rang parmi les nœuds déjà là.
 * Le repère est l'ordonnée où le ruban passerait s'il allait tout droit — les
 * escales se posent donc sur sa trajectoire naturelle.
 */
function planifierPassages(
    graph: { nodes: ENode[]; links: ELink[] },
    cadre: Cadre
): Map<string, PlacePassage[]> {
    const plans = new Map<string, PlacePassage[]>();

    // Cellules (couloir × colonne), triées par ordonnée peinte, et bandes de
    // chaque couloir : de quoi situer une ordonnée dans la mise en page.
    const cellules = new Map<string, ENode[]>();
    const bandes = new Map<number, { haut: number; bas: number }>();
    (graph.nodes as ENode[]).forEach(n => {
        const cle = n.lane + "|" + n.layer;
        if (!cellules.has(cle)) cellules.set(cle, []);
        cellules.get(cle)!.push(n);
        const b = bandes.get(n.lane) ?? { haut: Infinity, bas: -Infinity };
        b.haut = Math.min(b.haut, n.y0 ?? 0);
        b.bas = Math.max(b.bas, n.y1 ?? 0);
        bandes.set(n.lane, b);
    });
    cellules.forEach(list => list.sort((a, b) => (a.y0 ?? 0) - (b.y0 ?? 0)));
    const couloirs = Array.from(bandes.keys()).sort((a, b) => a - b);

    (graph.links as ELink[]).forEach(l => {
        const s = l.source as ENode;
        const t = l.target as ENode;
        if (t.layer - s.layer < 2) return;
        const xs = s.x1 ?? 0;
        const xt = t.x0 ?? 0;
        const places: PlacePassage[] = [];
        for (let layer = s.layer + 1; layer < t.layer; layer++) {
            const x = cadre.axeColonne(layer);
            const f = xt > xs ? clamp((x - xs) / (xt - xs), 0, 1) : 0.5;
            const y = (l.y0 ?? 0) + ((l.y1 ?? 0) - (l.y0 ?? 0)) * f;
            const lane = couloirTraverse(s.lane, t.lane, y, bandes, couloirs);
            places.push({
                layer,
                lane,
                order: rangDansCellule(cellules.get(lane + "|" + layer), y),
                yEstime: y
            });
        }
        if (places.length) plans.set(l.id, places);
    });
    return plans;
}

/**
 * Couloir où loger une escale : celui dont la bande est la plus proche de
 * l'ordonnée visée, parmi les couloirs situés ENTRE le départ et l'arrivée.
 * Un lien qui reste dans son couloir y garde donc ses escales ; un lien qui
 * change de couloir les pose là où il passe vraiment.
 */
function couloirTraverse(
    depart: number,
    arrivee: number,
    y: number,
    bandes: Map<number, { haut: number; bas: number }>,
    couloirs: number[]
): number {
    const min = Math.min(depart, arrivee);
    const max = Math.max(depart, arrivee);
    const candidats = couloirs.filter(l => l >= min && l <= max);
    if (!candidats.length) return depart;
    let choisi = candidats[0];
    let meilleure = Infinity;
    candidats.forEach(l => {
        const b = bandes.get(l)!;
        const d = y < b.haut ? b.haut - y : y > b.bas ? y - b.bas : 0;
        if (d < meilleure) {
            meilleure = d;
            choisi = l;
        }
    });
    return choisi;
}

/**
 * Rang d'une escale parmi les nœuds d'une cellule : un ordre intercalaire, entre
 * celui du nœud qui la précède et celui du nœud qui la suit à l'écran. Des
 * valeurs fractionnaires suffisent — l'ordre ne sert qu'à trier.
 */
function rangDansCellule(list: ENode[] | undefined, y: number): number {
    if (!list || !list.length) return 0;
    const centre = (n: ENode) => ((n.y0 ?? 0) + (n.y1 ?? 0)) / 2;
    const i = list.findIndex(n => centre(n) > y);
    if (i < 0) return list[list.length - 1].order + 1;
    if (i === 0) return list[0].order - 1;
    return (list[i - 1].order + list[i].order) / 2;
}

/**
 * Découpe chaque lien qui saute une colonne en une chaîne de segments passant
 * par une escale — un nœud de passage — dans chaque colonne traversée.
 * d3-sankey fait alors tout le travail : l'escale, haute comme le flux qui la
 * traverse, prend sa place dans l'empilement de la colonne.
 */
function decomposer(
    noeuds: ENode[],
    liens: ELink[],
    plans: Map<string, PlacePassage[]>
): { noeuds: ENode[]; liens: ELink[]; chaines: Map<string, string[]> } {
    const sortieN = noeuds.slice();
    const sortieL: ELink[] = [];
    const chaines = new Map<string, string[]>();

    liens.forEach(l => {
        const places = plans.get(l.id);
        if (!places || !places.length) {
            sortieL.push(l);
            return;
        }
        const segments: string[] = [];
        let source = l.source as string;
        places.forEach((p, i) => {
            // Le « § » est absent des identifiants du modèle : aucune collision
            // possible avec un vrai nœud ou un vrai lien.
            const idEscale = "§passage§" + l.id + "§" + p.layer;
            sortieN.push({
                id: idEscale,
                name: "",
                layer: p.layer,
                lane: p.lane,
                order: p.order,
                yEstime: p.yEstime,
                kind: "produit",
                color: null,
                passage: true
            });
            const idSeg = l.id + "§" + i;
            sortieL.push(Object.assign({}, l, { id: idSeg, source, target: idEscale }));
            segments.push(idSeg);
            source = idEscale;
        });
        const dernier = l.id + "§" + places.length;
        sortieL.push(Object.assign({}, l, { id: dernier, source, target: l.target }));
        segments.push(dernier);
        chaines.set(l.id, segments);
    });

    return { noeuds: sortieN, liens: sortieL, chaines };
}

/**
 * Recolle les segments d'un lien découpé en un ruban unique : ses extrémités
 * redeviennent les vrais nœuds du modèle, et les escales traversées deviennent
 * les points de passage du tracé.
 */
function recoller(
    graph: { nodes: ENode[]; links: ELink[] },
    origine: ELink[],
    chaines: Map<string, string[]>
): ELink[] {
    const parId = new Map((graph.links as ELink[]).map(l => [l.id, l]));
    const sortie: ELink[] = [];
    origine.forEach(l => {
        const ids = chaines.get(l.id);
        if (!ids) {
            const direct = parId.get(l.id);
            if (direct) sortie.push(direct);
            return;
        }
        const segments = ids.map(id => parId.get(id)).filter((x): x is ELink => !!x);
        if (segments.length < 2) {
            if (segments.length) sortie.push(segments[0]);
            return;
        }
        const premier = segments[0];
        const dernier = segments[segments.length - 1];
        sortie.push(Object.assign({}, l, {
            source: premier.source,
            target: dernier.target,
            // Tous les segments ont la même épaisseur : c'est le même flux.
            width: premier.width,
            y0: premier.y0,
            y1: dernier.y1,
            passages: segments.slice(0, -1).map(s => {
                const escale = s.target as ENode;
                return { x0: escale.x0 ?? 0, x1: escale.x1 ?? 0, y: s.y1 ?? 0 };
            })
        }));
    });
    return sortie;
}

/** Dessine UN diagramme dans le conteneur fourni (fond déjà posé par l'appelant). */
// Chaque diagramme dessiné reçoit un préfixe d'identifiants qui lui est propre :
// plusieurs Sankey coexistent dans le même SVG en mode « par filière », et des
// `id` de dégradés identiques feraient pointer `url(#…)` vers le premier bloc.
let compteurDiagramme = 0;

function drawSankey(
    svg: any,
    model: FlowModel,
    opt: SankeyOptions,
    width: number,
    height: number,
    grille?: GrilleColonnes
): number {
    const prefixe = `d${compteurDiagramme++}`;
    const defs = svg.append("defs");
    const gLinks = svg.append("g");
    // Les contours passent PAR-DESSUS les rubans (ils entourent le nœud, rubans
    // compris) mais sous les nœuds eux-mêmes.
    const gOutlines = svg.append("g");
    const gNodes = svg.append("g");
    const gLinkValues = svg.append("g");
    const gLabels = svg.append("g");
    const gHeaders = svg.append("g");

    /* ---- Couches (colonnes) + titres ----
       `grille` fournie : la correspondance colonne -> couche vient de l'ensemble
       des diagrammes empilés, si bien que la colonne 3 tombe à la même abscisse
       partout. Sinon elle est propre à ce diagramme. */
    const nodeById = new Map(model.nodes.map(n => [n.id, n]));
    const denseByRaw = grille
        ? grille.dense
        : denseColonnes(model.nodes.map(n => n.column));

    const eLinks: ELink[] = model.links
        .filter(l => nodeById.has(l.source) && nodeById.has(l.target))
        .map(l => ({
            id: l.id,
            source: l.source,
            target: l.target,
            value: l.value > 0 ? l.value : 0.000001,
            unit: l.unit || "",
            colorOverride: l.colorOverride ?? null
        }));

    const layerById = couchesModele(model, denseByRaw);

    const titleByLayer = new Map<number, string>();
    model.nodes.forEach(n => {
        const layer = layerById.get(n.id)!;
        if (n.title && !titleByLayer.has(layer)) titleByLayer.set(layer, n.title);
    });

    const eNodes: ENode[] = model.nodes.map(n => ({
        id: n.id,
        name: n.name,
        layer: layerById.get(n.id)!,
        lane: laneOf(n),
        order: typeof n.order === "number" ? n.order : 0,
        kind: kindOf(n),
        color: n.color ?? null
    }));

    const nCols = Math.max(
        1,
        grille ? grille.nCols : Math.max(...eNodes.map(n => n.layer)) + 1
    );
    /* Réglages des deux types, résolus UNE fois pour ce diagramme : ils sont
       ensuite lus une poignée de fois par nœud (largeur, contour, police). */
    const largeurParType: Record<NodeKind, number> = {
        produit: largeurDuType(opt, "produit"),
        industrie: largeurDuType(opt, "industrie")
    };
    const policeParType: Record<NodeKind, NodeTypeFont> = {
        produit: policeDuType(opt, "produit"),
        industrie: policeDuType(opt, "industrie")
    };
    const contourParType: Record<NodeKind, NodeOutline> = {
        produit: styleDuType(opt, "produit").outline,
        industrie: styleDuType(opt, "industrie").outline
    };
    const positionParType: Record<NodeKind, NodeLabelPosition> = {
        produit: positionDuType(opt, "produit"),
        industrie: positionDuType(opt, "industrie")
    };

    /* La grille horizontale se cale sur la PLUS LARGE des largeurs employées
       ici — sinon la colonne de droite déborderait du cadre. Chaque nœud est
       ensuite centré sur l'axe de sa colonne, si bien qu'un produit réduit à un
       trait tombe exactement où passait le milieu de sa boîte. */
    const nodeWidth = eNodes.reduce((m, n) => Math.max(m, largeurParType[n.kind]), 0);
    /* Une escale — la place réservée à un ruban qui ne fait que traverser la
       colonne — prend la largeur de la grille : le ruban y file droit, au niveau
       des boîtes voisines, comme s'il passait derrière elles. */
    const largeurDe = (n: ENode) => (n.passage ? nodeWidth : largeurParType[n.kind]);
    const nodePadding = clamp(opt.nodes.nodePadding, 0, 200);

    const headersVisible = opt.columnHeaders.show && titleByLayer.size > 0;
    const headerFontSize = clamp(opt.columnHeaders.fontSize, 4, 60);
    const headerMarginTop = clamp(opt.columnHeaders.marginTop, 0, 200);
    const headerMarginBottom = clamp(opt.columnHeaders.marginBottom, 0, 200);
    const headerBarHeight = headerFontSize + 8;
    const topMargin = headersVisible
        ? headerMarginTop + headerBarHeight + headerMarginBottom
        : 6;

    /* Gouttière des noms de couloirs : les noms vivent à GAUCHE du diagramme,
       dans une marge qui leur est réservée. Les poser sur le dessin les ferait
       chevaucher le premier nœud et la barre des entêtes de colonnes. */
    const couloirsModele = Array.from(new Set(model.nodes.map(n => laneOf(n))))
        .sort((a, b) => a - b);
    /* Le nom d'un couloir sert deux fois — à mesurer la gouttière et à la
       peindre : la casse s'applique ici, à la source, pour que la mesure porte
       sur le texte réellement affiché. */
    const nomCouloir = (l: number) =>
        texteAffiche(
            (opt.lanes.showTitles && opt.lanes.titles && opt.lanes.titles[String(l)]) || "",
            opt.lanes
        );
    const tailleCouloir = clamp(opt.lanes.fontSize, 4, 60);
    const gouttiere =
        couloirsModele.length > 1
            ? couloirsModele.reduce(
                (m, l) => Math.max(m, nomCouloir(l)
                    ? estimateTextWidth(nomCouloir(l), tailleCouloir,
                        opt.lanes.weight >= 600, opt.lanes.uppercase) + 14
                    : 0),
                0
            )
            : 0;

    /* Un contour déborde du nœud : sans marge, celui de la première colonne (ou
       du nœud le plus haut) serait rogné par le bord du cadre. On ne réserve
       cette place que si un contour est demandé — sinon la mise en page est,
       au pixel près, celle d'avant les types. */
    const debordement = Array.from(new Set(eNodes.map(n => n.kind)))
        .map(k => contourParType[k])
        .filter(o => o.show)
        .reduce((m, o) => Math.max(m, clamp(o.distance, 0, 200) + clamp(o.width, 0, 40)), 0);

    const left = 2 + debordement + Math.min(gouttiere, Math.max(0, width * 0.3));
    const right = width - 2 - debordement;
    const top = topMargin + debordement;
    const bottom = height - 6 - debordement;
    if (right - left < 4 || bottom - top < 4) return 0;

    /* ---- Disposition ----
       Deux passes dès qu'un lien saute une colonne : la première donne les
       positions réelles, d'où l'on déduit par où chaque ruban veut passer ; la
       seconde refait la disposition en lui réservant sa place. */
    const kx = nCols > 1 ? (right - left - nodeWidth) / (nCols - 1) : 0;
    const cadre: Cadre = {
        left, right, top, bottom, nCols, nodeWidth, nodePadding, largeurDe,
        axeColonne: (layer: number) => left + layer * kx + nodeWidth / 2
    };
    const axeColonne = cadre.axeColonne;

    let graph = disposer(eNodes, eLinks, opt, cadre);
    if (!graph) {
        drawMessage(
            svg, width, height,
            "Impossible d'afficher le Sankey (données de flux invalides, ex. lien circulaire)."
        );
        return 0;
    }

    /* Rubans à dessiner : un par lien du modèle. Un lien qui saute une colonne a
       été découpé en segments passant par des nœuds de passage — ses morceaux
       sont recollés en un seul ruban, qui garde donc ses vrais nœuds d'extrémité
       (couleurs, dégradé, infobulle et repères de test sont inchangés). */
    let liens = graph.links as ELink[];
    if (opt.links.traversee !== "direct") {
        const plans = planifierPassages(graph, cadre);
        if (plans.size) {
            const augmente = decomposer(eNodes, eLinks, plans);
            const g2 = disposer(augmente.noeuds, augmente.liens, opt, cadre);
            // Si la seconde passe échoue, on garde la première : mieux vaut un
            // ruban qui passe sur un nœud qu'un diagramme absent.
            if (g2) {
                graph = g2;
                liens = recoller(g2, eLinks, augmente.chaines);
            }
        }
    }

    // Les nœuds de passage n'occupent que de la place : ils ne se peignent pas,
    // ne portent pas d'étiquette et ne comptent pas dans les bandes de couloir.
    const noeuds = (graph.nodes as ENode[]).filter(n => !n.passage);
    const couloirs = Array.from(new Set(noeuds.map(n => n.lane))).sort((a, b) => a - b);

    /* ---- Noms des couloirs, dans la gouttière de gauche ---- */
    if (couloirs.length > 1 && gouttiere > 0) {
        const C = opt.lanes;
        const gCouloirs = svg.append("g");
        couloirs.forEach(lane => {
            const nom = nomCouloir(lane);
            if (!nom) return;
            const dedans = noeuds.filter(n => n.lane === lane);
            if (!dedans.length) return;
            const haut = Math.min(...dedans.map(n => n.y0 ?? 0));
            const bas = Math.max(...dedans.map(n => n.y1 ?? 0));
            gCouloirs
                .append("text")
                .attr("x", 2)
                .attr("y", (haut + bas) / 2)
                .attr("dy", "0.35em")
                .attr("fill", C.fontColor)
                .style("font-family", C.fontFamily)
                .style("font-size", tailleCouloir + "px")
                .style("font-weight", String(C.weight))
                .style("font-style", C.italic ? "italic" : "normal")
                .text(nom);
        });
    }

    /* ---- Liens ---- */
    const L = opt.links;
    const opacity = clamp(L.opacity, 0, 100) / 100;
    const curvature = clamp(L.curvature, 0, 100) / 100;
    const defaultNodeColor = opt.nodes.nodeColor;
    // Couleur affichée d'un nœud : sa couleur propre, sinon la couleur par défaut.
    const nodeDisplayColor = (n: ENode): string => n.color || defaultNodeColor;
    // Couleur d'un lien : surcharge propre au lien, sinon couleur du nœud
    // d'origine, sinon couleur par défaut des liens.
    const startColor = (d: ELink): string => {
        if (d.colorOverride) return d.colorOverride;
        const src = d.source as ENode;
        return src.color || L.defaultColor;
    };

    if (L.useGradient) {
        liens.forEach((d, i) => {
            const src = d.source as ENode;
            const tgt = d.target as ENode;
            const grad = defs
                .append("linearGradient")
                .attr("id", `${prefixe}-grad${i}`)
                .attr("gradientUnits", "userSpaceOnUse")
                .attr("x1", src.x1 ?? 0)
                .attr("y1", d.y0 ?? 0)
                .attr("x2", tgt.x0 ?? 0)
                .attr("y2", d.y1 ?? 0);
            grad.append("stop").attr("offset", "0%").attr("stop-color", nodeDisplayColor(src));
            grad.append("stop").attr("offset", "100%").attr("stop-color", nodeDisplayColor(tgt));
        });
    }

    gLinks
        .selectAll("path")
        .data(liens)
        .enter()
        .append("path")
        .attr("d", (d: ELink) => ribbonPath(d, L.curveType, curvature))
        // Repères stables pour les tests et le débogage (cf. data-id des nœuds).
        .attr("data-source", (d: ELink) => (d.source as ENode).id)
        .attr("data-target", (d: ELink) => (d.target as ENode).id)
        .attr("fill", (d: ELink, i: number) =>
            L.useGradient ? `url(#${prefixe}-grad${i})` : startColor(d)
        )
        .attr("fill-opacity", opacity)
        .attr("stroke", L.showBorder ? L.borderColor : "none")
        .attr("stroke-width", L.showBorder ? clamp(L.borderWidth, 0, 10) : 0)
        .append("title")
        .text((d: ELink) => {
            const s = (d.source as ENode).name;
            const t = (d.target as ENode).name;
            return `${s} → ${t} : ${formatNumber(d.value)}`;
        });

    /* ---- Nœuds ---- */
    // Échelle réellement obtenue : d3-sankey étire la colonne la plus contrainte
    // sur la hauteur disponible. On la lit sur le résultat plutôt que de tenter
    // de la prédire — c'est ce qui permet d'aligner plusieurs diagrammes.
    let echelleObtenue = 0;
    noeuds.forEach(n => {
        const v = (n as any).value as number;
        if (v > 0) echelleObtenue = Math.max(echelleObtenue, (((n.y1 ?? 0) - (n.y0 ?? 0)) / v));
    });

    gNodes
        .selectAll("rect")
        .data(noeuds)
        .enter()
        .append("rect")
        .attr("x", (d: ENode) => d.x0 ?? 0)
        .attr("y", (d: ENode) => d.y0 ?? 0)
        .attr("width", (d: ENode) => Math.max(0, (d.x1 ?? 0) - (d.x0 ?? 0)))
        .attr("height", (d: ENode) => Math.max(0, (d.y1 ?? 0) - (d.y0 ?? 0)))
        // Repères stables pour les tests et le débogage, comme en vue d'édition.
        .attr("data-id", (d: ENode) => d.id)
        .attr("data-kind", (d: ENode) => d.kind)
        .attr("fill", (d: ENode) => nodeDisplayColor(d));

    /* ---- Contours : un liseré autour du nœud, à distance de son bord ----
       Le trait étant centré sur son tracé, on l'écarte de `distance + w/2`
       pour que ce soit bien l'ÉCART VU qui vaille `distance`. */
    const avecContour = noeuds.filter(d => contourParType[d.kind].show);
    avecContour.forEach(d => {
        const o = contourParType[d.kind];
        const w = clamp(o.width, 0, 40);
        const e = clamp(o.distance, 0, 200) + w / 2;
        const trait = traitContour(o, nodeDisplayColor(d));
        const boite = {
            x: (d.x0 ?? 0) - e,
            y: (d.y0 ?? 0) - e,
            w: Math.max(0, (d.x1 ?? 0) - (d.x0 ?? 0)) + 2 * e,
            h: Math.max(0, (d.y1 ?? 0) - (d.y0 ?? 0)) + 2 * e
        };
        gOutlines
            .append("rect")
            .attr("class", "node-outline")
            .attr("data-outline-for", d.id)
            .attr("x", boite.x)
            .attr("y", boite.y)
            .attr("width", boite.w)
            .attr("height", boite.h)
            .attr("rx", clamp(o.radius, 0, Math.min(boite.w, boite.h) / 2))
            .attr("fill", "none")
            .attr("stroke", trait.color)
            .attr("stroke-width", w)
            .attr("stroke-opacity", trait.opacity);
    });

    /* ---- Valeurs des liens (derrière les étiquettes, inclinées) ---- */
    const V = opt.linkValueLabels;
    if (V.show) {
        const vfs = clamp(V.fontSize, 4, 60);
        const fallbackUnit = (V.unitText || "").trim();
        /* Un ruban qui traverse des colonnes ne passe pas par le milieu du
           segment départ → arrivée : sa valeur se pose sur l'escale du milieu,
           là où il file droit. */
        const escaleMediane = (d: ELink) =>
            d.passages && d.passages.length
                ? d.passages[Math.floor((d.passages.length - 1) / 2)]
                : null;
        const mx = (d: ELink) => {
            const e = escaleMediane(d);
            return e ? (e.x0 + e.x1) / 2 : ((d.source as ENode).x1! + (d.target as ENode).x0!) / 2;
        };
        const my = (d: ELink) => {
            const e = escaleMediane(d);
            return e ? e.y : (d.y0! + d.y1!) / 2;
        };
        gLinkValues
            .selectAll("text")
            .data(liens.filter(l => (l.width ?? 0) >= vfs * 0.9))
            .enter()
            .append("text")
            .attr("x", (d: ELink) => mx(d))
            .attr("y", (d: ELink) => my(d))
            .attr("dy", "0.35em")
            .attr("text-anchor", "middle")
            .attr("transform", (d: ELink) => {
                const a = linkMidAngle(d, L.curveType, curvature);
                return `rotate(${a} ${mx(d)} ${my(d)})`;
            })
            .attr("fill", V.fontColor)
            .style("font-family", V.fontFamily)
            .style("font-size", vfs + "px")
            .style("font-weight", String(V.weight))
            .style("font-style", V.italic ? "italic" : "normal")
            .style("pointer-events", "none")
            .text((d: ELink) => {
                const unit = (d.unit || fallbackUnit).trim();
                const v = formatNumber(d.value);
                return texteAffiche(unit ? `${v} ${unit}` : v, V);
            });
    }

    /* ---- Étiquettes des nœuds ---- */
    const NL = opt.nodeLabels;
    if (NL.show) {
        // La police ET la position sont propres au type du nœud (elles
        // retombent sur celles-ci quand le type n'en a pas) : taille, hauteur de
        // ligne et ancrage se calculent donc nœud par nœud, plus une fois pour
        // toutes.
        const midX = width / 2;
        const bgOpacity = clamp(NL.backgroundOpacity, 0, 100) / 100;
        const maxChars = Math.max(1, Math.round(NL.maxChars));
        // Bords du dessin : abscisses extrêmes des nœuds peints (cf. « centre »).
        const xMinNoeuds = Math.min(...noeuds.map(n => n.x0 ?? 0));
        const xMaxNoeuds = Math.max(...noeuds.map(n => n.x1 ?? 0));
        const gap = 6;
        const padX = 4;
        const padY = 2;

        noeuds.forEach(d => {
            const police = policeParType[d.kind];
            const position = positionParType[d.kind];
            const fs = clamp(police.fontSize, 4, 60);
            const lineHeight = fs * 1.2;
            const labelText = texteAffiche(
                NL.showValue ? `${d.name} (${formatNumber(d.value ?? 0)})` : d.name,
                police
            );
            const lines = NL.wrap ? wrapText(labelText, maxChars) : [labelText];
            const maxLineW = Math.max(
                ...lines.map(ln =>
                    estimateTextWidth(ln, fs, police.weight >= 600, police.uppercase))
            );
            const centerY = ((d.y0 ?? 0) + (d.y1 ?? 0)) / 2;
            const nodeCenterX = ((d.x0 ?? 0) + (d.x1 ?? 0)) / 2;

            let anchor: string, anchorX: number, blockTopY: number, rectX: number;
            if (position === "dessous") {
                anchor = "middle";
                anchorX = nodeCenterX;
                blockTopY = (d.y1 ?? 0) + gap;
                rectX = nodeCenterX - maxLineW / 2 - padX;
            } else if (position === "centre") {
                /* Centrée SUR le nœud (pas à côté), donc sans écart : le texte
                   se pose sur la boîte. Aux deux extrémités du dessin, un nom
                   plus large que la boîte déborderait vers l'extérieur du
                   diagramme (et sortirait du cadre à gauche) : l'étiquette se
                   cale alors sur le côté du nœud tourné vers l'intérieur.
                   Ce sont les colonnes RÉELLEMENT peintes qui font le bord, pas
                   un numéro de colonne : d3 tasse les couches d'un modèle dont
                   la plus longue chaîne est plus courte que le nombre de
                   colonnes, et une colonne de la grille peut rester vide.
                   Un nœud collé aux deux bords à la fois (colonne unique) reste
                   centré, faute de mieux. */
                const bordGauche = (d.x0 ?? 0) <= xMinNoeuds + 0.5;
                const bordDroit = (d.x1 ?? 0) >= xMaxNoeuds - 0.5;
                blockTopY = centerY - (lines.length * lineHeight) / 2;
                if (bordGauche === bordDroit) {
                    anchor = "middle";
                    anchorX = nodeCenterX;
                    rectX = nodeCenterX - maxLineW / 2 - padX;
                } else if (bordGauche) {
                    anchor = "start";
                    anchorX = d.x0 ?? 0;
                    rectX = anchorX - padX;
                } else {
                    anchor = "end";
                    anchorX = d.x1 ?? 0;
                    rectX = anchorX - maxLineW - padX;
                }
            } else {
                const isLeft = (d.x0 ?? 0) < midX;
                anchor = isLeft ? "start" : "end";
                anchorX = isLeft ? (d.x1 ?? 0) + gap : (d.x0 ?? 0) - gap;
                blockTopY = centerY - (lines.length * lineHeight) / 2;
                rectX = isLeft ? anchorX - padX : anchorX - maxLineW - padX;
            }

            /* Le bloc que l'étiquette occupe : le fond s'y pose, et la zone
               de prise aussi. Une seule mesure pour les deux — un fond et une
               zone de prise qui se décaleraient l'un de l'autre donneraient une
               étiquette qu'on voit mais qu'on n'attrape pas. */
            const boite = {
                x: rectX,
                y: blockTopY - padY,
                w: maxLineW + padX * 2,
                h: lines.length * lineHeight + padY * 2
            };

            // Le repère est porté par le GROUPE, pas seulement par le texte :
            // c'est le groupe entier — fond, zone de prise, texte — que
            // l'éditeur donne à cliquer dans l'aperçu.
            const g = gLabels.append("g").attr("data-label-for", d.id);
            if (NL.showBackground) {
                g.append("rect")
                    .attr("x", boite.x)
                    .attr("y", boite.y)
                    .attr("width", boite.w)
                    .attr("height", boite.h)
                    .attr("rx", 2)
                    .attr("fill", NL.backgroundColor)
                    .attr("fill-opacity", bgOpacity);
            }
            /* ZONE DE PRISE de l'étiquette, invisible et toujours là.
               Un `<text>` ne se laisse attraper que sur ses glyphes : entre deux
               lettres, le clic passe au travers et atteint ce qu'il y a dessous.
               Ce rectangle rend le bloc entier cliquable — c'est par lui qu'on
               sélectionne un nœud dans l'aperçu, y compris un nœud de largeur
               nulle, qui n'a pas d'autre prise. `fill: none` + `pointer-events:
               all` : rien à voir, tout à attraper, même dans un SVG exporté. */
            g.append("rect")
                .attr("class", "node-label-hit")
                .attr("x", boite.x)
                .attr("y", boite.y)
                .attr("width", boite.w)
                .attr("height", boite.h)
                .attr("fill", "none")
                .attr("pointer-events", "all");
            const text = g
                .append("text")
                .attr("x", anchorX)
                .attr("text-anchor", anchor)
                .attr("data-kind", d.kind)
                // Repère stable pour les tests et le débogage, comme les nœuds.
                .attr("data-label-for", d.id)
                .attr("fill", police.fontColor)
                .style("font-family", police.fontFamily)
                .style("font-size", fs + "px")
                .style("font-weight", String(police.weight))
                .style("font-style", police.italic ? "italic" : "normal");
            lines.forEach((ln, i) => {
                text
                    .append("tspan")
                    .attr("x", anchorX)
                    .attr("y", blockTopY + (i + 0.5) * lineHeight)
                    .attr("dy", "0.35em")
                    .text(ln);
            });
        });
    }

    /* ---- Titres de colonnes ---- */
    if (headersVisible) {
        const H = opt.columnHeaders;
        const padX = 8;
        titleByLayer.forEach((title, layer) => {
            const nodeCenterX = axeColonne(layer);
            const titre = texteAffiche(title, H);
            const textW = estimateTextWidth(titre, headerFontSize,
                H.weight >= 600, H.uppercase);
            const rectW = textW + padX * 2;
            const rectX = clamp(nodeCenterX - rectW / 2, 0, Math.max(0, width - rectW));
            const g = gHeaders.append("g");
            g.append("rect")
                .attr("x", rectX)
                .attr("y", headerMarginTop)
                .attr("width", rectW)
                .attr("height", headerBarHeight)
                .attr("rx", 2)
                .attr("fill", H.backgroundColor);
            g.append("text")
                .attr("x", rectX + rectW / 2)
                .attr("y", headerMarginTop + headerBarHeight / 2)
                .attr("dy", "0.35em")
                .attr("text-anchor", "middle")
                .attr("fill", H.fontColor)
                .style("font-family", H.fontFamily)
                .style("font-size", headerFontSize + "px")
                .style("font-weight", String(H.weight))
                .style("font-style", H.italic ? "italic" : "normal")
                .text(titre);
        });
    }
    return echelleObtenue;
}

/* ----------------------------- utilitaires ----------------------------- */

function drawMessage(
    svg: any,
    width: number,
    height: number,
    msg: string
): void {
    svg.append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "#6b6b6b")
        .style("font-family", "\"Source Sans Pro\", system-ui, sans-serif")
        .style("font-size", "13px")
        .text(msg);
}

function clamp(v: number, min: number, max: number): number {
    if (v == null || isNaN(v)) return min;
    return Math.max(min, Math.min(max, v));
}

/**
 * Contour d'un ruban : le bord du haut, du départ à l'arrivée, puis le bord du
 * bas en sens inverse. L'épaisseur étant constante, les deux bords suivent la
 * même ligne, décalée de ± une demi-épaisseur.
 *
 * Les points de passage (colonnes seulement traversées) s'intercalent entre le
 * départ et l'arrivée : le ruban file droit sur la largeur de l'escale, puis
 * repart vers le point suivant. Sans passage, le tracé est celui d'avant.
 */
function ribbonPath(link: ELink, curveType: string, curvature: number): string {
    const s = link.source as ENode;
    const t = link.target as ENode;
    const pts: [number, number][] = [[s.x1 ?? 0, link.y0 ?? 0]];
    (link.passages ?? []).forEach(p => {
        pts.push([p.x0, p.y]);
        pts.push([p.x1, p.y]);
    });
    pts.push([t.x0 ?? 0, link.y1 ?? 0]);

    const hw = Math.max(0, link.width ?? 0) / 2;
    const haut = bordRuban(pts, -hw, curveType, curvature);
    const bas = bordRuban(pts.slice().reverse(), hw, curveType, curvature);
    return `M${haut} L${bas} Z`;
}

/** Un bord du ruban : la ligne brisée des points, décalée de `dy`. */
function bordRuban(
    pts: [number, number][],
    dy: number,
    curveType: string,
    curvature: number
): string {
    let d = `${pts[0][0]},${pts[0][1] + dy}`;
    for (let i = 1; i < pts.length; i++) {
        d += " " + segmentBord(
            pts[i - 1][0], pts[i - 1][1] + dy,
            pts[i][0], pts[i][1] + dy,
            curveType, curvature
        );
    }
    return d;
}

/** Un segment d'un bord, du point courant au suivant, selon le type de courbe. */
function segmentBord(
    sx: number, sy: number, tx: number, ty: number,
    curveType: string, curvature: number
): string {
    // Traversée d'une escale : le ruban y file droit, quel que soit le réglage.
    if (sy === ty || curveType === "droite") return `L${tx},${ty}`;
    if (curveType === "marches") {
        const xm = (sx + tx) / 2;
        return `L${xm},${sy} L${xm},${ty} L${tx},${ty}`;
    }
    const c = 0.15 + curvature * 0.35;
    const cx1 = sx + (tx - sx) * c;
    const cx2 = tx - (tx - sx) * c;
    return `C${cx1},${sy} ${cx2},${ty} ${tx},${ty}`;
}

function linkMidAngle(link: ELink, curveType: string, curvature: number): number {
    // Sur une escale, le ruban est horizontal : sa valeur s'y écrit droite.
    if (link.passages && link.passages.length) return 0;
    const s = link.source as ENode;
    const t = link.target as ENode;
    const sx = s.x1 ?? 0, tx = t.x0 ?? 0, sy = link.y0 ?? 0, ty = link.y1 ?? 0;
    if (curveType === "marches") return 0;
    let dx: number;
    if (curveType === "droite") dx = tx - sx;
    else dx = (tx - sx) * (1 - (0.15 + curvature * 0.35));
    return (Math.atan2(ty - sy, dx) * 180) / Math.PI;
}

function formatNumber(v: number): string {
    if (!isFinite(v)) return "";
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + " Md";
    if (a >= 1e6) return (v / 1e6).toFixed(2) + " M";
    if (a >= 1e3) return (v / 1e3).toFixed(1) + " k";
    return v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

/**
 * Largeur approchée d'un texte DÉJÀ mis en forme : on lui passe la chaîne telle
 * qu'elle sera peinte (capitales comprises). `majuscules` ne dit donc pas quoi
 * transformer, mais que ces glyphes-là sont des capitales — plus larges d'environ
 * un dixième que les bas-de-casse à nombre de signes égal.
 */
function estimateTextWidth(
    text: string, fontSize: number, gras: boolean, majuscules = false
): number {
    return text.length * fontSize * (gras ? 0.62 : 0.55) * (majuscules ? 1.08 : 1);
}

export function wrapText(text: string, maxChars: number): string[] {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const lines: string[] = [];
    let current = "";
    const push = (w: string) => {
        if (current === "") current = w;
        else if ((current + " " + w).length <= maxChars) current += " " + w;
        else {
            lines.push(current);
            current = w;
        }
    };
    words.forEach(w => {
        while (w.length > maxChars) {
            if (current !== "") {
                lines.push(current);
                current = "";
            }
            lines.push(w.slice(0, maxChars));
            w = w.slice(maxChars);
        }
        push(w);
    });
    if (current !== "") lines.push(current);
    return lines.length ? lines : [text];
}
