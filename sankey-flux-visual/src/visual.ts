"use strict";

import powerbi from "powerbi-visuals-api";
import { select, Selection } from "d3-selection";
import { sankey } from "d3-sankey";

import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import {
    createTooltipServiceWrapper,
    ITooltipServiceWrapper
} from "powerbi-visuals-utils-tooltiputils";

import { VisualFormattingSettingsModel } from "./settings";

import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import DataView = powerbi.DataView;
import DataViewTable = powerbi.DataViewTable;
import ISelectionId = powerbi.visuals.ISelectionId;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import PrimitiveValue = powerbi.PrimitiveValue;

/* ----------------------------------------------------------------------- */
/* Modèles de données internes                                              */
/* ----------------------------------------------------------------------- */

interface SankeyNode {
    name: string;
    col: number | undefined; // colonne dense (0..n-1)
    // rempli par d3-sankey :
    x0?: number;
    x1?: number;
    y0?: number;
    y1?: number;
    value?: number;
    index?: number;
    sourceLinks?: SankeyLink[];
    targetLinks?: SankeyLink[];
}

interface SankeyLink {
    source: string | SankeyNode;
    target: string | SankeyNode;
    value: number;
    color: string | null;
    order: number;
    unit: string;
    tooltipItems: { label: string; value: string }[];
    selectionId: ISelectionId | null;
    // rempli par d3-sankey :
    y0?: number;
    y1?: number;
    width?: number;
}

interface ColumnHeader {
    col: number;
    title: string;
}

/* ----------------------------------------------------------------------- */
/* Visuel                                                                   */
/* ----------------------------------------------------------------------- */

export class Visual implements IVisual {
    private host: IVisualHost;
    private rootElement: HTMLElement;
    private svg: Selection<SVGSVGElement, unknown, null, undefined>;
    private defs: Selection<SVGDefsElement, unknown, null, undefined>;
    private gLinks: Selection<SVGGElement, unknown, null, undefined>;
    private gNodes: Selection<SVGGElement, unknown, null, undefined>;
    private gLinkValues: Selection<SVGGElement, unknown, null, undefined>;
    private gLabels: Selection<SVGGElement, unknown, null, undefined>;
    private gHeaders: Selection<SVGGElement, unknown, null, undefined>;

    private formattingSettingsService: FormattingSettingsService;
    private settings: VisualFormattingSettingsModel;
    private tooltipServiceWrapper: ITooltipServiceWrapper;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.rootElement = options.element;
        this.formattingSettingsService = new FormattingSettingsService();

        this.tooltipServiceWrapper = createTooltipServiceWrapper(
            this.host.tooltipService,
            options.element
        );

        this.svg = select(this.rootElement)
            .classed("sankey-flux", true)
            .append("svg");

        this.defs = this.svg.append("defs");

        // Ordre de rendu (du dessous vers le dessus) :
        // liens < nœuds < valeurs des liens < étiquettes des nœuds < titres
        // -> les étiquettes de nœuds passent DEVANT les valeurs des liens.
        this.gLinks = this.svg.append("g").classed("links", true);
        this.gNodes = this.svg.append("g").classed("nodes", true);
        this.gLinkValues = this.svg.append("g").classed("link-values", true);
        this.gLabels = this.svg.append("g").classed("labels", true);
        this.gHeaders = this.svg.append("g").classed("headers", true);
    }

    public update(options: VisualUpdateOptions): void {
        const dataView: DataView | undefined =
            options.dataViews && options.dataViews[0];

        this.settings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualFormattingSettingsModel,
            dataView
        );

        const width = Math.max(1, options.viewport.width);
        const height = Math.max(1, options.viewport.height);

        this.svg.attr("width", width).attr("height", height);

        // Réinitialise le rendu
        this.defs.selectAll("*").remove();
        this.gLinks.selectAll("*").remove();
        this.gNodes.selectAll("*").remove();
        this.gLinkValues.selectAll("*").remove();
        this.gLabels.selectAll("*").remove();
        this.gHeaders.selectAll("*").remove();

        if (!dataView || !dataView.table) {
            return;
        }

        const parsed = this.parseData(dataView.table);
        if (parsed.nodes.length === 0 || parsed.links.length === 0) {
            return;
        }

        this.render(parsed, width, height);
    }

    /* ------------------------------------------------------------------- */
    /* Lecture des données                                                  */
    /* ------------------------------------------------------------------- */

    private parseData(table: DataViewTable): {
        nodes: SankeyNode[];
        links: SankeyLink[];
        headers: ColumnHeader[];
        hasOrder: boolean;
    } {
        const columns = table.columns;
        const roleIndex = (role: string): number =>
            columns.findIndex(c => c.roles && (c.roles as { [k: string]: boolean })[role]);

        const iSource = roleIndex("source");
        const iDest = roleIndex("destination");
        const iColNum = roleIndex("columnNumber");
        const iColTitle = roleIndex("columnTitle");
        const iValue = roleIndex("value");
        const iColor = roleIndex("linkColor");
        const iOrder = roleIndex("linkOrder");
        const iUnit = roleIndex("unit");

        // Colonnes affectées au rôle "infobulle" (peuvent être multiples)
        const tooltipCols: number[] = [];
        columns.forEach((c, idx) => {
            if (c.roles && (c.roles as { [k: string]: boolean })["tooltip"]) {
                tooltipCols.push(idx);
            }
        });

        if (iSource < 0 || iDest < 0) {
            return { nodes: [], links: [], headers: [], hasOrder: false };
        }

        const rows = table.rows || [];

        const asString = (v: PrimitiveValue | undefined): string =>
            v === null || v === undefined ? "" : String(v).trim();
        const asNumber = (v: PrimitiveValue | undefined): number => {
            const n = typeof v === "number" ? v : parseFloat(String(v));
            return isFinite(n) ? n : 0;
        };

        // Numéro de colonne brut par nœud (défini via ses lignes "origine")
        const rawColByNode = new Map<string, number>();
        // Titre par numéro de colonne brut (première valeur non vide rencontrée)
        const titleByRawCol = new Map<number, string>();

        interface RawLink {
            source: string;
            target: string;
            value: number;
            color: string | null;
            order: number;
            unit: string;
            rowIndex: number;
            tooltipItems: { label: string; value: string }[];
        }
        const rawLinks: RawLink[] = [];

        rows.forEach((row, rowIndex) => {
            const source = asString(row[iSource]);
            const target = asString(row[iDest]);
            if (!source || !target) {
                return;
            }

            const value = iValue >= 0 ? asNumber(row[iValue]) : 1;
            const color = iColor >= 0 ? asString(row[iColor]) || null : null;
            // Ordre : champ dédié si présent, sinon l'ordre des lignes de l'Excel
            const order = iOrder >= 0 ? asNumber(row[iOrder]) : rowIndex;
            const unit = iUnit >= 0 ? asString(row[iUnit]) : "";

            if (iColNum >= 0) {
                const raw = asNumber(row[iColNum]);
                if (isFinite(raw) && !rawColByNode.has(source)) {
                    rawColByNode.set(source, raw);
                }
                if (iColTitle >= 0) {
                    const title = asString(row[iColTitle]);
                    if (title && !titleByRawCol.has(raw)) {
                        titleByRawCol.set(raw, title);
                    }
                }
            }

            const tooltipItems = tooltipCols.map(ci => ({
                label: columns[ci].displayName,
                value: asString(row[ci])
            }));

            rawLinks.push({ source, target, value, color, order, unit, rowIndex, tooltipItems });
        });

        // Remappe les numéros de colonne bruts vers des indices denses 0..K-1
        // (déduplique : plusieurs nœuds partagent le même numéro de colonne)
        const distinctRaw = Array.from(new Set(rawColByNode.values())).sort(
            (a, b) => a - b
        );
        const denseByRaw = new Map<number, number>();
        distinctRaw.forEach((raw, i) => denseByRaw.set(raw, i));

        // Construit l'ensemble des nœuds
        const nodeMap = new Map<string, SankeyNode>();
        const ensureNode = (name: string): SankeyNode => {
            let n = nodeMap.get(name);
            if (!n) {
                n = { name, col: undefined };
                nodeMap.set(name, n);
            }
            return n;
        };

        rawLinks.forEach(l => {
            ensureNode(l.source);
            ensureNode(l.target);
        });

        // Colonne des nœuds qui sont des "origines"
        rawColByNode.forEach((raw, name) => {
            const node = nodeMap.get(name);
            if (node) {
                node.col = denseByRaw.get(raw);
            }
        });

        // Colonne des nœuds terminaux (uniquement destination) :
        // placés juste après la colonne maximale de leurs origines.
        let changed = true;
        let guard = 0;
        while (changed && guard < 1000) {
            changed = false;
            guard++;
            rawLinks.forEach(l => {
                const s = nodeMap.get(l.source)!;
                const t = nodeMap.get(l.target)!;
                if (s.col !== undefined) {
                    const candidate = s.col + 1;
                    if (t.col === undefined || (t.col <= s.col)) {
                        // Un nœud destination doit toujours être à droite de son origine
                        const isSourceElsewhere = rawColByNode.has(t.name);
                        if (!isSourceElsewhere && (t.col === undefined || candidate > t.col)) {
                            t.col = candidate;
                            changed = true;
                        }
                    }
                }
            });
        }

        // Nœuds isolés éventuels
        nodeMap.forEach(n => {
            if (n.col === undefined) {
                n.col = 0;
            }
        });

        // Titres de colonnes (indice dense)
        const headers: ColumnHeader[] = [];
        titleByRawCol.forEach((title, raw) => {
            const dense = denseByRaw.get(raw);
            if (dense !== undefined && title) {
                headers.push({ col: dense, title });
            }
        });

        // Fusionne les liens de mêmes extrémités
        const linkMap = new Map<string, SankeyLink>();
        rawLinks.forEach(l => {
            const key = l.source + " " + l.target;
            const existing = linkMap.get(key);
            if (existing) {
                existing.value += l.value;
                existing.order = Math.min(existing.order, l.order);
                if (!existing.unit && l.unit) {
                    existing.unit = l.unit;
                }
            } else {
                const selectionId = this.host
                    .createSelectionIdBuilder()
                    .withTable(table, l.rowIndex)
                    .createSelectionId();

                linkMap.set(key, {
                    source: l.source,
                    target: l.target,
                    value: l.value,
                    color: l.color,
                    order: l.order,
                    unit: l.unit,
                    tooltipItems: l.tooltipItems,
                    selectionId
                });
            }
        });

        return {
            nodes: Array.from(nodeMap.values()),
            links: Array.from(linkMap.values()),
            headers,
            hasOrder: iOrder >= 0
        };
    }

    /* ------------------------------------------------------------------- */
    /* Rendu                                                                */
    /* ------------------------------------------------------------------- */

    private render(
        data: {
            nodes: SankeyNode[];
            links: SankeyLink[];
            headers: ColumnHeader[];
            hasOrder: boolean;
        },
        width: number,
        height: number
    ): void {
        const s = this.settings;

        const nodeWidth = clamp(s.nodes.nodeWidth.value, 1, 60);
        const nodePadding = clamp(s.nodes.nodePadding.value, 0, 200);

        const nCols = Math.max(1, Math.max(...data.nodes.map(n => (n.col ?? 0))) + 1);

        // Marge supérieure réservée aux titres de colonnes (+ marges réglables)
        const headersVisible = s.columnHeaders.show.value && data.headers.length > 0;
        const headerFontSize = clamp(s.columnHeaders.fontSize.value, 4, 60);
        const headerMarginTop = clamp(s.columnHeaders.marginTop.value, 0, 200);
        const headerMarginBottom = clamp(s.columnHeaders.marginBottom.value, 0, 200);
        const headerBarHeight = headerFontSize + 8; // hauteur du bandeau
        const topMargin = headersVisible
            ? headerMarginTop + headerBarHeight + headerMarginBottom
            : 6;
        const bottomMargin = 6;
        const sideMargin = 2;

        const left = sideMargin;
        const right = width - sideMargin;
        const top = topMargin;
        const bottom = height - bottomMargin;

        if (right - left < 4 || bottom - top < 4) {
            return;
        }

        // Layout d3-sankey : la fonction d'alignement force la colonne cible.
        const sankeyGen = sankey<SankeyNode, SankeyLink>()
            .nodeId((d: SankeyNode) => d.name)
            .nodeWidth(nodeWidth)
            .nodePadding(nodePadding)
            .nodeAlign((n: SankeyNode) => (n.col ?? 0))
            .extent([[left, top], [right, bottom]]);

        // Ordre d'affichage des liens (et des nœuds) piloté par le champ dédié.
        if (data.hasOrder) {
            sankeyGen.linkSort((a: SankeyLink, b: SankeyLink) => a.order - b.order);
            sankeyGen.nodeSort(
                (a: SankeyNode, b: SankeyNode) => nodeOrderKey(a) - nodeOrderKey(b)
            );
        }

        // d3-sankey mute les tableaux : on lui passe des copies légères.
        const graph = sankeyGen({
            nodes: data.nodes.map(n => Object.assign({}, n)),
            links: data.links.map(l => Object.assign({}, l))
        });

        // Force la position horizontale à partir de l'indice de colonne dense,
        // indépendamment du calcul de profondeur de d3-sankey.
        const kx = nCols > 1 ? (right - left - nodeWidth) / (nCols - 1) : 0;
        graph.nodes.forEach((n: SankeyNode) => {
            n.x0 = left + (n.col ?? 0) * kx;
            n.x1 = n.x0 + nodeWidth;
        });

        // Centre verticalement le bloc de nœuds de chaque colonne : l'espace
        // libre est réparti équitablement en haut et en bas de la colonne.
        const colBounds = new Map<number, { min: number; max: number }>();
        graph.nodes.forEach((n: SankeyNode) => {
            const c = n.col ?? 0;
            const b = colBounds.get(c) ?? { min: Infinity, max: -Infinity };
            b.min = Math.min(b.min, n.y0 ?? 0);
            b.max = Math.max(b.max, n.y1 ?? 0);
            colBounds.set(c, b);
        });
        const colDelta = new Map<number, number>();
        colBounds.forEach((b, c) => {
            const blockHeight = b.max - b.min;
            const free = bottom - top - blockHeight;
            colDelta.set(c, top + free / 2 - b.min);
        });
        graph.nodes.forEach((n: SankeyNode) => {
            const d = colDelta.get(n.col ?? 0) ?? 0;
            n.y0 = (n.y0 ?? 0) + d;
            n.y1 = (n.y1 ?? 0) + d;
        });
        graph.links.forEach((l: SankeyLink) => {
            const sc = (l.source as SankeyNode).col ?? 0;
            const tc = (l.target as SankeyNode).col ?? 0;
            l.y0 = (l.y0 ?? 0) + (colDelta.get(sc) ?? 0);
            l.y1 = (l.y1 ?? 0) + (colDelta.get(tc) ?? 0);
        });

        this.renderLinks(graph.links as SankeyLink[]);
        this.renderNodes(graph.nodes as SankeyNode[]);
        this.renderLabels(graph.nodes as SankeyNode[], width);
        this.renderLinkValueLabels(graph.links as SankeyLink[]);
        if (headersVisible) {
            this.renderHeaders(
                data.headers,
                left,
                kx,
                nodeWidth,
                headerFontSize,
                width,
                headerMarginTop
            );
        }
    }

    private renderLinks(links: SankeyLink[]): void {
        const s = this.settings.links;
        const defaultColor = s.defaultColor.value.value;
        const useDataColors = s.useDataColors.value;
        const useGradient = s.useGradient.value;
        const opacity = clamp(s.opacity.value, 0, 100) / 100;
        const curveType = s.curveType.value.value as string;
        const curvature = clamp(s.curvature.value, 0, 100) / 100;
        const showBorder = s.showBorder.value;
        const borderColor = s.borderColor.value.value;
        const borderWidth = clamp(s.borderWidth.value, 0, 10);
        const nodeColor = this.settings.nodes.nodeColor.value.value;
        const fromFirstLink = this.settings.nodes.colorFromFirstLink.value;

        // Couleur pleine d'un lien (champ de données ou couleur par défaut)
        const startColor = (d: SankeyLink): string =>
            useDataColors && d.color ? d.color : defaultColor;

        // Couleur affichée d'un nœud (cohérente avec renderNodes)
        const nodeDisplayColor = (n: SankeyNode): string =>
            fromFirstLink ? nodeFirstLinkColor(n, nodeColor) : nodeColor;

        // Crée les dégradés horizontaux gauche -> droite si l'option est active.
        // Le dégradé va de la couleur du NŒUD DE DÉPART à celle du NŒUD D'ARRIVÉE.
        if (useGradient) {
            links.forEach((d, i) => {
                const src = d.source as SankeyNode;
                const tgt = d.target as SankeyNode;
                const grad = this.defs
                    .append("linearGradient")
                    .attr("id", `sankeyGrad${i}`)
                    .attr("gradientUnits", "userSpaceOnUse")
                    .attr("x1", src.x1 ?? 0)
                    .attr("y1", d.y0 ?? 0)
                    .attr("x2", tgt.x0 ?? 0)
                    .attr("y2", d.y1 ?? 0);
                grad.append("stop")
                    .attr("offset", "0%")
                    .attr("stop-color", nodeDisplayColor(src));
                grad.append("stop")
                    .attr("offset", "100%")
                    .attr("stop-color", nodeDisplayColor(tgt));
            });
        }

        const sel = this.gLinks
            .selectAll<SVGPathElement, SankeyLink>("path.link")
            .data(links)
            .enter()
            .append("path")
            .classed("link", true)
            .attr("d", (d: SankeyLink) => ribbonPath(d, curveType, curvature))
            .attr("fill", (d: SankeyLink, i: number) =>
                useGradient ? `url(#sankeyGrad${i})` : startColor(d)
            )
            .attr("fill-opacity", opacity)
            .attr("stroke", showBorder ? borderColor : "none")
            .attr("stroke-width", showBorder ? borderWidth : 0)
            .attr("stroke-opacity", showBorder ? 1 : 0);

        // Infobulles
        this.tooltipServiceWrapper.addTooltip<SankeyLink>(
            sel,
            (d: SankeyLink) => this.buildTooltip(d),
            (d: SankeyLink) => d.selectionId
        );
    }

    private renderNodes(nodes: SankeyNode[]): void {
        const nodeColor = this.settings.nodes.nodeColor.value.value;
        const fromFirstLink = this.settings.nodes.colorFromFirstLink.value;

        this.gNodes
            .selectAll<SVGRectElement, SankeyNode>("rect.node-rect")
            .data(nodes)
            .enter()
            .append("rect")
            .classed("node-rect", true)
            .attr("x", (d: SankeyNode) => d.x0 ?? 0)
            .attr("y", (d: SankeyNode) => d.y0 ?? 0)
            .attr("width", (d: SankeyNode) => Math.max(0, (d.x1 ?? 0) - (d.x0 ?? 0)))
            .attr("height", (d: SankeyNode) => Math.max(0, (d.y1 ?? 0) - (d.y0 ?? 0)))
            .attr("fill", (d: SankeyNode) =>
                fromFirstLink ? nodeFirstLinkColor(d, nodeColor) : nodeColor
            );
    }

    private renderLabels(nodes: SankeyNode[], width: number): void {
        const s = this.settings.nodeLabels;
        if (!s.show.value) {
            return;
        }

        const fontSize = clamp(s.fontSize.value, 4, 60);
        const lineHeight = fontSize * 1.2;
        const midX = width / 2;
        const bold = s.bold.value;
        const showBg = s.showBackground.value;
        const bgColor = s.backgroundColor.value.value;
        const bgOpacity = clamp(s.backgroundOpacity.value, 0, 100) / 100;
        const wrapOn = s.wrap.value;
        const maxChars = Math.max(1, Math.round(s.maxChars.value));
        const below = (s.position.value.value as string) === "dessous";
        const gap = 6;
        const padX = 4;
        const padY = 2;

        nodes.forEach((d: SankeyNode) => {
            const fullText = s.showValue.value
                ? `${d.name} (${formatNumber(d.value ?? 0)})`
                : d.name;

            const lines = wrapOn ? wrapText(fullText, maxChars) : [fullText];
            const maxLineW = Math.max(
                ...lines.map(ln => estimateTextWidth(ln, fontSize, bold))
            );
            const centerY = ((d.y0 ?? 0) + (d.y1 ?? 0)) / 2;
            const nodeCenterX = ((d.x0 ?? 0) + (d.x1 ?? 0)) / 2;

            // Position : sous le nœud, ou sur le côté (défaut)
            let anchor: string;
            let anchorX: number;
            let blockTopY: number;
            let rectX: number;
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

            const g = this.gLabels.append("g");

            if (showBg) {
                g.append("rect")
                    .attr("x", rectX)
                    .attr("y", blockTopY - padY)
                    .attr("width", maxLineW + padX * 2)
                    .attr("height", lines.length * lineHeight + padY * 2)
                    .attr("rx", 2)
                    .attr("fill", bgColor)
                    .attr("fill-opacity", bgOpacity);
            }

            const text = g
                .append("text")
                .classed("node-label", true)
                .attr("x", anchorX)
                .attr("text-anchor", anchor)
                .attr("fill", s.fontColor.value.value)
                .style("font-family", s.fontFamily.value)
                .style("font-size", fontSize + "px")
                .style("font-weight", bold ? "bold" : "normal")
                .style("font-style", s.italic.value ? "italic" : "normal");

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

    private renderLinkValueLabels(links: SankeyLink[]): void {
        const s = this.settings.linkValueLabels;
        if (!s.show.value) {
            return;
        }

        const fontSize = clamp(s.fontSize.value, 4, 60);
        const fallbackUnit = (s.unitText.value || "").trim();
        const curveType = this.settings.links.curveType.value.value as string;
        const curvature = clamp(this.settings.links.curvature.value, 0, 100) / 100;

        const midX = (d: SankeyLink): number => {
            const src = d.source as SankeyNode;
            const tgt = d.target as SankeyNode;
            return ((src.x1 ?? 0) + (tgt.x0 ?? 0)) / 2;
        };
        const midY = (d: SankeyLink): number => ((d.y0 ?? 0) + (d.y1 ?? 0)) / 2;

        // Rendu DERRIÈRE les étiquettes de nœuds (groupe gLinkValues).
        this.gLinkValues
            .selectAll<SVGTextElement, SankeyLink>("text.link-value")
            .data(links.filter(l => (l.width ?? 0) >= fontSize * 0.9))
            .enter()
            .append("text")
            .classed("link-value", true)
            .attr("x", (d: SankeyLink) => midX(d))
            .attr("y", (d: SankeyLink) => midY(d))
            .attr("dy", "0.35em")
            .attr("text-anchor", "middle")
            // Texte penché suivant la pente du lien en son milieu.
            .attr("transform", (d: SankeyLink) => {
                const angle = linkMidAngle(d, curveType, curvature);
                return `rotate(${angle} ${midX(d)} ${midY(d)})`;
            })
            .attr("fill", s.fontColor.value.value)
            .style("font-family", s.fontFamily.value)
            .style("font-size", fontSize + "px")
            .style("font-weight", s.bold.value ? "bold" : "normal")
            .style("font-style", s.italic.value ? "italic" : "normal")
            .style("pointer-events", "none")
            .text((d: SankeyLink) => {
                const unit = (d.unit || fallbackUnit).trim();
                const v = formatNumber(d.value);
                return unit ? `${v} ${unit}` : v;
            });
    }

    private renderHeaders(
        headers: ColumnHeader[],
        left: number,
        kx: number,
        nodeWidth: number,
        fontSize: number,
        width: number,
        marginTop: number
    ): void {
        const s = this.settings.columnHeaders;
        const padX = 8;
        const padY = 4;
        const barHeight = fontSize + padY * 2;
        const barY = marginTop;
        const fontFamily = s.fontFamily.value;
        const fontWeight = s.bold.value ? "bold" : "normal";
        const fontStyle = s.italic.value ? "italic" : "normal";

        headers.forEach(h => {
            const nodeCenterX = left + h.col * kx + nodeWidth / 2;
            const g = this.gHeaders.append("g");

            const textWidth = estimateTextWidth(h.title, fontSize, s.bold.value);
            const rectWidth = textWidth + padX * 2;

            // Maintient le bandeau dans les limites du visuel (colonnes de bord)
            const rectX = clamp(nodeCenterX - rectWidth / 2, 0, Math.max(0, width - rectWidth));
            const centerX = rectX + rectWidth / 2;

            g.append("rect")
                .classed("column-header-bg", true)
                .attr("x", rectX)
                .attr("y", barY)
                .attr("width", rectWidth)
                .attr("height", barHeight)
                .attr("rx", 2)
                .attr("fill", s.backgroundColor.value.value);

            g.append("text")
                .attr("x", centerX)
                .attr("y", barY + barHeight / 2)
                .attr("dy", "0.35em")
                .attr("text-anchor", "middle")
                .attr("fill", s.fontColor.value.value)
                .style("font-family", fontFamily)
                .style("font-size", fontSize + "px")
                .style("font-weight", fontWeight)
                .style("font-style", fontStyle)
                .text(h.title);
        });
    }

    private buildTooltip(d: SankeyLink): VisualTooltipDataItem[] {
        const source = typeof d.source === "string" ? d.source : d.source.name;
        const target = typeof d.target === "string" ? d.target : d.target.name;

        const items: VisualTooltipDataItem[] = [
            { displayName: "Flux", value: `${source} → ${target}` },
            { displayName: "Valeur", value: formatNumber(d.value) }
        ];

        d.tooltipItems.forEach(t => {
            if (t.value) {
                items.push({ displayName: t.label, value: t.value });
            }
        });

        return items;
    }

    /* Volet de mise en forme (propriétés) */
    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.settings);
    }
}

/* ----------------------------------------------------------------------- */
/* Utilitaires                                                              */
/* ----------------------------------------------------------------------- */

function clamp(v: number, min: number, max: number): number {
    if (v === null || v === undefined || isNaN(v)) {
        return min;
    }
    return Math.max(min, Math.min(max, v));
}

/**
 * Construit le tracé rempli d'un lien (ruban) selon le type de courbe.
 */
function ribbonPath(link: SankeyLink, curveType: string, curvature: number): string {
    const source = link.source as SankeyNode;
    const target = link.target as SankeyNode;

    const sx = source.x1 ?? 0;
    const tx = target.x0 ?? 0;
    const sy = link.y0 ?? 0;
    const ty = link.y1 ?? 0;
    const w = Math.max(0, link.width ?? 0);
    const hw = w / 2;

    const sTop = sy - hw;
    const sBot = sy + hw;
    const tTop = ty - hw;
    const tBot = ty + hw;

    if (curveType === "droite") {
        return (
            `M${sx},${sTop} L${tx},${tTop} ` +
            `L${tx},${tBot} L${sx},${sBot} Z`
        );
    }

    if (curveType === "marches") {
        const xm = (sx + tx) / 2;
        return (
            `M${sx},${sTop} L${xm},${sTop} L${xm},${tTop} L${tx},${tTop} ` +
            `L${tx},${tBot} L${xm},${tBot} L${xm},${sBot} L${sx},${sBot} Z`
        );
    }

    // "courbe" (par défaut) : bézier cubique horizontal.
    // curvature 0 -> quasi droite ; 1 -> courbe très marquée.
    const c = 0.15 + curvature * 0.35; // fraction de la distance horizontale
    const cx1 = sx + (tx - sx) * c;
    const cx2 = tx - (tx - sx) * c;

    return (
        `M${sx},${sTop} ` +
        `C${cx1},${sTop} ${cx2},${tTop} ${tx},${tTop} ` +
        `L${tx},${tBot} ` +
        `C${cx2},${tBot} ${cx1},${sBot} ${sx},${sBot} Z`
    );
}

/**
 * Angle (en degrés) de la pente d'un lien en son milieu, pour incliner
 * l'étiquette de valeur afin qu'elle suive la courbe.
 */
function linkMidAngle(link: SankeyLink, curveType: string, curvature: number): number {
    const source = link.source as SankeyNode;
    const target = link.target as SankeyNode;
    const sx = source.x1 ?? 0;
    const tx = target.x0 ?? 0;
    const sy = link.y0 ?? 0;
    const ty = link.y1 ?? 0;

    // Les "marches" sont horizontales au milieu -> pas d'inclinaison.
    if (curveType === "marches") {
        return 0;
    }

    let dx: number;
    if (curveType === "droite") {
        dx = tx - sx;
    } else {
        // Tangente au milieu (t=0.5) de la bézier cubique du centre du ruban.
        const c = 0.15 + curvature * 0.35;
        dx = (tx - sx) * (1 - c);
    }
    const dy = ty - sy;
    return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function formatNumber(v: number): string {
    if (!isFinite(v)) {
        return "";
    }
    const abs = Math.abs(v);
    if (abs >= 1e9) return (v / 1e9).toFixed(2) + " Md";
    if (abs >= 1e6) return (v / 1e6).toFixed(2) + " M";
    if (abs >= 1e3) return (v / 1e3).toFixed(1) + " k";
    return v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

/** Estimation approximative de la largeur d'un texte (sans mesure DOM). */
function estimateTextWidth(text: string, fontSize: number, bold: boolean): number {
    const factor = bold ? 0.62 : 0.55;
    return text.length * fontSize * factor;
}

/**
 * Clé d'ordre d'un nœud : plus petit "ordre" parmi ses liens sortants,
 * sinon parmi ses liens entrants. Utilisé pour trier les nœuds dans une colonne.
 */
function nodeOrderKey(node: SankeyNode): number {
    const out = node.sourceLinks;
    if (out && out.length) {
        return Math.min(...out.map(l => l.order));
    }
    const inc = node.targetLinks;
    if (inc && inc.length) {
        return Math.min(...inc.map(l => l.order));
    }
    return Number.POSITIVE_INFINITY;
}

/** Couleur du premier lien sortant d'un nœud (sinon repli). */
function nodeFirstLinkColor(node: SankeyNode, fallback: string): string {
    const out = node.sourceLinks;
    if (out && out.length && out[0].color) {
        return out[0].color as string;
    }
    const inc = node.targetLinks;
    if (inc && inc.length && inc[0].color) {
        return inc[0].color as string;
    }
    return fallback;
}

/**
 * Découpe un texte en lignes dont chacune ne dépasse pas maxChars caractères,
 * en respectant les mots. Un mot plus long que maxChars est coupé de force.
 */
function wrapText(text: string, maxChars: number): string[] {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const lines: string[] = [];
    let current = "";

    const pushWord = (w: string) => {
        if (current === "") {
            current = w;
        } else if ((current + " " + w).length <= maxChars) {
            current += " " + w;
        } else {
            lines.push(current);
            current = w;
        }
    };

    words.forEach(w => {
        // Coupe un mot trop long en tranches de maxChars
        while (w.length > maxChars) {
            if (current !== "") {
                lines.push(current);
                current = "";
            }
            lines.push(w.slice(0, maxChars));
            w = w.slice(maxChars);
        }
        pushWord(w);
    });

    if (current !== "") {
        lines.push(current);
    }
    return lines.length ? lines : [text];
}
