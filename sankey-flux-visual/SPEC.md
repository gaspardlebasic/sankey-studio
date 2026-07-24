# Prompt de spécification — Module de visualisation Power BI « Sankey Flux (colonnes) »

## Objectif

Crée un **visuel personnalisé Power BI** (custom visual, packagé en `.pbiviz`) affichant un
**diagramme de Sankey** dont les nœuds sont **arrangés de gauche à droite en colonnes**. Le numéro
et l'intitulé de chaque colonne sont définis dans les données. L'apparence doit être **très
largement personnalisable** via le volet de mise en forme.

## Stack technique attendue

- Projet `powerbi-visuals-tools` (pbiviz), **API 5.11**, TypeScript.
- Rendu SVG avec **d3-selection** et **d3-sankey**.
- Volet de propriétés via **powerbi-visuals-utils-formattingmodel** (FormattingModel moderne,
  cartes/slices).
- Infobulles via **powerbi-visuals-utils-tooltiputils**.
- Livrable : le projet source complet + le fichier `.pbiviz` compilé + un README. Le code et les
  libellés de l'interface sont en **français**.

## Format des données (mapping de type `table`)

Chaque **ligne = un flux (lien)** entre une origine et une destination. Champs (data roles) :

| Champ (rôle) | Type | Rôle |
|---|---|---|
| **Origine** | Grouping | Nœud de départ du lien |
| **Destination** | Grouping | Nœud d'arrivée du lien |
| **Numéro de colonne d'affichage** | Grouping/Measure | Position horizontale (numéro de colonne) du nœud **de départ** |
| **Intitulé de colonne** | Grouping | Titre affiché en haut de la colonne du nœud **de départ** (peut être vide) |
| **Valeur du flux** | Measure | Épaisseur du lien |
| **Couleur du lien** | Grouping | Couleur de chaque lien : nom CSS (`red`, `orange`…) ou hex `#RRGGBB` |
| **Ordre d'affichage des liens** | Grouping/Measure | Nombre pilotant l'ordre vertical (haut→bas) des liens partant d'un même nœud |
| **Unité de la valeur** | Grouping/Measure | Texte d'unité (ex. « t ») accolé à la valeur du flux ; optionnel |
| **Infobulle / mesure secondaire** | GroupingOrMeasure (multiple) | Champs additionnels affichés dans l'infobulle (ex. Part en bio, Hypothèses) |

Prévoir un `dataReductionAlgorithm` (`top`, ~30 000 lignes). Fusionner les liens ayant les mêmes
extrémités (somme des valeurs).

## Logique de positionnement des colonnes

1. La colonne d'un nœud provient du **Numéro de colonne** de ses lignes où il est *origine*.
2. **Remapper** les numéros bruts (potentiellement non contigus, ex. 1,2,3,4,5 avec doublons) vers
   des **indices denses 0…K-1** — attention à **dédupliquer** avant de créer la table de
   correspondance (bug classique : les doublons écrasent les indices).
3. Les **nœuds terminaux** (jamais origine, ex. « Consommation », « Exportation ») sont placés dans
   la colonne **suivant** la colonne max de leurs origines.
4. Position horizontale calculée à partir de l'indice de colonne dense (espacement régulier sur la
   largeur), **indépendamment** du calcul de profondeur interne de d3-sankey — d3-sankey ne sert
   qu'à la disposition **verticale** et à l'ordonnancement. Utiliser `nodeAlign(n => n.col)` puis
   **écraser** `x0/x1` après coup.

## Titres de colonnes

- Affichés **en haut du graphique**, au-dessus de chaque colonne, **texte blanc sur fond noir**
  (valeurs par défaut).
- L'intitulé provient de la colonne du nœud de départ. **Si l'intitulé est vide, aucun titre n'est
  affiché** pour cette colonne.
- Le bandeau doit rester **dans les limites du visuel** (clamp horizontal pour les colonnes de bord).

## Centrage vertical

Chaque colonne doit avoir son bloc de nœuds **centré verticalement** : l'espace libre est réparti
**à parts égales en haut et en bas**. Implémenté en décalant, après layout, tous les nœuds d'une
colonne d'un même delta (et les extrémités des liens du delta de leur colonne source/cible pour
préserver la géométrie).

## Ordre d'affichage des liens

Quand le champ **Ordre d'affichage** est fourni : trier les liens de chaque nœud par cette valeur
(`linkSort`) et **figer** l'ordre vertical des nœuds de chaque colonne (`nodeSort`) pour que
l'affichage suive l'ordre demandé (haut→bas, valeur croissante). Sans ce champ, conserver l'ordre
des lignes de l'Excel.

## Options de mise en forme (volet Format)

**Carte « Liens »**
- Couleur par défaut ; *Utiliser la couleur des données* (champ Couleur) ; opacité (%).
- **Dégradé de la couleur du nœud de départ à celle du nœud d'arrivée** : le lien devient un dégradé
  horizontal gauche→droite, allant de la **couleur affichée du nœud de départ** vers la **couleur
  affichée du nœud d'arrivée**. La couleur d'un nœud est celle rendue sur son rectangle (soit la
  couleur fixe des nœuds, soit celle donnée par l'option *Couleur = 1er lien sortant*). Ne pas
  définir le dégradé de la couleur du lien vers le nœud d'arrivée : sur un lien terminal, la couleur
  d'arrivée retombe alors sur celle du lien et le dégradé paraît plat.
- **Type de courbe** : *Courbe* / *Ligne droite* / *Marches* ; **courbure** réglable.
- **Bordure** : activer/désactiver, couleur, épaisseur.

**Carte « Nœuds »**
- Couleur des nœuds ; **Couleur = 1er lien sortant** (le nœud prend la couleur de son premier lien
  sortant) ; largeur des nœuds ; **espacement vertical des nœuds**.

**Carte « Étiquettes des nœuds »**
- Afficher ; police, taille, couleur, gras, italique ; afficher la valeur.
- **Position** : *à côté du nœud* (défaut) ou *en dessous du nœud*.
- **Arrière-plan** : activer, couleur, **opacité (%)**.
- **Retour à la ligne** (word-wrap) : découpe le libellé sur plusieurs lignes au-delà de
  **X caractères** (X réglable), en respectant les mots.

**Carte « Titres de colonnes »**
- Afficher ; couleur du texte (blanc par défaut) ; couleur de fond (noir par défaut) ; police,
  taille, gras, italique.
- **Marges au-dessus / en dessous** (pour aérer le graphique).

**Carte « Valeurs des liens »**
- Afficher la valeur du flux **au centre de chaque lien** ; police, taille, couleur, gras, italique.
- La valeur est **inclinée pour suivre la pente/courbe du lien** (tangente réelle au milieu de la
  courbe ; 0° pour « Marches »).
- Rendue **derrière** les étiquettes de nœuds (ordre d'empilement : liens < nœuds < valeurs des
  liens < étiquettes des nœuds < titres).
- **Unité** : issue du champ *Unité de la valeur* si présent, sinon d'un texte saisi dans l'option.

## Infobulles

Au survol d'un lien : « Origine → Destination », valeur formatée, plus les champs *Infobulle* non
vides.

## Détails de rendu

- Les liens sont des **rubans remplis** (pas de simples traits) pour permettre bordures et dégradés.
- Formatage des grands nombres lisible (k / M / Md, séparateurs FR).
- Le visuel doit se **redimensionner** proprement (recalcul complet à chaque `update`), gérer les cas
  dégénérés (pas de données, viewport minuscule) sans planter.

## Vérification demandée

Avant livraison, **rendre effectivement le diagramme sur des données réalistes** (ex. un flux de
production laitière : Production → Lait → Transformation → {Beurre, Crème, Fromage, Lait
standardisé, Yaourts} → Distribution → {Exportation, Consommation}) et vérifier visuellement :
ordre des colonnes, titres blancs sur noir (et absence de titre quand vide), couleurs par lien,
dégradés, ordre des liens piloté par le champ, centrage vertical, retours à la ligne, étiquettes
(côté/dessous) avec fond translucide, et valeurs inclinées derrière les libellés.
