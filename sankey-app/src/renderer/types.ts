// Modèle de données de l'application (source de vérité côté app).

export interface FlowNode {
    id: string;
    name: string;
    column: number; // numéro de colonne d'affichage (entier)
    title: string; // intitulé de la colonne (facultatif)
    order: number; // ordre vertical d'affichage dans la colonne (croissant = haut)
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
}

export interface FlowModel {
    nodes: FlowNode[];
    links: FlowLink[];
}

/* ---- Options d'apparence (portées depuis le visuel Power BI) ---- */

export interface SankeyOptions {
    links: {
        defaultColor: string; // repli quand le nœud d'origine n'a pas de couleur
        useGradient: boolean; // dégradé couleur origine -> couleur destination
        opacity: number; // 0..100
        curveType: "courbe" | "droite" | "marches";
        curvature: number; // 0..100
        showBorder: boolean;
        borderColor: string;
        borderWidth: number;
    };
    nodes: {
        nodeColor: string; // couleur par défaut d'un nœud sans couleur propre
        nodeWidth: number;
        nodePadding: number;
    };
    nodeLabels: {
        show: boolean;
        fontColor: string;
        fontFamily: string;
        fontSize: number;
        bold: boolean;
        italic: boolean;
        showValue: boolean;
        position: "cote" | "dessous";
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
        bold: boolean;
        italic: boolean;
        marginTop: number;
        marginBottom: number;
    };
    linkValueLabels: {
        show: boolean;
        unitText: string;
        fontColor: string;
        fontFamily: string;
        fontSize: number;
        bold: boolean;
        italic: boolean;
    };
}

const FONT = "Segoe UI, system-ui, -apple-system, Helvetica, Arial, sans-serif";

export function defaultOptions(): SankeyOptions {
    return {
        links: {
            defaultColor: "#8c9bab",
            useGradient: false,
            opacity: 75,
            curveType: "courbe",
            curvature: 50,
            showBorder: false,
            borderColor: "#000000",
            borderWidth: 1
        },
        nodes: {
            nodeColor: "#2b2b2b",
            nodeWidth: 16,
            nodePadding: 14
        },
        nodeLabels: {
            show: true,
            fontColor: "#222222",
            fontFamily: FONT,
            fontSize: 12,
            bold: false,
            italic: false,
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
            bold: true,
            italic: false,
            marginTop: 4,
            marginBottom: 10
        },
        linkValueLabels: {
            show: false,
            unitText: "",
            fontColor: "#222222",
            fontFamily: FONT,
            fontSize: 10,
            bold: false,
            italic: false
        }
    };
}
