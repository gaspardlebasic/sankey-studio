// Éditeur graphique : création/déplacement de nœuds, tracé de liens,
// panneau de propriétés, et bascule Édition / Aperçu Sankey.

import {
    FlowModel, FlowNode, FlowLink, SankeyOptions, defaultOptions,
    NodeKind, NodeTypeStyle, NodeLabelPosition, NODE_KINDS, NODE_LABEL_POSITIONS,
    kindOf, defaultTypeStyle, TextStyle, texteAffiche, partBio, TailleExport,
    MultiplicateurValeur, MULTIPLICATEURS_VALEUR
} from "./types";
import {
    renderSankey, renderSankeyGroups, wrapText, policeDuType, positionDuType
} from "./engine";
import { openColorPopover, openMenuPopover, normalizeHex } from "./ui";

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
// Un lien qui saute une colonne y prend la place d'un nœud : c'est ce qui
// écarte les nœuds traversés et rend le passage lisible.
const PASSAGE_H = NODE_H;

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
 * réelles : les rangées ne sont plus régulières dès qu'un nom passe à la ligne,
 * et une escale prend la place d'un nœud sans occuper de rang.
 */
function rankAtY(column: number, lane: number, y: number, sauf?: FlowNode): number {
    let haut = laneBounds.get(lane)?.haut ?? GRID_Y;
    let rang = 0;
    for (const c of casesEmpilees(colonneTriee(column, lane, sauf), escalesDe(column, lane))) {
        if (c.noeud) {
            if (y < haut + c.haut / 2) return rang;
            rang++;
        }
        haut += c.haut + GAP_Y;
    }
    return rang;
}
function bandLeft(column: number): number {
    return gridX(column) - (COL_W - NODE_W) / 2;
}

/* ------- liens qui sautent une colonne : la place qu'ils s'y réservent -------

   Un lien A(col 1) -> C(col 3) traverse la colonne 2, où B l'attend : tracé tout
   droit, son trait passe SUR B et l'on ne voit plus rien. La parade est celle de
   l'aperçu (`planifierPassages` dans engine.ts) : le lien se réserve dans chaque
   colonne traversée la place d'un nœud — une escale — qui s'insère dans
   l'empilement et repousse les nœuds suivants vers le bas. Le trait franchit
   ensuite cette place de part en part, à découvert.

   L'escale se glisse là où le lien voulait passer : un lien qui longe le haut du
   diagramme continue de le longer, sans croisement inutile.
*/

/** Place réservée dans une colonne à un lien qui ne fait que la traverser. */
interface Escale {
    id: string; // identifiant du lien
    column: number;
    lane: number;
    rang: number; // rang intercalaire parmi les ordres des nœuds de la cellule
    y: number; // haut de la place, arrêté par la seconde passe de layoutGrid()
}

/** Escales en place, renseignées par layoutGrid(). Vide sans lien traversant. */
let escales: Escale[] = [];

function escalesDe(column: number, lane: number): Escale[] {
    return escales.filter(e => e.column === column && e.lane === lane);
}

/** Escales d'un lien, de la colonne la plus à gauche à la plus à droite. */
function escalesDuLien(id: string): Escale[] {
    return escales.filter(e => e.id === id).sort((a, b) => a.column - b.column);
}

/** Une place dans l'empilement d'une cellule : un nœud, ou l'escale d'un lien. */
interface CaseCellule {
    rang: number;
    haut: number;
    noeud?: FlowNode;
    escale?: Escale;
}

/**
 * Empilement d'une cellule (colonne × couloir) : ses nœuds dans l'ordre, et les
 * escales des liens qui la traversent, chacune à son rang intercalaire.
 */
function casesEmpilees(noeuds: FlowNode[], esc: Escale[]): CaseCellule[] {
    const cases: CaseCellule[] = noeuds
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(n => ({ rang: n.order, haut: nodeH(n), noeud: n }));
    esc.forEach(e => cases.push({ rang: e.rang, haut: PASSAGE_H, escale: e }));
    return cases.sort((a, b) => a.rang - b.rang);
}

/**
 * Place chaque nœud sur la grille : x = colonne, y = rang dans sa cellule.
 *
 * La grille a trois coordonnées : la colonne (x), le couloir (bande horizontale)
 * et le rang dans la cellule. Chaque couloir occupe une bande dont la hauteur est
 * celle de sa colonne la plus chargée, et les bandes s'empilent. Sans couloir
 * déclaré, il n'y en a qu'un : la mise en page est celle d'avant.
 *
 * DEUX PASSES, comme dans l'aperçu : la première donne la géométrie sans escale,
 * qui dit OÙ chaque lien traversant voudrait passer ; la seconde refait la mise
 * en page avec les places ainsi réservées. Sans lien traversant, la seconde
 * passe n'a pas lieu et le résultat est celui d'avant, au pixel près.
 */
function layoutGrid(): void {
    escales = [];
    placerNoeuds();
    if (options.links.traversee !== "direct") {
        escales = planifierEscales();
        if (escales.length) placerNoeuds();
    }
}

function placerNoeuds(): void {
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
        // Une colonne traversée peut n'avoir aucun nœud dans ce couloir : la
        // place réservée y compte quand même dans la hauteur de la bande.
        escales.filter(e => e.lane === lane).forEach(e => {
            if (!byCol.has(e.column)) byCol.set(e.column, []);
        });
        let hauteur = NODE_H;
        byCol.forEach((list, col) => {
            // Empilement cumulatif : chaque place pousse la suivante de sa hauteur.
            let yy = y;
            casesEmpilees(list, escalesDe(col, lane)).forEach(c => {
                if (c.noeud) {
                    c.noeud.x = gridX(col);
                    c.noeud.y = yy;
                } else if (c.escale) {
                    c.escale.y = yy;
                }
                yy += c.haut + GAP_Y;
            });
            hauteur = Math.max(hauteur, yy - GAP_Y - y);
        });
        laneBounds.set(lane, { haut: y, bas: y + hauteur });
        y += hauteur + LANE_GAP;
    }
}

/**
 * Décide, à partir d'une première mise en page, où chaque lien qui saute une
 * colonne s'y glisse : couloir, puis rang parmi les nœuds déjà là. Le repère est
 * l'ordonnée où le trait passerait s'il allait tout droit.
 */
function planifierEscales(): Escale[] {
    const lanes = couloirs();
    const plan: Escale[] = [];
    viewLinks().forEach(l => {
        const s = nodeById(l.source);
        const t = nodeById(l.target);
        if (!s || !t || t.column - s.column < 2) return;
        const xs = s.x + NODE_W;
        const xt = t.x;
        const ys = s.y + nodeH(s) / 2;
        const yt = t.y + nodeH(t) / 2;
        for (let col = s.column + 1; col < t.column; col++) {
            const x = gridX(col) + NODE_W / 2;
            const f = xt > xs ? Math.max(0, Math.min(1, (x - xs) / (xt - xs))) : 0.5;
            const yv = ys + (yt - ys) * f;
            const lane = couloirTraverse(laneOf(s), laneOf(t), yv, lanes);
            plan.push({ id: l.id, column: col, lane, rang: rangDansCellule(col, lane, yv), y: yv });
        }
    });
    return plan;
}

/**
 * Couloir où loger une escale : celui dont la bande est la plus proche de
 * l'ordonnée visée, parmi les couloirs situés ENTRE le départ et l'arrivée.
 */
function couloirTraverse(depart: number, arrivee: number, y: number, lanes: number[]): number {
    const min = Math.min(depart, arrivee);
    const max = Math.max(depart, arrivee);
    const candidats = lanes.filter(l => l >= min && l <= max);
    if (!candidats.length) return depart;
    let choisi = candidats[0];
    let meilleure = Infinity;
    candidats.forEach(l => {
        const b = laneBounds.get(l);
        if (!b) return;
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
 *
 * À ÉGALITÉ, l'escale passe DEVANT le nœud, qui descend d'un cran. La vue
 * d'édition est une grille : un lien qui traverse à la hauteur exacte d'un nœud
 * est le cas courant, pas l'exception, et l'arbitrage doit se voir — le lien
 * garde sa trajectoire, le nœud est repoussé vers le bas. (L'aperçu, lui, place
 * ses escales sur des ordonnées continues où l'égalité n'arrive pas.)
 */
function rangDansCellule(column: number, lane: number, y: number): number {
    const list = colonneTriee(column, lane);
    if (!list.length) return 0;
    const centre = (n: FlowNode) => n.y + nodeH(n) / 2;
    const i = list.findIndex(n => centre(n) >= y);
    if (i < 0) return list[list.length - 1].order + 1;
    if (i === 0) return list[0].order - 1;
    return (list[i - 1].order + list[i].order) / 2;
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
    /** Part du flux en bio / durable, de 0 à 1. */
    bio?: number;
}
interface ExcelData {
    nodes: ExcelNode[];
    links: ExcelLink[];
    /** Le classeur porte-t-il la colonne « Couloir » ? Sinon on garde les nôtres. */
    hasLane?: boolean;
    /** Idem pour la colonne « Type » : sans elle, on garde les types de l'app. */
    hasKind?: boolean;
    /** Idem pour « Part bio / durable » dans le tableau des liens. */
    hasBio?: boolean;
}

let canvas: SVGSVGElement;
let sidebar: HTMLElement;
let toolbar: HTMLElement;
let statusEl: HTMLElement;
/** Le bouton « resynchroniser » du ruban, gardé pour pouvoir le griser. */
let resyncEl: HTMLButtonElement | null = null;

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

    canvas.addEventListener("click", onApercuClick);
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

    // Ni « Enregistrer sous… » ni « Ouvrir » : il n'y a pas de fichier projet.
    // Le diagramme vit dans les tableaux, l'apparence dans le classeur (Cmd+S).

    // Les exports se rangent à droite du ruban.
    const spacer = document.createElement("span");
    spacer.className = "toolbar-spacer";
    toolbar.appendChild(spacer);

    // À gauche des exports : refaire la synchro avec le classeur.
    if (caps().excel) {
        resyncEl = resyncBtn(() => { resynchroniser(); });
        toolbar.appendChild(resyncEl);
    }

    // Les deux boutons ouvrent un menu plutôt que d'exporter tout de suite : la
    // taille de l'image se décide au moment de l'export, pas avant.
    const pngBtn = exportBtn("PNG", b => ouvrirMenuExport(b, "png"));
    pngBtn.title = "Exporter le Sankey en image PNG";
    toolbar.appendChild(pngBtn);
    const svgBtn = exportBtn("SVG", b => ouvrirMenuExport(b, "svg"));
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
        // TOUJOURS « Produit », quel que soit le chemin de création. Le nœud
        // reprenait le type du nœud sélectionné : enchaîner deux industries
        // créait alors une industrie qu'il fallait corriger, et la règle
        // (« ça dépend de ce qui était sélectionné ») était invisible depuis le
        // canevas. Un défaut unique se dit en un mot et se corrige en un clic.
        kind: "produit",
        filiere: currentFiliereForNew(),
        // Couleur par défaut du diagramme (#d4d4d4 tant qu'on ne l'a pas
        // changée) : « ＋ Nœud » ne part pas d'un nœud, il n'a rien à hériter.
        // Le « + » d'un nœud, lui, hérite — cf. addLinkedNode.
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
    // En édition, la sélection change le dessin (halo, points de liaison, « + »).
    // Dans l'aperçu, refaire le Sankey pour un simple clic serait cher pour
    // rien : seul le repère de sélection bouge, et il se pose sur place.
    if (view === "edit") render();
    else marquerSelectionApercu();
}

/* ----------------------------- rendu ------------------------------- */

function render(): void {
    const wrap = canvas.parentElement as HTMLElement;
    const visW = Math.max(1, wrap.clientWidth);
    const visH = Math.max(1, wrap.clientHeight);
    while (canvas.firstChild) canvas.removeChild(canvas.firstChild);

    canvas.classList.toggle("apercu", view === "preview");

    if (view === "preview") {
        wrap.style.overflow = "hidden";
        sizeCanvas(visW, visH);
        dessinerApercu(canvas, visW, visH);
        marquerSelectionApercu();
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
    // Une place réservée peut clore une colonne : elle compte dans la hauteur,
    // sans quoi le passage du dernier lien serait rogné par le bas du canevas.
    escales.forEach(e => {
        maxY = Math.max(maxY, e.y + PASSAGE_H + 80);
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
/**
 * Repère de sélection dans l'APERÇU.
 *
 * L'aperçu est peint par le moteur, qui ne sait rien de la sélection — et on ne
 * veut pas la lui apprendre : c'est lui qui fait aussi les exports, où un halo
 * n'a rien à faire. Le repère est donc posé APRÈS coup, sur le dessin en place,
 * et retiré de même. Il vit dans le groupe de l'étiquette, dont il partage le
 * système de coordonnées : rien à convertir.
 */
function marquerSelectionApercu(): void {
    canvas.querySelectorAll("." + CLASSE_HALO).forEach(el => el.remove());
    if (view !== "preview" || selection.type !== "node") return;
    const groupe = etiquetteApercu(selection.id);
    if (!groupe) return;                      // nœud masqué, ou étiquettes éteintes
    const b = groupe.getBBox();
    const halo = document.createElementNS(SVGNS, "rect");
    halo.setAttribute("class", CLASSE_HALO);
    halo.setAttribute("x", String(b.x - HALO_MARGE));
    halo.setAttribute("y", String(b.y - HALO_MARGE));
    halo.setAttribute("width", String(b.width + HALO_MARGE * 2));
    halo.setAttribute("height", String(b.height + HALO_MARGE * 2));
    halo.setAttribute("rx", "3");
    // Devant le fond de l'étiquette, derrière son texte : le nom reste net.
    groupe.insertBefore(halo, groupe.firstChild);
}

/** Groupe de l'étiquette d'un nœud dans l'aperçu, s'il est peint. */
function etiquetteApercu(id: string): SVGGraphicsElement | null {
    const groupes = canvas.querySelectorAll("g[data-label-for]");
    for (let i = 0; i < groupes.length; i++) {
        if (groupes[i].getAttribute("data-label-for") === id) {
            return groupes[i] as SVGGraphicsElement;
        }
    }
    return null;
}

function distinctFilieres(): string[] {
    const set = new Set<string>();
    model.nodes.forEach(n => set.add(n.filiere || ""));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/* Repère de la sélection dans l'aperçu : classe du halo et écart à l'étiquette. */
const CLASSE_HALO = "apercu-selection";
const HALO_MARGE = 3;

/* Registres des éléments SVG du mode édition (utilisés par l'animation du drag). */
let nodeEls = new Map<string, SVGGElement>();
let linkEls: { link: FlowLink; line: SVGPathElement; hit: SVGPathElement }[] = [];

/**
 * Tracé d'un lien, éventuellement dérouté par les places qu'il s'est réservées
 * dans les colonnes qu'il traverse (`via`). Sans escale, le tracé est celui
 * d'avant, caractère pour caractère.
 */
function linkPathD(
    x1: number, y1: number, x2: number, y2: number,
    via: { x: number; y: number }[] = []
): string {
    if (!via.length) {
        const mx = (x1 + x2) / 2;
        return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
    }
    // Une courbe jusqu'à l'entrée de la place réservée, la traversée en ligne
    // droite, et ainsi de suite : le franchissement se voit.
    const pts = [{ x: x1, y: y1 }, ...via, { x: x2, y: y2 }];
    let d = `M${x1},${y1}`;
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (a.y === b.y) {
            d += ` L${b.x},${b.y}`;
        } else {
            const mx = (a.x + b.x) / 2;
            d += ` C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
        }
    }
    return d;
}

/**
 * Points par lesquels passe un lien traversant : il franchit chaque place
 * réservée de part en part, sur toute la largeur qu'aurait eue un nœud.
 */
function pointsDePassage(l: FlowLink): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    escalesDuLien(l.id).forEach(e => {
        const y = e.y + PASSAGE_H / 2;
        pts.push({ x: gridX(e.column), y }, { x: gridX(e.column) + NODE_W, y });
    });
    return pts;
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
        const via = pointsDePassage(l);
        const d = linkPathD(s.x + NODE_W, s.y + nodeH(s) / 2, t.x, t.y + nodeH(t) / 2, via);

        const g = document.createElementNS(SVGNS, "g");
        g.setAttribute("class", "edit-link" + (selection.id === l.id ? " selected" : ""));

        const line = document.createElementNS(SVGNS, "path");
        line.setAttribute("class", "link-line");
        line.setAttribute("d", d);
        // Repères stables : c'est par eux que les tests mesurent le tracé peint.
        line.setAttribute("data-source", l.source);
        line.setAttribute("data-target", l.target);
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
        // Alt + glisser ne se voit pas : sans cette ligne, la duplication
        // n'existerait que pour qui la connaît déjà.
        rect.appendChild(svgTitle(
            "Glisser pour déplacer · Alt + glisser pour dupliquer · "
            + "Double-clic pour renommer"));
        g.appendChild(rect);

        g.appendChild(pastilleCouleur(n));

        const label = document.createElementNS(SVGNS, "text");
        label.setAttribute("class", "node-label");
        label.setAttribute("x", String(NODE_W / 2));
        label.setAttribute("text-anchor", "middle");
        /* La vue d'édition reprend la GRAISSE, l'ITALIQUE et la CASSE du type,
           pas sa taille : les boîtes sont ici de gabarit fixe (nodeH, wrapText à
           18 caractères) et une autre taille ferait déborder le texte. Les
           capitales, elles, ne changent rien à la découpe des lignes — elle se
           compte en signes — ni au nom du nœud, que le double-clic rouvre tel
           qu'il est écrit dans le classeur. */
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
            ts.textContent = texteAffiche(ligne, policeType);
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
 * Pastille de couleur du nœud : elle montre la couleur effective (celle de
 * l'aperçu) et l'ouvre au clic. Régler la couleur là où on la voit évite
 * l'aller-retour par le panneau, qui demandait de sélectionner le nœud puis de
 * retrouver le champ dans sa carte.
 */
function pastilleCouleur(n: FlowNode): SVGGElement {
    const cx = NODE_W - 11;
    const cy = 11;
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "node-color");

    // Zone de prise plus large que le rond : 5 px de rayon, ça ne s'attrape pas.
    // Elle reste dans la boîte, pour ne pas manger de clics du canevas.
    const hit = document.createElementNS(SVGNS, "circle");
    hit.setAttribute("class", "node-color-hit");
    hit.setAttribute("cx", String(cx));
    hit.setAttribute("cy", String(cy));
    hit.setAttribute("r", "10");
    hit.setAttribute("fill", "transparent");
    g.appendChild(hit);

    const dot = document.createElementNS(SVGNS, "circle");
    dot.setAttribute("class", "node-color-dot");
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", String(cy));
    dot.setAttribute("r", "5");
    dot.setAttribute("fill", couleurDuNoeud(n));
    g.appendChild(dot);

    g.appendChild(svgTitle("Cliquer pour changer la couleur du nœud"));

    // Le nœud écoute le mousedown pour se laisser déplacer : sans ce garde-fou,
    // un appui sur la pastille amorcerait un glisser.
    g.addEventListener("mousedown", e => { e.stopPropagation(); e.preventDefault(); });
    g.addEventListener("dblclick", e => e.stopPropagation());
    g.addEventListener("click", e => {
        e.stopPropagation(); // ne pas repasser par la sélection du nœud
        ouvrirCouleurDuNoeud(n);
    });
    return g;
}

/** Couleur effective d'un nœud : la sienne, ou celle par défaut du diagramme. */
function couleurDuNoeud(n: FlowNode): string {
    return n.color || options.nodes.nodeColor;
}

/** Ouvre la palette sur la pastille du nœud, en vue d'édition. */
function ouvrirCouleurDuNoeud(n: FlowNode): void {
    // Sélectionner reconstruit le canevas : c'est la NOUVELLE pastille qu'il
    // faut ancrer, celle d'où vient le clic vient d'être retirée du document.
    if (selection.type !== "node" || selection.id !== n.id) select("node", n.id);
    const ancre = nodeEls.get(n.id)?.querySelector(".node-color-dot");
    if (!ancre) return;
    const valeur = couleurDuNoeud(n);
    openColorPopover({
        anchor: ancre,
        placement: "libre",
        label: "Couleur",
        value: normalizeHex(valeur) || toHex(valeur),
        usedColors: couleursDuDocument(),
        onBeforeChange: () => { snapshot(); },
        onPick: v => {
            n.color = v;
            render();
            // Le champ « Couleur » du panneau montre la même couleur : le
            // laisser en arrière ferait douter de celle qui a pris.
            buildSidebar();
            persist();
        }
    });
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
    /** Alt était enfoncé : c'est une COPIE qu'on emporte (cf. onDragMove). */
    dupliquer: boolean;
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
        // Alt relevé ICI, à l'enfoncement : relâcher la touche en cours de
        // glisser ne doit pas transformer la copie en déplacement.
        dupliquer: e.altKey,
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
    let n = nodeById(ds.id);
    if (!n) return;
    if (!ds.moved) {
        snapshot();
        ds.moved = true;
        // Alt + glisser : c'est une copie qu'on emporte, l'original ne bouge
        // pas. La duplication attend le PREMIER MOUVEMENT — un Alt+clic sans
        // glisser ne doit rien créer — et vient après le `snapshot()` : une
        // seule annulation efface la copie et son déplacement d'un coup.
        if (ds.dupliquer) {
            n = dupliquerNoeud(n);
            ds.id = n.id;
            selection = { type: "node", id: n.id };
            // La copie n'a pas encore d'élément dans le canevas : sans ce
            // rendu, le glisser n'aurait rien à faire suivre à la souris.
            render();
            buildSidebar();
            ds.lastRank = currentRank(n);
            setStatus("Nœud dupliqué, avec ses liens.");
        }
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
        const d = linkPathD(
            s.x + NODE_W, s.y + nodeH(ns) / 2, t.x, t.y + nodeH(nt) / 2, pointsDePassage(link)
        );
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

/**
 * APERÇU : cliquer une étiquette sélectionne son nœud.
 *
 * C'est le libellé qu'on vise, pas la boîte : dans l'aperçu, la largeur d'un
 * nœud est propre à son type et vaut couramment zéro pixel (les rubans se
 * rejoignent alors sur l'axe de la colonne, sans nœud visible). Le nom, lui,
 * est toujours là. Le rectangle de nœud reste accepté quand il a une largeur —
 * c'est le même geste, et refuser le clic dessus serait une surprise.
 *
 * Un clic dans le vide désélectionne : sans quoi, l'aperçu n'offre aucun moyen
 * de refermer la carte du panneau.
 */
function onApercuClick(e: MouseEvent): void {
    if (view !== "preview") return;
    const cible = (e.target as Element).closest("g[data-label-for], rect[data-id]");
    const id = cible && (cible.getAttribute("data-label-for") || cible.getAttribute("data-id"));
    if (!id) { if (selection.type) select(null, ""); return; }
    if (!nodeById(id)) return;      // escale de traversée, ou nœud disparu du modèle
    select("node", id);
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
        kind: "produit",          // même défaut unique que « ＋ Nœud » (cf. addNode)
        filiere: src.filiere || "",
        // La couleur, elle, SE TRANSMET : le « + » prolonge une chaîne, et la
        // couleur du nœud d'origine est celle qu'on a sous les yeux au moment
        // du clic. Une couleur absente se recopie telle quelle : la suite du
        // fil suit alors la couleur par défaut, comme son origine.
        color: src.color,
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

/* --------------------------- duplication --------------------------- */

/**
 * Copie d'un nœud, **avec ses liens**.
 *
 * La copie se pose juste sous l'original, dans la même cellule : elle est là où
 * on l'a prise, et le glisser l'emmène ensuite où l'on veut. Elle reprend tout
 * du nœud d'origine (nom, type, couleur, filière, couloir) et se raccroche AUX
 * MÊMES nœuds : chaque lien de l'original est recopié dans son sens, avec sa
 * valeur, son unité et son apparence. Dupliquer une étape d'une filière, c'est
 * la reprendre telle qu'elle est branchée, pas repartir d'un nœud nu.
 */
function dupliquerNoeud(src: FlowNode): FlowNode {
    const copie: FlowNode = { ...src, id: newId("n") };
    model.nodes.push(copie);
    moveNodeToCell(copie, src.column, laneOf(src), currentRank(src) + 1);
    // La liste des liens à recopier est figée AVANT d'écrire dans `model.links` :
    // parcourir le tableau qu'on est en train d'allonger recopierait les copies.
    const aRecopier = model.links.filter(l => l.source === src.id || l.target === src.id);
    aRecopier.forEach(l => {
        model.links.push({
            ...l,
            id: newId("l"),
            source: l.source === src.id ? copie.id : l.source,
            target: l.target === src.id ? copie.id : l.target
        });
    });
    return copie;
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

/**
 * Repère STABLE d'un contrôle du panneau, qui survit à une reconstruction :
 * le titre de sa carte, son intitulé, et son rang parmi ses homonymes.
 *
 * Le titre de carte est indispensable : « Contour », « Largeur », « Police »
 * existent à l'identique dans « Produits / commodités » et dans
 * « Industries / étapes ». Le rang ne sert qu'en dernier recours.
 */
function repereDuControle(el: Element): string | null {
    const champ = el.closest(".field");
    if (!champ) return null;
    const carte = el.closest(".panel");
    const titre = carte
        ? (carte.querySelector("summary, h3")?.textContent || "").trim()
        : "";
    const intitule = (champ.querySelector("span")?.textContent || "").trim();
    const parents = carte ? carte.querySelectorAll(".field") : sidebar.querySelectorAll(".field");
    const memes = Array.prototype.slice.call(parents).filter(
        (f: Element) => (f.querySelector("span")?.textContent || "").trim() === intitule
    );
    return titre + " ‖ " + intitule + " ‖ " + memes.indexOf(champ as Element);
}

/** Le contrôle que désigne un repère, dans le panneau tel qu'il est maintenant. */
function controleDuRepere(repere: string): HTMLElement | null {
    const el = Array.prototype.slice.call(sidebar.querySelectorAll(".field"))
        .map((f: Element) => f.querySelector("input, select, textarea"))
        .find((c: Element | null) => c && repereDuControle(c) === repere);
    return (el as HTMLElement) || null;
}

/**
 * Reconstruit le panneau en entier — c'est ce que font tous les gestionnaires
 * de réglage, mais aussi l'écriture automatique vers Excel, 300 ms après la
 * dernière frappe. Vider `#sidebar` détruit donc le champ en cours de saisie,
 * et remet le défilement à zéro : le panneau sautait en haut et le curseur
 * quittait le champ, en plein milieu d'un mot.
 *
 * Deux choses sont donc relevées avant, et reposées après : la position du
 * défilement, et le champ qui avait le focus (avec son curseur). Le contenu a
 * la même hauteur et la même structure, tout retombe où c'était. Le navigateur
 * borne lui-même le défilement si le panneau a raccourci entre-temps.
 *
 * Ce n'est PAS une raison de reconstruire le panneau à chaque frappe : un
 * gestionnaire de saisie ne doit toujours pas appeler `buildSidebar()`
 * (cf. `textField`, dont l'`onCommit` attend la validation). Le filet est là
 * pour les reconstructions qui ne viennent pas du champ lui-même.
 */
function buildSidebar(): void {
    const defilement = sidebar.scrollTop;
    const actif = document.activeElement;
    const repere = actif && sidebar.contains(actif) ? repereDuControle(actif) : null;
    const curseur = saisieEnCours(actif)
        ? { debut: (actif as HTMLInputElement).selectionStart,
            fin: (actif as HTMLInputElement).selectionEnd }
        : null;
    sidebar.innerHTML = "";

    const ap = buildAlertePanel();
    if (ap) sidebar.appendChild(ap);

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
                "Couleur", couleurDuNoeud(n),
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
                // La part bio suit la valeur : même origine (le classeur), même
                // raison de ne pas être modifiable ici — nous n'écrivons jamais
                // sa colonne, une saisie faite là serait perdue sans le dire.
                s.appendChild(readonly(
                    "Part bio / durable", Math.round(partBio(l) * 100) + " %"));
                const vh = document.createElement("p");
                vh.className = "hint";
                vh.textContent = "La valeur et la part bio se saisissent dans Excel.";
                s.appendChild(vh);
            } else {
                s.appendChild(numberField("Valeur (provisoire)", l.value, v => { l.value = v; render(); persist(); }));
                s.appendChild(textField("Unité", l.unit || "", v => { l.unit = v; render(); persist(); }));
                s.appendChild(numberField("Part bio / durable (%)", Math.round(partBio(l) * 100),
                    v => { l.bio = Math.min(1, Math.max(0, v / 100)); render(); persist(); }));
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

    // Le focus d'abord, le défilement ensuite : `focus()` défile de lui-même
    // pour amener le champ en vue, et défairait la position qu'on vient de poser.
    if (repere) {
        const c = controleDuRepere(repere);
        if (c) {
            c.focus({ preventScroll: true });
            if (curseur && curseur.debut !== null && saisieEnCours(c)) {
                // Un `input[type=number]` refuse `setSelectionRange` : le curseur
                // y retombe en fin de champ, ce qui est le bon endroit pour un
                // nombre qu'on est en train de taper.
                try { (c as HTMLInputElement).setSelectionRange(curseur.debut, curseur.fin); }
                catch { /* champ qui n'expose pas de sélection */ }
            }
        }
    }
    sidebar.scrollTop = defilement;
}

/** Un champ où un curseur de texte a un sens (et donc une position à garder). */
function saisieEnCours(el: Element | null): boolean {
    if (!el || el.tagName !== "INPUT") return false;
    const t = (el as HTMLInputElement).type;
    return t === "text" || t === "number" || t === "search";
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
            // Le panneau se refait : « Cadre du graphique » porte les dimensions de
            // la combinaison de filières AFFICHÉES, qui vient de changer. Sans
            // ça elle montrerait encore celles de la combinaison précédente.
            buildSidebar();
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

/* ------------------- alerte « remplissage d'Excel » ------------------- */

/** Ce que l'adaptateur signale quand il défait une recopie d'Excel. */
interface Remplissage { formule: string; liens: number; aLEcriture?: boolean; }

/**
 * Le dernier remplissage d'Excel rencontré, tant que l'utilisatrice ne l'a pas
 * écarté. Il SURVIT aux reconstructions du panneau, et c'est tout l'enjeu :
 * l'écriture qui le découvre est le plus souvent automatique et silencieuse
 * (300 ms après une modification), et un message de la barre d'état serait
 * remplacé par le suivant avant d'avoir été lu.
 */
let alerteRemplissage: Remplissage | null = null;

/**
 * Recueille ce qu'une écriture a trouvé. Le complément ne peut pas rendre les
 * valeurs qu'Excel a écrasées — il peut seulement dire lesquelles, et à quoi
 * les reconnaître, tant qu'il est encore temps de restaurer une version.
 */
function signalerRemplissage(r: Remplissage | undefined): void {
    if (!r || !r.formule) return;
    const a = alerteRemplissage;
    // La même alerte deux fois de suite ne vaut pas une reconstruction du
    // panneau : l'utilisatrice est peut-être en train d'y saisir quelque chose.
    if (a && a.formule === r.formule && a.liens === r.liens) return;
    alerteRemplissage = r;
    buildSidebar();
    // La seule reconstruction qui doit défaire le défilement : l'alerte se pose
    // en haut du panneau, la garder hors champ reviendrait à ne pas l'afficher.
    sidebar.scrollTop = 0;
}

function buildAlertePanel(): HTMLElement | null {
    const a = alerteRemplissage;
    if (!a) return null;

    // Deux histoires, et il ne faut surtout pas les confondre. À l'ÉCRITURE,
    // Excel vient d'étendre la formule que nous posions sur un seul lien : les
    // valeurs viennent du modèle, elles ont été remises, rien n'est perdu — mais
    // la formule n'a pas pu rester. TROUVÉE dans le classeur, la recopie avait
    // déjà écrasé les valeurs : elles sont perdues, et seule une version
    // antérieure du classeur peut les rendre.
    if (a.aLEcriture) return buildAlerteRecopieVive(a);

    const s = section("⚠︎  Valeurs de flux écrasées par Excel");
    const p = document.createElement("p");
    p.className = "hint warn";
    p.textContent =
        `La formule ${a.formule} occupait ${a.liens} liens à l'identique dans la colonne `
        + "« Valeur du flux ». C'est la correction automatique d'Excel « Remplir les formules "
        + "dans les tableaux pour créer des colonnes calculées » : elle a recopié une formule "
        + "saisie sur un seul lien par-dessus les valeurs des autres. Ces valeurs-là sont "
        + "perdues dans ce classeur.";
    s.appendChild(p);
    s.appendChild(hint(
        "Le complément vient de retirer la recopie : la colonne ne se remplira plus toute seule. "
        + "Pour retrouver les valeurs, restaure une version du classeur antérieure à la recopie. "
        + "Pour que cela ne recommence pas, décoche dans Excel : Préférences ▸ Vérification ▸ "
        + "Options de correction automatique ▸ Mise en forme automatique au cours de la frappe ▸ "
        + "« Remplir les formules dans les tableaux pour créer des colonnes calculées »."
    ));
    s.appendChild(boutonLuEtMasque());
    return s;
}

/**
 * L'alerte de la recopie prise SUR LE FAIT : Excel a étendu à tous les liens la
 * formule que nous venions de poser sur un seul. Le complément a reposé les
 * valeurs — elles viennent du diagramme, aucune n'est perdue — et retiré la
 * formule, seule façon de faire abandonner à Excel sa colonne calculée.
 */
function buildAlerteRecopieVive(a: Remplissage): HTMLElement {
    const s = section("⚠︎  Excel recopie ta formule sur tous les liens");
    const p = document.createElement("p");
    p.className = "hint warn";
    p.textContent =
        `La formule ${a.formule} a été posée sur UN lien, et Excel l'a aussitôt étendue `
        + `à ${a.liens} liens de la colonne « Valeur du flux » : c'est sa « colonne calculée ». `
        + "Les valeurs ont été remises — elles viennent du diagramme, aucune n'est perdue — "
        + "mais la formule a dû être retirée : la garder, c'est la voir recopiée à chaque "
        + "écriture.";
    s.appendChild(p);
    s.appendChild(hint(
        "Pour pouvoir à nouveau saisir des formules dans cette colonne, décoche dans Excel : "
        + "Préférences ▸ Vérification ▸ Options de correction automatique ▸ Mise en forme "
        + "automatique au cours de la frappe ▸ « Remplir les formules dans les tableaux pour "
        + "créer des colonnes calculées ». En attendant, saisis des VALEURS dans "
        + "« Valeur du flux » (copier ▸ collage spécial ▸ valeurs)."
    ));
    s.appendChild(boutonLuEtMasque());
    return s;
}

/** Le bouton qui écarte l'alerte — la même dans les deux cas. */
function boutonLuEtMasque(): HTMLElement {
    const b = document.createElement("button");
    b.className = "linklike";
    b.textContent = "J'ai lu — masquer cet avertissement";
    b.addEventListener("click", () => { alerteRemplissage = null; buildSidebar(); });
    return b;
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

/**
 * Bloc de choix de police — **le même partout** où le choix se pose : police,
 * graisse, taille, couleur, puis les bascules de style [G] [i] [AA].
 *
 * Un seul bloc, donc un seul jeu d'options : les cartes des types de nœuds
 * offraient la graisse fine que les autres n'avaient pas, les autres offraient
 * les bascules que les types n'avaient pas. Tout le monde a maintenant les deux
 * — et les capitales, qui n'existaient nulle part.
 */
function fontControls(parent: HTMLElement, o: TextStyle, rr: () => void): void {
    parent.appendChild(selectField("Police", o.fontFamily, FONT_FAMILIES,
        v => { o.fontFamily = v; rr(); }));

    /* La graisse se règle de deux façons — la liste (quatre paliers) et la
       bascule [G] (le raccourci de Word). Ce sont deux vues du MÊME `weight` :
       chacune remet l'autre en accord, sinon la liste afficherait « Normale »
       sur un texte que [G] vient de mettre en gras. */
    let sel: HTMLSelectElement | null = null;
    const gras = toggleBtn("G", "Gras", "bold",
        () => o.weight >= 600,
        v => { o.weight = v ? 700 : 400; if (sel) sel.value = String(o.weight); },
        rr);
    const champGraisse = selectField("Graisse", String(o.weight), FONT_WEIGHTS, v => {
        o.weight = parseInt(v, 10);
        gras.sync();
        rr();
    });
    sel = champGraisse.querySelector("select");
    parent.appendChild(champGraisse);

    parent.appendChild(numberField("Taille", o.fontSize, v => { o.fontSize = v; rr(); }));
    parent.appendChild(colorField("Couleur du texte", o.fontColor, v => { o.fontColor = v; rr(); }));

    const group = document.createElement("div");
    group.className = "style-toggles";
    group.appendChild(gras);
    group.appendChild(toggleBtn("i", "Italique", "italic",
        () => o.italic, v => { o.italic = v; }, rr));
    group.appendChild(toggleBtn("AA", "Majuscules", "upper",
        () => o.uppercase, v => { o.uppercase = v; }, rr));
    parent.appendChild(field("Style", group));
}

/**
 * Bascule compacte du groupe « Style », comme dans Word. Elle porte son propre
 * `sync()` : la graisse ayant deux commandes, l'une doit pouvoir remettre
 * l'autre en accord sans reconstruire le panneau — ce qui ferait perdre le
 * focus et replier ce que l'utilisatrice vient d'ouvrir.
 */
type BasculeStyle = HTMLButtonElement & { sync: () => void };

function toggleBtn(
    label: string,
    title: string,
    cls: string,
    get: () => boolean,
    set: (v: boolean) => void,
    rr: () => void
): BasculeStyle {
    const b = document.createElement("button") as BasculeStyle;
    b.type = "button";
    b.className = "style-toggle " + cls;
    b.textContent = label;
    b.title = title;
    b.sync = () => {
        b.classList.toggle("active", get());
        b.setAttribute("aria-pressed", String(get()));
    };
    b.sync();
    b.addEventListener("click", () => {
        set(!get());
        b.sync();
        rr();
    });
    return b;
}

/**
 * Les cartes de réglages, dans l'ordre où l'on travaille : ce qu'on dessine
 * (les nœuds, puis les liens), l'espace qui les range (colonnes, couloirs,
 * filières empilées), et pour finir la page elle-même.
 *
 * Chaque carte est une fonction, et cette liste EST l'ordre du panneau : le
 * réordonner tient en une ligne déplacée, au lieu de trois cents lignes de
 * construction à faire glisser.
 */
function buildAppearance(): DocumentFragment {
    const frag = document.createDocumentFragment();
    const rr = () => { render(); persist(); };

    frag.appendChild(carteNoeuds(rr));
    NODE_KINDS.forEach(([kind]) => frag.appendChild(carteTypeDeNoeud(kind, rr)));
    frag.appendChild(carteLiens(rr));
    frag.appendChild(carteColonnes(rr));
    frag.appendChild(carteCouloirs(rr));
    frag.appendChild(carteFilieres(rr));
    frag.appendChild(carteCadre());

    return frag;
}

/* ---- Nœuds : la boîte ET son étiquette ----
   Les deux faisaient deux cartes. Elles réglaient pourtant un seul objet —
   on ne choisit pas la largeur d'un nœud sans regarder le nom qui va
   dessus — et l'aller-retour entre les deux cartes coûtait à chaque essai.
   Une seule carte, dans l'ordre où on la lit : la boîte, puis le nom. */
function carteNoeuds(rr: () => void): HTMLElement {
    const b = card("Nœuds", false);
    b.appendChild(colorField("Couleur par défaut", options.nodes.nodeColor,
        v => { options.nodes.nodeColor = v; rr(); }));
    b.appendChild(numberField("Largeur des nœuds", options.nodes.nodeWidth,
        v => { options.nodes.nodeWidth = v; rr(); }));
    b.appendChild(rangeField("Espacement vertical", options.nodes.nodePadding, 0, 60,
        v => { options.nodes.nodePadding = v; rr(); }));

    const nl = options.nodeLabels;
    b.appendChild(divider());
    b.appendChild(checkField("Afficher l'étiquette", nl.show, v => { nl.show = v; rr(); }));
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

    b.appendChild(divider());
    b.appendChild(hint(
        "Produits et industries peuvent avoir leur propre largeur, leur propre police, "
        + "leur propre position d'étiquette, leur propre contour et leur propre "
        + "mosaïque : voir les deux cartes qui suivent."
    ));
    return b.parentElement as HTMLElement;
}

/* ---- Une carte par type de nœud ----
   Une seule carte porterait deux fois les mêmes intitulés (« Largeur »,
   « Contour »…), impossibles à distinguer — pour l'utilisatrice comme pour
   les tests. Chaque type a donc sa carte, repliable indépendamment. */
function carteTypeDeNoeud(kind: NodeKind, rr: () => void): HTMLElement {
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
        + "de la carte « Nœuds » ; la cocher reprend la valeur en cours."
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
    if (t.font) fontControls(b, t.font, rr);

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

    /* Mosaïque : le nœud garde sa couleur, mais la porte en damier. */
    b.appendChild(divider());
    const mo = t.mosaique;
    b.appendChild(checkField("Mosaïque", mo.show, v => {
        mo.show = v; rr(); buildSidebar();
    }));
    if (mo.show) {
        b.appendChild(hint(
            "Un carré sur deux garde la couleur du nœud, l'autre est blanc. "
            + "Visible dans l'aperçu et les exports ; la vue d'édition, elle, "
            + "garde ses boîtes pleines."
        ));
        b.appendChild(numberField("Côté d'un carré", mo.taille,
            v => { mo.taille = Math.max(1, v); rr(); }));
    }
    return b.parentElement as HTMLElement;
}

/* ---- Liens : le ruban ET la valeur écrite dessus ----
   Même raison que pour « Nœuds » : l'épaisseur d'un ruban et le chiffre qui
   l'annonce se règlent d'un même regard. L'intertitre garde le groupe
   nommé — c'est ainsi qu'on le cherchait quand il faisait carte à part. */
function carteLiens(rr: () => void): HTMLElement {
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
    b.appendChild(checkField("Part bio / durable", options.links.bio.show,
        v => { options.links.bio.show = v; rr(); }));
    b.appendChild(colorField("Couleur du bio / durable", options.links.bio.color,
        v => { options.links.bio.color = v; rr(); }));
    b.appendChild(hint(
        "Un bandeau recouvre la part bio de chaque ruban, depuis son bord "
        + "supérieur. Elle se saisit dans le classeur, colonne « Part bio / "
        + "durable » du tableau des liens : 0,5 ou 50 pour la moitié du flux."
    ));

    b.appendChild(divider());
    b.appendChild(subhead("Valeurs des liens"));
    const vl = options.linkValueLabels;
    b.appendChild(checkField("Afficher", vl.show, x => { vl.show = x; rr(); }));
    b.appendChild(textField("Unité (si aucune dans les données)", vl.unitText,
        x => { vl.unitText = x; rr(); }));
    /* Le multiplicateur commande : dès qu'il agit, les valeurs s'écrivent
       arrondies et les chiffres significatifs n'ont plus d'effet. On retire
       alors le champ au lieu de le laisser répondre dans le vide — le panneau
       se reconstruit donc à ce changement-là. */
    b.appendChild(selectField("Multiplicateur de l'unité", vl.multiplicateur,
        MULTIPLICATEURS_VALEUR.map(([v, t]) => [v, t] as [string, string]),
        x => {
            vl.multiplicateur = x as MultiplicateurValeur;
            rr();
            buildSidebar();
        }));
    if (vl.multiplicateur === "aucun") {
        b.appendChild(numberField("Chiffres significatifs", vl.chiffresSignificatifs,
            x => { vl.chiffresSignificatifs = Math.min(15, Math.max(1, Math.round(x))); rr(); }));
    } else {
        b.appendChild(hint(
            "Les valeurs sont divisées par "
            + (vl.multiplicateur === "millions" ? "1 000 000" : "1 000")
            + " et écrites arrondies : le nombre de chiffres significatifs "
            + "n'a plus d'effet. À dire dans l'unité — « milliers de tonnes »."
        ));
    }
    fontControls(b, vl, rr);
    return b.parentElement as HTMLElement;
}

/* ---- Colonnes ----
   La colonne est le premier rangement d'un nœud ; ce qui se règle ici, c'est
   son entête. La carte se lit juste avant « Couloirs », l'autre coordonnée. */
function carteColonnes(rr: () => void): HTMLElement {
    const b = card("Colonnes", false);
    const h = options.columnHeaders;
    b.appendChild(checkField("Afficher", h.show, v => { h.show = v; rr(); }));
    fontControls(b, h, rr);
    b.appendChild(colorField("Couleur de fond", h.backgroundColor, v => { h.backgroundColor = v; rr(); }));
    b.appendChild(numberField("Marge au-dessus", h.marginTop, v => { h.marginTop = v; rr(); }));
    b.appendChild(numberField("Marge en dessous", h.marginBottom, v => { h.marginBottom = v; rr(); }));
    return b.parentElement as HTMLElement;
}

/* ---- Couloirs ---- */
function carteCouloirs(rr: () => void): HTMLElement {
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
    return b.parentElement as HTMLElement;
}

/* ---- Empilement par filière ----
   Le titre ne dit plus « Filières empilées » : le panneau porte déjà, plus
   haut, « Filières affichées ». Deux intitulés qui commencent pareil et ne
   font pas la même chose, dans la même colonne, se confondent. */
function carteFilieres(rr: () => void): HTMLElement {
    const b = card("Empilement par filière", false);
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
    return b.parentElement as HTMLElement;
}

/**
 * Carte « Cadre du graphique » : la forme de la page — ses marges, et les
 * dimensions du canevas d'export, propres à la combinaison de filières
 * affichées.
 *
 * Les deux vivaient dans deux cartes, dont l'une ne portait que la taille.
 * Séparées, elles obligeaient à faire l'aller-retour pour une seule question :
 * quelle place occupe le dessin.
 *
 * Aucun `render()` sur la taille — elle ne change rien à ce qui est peint à
 * l'écran ; seul `persist()` la range dans le classeur. Et aucun
 * `buildSidebar()` dans les gestionnaires de champ : le panneau reconstruit à
 * chaque frappe ferait perdre le focus dès le premier chiffre. C'est pourquoi
 * le lien de remise à zéro est là en permanence plutôt que d'apparaître avec le
 * premier réglage.
 */
function carteCadre(): HTMLElement {
    const b = card("Cadre du graphique", false);
    const rr = () => { render(); persist(); };
    const c = options.chart;
    b.appendChild(numberField("Marge en haut", c.marginTop, v => { c.marginTop = v; rr(); }));
    b.appendChild(numberField("Marge en bas", c.marginBottom, v => { c.marginBottom = v; rr(); }));
    b.appendChild(numberField("Marge à gauche", c.marginLeft, v => { c.marginLeft = v; rr(); }));
    b.appendChild(numberField("Marge à droite", c.marginRight, v => { c.marginRight = v; rr(); }));
    b.appendChild(hint(
        "Les marges latérales servent surtout aux libellés : un nom centré sur un nœud "
        + "de la première ou de la dernière colonne déborde du cadre et se fait couper "
        + "par le bord. La marge lui rend cette place."
    ));

    b.appendChild(divider());
    b.appendChild(subhead("Taille du canevas"));
    const t = taillePersonnalisee();

    b.appendChild(hint(
        "Dimensions du canevas choisies par « Dimensions personnalisées », dans le menu "
        + "des boutons PNG et SVG. Le PNG est rastérisé au double pour rester net."
    ));
    b.appendChild(numberField("Largeur (px)", t.width, v => {
        reglerTaillePersonnalisee("width", v);
        persist();
    }));
    b.appendChild(numberField("Hauteur (px)", t.height, v => {
        reglerTaillePersonnalisee("height", v);
        persist();
    }));
    b.appendChild(hint(
        "Ces dimensions valent pour les filières affichées en ce moment — "
        + libelleFilieresAffichees() + ". Une autre combinaison retrouve les siennes."
    ));
    const reprendre = document.createElement("button");
    reprendre.className = "linklike";
    reprendre.textContent = "Reprendre la taille de la fenêtre";
    reprendre.addEventListener("click", () => {
        oublierTaillePersonnalisee();
        buildSidebar();
        persist();
    });
    // Dans une rangée, comme les liens du panneau des filières : seul, un bouton
    // occupe toute la largeur de la grille et son libellé se retrouve centré.
    const rangee = document.createElement("div");
    rangee.className = "check-row";
    rangee.appendChild(reprendre);
    b.appendChild(rangee);
    return b.parentElement as HTMLElement;
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
/**
 * Bouton « resynchroniser » : le picto « comparer » de la charte BASIC, seul,
 * sans libellé — deux flèches qui se croisent, l'une vers Excel, l'autre vers
 * le diagramme.
 *
 * Ses quatre tracés sont ceux du fichier de la charte, repris tels quels : on
 * ne redessine pas un picto maison. Ce qui est ajusté ne tient qu'à la taille.
 * Le picto est fait pour 68 px ; à 15, son trait de 2,5 tomberait sous le
 * demi-pixel et le dessin, très marginé dans son carré, paraîtrait plus petit
 * que ses voisins. D'où le cadrage serré sur le dessin et l'épaisseur relevée,
 * calculée pour retomber sur les 1,4 px de trait des icônes d'export d'à côté.
 */
function resyncBtn(onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "icon-btn";
    b.title = TITRE_RESYNC;
    b.setAttribute("aria-label", "Resynchroniser avec Excel");
    const icon = document.createElementNS(SVGNS, "svg");
    icon.setAttribute("viewBox", "8 10 52 48");
    icon.setAttribute("width", "15");
    icon.setAttribute("height", "14");
    icon.setAttribute("fill", "none");
    icon.setAttribute("aria-hidden", "true");
    [
        "M45.7012 31.5L58.1012 44L45.7012 56.5",
        "M58.1004 44H29.9004",
        "M22.2988 36.5L9.89883 24L22.2988 11.5",
        "M9.89961 24L38.0996 24"
    ].forEach(d => {
        const p = document.createElementNS(SVGNS, "path");
        p.setAttribute("d", d);
        p.setAttribute("stroke", "currentColor");
        p.setAttribute("stroke-width", "5");
        p.setAttribute("stroke-miterlimit", "10");
        icon.appendChild(p);
    });
    b.appendChild(icon);
    b.addEventListener("click", onClick);
    return b;
}
/**
 * Bouton d'export : icône « flèche vers un plateau », format, et le chevron qui
 * dit qu'un menu s'ouvre — le bouton n'exporte plus, il demande la taille.
 * Le gestionnaire reçoit le bouton : c'est sur lui que le menu s'ancre.
 */
function exportBtn(label: string, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "export-btn";
    b.setAttribute("aria-haspopup", "menu");
    const icon = document.createElementNS(SVGNS, "svg");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("width", "14");
    icon.setAttribute("height", "14");
    icon.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", "M8 1.5v7.5m0 0L5 6.2M8 9l3-2.8M2.5 11v2.2a1.3 1.3 0 0 0 1.3 1.3h8.4a1.3 1.3 0 0 0 1.3-1.3V11");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "1.6");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    icon.appendChild(p);
    b.appendChild(icon);
    b.appendChild(document.createTextNode(label));
    const caret = document.createElementNS(SVGNS, "svg");
    caret.setAttribute("viewBox", "0 0 10 10");
    caret.setAttribute("width", "9");
    caret.setAttribute("height", "9");
    caret.setAttribute("class", "caret");
    caret.setAttribute("aria-hidden", "true");
    const cp = document.createElementNS(SVGNS, "path");
    cp.setAttribute("d", "M1.5 3.5 5 7l3.5-3.5");
    cp.setAttribute("fill", "none");
    cp.setAttribute("stroke", "currentColor");
    cp.setAttribute("stroke-width", "1.6");
    cp.setAttribute("stroke-linecap", "round");
    cp.setAttribute("stroke-linejoin", "round");
    caret.appendChild(cp);
    b.appendChild(caret);
    b.addEventListener("click", () => onClick(b));
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
    normaliserPolices();
    normaliserLiens();
    normaliserExport();
    normaliserCadre();
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
    const d = defaultOptions().links;
    if (L.traversee !== "passage" && L.traversee !== "direct") {
        L.traversee = d.traversee;
    }
    // `Object.assign` ne fusionne que le premier niveau : un projet écrit avant
    // le bandeau bio arrive sans `links.bio` du tout.
    L.bio = Object.assign({}, d.bio, L.bio || {});
    normaliserValeursDeLiens();
}
/**
 * Complète le format des valeurs écrites sur les rubans. Une apparence rangée
 * avant ces deux réglages arrive sans eux, et `String(undefined)` finirait dans
 * le SVG. Les valeurs relues viennent du classeur : un multiplicateur inconnu
 * (apparence retouchée à la main, version plus récente) retombe sur « aucun »
 * plutôt que de ne rien diviser du tout en silence.
 */
function normaliserValeursDeLiens(): void {
    const V = options.linkValueLabels;
    const d = defaultOptions().linkValueLabels;
    if (!MULTIPLICATEURS_VALEUR.some(([m]) => m === V.multiplicateur)) {
        V.multiplicateur = d.multiplicateur;
    }
    const n = Number(V.chiffresSignificatifs);
    V.chiffresSignificatifs = isFinite(n) && n >= 1
        ? Math.min(15, Math.max(1, Math.round(n)))
        : d.chiffresSignificatifs;
}
/**
 * Complète les marges du cadre. `Object.assign` ne fusionne que le premier
 * niveau : une apparence rangée avant les marges latérales arrive avec un
 * `chart` complet de deux champs, qui remplace le défaut de quatre — les deux
 * nouveaux vaudraient `undefined`, et le moteur décalerait le dessin de `NaN`
 * pixels, c'est-à-dire nulle part.
 */
function normaliserCadre(): void {
    const d = defaultOptions().chart;
    const relu = (options.chart || {}) as Record<string, unknown>;
    const nombre = (v: unknown, defaut: number) => {
        const n = Number(v);
        return isFinite(n) ? n : defaut;
    };
    options.chart = {
        marginTop: nombre(relu.marginTop, d.marginTop),
        marginBottom: nombre(relu.marginBottom, d.marginBottom),
        marginLeft: nombre(relu.marginLeft, d.marginLeft),
        marginRight: nombre(relu.marginRight, d.marginRight)
    };
}

/**
 * Complète les dimensions d'export, pour la même raison qu'au-dessus : une
 * apparence écrite avant ce réglage arrive sans `exportation` du tout.
 *
 * Les tailles relues sont **contrôlées une à une** : elles viennent d'un JSON
 * du classeur, que rien n'empêche d'avoir été édité à la main ou écrit par une
 * version plus ancienne. Une hauteur nulle rendrait un export vide, sans dire
 * pourquoi ; on préfère l'ignorer et retomber sur la taille de la fenêtre.
 */
function normaliserExport(): void {
    const relu = (options.exportation || {}).tailles;
    const tailles: Record<string, TailleExport> = {};
    if (relu && typeof relu === "object") {
        Object.keys(relu).forEach(cle => {
            const t = (relu as Record<string, Partial<TailleExport>>)[cle];
            const w = Number(t && t.width);
            const h = Number(t && t.height);
            if (isFinite(w) && isFinite(h) && w > 0 && h > 0) {
                tailles[cle] = { width: borneExport(w), height: borneExport(h) };
            }
        });
    }
    options.exportation = { tailles };
}

/**
 * Complète les réglages de police d'un projet écrit avant la graisse fine et
 * les capitales. `Object.assign` ne fusionne que le premier niveau : une carte
 * relue arrive telle qu'elle a été écrite, avec l'ancien booléen `bold` et sans
 * `weight` ni `uppercase`. Sans cette traduction, un titre écrit en gras
 * reviendrait maigre et `String(undefined)` atterrirait dans le SVG.
 */
function normaliserPolice(o: Record<string, unknown> | null | undefined, defaut: TextStyle): void {
    if (!o) return;
    if (typeof o.weight !== "number") {
        o.weight = typeof o.bold === "boolean" ? (o.bold ? 700 : 400) : defaut.weight;
    }
    delete o.bold; // une seule source de vérité pour la graisse
    if (typeof o.uppercase !== "boolean") o.uppercase = false;
    if (typeof o.italic !== "boolean") o.italic = defaut.italic;
    if (typeof o.fontFamily !== "string") o.fontFamily = defaut.fontFamily;
    if (typeof o.fontSize !== "number") o.fontSize = defaut.fontSize;
    if (typeof o.fontColor !== "string") o.fontColor = defaut.fontColor;
}

/** Toutes les polices du document, celles des types de nœuds comprises. */
function normaliserPolices(): void {
    const d = defaultOptions();
    (["nodeLabels", "columnHeaders", "linkValueLabels", "lanes", "filieres"] as const)
        .forEach(cle => {
            normaliserPolice(
                options[cle] as unknown as Record<string, unknown>,
                d[cle] as unknown as TextStyle
            );
        });
    NODE_KINDS.forEach(([kind]) => {
        normaliserPolice(
            options.nodeTypes[kind].font as unknown as Record<string, unknown>,
            options.nodeLabels as unknown as TextStyle
        );
    });
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
            outline: Object.assign(d.outline, s.outline || {}),
            mosaique: Object.assign(d.mosaique, s.mosaique || {})
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
    normaliserPolices();
    normaliserLiens();
    normaliserExport();
    normaliserCadre();
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
/* ------------------------------ Export ----------------------------- */

/**
 * Bornes d'une dimension d'export. En deçà du minimum le diagramme n'est plus
 * lisible ; au-delà du maximum le canevas du PNG (rendu au double) dépasse ce
 * qu'une webview accepte d'allouer, et l'export rendrait une image vide.
 */
const EXPORT_MIN = 100;
const EXPORT_MAX = 8000;

/** Le PNG est rastérisé au double des dimensions demandées, pour rester net. */
const EXPORT_ECHELLE_PNG = 2;

/** Dimension d'export ramenée à un entier tenable. */
function borneExport(v: number): number {
    if (!isFinite(v)) return EXPORT_MIN;
    return Math.round(Math.max(EXPORT_MIN, Math.min(EXPORT_MAX, v)));
}

/** Les dimensions telles qu'on les annonce dans le menu et le panneau. */
function libelleTaille(t: TailleExport): string {
    return t.width + " × " + t.height + " px";
}

/**
 * Taille de la fenêtre : ce que l'export a toujours produit. Les minima sont
 * ceux d'avant le choix — un volet étroit ne doit pas rendre une image étroite.
 */
function tailleFenetre(): TailleExport {
    const wrap = canvas.parentElement as HTMLElement;
    return {
        width: Math.max(1280, Math.round(wrap.clientWidth)),
        height: Math.max(720, Math.round(wrap.clientHeight))
    };
}

/**
 * Clé de la combinaison de filières AFFICHÉES.
 *
 * Triée, donc indépendante de l'ordre dans lequel les cases ont été décochées :
 * masquer A puis B doit retrouver la taille réglée en masquant B puis A. Et
 * sérialisée en JSON, parce qu'un nom de filière peut contenir n'importe quel
 * caractère — un séparateur choisi à la main finirait par s'y trouver, et deux
 * combinaisons différentes porteraient alors la même clé.
 *
 * Les filières masquées qui n'existent plus dans le modèle ne comptent pas :
 * la clé se construit de ce qui est visible, pas de ce qui est caché.
 */
function cleFilieresAffichees(): string {
    const visibles = distinctFilieres().filter(f => !hiddenFilieres.has(f));
    return JSON.stringify(visibles.slice().sort());
}

/**
 * Le nom du fichier exporté : celui des filières AFFICHÉES.
 *
 * On exporte le dessin qu'on a sous les yeux, et ce qui le distingue d'un autre
 * export du même classeur, c'est justement la combinaison de filières cochées.
 * « sankey.png », « sankey (1).png », « sankey (2).png » dans le dossier des
 * téléchargements ne disaient plus lequel était lequel.
 *
 * Le nom est ASSAINI (les caractères interdits par Windows et macOS retirés) et
 * BORNÉ : une dizaine de filières cochées feraient un nom qu'aucun système
 * n'accepte. Sans filière nommée, on retombe sur « sankey ».
 */
function nomFichierExport(format: "png" | "svg"): string {
    const visibles = distinctFilieres().filter(f => !hiddenFilieres.has(f));
    const base = visibles.map(assainirNomFichier).filter(n => n !== "").join(" - ");
    return (base ? tronquer(base, 80) : "sankey") + "." + format;
}

/** Un nom de filière ramené à ce qu'un système de fichiers accepte. */
function assainirNomFichier(nom: string): string {
    return nom
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^[\s.]+|[\s.]+$/g, "");
}

/** Coupe au dernier mot entier avant `max` signes (jamais au milieu d'un nom). */
function tronquer(texte: string, max: number): string {
    if (texte.length <= max) return texte;
    const coupe = texte.slice(0, max);
    const espace = coupe.lastIndexOf(" ");
    return (espace > 0 ? coupe.slice(0, espace) : coupe).replace(/[\s-]+$/, "");
}

/** Ce que la carte « Cadre du graphique » annonce comme portée du réglage. */
function libelleFilieresAffichees(): string {
    const visibles = distinctFilieres().filter(f => !hiddenFilieres.has(f));
    if (!visibles.length) return "aucune filière affichée";
    return visibles.map(f => f === "" ? "(sans filière)" : f).join(", ");
}

/**
 * Dimensions personnalisées de la combinaison de filières en cours.
 *
 * Tant qu'aucune n'a été réglée, ce sont celles de la fenêtre : le point de
 * départ du réglage est ce qu'on voit, pas un chiffre arbitraire.
 */
function taillePersonnalisee(): TailleExport {
    const t = options.exportation.tailles[cleFilieresAffichees()];
    return t ? { width: t.width, height: t.height } : tailleFenetre();
}

/** Une taille personnalisée est-elle réglée pour la combinaison en cours ? */
function aUneTaillePersonnalisee(): boolean {
    return !!options.exportation.tailles[cleFilieresAffichees()];
}

function reglerTaillePersonnalisee(champ: "width" | "height", v: number): void {
    const t = taillePersonnalisee();
    t[champ] = borneExport(v);
    options.exportation.tailles[cleFilieresAffichees()] = t;
}

function oublierTaillePersonnalisee(): void {
    delete options.exportation.tailles[cleFilieresAffichees()];
}

/**
 * Le choix de la taille, sous le bouton d'export.
 *
 * Les deux tailles sont annoncées en chiffres : sans elles, « dimensions
 * personnalisées » ne dirait pas si quelque chose a été réglé, ni quoi.
 */
function ouvrirMenuExport(anchor: HTMLElement, format: "png" | "svg"): void {
    const fenetre = tailleFenetre();
    const perso = taillePersonnalisee();
    openMenuPopover({
        anchor,
        label: "Exporter en " + format.toUpperCase(),
        items: [
            {
                label: "Taille de la fenêtre",
                detail: libelleTaille(fenetre),
                onPick: () => { exportImage(format, fenetre); }
            },
            {
                label: "Dimensions personnalisées",
                detail: aUneTaillePersonnalisee()
                    ? libelleTaille(perso)
                    : libelleTaille(perso) + " — à régler dans « Cadre du graphique »",
                onPick: () => { exportImage(format, perso); }
            }
        ]
    });
}

async function exportImage(format: "png" | "svg", taille: TailleExport): Promise<void> {
    const w = borneExport(taille.width);
    const h = borneExport(taille.height);

    // Rend le Sankey (vue filtrée) dans un SVG hors écran.
    const tmp = document.createElementNS(SVGNS, "svg") as SVGSVGElement;
    tmp.setAttribute("xmlns", SVGNS);
    dessinerApercu(tmp, w, h, "none"); // export sans fond : PNG et SVG transparents
    const svgString =
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
        new XMLSerializer().serializeToString(tmp);

    if (format === "svg") {
        await saveExport(nomFichierExport("svg"), "image/svg+xml", svgString, false);
        return;
    }

    // PNG : SVG -> Image -> canvas (suréchantillonné pour la netteté)
    const scale = EXPORT_ECHELLE_PNG;
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
    await saveExport(nomFichierExport("png"), "image/png", base64, true);
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
async function pushToExcel(opts?: { silencieux?: boolean; valeursDejaLues?: boolean }): Promise<void> {
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
        // Conserve les valeurs déjà saisies dans Excel pour les liens existants.
        // Sauf quand l'appelant vient de lire le classeur (la resynchro) : le
        // modèle porte déjà ces valeurs, et un aller-retour vers Excel se compte.
        if (!(opts && opts.valeursDejaLues)) {
            const rd = await d.readExcel(excelPath);
            if (rd.ok && rd.data) mergeValuesFromExcel(rd.data);
        }

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
        // Avant le render : l'alerte est une carte du panneau, et elle doit
        // apparaître dans la reconstruction qui suit, pas à la suivante.
        signalerRemplissage(res.remplissage);
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
        signalerRemplissage(w.remplissage);
    }
}

/** Ce que le bouton du ruban annonce, et ce qu'il répète quand il est occupé. */
const TITRE_RESYNC = "Recharger les données du classeur, puis les y réécrire";
let resyncEnCours = false;

/** Grise le bouton pendant l'aller-retour : deux resynchros à la fois n'ont aucun sens. */
function majBoutonResync(): void {
    if (!resyncEl) return;
    resyncEl.disabled = resyncEnCours;
    resyncEl.title = resyncEnCours ? "Resynchronisation en cours…" : TITRE_RESYNC;
}

/**
 * Le bouton « resynchroniser » du ruban : relire, puis réécrire.
 *
 * Les deux temps comptent, et dans cet ordre. Le premier rend au diagramme ce
 * que le classeur est seul à savoir — valeurs, part bio, libellés retouchés
 * dans Excel. Le second réécrit la structure qu'on vient d'en lire : c'est lui
 * qui rend leurs identifiants aux lignes saisies à la main — sans quoi elles ne
 * se reconnaissent que par les NOMS de leurs extrémités — et qui remet les noms
 * du tableau des liens d'accord avec ceux du tableau des nœuds.
 *
 * Les formules ne sont pas l'affaire de cette fonction, et c'est voulu :
 * `ecrireDiagramme` les relit et les repose lui-même, une par une, sur leur
 * seule cellule (AGENTS.md, « Ce que l'écriture préserve »). Passer par
 * `pushToExcel` plutôt que d'écrire ici, c'est refuser de court-circuiter ce
 * travail-là — et hériter au passage de l'alerte qui dit une recopie défaite.
 */
async function resynchroniser(): Promise<void> {
    const d = desktop();
    if (!d || !caps().excel) {
        setStatus("Aucun classeur joignable : rien à resynchroniser.");
        return;
    }
    if (resyncEnCours) return;
    // Relire d'abord, c'est laisser le classeur gagner. On le dit avant.
    if (dirtySinceSync && !confirm(
        "⚠️ Des modifications de l'application n'ont pas encore été écrites vers Excel.\n\n" +
        "Resynchroniser relit le classeur d'abord : elles seront écrasées. Continuer ?"
    )) return;

    resyncEnCours = true;
    majBoutonResync();
    try {
        setStatus("Relecture du classeur…");
        let res: { ok?: boolean; data?: ExcelData; error?: string } | null = null;
        try {
            res = await d.readExcel(excelPath);
        } catch (e) {
            res = { ok: false, error: (e as Error).message };
        }
        if (!res || !res.ok || !res.data) {
            setStatus("Classeur illisible" + (res && res.error ? " : " + res.error : "")
                + " — vérifie que l'onglet Diagramme porte bien les tableaux Nœuds et Liens.");
            return;
        }
        reconcileFromExcel(res.data);
        // Une lecture réussie vaut amorce : si celle du démarrage avait échoué,
        // ce bouton est ce qui débloque la synchro automatique.
        amorceFaite = true;
        render();
        buildSidebar();
        await pushToExcel({ valeursDejaLues: true });
        setStatus(`Resynchronisé avec le classeur : ${model.nodes.length} nœud(s), `
            + `${model.links.length} lien(s).`);
    } finally {
        resyncEnCours = false;
        majBoutonResync();
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
            if (data.hasBio) l.bio = partBio(E);
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
        // Une ligne de lien saisie dans Excel n'a pas ses colonnes ID : il faut
        // les lui rendre TOUT DE SUITE. Tant qu'elles sont vides, ce lien ne se
        // reconnaît que par les NOMS de ses extrémités — le repli fragile, celui
        // qui confond deux homonymes et leur dispute leur formule.
        if (E.sourceId !== s || E.targetId !== t) assigned = true;
        const key = pairKey(s, t);
        if (excelPairs.has(key)) return; // pas de doublon de lien
        excelPairs.add(key);

        const existing = linksByPair.get(key);
        if (existing) {
            existing.value = E.value;
            existing.unit = E.unit;
            // Sans la colonne, le classeur ne dit rien de la part bio : on garde
            // celle de l'app plutôt que de tout remettre à zéro (cf. hasLane).
            if (data.hasBio) existing.bio = partBio(E);
            newSyncedLinks.add(key);
        } else {
            const l: FlowLink = {
                id: newId("l"), source: s, target: t, value: E.value, unit: E.unit,
                bio: data.hasBio ? partBio(E) : 0
            };
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
