// Moteur de rendu Sankey — porté depuis le visuel Power BI (visual.ts),
// rendu indépendant de tout framework, dans un élément <svg>.

import { select } from "d3-selection";
import { sankey } from "d3-sankey";
import {
    FlowModel, SankeyOptions, NodeKind, NodeTypeStyle, NodeTypeFont, NodeOutline,
    NodeMosaique, NodeLabelPosition, NODE_LABEL_POSITIONS, kindOf, defaultTypeStyle,
    texteAffiche, partBio, diviseurDe, FormatValeurNoeud, defaultFormatValeurNoeud,
    FlecheLiens, defaultFleches
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
    /** Valeur telle que le classeur la donne : `value` est relevée à un
     *  millionième pour qu'un flux nul reste traçable, pas celle-ci. */
    brut: number;
    unit: string;
    colorOverride: string | null;
    /** Part du flux en bio / durable, de 0 à 1 (0 = rien à recouvrir). */
    bio: number;
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

/** Fond du damier : l'autre carré sur deux, celui qui n'est pas de la couleur
 *  du nœud. Blanc, comme le fond du diagramme. */
const MOSAIQUE_FOND = "#ffffff";


/** Réglages d'un type de nœud, complétés si le projet en ignore une partie. */
function styleDuType(opt: SankeyOptions, kind: NodeKind): NodeTypeStyle {
    const t = opt.nodeTypes && opt.nodeTypes[kind];
    if (!t) return defaultTypeStyle();
    return {
        width: typeof t.width === "number" ? t.width : null,
        font: t.font || null,
        position: positionValide(t.position),
        outline: Object.assign(defaultTypeStyle().outline, t.outline || {}),
        mosaique: Object.assign(defaultTypeStyle().mosaique, t.mosaique || {})
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
        opacity: NL.opacity,
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
    /** Place réservée aux étiquettes posées à l'extérieur, la même pour tous
     *  les diagrammes empilés — sans quoi leurs colonnes ne s'aligneraient plus. */
    reserve?: Reserve;
}

/** Place réservée de part et d'autre du dessin aux étiquettes extérieures. */
interface Reserve {
    gauche: number;
    droite: number;
}

/** Ce que rend le dessin d'un diagramme, pour qui en empile plusieurs. */
interface Dessin {
    /** Pixels par unité de flux, telle que d3-sankey l'a obtenue. */
    echelle: number;
    /** Place qu'ont demandée ses étiquettes extérieures. */
    reserve: Reserve;
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

    const m = margesDuCadre(opt, width, height);
    drawSankey(
        svg.append("g").attr("transform", `translate(${m.gauche},${m.haut})`),
        model, opt, m.largeur, m.hauteur
    );
}

/**
 * Marges extérieures, ramenées à ce que le cadre peut leur donner. Le fond
 * couvre toute la surface : la marge n'agrandit pas le canevas, elle réserve
 * une bande où le dessin ne va pas.
 *
 * Les marges latérales existent pour les libellés — un nom centré sur un nœud
 * de la première ou de la dernière colonne déborde de la moitié de sa longueur
 * et se fait couper par le bord. Sans borne, une marge plus large que le
 * canevas donnerait une largeur utile négative : on garde toujours 40 px de
 * dessin, quitte à rogner les marges à proportion.
 */
function margesDuCadre(
    opt: SankeyOptions,
    width: number,
    height: number
): { gauche: number; haut: number; largeur: number; hauteur: number } {
    const haut = clamp(opt.chart.marginTop, 0, 2000);
    const bas = clamp(opt.chart.marginBottom, 0, 2000);
    let gauche = clamp(opt.chart.marginLeft, 0, 2000);
    let droite = clamp(opt.chart.marginRight, 0, 2000);
    const restant = width - 40;
    if (gauche + droite > restant) {
        /* À proportion, pour qu'une marge demandée deux fois plus large reste
           deux fois plus large une fois rognée — le dessin garde sa place. */
        const k = gauche + droite > 0 ? Math.max(0, restant) / (gauche + droite) : 0;
        gauche = gauche * k;
        droite = droite * k;
    }
    return {
        gauche,
        haut,
        largeur: Math.max(40, width - gauche - droite),
        hauteur: Math.max(40, height - haut - bas)
    };
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
    return dessinerDetache(model, opt, width, height, grille).echelle;
}

/** Dessine un diagramme hors du document, pour n'en lire que les mesures. */
function dessinerDetache(
    model: FlowModel,
    opt: SankeyOptions,
    width: number,
    height: number,
    grille?: GrilleColonnes
): Dessin {
    const detache = select(document.createElementNS("http://www.w3.org/2000/svg", "g"));
    return drawSankey(detache, model, opt, width, height, grille);
}

/** Un type de nœud au moins pose-t-il ses étiquettes à l'extérieur ? */
function etiquettesExterieures(opt: SankeyOptions): boolean {
    return !!opt.nodeLabels.show
        && (["produit", "industrie"] as NodeKind[]).some(k => positionDuType(opt, k) === "exterieur");
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
    const m = margesDuCadre(opt, width, height);
    const largeur = m.largeur;

    /* Étiquettes à l'extérieur : chaque diagramme dirait sa propre réserve, et
       leurs colonnes ne tomberaient plus en face. On prend la plus large de
       chaque côté, et tous la reçoivent. La hauteur n'y change rien — une
       étiquette a la même largeur quel que soit le flux. */
    if (etiquettesExterieures(opt)) {
        const reserve: Reserve = { gauche: 0, droite: 0 };
        utiles.forEach(g => {
            const r = dessinerDetache(g.model, opt, largeur, 400, grille).reserve;
            reserve.gauche = Math.max(reserve.gauche, r.gauche);
            reserve.droite = Math.max(reserve.droite, r.droite);
        });
        grille.reserve = reserve;
    }
    const hauteurTitre = F.showTitle ? taille + sousTitre : 0;
    const dispo =
        m.hauteur
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
            const e1 = mesurerEchelle(g.model, opt, largeur, H1, grille);
            const e2 = mesurerEchelle(g.model, opt, largeur, H2, grille);
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
    /* Les titres de filière suivent les marges latérales, comme les diagrammes :
       un titre aligné à droite passerait sinon sous le libellé auquel la marge
       vient justement de faire place. */
    const xTitre = m.gauche
        + (F.align === "centre" ? largeur / 2 : F.align === "droite" ? largeur - 12 : 12);

    let y = m.haut;
    utiles.forEach((g, i) => {
        if (F.showTitle) {
            svg.append("text")
                .attr("x", xTitre)
                .attr("y", y + taille)
                .attr("text-anchor", ancre)
                .attr("fill", F.fontColor)
                .attr("fill-opacity", clamp(F.opacity, 0, 100) / 100)
                .style("font-family", F.fontFamily)
                .style("font-size", taille + "px")
                .style("font-weight", String(F.weight))
                .style("font-style", F.italic ? "italic" : "normal")
                .text(texteAffiche(g.nom || "(sans filière)", F));
            y += hauteurTitre;
        }
        const bloc = svg.append("g").attr("transform", `translate(${m.gauche},${y})`);
        drawSankey(bloc, g.model, opt, largeur, hauteurs[i], grille);
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
): Dessin {
    const RIEN: Dessin = { echelle: 0, reserve: { gauche: 0, droite: 0 } };
    const prefixe = `d${compteurDiagramme++}`;
    const defs = svg.append("defs");
    const gLinks = svg.append("g");
    // Le bandeau bio se pose SUR son ruban, dans son propre groupe : il vient
    // après tous les rubans, donc au-dessus, et jamais entre deux d'entre eux.
    const gBio = svg.append("g");
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
            colorOverride: l.colorOverride ?? null,
            brut: l.value > 0 ? l.value : 0,
            bio: partBio(l)
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
    const mosaiqueParType: Record<NodeKind, NodeMosaique> = {
        produit: styleDuType(opt, "produit").mosaique,
        industrie: styleDuType(opt, "industrie").mosaique
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
                /* Largeur mesurée, pas devinée : une gouttière trop courte
                   laisse le nom du couloir mordre sur le premier nœud, une
                   gouttière trop large vole cette place au dessin. */
                (m, l) => Math.max(m, nomCouloir(l)
                    ? mesureTexte(nomCouloir(l), tailleCouloir, opt.lanes.weight,
                        opt.lanes.italic, opt.lanes.fontFamily) + 14
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

    /* ---- Étiquettes des nœuds : ce qu'elles disent, la place qu'elles prennent ----
       Mesurées AVANT d'être peintes : une étiquette posée à l'extérieur se
       réserve sa place dans le cadre, et cette place, c'est sa largeur. */
    const NL = opt.nodeLabels;
    const FV: FormatValeurNoeud = Object.assign(defaultFormatValeurNoeud(), NL.valeur || {});
    const maxChars = Math.max(1, Math.round(NL.maxChars));
    const GAP_ETIQUETTE = 6;
    const PAD_X = 4;
    const PAD_Y = 2;

    /* Flux d'un nœud tel que le classeur le donne — le plus grand de ce qui
       entre et de ce qui sort, comme l'épaisseur que d3 lui a donnée. On relit
       les valeurs brutes : un flux nul, relevé à un millionième pour rester
       traçable, s'écrirait sinon « 0,000001 ». */
    const valeurNoeud = (d: ENode): number => {
        const somme = (ls?: ELink[]) => (ls ?? []).reduce((t, l) => t + (l.brut ?? 0), 0);
        return Math.max(somme(d.sourceLinks), somme(d.targetLinks));
    };
    // Unité d'un nœud : celle de ses liens s'ils s'accordent, sinon celle de repli.
    const uniteNoeud = (d: ENode): string => {
        const u = new Set([...(d.sourceLinks ?? []), ...(d.targetLinks ?? [])]
            .map(l => (l.unit || "").trim())
            .filter(Boolean));
        return u.size === 1 ? Array.from(u)[0] : (FV.unitText || "").trim();
    };
    /* Part de chaque nœud dans le total de sa colonne, compté DANS SON
       COULOIR : un couloir isole une famille de flux (entrants hors périmètre,
       cœur…), et additionner deux familles ne dirait rien. La colonne est celle
       qui est peinte, pas le numéro saisi. */
    const partsDes = (liste: ENode[]): Map<string, number> => {
        const cle = (n: ENode) => n.layer + "|" + n.lane;
        const totaux = new Map<string, number>();
        liste.forEach(n => totaux.set(cle(n), (totaux.get(cle(n)) ?? 0) + valeurNoeud(n)));
        return new Map(liste.map(n => {
            const t = totaux.get(cle(n)) ?? 0;
            return [n.id, t > 0 ? valeurNoeud(n) / t : 0] as [string, number];
        }));
    };
    const texteValeurNoeud = (d: ENode, part: number): string => {
        if (FV.contenu === "part") return formatPart(part);
        const unite = uniteNoeud(d);
        const v = formatValeurLien(valeurNoeud(d), FV.multiplicateur, FV.chiffresSignificatifs);
        const valeur = unite ? `${v} ${unite}` : v;
        return FV.contenu === "les-deux" ? `${valeur} · ${formatPart(part)}` : valeur;
    };
    const etiquetteDe = (d: ENode, parts: Map<string, number>) => {
        const police = policeParType[d.kind];
        const fs = clamp(police.fontSize, 4, 60);
        const nom = texteAffiche(d.name, police);
        const lignes = NL.wrap ? wrapText(nom, maxChars) : [nom];
        /* La valeur (ou la part) s'écrit sur SA ligne, sous le nom : collée
           au nom entre parenthèses, elle allongeait d'autant l'étiquette — et
           la place prise sur le dessin par les étiquettes extérieures. Elle ne
           se coupe pas : un chiffre coupé en deux ne se lit plus. */
        if (NL.showValue) {
            lignes.push(texteAffiche(texteValeurNoeud(d, parts.get(d.id) ?? 0), police));
        }
        /* Le bloc fait la largeur de sa LIGNE LA PLUS LARGE, mesurée pour de
           bon : « IAA » garde un fond à sa taille, et « Importation de bovins
           finis » coupé en deux lignes prend la largeur de « Importation de »,
           pas celle du nom entier. */
        const largeur = Math.max(...lignes.map(ln =>
            mesureTexte(ln, fs, police.weight, police.italic, police.fontFamily)));
        return { police, fs, hauteurLigne: fs * 1.2, lignes, largeur };
    };
    /* Colonne de bord d'un nœud, lue sur les AXES des nœuds peints — jamais
       sur un numéro de colonne : d3 tasse les couches quand la plus longue
       chaîne est plus courte que le nombre de colonnes, et une colonne de la
       grille peut rester vide. L'axe plutôt que le bord de la boîte : un
       produit de largeur nulle et une industrie large partagent la même
       colonne. Un nœud collé aux deux bords (colonne unique) n'en a aucun. */
    const bordsDu = (liste: ENode[]) => {
        const axe = (n: ENode) => ((n.x0 ?? 0) + (n.x1 ?? 0)) / 2;
        const min = Math.min(...liste.map(axe));
        const max = Math.max(...liste.map(axe));
        return (d: ENode): "gauche" | "droite" | null => {
            const g = axe(d) <= min + 0.5;
            const dr = axe(d) >= max - 0.5;
            return g === dr ? null : g ? "gauche" : "droite";
        };
    };
    // Une étiquette extérieure se pose au-delà du contour, s'il y en a un.
    const ecartExterieur = (d: ENode): number => {
        const o = contourParType[d.kind];
        return GAP_ETIQUETTE + (o.show ? clamp(o.distance, 0, 200) + clamp(o.width, 0, 40) : 0);
    };
    const reserveExterieure = (liste: ENode[]): Reserve => {
        const r: Reserve = { gauche: 0, droite: 0 };
        if (!liste.length) return r;
        const bord = bordsDu(liste);
        const parts = partsDes(liste);
        liste.forEach(d => {
            if (positionParType[d.kind] !== "exterieur") return;
            const cote = bord(d);
            if (!cote) return;
            const place = etiquetteDe(d, parts).largeur + ecartExterieur(d)
                + (NL.showBackground ? PAD_X : 0) + 2;
            r[cote] = Math.max(r[cote], place);
        });
        return r;
    };

    const gauche0 = 2 + debordement + Math.min(gouttiere, Math.max(0, width * 0.3));
    const droite0 = width - 2 - debordement;
    const top = topMargin + debordement;
    const bottom = height - 6 - debordement;
    if (droite0 - gauche0 < 4 || bottom - top < 4) return RIEN;

    /* ---- Disposition ----
       Deux passes dès qu'un lien saute une colonne : la première donne les
       positions réelles, d'où l'on déduit par où chaque ruban veut passer ; la
       seconde refait la disposition en lui réservant sa place. */
    const cadreEntre = (left: number, right: number): Cadre => {
        const kx = nCols > 1 ? (right - left - nodeWidth) / (nCols - 1) : 0;
        return {
            left, right, top, bottom, nCols, nodeWidth, nodePadding, largeurDe,
            axeColonne: (layer: number) => left + layer * kx + nodeWidth / 2
        };
    };
    /* Une réserve n'avale jamais le dessin : au delà de 60 % de la largeur,
       les deux côtés sont rognés à proportion. */
    const cadreAvecReserve = (r: Reserve): Cadre => {
        const dispo = droite0 - gauche0;
        const k = r.gauche + r.droite > dispo * 0.6 ? (dispo * 0.6) / (r.gauche + r.droite) : 1;
        return cadreEntre(gauche0 + r.gauche * k, droite0 - r.droite * k);
    };

    const reserveImposee = grille && grille.reserve;
    let cadre = reserveImposee ? cadreAvecReserve(reserveImposee) : cadreEntre(gauche0, droite0);
    let graph = disposer(eNodes, eLinks, opt, cadre);
    if (!graph) {
        drawMessage(
            svg, width, height,
            "Impossible d'afficher le Sankey (données de flux invalides, ex. lien circulaire)."
        );
        return RIEN;
    }

    /* Étiquettes À L'EXTÉRIEUR : elles se posent au-delà des colonnes de bord,
       là où il n'y a que le fond. Leur place se prend sur le dessin — mesurée
       sur les étiquettes réellement écrites, donc après une première
       disposition, qui dit quels nœuds sont au bord et ce qu'ils portent. */
    let reserve: Reserve = { gauche: 0, droite: 0 };
    if (!reserveImposee && etiquettesExterieures(opt)) {
        reserve = reserveExterieure((graph.nodes as ENode[]).filter(n => !n.passage));
        if (reserve.gauche > 0 || reserve.droite > 0) {
            cadre = cadreAvecReserve(reserve);
            const g2 = disposer(eNodes, eLinks, opt, cadre);
            if (g2) graph = g2;
        }
    }
    const axeColonne = cadre.axeColonne;

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
                .attr("fill-opacity", clamp(C.opacity, 0, 100) / 100)
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
    /* Flèches : réglage complété ici aussi — une apparence rangée avant leur
       arrivée n'en dit rien, et le ruban doit alors rester celui d'avant. */
    const FL: FlecheLiens = Object.assign(defaultFleches(), L.fleches || {});
    const fleche: FlecheLiens | null = FL.show ? FL : null;
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

    // Infobulle d'un ruban — la même sur son bandeau bio, sans quoi survoler la
    // moitié verte du flux ne dirait plus rien.
    const titreLien = (d: ELink): string => {
        const s = (d.source as ENode).name;
        const t = (d.target as ENode).name;
        const part = partBio(d);
        const bio = part > 0 ? ` · dont ${Math.round(part * 100)} % bio / durable` : "";
        return `${s} → ${t} : ${formatNumber(d.value)}${bio}`;
    };

    gLinks
        .selectAll("path")
        .data(liens)
        .enter()
        .append("path")
        .attr("d", (d: ELink) => ribbonPath(d, L.curveType, curvature, fleche))
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
        .text(titreLien);

    /* ---- Part bio / durable : un bandeau vert sur la tranche haute du ruban ----
       Il en suit exactement le tracé — mêmes escales, même courbure — et n'en
       recouvre que la part demandée : entière à 100 %, rien à 0 %. Deux flux
       collés l'un à l'autre, donc, et pas un ruban de plus : l'épaisseur totale
       reste celle du flux, et une coupe verticale totalise toujours le même. */
    if (L.bio.show) {
        gBio
            .selectAll("path")
            .data(liens.filter(d => partBio(d) > 0 && (d.width ?? 0) > 0))
            .enter()
            .append("path")
            .attr("class", "lien-bio")
            .attr("d", (d: ELink) => bandeauBio(d, L.curveType, curvature, fleche))
            .attr("data-source", (d: ELink) => (d.source as ENode).id)
            .attr("data-target", (d: ELink) => (d.target as ENode).id)
            // La part réellement peinte, pour les tests et le débogage.
            .attr("data-bio", (d: ELink) => String(partBio(d)))
            .attr("fill", L.bio.color)
            .attr("fill-opacity", opacity)
            .attr("stroke", "none")
            .append("title")
            .text(titreLien);
    }

    /* ---- Nœuds ---- */
    // Échelle réellement obtenue : d3-sankey étire la colonne la plus contrainte
    // sur la hauteur disponible. On la lit sur le résultat plutôt que de tenter
    // de la prédire — c'est ce qui permet d'aligner plusieurs diagrammes.
    let echelleObtenue = 0;
    noeuds.forEach(n => {
        const v = (n as any).value as number;
        if (v > 0) echelleObtenue = Math.max(echelleObtenue, (((n.y1 ?? 0) - (n.y0 ?? 0)) / v));
    });

    /* ---- Mosaïque : un damier à la PLACE de l'aplat ----
       Un carré sur deux garde la couleur du nœud, l'autre est blanc. Le motif
       est déclaré une fois par (taille, couleur) et partagé par tous les nœuds
       qui le portent ; son identifiant est préfixé comme celui des dégradés,
       sinon deux filières empilées dans le même SVG pointeraient toutes vers le
       damier du premier bloc. */
    const motifs = new Map<string, string>();
    const motifMosaique = (m: NodeMosaique, couleur: string): string => {
        const t = clamp(m.taille, 1, 200);
        const cle = `${t}|${couleur}`;
        const connu = motifs.get(cle);
        if (connu) return connu;
        const id = `${prefixe}-mos${motifs.size}`;
        motifs.set(cle, id);
        const pat = defs
            .append("pattern")
            .attr("id", id)
            .attr("patternUnits", "userSpaceOnUse")
            .attr("width", 2 * t)
            .attr("height", 2 * t);
        pat.append("rect")
            .attr("width", 2 * t)
            .attr("height", 2 * t)
            .attr("fill", MOSAIQUE_FOND);
        // Les deux carrés colorés de la tuile : en haut à gauche, en bas à
        // droite — le damier se referme donc sur lui-même en se répétant.
        [[0, 0], [t, t]].forEach(([x, y]) => {
            pat.append("rect")
                .attr("x", x)
                .attr("y", y)
                .attr("width", t)
                .attr("height", t)
                .attr("fill", couleur);
        });
        return id;
    };
    /* La couleur du nœud reste SA couleur : la mosaïque ne fait que la porter
       autrement. Contour, rubans et dégradés continuent de la lire telle quelle,
       et un nœud sans mosaïque est peint exactement comme avant. */
    const remplissageNoeud = (d: ENode): string => {
        const m = mosaiqueParType[d.kind];
        return m.show
            ? `url(#${motifMosaique(m, nodeDisplayColor(d))})`
            : nodeDisplayColor(d);
    };

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
        .attr("fill", (d: ENode) => remplissageNoeud(d));

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
            // Classe et extrémités : la valeur écrite se retrouve dans le
            // dessin PEINT — c'est là, et pas dans le modèle, qu'un test lit
            // le chiffre réellement obtenu.
            .attr("class", "link-value")
            .attr("data-source", (d: ELink) => (d.source as ENode).id)
            .attr("data-target", (d: ELink) => (d.target as ENode).id)
            .attr("x", (d: ELink) => mx(d))
            .attr("y", (d: ELink) => my(d))
            .attr("dy", "0.35em")
            .attr("text-anchor", "middle")
            .attr("transform", (d: ELink) => {
                const a = linkMidAngle(d, L.curveType, curvature);
                return `rotate(${a} ${mx(d)} ${my(d)})`;
            })
            .attr("fill", V.fontColor)
            .attr("fill-opacity", clamp(V.opacity, 0, 100) / 100)
            .style("font-family", V.fontFamily)
            .style("font-size", vfs + "px")
            .style("font-weight", String(V.weight))
            .style("font-style", V.italic ? "italic" : "normal")
            .style("pointer-events", "none")
            .text((d: ELink) => {
                const unit = (d.unit || fallbackUnit).trim();
                const v = formatValeurLien(d.value, V.multiplicateur, V.chiffresSignificatifs);
                return texteAffiche(unit ? `${v} ${unit}` : v, V);
            });
    }

    /* ---- Étiquettes des nœuds ---- */
    if (NL.show) {
        // La police ET la position sont propres au type du nœud (elles
        // retombent sur celles-ci quand le type n'en a pas) : taille, hauteur de
        // ligne et ancrage se calculent donc nœud par nœud, plus une fois pour
        // toutes.
        const midX = width / 2;
        const bgOpacity = clamp(NL.backgroundOpacity, 0, 100) / 100;
        const bord = bordsDu(noeuds);
        const parts = partsDes(noeuds);

        noeuds.forEach(d => {
            const { police, fs, hauteurLigne: lineHeight, lignes: lines, largeur: maxLineW } =
                etiquetteDe(d, parts);
            const position = positionParType[d.kind];
            const cote = bord(d);
            const centerY = ((d.y0 ?? 0) + (d.y1 ?? 0)) / 2;
            const nodeCenterX = ((d.x0 ?? 0) + (d.x1 ?? 0)) / 2;
            // Posée au-delà d'une colonne de bord, sur le fond du graphique.
            const exterieure = position === "exterieur" && cote !== null;

            let anchor: string, anchorX: number, blockTopY: number, rectX: number;
            if (position === "dessous") {
                anchor = "middle";
                anchorX = nodeCenterX;
                blockTopY = (d.y1 ?? 0) + GAP_ETIQUETTE;
                rectX = nodeCenterX - maxLineW / 2 - PAD_X;
            } else if (position === "centre") {
                /* Centrée SUR le nœud (pas à côté), donc sans écart : le texte
                   se pose sur la boîte. Aux deux extrémités du dessin, un nom
                   plus large que la boîte déborderait vers l'extérieur du
                   diagramme (et sortirait du cadre à gauche) : l'étiquette se
                   cale alors sur le côté du nœud tourné vers l'intérieur. */
                blockTopY = centerY - (lines.length * lineHeight) / 2;
                if (!cote) {
                    anchor = "middle";
                    anchorX = nodeCenterX;
                    rectX = nodeCenterX - maxLineW / 2 - PAD_X;
                } else if (cote === "gauche") {
                    anchor = "start";
                    anchorX = d.x0 ?? 0;
                    rectX = anchorX - PAD_X;
                } else {
                    anchor = "end";
                    anchorX = d.x1 ?? 0;
                    rectX = anchorX - maxLineW - PAD_X;
                }
            } else if (exterieure) {
                /* À l'EXTÉRIEUR : la première colonne écrit ses noms à sa
                   gauche, la dernière à sa droite — hors des rubans, sur le
                   fond. Le cadre leur a réservé cette place. Les colonnes du
                   milieu n'ont pas d'extérieur : elles restent « à côté ». */
                const ecart = ecartExterieur(d);
                blockTopY = centerY - (lines.length * lineHeight) / 2;
                if (cote === "gauche") {
                    anchor = "end";
                    anchorX = (d.x0 ?? 0) - ecart;
                    rectX = anchorX - maxLineW - PAD_X;
                } else {
                    anchor = "start";
                    anchorX = (d.x1 ?? 0) + ecart;
                    rectX = anchorX - PAD_X;
                }
            } else {
                const isLeft = (d.x0 ?? 0) < midX;
                anchor = isLeft ? "start" : "end";
                anchorX = isLeft ? (d.x1 ?? 0) + GAP_ETIQUETTE : (d.x0 ?? 0) - GAP_ETIQUETTE;
                blockTopY = centerY - (lines.length * lineHeight) / 2;
                rectX = isLeft ? anchorX - PAD_X : anchorX - maxLineW - PAD_X;
            }

            /* Le bloc que l'étiquette occupe : le fond s'y pose, et la zone
               de prise aussi. Une seule mesure pour les deux — un fond et une
               zone de prise qui se décaleraient l'un de l'autre donneraient une
               étiquette qu'on voit mais qu'on n'attrape pas. */
            const boite = {
                x: rectX,
                y: blockTopY - PAD_Y,
                w: maxLineW + PAD_X * 2,
                h: lines.length * lineHeight + PAD_Y * 2
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
                /* Sur le fond, une étiquette extérieure peut prendre la couleur
                   de son nœud : le nom se relie alors à sa boîte d'un regard.
                   Entre les rubans, la couleur du texte reste celle réglée — un
                   nom de la couleur du ruban qu'il chevauche ne se lirait plus. */
                .attr("fill", exterieure && NL.couleurDuNoeud ? nodeDisplayColor(d) : police.fontColor)
                .attr("fill-opacity", clamp(police.opacity, 0, 100) / 100)
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
            // Le bandeau fait la largeur du titre réellement peint, plus ses
            // marges : un intitulé court n'a pas à traîner un bandeau large.
            const textW = mesureTexte(titre, headerFontSize, H.weight,
                H.italic, H.fontFamily);
            const rectW = textW + padX * 2;
            const rectX = clamp(nodeCenterX - rectW / 2, 0, Math.max(0, width - rectW));
            // Repère stable — comme `data-id` sur un nœud : c'est par lui que
            // les tests retrouvent le bandeau d'une colonne sans le deviner à
            // son intitulé.
            const g = gHeaders.append("g").attr("data-header-for", layer);
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
                .attr("fill-opacity", clamp(H.opacity, 0, 100) / 100)
                .style("font-family", H.fontFamily)
                .style("font-size", headerFontSize + "px")
                .style("font-weight", String(H.weight))
                .style("font-style", H.italic ? "italic" : "normal")
                .text(titre);
        });
    }
    return { echelle: echelleObtenue, reserve };
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
 * même ligne, décalée de ± une demi-épaisseur — c'est `bandePath`, dont le
 * ruban entier n'est qu'un cas particulier.
 */
function ribbonPath(
    link: ELink, curveType: string, curvature: number, fleche: FlecheLiens | null = null
): string {
    const hw = Math.max(0, link.width ?? 0) / 2;
    return bandePath(link, -hw, hw, curveType, curvature, fleche);
}

/**
 * Bandeau de la part bio / durable : la TRANCHE HAUTE du ruban, de son bord
 * supérieur jusqu'à la fraction demandée de son épaisseur. À 100 % il recouvre
 * le ruban entier, à 0 % il n'est pas dessiné du tout.
 */
function bandeauBio(
    link: ELink, curveType: string, curvature: number, fleche: FlecheLiens | null = null
): string {
    const hw = Math.max(0, link.width ?? 0) / 2;
    return bandePath(link, -hw, -hw + 2 * hw * partBio(link), curveType, curvature, fleche);
}

/** L'axe du ruban : son départ, les escales traversées, son arrivée. */
function axeRuban(link: ELink): [number, number][] {
    const s = link.source as ENode;
    const t = link.target as ENode;
    const pts: [number, number][] = [[s.x1 ?? 0, link.y0 ?? 0]];
    (link.passages ?? []).forEach(p => {
        pts.push([p.x0, p.y]);
        pts.push([p.x1, p.y]);
    });
    pts.push([t.x0 ?? 0, link.y1 ?? 0]);
    return pts;
}

/**
 * Pointe d'un ruban : où son corps s'arrête (`base`) et combien la pointe
 * avance au-delà (`longueur`), jusqu'à `separation` pixels du nœud.
 *
 * La pointe ne déborde JAMAIS de l'épaisseur du ruban : sur un nœud, les rubans
 * arrivent empilés bord à bord, et une flèche plus large que son ruban
 * mordrait sur ses voisins. Sa longueur se déduit donc de l'angle —
 * demi-épaisseur / tan(angle / 2) — et se borne à la moitié du dernier
 * segment, pour qu'un ruban épais entre deux colonnes serrées garde un corps.
 */
function pointeRuban(
    pts: [number, number][], hw: number, fleche: FlecheLiens
): { base: number; longueur: number } {
    const n = pts.length;
    const bout = pts[n - 1][0] - clamp(fleche.separation, 0, 200);
    const depart = pts[n - 2][0];
    const angle = (clamp(fleche.angle, 10, 170) * Math.PI) / 180;
    const place = Math.max(0, (bout - depart) / 2);
    const longueur = Math.min(hw / Math.tan(angle / 2), place);
    return { base: bout - longueur, longueur };
}

/**
 * Une BANDE du ruban : la portion comprise entre deux décalages de son axe
 * (en pixels, négatif vers le haut). Le ruban entier est la bande
 * [-épaisseur/2, +épaisseur/2] ; le bandeau bio en est une tranche.
 *
 * Les points de passage (colonnes seulement traversées) s'intercalent entre le
 * départ et l'arrivée : la bande file droit sur la largeur de l'escale, puis
 * repart vers le point suivant. Sans passage, le tracé est celui d'avant.
 *
 * Avec une flèche, le corps s'arrête plus tôt et la bande se referme sur le
 * profil de la pointe : une tranche du ruban (le bandeau bio) en épouse donc
 * exactement le bord, au lieu de dépasser en carré.
 */
function bandePath(
    link: ELink, de: number, a: number, curveType: string, curvature: number,
    fleche: FlecheLiens | null = null
): string {
    const pts = axeRuban(link);
    const hw = Math.max(0, link.width ?? 0) / 2;
    if (!fleche || hw <= 0) {
        const haut = bordRuban(pts, de, curveType, curvature);
        const bas = bordRuban(pts.slice().reverse(), a, curveType, curvature);
        return `M${haut} L${bas} Z`;
    }
    const { base, longueur } = pointeRuban(pts, hw, fleche);
    const y = pts[pts.length - 1][1];
    pts[pts.length - 1] = [base, y];
    // Abscisse du bord de la pointe à un décalage donné de l'axe.
    const profil = (o: number) => base + longueur * (1 - Math.min(1, Math.abs(o) / hw));
    const pointe: string[] = [`${profil(de)},${y + de}`];
    if (de < 0 && a > 0) pointe.push(`${base + longueur},${y}`);
    pointe.push(`${profil(a)},${y + a}`);
    const haut = bordRuban(pts, de, curveType, curvature);
    const bas = bordRuban(pts.slice().reverse(), a, curveType, curvature);
    return `M${haut} L${pointe.join(" L")} L${bas} Z`;
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

/**
 * La valeur d'un lien, telle qu'elle s'écrit sur son ruban.
 *
 * Deux réglages, et un seul des deux agit à la fois :
 *  - **un multiplicateur** (milliers, millions) divise TOUTES les valeurs et
 *    les écrit arrondies à l'entier. C'est le mode « je change d'unité » : les
 *    décimales n'ont plus de sens une fois qu'on lit en millions.
 *  - **sans multiplicateur**, la valeur garde son ordre de grandeur et n'est
 *    arrondie qu'à N chiffres significatifs.
 *
 * Ni l'un ni l'autre n'abrège plus tout seul en « k »/« M » : ce format-là se
 * décidait valeur par valeur, et deux rubans voisins (« 999 » et « 1,0 k »)
 * ne se comparaient plus. Le multiplicateur porte ce choix, une fois pour tout
 * le diagramme.
 */
function formatValeurLien(
    v: number,
    multiplicateur: string,
    chiffresSignificatifs: number
): string {
    if (!isFinite(v)) return "";
    const diviseur = diviseurDe(multiplicateur);
    if (diviseur > 1) {
        return Math.round(v / diviseur).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
    }
    return arrondiSignificatif(v, chiffresSignificatifs);
}

/**
 * Un nombre ramené à `n` chiffres significatifs, écrit à la française.
 *
 * Les décimales à conserver se déduisent de l'ordre de grandeur du nombre
 * ARRONDI, pas du nombre d'origine : arrondir 9,99 à deux chiffres donne 10, et
 * lui laisser la décimale de 9,99 écrirait « 10,0 » — un chiffre significatif
 * de trop. `maximumFractionDigits` n'ayant pas de minimum en face, un entier
 * reste écrit sans virgule.
 */
function arrondiSignificatif(v: number, n: number): string {
    const chiffres = clamp(Math.round(n) || 0, 1, 15);
    if (v === 0) return "0";
    const r = Number(v.toPrecision(chiffres));
    const dec = clamp(chiffres - 1 - Math.floor(Math.log10(Math.abs(r))), 0, 20);
    return r.toLocaleString("fr-FR", { maximumFractionDigits: dec });
}

/**
 * Part d'un total, écrite en pour cent entiers. Une part non nulle mais sous
 * le pour cent s'écrit « < 1 % » : « 0 % » dirait qu'il n'y a rien.
 */
function formatPart(p: number): string {
    const pct = p * 100;
    if (!isFinite(pct) || pct <= 0) return "0\u202f%";
    if (pct < 0.5) return "<\u202f1\u202f%";
    return Math.round(pct).toLocaleString("fr-FR") + "\u202f%";
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
 * Largeur approchée d'un texte, comptée en signes. Filet de secours de
 * `mesureTexte` là où le canevas manque : à nombre de signes égal, « IAA » et
 * « lili » n'occupent pourtant pas la même place, et c'est bien ce défaut-là
 * qui a fait remplacer cette formule partout où l'on pose un fond ou réserve
 * une marge. Elle ne sert donc plus qu'à ne pas rendre un dessin vide.
 */
function estimateTextWidth(text: string, fontSize: number, gras: boolean): number {
    return text.length * fontSize * (gras ? 0.62 : 0.55);
}

/**
 * Largeur RÉELLEMENT peinte d'un texte, mesurée dans sa propre police.
 *
 * Tout ce qui épouse un texte passe par ici — le fond d'une étiquette de nœud,
 * le bandeau d'un titre de colonne, la gouttière des noms de couloirs : deviner
 * cette largeur au nombre de signes laisse le fond flotter autour d'un mot court
 * et déborder d'un mot long. Le canevas, lui, mesure la vraie chaîne dans la
 * vraie police — et il la mesure HORS du document, donc aussi pendant un rendu
 * détaché (mesure d'échelle, export) où `getBBox` ne rendrait que zéro.
 *
 * Le texte arrive DÉJÀ mis en forme, capitales comprises : rien à transformer
 * ici. Faute de canevas (environnement sans DOM), on retombe sur l'estimation —
 * un fond un peu large vaut mieux qu'un dessin qui échoue.
 */
let ctxMesure: CanvasRenderingContext2D | null | undefined;
const cacheMesure = new Map<string, number>();

function mesureTexte(
    text: string,
    fontSize: number,
    graisse: number,
    italique: boolean,
    famille: string
): number {
    if (!text) return 0;
    // La graisse EXACTE, pas « gras ou non » : une demi-graisse (500, 600) ne
    // s'écrit pas à la largeur du 400 ni à celle du 700.
    const font = `${italique ? "italic " : ""}${graisse} ${fontSize}px ${famille}`;
    const cle = font + "\u0000" + text;
    const connu = cacheMesure.get(cle);
    if (connu !== undefined) return connu;
    if (ctxMesure === undefined) {
        try {
            ctxMesure = document.createElement("canvas").getContext("2d");
        } catch {
            ctxMesure = null;
        }
    }
    if (!ctxMesure) return estimateTextWidth(text, fontSize, graisse >= 600);
    ctxMesure.font = font;
    const w = ctxMesure.measureText(text).width;
    /* Un cache sans fin retiendrait tous les libellés d'un gros classeur : au
       delà d'un millier d'entrées on repart de zéro, une mesure ne coûtant
       presque rien. */
    if (cacheMesure.size > 1000) cacheMesure.clear();
    cacheMesure.set(cle, w);
    return w;
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
