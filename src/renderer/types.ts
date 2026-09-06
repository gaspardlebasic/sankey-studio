// Modèle de données de l'application (source de vérité côté app).

/**
 * Nature d'un nœud : soit un **produit / commodité** qui circule, soit une
 * **industrie** — étape de transformation ou de commercialisation qui le fait
 * circuler. La distinction vit aussi dans Excel (colonne « Type ») et pilote
 * l'apparence du nœud dans l'aperçu (largeur, police, contour, mosaïque).
 */
export type NodeKind = "produit" | "industrie";

/** Les deux types et leur intitulé, pour les listes déroulantes. */
export const NODE_KINDS: [NodeKind, string][] = [
    ["produit", "Produit / commodité"],
    ["industrie", "Industrie / étape"]
];

/** Type d'un nœud, ramené à une valeur connue (« produit » par défaut). */
export function kindOf(n: { kind?: string | null } | null | undefined): NodeKind {
    return n && n.kind === "industrie" ? "industrie" : "produit";
}

export interface FlowNode {
    id: string;
    name: string;
    column: number; // numéro de colonne d'affichage (entier)
    title: string; // intitulé de la colonne (facultatif)
    order: number; // ordre vertical d'affichage dans la colonne (croissant = haut)
    lane: number; // couloir horizontal (1 = premier, en haut) ; sépare des familles de flux
    kind: NodeKind; // produit/commodité ou industrie/étape de transformation
    filiere: string; // filière étudiée (permet de filtrer l'affichage) ; peut être vide
    color: string | null; // couleur du nœud (nom CSS ou #hex) ; null = défaut
    x: number; // position libre dans l'éditeur (pas utilisée par le Sankey)
    y: number;
}

export interface FlowLink {
    id: string;
    source: string; // id du nœud d'origine
    target: string; // id du nœud de destination
    value: number; // valeur du flux (proviendra d'Excel ; défaut 1)
    unit?: string; // unité affichée avec la valeur
    colorOverride?: string | null; // couleur propre au lien (apparence, app only)
    /**
     * Part du flux qui est bio / durable, de 0 à 1. Absente = 0, et le ruban se
     * dessine alors exactement comme avant. Vient du classeur (colonne « Part
     * bio / durable » du tableau des liens) et n'y retourne jamais : c'est une
     * donnée de l'utilisatrice, souvent calculée, que nous ne réécrivons pas.
     */
    bio?: number;
}

/** Part bio d'un lien, ramenée à un nombre de 0 à 1 (0 par défaut). */
export function partBio(l: { bio?: number } | null | undefined): number {
    const v = Number(l && l.bio);
    if (!isFinite(v) || v <= 0) return 0;
    return Math.min(1, v);
}

export interface FlowModel {
    nodes: FlowNode[];
    links: FlowLink[];
}

/* ---- Options d'apparence (portées depuis le visuel Power BI) ---- */

/**
 * Contour dessiné AUTOUR d'un nœud, à distance de son bord : un liseré qui
 * l'entoure sans le toucher. Sa couleur dérive de celle du nœud (la même, en
 * plus foncé) ou du noir rendu transparent.
 */
export interface NodeOutline {
    show: boolean;
    distance: number; // écart entre le bord du nœud et le trait
    width: number; // épaisseur du trait
    radius: number; // arrondi des angles
    /** « fonce » : couleur du nœud assombrie ; « noir » : du noir transparent. */
    mode: "fonce" | "noir";
    /** 0..100 — taux d'assombrissement (« fonce ») ou opacité du noir (« noir »). */
    intensity: number;
}

/**
 * Réglages de police d'un texte du diagramme — **les mêmes partout** où le
 * choix se pose : étiquettes des nœuds, polices propres aux types, titres de
 * colonnes, noms de couloirs, noms de filières, valeurs des liens. Un seul jeu
 * de champs, donc un seul bloc de contrôles dans le panneau.
 *
 * `weight` remplace l'ancien booléen `bold` : la graisse se choisit de « fine »
 * à « grasse » (300 … 700), et la bascule [G] du panneau n'en est qu'un
 * raccourci. `uppercase` n'affecte que l'**affichage** : le nom du nœud, le
 * titre de la colonne et le classeur gardent leur casse d'origine.
 */
export interface TextStyle {
    fontFamily: string;
    fontSize: number;
    fontColor: string;
    weight: number; // 300 fine … 700 grasse
    italic: boolean;
    uppercase: boolean; // affiché tout en capitales (les données ne changent pas)
}

/** Police propre à un type de nœud : le même jeu de réglages que partout. */
export type NodeTypeFont = TextStyle;

/** Texte tel qu'il doit s'afficher, mis en capitales si le style le demande. */
export function texteAffiche(texte: string, s: { uppercase?: boolean } | null | undefined): string {
    const t = texte == null ? "" : String(texte);
    // Locale explicite : sans elle, un « i » turc remonterait en « İ » sur un
    // poste réglé en turc, et le titre d'une colonne changerait de forme.
    return s && s.uppercase ? t.toLocaleUpperCase("fr") : t;
}

/**
 * Où se pose l'étiquette d'un nœud : à côté de sa boîte, en dessous, ou
 * centrée dessus (les nœuds des colonnes de bord se calant alors sur le côté
 * tourné vers l'intérieur du graphique).
 */
export type NodeLabelPosition = "cote" | "dessous" | "centre";

export const NODE_LABEL_POSITIONS: [NodeLabelPosition, string][] = [
    ["cote", "À côté"],
    ["dessous", "En dessous"],
    ["centre", "Centré sur le nœud"]
];

/**
 * Damier peint À LA PLACE de l'aplat du nœud : un carrelage de carrés de
 * `taille` pixels, alternativement blancs et de la couleur du nœud. Sert à
 * distinguer une famille de nœuds sans lui donner une couleur de plus — le
 * nœud garde la sienne, il la porte autrement.
 */
export interface NodeMosaique {
    show: boolean;
    taille: number; // côté d'un carré, en pixels
}

/**
 * Apparence propre à un type de nœud.
 *
 * `width`, `font` et `position` valent **null** tant qu'ils ne sont pas repris
 * en main : le type suit alors les réglages globaux (`nodes.nodeWidth`,
 * `nodeLabels`). C'est ce qui garantit qu'un projet d'avant les types s'affiche
 * au pixel près comme avant, et que le réglage global reste le point de départ.
 */
export interface NodeTypeStyle {
    width: number | null; // null = options.nodes.nodeWidth
    font: NodeTypeFont | null; // null = options.nodeLabels
    position: NodeLabelPosition | null; // null = options.nodeLabels.position
    outline: NodeOutline;
    mosaique: NodeMosaique;
}

export function defaultOutline(): NodeOutline {
    return { show: false, distance: 4, width: 1.5, radius: 3, mode: "fonce", intensity: 45 };
}

export function defaultMosaique(): NodeMosaique {
    return { show: false, taille: 10 };
}

export function defaultTypeStyle(): NodeTypeStyle {
    return {
        width: null,
        font: null,
        position: null,
        outline: defaultOutline(),
        mosaique: defaultMosaique()
    };
}

export interface SankeyOptions {
    links: {
        defaultColor: string; // repli quand le nœud d'origine n'a pas de couleur
        useGradient: boolean; // dégradé couleur origine -> couleur destination
        opacity: number; // 0..100
        curveType: "courbe" | "droite" | "marches";
        curvature: number; // 0..100
        /**
         * Ce que fait un lien qui **saute au moins une colonne** (A en 1 vers C
         * en 3, alors qu'un nœud B occupe la 2).
         * - « passage » : une place lui est réservée dans chaque colonne
         *   traversée ; le ruban se faufile entre les nœuds au lieu de les
         *   recouvrir, et la hauteur de la colonne en tient compte.
         * - « direct » : tracé en ligne droite d'un bout à l'autre — il peut
         *   passer sur les nœuds intermédiaires (rendu d'avant l'option).
         */
        traversee: "passage" | "direct";
        /**
         * Bandeau qui recouvre la part bio / durable du ruban, depuis son bord
         * supérieur : à 100 % le lien est entièrement vert, à 50 % on voit deux
         * flux collés l'un à l'autre, à 0 % le lien est inchangé.
         */
        bio: {
            show: boolean;
            color: string;
        };
        showBorder: boolean;
        borderColor: string;
        borderWidth: number;
    };
    nodes: {
        nodeColor: string; // couleur par défaut d'un nœud sans couleur propre
        nodeWidth: number;
        nodePadding: number;
    };
    /**
     * Apparence par type de nœud (produit / industrie). Chaque réglage laissé à
     * null suit l'option globale correspondante : sans réglage, les deux types
     * se dessinent exactement comme avant leur existence.
     */
    nodeTypes: {
        produit: NodeTypeStyle;
        industrie: NodeTypeStyle;
    };
    nodeLabels: {
        show: boolean;
        fontColor: string;
        fontFamily: string;
        fontSize: number;
        weight: number;
        italic: boolean;
        uppercase: boolean;
        showValue: boolean;
        position: NodeLabelPosition;
        showBackground: boolean;
        backgroundColor: string;
        backgroundOpacity: number; // 0..100
        wrap: boolean;
        maxChars: number;
    };
    columnHeaders: {
        show: boolean;
        fontColor: string;
        backgroundColor: string;
        fontFamily: string;
        fontSize: number;
        weight: number;
        italic: boolean;
        uppercase: boolean;
        marginTop: number;
        marginBottom: number;
    };
    linkValueLabels: {
        show: boolean;
        unitText: string;
        fontColor: string;
        fontFamily: string;
        fontSize: number;
        weight: number;
        italic: boolean;
        uppercase: boolean;
    };
    /** Marges extérieures du graphique (aperçu et export). */
    chart: {
        marginTop: number;
        marginBottom: number;
    };
    /**
     * Couloirs horizontaux : bandes empilées dans lesquelles les nœuds se rangent
     * selon leur `lane`. Sert à isoler des familles de flux (entrants hors
     * périmètre, cœur, sortants hors périmètre…). Sans couloir déclaré, tout tient
     * dans le couloir 1 et la mise en page est celle d'avant.
     */
    lanes: {
        gap: number; // espace vertical entre deux couloirs
        showTitles: boolean;
        /** Nom de chaque couloir, indexé par son numéro. Vide = « Couloir N ». */
        titles: Record<string, string>;
        fontColor: string;
        fontFamily: string;
        fontSize: number;
        weight: number;
        italic: boolean;
        uppercase: boolean;
    };
    /** Empilement d'un Sankey par filière, avec le nom de la filière en titre. */
    filieres: {
        split: boolean;
        showTitle: boolean;
        gap: number; // espace entre deux diagrammes
        titleSpace: number; // espace sous le titre d'une filière
        /** Même échelle pour tous : 1 unité de flux = la même épaisseur partout. */
        sameScale: boolean;
        align: "gauche" | "centre" | "droite";
        fontColor: string;
        fontFamily: string;
        fontSize: number;
        weight: number;
        italic: boolean;
        uppercase: boolean;
    };
}

const FONT = "\"Source Sans Pro\", system-ui, -apple-system, Helvetica, Arial, sans-serif";

export function defaultOptions(): SankeyOptions {
    return {
        links: {
            defaultColor: "#6b6b6b",
            useGradient: false,
            opacity: 75,
            curveType: "courbe",
            curvature: 50,
            traversee: "passage",
            // « field » de la palette BASIC : le vert des cultures.
            bio: { show: true, color: "#adcb47" },
            showBorder: false,
            borderColor: "#000000",
            borderWidth: 1
        },
        nodes: {
            nodeColor: "#000000",
            nodeWidth: 16,
            nodePadding: 14
        },
        nodeTypes: {
            produit: defaultTypeStyle(),
            industrie: defaultTypeStyle()
        },
        nodeLabels: {
            show: true,
            fontColor: "#000000",
            fontFamily: FONT,
            fontSize: 12,
            weight: 400,
            italic: false,
            uppercase: false,
            showValue: false,
            position: "cote",
            showBackground: false,
            backgroundColor: "#ffffff",
            backgroundOpacity: 80,
            wrap: false,
            maxChars: 18
        },
        columnHeaders: {
            show: true,
            fontColor: "#ffffff",
            backgroundColor: "#000000",
            fontFamily: FONT,
            fontSize: 13,
            weight: 700,
            italic: false,
            uppercase: false,
            marginTop: 4,
            marginBottom: 10
        },
        linkValueLabels: {
            show: false,
            unitText: "",
            fontColor: "#000000",
            fontFamily: FONT,
            fontSize: 10,
            weight: 400,
            italic: false,
            uppercase: false
        },
        chart: {
            marginTop: 0,
            marginBottom: 0
        },
        lanes: {
            gap: 28,
            showTitles: true,
            titles: {},
            fontColor: "#6b6b6b",
            fontFamily: FONT,
            fontSize: 12,
            weight: 400,
            italic: false,
            uppercase: false
        },
        filieres: {
            split: false,
            showTitle: true,
            gap: 40,
            titleSpace: 8,
            sameScale: true,
            align: "gauche",
            fontColor: "#000000",
            fontFamily: FONT,
            fontSize: 16,
            weight: 700,
            italic: false,
            uppercase: false
        }
    };
}
