// Moteur de rendu Sankey — porté depuis le visuel Power BI (visual.ts),
// rendu indépendant de tout framework, dans un élément <svg>.

import { select } from "d3-selection";
import { sankey } from "d3-sankey";
import { FlowModel, SankeyOptions } from "./types";

interface ENode {
    id: string;
    name: string;
    layer: number;
    lane: number;
    order: number;
    color: string | null;
    x0?: number;
    x1?: number;
    y0?: number;
    y1?: number;
    value?: number;
    sourceLinks?: ELink[];
    targetLinks?: ELink[];
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
}

/** Couloir d'un nœud, ramené à un entier >= 1. */
function laneOf(n: { lane?: number }): number {
    const v = Math.round(n.lane as number);
    return isFinite(v) && v >= 1 ? v : 1;
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
    height: number
): void {
    const svg = select(svgEl);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    // Fond blanc (aperçu + export d'image propres)
    svg.append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", width)
        .attr("height", height)
        .attr("fill", "#ffffff");

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
    height: number
): void {
    const svg = select(svgEl);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    svg.append("rect")
        .attr("x", 0).attr("y", 0)
        .attr("width", width).attr("height", height)
        .attr("fill", "#ffffff");

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
                .style("font-weight", F.bold ? "700" : "400")
                .style("font-style", F.italic ? "italic" : "normal")
                .text(g.nom || "(sans filière)");
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
        color: n.color ?? null
    }));

    const nCols = Math.max(
        1,
        grille ? grille.nCols : Math.max(...eNodes.map(n => n.layer)) + 1
    );
    const nodeWidth = clamp(opt.nodes.nodeWidth, 1, 60);
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
    const nomCouloir = (l: number) =>
        (opt.lanes.showTitles && opt.lanes.titles && opt.lanes.titles[String(l)]) || "";
    const tailleCouloir = clamp(opt.lanes.fontSize, 4, 60);
    const gouttiere =
        couloirsModele.length > 1
            ? couloirsModele.reduce(
                (m, l) => Math.max(m, nomCouloir(l)
                    ? estimateTextWidth(nomCouloir(l), tailleCouloir, opt.lanes.bold) + 14
                    : 0),
                0
            )
            : 0;

    const left = 2 + Math.min(gouttiere, Math.max(0, width * 0.3));
    const right = width - 2;
    const top = topMargin;
    const bottom = height - 6;
    if (right - left < 4 || bottom - top < 4) return 0;

    /* ---- Layout d3-sankey ---- */
    const gen = sankey<ENode, ELink>()
        .nodeId((d: ENode) => d.id)
        .nodeWidth(nodeWidth)
        .nodePadding(nodePadding)
        .nodeAlign((n: ENode) => n.layer)
        .extent([[left, top], [right, bottom]]);

    // Ordre vertical des nœuds dans chaque colonne : couloir d'abord (les bandes
    // s'empilent de haut en bas), puis node.order à l'intérieur du couloir.
    gen.nodeSort((a: ENode, b: ENode) => a.lane - b.lane || a.order - b.order);

    let graph: { nodes: ENode[]; links: ELink[] };
    try {
        graph = gen({
            nodes: eNodes.map(n => Object.assign({}, n)),
            links: eLinks.map(l => Object.assign({}, l))
        }) as { nodes: ENode[]; links: ELink[] };
    } catch (e) {
        drawMessage(
            svg, width, height,
            "Impossible d'afficher le Sankey (données de flux invalides, ex. lien circulaire)."
        );
        return 0;
    }

    // Position horizontale forcée par la couche du nœud.
    const kx = nCols > 1 ? (right - left - nodeWidth) / (nCols - 1) : 0;
    (graph.nodes as ENode[]).forEach(n => {
        n.x0 = left + n.layer * kx;
        n.x1 = n.x0 + nodeWidth;
    });

    const couloirs = Array.from(new Set((graph.nodes as ENode[]).map(n => n.lane)))
        .sort((a, b) => a - b);

    if (couloirs.length > 1) {
        placerParCouloirs(graph, couloirs, opt, top, bottom, nodePadding);
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
            colDelta.set(c, top + (bottom - top - (b.max - b.min)) / 2 - b.min)
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

    /* ---- Noms des couloirs, dans la gouttière de gauche ---- */
    if (couloirs.length > 1 && gouttiere > 0) {
        const C = opt.lanes;
        const gCouloirs = svg.append("g");
        couloirs.forEach(lane => {
            const nom = nomCouloir(lane);
            if (!nom) return;
            const dedans = (graph.nodes as ENode[]).filter(n => n.lane === lane);
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
                .style("font-weight", C.bold ? "700" : "400")
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
        (graph.links as ELink[]).forEach((d, i) => {
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
        .data(graph.links as ELink[])
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
    (graph.nodes as ENode[]).forEach(n => {
        const v = (n as any).value as number;
        if (v > 0) echelleObtenue = Math.max(echelleObtenue, (((n.y1 ?? 0) - (n.y0 ?? 0)) / v));
    });

    gNodes
        .selectAll("rect")
        .data(graph.nodes as ENode[])
        .enter()
        .append("rect")
        .attr("x", (d: ENode) => d.x0 ?? 0)
        .attr("y", (d: ENode) => d.y0 ?? 0)
        .attr("width", (d: ENode) => Math.max(0, (d.x1 ?? 0) - (d.x0 ?? 0)))
        .attr("height", (d: ENode) => Math.max(0, (d.y1 ?? 0) - (d.y0 ?? 0)))
        // Repère stable pour les tests et le débogage, comme en vue d'édition.
        .attr("data-id", (d: ENode) => d.id)
        .attr("fill", (d: ENode) => nodeDisplayColor(d));

    /* ---- Valeurs des liens (derrière les étiquettes, inclinées) ---- */
    const V = opt.linkValueLabels;
    if (V.show) {
        const vfs = clamp(V.fontSize, 4, 60);
        const fallbackUnit = (V.unitText || "").trim();
        const mx = (d: ELink) => ((d.source as ENode).x1! + (d.target as ENode).x0!) / 2;
        const my = (d: ELink) => (d.y0! + d.y1!) / 2;
        gLinkValues
            .selectAll("text")
            .data((graph.links as ELink[]).filter(l => (l.width ?? 0) >= vfs * 0.9))
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
            .style("font-weight", V.bold ? "bold" : "normal")
            .style("font-style", V.italic ? "italic" : "normal")
            .style("pointer-events", "none")
            .text((d: ELink) => {
                const unit = (d.unit || fallbackUnit).trim();
                const v = formatNumber(d.value);
                return unit ? `${v} ${unit}` : v;
            });
    }

    /* ---- Étiquettes des nœuds ---- */
    const NL = opt.nodeLabels;
    if (NL.show) {
        const fs = clamp(NL.fontSize, 4, 60);
        const lineHeight = fs * 1.2;
        const midX = width / 2;
        const below = NL.position === "dessous";
        const bgOpacity = clamp(NL.backgroundOpacity, 0, 100) / 100;
        const maxChars = Math.max(1, Math.round(NL.maxChars));
        const gap = 6;
        const padX = 4;
        const padY = 2;

        (graph.nodes as ENode[]).forEach(d => {
            const labelText = NL.showValue
                ? `${d.name} (${formatNumber(d.value ?? 0)})`
                : d.name;
            const lines = NL.wrap ? wrapText(labelText, maxChars) : [labelText];
            const maxLineW = Math.max(...lines.map(ln => estimateTextWidth(ln, fs, NL.bold)));
            const centerY = ((d.y0 ?? 0) + (d.y1 ?? 0)) / 2;
            const nodeCenterX = ((d.x0 ?? 0) + (d.x1 ?? 0)) / 2;

            let anchor: string, anchorX: number, blockTopY: number, rectX: number;
            if (below) {
                anchor = "middle";
                anchorX = nodeCenterX;
                blockTopY = (d.y1 ?? 0) + gap;
                rectX = nodeCenterX - maxLineW / 2 - padX;
            } else {
                const isLeft = (d.x0 ?? 0) < midX;
                anchor = isLeft ? "start" : "end";
                anchorX = isLeft ? (d.x1 ?? 0) + gap : (d.x0 ?? 0) - gap;
                blockTopY = centerY - (lines.length * lineHeight) / 2;
                rectX = isLeft ? anchorX - padX : anchorX - maxLineW - padX;
            }

            const g = gLabels.append("g");
            if (NL.showBackground) {
                g.append("rect")
                    .attr("x", rectX)
                    .attr("y", blockTopY - padY)
                    .attr("width", maxLineW + padX * 2)
                    .attr("height", lines.length * lineHeight + padY * 2)
                    .attr("rx", 2)
                    .attr("fill", NL.backgroundColor)
                    .attr("fill-opacity", bgOpacity);
            }
            const text = g
                .append("text")
                .attr("x", anchorX)
                .attr("text-anchor", anchor)
                .attr("fill", NL.fontColor)
                .style("font-family", NL.fontFamily)
                .style("font-size", fs + "px")
                .style("font-weight", NL.bold ? "bold" : "normal")
                .style("font-style", NL.italic ? "italic" : "normal");
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
            const nodeCenterX = left + layer * kx + nodeWidth / 2;
            const textW = estimateTextWidth(title, headerFontSize, H.bold);
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
                .style("font-weight", H.bold ? "bold" : "normal")
                .style("font-style", H.italic ? "italic" : "normal")
                .text(title);
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

function ribbonPath(link: ELink, curveType: string, curvature: number): string {
    const s = link.source as ENode;
    const t = link.target as ENode;
    const sx = s.x1 ?? 0;
    const tx = t.x0 ?? 0;
    const sy = link.y0 ?? 0;
    const ty = link.y1 ?? 0;
    const hw = Math.max(0, link.width ?? 0) / 2;
    const sTop = sy - hw, sBot = sy + hw, tTop = ty - hw, tBot = ty + hw;

    if (curveType === "droite") {
        return `M${sx},${sTop} L${tx},${tTop} L${tx},${tBot} L${sx},${sBot} Z`;
    }
    if (curveType === "marches") {
        const xm = (sx + tx) / 2;
        return (
            `M${sx},${sTop} L${xm},${sTop} L${xm},${tTop} L${tx},${tTop} ` +
            `L${tx},${tBot} L${xm},${tBot} L${xm},${sBot} L${sx},${sBot} Z`
        );
    }
    const c = 0.15 + curvature * 0.35;
    const cx1 = sx + (tx - sx) * c;
    const cx2 = tx - (tx - sx) * c;
    return (
        `M${sx},${sTop} C${cx1},${sTop} ${cx2},${tTop} ${tx},${tTop} ` +
        `L${tx},${tBot} C${cx2},${tBot} ${cx1},${sBot} ${sx},${sBot} Z`
    );
}

function linkMidAngle(link: ELink, curveType: string, curvature: number): number {
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

function estimateTextWidth(text: string, fontSize: number, bold: boolean): number {
    return text.length * fontSize * (bold ? 0.62 : 0.55);
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
