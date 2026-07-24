// Éditeur graphique : création/déplacement de nœuds, tracé de liens,
// panneau de propriétés, et bascule Édition / Aperçu Sankey.

import { FlowModel, FlowNode, FlowLink, SankeyOptions, defaultOptions } from "./types";
import { renderSankey } from "./engine";

const NODE_W = 132;
const NODE_H = 38;
const SVGNS = "http://www.w3.org/2000/svg";

// Grille d'édition : colonnes d'affichage (X) × ordre vertical (Y).
const COL_W = 210; // écart horizontal entre colonnes
const ROW_H = 60; // écart vertical entre rangées
const GRID_X = 40; // marge gauche
const GRID_Y = 74; // marge haute (place pour les entêtes de colonnes)

function gridX(column: number): number {
    return GRID_X + (column - 1) * COL_W;
}
function gridY(rank: number): number {
    return GRID_Y + rank * ROW_H;
}
function bandLeft(column: number): number {
    return gridX(column) - (COL_W - NODE_W) / 2;
}

/** Place chaque nœud sur la grille : x = colonne, y = rang (ordre) dans la colonne. */
function layoutGrid(): void {
    const byCol = new Map<number, FlowNode[]>();
    viewNodes().forEach(n => {
        if (!byCol.has(n.column)) byCol.set(n.column, []);
        byCol.get(n.column)!.push(n);
    });
    byCol.forEach(list => {
        list.sort((a, b) => a.order - b.order);
        list.forEach((n, rank) => {
            n.x = gridX(n.column);
            n.y = gridY(rank);
        });
    });
}

/** Déplace un nœud vers la cellule (colonne, rang) et renumérote les ordres. */
function moveNodeToCell(n: FlowNode, column: number, rank: number): void {
    const oldCol = n.column;
    // On ne réordonne que parmi les nœuds VISIBLES de la colonne cible.
    const others = viewNodes()
        .filter(x => x !== n && x.column === column)
        .sort((a, b) => a.order - b.order);
    const r = Math.max(0, Math.min(rank, others.length));
    others.splice(r, 0, n);
    n.column = column;
    others.forEach((x, i) => (x.order = i));
    if (oldCol !== column) {
        viewNodes()
            .filter(x => x.column === oldCol)
            .sort((a, b) => a.order - b.order)
            .forEach((x, i) => (x.order = i));
    }
}

type Mode = "move" | "link";
type View = "edit" | "preview";

interface Selection {
    type: "node" | "link" | null;
    id: string;
}

let model: FlowModel = { nodes: [], links: [] };
let options: SankeyOptions = defaultOptions();
let mode: Mode = "move";
let view: View = "edit";
let selection: Selection = { type: null, id: "" };
let linkSourceId: string | null = null;
let projectPath: string | null = null;
let excelPath: string | null = null;
let idCounter = 1;
let undoStack: string[] = [];
let redoStack: string[] = [];
let syncedNodeIds = new Set<string>();
let syncedLinkIds = new Set<string>();
let pendingExcelWrite = false;
let dirtySinceSync = false; // modifications app non encore poussées vers Excel
let hiddenFilieres = new Set<string>(); // filières masquées du schéma

interface ExcelNode {
    id: string | null; name: string; column: number; title: string;
    order: number; filiere: string; color: string | null;
}
interface ExcelLink {
    sourceId: string | null; targetId: string | null;
    sourceName: string; targetName: string;
    value: number; unit: string;
}
interface ExcelData { nodes: ExcelNode[]; links: ExcelLink[]; }

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
    loadFromStorage();
    if (!model.nodes.length) loadExample();

    canvas.addEventListener("dblclick", onCanvasDblClick);
    window.addEventListener("keydown", onGlobalKey);
    window.addEventListener("resize", render);

    wireExcelWatchers();

    // Crochet de test (utilisé pour la vérification hors Electron)
    (window as any).__sankeyTest = {
        reconcile: (data: ExcelData) => reconcileFromExcel(data),
        setSynced: () => markAllSynced(),
        model: () => model,
        refresh: () => { render(); buildSidebar(); },
        setDirty: (v: boolean) => { dirtySinceSync = v; },
        wireWatchers: () => wireExcelWatchers()
    };

    dirtySinceSync = false; // le chargement initial n'est pas une « modification »
    render();
    buildSidebar();
}

/* --------------------------- barre d'outils ------------------------ */

function buildToolbar(): void {
    toolbar.innerHTML = "";
    toolbar.appendChild(btn("＋ Nœud", () => addNode()));

    const moveBtn = btn("✋ Déplacer", () => setMode("move"));
    const linkBtn = btn("↳ Lier", () => setMode("link"));
    moveBtn.dataset.role = "move";
    linkBtn.dataset.role = "link";
    toolbar.appendChild(moveBtn);
    toolbar.appendChild(linkBtn);

    toolbar.appendChild(sep());

    const editBtn = btn("✎ Édition", () => setView("edit"));
    const prevBtn = btn("▦ Aperçu", () => setView("preview"));
    editBtn.dataset.role = "edit";
    prevBtn.dataset.role = "preview";
    toolbar.appendChild(editBtn);
    toolbar.appendChild(prevBtn);

    toolbar.appendChild(sep());
    toolbar.appendChild(btn("Exemple", () => { loadExample(); render(); buildSidebar(); }));
    const saveBtn = btn("Enregistrer", () => saveProject());
    saveBtn.title = "Écrase le fichier projet ouvert (Cmd+S)";
    toolbar.appendChild(saveBtn);
    toolbar.appendChild(btn("Enregistrer sous…", () => saveProject(true)));
    toolbar.appendChild(btn("Ouvrir", openProject));

    toolbar.appendChild(sep());
    const pngBtn = btn("⇩ PNG", () => exportImage("png"));
    pngBtn.title = "Exporter le Sankey en image PNG";
    toolbar.appendChild(pngBtn);
    const svgBtn = btn("⇩ SVG", () => exportImage("svg"));
    svgBtn.title = "Exporter le Sankey en SVG vectoriel";
    toolbar.appendChild(svgBtn);

    updateToolbarState();
}

function updateToolbarState(): void {
    toolbar.querySelectorAll("button[data-role]").forEach(b => {
        const r = (b as HTMLElement).dataset.role;
        const active = r === mode || r === view;
        b.classList.toggle("active", active);
    });
}

function setMode(m: Mode): void {
    mode = m;
    linkSourceId = null;
    updateToolbarState();
    setStatus(m === "link" ? "Mode lien : clique un nœud d'origine puis un nœud de destination." : "");
    render();
}

function setView(v: View): void {
    view = v;
    updateToolbarState();
    render();
}

/* ----------------------------- modèle ------------------------------ */

function newId(prefix: string): string {
    return `${prefix}${idCounter++}`;
}

/** Filière par défaut d'un nouveau nœud (celle du nœud sélectionné). */
function currentFiliereForNew(): string {
    if (selection.type === "node") {
        const n = nodeById(selection.id);
        if (n) return n.filiere || "";
    }
    return "";
}

function addNode(column?: number, rank?: number): void {
    snapshot();
    // Colonne : donnée (double-clic) sinon colonne du nœud de référence + 1
    if (column === undefined) {
        const ref =
            selection.type === "node"
                ? nodeById(selection.id)
                : model.nodes[model.nodes.length - 1];
        column = ref ? ref.column + 1 : 1;
    }
    const n: FlowNode = {
        id: newId("n"),
        name: "Nouveau nœud",
        column,
        title: "",
        order: 0,
        filiere: currentFiliereForNew(),
        color: null,
        x: 0,
        y: 0
    };
    model.nodes.push(n);
    moveNodeToCell(n, column, rank ?? Number.MAX_SAFE_INTEGER);
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
        renderSankey(canvas, viewModel(), options, visW, visH);
        return;
    }

    // Mode édition : positions aimantées sur la grille (colonnes × ordre).
    wrap.style.overflow = "auto";
    layoutGrid();
    let maxX = visW, maxY = visH;
    viewNodes().forEach(n => {
        maxX = Math.max(maxX, n.x + NODE_W + 140); // marge pour le bouton +
        maxY = Math.max(maxY, n.y + NODE_H + 80);
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
    canvas.setAttribute("class", mode === "link" ? "mode-link" : "mode-move");
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
        const label = document.createElementNS(SVGNS, "text");
        label.setAttribute("class", "grid-col-label");
        label.setAttribute("x", String(gridX(c) + NODE_W / 2));
        label.setAttribute("y", "30");
        label.setAttribute("text-anchor", "middle");
        label.textContent = "Colonne " + c;
        gGrid.appendChild(label);
    }

    // Liens
    const gl = document.createElementNS(SVGNS, "g");
    canvas.appendChild(gl);
    viewLinks().forEach(l => {
        const s = nodeById(l.source);
        const t = nodeById(l.target);
        if (!s || !t) return;
        const d = linkPathD(s.x + NODE_W, s.y + NODE_H / 2, t.x, t.y + NODE_H / 2);

        const g = document.createElementNS(SVGNS, "g");
        g.setAttribute("class", "edit-link" + (selection.id === l.id ? " selected" : ""));

        const line = document.createElementNS(SVGNS, "path");
        line.setAttribute("class", "link-line");
        line.setAttribute("d", d);
        line.setAttribute("stroke", l.colorOverride || s.color || "#9aa7b4"); // couleur du nœud d'origine
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
        let cls = "edit-node";
        if (selection.type === "node" && selection.id === n.id) cls += " selected";
        if (linkSourceId === n.id) cls += " pending";
        g.setAttribute("class", cls);

        const rect = document.createElementNS(SVGNS, "rect");
        rect.setAttribute("class", "node-box");
        rect.setAttribute("width", String(NODE_W));
        rect.setAttribute("height", String(NODE_H));
        rect.setAttribute("rx", "6");
        g.appendChild(rect);

        const badge = document.createElementNS(SVGNS, "text");
        badge.setAttribute("class", "node-badge");
        badge.setAttribute("x", "8");
        badge.setAttribute("y", "13");
        badge.textContent = `col ${n.column}`;
        g.appendChild(badge);

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
        label.setAttribute("y", "27");
        label.setAttribute("text-anchor", "middle");
        label.textContent = truncate(n.name, 18);
        g.appendChild(label);

        g.addEventListener("mousedown", e => onNodeMouseDown(e, n));
        g.addEventListener("click", e => onNodeClick(e, n));
        g.addEventListener("dblclick", e => {
            e.stopPropagation();
            if (view === "edit" && mode === "move") editNodeName(n);
        });
        gn.appendChild(g);
        nodeEls.set(n.id, g);
    });

    // Bouton « + » à droite du nœud sélectionné : ajoute un nœud lié.
    if (selection.type === "node") {
        const n = nodeById(selection.id);
        if (n) gn.appendChild(plusHandle(n));
    }
}

function plusHandle(src: FlowNode): SVGGElement {
    const cx = src.x + NODE_W + 18;
    const cy = src.y + NODE_H / 2;
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "plus-handle");

    const connector = document.createElementNS(SVGNS, "line");
    connector.setAttribute("x1", String(src.x + NODE_W));
    connector.setAttribute("y1", String(cy));
    connector.setAttribute("x2", String(cx - 11));
    connector.setAttribute("y2", String(cy));
    connector.setAttribute("stroke", "#2b6cff");
    connector.setAttribute("stroke-width", "1.5");
    connector.setAttribute("stroke-dasharray", "3 2");
    g.appendChild(connector);

    const circle = document.createElementNS(SVGNS, "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", "11");
    circle.setAttribute("fill", "#2b6cff");
    g.appendChild(circle);

    // Le « + » dessiné avec deux traits -> parfaitement centré.
    const hLine = document.createElementNS(SVGNS, "line");
    hLine.setAttribute("x1", String(cx - 5));
    hLine.setAttribute("y1", String(cy));
    hLine.setAttribute("x2", String(cx + 5));
    hLine.setAttribute("y2", String(cy));
    hLine.setAttribute("stroke", "#fff");
    hLine.setAttribute("stroke-width", "2");
    hLine.setAttribute("stroke-linecap", "round");
    g.appendChild(hLine);

    const vLine = document.createElementNS(SVGNS, "line");
    vLine.setAttribute("x1", String(cx));
    vLine.setAttribute("y1", String(cy - 5));
    vLine.setAttribute("x2", String(cx));
    vLine.setAttribute("y2", String(cy + 5));
    vLine.setAttribute("stroke", "#fff");
    vLine.setAttribute("stroke-width", "2");
    vLine.setAttribute("stroke-linecap", "round");
    g.appendChild(vLine);

    const hit = document.createElementNS(SVGNS, "circle");
    hit.setAttribute("cx", String(cx));
    hit.setAttribute("cy", String(cy));
    hit.setAttribute("r", "16");
    hit.setAttribute("fill", "transparent");
    g.appendChild(hit);

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
    lastRank: number;
    disp: Map<string, { x: number; y: number }>; // positions affichées (animées)
    raf: number;
}
let dragState: DragState | null = null;

function onNodeMouseDown(e: MouseEvent, n: FlowNode): void {
    if (mode !== "move" || view !== "edit") return;
    e.preventDefault();
    const pt = toCanvas(e);
    dragState = {
        id: n.id,
        dx: pt.x - n.x,
        dy: pt.y - n.y,
        moved: false,
        freeX: n.x,
        freeY: n.y,
        lastCol: n.column,
        lastRank: currentRank(n),
        disp: new Map(),
        raf: 0
    };
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
}

function currentRank(n: FlowNode): number {
    return viewNodes()
        .filter(x => x.column === n.column)
        .sort((a, b) => a.order - b.order)
        .indexOf(n);
}

function onDragMove(e: MouseEvent): void {
    if (!dragState) return;
    const ds = dragState;
    const n = nodeById(ds.id);
    if (!n) return;
    if (!ds.moved) {
        snapshot(); // capture l'état avant déplacement
        ds.moved = true;
        // Positions affichées initiales = grille actuelle
        layoutGrid();
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
    const rank = Math.max(0, Math.round((ds.freeY - GRID_Y) / ROW_H));
    if (column !== ds.lastCol || rank !== ds.lastRank) {
        moveNodeToCell(n, column, rank);
        layoutGrid(); // met à jour les cibles ; l'animation fait glisser les autres nœuds
        ds.lastCol = column;
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
        if (!s || !t) return;
        const d = linkPathD(s.x + NODE_W, s.y + NODE_H / 2, t.x, t.y + NODE_H / 2);
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
    if (mode === "link") {
        if (!linkSourceId) {
            linkSourceId = n.id;
            setStatus(`Origine : « ${n.name} ». Clique maintenant la destination.`);
            render();
        } else {
            addLink(linkSourceId, n.id);
            linkSourceId = null;
            setStatus("Mode lien : clique un nœud d'origine puis un nœud de destination.");
        }
        return;
    }
    if (dragState && dragState.moved) return;
    select("node", n.id);
}

function onCanvasDblClick(e: MouseEvent): void {
    if (view !== "edit" || mode !== "move") return;
    if ((e.target as Element).tagName !== "svg") return;
    const pt = toCanvas(e);
    const column = Math.max(1, Math.round((pt.x - GRID_X) / COL_W) + 1);
    const rank = Math.max(0, Math.round((pt.y - GRID_Y) / ROW_H));
    addNode(column, rank);
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
        linkSourceId = null;
        render();
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
        filiere: src.filiere || "",
        color: null,
        x: 0,
        y: 0
    };
    model.nodes.push(n);
    moveNodeToCell(n, column, Number.MAX_SAFE_INTEGER);
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
    input.style.height = NODE_H + "px";
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

function toCanvas(e: MouseEvent): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/* --------------------------- panneau latéral ----------------------- */

function buildSidebar(): void {
    sidebar.innerHTML = "";

    sidebar.appendChild(buildExcelPanel());

    const fp = buildFilierePanel();
    if (fp) sidebar.appendChild(fp);

    // Section élément sélectionné
    if (selection.type === "node") {
        const n = nodeById(selection.id);
        if (n) {
            const s = section("Nœud sélectionné");
            s.appendChild(textField("Nom", n.name, v => { n.name = v; render(); persist(); }));
            s.appendChild(numberField("Colonne", n.column, v => { n.column = Math.max(1, Math.round(v)); render(); persist(); }));
            s.appendChild(numberField("Ordre vertical", n.order, v => { n.order = v; render(); persist(); }));
            s.appendChild(textField("Intitulé de colonne", n.title, v => { n.title = v; render(); persist(); }));
            s.appendChild(textField("Filière", n.filiere || "", v => { n.filiere = v; render(); buildSidebar(); persist(); }));
            s.appendChild(colorField("Couleur", n.color || options.nodes.nodeColor, v => { n.color = v; render(); persist(); }));
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

function buildExcelPanel(): HTMLElement {
    const s = section("Synchronisation Excel");
    const d = desktop();
    if (!d || !d.isElectron) {
        const p = document.createElement("p");
        p.className = "hint";
        p.textContent = "Disponible uniquement dans l'application de bureau.";
        s.appendChild(p);
        return s;
    }

    const fileBox = document.createElement("div");
    fileBox.className = "excel-file" + (excelPath ? "" : " none");
    if (excelPath) {
        const name = document.createElement("div");
        name.className = "excel-name";
        name.textContent = basename(excelPath);
        name.title = excelPath;
        const sub = document.createElement("div");
        sub.className = "excel-sub";
        sub.textContent = "Classeur connecté";
        fileBox.appendChild(name);
        fileBox.appendChild(sub);
    } else {
        fileBox.textContent = "Aucun classeur connecté.";
    }
    s.appendChild(fileBox);

    s.appendChild(wideBtn(
        "📂  Ouvrir un classeur existant…",
        "Ouvrir un .xlsx existant et charger son diagramme",
        connectExistingExcel
    ));
    s.appendChild(wideBtn(
        "✦  Nouveau classeur…",
        "Créer un nouveau .xlsx et y écrire le diagramme actuel",
        connectExcel
    ));

    if (excelPath) {
        s.appendChild(wideBtn(
            "⬆︎  App → Excel",
            "Écrire la structure de l'app dans Excel (les valeurs saisies dans Excel sont conservées)",
            pushToExcel
        ));
        s.appendChild(wideBtn(
            "⬇︎  Excel → App",
            "Remplacer le diagramme de l'app par le contenu du classeur Excel",
            () => pullExcel(true)
        ));
        if (dirtySinceSync) {
            const warn = document.createElement("p");
            warn.className = "hint warn";
            warn.textContent = "Modifications locales non écrites vers Excel.";
            s.appendChild(warn);
        }
        const dis = document.createElement("button");
        dis.className = "linklike";
        dis.textContent = "Dissocier";
        dis.addEventListener("click", disconnectExcel);
        s.appendChild(dis);
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
    ["Segoe UI, system-ui, -apple-system, Helvetica, Arial, sans-serif", "Segoe UI"],
    ["Arial, sans-serif", "Arial"],
    ["Helvetica, Arial, sans-serif", "Helvetica"],
    ["Verdana, sans-serif", "Verdana"],
    ["Tahoma, sans-serif", "Tahoma"],
    ["Georgia, serif", "Georgia"],
    ["\"Times New Roman\", Times, serif", "Times New Roman"],
    ["\"Courier New\", monospace", "Courier New"]
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
    const row = document.createElement("div");
    row.className = "check-row";
    row.appendChild(checkField("Gras", o.bold, v => { o.bold = v; rr(); }));
    row.appendChild(checkField("Italique", o.italic, v => { o.italic = v; rr(); }));
    parent.appendChild(row);
}

function buildAppearance(): DocumentFragment {
    const frag = document.createDocumentFragment();
    const rr = () => { render(); persist(); };

    // ---- Liens ----
    {
        const b = card("Liens", true);
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
        b.appendChild(checkField("Bordure", options.links.showBorder,
            v => { options.links.showBorder = v; rr(); }));
        b.appendChild(colorField("Couleur de bordure", options.links.borderColor,
            v => { options.links.borderColor = v; rr(); }));
        b.appendChild(numberField("Épaisseur de bordure", options.links.borderWidth,
            v => { options.links.borderWidth = v; rr(); }));
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
        frag.appendChild(b.parentElement as HTMLElement);
    }

    // ---- Étiquettes des nœuds ----
    {
        const b = card("Étiquettes des nœuds", false);
        const nl = options.nodeLabels;
        b.appendChild(checkField("Afficher", nl.show, v => { nl.show = v; rr(); }));
        b.appendChild(selectField("Position", nl.position,
            [["cote", "À côté"], ["dessous", "En dessous"]],
            v => { nl.position = v as any; rr(); }));
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
function card(title: string, open: boolean): HTMLElement {
    const details = document.createElement("details");
    details.className = "panel card-collapsible";
    if (open) details.open = true;
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
function field(label: string, control: HTMLElement): HTMLElement {
    const w = document.createElement("label");
    w.className = "field";
    const span = document.createElement("span");
    span.textContent = label;
    w.appendChild(span);
    w.appendChild(control);
    return w;
}
function textField(label: string, value: string, onChange: (v: string) => void): HTMLElement {
    const i = document.createElement("input");
    i.type = "text";
    i.value = value;
    i.addEventListener("input", () => onChange(i.value));
    return field(label, i);
}
function numberField(label: string, value: number, onChange: (v: number) => void): HTMLElement {
    const i = document.createElement("input");
    i.type = "number";
    i.value = String(value);
    i.addEventListener("input", () => { const n = parseFloat(i.value); if (!isNaN(n)) onChange(n); });
    return field(label, i);
}
/* Palette du design system : versions claires + foncées de chaque couleur. */
const DESIGN_COLORS: { name: string; light: string; dark: string }[] = [
    { name: "wheat", light: "#ffe141", dark: "#9e8c28" },
    { name: "peach", light: "#fdbd5d", dark: "#9d753a" },
    { name: "buckwheat", light: "#f18831", dark: "#95541e" },
    { name: "horse", light: "#b29654", dark: "#6e5d34" },
    { name: "concrete", light: "#6e7777", dark: "#444a4a" },
    { name: "pig", light: "#e794be", dark: "#8f5c76" },
    { name: "apple", light: "#e9465b", dark: "#902b38" },
    { name: "beef", light: "#ae3c4c", dark: "#6c252f" },
    { name: "oak", light: "#b97b79", dark: "#734c4b" },
    { name: "eggplant", light: "#a563a5", dark: "#663d66" },
    { name: "wine", light: "#7159a3", dark: "#463765" },
    { name: "fish", light: "#0074bd", dark: "#004875" },
    { name: "milk", light: "#00ace7", dark: "#006b8f" },
    { name: "algae", light: "#2dc5bd", dark: "#1c7a75" },
    { name: "forest", light: "#079264", dark: "#045b3e" },
    { name: "mint", light: "#7ddd8b", dark: "#4e8956" },
    { name: "field", light: "#adcb47", dark: "#6b7e2c" }
];
let paletteOpen = false; // état partagé : la palette reste ouverte d'un champ à l'autre

function colorField(label: string, value: string, onChange: (v: string) => void): HTMLElement {
    const box = document.createElement("div");

    const wrap = document.createElement("div");
    wrap.className = "color-wrap";
    const c = document.createElement("input");
    c.type = "color";
    c.value = toHex(value);
    const t = document.createElement("input");
    t.type = "text";
    t.value = value;
    c.addEventListener("input", () => { t.value = c.value; onChange(c.value); });
    t.addEventListener("input", () => { c.value = toHex(t.value); onChange(t.value); });
    wrap.appendChild(c);
    wrap.appendChild(t);

    // Grille des couleurs du design system (paires claire/foncée)
    const grid = document.createElement("div");
    grid.className = "swatch-grid";
    grid.hidden = !paletteOpen;
    const swatches: HTMLButtonElement[] = [];
    const refreshSelected = () => {
        const cur = toHex(t.value).toLowerCase();
        swatches.forEach(sw => sw.classList.toggle("selected", sw.dataset.hex === cur));
    };
    const mkSwatch = (hex: string, title: string): HTMLButtonElement => {
        const sw = document.createElement("button");
        sw.type = "button";
        sw.className = "swatch";
        sw.dataset.hex = hex.toLowerCase();
        sw.title = title;
        sw.style.background = hex;
        sw.addEventListener("click", () => {
            snapshot();
            c.value = hex;
            t.value = hex;
            onChange(hex);
            refreshSelected();
        });
        swatches.push(sw);
        return sw;
    };
    DESIGN_COLORS.forEach(dc => {
        const pair = document.createElement("div");
        pair.className = "swatch-pair";
        pair.appendChild(mkSwatch(dc.light, `${dc.name} (claire)`));
        pair.appendChild(mkSwatch(dc.dark, `${dc.name} (foncée)`));
        grid.appendChild(pair);
    });
    refreshSelected();

    const pal = document.createElement("button");
    pal.type = "button";
    pal.className = "pal-toggle";
    pal.title = "Palette du design system";
    pal.textContent = "▦";
    pal.classList.toggle("active", paletteOpen);
    pal.addEventListener("click", () => {
        paletteOpen = !paletteOpen;
        grid.hidden = !paletteOpen;
        pal.classList.toggle("active", paletteOpen);
    });
    wrap.appendChild(pal);

    box.appendChild(wrap);
    box.appendChild(grid);
    return field(label, box);
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
    // Snapshot avant la 1re modification d'un champ (permet l'annulation Cmd+Z)
    container.querySelectorAll("input, select").forEach(el => {
        el.addEventListener("focus", () => snapshot());
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
    return named[c.toLowerCase()] || "#8c9bab";
}

/* --------------------------- persistance --------------------------- */

interface ProjectFile {
    version: number;
    model: FlowModel;
    options: SankeyOptions;
    idCounter: number;
    excelPath?: string | null;
    hiddenFilieres?: string[];
}

function serialize(): string {
    const p: ProjectFile = {
        version: 1, model, options, idCounter, excelPath,
        hiddenFilieres: Array.from(hiddenFilieres)
    };
    return JSON.stringify(p, null, 2);
}
function applyProject(p: ProjectFile): void {
    model = p.model;
    // Compat : garantit le champ filiere sur les anciens projets
    model.nodes.forEach(n => { if (n.filiere === undefined) n.filiere = ""; });
    options = Object.assign(defaultOptions(), p.options);
    idCounter = p.idCounter || guessCounter();
    excelPath = p.excelPath || null;
    hiddenFilieres = new Set(p.hiddenFilieres || []);
    selection = { type: null, id: "" };
}
function guessCounter(): number {
    const ids = [...model.nodes.map(n => n.id), ...model.links.map(l => l.id)];
    let max = 0;
    ids.forEach(id => { const m = id.match(/\d+/); if (m) max = Math.max(max, +m[0]); });
    return max + 1;
}
function persist(): void {
    dirtySinceSync = true; // toute modification rend l'app « en avance » sur Excel
    try {
        localStorage.setItem("sankey-project", serialize());
        if (projectPath) localStorage.setItem("sankey-project-path", projectPath);
    } catch { /* ignore */ }
}
function loadFromStorage(): void {
    try {
        const raw = localStorage.getItem("sankey-project");
        if (raw) applyProject(JSON.parse(raw));
        // Se souvient du fichier projet ouvert (écrasé sans confirmation ensuite)
        projectPath = localStorage.getItem("sankey-project-path") || null;
    } catch { /* ignore */ }
}

async function saveProject(forceDialog?: boolean): Promise<void> {
    const json = serialize();
    const d = (window as any).desktop;
    if (d && d.isElectron) {
        // Sans forceDialog : réécrit le fichier ouvert sans rien demander.
        const r = await d.saveProject(json, forceDialog ? null : projectPath);
        if (!r.canceled) {
            projectPath = r.path;
            try { localStorage.setItem("sankey-project-path", projectPath as string); } catch { /* ignore */ }
            setStatus("Projet enregistré : " + basename(projectPath as string));
        }
    } else {
        const blob = new Blob([json], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "diagramme.sankey";
        a.click();
    }
}
async function openProject(): Promise<void> {
    const d = (window as any).desktop;
    if (d && d.isElectron) {
        const r = await d.openProject();
        if (!r.canceled) {
            applyProject(JSON.parse(r.content));
            projectPath = r.path;
            try { localStorage.setItem("sankey-project-path", projectPath as string); } catch { /* ignore */ }
            if (excelPath) d.watchExcel(excelPath);
            dirtySinceSync = false;
            render();
            buildSidebar();
        }
    } else {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".sankey,.json";
        input.onchange = () => {
            const f = input.files?.[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => {
                applyProject(JSON.parse(String(reader.result)));
                render();
                buildSidebar();
            };
            reader.readAsText(f);
        };
        input.click();
    }
}

/* ------------------------------ Export ----------------------------- */

async function exportImage(format: "png" | "svg"): Promise<void> {
    const wrap = canvas.parentElement as HTMLElement;
    const w = Math.max(1280, Math.round(wrap.clientWidth));
    const h = Math.max(720, Math.round(wrap.clientHeight));

    // Rend le Sankey (vue filtrée) dans un SVG hors écran.
    const tmp = document.createElementNS(SVGNS, "svg") as SVGSVGElement;
    tmp.setAttribute("xmlns", SVGNS);
    renderSankey(tmp, viewModel(), options, w, h);
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

async function saveExport(name: string, mime: string, data: string, binary: boolean): Promise<void> {
    const d = desktop();
    if (d && d.isElectron && d.exportSave) {
        const r = await d.exportSave(name, data, binary);
        if (r && r.ok) setStatus("Exporté : " + basename(r.path));
        else if (r && !r.canceled) setStatus("Échec de l'export.");
        return;
    }
    // Repli navigateur : téléchargement
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

function wireExcelWatchers(): void {
    const d = desktop();
    if (!d || !d.isElectron) return;
    if (excelPath) d.watchExcel(excelPath);
    d.onExcelChanged(() => onExcelFileChanged());
    d.onExcelLock((p: { locked: boolean }) => {
        if (!p.locked && pendingExcelWrite) {
            pendingExcelWrite = false;
            setStatus("Excel fermé — écriture des modifications en attente…");
            pushToExcel();
        } else if (p.locked) {
            setStatus("Excel a le classeur ouvert.");
        }
    });
}

function basename(p: string): string {
    return p.split(/[\\/]/).pop() || p;
}

/** Crée / connecte un NOUVEAU classeur (l'app y écrit sa structure). */
async function connectExcel(): Promise<boolean> {
    const d = desktop();
    if (!d || !d.isElectron) {
        setStatus("Disponible uniquement dans l'application de bureau.");
        return false;
    }
    const r = await d.chooseExcel();
    if (r.canceled) return false;
    const chosen: string = r.path;
    excelPath = chosen;
    persist();
    d.watchExcel(chosen);
    buildSidebar();
    setStatus("Classeur connecté : " + basename(chosen));
    return true;
}

/** Ouvre un classeur EXISTANT et charge son diagramme dans l'app. */
async function connectExistingExcel(): Promise<void> {
    const d = desktop();
    if (!d || !d.isElectron) {
        setStatus("Disponible uniquement dans l'application de bureau.");
        return;
    }
    const r = await d.openExistingExcel();
    if (r.canceled) return;
    if (
        model.nodes.length &&
        !confirm(
            "Ouvrir ce classeur va remplacer le diagramme actuel par son contenu.\n\nContinuer ?"
        )
    ) {
        return;
    }
    const chosen: string = r.path;
    // Repart de zéro pour un chargement propre du contenu Excel.
    model = { nodes: [], links: [] };
    syncedNodeIds = new Set();
    syncedLinkIds = new Set();
    selection = { type: null, id: "" };
    excelPath = chosen;

    const read = await d.readExcel(chosen);
    if (read.ok && read.data) {
        reconcileFromExcel(read.data);
        markAllSynced();
    }
    d.watchExcel(chosen);
    dirtySinceSync = false;
    render();
    buildSidebar();
    persist();
    dirtySinceSync = false;
    setStatus("Classeur chargé : " + basename(chosen));
}

function disconnectExcel(): void {
    excelPath = null;
    persist();
    buildSidebar();
    setStatus("Classeur Excel dissocié.");
}

/** Sens App → Excel : écrit la structure de l'app (valeurs Excel conservées). */
async function pushToExcel(): Promise<void> {
    const d = desktop();
    if (!d || !d.isElectron) return;
    if (!excelPath && !(await connectExcel())) return;

    // Conserve les valeurs déjà saisies dans Excel pour les liens existants
    const rd = await d.readExcel(excelPath);
    if (rd.ok && rd.data) mergeValuesFromExcel(rd.data);

    const res = await d.writeExcel({ nodes: model.nodes, links: model.links }, excelPath);
    if (res.ok) {
        pendingExcelWrite = false;
        markAllSynced();
        dirtySinceSync = false;
        render();
        buildSidebar();
        persist();
        dirtySinceSync = false;
        setStatus("Écrit vers Excel : " + basename(res.path));
    } else if (res.locked) {
        pendingExcelWrite = true;
        setStatus("Excel a le classeur ouvert — écriture différée jusqu'à sa fermeture.");
    } else {
        setStatus("Échec de l'écriture Excel : " + res.error);
    }
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
            excelNodeIds.add(id); newSyncedNodes.add(id);
        } else {
            if (!id) { id = newId("n"); assigned = true; }
            else { excelNodeIds.add(id); }
            const n: FlowNode = {
                id, name: E.name, column: E.column, title: E.title,
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
    return assigned;
}

/* ----------------------------- exemple ----------------------------- */

function loadExample(): void {
    idCounter = 1;
    const mk = (
        name: string, column: number, title: string, order: number,
        filiere: string, color: string, x: number, y: number
    ): FlowNode => ({ id: newId("n"), name, column, title, order, filiere, color, x, y });

    const nProd = mk("Production", 1, "Production", 0, "", "#e0503f", 40, 260);
    const nLait = mk("Lait", 2, "", 0, "", "#e79a3c", 230, 260);
    const nTrans = mk("Transformation", 3, "Transformation", 0, "", "#e79a3c", 420, 260);
    const nBeurre = mk("Beurre", 4, "", 0, "Matières grasses", "#e79a3c", 610, 120);
    const nCreme = mk("Crème", 4, "", 1, "Matières grasses", "#e79a3c", 610, 220);
    const nFromage = mk("Fromage", 4, "", 2, "Fromagerie", "#e79a3c", 610, 320);
    const nDist = mk("Distribution", 5, "Distribution", 0, "", "#3b46e0", 800, 260);
    const nExp = mk("Exportation de produits transformés", 6, "", 0, "", "#2aa02a", 990, 180);
    const nCons = mk("Consommation de produits laitiers", 6, "", 1, "", "#8a2be2", 990, 340);
    model.nodes = [nProd, nLait, nTrans, nBeurre, nCreme, nFromage, nDist, nExp, nCons];

    const link = (s: FlowNode, t: FlowNode, value: number): FlowLink =>
        ({ id: newId("l"), source: s.id, target: t.id, value, unit: "t" });
    model.links = [
        link(nProd, nLait, 5500000),
        link(nLait, nTrans, 5500000),
        link(nTrans, nBeurre, 92000),
        link(nTrans, nCreme, 497000),
        link(nTrans, nFromage, 652000),
        link(nBeurre, nDist, 92000),
        link(nCreme, nDist, 497000),
        link(nFromage, nDist, 652000),
        link(nDist, nExp, 500000),
        link(nDist, nCons, 741000)
    ];
    selection = { type: null, id: "" };
    persist();
}
