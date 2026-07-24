"use strict";

import powerbi from "powerbi-visuals-api";
import ValidatorType = powerbi.visuals.ValidatorType;

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Carte "Liens" — apparence de chaque lien du Sankey.
 */
class LinksCardSettings extends FormattingSettingsCard {
    defaultColor = new formattingSettings.ColorPicker({
        name: "defaultColor",
        displayName: "Couleur par défaut",
        value: { value: "#8c9bab" }
    });

    useDataColors = new formattingSettings.ToggleSwitch({
        name: "useDataColors",
        displayName: "Utiliser la couleur des données",
        value: true
    });

    useGradient = new formattingSettings.ToggleSwitch({
        name: "useGradient",
        displayName: "Dégradé vers la couleur d'arrivée",
        value: false
    });

    opacity = new formattingSettings.Slider({
        name: "opacity",
        displayName: "Opacité (%)",
        value: 75,
        options: {
            minValue: { type: ValidatorType.Min, value: 0 },
            maxValue: { type: ValidatorType.Max, value: 100 }
        }
    });

    curveType = new formattingSettings.ItemDropdown({
        name: "curveType",
        displayName: "Type de courbe",
        items: [
            { value: "courbe", displayName: "Courbe" },
            { value: "droite", displayName: "Ligne droite" },
            { value: "marches", displayName: "Marches" }
        ],
        value: { value: "courbe", displayName: "Courbe" }
    });

    curvature = new formattingSettings.Slider({
        name: "curvature",
        displayName: "Courbure",
        value: 50,
        options: {
            minValue: { type: ValidatorType.Min, value: 0 },
            maxValue: { type: ValidatorType.Max, value: 100 }
        }
    });

    showBorder = new formattingSettings.ToggleSwitch({
        name: "showBorder",
        displayName: "Afficher la bordure",
        value: false
    });

    borderColor = new formattingSettings.ColorPicker({
        name: "borderColor",
        displayName: "Couleur de bordure",
        value: { value: "#000000" }
    });

    borderWidth = new formattingSettings.NumUpDown({
        name: "borderWidth",
        displayName: "Épaisseur de bordure",
        value: 1,
        options: {
            minValue: { type: ValidatorType.Min, value: 0 },
            maxValue: { type: ValidatorType.Max, value: 10 }
        }
    });

    name: string = "links";
    displayName: string = "Liens";
    slices = [
        this.defaultColor,
        this.useDataColors,
        this.useGradient,
        this.opacity,
        this.curveType,
        this.curvature,
        this.showBorder,
        this.borderColor,
        this.borderWidth
    ];
}

/**
 * Carte "Nœuds" — apparence des rectangles de nœuds.
 */
class NodesCardSettings extends FormattingSettingsCard {
    nodeColor = new formattingSettings.ColorPicker({
        name: "nodeColor",
        displayName: "Couleur des nœuds",
        value: { value: "#2b2b2b" }
    });

    colorFromFirstLink = new formattingSettings.ToggleSwitch({
        name: "colorFromFirstLink",
        displayName: "Couleur = 1er lien sortant",
        value: false
    });

    nodeWidth = new formattingSettings.NumUpDown({
        name: "nodeWidth",
        displayName: "Largeur des nœuds",
        value: 16,
        options: {
            minValue: { type: ValidatorType.Min, value: 1 },
            maxValue: { type: ValidatorType.Max, value: 60 }
        }
    });

    nodePadding = new formattingSettings.NumUpDown({
        name: "nodePadding",
        displayName: "Espacement vertical des nœuds",
        value: 12,
        options: {
            minValue: { type: ValidatorType.Min, value: 0 },
            maxValue: { type: ValidatorType.Max, value: 200 }
        }
    });

    name: string = "nodes";
    displayName: string = "Nœuds";
    slices = [this.nodeColor, this.colorFromFirstLink, this.nodeWidth, this.nodePadding];
}

/**
 * Carte "Étiquettes des nœuds" — mise en forme du texte des nœuds.
 */
class NodeLabelsCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Afficher",
        value: true
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Couleur du texte",
        value: { value: "#222222" }
    });

    fontFamily = new formattingSettings.FontPicker({
        name: "fontFamily",
        displayName: "Police",
        value: "Segoe UI, wf_segoe-ui_normal, helvetica, arial, sans-serif"
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Taille",
        value: 11,
        options: {
            minValue: { type: ValidatorType.Min, value: 4 },
            maxValue: { type: ValidatorType.Max, value: 60 }
        }
    });

    bold = new formattingSettings.ToggleSwitch({
        name: "bold",
        displayName: "Gras",
        value: false
    });

    italic = new formattingSettings.ToggleSwitch({
        name: "italic",
        displayName: "Italique",
        value: false
    });

    showValue = new formattingSettings.ToggleSwitch({
        name: "showValue",
        displayName: "Afficher la valeur",
        value: false
    });

    showBackground = new formattingSettings.ToggleSwitch({
        name: "showBackground",
        displayName: "Arrière-plan",
        value: false
    });

    backgroundColor = new formattingSettings.ColorPicker({
        name: "backgroundColor",
        displayName: "Couleur d'arrière-plan",
        value: { value: "#ffffff" }
    });

    backgroundOpacity = new formattingSettings.Slider({
        name: "backgroundOpacity",
        displayName: "Opacité de l'arrière-plan (%)",
        value: 80,
        options: {
            minValue: { type: ValidatorType.Min, value: 0 },
            maxValue: { type: ValidatorType.Max, value: 100 }
        }
    });

    position = new formattingSettings.ItemDropdown({
        name: "position",
        displayName: "Position",
        items: [
            { value: "cote", displayName: "À côté du nœud" },
            { value: "dessous", displayName: "En dessous du nœud" }
        ],
        value: { value: "cote", displayName: "À côté du nœud" }
    });

    wrap = new formattingSettings.ToggleSwitch({
        name: "wrap",
        displayName: "Retour à la ligne",
        value: false
    });

    maxChars = new formattingSettings.NumUpDown({
        name: "maxChars",
        displayName: "Longueur max. par ligne (caractères)",
        value: 18,
        options: {
            minValue: { type: ValidatorType.Min, value: 1 },
            maxValue: { type: ValidatorType.Max, value: 200 }
        }
    });

    name: string = "nodeLabels";
    displayName: string = "Étiquettes des nœuds";
    slices = [
        this.show,
        this.fontColor,
        this.fontFamily,
        this.fontSize,
        this.bold,
        this.italic,
        this.showValue,
        this.position,
        this.showBackground,
        this.backgroundColor,
        this.backgroundOpacity,
        this.wrap,
        this.maxChars
    ];
}

/**
 * Carte "Titres de colonnes" — bandeau en haut de chaque colonne.
 */
class ColumnHeadersCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Afficher",
        value: true
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Couleur du texte",
        value: { value: "#ffffff" }
    });

    backgroundColor = new formattingSettings.ColorPicker({
        name: "backgroundColor",
        displayName: "Couleur de fond",
        value: { value: "#000000" }
    });

    fontFamily = new formattingSettings.FontPicker({
        name: "fontFamily",
        displayName: "Police",
        value: "Segoe UI, wf_segoe-ui_normal, helvetica, arial, sans-serif"
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Taille",
        value: 12,
        options: {
            minValue: { type: ValidatorType.Min, value: 4 },
            maxValue: { type: ValidatorType.Max, value: 60 }
        }
    });

    bold = new formattingSettings.ToggleSwitch({
        name: "bold",
        displayName: "Gras",
        value: true
    });

    italic = new formattingSettings.ToggleSwitch({
        name: "italic",
        displayName: "Italique",
        value: false
    });

    marginTop = new formattingSettings.NumUpDown({
        name: "marginTop",
        displayName: "Marge au-dessus",
        value: 4,
        options: {
            minValue: { type: ValidatorType.Min, value: 0 },
            maxValue: { type: ValidatorType.Max, value: 200 }
        }
    });

    marginBottom = new formattingSettings.NumUpDown({
        name: "marginBottom",
        displayName: "Marge en dessous",
        value: 8,
        options: {
            minValue: { type: ValidatorType.Min, value: 0 },
            maxValue: { type: ValidatorType.Max, value: 200 }
        }
    });

    name: string = "columnHeaders";
    displayName: string = "Titres de colonnes";
    slices = [
        this.show,
        this.fontColor,
        this.backgroundColor,
        this.fontFamily,
        this.fontSize,
        this.bold,
        this.italic,
        this.marginTop,
        this.marginBottom
    ];
}

/**
 * Carte "Valeurs des liens" — étiquettes de valeur (+ unité) au centre des liens.
 */
class LinkValueLabelsCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Afficher la valeur du flux",
        value: false
    });

    unitText = new formattingSettings.TextInput({
        name: "unitText",
        displayName: "Unité (si aucun champ Unité)",
        value: "",
        placeholder: "ex. t, tonnes, €…"
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Couleur du texte",
        value: { value: "#222222" }
    });

    fontFamily = new formattingSettings.FontPicker({
        name: "fontFamily",
        displayName: "Police",
        value: "Segoe UI, wf_segoe-ui_normal, helvetica, arial, sans-serif"
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Taille",
        value: 10,
        options: {
            minValue: { type: ValidatorType.Min, value: 4 },
            maxValue: { type: ValidatorType.Max, value: 60 }
        }
    });

    bold = new formattingSettings.ToggleSwitch({
        name: "bold",
        displayName: "Gras",
        value: false
    });

    italic = new formattingSettings.ToggleSwitch({
        name: "italic",
        displayName: "Italique",
        value: false
    });

    name: string = "linkValueLabels";
    displayName: string = "Valeurs des liens";
    slices = [
        this.show,
        this.unitText,
        this.fontColor,
        this.fontFamily,
        this.fontSize,
        this.bold,
        this.italic
    ];
}

/**
 * Modèle de mise en forme du visuel.
 */
export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    links = new LinksCardSettings();
    nodes = new NodesCardSettings();
    nodeLabels = new NodeLabelsCardSettings();
    columnHeaders = new ColumnHeadersCardSettings();
    linkValueLabels = new LinkValueLabelsCardSettings();

    cards = [
        this.links,
        this.nodes,
        this.nodeLabels,
        this.columnHeaders,
        this.linkValueLabels
    ];
}
