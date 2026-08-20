// Moteur de rendu Sankey — porté depuis le visuel Power BI (visual.ts),
// rendu indépendant de tout framework, dans un élément <svg>.

import { select } from "d3-selection";
import { sankey } from "d3-sankey";
import { FlowModel, SankeyOptions } from "./types";

interface ENode {
    id: string;
    name: string;
    layer: number;
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

    const defs = svg.append("defs");
    const gLinks = svg.append("g");
    const gNodes = svg.append("g");
    const gLinkValues = svg.append("g");
    const gLabels = svg.append("g");
    const gHeaders = svg.append("g");

    /* ---- Couches (colonnes) + titres ----
       Le numéro de colonne fixe une position MINIMALE. Un nœud est décalé d'une
       colonne vers la droite si un lien l'exige (target après source), ce qui
       garantit un flux gauche→droite valide même si deux nœuds reliés partagent
       le même numéro de colonne. */
    const nodeById = new Map(model.nodes.map(n => [n.id, n]));
    const distinctCols = Array.from(new Set(model.nodes.map(n => n.column))).sort(
        (a, b) => a - b
    );
    const denseByRaw = new Map<number, number>();
    distinctCols.forEach((c, i) => denseByRaw.set(c, i));

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

    // Couche de chaque nœud : plus long chemin, borné par la colonne demandée.
    const layerById = new Map<string, number>();
    model.nodes.forEach(n => layerById.set(n.id, denseByRaw.get(n.column)!));
    let changed = true;
    let guard = 0;
    while (changed && guard++ < model.nodes.length + 5) {
        changed = false;
        for (const l of eLinks) {
            const need = (layerById.get(l.source as string) ?? 0) + 1;
            if (need > (layerById.get(l.target as string) ?? 0)) {
                layerById.set(l.target as string, need);
                changed = true;
            }
        }
    }

    const titleByLayer = new Map<number, string>();
    model.nodes.forEach(n => {
        const layer = layerById.get(n.id)!;
        if (n.title && !titleByLayer.has(layer)) titleByLayer.set(layer, n.title);
    });

    const eNodes: ENode[] = model.nodes.map(n => ({
        id: n.id,
        name: n.name,
        layer: layerById.get(n.id)!,
        order: typeof n.order === "number" ? n.order : 0,
        color: n.color ?? null
    }));

    const nCols = Math.max(1, Math.max(...eNodes.map(n => n.layer)) + 1);
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

    const left = 2;
    const right = width - 2;
    const top = topMargin;
    const bottom = height - 6;
    if (right - left < 4 || bottom - top < 4) return;

    /* ---- Layout d3-sankey ---- */
    const gen = sankey<ENode, ELink>()
        .nodeId((d: ENode) => d.id)
        .nodeWidth(nodeWidth)
        .nodePadding(nodePadding)
        .nodeAlign((n: ENode) => n.layer)
        .extent([[left, top], [right, bottom]]);

    // Ordre vertical des nœuds dans chaque colonne, piloté par node.order.
    gen.nodeSort((a: ENode, b: ENode) => a.order - b.order);

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
        return;
    }

    // Position horizontale forcée par la couche du nœud.
    const kx = nCols > 1 ? (right - left - nodeWidth) / (nCols - 1) : 0;
    (graph.nodes as ENode[]).forEach(n => {
        n.x0 = left + n.layer * kx;
        n.x1 = n.x0 + nodeWidth;
    });

    // Centrage vertical de chaque colonne.
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

    // Empilement des rubans à chaque nœud, en suivant l'ordre vertical des
    // nœuds connectés (à partir des positions finales des nœuds).
    (graph.nodes as ENode[]).forEach(n => {
        const out = (n.sourceLinks ?? []).slice().sort(
            (a, b) => (a.target as ENode).order - (b.target as ENode).order
        );
        let sy = n.y0 ?? 0;
        out.forEach(l => {
            l.y0 = sy + (l.width ?? 0) / 2;
            sy += l.width ?? 0;
        });
        const inc = (n.targetLinks ?? []).slice().sort(
            (a, b) => (a.source as ENode).order - (b.source as ENode).order
        );
        let ty = n.y0 ?? 0;
        inc.forEach(l => {
            l.y1 = ty + (l.width ?? 0) / 2;
            ty += l.width ?? 0;
        });
    });

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
                .attr("id", `grad${i}`)
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
        .attr("fill", (d: ELink, i: number) =>
            L.useGradient ? `url(#grad${i})` : startColor(d)
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
    gNodes
        .selectAll("rect")
        .data(graph.nodes as ENode[])
        .enter()
        .append("rect")
        .attr("x", (d: ENode) => d.x0 ?? 0)
        .attr("y", (d: ENode) => d.y0 ?? 0)
        .attr("width", (d: ENode) => Math.max(0, (d.x1 ?? 0) - (d.x0 ?? 0)))
        .attr("height", (d: ENode) => Math.max(0, (d.y1 ?? 0) - (d.y0 ?? 0)))
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

function wrapText(text: string, maxChars: number): string[] {
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
