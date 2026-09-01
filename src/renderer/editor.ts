// Éditeur graphique : création/déplacement de nœuds, tracé de liens,
// panneau de propriétés, et bascule Édition / Aperçu Sankey.

import {
    FlowModel, FlowNode, FlowLink, SankeyOptions, defaultOptions,
    NodeKind, NodeTypeStyle, NodeLabelPosition, NODE_KINDS, NODE_LABEL_POSITIONS,
    kindOf, defaultTypeStyle
} from "./types";
import {
    renderSankey, renderSankeyGroups, wrapText, policeDuType, positionDuType
} from "./engine";
import { openColorPopover, normalizeHex } from "./ui";

const NODE_W = 132;
const NODE_H = 38; // hauteur d'un nœud dont le nom tient sur une ligne
// Étiquette d'un nœud : le nom passe à la ligne et la boîte grandit avec lui.
const LABEL_MAX_CHARS = 18;
const LABEL_LINE_H = 15;
const LABEL_PAD_V = 8; // marge au-dessus et au-dessous du bloc de texte
const LABEL_MAX_LINES = 4;
const DOT_R = 6; // rayon des points de liaison
const DOT_GAP = 15; // écart entre le bord du nœud et son point de liaison
const PLUS_R = 11;
const SVGNS = "http://www.w3.org/2000/svg";

// Grille d'édition : colonnes d'affichage (X) × ordre vertical (Y).
const COL_W = 210; // écart horizontal entre colonnes
const ROW_H = 60; // pas vertical d'un nœud de hauteur standard
const GAP_Y = ROW_H - NODE_H; // espace libre entre deux nœuds empilés
const GRID_X = 40; // marge gauche
const GRID_Y = 74; // marge haute (place pour les entêtes de colonnes)
const LANE_GAP = 22; // espace vertical entre deux couloirs
const LANE_LABEL_H = 26; // place prise par le nom d'un couloir, au-dessus de sa bande

function gridX(column: number): number {
    return GRID_X + (column - 1) * COL_W;
}
/**
 * Lignes du nom d'un nœud. Le nom passe à la ligne comme dans l'aperçu
 * (même `wrapText`), et l'on borne à quelques lignes pour éviter les boîtes
 * démesurées : la dernière est alors abrégée.
 */
const lignesCache = new Map<string, string[]>();
function nodeLines(n: FlowNode): string[] {
    const cle = n.id + "\u0000" + n.name;
    const vu = lignesCache.get(cle);
    if (vu) return vu;
    let lignes = wrapText(n.name || "", LABEL_MAX_CHARS);
    if (lignes.length > LABEL_MAX_LINES) {
        lignes = lignes.slice(0, LABEL_MAX_LINES);
        lignes[LABEL_MAX_LINES - 1] = truncate(lignes[LABEL_MAX_LINES - 1], LABEL_MAX_CHARS);
    }
    if (lignesCache.size > 500) lignesCache.clear();
    lignesCache.set(cle, lignes);
    return lignes;
}

/** Hauteur d'un nœud : elle suit le nombre de lignes de son nom. */
function nodeH(n: FlowNode): number {
    return Math.max(NODE_H, 2 * LABEL_PAD_V + nodeLines(n).length * LABEL_LINE_H);
}

/** Couloir d'un nœud, ramené à un entier >= 1 (1 par défaut). */
function laneOf(n: FlowNode): number {
    const v = Math.round(n.lane);
    return isFinite(v) && v >= 1 ? v : 1;
}

/** Couloirs occupés par les nœuds visibles, du haut vers le bas. Jamais vide. */
function couloirs(): number[] {
    const set = new Set<number>();
    viewNodes().forEach(n => set.add(laneOf(n)));
    if (!set.size) set.add(1);
    return Array.from(set).sort((a, b) => a - b);
}

/** Bande verticale occupée par chaque couloir, renseignée par layoutGrid(). */
const laneBounds: Map<number, { haut: number; bas: number }> = new Map();

/**
 * Couloir visé par une ordonnée. Au-delà de la dernière bande, on renvoie le
 * couloir suivant : déposer un nœud sous les bandes en crée un, comme déposer
 * à droite de la dernière colonne en crée une.
 *
 * `bandes` permet de viser les bandes TELLES QU'ELLES ÉTAIENT au début d'un
 * glisser : pendant le déplacement, retirer un nœud d'un couloir peut faire
 * remonter les suivants, et la bande se déroberait sous le curseur.
 */
type Bandes = Map<number, { haut: number; bas: number }>;
function laneAtY(y: number, bandes?: Bandes): number {
    const src = bandes && bandes.size ? bandes : laneBounds;
    const lanes = Array.from(src.keys()).sort((a, b) => a - b);
    if (!lanes.length) return 1;
    for (const l of lanes) {
        const b = src.get(l)!;
        if (y <= b.bas + LANE_GAP / 2) return l;
    }
    return lanes[lanes.length - 1] + 1;
}

/** Nœuds visibles d'une cellule (colonne × couloir), dans l'ordre d'empilement. */
function colonneTriee(column: number, lane: number, sauf?: FlowNode): FlowNode[] {
    return viewNodes()
        .filter(n => n.column === column && laneOf(n) === lane && n !== sauf)
        .sort((a, b) => a.order - b.order);
}

/**
 * Rang d'insertion correspondant à une ordonnée, en tenant compte des hauteurs
 * réelles : les rangées ne sont plus régulières dès qu'un nom passe à la ligne.
 */
function rankAtY(column: number, lane: number, y: number, sauf?: FlowNode): number {
    let haut = laneBounds.get(lane)?.haut ?? GRID_Y;
    let rang = 0;
    for (const n of colonneTriee(column, lane, sauf)) {
        if (y < haut + nodeH(n) / 2) return rang;
        haut += nodeH(n) + GAP_Y;
        rang++;
    }
    return rang;
}
function bandLeft(column: number): number {
    return gridX(column) - (COL_W - NODE_W) / 2;
}

/**
 * Place chaque nœud sur la grille : x = colonne, y = rang dans sa cellule.
 *
 * La grille a trois coordonnées : la colonne (x), le couloir (bande horizontale)
 * et le rang dans la cellule. Chaque couloir occupe une bande dont la hauteur est
 * celle de sa colonne la plus chargée, et les bandes s'empilent. Sans couloir
 * déclaré, il n'y en a qu'un : la mise en page est celle d'avant.
 */
function layoutGrid(): void {
    laneBounds.clear();
    const lanes = couloirs();
    const avecCouloirs = lanes.length > 1;
    let y = GRID_Y;
    for (const lane of lanes) {
        if (avecCouloirs) y += LANE_LABEL_H; // place pour le nom du couloir
        const byCol = new Map<number, FlowNode[]>();
        viewNodes().filter(n => laneOf(n) === lane).forEach(n => {
            if (!byCol.has(n.column)) byCol.set(n.column, []);
            byCol.get(n.column)!.push(n);
        });
        let hauteur = NODE_H;
        byCol.forEach(list => {
            list.sort((a, b) => a.order - b.order);
            // Empilement cumulatif : chaque nœud pousse le suivant de sa propre hauteur.
            let yy = y;
            list.forEach(n => {
                n.x = gridX(n.column);
                n.y = yy;
                yy += nodeH(n) + GAP_Y;
            });
            hauteur = Math.max(hauteur, yy - GAP_Y - y);
        });
        laneBounds.set(lane, { haut: y, bas: y + hauteur });
        y += hauteur + LANE_GAP;
    }
}

/** Nom affiché d'un couloir. */
function laneTitle(lane: number): string {
    return (options.lanes.titles && options.lanes.titles[String(lane)]) || "";
}
function setLaneTitle(lane: number, titre: string): void {
    if (!options.lanes.titles) options.lanes.titles = {};
    if (titre) options.lanes.titles[String(lane)] = titre;
    else delete options.lanes.titles[String(lane)];
}

/**
 * Déplace un nœud vers la cellule (colonne, couloir, rang) et renumérote les
 * ordres. L'ordre vertical est propre à une cellule : deux nœuds de couloirs
 * différents peuvent porter le même ordre dans la même colonne.
 */
function moveNodeToCell(n: FlowNode, column: number, lane: number, rank: number): void {
    const oldCol = n.column;
    const oldLane = laneOf(n);
    lane = Math.max(1, Math.round(lane) || 1);
    // L'intitulé caractérise la COLONNE : en changeant de colonne, le nœud adopte
    // celui de sa nouvelle place, sinon l'entête ne correspond plus à ses nœuds.
    if (oldCol !== column) n.title = columnTitle(column, n);
    // On ne réordonne que parmi les nœuds VISIBLES de la cellule cible.
    const others = colonneTriee(column, lane, n);
    const r = Math.max(0, Math.min(rank, others.length));
    others.splice(r, 0, n);
    n.column = column;
    n.lane = lane;
    others.forEach((x, i) => (x.order = i));
    if (oldCol !== column || oldLane !== lane) {
        colonneTriee(oldCol, oldLane).forEach((x, i) => (x.order = i));
    }
}

type View = "edit" | "preview";

interface Selection {
    type: "node" | "link" | null;
    id: string;
}

let model: FlowModel = { nodes: [], links: [] };
let options: SankeyOptions = defaultOptions();
let view: View = "edit";
let selection: Selection = { type: null, id: "" };
/** Nom du classeur qui héberge le complément — affiché, jamais ouvert. */
let excelPath: string | null = null;
let idCounter = 1;
let undoStack: string[] = [];
let redoStack: string[] = [];
let syncedNodeIds = new Set<string>();
let syncedLinkIds = new Set<string>();
let dirtySinceSync = false; // modifications app non encore poussées vers Excel
let pushEnCours = false; // évite qu'une écriture Excel se relance sur elle-même
// Le classeur a-t-il été lu ? Tant que non, rien ne part vers Excel : envoyer
// un modèle vide écraserait les tableaux de l'utilisatrice.
let amorceFaite = false;

let hiddenFilieres = new Set<string>(); // filières masquées du schéma

interface ExcelNode {
    id: string | null; name: string; column: number; title: string;
    order: number; lane: number; kind: NodeKind; filiere: string; color: string | null;
}
interface ExcelLink {
    sourceId: string | null; targetId: string | null;
    sourceName: string; targetName: string;
    value: number; unit: string;
}
interface ExcelData {
    nodes: ExcelNode[];
    links: ExcelLink[];
    /** Le classeur porte-t-il la colonne « Couloir » ? Sinon on garde les nôtres. */
    hasLane?: boolean;
    /** Idem pour la colonne « Type » : sans elle, on garde les types de l'app. */
    hasKind?: boolean;
}

let canvas: SVGSVGElement;
let sidebar: HTMLElement;
let toolbar: HTMLElement;
let statusEl: HTMLElement;

/* ------------------------------------------------------------------ */

export function createApp(root: HTMLElement): void {
    toolbar = root.querySelector("#toolbar") as HTMLElement;
    canvas = root.querySelector("#canvas") as unknown as SVGSVGElement;
    sidebar = root.querySelector("#sidebar") as HTMLElement;
    statusEl = root.querySelector("#status") as HTMLElement;

    buildToolbar();
    // Le modèle vient du classeur (amorcerDepuisClasseur), et de lui seul. Ni
    // cache local ni exemple — les envoyer dans le classeur de l'utilisatrice
    // détruirait ses tableaux.
    excelPath = (desktop() && desktop().nomClasseur) || "Classeur Excel";

    canvas.addEventListener("dblclick", onCanvasDblClick);
    window.addEventListener("keydown", onGlobalKey);
    window.addEventListener("resize", render);

    wireExcelWatchers();

    // Crochet de test (bancs de tests/, hors Excel)
    (window as any).__sankeyTest = {
        caps: () => caps(),
        reconcile: (data: ExcelData) => reconcileFromExcel(data),
        setSynced: () => markAllSynced(),
        model: () => model,
        refresh: () => { render(); buildSidebar(); },
        setDirty: (v: boolean) => { dirtySinceSync = v; },
        /** Déclare le classeur lu : sans ça rien ne part vers Excel (garde-fou). */
        amorce: (v: boolean) => { amorceFaite = v; },
        wireWatchers: () => wireExcelWatchers(),
        setExcelPath: (v: string | null) => { excelPath = v; buildSidebar(); },
        nodeCount: () => model.nodes.length,
        // --- crochets utilisés par tests/run.js ---
        loadProject: (p: ProjectFile) => {
            applyProject(p);
            render();
            buildSidebar();
        },
        links: () => model.links,
        selection: () => selection,
        view: () => view,
        hidden: () => Array.from(hiddenFilieres)
    };

    dirtySinceSync = false; // le chargement initial n'est pas une « modification »
    render();
    buildSidebar();
    amorcerDepuisClasseur();
}

/* --------------------------- barre d'outils ------------------------ */

function buildToolbar(): void {
    toolbar.innerHTML = "";
    toolbar.appendChild(btn("＋ Nœud", () => addNode()));

    toolbar.appendChild(sep());

    toolbar.appendChild(viewToggle());

    toolbar.appendChild(sep());
    // Ni « Enregistrer sous… » ni « Ouvrir » : il n'y a pas de fichier projet.
    // Le diagramme vit dans les tableaux, l'apparence dans le classeur.
    const saveBtn = btn("Enregistrer", () => saveProject());
    saveBtn.title = "Ranger l'apparence dans le classeur (Cmd+S) — le diagramme, lui, "
        + "vit déjà dans les tableaux";
    toolbar.appendChild(saveBtn);

    toolbar.appendChild(sep());
    const pngBtn = btn("⇩ PNG", () => exportImage("png"));
    pngBtn.title = "Exporter le Sankey en image PNG";
    toolbar.appendChild(pngBtn);
    const svgBtn = btn("⇩ SVG", () => exportImage("svg"));
    svgBtn.title = "Exporter le Sankey en SVG vectoriel";
    toolbar.appendChild(svgBtn);

    updateToolbarState();
}

/** Édition / Aperçu réunis en une bascule à deux segments. */
function viewToggle(): HTMLElement {
    const group = document.createElement("div");
    group.className = "segmented";
    group.setAttribute("role", "group");
    const seg = (label: string, role: View) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "seg";
        b.textContent = label;
        b.dataset.role = role;
        b.addEventListener("click", () => setView(role));
        group.appendChild(b);
    };
    seg("Édition", "edit");
    seg("Aperçu", "preview");
    return group;
}

function updateToolbarState(): void {
    toolbar.querySelectorAll("button[data-role]").forEach(b => {
        b.classList.toggle("active", (b as HTMLElement).dataset.role === view);
    });
}

function setView(v: View): void {
    view = v;
    updateToolbarState();
    render();
}

/* ----------------------------- modèle ------------------------------ */

function idExists(id: string): boolean {
    return model.nodes.some(n => n.id === id) || model.links.some(l => l.id === id);
}

/**
 * Identifiant neuf, garanti libre.
 *
 * Le compteur enregistré dans un projet peut être en retard sur les
 * identifiants réellement présents (réconciliation depuis Excel, fusion de
 * fichiers…). Réattribuer un identifiant existant corrompt tout : `nodeById`
 * renvoie alors le mauvais nœud et les liens se raccrochent ailleurs.
 */
function newId(prefix: string): string {
    let id = `${prefix}${idCounter++}`;
    while (idExists(id)) id = `${prefix}${idCounter++}`;
    return id;
}

/** Filière par défaut d'un nouveau nœud (celle du nœud sélectionné). */
function currentFiliereForNew(): string {
    if (selection.type === "node") {
        const n = nodeById(selection.id);
        if (n) return n.filiere || "";
    }
    return "";
}

function addNode(column?: number, rank?: number, lane?: number): void {
    snapshot();
    // Colonne : donnée (double-clic) sinon colonne du nœud de référence + 1
    if (column === undefined) {
        const ref =
            selection.type === "node"
                ? nodeById(selection.id)
                : model.nodes[model.nodes.length - 1];
        column = ref ? ref.column + 1 : 1;
    }
    const ref = selection.type === "node" ? nodeById(selection.id) : undefined;
    const n: FlowNode = {
        id: newId("n"),
        name: "Nouveau nœud",
        column,
        title: "",
        order: 0,
        lane: lane ?? ref?.lane ?? 1,
        // Le nœud créé reprend le type du nœud sélectionné, comme sa filière :
        // on enchaîne le plus souvent des nœuds de même nature.
        kind: ref ? kindOf(ref) : "produit",
        filiere: currentFiliereForNew(),
        color: null,
        x: 0,
        y: 0
    };
    model.nodes.push(n);
    moveNodeToCell(n, column, n.lane, rank ?? Number.MAX_SAFE_INTEGER);
    select("node", n.id);
    render();
    buildSidebar();
    persist();
}

function addLink(sourceId: string, targetId: string): void {
    if (sourceId === targetId) return;
    const exists = model.links.some(l => l.source === sourceId && l.target === targetId);
    if (exists) return;
    snapshot();
    const l: FlowLink = {
        id: newId("l"),
        source: sourceId,
        target: targetId,
        value: 1,
        unit: ""
    };
    model.links.push(l);
    select("link", l.id);
    render();
    buildSidebar();
    persist();
}

function deleteSelected(): void {
    if (!selection.type) return;
    snapshot();
    if (selection.type === "node") {
        model.nodes = model.nodes.filter(n => n.id !== selection.id);
        model.links = model.links.filter(
            l => l.source !== selection.id && l.target !== selection.id
        );
    } else if (selection.type === "link") {
        model.links = model.links.filter(l => l.id !== selection.id);
    }
    selection = { type: null, id: "" };
    render();
    buildSidebar();
    persist();
}

function select(type: "node" | "link" | null, id: string): void {
    selection = { type, id };
    buildSidebar();
    if (view === "edit") render();
}

/* ----------------------------- rendu ------------------------------- */

function render(): void {
    const wrap = canvas.parentElement as HTMLElement;
    const visW = Math.max(1, wrap.clientWidth);
    const visH = Math.max(1, wrap.clientHeight);
    while (canvas.firstChild) canvas.removeChild(canvas.firstChild);

    if (view === "preview") {
        wrap.style.overflow = "hidden";
        sizeCanvas(visW, visH);
        dessinerApercu(canvas, visW, visH);
        return;
    }

    // Mode édition : positions aimantées sur la grille (colonnes × ordre).
    wrap.style.overflow = "auto";
    layoutGrid();
    let maxX = visW, maxY = visH;
    viewNodes().forEach(n => {
        maxX = Math.max(maxX, n.x + NODE_W + 140); // marge pour le bouton +
        maxY = Math.max(maxY, n.y + nodeH(n) + 80);
    });
    sizeCanvas(maxX, maxY);
    renderEditor();
}

function sizeCanvas(w: number, h: number): void {
    canvas.setAttribute("width", String(w));
    canvas.setAttribute("height", String(h));
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
}

function nodeById(id: string): FlowNode | undefined {
    return model.nodes.find(n => n.id === id);
}

/* ---- Filtre par filière : sous-ensemble affiché du modèle ---- */
function isVisibleNode(n: FlowNode): boolean {
    return !hiddenFilieres.has(n.filiere || "");
}
function viewNodes(): FlowNode[] {
    return model.nodes.filter(isVisibleNode);
}
function viewLinks(): FlowLink[] {
    const vis = new Set(viewNodes().map(n => n.id));
    return model.links.filter(l => vis.has(l.source) && vis.has(l.target));
}
function viewModel(): FlowModel {
    return { nodes: viewNodes(), links: viewLinks() };
}

/**
 * Un sous-diagramme par filière visible, dans l'ordre d'apparition des nœuds.
 * Les liens qui traversent deux filières n'appartiennent à aucun bloc : ils
 * disparaissent de l'aperçu séparé, par construction.
 */
function groupesParFiliere(): { nom: string; model: FlowModel }[] {
    const visibles = viewNodes();
    const ordre: string[] = [];
    visibles.forEach(n => {
        const f = n.filiere || "";
        if (!ordre.includes(f)) ordre.push(f);
    });
    return ordre.map(f => {
        const ns = visibles.filter(n => (n.filiere || "") === f);
        const ids = new Set(ns.map(n => n.id));
        return {
            nom: f,
            model: {
                nodes: ns,
                links: model.links.filter(l => ids.has(l.source) && ids.has(l.target))
            }
        };
    });
}

/** Aperçu : un seul Sankey, ou un par filière si l'option est active. */
function dessinerApercu(svgEl: SVGSVGElement, w: number, h: number, fond = "#ffffff"): void {
    const groupes = groupesParFiliere();
    if (options.filieres.split && groupes.length > 1) {
        renderSankeyGroups(svgEl, groupes, options, w, h, fond);
    } else {
        renderSankey(svgEl, viewModel(), options, w, h, fond);
    }
}
function distinctFilieres(): string[] {
    const set = new Set<string>();
    model.nodes.forEach(n => set.add(n.filiere || ""));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/* Registres des éléments SVG du mode édition (utilisés par l'animation du drag). */
let nodeEls = new Map<string, SVGGElement>();
let linkEls: { link: FlowLink; line: SVGPathElement; hit: SVGPathElement }[] = [];

function linkPathD(x1: number, y1: number, x2: number, y2: number): string {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

function renderEditor(): void {
    canvas.setAttribute("class", "mode-move");
    nodeEls = new Map();
    linkEls = [];

    // Grille : bandes de colonnes + libellés (derrière tout le reste)
    const maxCol = Math.max(1, ...viewNodes().map(n => n.column));
    const canvasH = parseFloat(canvas.getAttribute("height") || "0");
    const gGrid = document.createElementNS(SVGNS, "g");
    canvas.appendChild(gGrid);
    for (let c = 1; c <= maxCol + 1; c++) {
        if (c % 2 === 0) {
            const band = document.createElementNS(SVGNS, "rect");
            band.setAttribute("class", "grid-band");
            band.setAttribute("x", String(bandLeft(c)));
            band.setAttribute("y", "0");
            band.setAttribute("width", String(COL_W));
            band.setAttribute("height", String(canvasH));
            gGrid.appendChild(band);
        }
        const title = columnTitle(c);
        const label = document.createElementNS(SVGNS, "text");
        label.setAttribute("class", "grid-col-label" + (title ? "" : " placeholder"));
        label.setAttribute("x", String(gridX(c) + NODE_W / 2));
        label.setAttribute("y", "30");
        label.setAttribute("text-anchor", "middle");
        label.textContent = title || "Colonne " + c;
        label.appendChild(svgTitle("Double-clic pour renommer la colonne"));
        const col = c;
        label.addEventListener("dblclick", e => {
            e.stopPropagation(); // sinon le double-clic du canevas crée un nœud
            editColumnTitle(col);
        });
        gGrid.appendChild(label);
    }

    // Couloirs : trait de séparation + nom, seulement s'il y en a plusieurs
    // (sans quoi la vue est exactement celle d'avant).
    const lanes = couloirs();
    if (lanes.length > 1) {
        const canvasW = parseFloat(canvas.getAttribute("width") || "0");
        lanes.forEach(lane => {
            const b = laneBounds.get(lane);
            if (!b) return;
            const ligne = document.createElementNS(SVGNS, "line");
            ligne.setAttribute("class", "grid-lane-line");
            ligne.setAttribute("x1", "0");
            ligne.setAttribute("x2", String(canvasW));
            ligne.setAttribute("y1", String(b.haut - LANE_LABEL_H + 2));
            ligne.setAttribute("y2", String(b.haut - LANE_LABEL_H + 2));
            gGrid.appendChild(ligne);

            const titre = laneTitle(lane);
            const nom = document.createElementNS(SVGNS, "text");
            nom.setAttribute("class", "grid-lane-label" + (titre ? "" : " placeholder"));
            nom.setAttribute("x", "8");
            nom.setAttribute("y", String(b.haut - 7));
            nom.textContent = titre || "Couloir " + lane;
            nom.appendChild(svgTitle("Double-clic pour renommer le couloir"));
            nom.addEventListener("dblclick", e => {
                e.stopPropagation();
                editLaneTitle(lane);
            });
            gGrid.appendChild(nom);
        });
    }

    // Liens
    const gl = document.createElementNS(SVGNS, "g");
    canvas.appendChild(gl);
    viewLinks().forEach(l => {
        const s = nodeById(l.source);
        const t = nodeById(l.target);
        if (!s || !t) return;
        const d = linkPathD(s.x + NODE_W, s.y + nodeH(s) / 2, t.x, t.y + nodeH(t) / 2);

        const g = document.createElementNS(SVGNS, "g");
        g.setAttribute("class", "edit-link" + (selection.id === l.id ? " selected" : ""));

        const line = document.createElementNS(SVGNS, "path");
        line.setAttribute("class", "link-line");
        line.setAttribute("d", d);
        line.setAttribute("stroke", l.colorOverride || s.color || "#6b6b6b"); // couleur du nœud d'origine
        g.appendChild(line);

        const hit = document.createElementNS(SVGNS, "path");
        hit.setAttribute("class", "link-hit");
        hit.setAttribute("d", d);
        g.appendChild(hit);

        g.addEventListener("click", e => { e.stopPropagation(); select("link", l.id); });
        gl.appendChild(g);
        linkEls.push({ link: l, line, hit });
    });

    // Nœuds
    const gn = document.createElementNS(SVGNS, "g");
    canvas.appendChild(gn);
    viewNodes().forEach(n => {
        const g = document.createElementNS(SVGNS, "g");
        g.setAttribute("transform", `translate(${n.x},${n.y})`);
        g.dataset.id = n.id; // repère stable pour les tests et le débogage
        g.dataset.kind = kindOf(n);
        let cls = "edit-node";
        if (selection.type === "node" && selection.id === n.id) cls += " selected";
        g.setAttribute("class", cls);

        const rect = document.createElementNS(SVGNS, "rect");
        rect.setAttribute("class", "node-box");
        rect.setAttribute("width", String(NODE_W));
        rect.setAttribute("height", String(nodeH(n)));
        rect.setAttribute("rx", "0");
        g.appendChild(rect);

        // Pastille : couleur effective du nœud (celle utilisée dans l'aperçu)
        const dot = document.createElementNS(SVGNS, "circle");
        dot.setAttribute("class", "node-color-dot");
        dot.setAttribute("cx", String(NODE_W - 11));
        dot.setAttribute("cy", "11");
        dot.setAttribute("r", "5");
        dot.setAttribute("fill", n.color || options.nodes.nodeColor);
        g.appendChild(dot);

        const label = document.createElementNS(SVGNS, "text");
        label.setAttribute("class", "node-label");
        label.setAttribute("x", String(NODE_W / 2));
        label.setAttribute("text-anchor", "middle");
        /* La vue d'édition reprend la GRAISSE et l'ITALIQUE du type, pas sa
           taille : les boîtes sont ici de gabarit fixe (nodeH, wrapText à 18
           caractères) et une autre taille ferait déborder le texte. */
        const policeType = policeDuType(options, kindOf(n));
        label.style.fontWeight = String(policeType.weight);
        label.style.fontStyle = policeType.italic ? "italic" : "normal";
        // Une ligne par tspan, bloc centré verticalement dans la boîte.
        const lignes = nodeLines(n);
        const hautTexte = (nodeH(n) - lignes.length * LABEL_LINE_H) / 2;
        lignes.forEach((ligne, i) => {
            const ts = document.createElementNS(SVGNS, "tspan");
            ts.setAttribute("x", String(NODE_W / 2));
            ts.setAttribute("y", String(hautTexte + i * LABEL_LINE_H + 11));
            ts.textContent = ligne;
            label.appendChild(ts);
        });
        g.appendChild(label);

        g.addEventListener("mousedown", e => onNodeMouseDown(e, n));
        g.addEventListener("click", e => onNodeClick(e, n));
        g.addEventListener("dblclick", e => {
            e.stopPropagation();
            if (view === "edit") editNodeName(n);
        });
        gn.appendChild(g);
        nodeEls.set(n.id, g);
    });

    // Nœud sélectionné : points de liaison de part et d'autre + bouton « + ».
    if (selection.type === "node") {
        const n = nodeById(selection.id);
        if (n && !hiddenFilieres.has(n.filiere || "")) {
            gn.appendChild(linkDot(n, "in"));
            gn.appendChild(linkDot(n, "out"));
            gn.appendChild(plusHandle(n));
        }
    }

    // Si un tracé de lien est en cours lors d'un rafraîchissement, ré-attache son aperçu
    if (linkDrag && linkDrag.preview) {
        canvas.appendChild(linkDrag.preview);
        if (linkDrag.overId) nodeEls.get(linkDrag.overId)?.classList.add("drop-target");
    }
}

/**
 * Point de liaison sur un bord du nœud sélectionné.
 * « out » (bord droit) : le nœud est l'ORIGINE du lien à tracer.
 * « in »  (bord gauche) : le nœud en est la DESTINATION.
 */
function linkDot(n: FlowNode, dir: LinkDir): SVGGElement {
    const cx = dir === "out" ? n.x + NODE_W + DOT_GAP : n.x - DOT_GAP;
    const cy = n.y + nodeH(n) / 2;
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "link-dot");

    const hit = document.createElementNS(SVGNS, "circle");
    hit.setAttribute("cx", String(cx));
    hit.setAttribute("cy", String(cy));
    hit.setAttribute("r", "10");
    hit.setAttribute("fill", "transparent");
    g.appendChild(hit);

    const c = document.createElementNS(SVGNS, "circle");
    c.setAttribute("class", "link-dot-circle");
    c.setAttribute("cx", String(cx));
    c.setAttribute("cy", String(cy));
    c.setAttribute("r", String(DOT_R));
    g.appendChild(c);

    g.appendChild(svgTitle(
        dir === "out"
            ? "Tire vers un nœud pour partir d'ici"
            : "Tire vers un nœud pour arriver ici"
    ));

    g.addEventListener("mousedown", e => {
        e.stopPropagation(); // n'entraîne pas le déplacement du nœud
        e.preventDefault();
        startLinkDrag(n, dir, cx, cy);
    });
    g.addEventListener("click", e => e.stopPropagation());
    g.addEventListener("dblclick", e => e.stopPropagation());
    return g;
}

function plusHandle(src: FlowNode): SVGGElement {
    const cx = src.x + NODE_W + 42; // au-delà du point de liaison droit
    const cy = src.y + nodeH(src) / 2;
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "plus-handle");

    const circle = document.createElementNS(SVGNS, "circle");
    circle.setAttribute("class", "plus-circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", String(PLUS_R));
    g.appendChild(circle);

    // Le « + » dessiné avec deux traits -> parfaitement centré.
    const hLine = document.createElementNS(SVGNS, "line");
    hLine.setAttribute("class", "plus-sign");
    hLine.setAttribute("x1", String(cx - 5));
    hLine.setAttribute("y1", String(cy));
    hLine.setAttribute("x2", String(cx + 5));
    hLine.setAttribute("y2", String(cy));
    g.appendChild(hLine);

    const vLine = document.createElementNS(SVGNS, "line");
    vLine.setAttribute("class", "plus-sign");
    vLine.setAttribute("x1", String(cx));
    vLine.setAttribute("y1", String(cy - 5));
    vLine.setAttribute("x2", String(cx));
    vLine.setAttribute("y2", String(cy + 5));
    g.appendChild(vLine);

    const hit = document.createElementNS(SVGNS, "circle");
    hit.setAttribute("cx", String(cx));
    hit.setAttribute("cy", String(cy));
    hit.setAttribute("r", "16");
    hit.setAttribute("fill", "transparent");
    g.appendChild(hit);

    g.appendChild(svgTitle("Ajouter un nœud déjà relié à celui-ci"));
    g.addEventListener("click", e => { e.stopPropagation(); addLinkedNode(src); });
    g.addEventListener("mousedown", e => e.stopPropagation());
    g.addEventListener("dblclick", e => e.stopPropagation());
    return g;
}

/* --------------------------- interactions -------------------------- */

interface DragState {
    id: string;
    dx: number;
    dy: number;
    moved: boolean;
    freeX: number; // position libre (suit la souris, sans aimantation)
    freeY: number;
    lastCol: number;
    lastLane: number;
    lastRank: number;
    bandes: Bandes; // couloirs figés à l'instant du « mousedown »
    disp: Map<string, { x: number; y: number }>; // positions affichées (animées)
    raf: number;
}
let dragState: DragState | null = null;

/* ------------------- création d'un lien par glisser-déposer ------------- */

type LinkDir = "in" | "out";

interface LinkDragState {
    from: FlowNode;
    dir: LinkDir;
    originX: number;
    originY: number;
    overId: string | null;
    preview: SVGPathElement | null;
}
let linkDrag: LinkDragState | null = null;

function startLinkDrag(from: FlowNode, dir: LinkDir, originX: number, originY: number): void {
    if (view !== "edit") return;
    const preview = document.createElementNS(SVGNS, "path");
    preview.setAttribute("class", "link-preview");
    canvas.appendChild(preview);
    linkDrag = { from, dir, originX, originY, overId: null, preview };
    canvas.classList.add("linking");
    updateLinkPreview(originX, originY);
    setStatus(
        dir === "out"
            ? `Relâche sur le nœud de destination du lien partant de « ${from.name} ».`
            : `Relâche sur le nœud d'origine du lien arrivant sur « ${from.name} ».`
    );
    window.addEventListener("mousemove", onLinkDragMove);
    window.addEventListener("mouseup", onLinkDragEnd);
}

/** Nœud visible sous un point du canevas (les nœuds sont des rectangles fixes). */
function nodeAtPoint(x: number, y: number): FlowNode | null {
    return (
        viewNodes().find(
            n => x >= n.x && x <= n.x + NODE_W && y >= n.y && y <= n.y + nodeH(n)
        ) || null
    );
}

/** Le lien envisagé est-il traçable (pas de boucle, pas de doublon) ? */
function linkDragTarget(over: FlowNode | null): FlowNode | null {
    if (!linkDrag || !over || over.id === linkDrag.from.id) return null;
    const src = linkDrag.dir === "out" ? linkDrag.from.id : over.id;
    const dst = linkDrag.dir === "out" ? over.id : linkDrag.from.id;
    if (model.links.some(l => l.source === src && l.target === dst)) return null;
    return over;
}

function onLinkDragMove(e: MouseEvent): void {
    if (!linkDrag) return;
    const pt = toCanvas(e);
    const over = linkDragTarget(nodeAtPoint(pt.x, pt.y));

    if ((over ? over.id : null) !== linkDrag.overId) {
        if (linkDrag.overId) nodeEls.get(linkDrag.overId)?.classList.remove("drop-target");
        linkDrag.overId = over ? over.id : null;
        if (over) nodeEls.get(over.id)?.classList.add("drop-target");
    }
    // Aimante l'extrémité sur le bord du nœud survolé.
    if (over) {
        updateLinkPreview(
            linkDrag.dir === "out" ? over.x : over.x + NODE_W,
            over.y + nodeH(over) / 2
        );
    } else {
        updateLinkPreview(pt.x, pt.y);
    }
}

function updateLinkPreview(x: number, y: number): void {
    if (!linkDrag || !linkDrag.preview) return;
    // Le tracé va toujours de l'origine vers la destination : la courbe garde
    // le sens de lecture du diagramme, quel que soit le point tiré.
    const d =
        linkDrag.dir === "out"
            ? linkPathD(linkDrag.originX, linkDrag.originY, x, y)
            : linkPathD(x, y, linkDrag.originX, linkDrag.originY);
    linkDrag.preview.setAttribute("d", d);
}

function onLinkDragEnd(): void {
    if (!linkDrag) return;
    const { from, dir, overId } = linkDrag;
    endLinkDrag();
    if (!overId) {
        setStatus("Liaison annulée.");
        return;
    }
    if (dir === "out") addLink(from.id, overId);
    else addLink(overId, from.id);
}

function endLinkDrag(): void {
    if (!linkDrag) return;
    if (linkDrag.overId) nodeEls.get(linkDrag.overId)?.classList.remove("drop-target");
    linkDrag.preview?.remove();
    linkDrag = null;
    canvas.classList.remove("linking");
    window.removeEventListener("mousemove", onLinkDragMove);
    window.removeEventListener("mouseup", onLinkDragEnd);
}

/* ----------------------- déplacement d'un nœud ------------------------- */

function onNodeMouseDown(e: MouseEvent, n: FlowNode): void {
    if (view !== "edit") return;
    e.preventDefault();
    // Sélection dès l'enfoncement : si un champ du panneau a le focus, sa
    // validation reconstruit le canevas entre le mousedown et le mouseup, et le
    // clic n'atteindrait jamais le nœud (il fallait cliquer deux fois).
    if (!(selection.type === "node" && selection.id === n.id)) select("node", n.id);
    const pt = toCanvas(e);
    dragState = {
        id: n.id,
        dx: pt.x - n.x,
        dy: pt.y - n.y,
        moved: false,
        freeX: n.x,
        freeY: n.y,
        lastCol: n.column,
        lastLane: laneOf(n),
        lastRank: currentRank(n),
        bandes: new Map(),
        disp: new Map(),
        raf: 0
    };
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
}

function currentRank(n: FlowNode): number {
    return colonneTriee(n.column, laneOf(n)).indexOf(n);
}

function onDragMove(e: MouseEvent): void {
    if (!dragState) return;
    const ds = dragState;
    const n = nodeById(ds.id);
    if (!n) return;
    if (!ds.moved) {
        snapshot();
        ds.moved = true;
        // Positions affichées initiales = grille actuelle
        layoutGrid();
        ds.bandes = new Map(laneBounds);
        viewNodes().forEach(v => ds.disp.set(v.id, { x: v.x, y: v.y }));
        // Le nœud saisi passe au premier plan + style « en cours de déplacement »
        const g = nodeEls.get(n.id);
        if (g) {
            g.classList.add("dragging");
            g.parentElement?.appendChild(g);
        }
        canvas.classList.add("dragging-active");
        ds.raf = requestAnimationFrame(dragAnimStep);
    }
    // Le nœud saisi suit librement la souris…
    const pt = toCanvas(e);
    ds.freeX = pt.x - ds.dx;
    ds.freeY = pt.y - ds.dy;
    // …et sa cellule cible (colonne + rang) est déduite de la position.
    const column = Math.max(1, Math.round((ds.freeX - GRID_X) / COL_W) + 1);
    const lane = laneAtY(ds.freeY + nodeH(n) / 2, ds.bandes);
    const rank = rankAtY(column, lane, ds.freeY, n);
    if (column !== ds.lastCol || lane !== ds.lastLane || rank !== ds.lastRank) {
        moveNodeToCell(n, column, lane, rank);
        layoutGrid(); // met à jour les cibles ; l'animation fait glisser les autres nœuds
        ds.lastCol = column;
        ds.lastLane = lane;
        ds.lastRank = rank;
    }
    applyDragFrame(); // réponse immédiate à la souris (le RAF lisse entre deux événements)
}

/** Une étape d'animation : les nœuds glissent vers leur cible, les liens suivent. */
function applyDragFrame(): void {
    const ds = dragState;
    if (!ds || !ds.moved) return;
    viewNodes().forEach(v => {
        let p = ds.disp.get(v.id);
        if (!p) {
            p = { x: v.x, y: v.y };
            ds.disp.set(v.id, p);
        }
        if (v.id === ds.id) {
            p.x = ds.freeX; // le nœud saisi colle à la souris
            p.y = ds.freeY;
        } else {
            p.x += (v.x - p.x) * 0.25; // les autres glissent vers leur case
            p.y += (v.y - p.y) * 0.25;
        }
        const g = nodeEls.get(v.id);
        if (g) g.setAttribute("transform", `translate(${p.x},${p.y})`);
    });
    linkEls.forEach(({ link, line, hit }) => {
        const s = ds.disp.get(link.source);
        const t = ds.disp.get(link.target);
        // disp ne porte que des positions animées : les hauteurs viennent du modèle.
        const ns = nodeById(link.source);
        const nt = nodeById(link.target);
        if (!s || !t || !ns || !nt) return;
        const d = linkPathD(s.x + NODE_W, s.y + nodeH(ns) / 2, t.x, t.y + nodeH(nt) / 2);
        line.setAttribute("d", d);
        hit.setAttribute("d", d);
    });
}

function dragAnimStep(): void {
    if (!dragState) return;
    applyDragFrame();
    dragState.raf = requestAnimationFrame(dragAnimStep);
}

function onDragEnd(): void {
    if (dragState) {
        cancelAnimationFrame(dragState.raf);
        canvas.classList.remove("dragging-active");
        if (dragState.moved) persist();
    }
    const moved = dragState?.moved;
    dragState = null;
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
    if (moved) render(); // ré-aimante proprement tout le monde sur la grille
}

function onNodeClick(e: MouseEvent, n: FlowNode): void {
    e.stopPropagation();
    if (view !== "edit") return;
    if (dragState && dragState.moved) return;
    select("node", n.id);
}

function onCanvasDblClick(e: MouseEvent): void {
    if (view !== "edit") return;
    if ((e.target as Element).tagName !== "svg") return;
    const pt = toCanvas(e);
    const column = Math.max(1, Math.round((pt.x - GRID_X) / COL_W) + 1);
    const lane = laneAtY(pt.y);
    const rank = rankAtY(column, lane, pt.y);
    addNode(column, rank, lane);
}

function onGlobalKey(e: KeyboardEvent): void {
    // Laisse les champs de saisie gérer leurs propres touches (frappe, Cmd+Z texte…)
    if (isEditingText()) return;

    const meta = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (meta && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
    }
    if (meta && key === "y") {
        e.preventDefault();
        redo();
        return;
    }
    if (meta && key === "s") {
        e.preventDefault();
        saveProject();
        return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
        if (selection.type) {
            e.preventDefault();
            deleteSelected();
        }
        return;
    }
    if (e.key === "Escape") {
        if (linkDrag) {
            endLinkDrag();
            setStatus("Liaison annulée.");
        }
    }
}

function isEditingText(): boolean {
    const a = document.activeElement as HTMLElement | null;
    if (!a) return false;
    return (
        a.tagName === "INPUT" ||
        a.tagName === "TEXTAREA" ||
        a.tagName === "SELECT" ||
        a.isContentEditable
    );
}

/* ------------------------------ historique ------------------------- */

function snapshot(): void {
    dirtySinceSync = true; // une modification structurelle est en cours
    const s = JSON.stringify(model);
    if (undoStack[undoStack.length - 1] === s) return; // évite les doublons
    undoStack.push(s);
    if (undoStack.length > 200) undoStack.shift();
    redoStack = [];
}

function restore(json: string): void {
    model = JSON.parse(json);
    if (!selectionValid()) selection = { type: null, id: "" };
    render();
    buildSidebar();
    persist();
}

function undo(): void {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(model));
    restore(undoStack.pop() as string);
}

function redo(): void {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(model));
    restore(redoStack.pop() as string);
}

function selectionValid(): boolean {
    if (selection.type === "node") return model.nodes.some(n => n.id === selection.id);
    if (selection.type === "link") return model.links.some(l => l.id === selection.id);
    return false;
}

/* ---------------------- ajout de nœud lié (bouton +) --------------- */

function addLinkedNode(src: FlowNode): void {
    snapshot();
    const column = src.column + 1;
    const n: FlowNode = {
        id: newId("n"),
        name: "Nouveau nœud",
        column,
        title: "",
        order: 0,
        lane: src.lane,
        kind: kindOf(src),
        filiere: src.filiere || "",
        color: null,
        x: 0,
        y: 0
    };
    model.nodes.push(n);
    moveNodeToCell(n, column, n.lane, Number.MAX_SAFE_INTEGER);
    model.links.push({
        id: newId("l"),
        source: src.id,
        target: n.id,
        value: 1,
        unit: ""
    });
    selection = { type: "node", id: n.id };
    render();
    buildSidebar();
    persist();
    // Ouvre directement l'édition du nom du nouveau nœud
    editNodeName(n);
}

/* ---------------------- édition inline du nom ---------------------- */

function editNodeName(n: FlowNode): void {
    const wrap = canvas.parentElement as HTMLElement;
    const input = document.createElement("input");
    input.type = "text";
    input.value = n.name;
    input.className = "inline-edit";
    // Positionné dans les coordonnées du contenu : l'élément absolu suit
    // déjà le défilement du conteneur, on ne soustrait donc PAS le scroll.
    input.style.left = n.x + "px";
    input.style.top = n.y + "px";
    input.style.width = NODE_W + "px";
    input.style.height = nodeH(n) + "px";
    wrap.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const commit = (save: boolean) => {
        if (done) return;
        done = true;
        const v = input.value.trim();
        if (save && v && v !== n.name) {
            snapshot();
            n.name = v;
            render();
            buildSidebar();
            persist();
        }
        input.remove();
        canvas.focus();
    };
    input.addEventListener("keydown", e => {
        e.stopPropagation();
        if (e.key === "Enter") {
            e.preventDefault();
            commit(true);
        } else if (e.key === "Escape") {
            e.preventDefault();
            commit(false);
        }
    });
    input.addEventListener("blur", () => commit(true));
}

/**
 * Renomme un couloir depuis le canevas (double-clic sur son nom). Le nom d'un
 * couloir est une donnée d'apparence : il vit dans le projet, pas dans Excel.
 */
function editLaneTitle(lane: number): void {
    const wrap = canvas.parentElement as HTMLElement;
    const b = laneBounds.get(lane);
    const current = laneTitle(lane);
    const input = document.createElement("input");
    input.type = "text";
    input.value = current;
    input.placeholder = "Nom du couloir";
    input.className = "inline-edit";
    input.style.left = "6px";
    input.style.top = ((b ? b.haut - LANE_LABEL_H + 2 : GRID_Y)) + "px";
    input.style.width = "200px";
    input.style.height = "22px";
    wrap.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const commit = (save: boolean) => {
        if (done) return;
        done = true;
        const v = input.value.trim();
        if (save && v !== current) {
            snapshot(); // apparence : pas de garde-fou Excel
            setLaneTitle(lane, v);
            render();
            buildSidebar();
            persist();
        }
        input.remove();
        canvas.focus();
    };
    input.addEventListener("keydown", e => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); commit(true); }
        else if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", () => commit(true));
}

function svgTitle(text: string): SVGTitleElement {
    const t = document.createElementNS(SVGNS, "title") as SVGTitleElement;
    t.textContent = text;
    return t;
}

/** Intitulé affiché d'une colonne : le 1er titre non vide de ses nœuds. */
function columnTitle(column: number, sauf?: FlowNode): string {
    const n = model.nodes.find(x => x.column === column && x !== sauf && !!x.title);
    return n ? n.title : "";
}

/** Applique un intitulé à TOUS les nœuds d'une colonne. */
function setColumnTitle(column: number, titre: string): void {
    model.nodes.forEach(n => {
        if (n.column === column) n.title = titre;
    });
}

/**
 * Renomme une colonne depuis le canevas (double-clic sur son intitulé).
 * Le titre appartenant à chaque nœud dans le modèle Excel, on l'applique à
 * TOUS les nœuds de la colonne — y compris ceux d'une filière masquée.
 */
function editColumnTitle(column: number): void {
    const wrap = canvas.parentElement as HTMLElement;
    const current = columnTitle(column);
    const input = document.createElement("input");
    input.type = "text";
    input.value = current;
    input.placeholder = "Intitulé de la colonne";
    input.className = "inline-edit";
    const w = COL_W - 24;
    input.style.left = gridX(column) + NODE_W / 2 - w / 2 + "px";
    input.style.top = "12px";
    input.style.width = w + "px";
    input.style.height = "24px";
    wrap.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const commit = (save: boolean) => {
        if (done) return;
        done = true;
        const v = input.value.trim();
        if (save && v !== current) {
            snapshot();
            setColumnTitle(column, v);
            render();
            buildSidebar();
            persist();
        }
        input.remove();
        canvas.focus();
    };
    input.addEventListener("keydown", e => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); commit(true); }
        else if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", () => commit(true));
}

function toCanvas(e: MouseEvent): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/* --------------------------- panneau latéral ----------------------- */

function buildSidebar(): void {
    sidebar.innerHTML = "";

    const ep = buildExcelPanel();
    if (ep) sidebar.appendChild(ep);

    const fp = buildFilierePanel();
    if (fp) sidebar.appendChild(fp);

    // Section élément sélectionné
    if (selection.type === "node") {
        const n = nodeById(selection.id);
        if (n) {
            const s = section("Nœud sélectionné");
            s.appendChild(textField("Nom", n.name, v => { n.name = v; render(); persist(); }));
            // Le panneau « Filières affichées » n'est reconstruit qu'à la validation :
            // le faire à chaque frappe ferait perdre le focus (cf. tests).
            s.appendChild(textField(
                "Filière", n.filiere || "",
                v => { n.filiere = v; render(); persist(); },
                () => buildSidebar()
            ));
            // Le type part dans Excel (colonne « Type ») : le garde-fou du
            // classeur ouvert s'y applique via attachSnapshotOnFocus plus bas.
            s.appendChild(selectField("Type", kindOf(n), NODE_KINDS, v => {
                n.kind = v as NodeKind;
                render();
                persist();
            }));
            s.appendChild(colorField(
                "Couleur", n.color || options.nodes.nodeColor,
                v => { n.color = v; render(); persist(); }
            ));
            s.appendChild(divider());
            s.appendChild(numberField("Colonne", n.column, v => { n.column = Math.max(1, Math.round(v)); render(); persist(); }));
            // L'intitulé vaut pour toute la colonne : l'appliquer au seul nœud
            // sélectionné créerait un désaccord avec l'entête affiché.
            s.appendChild(textField("Intitulé de colonne", n.title, v => {
                setColumnTitle(n.column, v);
                render();
                persist();
            }));
            // Pas de buildSidebar() ici : reconstruire le panneau à chaque frappe
            // ferait perdre le focus du champ (cf. tests de saisie).
            s.appendChild(numberField("Couloir", laneOf(n), v => {
                moveNodeToCell(n, n.column, Math.max(1, Math.round(v) || 1), Number.MAX_SAFE_INTEGER);
                render();
                persist();
            }));
            s.appendChild(numberField("Ordre vertical", n.order, v => { n.order = v; render(); persist(); }));
            s.appendChild(divider());
            s.appendChild(dangerBtn("Supprimer le nœud", deleteSelected));
            attachSnapshotOnFocus(s);
            sidebar.appendChild(s);
        }
    } else if (selection.type === "link") {
        const l = model.links.find(x => x.id === selection.id);
        if (l) {
            const s = section("Lien sélectionné");
            const src = nodeById(l.source)?.name ?? "?";
            const tgt = nodeById(l.target)?.name ?? "?";
            s.appendChild(readonly("Flux", `${src} → ${tgt}`));
            if (excelPath) {
                s.appendChild(readonly("Valeur du flux", formatValue(l.value) + (l.unit ? " " + l.unit : "")));
                const vh = document.createElement("p");
                vh.className = "hint";
                vh.textContent = "La valeur se saisit dans Excel.";
                s.appendChild(vh);
            } else {
                s.appendChild(numberField("Valeur (provisoire)", l.value, v => { l.value = v; render(); persist(); }));
                s.appendChild(textField("Unité", l.unit || "", v => { l.unit = v; render(); persist(); }));
            }
            s.appendChild(divider());
            const srcColor = nodeById(l.source)?.color || options.nodes.nodeColor;
            s.appendChild(colorField(
                "Couleur du lien",
                l.colorOverride || srcColor,
                v => { l.colorOverride = v; render(); persist(); }
            ));
            if (l.colorOverride) {
                const reset = document.createElement("button");
                reset.className = "linklike";
                reset.textContent = "Réinitialiser (couleur du nœud d'origine)";
                reset.addEventListener("click", () => { l.colorOverride = null; render(); buildSidebar(); persist(); });
                s.appendChild(reset);
            } else {
                const note = document.createElement("p");
                note.className = "hint";
                note.textContent = "Par défaut, le lien prend la couleur de son nœud d'origine.";
                s.appendChild(note);
            }
            s.appendChild(divider());
            s.appendChild(dangerBtn("Supprimer le lien", deleteSelected));
            attachSnapshotOnFocus(s);
            sidebar.appendChild(s);
        }
    } else {
        const s = section("Sélection");
        const p = document.createElement("p");
        p.className = "hint";
        p.textContent = "Sélectionne un nœud ou un lien pour éditer ses propriétés.";
        s.appendChild(p);
        sidebar.appendChild(s);
    }

    // Section apparence globale
    sidebar.appendChild(buildAppearance());
}

function buildFilierePanel(): HTMLElement | null {
    const fils = distinctFilieres();
    if (!fils.some(f => f !== "")) return null; // aucune filière nommée
    const s = section("Filières affichées");
    fils.forEach(f => {
        const label = f === "" ? "(sans filière)" : f;
        s.appendChild(checkField(label, !hiddenFilieres.has(f), v => {
            if (v) hiddenFilieres.delete(f);
            else hiddenFilieres.add(f);
            render();
            persist();
        }));
    });
    const row = document.createElement("div");
    row.className = "check-row";
    const all = document.createElement("button");
    all.className = "linklike";
    all.textContent = "Tout afficher";
    all.addEventListener("click", () => {
        hiddenFilieres.clear();
        render();
        buildSidebar();
        persist();
    });
    const none = document.createElement("button");
    none.className = "linklike";
    none.textContent = "Tout masquer";
    none.addEventListener("click", () => {
        hiddenFilieres = new Set(fils);
        render();
        buildSidebar();
        persist();
    });
    row.appendChild(all);
    row.appendChild(none);
    s.appendChild(row);
    return s;
}

/**
 * Le panneau n'a plus de section « Synchronisation Excel » : le classeur est
 * celui qui est ouvert, et les modifications y partent d'elles-mêmes. Il n'y a
 * rien à connecter, rien à dissocier, rien à déclencher — donc rien à montrer.
 *
 * Sauf sur un Excel trop ancien pour `ExcelApi 1.7` : sans ses évènements, il
 * n'y a pas de synchronisation automatique, et ces deux boutons sont alors le
 * SEUL moyen de faire passer quoi que ce soit dans un sens ou dans l'autre.
 * C'est à ce titre qu'ils restent — pas comme confort.
 */
function buildExcelPanel(): HTMLElement | null {
    if (!caps().excel || caps().envoiAutomatique) return null;

    const s = section("Synchronisation manuelle");
    s.appendChild(hint(
        "Cet Excel est trop ancien pour signaler ses modifications (ExcelApi 1.7) : "
        + "les échanges avec le classeur passent par ces deux boutons."
    ));
    s.appendChild(wideBtn(
        "⬆︎  Diagramme → Excel",
        "Écrire la structure du diagramme dans les tableaux (les valeurs saisies dans Excel sont conservées)",
        () => { pushToExcel(); }
    ));
    s.appendChild(wideBtn(
        "⬇︎  Excel → Diagramme",
        "Remplacer le diagramme par le contenu des tableaux du classeur",
        () => { pullExcel(true); }
    ));
    if (dirtySinceSync) {
        const warn = document.createElement("p");
        warn.className = "hint warn";
        warn.textContent = "Modifications non encore écrites dans le classeur.";
        s.appendChild(warn);
    }
    return s;
}

function wideBtn(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "wide";
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    return b;
}

const FONT_FAMILIES: [string, string][] = [
    ["\"Source Sans Pro\", system-ui, -apple-system, Helvetica, Arial, sans-serif", "Source Sans Pro"],
    ["Segoe UI, system-ui, -apple-system, Helvetica, Arial, sans-serif", "Segoe UI"],
    ["Arial, sans-serif", "Arial"],
    ["Helvetica, Arial, sans-serif", "Helvetica"],
    ["Verdana, sans-serif", "Verdana"],
    ["Tahoma, sans-serif", "Tahoma"],
    ["Georgia, serif", "Georgia"],
    ["\"Times New Roman\", Times, serif", "Times New Roman"],
    ["\"Courier New\", monospace", "Courier New"]
];

// Titre de la carte d'apparence de chaque type. Au pluriel : c'est une carte de
// réglages qui vaut pour tous les nœuds du type, là où la liste déroulante du
// panneau (NODE_KINDS) qualifie UN nœud.
const TITRES_TYPES: Record<NodeKind, string> = {
    produit: "Produits / commodités",
    industrie: "Industries / étapes"
};

// Graisses réellement embarquées pour Source Sans Pro (cf. styles.css).
const FONT_WEIGHTS: [string, string][] = [
    ["300", "Fine"],
    ["400", "Normale"],
    ["600", "Semi-grasse"],
    ["700", "Grasse"]
];

/** Ajoute les contrôles de police (police, taille, couleur, gras, italique). */
function fontControls(
    parent: HTMLElement,
    o: { fontFamily: string; fontSize: number; fontColor: string; bold: boolean; italic: boolean },
    rr: () => void
): void {
    parent.appendChild(selectField("Police", o.fontFamily, FONT_FAMILIES,
        v => { o.fontFamily = v; rr(); }));
    parent.appendChild(numberField("Taille", o.fontSize, v => { o.fontSize = v; rr(); }));
    parent.appendChild(colorField("Couleur du texte", o.fontColor, v => { o.fontColor = v; rr(); }));
    parent.appendChild(styleToggles(o, rr));
}

/** Gras / italique compactés en deux bascules [G] [i], comme dans Word. */
function styleToggles(
    o: { bold: boolean; italic: boolean },
    rr: () => void
): HTMLElement {
    const group = document.createElement("div");
    group.className = "style-toggles";
    const mk = (
        label: string,
        title: string,
        cls: string,
        get: () => boolean,
        set: (v: boolean) => void
    ) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "style-toggle " + cls;
        b.textContent = label;
        b.title = title;
        b.setAttribute("aria-pressed", String(get()));
        b.classList.toggle("active", get());
        b.addEventListener("click", () => {
            set(!get());
            b.classList.toggle("active", get());
            b.setAttribute("aria-pressed", String(get()));
            rr();
        });
        group.appendChild(b);
    };
    mk("G", "Gras", "bold", () => o.bold, v => { o.bold = v; });
    mk("i", "Italique", "italic", () => o.italic, v => { o.italic = v; });
    return field("Style", group);
}

function buildAppearance(): DocumentFragment {
    const frag = document.createDocumentFragment();
    const rr = () => { render(); persist(); };

    // ---- Marges du graphique ----
    {
        const b = card("Marges du graphique", false);
        const c = options.chart;
        b.appendChild(numberField("Marge en haut", c.marginTop, v => { c.marginTop = v; rr(); }));
        b.appendChild(numberField("Marge en bas", c.marginBottom, v => { c.marginBottom = v; rr(); }));
        frag.appendChild(b.parentElement as HTMLElement);
    }

    // ---- Filières empilées ----
    {
        const b = card("Filières empilées", false);
        const f = options.filieres;

        b.appendChild(checkField("Un Sankey par filière", f.split, v => {
            f.split = v;
            rr();
            buildSidebar();
        }));
        const note = document.createElement("p");
        note.className = "hint";
        note.textContent =
            "Empile un diagramme par filière, chacun sous son nom. Les liens qui traversent "
            + "deux filières n'apparaissent pas dans ce mode.";
        b.appendChild(note);

        b.appendChild(numberField("Marge entre les graphiques", f.gap, v => { f.gap = v; rr(); }));
        b.appendChild(numberField("Espace sous le titre", f.titleSpace, v => {
            f.titleSpace = v; rr();
        }));
        b.appendChild(checkField("Même échelle pour tous", f.sameScale, v => {
            f.sameScale = v; rr();
        }));
        const note2 = document.createElement("p");
        note2.className = "hint";
        note2.textContent = f.sameScale
            ? "Une même unité de flux occupe la même épaisseur dans tous les diagrammes : "
              + "leurs hauteurs sont proportionnelles aux volumes."
            : "Chaque diagramme remplit sa case : les épaisseurs ne sont pas comparables "
              + "d'une filière à l'autre.";
        b.appendChild(note2);

        const sep2 = document.createElement("div");
        sep2.className = "divider";
        b.appendChild(sep2);

        b.appendChild(checkField("Afficher le nom de la filière", f.showTitle, v => {
            f.showTitle = v; rr(); buildSidebar();
        }));
        if (f.showTitle) {
            b.appendChild(selectField("Alignement du nom", f.align,
                [["gauche", "À gauche"], ["centre", "Centré"], ["droite", "À droite"]],
                v => { f.align = v as "gauche" | "centre" | "droite"; rr(); }));
            fontControls(b, f, rr);
        }
        frag.appendChild(b.parentElement as HTMLElement);
    }

    // ---- Couloirs ----
    {
        const b = card("Couloirs", false);
        const C = options.lanes;
        const lanes = couloirs();
        const intro = document.createElement("p");
        intro.className = "hint";
        intro.textContent =
            "Les couloirs sont des bandes horizontales : chaque nœud se range dans celui "
            + "que porte son champ « Couloir ». De quoi isoler les flux entrants ou sortants "
            + "du périmètre, par exemple.";
        b.appendChild(intro);

        if (lanes.length < 2) {
            const p2 = document.createElement("p");
            p2.className = "hint";
            p2.textContent =
                "Tous les nœuds sont dans le couloir 1 : la mise en page ne change pas. "
                + "Donne le couloir 2 à un nœud pour créer une deuxième bande.";
            b.appendChild(p2);
        } else {
            b.appendChild(numberField("Espace entre couloirs", C.gap, v => { C.gap = v; rr(); }));
            b.appendChild(checkField("Afficher les noms", C.showTitles, v => {
                C.showTitles = v; rr(); buildSidebar();
            }));
            if (C.showTitles) {
                lanes.forEach(lane => {
                    b.appendChild(textField(
                        "Couloir " + lane,
                        laneTitle(lane),
                        v => { setLaneTitle(lane, v); rr(); }
                    ));
                });
                fontControls(b, C, rr);
            }
        }
        frag.appendChild(b.parentElement as HTMLElement);
    }

    // ---- Titres de colonnes ----
    {
        const b = card("Titres de colonnes", false);
        const h = options.columnHeaders;
        b.appendChild(checkField("Afficher", h.show, v => { h.show = v; rr(); }));
        fontControls(b, h, rr);
        b.appendChild(colorField("Couleur de fond", h.backgroundColor, v => { h.backgroundColor = v; rr(); }));
        b.appendChild(numberField("Marge au-dessus", h.marginTop, v => { h.marginTop = v; rr(); }));
        b.appendChild(numberField("Marge en dessous", h.marginBottom, v => { h.marginBottom = v; rr(); }));
        frag.appendChild(b.parentElement as HTMLElement);
    }

    // ---- Nœuds ----
    {
        const b = card("Nœuds", false);
        b.appendChild(colorField("Couleur par défaut", options.nodes.nodeColor,
            v => { options.nodes.nodeColor = v; rr(); }));
        b.appendChild(numberField("Largeur des nœuds", options.nodes.nodeWidth,
            v => { options.nodes.nodeWidth = v; rr(); }));
        b.appendChild(rangeField("Espacement vertical", options.nodes.nodePadding, 0, 60,
            v => { options.nodes.nodePadding = v; rr(); }));
        b.appendChild(hint(
            "Produits et industries peuvent avoir leur propre largeur, leur propre police, "
            + "leur propre position d'étiquette et leur propre contour : voir les deux "
            + "cartes qui suivent."
        ));
        frag.appendChild(b.parentElement as HTMLElement);
    }

    /* ---- Une carte par type de nœud ----
       Une seule carte porterait deux fois les mêmes intitulés (« Largeur »,
       « Contour »…), impossibles à distinguer — pour l'utilisatrice comme pour
       les tests. Chaque type a donc sa carte, repliable indépendamment. */
    NODE_KINDS.forEach(([kind]) => {
        const t = options.nodeTypes[kind];
        const b = card(TITRES_TYPES[kind], false);
        b.appendChild(hint(
            kind === "produit"
                ? "Les commodités qui circulent. Une largeur nulle les réduit à un trait : "
                  + "seuls leur nom et les rubans restent visibles."
                : "Les étapes de transformation ou de commercialisation qui font circuler "
                  + "les produits. C'est souvent à elles qu'on donne une boîte large."
        ));
        b.appendChild(hint(
            "Tant qu'une case n'est pas cochée, ce type suit les options générales "
            + "« Nœuds » et « Étiquettes des nœuds » ; la cocher reprend la valeur en cours."
        ));

        b.appendChild(checkField("Largeur propre à ce type", t.width !== null, v => {
            t.width = v ? options.nodes.nodeWidth : null;
            rr();
            buildSidebar();
        }));
        if (t.width !== null) {
            b.appendChild(numberField("Largeur", t.width, v => {
                t.width = Math.max(0, v); rr();
            }));
            if (t.width === 0) {
                b.appendChild(hint("Largeur nulle : le nœud disparaît, seul son nom reste."));
            }
        }

        b.appendChild(divider());
        b.appendChild(checkField("Police propre à ce type", t.font !== null, v => {
            // On part de la police EFFECTIVE du type : cocher la case ne change
            // rien à l'écran, elle ne fait qu'ouvrir les réglages.
            t.font = v ? policeDuType(options, kind) : null;
            rr();
            buildSidebar();
        }));
        if (t.font) {
            const f = t.font;
            b.appendChild(selectField("Police", f.fontFamily, FONT_FAMILIES,
                v => { f.fontFamily = v; rr(); }));
            b.appendChild(selectField("Graisse", String(f.weight), FONT_WEIGHTS,
                v => { f.weight = parseInt(v, 10); rr(); }));
            b.appendChild(numberField("Taille", f.fontSize, v => { f.fontSize = v; rr(); }));
            b.appendChild(colorField("Couleur du texte", f.fontColor,
                v => { f.fontColor = v; rr(); }));
            b.appendChild(checkField("Italique", f.italic, v => { f.italic = v; rr(); }));
        }

        /* Position de l'étiquette : un type peut décoller ses noms des boîtes
           (« En dessous ») pendant que l'autre les garde dessus (« Centré »). */
        b.appendChild(divider());
        b.appendChild(checkField("Position d'étiquette propre à ce type", t.position !== null, v => {
            // On part de la position EFFECTIVE : cocher n'change rien à l'écran.
            t.position = v ? positionDuType(options, kind) : null;
            rr();
            buildSidebar();
        }));
        if (t.position !== null) {
            b.appendChild(selectField("Position de l'étiquette", t.position,
                NODE_LABEL_POSITIONS as [string, string][],
                v => { t.position = v as NodeLabelPosition; rr(); }));
        }

        /* Contour : un liseré qui entoure le nœud sans le toucher. */
        b.appendChild(divider());
        const o = t.outline;
        b.appendChild(checkField("Contour", o.show, v => { o.show = v; rr(); buildSidebar(); }));
        if (o.show) {
            b.appendChild(numberField("Écart au nœud", o.distance,
                v => { o.distance = Math.max(0, v); rr(); }));
            b.appendChild(numberField("Épaisseur du contour", o.width,
                v => { o.width = Math.max(0, v); rr(); }));
            b.appendChild(numberField("Arrondi", o.radius,
                v => { o.radius = Math.max(0, v); rr(); }));
            b.appendChild(selectField("Couleur du contour", o.mode,
                [["fonce", "Celle du nœud, assombrie"], ["noir", "Noir transparent"]],
                v => { o.mode = v as "fonce" | "noir"; rr(); buildSidebar(); }));
            b.appendChild(rangeField(
                o.mode === "noir" ? "Opacité du contour (%)" : "Assombrissement (%)",
                o.intensity, 0, 100, v => { o.intensity = v; rr(); }
            ));
        }
        frag.appendChild(b.parentElement as HTMLElement);
    });

    // ---- Étiquettes des nœuds ----
    {
        const b = card("Étiquettes des nœuds", false);
        const nl = options.nodeLabels;
        b.appendChild(checkField("Afficher", nl.show, v => { nl.show = v; rr(); }));
        b.appendChild(selectField("Position", nl.position,
            NODE_LABEL_POSITIONS as [string, string][],
            v => { nl.position = v as NodeLabelPosition; rr(); }));
        if (nl.position === "centre") {
            b.appendChild(hint(
                "L'étiquette se pose sur la boîte du nœud ; aux colonnes de bord elle "
                + "se cale sur le côté tourné vers l'intérieur pour ne pas sortir du cadre."
            ));
        }
        fontControls(b, nl, rr);
        b.appendChild(checkField("Afficher la valeur", nl.showValue, v => { nl.showValue = v; rr(); }));
        b.appendChild(divider());
        b.appendChild(checkField("Arrière-plan", nl.showBackground, v => { nl.showBackground = v; rr(); }));
        b.appendChild(colorField("Couleur d'arrière-plan", nl.backgroundColor,
            v => { nl.backgroundColor = v; rr(); }));
        b.appendChild(rangeField("Opacité de l'arrière-plan (%)", nl.backgroundOpacity, 0, 100,
            v => { nl.backgroundOpacity = v; rr(); }));
        b.appendChild(divider());
        b.appendChild(checkField("Retour à la ligne", nl.wrap, v => { nl.wrap = v; rr(); }));
        b.appendChild(numberField("Longueur max. par ligne", nl.maxChars, v => { nl.maxChars = v; rr(); }));
        frag.appendChild(b.parentElement as HTMLElement);
    }

    // ---- Liens ----
    {
        const b = card("Liens", false);
        b.appendChild(colorField("Couleur par défaut", options.links.defaultColor,
            v => { options.links.defaultColor = v; rr(); }));
        b.appendChild(checkField("Dégradé départ → arrivée", options.links.useGradient,
            v => { options.links.useGradient = v; rr(); }));
        b.appendChild(rangeField("Opacité (%)", options.links.opacity, 0, 100,
            v => { options.links.opacity = v; rr(); }));
        b.appendChild(selectField("Type de courbe", options.links.curveType,
            [["courbe", "Courbe"], ["droite", "Ligne droite"], ["marches", "Marches"]],
            v => { options.links.curveType = v as any; rr(); }));
        b.appendChild(rangeField("Courbure", options.links.curvature, 0, 100,
            v => { options.links.curvature = v; rr(); }));
        b.appendChild(selectField("Colonnes sautées", options.links.traversee,
            [["passage", "Réserver un passage"], ["direct", "Tracer tout droit"]],
            v => { options.links.traversee = v as any; rr(); }));
        if (options.links.traversee !== "direct") {
            b.appendChild(hint(
                "Un lien qui saute une colonne (de la 1 à la 3) s'y réserve une place : "
                + "il se faufile entre les nœuds traversés au lieu de passer dessus."
            ));
        }
        b.appendChild(checkField("Bordure", options.links.showBorder,
            v => { options.links.showBorder = v; rr(); }));
        b.appendChild(colorField("Couleur de bordure", options.links.borderColor,
            v => { options.links.borderColor = v; rr(); }));
        b.appendChild(numberField("Épaisseur de bordure", options.links.borderWidth,
            v => { options.links.borderWidth = v; rr(); }));
        frag.appendChild(b.parentElement as HTMLElement);
    }

    // ---- Valeurs des liens ----
    {
        const b = card("Valeurs des liens", false);
        const v = options.linkValueLabels;
        b.appendChild(checkField("Afficher", v.show, x => { v.show = x; rr(); }));
        b.appendChild(textField("Unité (si aucune dans les données)", v.unitText,
            x => { v.unitText = x; rr(); }));
        fontControls(b, v, rr);
        frag.appendChild(b.parentElement as HTMLElement);
    }

    return frag;
}

/** Crée une carte repliable ; renvoie le corps où empiler les contrôles. */
// Le panneau est reconstruit à chaque changement d'option : sans mémoire, toutes
// les sections se replieraient sous les doigts de l'utilisatrice.
const cartesOuvertes = new Map<string, boolean>();

function card(title: string, open: boolean): HTMLElement {
    if (!cartesOuvertes.has(title)) cartesOuvertes.set(title, open);
    const details = document.createElement("details");
    details.className = "panel card-collapsible";
    details.open = cartesOuvertes.get(title) as boolean;
    details.addEventListener("toggle", () => cartesOuvertes.set(title, details.open));
    const summary = document.createElement("summary");
    summary.textContent = title;
    details.appendChild(summary);
    const body = document.createElement("div");
    body.className = "card-body";
    details.appendChild(body);
    return body;
}

/* --------------------------- petits helpers UI --------------------- */

function btn(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
}
function sep(): HTMLElement {
    const d = document.createElement("span");
    d.className = "toolbar-sep";
    return d;
}
function section(title: string): HTMLElement {
    const d = document.createElement("div");
    d.className = "panel";
    const h = document.createElement("h3");
    h.textContent = title;
    d.appendChild(h);
    return d;
}
function divider(): HTMLElement {
    const d = document.createElement("div");
    d.className = "divider";
    return d;
}
/** Intertitre d'un groupe de réglages à l'intérieur d'une carte. */
function subhead(texte: string): HTMLElement {
    const h = document.createElement("h4");
    h.className = "subhead";
    h.textContent = texte;
    return h;
}
/** Paragraphe d'explication (même style que les autres notes du panneau). */
function hint(texte: string): HTMLElement {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = texte;
    return p;
}
function field(label: string, control: HTMLElement, modifier?: string): HTMLElement {
    const w = document.createElement("label");
    w.className = "field" + (modifier ? " " + modifier : "");
    const span = document.createElement("span");
    span.textContent = label;
    w.appendChild(span);
    w.appendChild(control);
    return w;
}
/**
 * Champ texte. `onCommit` est appelé à la validation (perte de focus ou Entrée),
 * jamais à chaque frappe : un gestionnaire qui reconstruit le panneau détruirait
 * le champ en cours de saisie et ferait perdre le focus dès le 1er caractère.
 */
function textField(
    label: string,
    value: string,
    onChange: (v: string) => void,
    onCommit?: (v: string) => void
): HTMLElement {
    const i = document.createElement("input");
    i.type = "text";
    i.value = value;
    i.addEventListener("input", () => onChange(i.value));
    if (onCommit) i.addEventListener("change", () => onCommit(i.value));
    return field(label, i);
}
function numberField(label: string, value: number, onChange: (v: number) => void): HTMLElement {
    const i = document.createElement("input");
    i.type = "number";
    i.value = String(value);
    i.addEventListener("input", () => { const n = parseFloat(i.value); if (!isNaN(n)) onChange(n); });
    return field(label, i, "half");
}
/**
 * Couleurs déjà présentes dans le diagramme : couleurs propres des nœuds,
 * surcharges de liens et couleurs choisies dans les options d'apparence.
 * Classées par fréquence d'emploi, les plus utilisées d'abord.
 */
function couleursDuDocument(): string[] {
    const compte = new Map<string, number>();
    const ajoute = (c?: string | null) => {
        const h = normalizeHex(c || "");
        if (h) compte.set(h, (compte.get(h) || 0) + 1);
    };
    model.nodes.forEach(n => ajoute(n.color));
    model.links.forEach(l => ajoute(l.colorOverride));
    ajoute(options.nodes.nodeColor);
    ajoute(options.links.defaultColor);
    ajoute(options.links.borderColor);
    ajoute(options.nodeLabels.fontColor);
    ajoute(options.nodeLabels.backgroundColor);
    ajoute(options.columnHeaders.fontColor);
    ajoute(options.columnHeaders.backgroundColor);
    ajoute(options.linkValueLabels.fontColor);
    NODE_KINDS.forEach(([kind]) => {
        const f = options.nodeTypes[kind].font;
        if (f) ajoute(f.fontColor);
    });
    return [...compte.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
}

/**
 * Champ « couleur » : un bouton pastille qui ouvre la palette en surcouche
 * (une teinte par colonne, les nuances en lignes — comme dans Word/Excel).
 */
function colorField(
    label: string,
    value: string,
    onChange: (v: string) => void
): HTMLElement {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "color-btn";

    const chip = document.createElement("span");
    chip.className = "color-chip";
    const hex = document.createElement("span");
    hex.className = "color-hex";
    const paint = (v: string) => {
        const h = normalizeHex(v) || toHex(v);
        chip.style.background = h;
        hex.textContent = h;
    };
    paint(value);
    trigger.appendChild(chip);
    trigger.appendChild(hex);

    trigger.addEventListener("click", () => {
        openColorPopover({
            anchor: trigger,
            label,
            value: normalizeHex(value) || toHex(value),
            usedColors: couleursDuDocument(),
            onBeforeChange: () => { snapshot(); },
            onPick: v => { paint(v); onChange(v); }
        });
    });

    return field(label, trigger, "half");
}
function checkField(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
    const i = document.createElement("input");
    i.type = "checkbox";
    i.checked = value;
    i.addEventListener("change", () => onChange(i.checked));
    const w = document.createElement("label");
    w.className = "field check";
    w.appendChild(i);
    const span = document.createElement("span");
    span.textContent = label;
    w.appendChild(span);
    return w;
}
function rangeField(label: string, value: number, min: number, max: number, onChange: (v: number) => void): HTMLElement {
    const i = document.createElement("input");
    i.type = "range";
    i.min = String(min);
    i.max = String(max);
    i.value = String(value);
    i.addEventListener("input", () => onChange(parseFloat(i.value)));
    return field(label, i);
}
function selectField(label: string, value: string, opts: [string, string][], onChange: (v: string) => void): HTMLElement {
    const sel = document.createElement("select");
    opts.forEach(([val, txt]) => {
        const o = document.createElement("option");
        o.value = val;
        o.textContent = txt;
        if (val === value) o.selected = true;
        sel.appendChild(o);
    });
    sel.addEventListener("change", () => onChange(sel.value));
    return field(label, sel);
}
function readonly(label: string, value: string): HTMLElement {
    const d = document.createElement("div");
    d.className = "readonly";
    d.textContent = value;
    return field(label, d);
}
function dangerBtn(label: string, onClick: () => void): HTMLElement {
    const b = document.createElement("button");
    b.className = "danger";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
}

function attachSnapshotOnFocus(container: HTMLElement): void {
    // Snapshot avant la 1re modification d'un champ : permet l'annulation Cmd+Z.
    container.querySelectorAll("input, select").forEach(el => {
        el.addEventListener("focus", () => { snapshot(); });
    });
}

function setStatus(msg: string): void {
    if (statusEl) statusEl.textContent = msg;
}
function formatValue(v: number): string {
    return (v ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}
function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function toHex(c: string): string {
    if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
    const named: { [k: string]: string } = {
        red: "#ff0000", orange: "#ffa500", blue: "#0000ff", green: "#008000",
        black: "#000000", white: "#ffffff", grey: "#808080", gray: "#808080"
    };
    return named[c.toLowerCase()] || "#6b6b6b";
}

/* --------------------------- persistance --------------------------- */

/**
 * Un diagramme complet — modèle ET apparence — en un seul objet.
 *
 * Plus aucun fichier n'a cette forme : dans le complément le modèle vient des
 * tableaux et l'apparence de `document.settings`. Elle reste le format des
 * FIXTURES : c'est par là que les bancs d'essai et `tests/run.js` chargent un
 * diagramme d'un coup, sans Excel (crochet `__sankeyTest.loadProject`).
 */
interface ProjectFile {
    version: number;
    model: FlowModel;
    options: SankeyOptions;
    idCounter: number;
    hiddenFilieres?: string[];
}

function applyProject(p: ProjectFile): void {
    model = p.model;
    // Compat : garantit le champ filiere sur les anciens projets
    model.nodes.forEach(n => {
        if (n.filiere === undefined) n.filiere = "";
        // Compat : les projets antérieurs aux couloirs n'en ont qu'un.
        if (!(typeof n.lane === "number" && n.lane >= 1)) n.lane = 1;
        // Compat : avant les types, tout nœud est un produit.
        n.kind = kindOf(n);
    });
    options = Object.assign(defaultOptions(), p.options);
    normaliserTypesDeNoeuds();
    normaliserLiens();
    // Le compteur du fichier n'est jamais cru sur parole : on prend le plus grand
    // entre lui et le maximum réellement utilisé.
    idCounter = Math.max(p.idCounter || 0, guessCounter());
    const repares = repairDuplicateIds();
    if (repares) {
        setStatus(
            repares + " identifiant(s) en double corrigé(s) à l'ouverture — " +
            "vérifie les liens des nœuds concernés."
        );
    }
    hiddenFilieres = new Set(p.hiddenFilieres || []);
    selection = { type: null, id: "" };
}
/**
 * Complète les réglages des liens, pour la même raison : un projet écrit avant
 * l'option « Colonnes sautées » arrive sans `traversee`. Le défaut réserve une
 * place aux liens qui sautent une colonne.
 */
function normaliserLiens(): void {
    const L = options.links;
    if (L.traversee !== "passage" && L.traversee !== "direct") {
        L.traversee = defaultOptions().links.traversee;
    }
}
/**
 * Complète les réglages par type de nœud : `Object.assign` ne fusionne que le
 * premier niveau, un projet écrit avant (ou pendant) l'arrivée des types peut
 * donc arriver avec un `nodeTypes` absent ou partiel.
 */
function normaliserTypesDeNoeuds(): void {
    const t = (options.nodeTypes || {}) as Partial<SankeyOptions["nodeTypes"]>;
    const complet = (s?: NodeTypeStyle): NodeTypeStyle => {
        const d = defaultTypeStyle();
        if (!s) return d;
        return {
            width: typeof s.width === "number" ? s.width : null,
            font: s.font ? Object.assign({}, s.font) : null,
            position: NODE_LABEL_POSITIONS.some(([v]) => v === s.position) ? s.position : null,
            outline: Object.assign(d.outline, s.outline || {})
        };
    };
    options.nodeTypes = { produit: complet(t.produit), industrie: complet(t.industrie) };
}

/**
 * Renumérote les nœuds/liens qui partagent un identifiant.
 * On garde le premier porteur (les liens existants le désignent) et on donne un
 * identifiant neuf aux suivants. Renvoie le nombre de corrections.
 */
function repairDuplicateIds(): number {
    let corriges = 0;
    const vus = new Set<string>();
    model.nodes.forEach(n => {
        if (vus.has(n.id)) {
            n.id = newId("n");
            corriges++;
        }
        vus.add(n.id);
    });
    const vusL = new Set<string>();
    model.links.forEach(l => {
        if (vusL.has(l.id)) {
            l.id = newId("l");
            corriges++;
        }
        vusL.add(l.id);
    });
    return corriges;
}

function guessCounter(): number {
    const ids = [...model.nodes.map(n => n.id), ...model.links.map(l => l.id)];
    let max = 0;
    ids.forEach(id => { const m = id.match(/\d+/); if (m) max = Math.max(max, +m[0]); });
    return max + 1;
}
/**
 * Aucun cache local ici, et c'est délibéré : la source de vérité du modèle est
 * le classeur, sans exception. Un modèle rejoué depuis `localStorage`
 * ressusciterait des nœuds que l'utilisatrice a supprimés dans Excel.
 */
function persist(): void {
    dirtySinceSync = true; // toute modification rend le diagramme « en avance »
    planifierEnregistrementApparence();
    planifierEnvoiExcel();
}

/* ----------------------- apparence (volet Excel) ----------------------- */

/**
 * Ce qu'un projet garde quand le MODÈLE vit dans le classeur (PLAN §5.2).
 * C'est `ProjectFile` moins `model` — plus les surcharges de couleur des liens,
 * qui sont portées par `FlowLink` et n'existent pas dans Excel : sans cette
 * table, elles ne survivraient pas à une relecture du classeur.
 */
interface ProjectAppearance {
    version: number;
    options: SankeyOptions;
    idCounter: number;
    hiddenFilieres: string[];
    /** Indexé « <ID origine> <ID destination> », comme les liens eux-mêmes. */
    colorOverrides: Record<string, string>;
}

/** Surcharges relues, en attente des liens que le classeur va fournir. */
let couleursLiensEnAttente: Record<string, string> = {};

function serialiserApparence(): string {
    const colorOverrides: Record<string, string> = {};
    model.links.forEach(l => {
        if (l.colorOverride) colorOverrides[l.source + " " + l.target] = l.colorOverride;
    });
    const a: ProjectAppearance = {
        version: 1, options, idCounter,
        hiddenFilieres: Array.from(hiddenFilieres), colorOverrides
    };
    return JSON.stringify(a);
}

function appliquerApparence(json: string): void {
    const a = JSON.parse(json) as ProjectAppearance;
    options = Object.assign(defaultOptions(), a.options);
    normaliserTypesDeNoeuds();
    normaliserLiens();
    idCounter = Math.max(a.idCounter || 0, idCounter);
    hiddenFilieres = new Set(a.hiddenFilieres || []);
    // Les liens n'existent pas encore : ils viendront du classeur.
    couleursLiensEnAttente = a.colorOverrides || {};
}

/** Rend aux liens leurs couleurs propres, une fois le classeur lu. */
function appliquerCouleursDeLiens(): void {
    const table = couleursLiensEnAttente;
    if (!Object.keys(table).length) return;
    model.links.forEach(l => {
        const c = table[l.source + " " + l.target];
        if (c) l.colorOverride = c;
    });
}

/* ------------------- enregistrement & synchro automatiques ------------------ */

let minuteurProjet = 0;
let minuteurExcel = 0;
let minuteurApparence = 0;

/** Délai d'apaisement avant d'écrire vers Excel, comme `notifyTimer` (main.js:62). */
const DELAI_ENVOI_EXCEL = 300;

/** Range l'apparence dans le classeur (`document.settings`, PLAN §5.2). */
function planifierEnregistrementApparence(): void {
    const d = desktop();
    if (!d || typeof d.ecrireApparence !== "function") return;
    clearTimeout(minuteurApparence);
    minuteurApparence = setTimeout(() => {
        d.ecrireApparence(serialiserApparence())
            .catch(() => { /* réessayé au prochain changement */ });
    }, 800) as unknown as number;
}

/**
 * Envoi automatique vers Excel, peu après la dernière modification.
 *
 * Il n'a lieu que parce qu'écrire est GRATUIT ici : 12 ms depuis le classeur
 * ouvert, sans déclencher d'enregistrement (mesures RESULTATS-PHASE-0). Là où
 * `envoiAutomatique` est faux — Excel sans ExcelApi 1.7 — ce sont les deux
 * boutons du panneau qui font le travail.
 */
function planifierEnvoiExcel(): void {
    if (!caps().envoiAutomatique || !amorceFaite) return;
    clearTimeout(minuteurExcel);
    minuteurExcel = setTimeout(() => {
        // `persist()` est aussi appelée APRÈS une écriture réussie : sans ce
        // garde-fou, chaque écriture en programmerait une autre, sans fin.
        if (!dirtySinceSync) return;
        pushToExcel({ silencieux: true });
    }, DELAI_ENVOI_EXCEL) as unknown as number;
}
/** Range l'apparence dans le classeur, à la demande (bouton « Enregistrer »). */
async function saveProject(): Promise<void> {
    const d = desktop();
    if (!d || typeof d.ecrireApparence !== "function") {
        setStatus("Aucun classeur : l'apparence n'a nulle part où aller.");
        return;
    }
    // Le modèle est déjà dans les tableaux : il ne reste que l'apparence.
    const r = await d.ecrireApparence(serialiserApparence());
    setStatus(r && r.ok === false
        ? "L'apparence n'a pas pu être rangée dans le classeur."
        : "Apparence enregistrée dans le classeur — enregistre-le dans Excel "
          + "pour qu'elle suive le fichier.");
}

/* ------------------------------ Export ----------------------------- */

async function exportImage(format: "png" | "svg"): Promise<void> {
    const wrap = canvas.parentElement as HTMLElement;
    const w = Math.max(1280, Math.round(wrap.clientWidth));
    const h = Math.max(720, Math.round(wrap.clientHeight));

    // Rend le Sankey (vue filtrée) dans un SVG hors écran.
    const tmp = document.createElementNS(SVGNS, "svg") as SVGSVGElement;
    tmp.setAttribute("xmlns", SVGNS);
    dessinerApercu(tmp, w, h, "none"); // export sans fond : PNG et SVG transparents
    const svgString =
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
        new XMLSerializer().serializeToString(tmp);

    if (format === "svg") {
        await saveExport("sankey.svg", "image/svg+xml", svgString, false);
        return;
    }

    // PNG : SVG -> Image -> canvas (x2 pour la netteté)
    const scale = 2;
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
    const img = new Image();
    await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("SVG illisible"));
        img.src = url;
    });
    const c = document.createElement("canvas");
    c.width = w * scale;
    c.height = h * scale;
    const ctx = c.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const base64 = c.toDataURL("image/png").split(",")[1];
    await saveExport("sankey.png", "image/png", base64, true);
}

/** Le navigateur d'Office télécharge le fichier : pas de dialogue natif ici. */
async function saveExport(name: string, mime: string, data: string, binary: boolean): Promise<void> {
    let blob: Blob;
    if (binary) {
        const bin = atob(data);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        blob = new Blob([arr], { type: mime });
    } else {
        blob = new Blob([data], { type: mime });
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setStatus("Image exportée.");
}

/* ------------------------------ Excel ------------------------------ */

function desktop(): any {
    return (window as any).desktop;
}

/**
 * Ce que la coquille qui héberge le renderer sait faire.
 *
 * Il n'y a plus qu'une coquille — le complément — mais la seam reste, parce
 * qu'elle porte encore une vraie variation : `envoiAutomatique` dépend d'un jeu
 * d'exigences SONDÉ sur le poste (`ExcelApi 1.7`), pas de la plateforme. Le
 * code d'édition demande une CAPACITÉ ; il ne teste jamais où il tourne.
 *
 * Trois implémentations : `src/addin/pont.ts` (le volet, sur le classeur),
 * `src/addin/pont-fenetre.ts` (la fenêtre d'édition, par le tunnel) et les faux
 * ponts des bancs de `tests/`.
 */
interface Capacites {
    /** Un classeur Excel est joignable en lecture/écriture. */
    excel: boolean;
    /** Écrire vers Excel à chaque modification (mesuré à 12 ms, phase 0). */
    envoiAutomatique: boolean;
}

const SANS_CAPACITE: Capacites = { excel: false, envoiAutomatique: false };

function caps(): Capacites {
    const d = desktop();
    if (!d || !d.capacites) return SANS_CAPACITE;       // page web nue (npm run serve)
    return Object.assign({}, SANS_CAPACITE, d.capacites);
}

/**
 * Branche l'écoute des modifications faites DANS Excel.
 *
 * Il n'y a plus ni verrou ni surveillance de fichier : le classeur est celui
 * qui est ouvert, et c'est Office qui nous signale ses tableaux qui bougent.
 */
function wireExcelWatchers(): void {
    const d = desktop();
    if (!d || !caps().excel) return;
    if (typeof d.onExcelChanged === "function") d.onExcelChanged(() => onExcelFileChanged());
}

function basename(p: string): string {
    return p.split(/[\\/]/).pop() || p;
}

/** Sens diagramme → Excel : écrit la structure (les valeurs saisies sont conservées). */
async function pushToExcel(opts?: { silencieux?: boolean }): Promise<void> {
    const silencieux = !!(opts && opts.silencieux);
    const d = desktop();
    if (!d || !caps().excel) return;
    // Une écriture dure quelques millisecondes, mais l'utilisatrice continue
    // d'éditer pendant ce temps. On ne jette PAS la modification suivante, on la
    // reprogramme — sinon le dernier changement d'une salve n'arriverait jamais.
    if (pushEnCours) {
        planifierEnvoiExcel();
        if (!silencieux) setStatus("Écriture vers Excel déjà en cours — celle-ci suivra.");
        return;
    }
    pushEnCours = true;
    try {
        // Conserve les valeurs déjà saisies dans Excel pour les liens existants
        const rd = await d.readExcel(excelPath);
        if (rd.ok && rd.data) mergeValuesFromExcel(rd.data);

        const res = await d.writeExcel(
            { nodes: model.nodes, links: model.links }, excelPath, undefined,
            { save: !silencieux }
        );
        if (!res.ok) {
            setStatus("Échec de l'écriture Excel : " + res.error);
            return;
        }
        markAllSynced();
        dirtySinceSync = false;
        if (!linkDrag && !dragState) {
            render();
            buildSidebar();
        }
        persist();
        dirtySinceSync = false;
        if (!silencieux) {
            setStatus("Écrit dans le classeur — enregistre-le dans Excel quand tu veux.");
        }
    } finally {
        pushEnCours = false;
    }
}

/**
 * Démarrage dans le volet Excel : l'apparence vient du classeur, le modèle des
 * tableaux. Rien n'est envoyé vers Excel avant que cette lecture ait réussi
 * (`amorceFaite`) — la synchro montante automatique écrirait sinon un modèle
 * vide par-dessus les tableaux.
 */
async function amorcerDepuisClasseur(): Promise<void> {
    const d = desktop();
    if (!d) return;
    if (typeof d.lireApparence === "function") {
        try {
            const json = await d.lireApparence();
            if (json) appliquerApparence(json);
        } catch { /* classeur sans apparence : on garde les réglages par défaut */ }
    }
    setStatus("Lecture du classeur…");
    let res: { ok?: boolean; data?: ExcelData; error?: string } | null = null;
    try {
        res = await d.readExcel(excelPath);
    } catch (e) {
        res = { ok: false, error: (e as Error).message };
    }
    if (!res || !res.ok || !res.data) {
        render();
        buildSidebar();
        setStatus("Classeur illisible" + (res && res.error ? " : " + res.error : "") +
            " — vérifie que l'onglet Diagramme porte bien les tableaux Nœuds et Liens.");
        return;
    }
    model = { nodes: [], links: [] };
    syncedNodeIds = new Set();
    syncedLinkIds = new Set();
    const assigned = reconcileFromExcel(res.data);
    appliquerCouleursDeLiens();
    markAllSynced();
    dirtySinceSync = false;
    amorceFaite = true;
    render();
    buildSidebar();
    setStatus(`Classeur lu : ${model.nodes.length} nœud(s), ${model.links.length} lien(s).`);
    // Des lignes saisies dans Excel sans identifiant viennent d'en recevoir un :
    // il faut le leur rendre, sinon elles seront recréées à la prochaine lecture.
    if (assigned) pushToExcel({ silencieux: true });
}

/** Sens Excel → App : remplace le diagramme par le contenu du classeur. */
async function pullExcel(manual: boolean): Promise<void> {
    const d = desktop();
    if (!d || !excelPath) return;

    if (manual && dirtySinceSync) {
        const ok = confirm(
            "⚠️ Des modifications de l'application n'ont pas encore été écrites vers Excel.\n\n" +
            "Importer depuis Excel va les écraser. Continuer ?"
        );
        if (!ok) return;
    }

    const res = await d.readExcel(excelPath);
    if (!res.ok || !res.data) {
        setStatus("Lecture du classeur impossible" + (res.error ? " : " + res.error : "."));
        return;
    }
    const assigned = reconcileFromExcel(res.data);
    render();
    buildSidebar();
    persist();
    dirtySinceSync = false;
    setStatus("Importé depuis Excel : " + basename(excelPath));

    // Réécrit si des IDs ont été attribués à des lignes saisies dans Excel
    if (assigned) {
        const w = await d.writeExcel({ nodes: model.nodes, links: model.links }, excelPath);
        if (w.ok) markAllSynced();
    }
}

/** Import automatique quand Excel est sauvegardé (respecte les modifs locales). */
function onExcelFileChanged(): void {
    if (dirtySinceSync) {
        setStatus(
            "Excel a changé, mais des modifications locales sont en attente. " +
            "Utilise « Excel → App » pour importer (elles seront écrasées)."
        );
    } else {
        pullExcel(false);
    }
}

/** Après un import, des identifiants du classeur peuvent dépasser le compteur. */
function syncCounterWithModel(): void {
    idCounter = Math.max(idCounter, guessCounter());
}

function mergeValuesFromExcel(data: ExcelData): void {
    const idSet = new Set(model.nodes.map(n => n.id));
    const nameToId = new Map<string, string>();
    model.nodes.forEach(n => nameToId.set(n.name, n.id));
    const byPair = new Map(model.links.map(l => [l.source + " " + l.target, l]));
    data.links.forEach(E => {
        const s = E.sourceId && idSet.has(E.sourceId) ? E.sourceId : nameToId.get(E.sourceName);
        const t = E.targetId && idSet.has(E.targetId) ? E.targetId : nameToId.get(E.targetName);
        if (!s || !t) return;
        const l = byPair.get(s + " " + t);
        if (l) {
            l.value = E.value;
            if (E.unit) l.unit = E.unit;
        }
    });
}

function markAllSynced(): void {
    syncedNodeIds = new Set(model.nodes.map(n => n.id));
    syncedLinkIds = new Set(model.links.map(l => l.source + " " + l.target));
}

function layoutNew(n: FlowNode): void {
    n.x = 40 + (n.column - 1) * (NODE_W + 60);
    n.y = 40 + n.order * (NODE_H + 30);
}

/**
 * Fusionne les données Excel dans le modèle (par ID). Les valeurs et éditions
 * d'Excel font autorité ; les lignes sans ID sont créées (ID attribué) ; les
 * lignes disparues d'Excel mais déjà synchronisées sont supprimées.
 * Renvoie true si des IDs ont été attribués (nécessite une réécriture).
 */
function reconcileFromExcel(data: ExcelData): boolean {
    let assigned = false;

    const nodesById = new Map(model.nodes.map(n => [n.id, n]));
    const excelNodeIds = new Set<string>();
    const newSyncedNodes = new Set<string>();

    data.nodes.forEach(E => {
        let id = E.id;
        if (id && nodesById.has(id)) {
            const n = nodesById.get(id)!;
            n.name = E.name; n.column = E.column; n.title = E.title;
            n.order = E.order; n.filiere = E.filiere; n.color = E.color;
            if (data.hasLane) n.lane = E.lane;
            if (data.hasKind) n.kind = E.kind;
            excelNodeIds.add(id); newSyncedNodes.add(id);
        } else {
            if (!id) { id = newId("n"); assigned = true; }
            else { excelNodeIds.add(id); }
            const n: FlowNode = {
                id, name: E.name, column: E.column, title: E.title,
                lane: data.hasLane ? E.lane : 1,
                kind: data.hasKind ? E.kind : "produit",
                order: E.order, filiere: E.filiere, color: E.color, x: 0, y: 0
            };
            layoutNew(n);
            model.nodes.push(n);
            nodesById.set(id, n);
            newSyncedNodes.add(id);
        }
    });

    model.nodes = model.nodes.filter(n => {
        if (excelNodeIds.has(n.id) || newSyncedNodes.has(n.id)) return true;
        return !syncedNodeIds.has(n.id); // supprimé dans Excel si déjà synchronisé
    });

    const idSet = new Set(model.nodes.map(n => n.id));
    const nameToId = new Map<string, string>();
    model.nodes.forEach(n => nameToId.set(n.name, n.id));

    // Un lien est identifié par le couple (idOrigine, idDestination).
    const pairKey = (s: string, t: string) => s + " " + t;
    const linksByPair = new Map(model.links.map(l => [pairKey(l.source, l.target), l]));
    const excelPairs = new Set<string>();
    const newSyncedLinks = new Set<string>();

    data.links.forEach(E => {
        // Résout les IDs (colonnes ID) sinon retombe sur les noms.
        const s = E.sourceId && idSet.has(E.sourceId) ? E.sourceId : nameToId.get(E.sourceName);
        const t = E.targetId && idSet.has(E.targetId) ? E.targetId : nameToId.get(E.targetName);
        if (!s || !t || s === t) return; // extrémités inconnues ou identiques
        const key = pairKey(s, t);
        if (excelPairs.has(key)) return; // pas de doublon de lien
        excelPairs.add(key);

        const existing = linksByPair.get(key);
        if (existing) {
            existing.value = E.value;
            existing.unit = E.unit;
            newSyncedLinks.add(key);
        } else {
            const l: FlowLink = { id: newId("l"), source: s, target: t, value: E.value, unit: E.unit };
            model.links.push(l);
            linksByPair.set(key, l);
            newSyncedLinks.add(key);
        }
    });

    model.links = model.links.filter(l => {
        const key = pairKey(l.source, l.target);
        if (excelPairs.has(key)) return true;
        return !syncedLinkIds.has(key); // supprimé dans Excel si déjà synchronisé
    });
    // Nettoyage des liens dont un nœud a disparu + déduplication finale.
    const seen = new Set<string>();
    model.links = model.links.filter(l => {
        if (!idSet.has(l.source) || !idSet.has(l.target)) return false;
        const key = pairKey(l.source, l.target);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    syncedNodeIds = newSyncedNodes;
    syncedLinkIds = newSyncedLinks; // contient désormais des clés de couple

    // Le classeur peut contenir des identifiants au-delà du compteur courant.
    syncCounterWithModel();
    return assigned;
}
