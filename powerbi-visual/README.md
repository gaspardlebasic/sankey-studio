# Sankey Flux (colonnes) — Visuel personnalisé Power BI

Diagramme de Sankey dont les nœuds sont arrangés **de gauche à droite en colonnes**,
avec un numéro et un intitulé de colonne définis directement dans les données.
Conçu pour le format du fichier `flux lait essai.xlsx`.

## Installation dans Power BI

1. Ouvrir le package : `dist/sankeyFluxVisual80a0d7a675784b43a016497c425ccd1a.1.0.0.0.pbiviz`
2. Dans Power BI Desktop : volet **Visualisations** → **…** → **Importer un visuel à partir d'un fichier** → sélectionner le `.pbiviz`.

## Mappage des champs (correspond aux colonnes de l'Excel)

| Champ du visuel | Colonne Excel |
|---|---|
| **Origine** | `Origine` (A) |
| **Destination** | `Destination` (B) |
| **Numéro de colonne d'affichage** | `Numéro de colonne d'affichage de départ` (D) |
| **Intitulé de colonne** | `Intitulé de la colonne d'affichage de départ` (C) |
| **Valeur du flux** | `Valeur du flux en tonnes` (E) |
| **Couleur du lien** | `Couleur` (G) |
| **Ordre d'affichage des liens** | *nouvelle colonne à ajouter* (nombre) |
| **Unité de la valeur** | *nouvelle colonne / mesure* (ex. « t ») — optionnel |
| **Infobulle / mesure secondaire** | `Part en bio` (F) et/ou `Hypothèses` (H) |

> **Ordre d'affichage des liens** : ajoutez une colonne numérique dans l'Excel (ex. `Ordre`)
> et placez-la dans ce champ. Les liens partant d'un même nœud sont affichés de haut en bas
> par valeur croissante. Sans ce champ, l'ordre suit les lignes de l'Excel.

- Chaque **ligne = un flux** (lien) entre une origine et une destination.
- La **position horizontale** d'un nœud vient du *numéro de colonne* de ses lignes « origine ».
  Les nœuds terminaux (jamais origine) sont placés dans la colonne suivante.
- L'**intitulé de colonne** s'affiche en haut du graphique, au-dessus de la colonne
  correspondante, **en blanc sur fond noir**. Si l'intitulé est **vide**, aucun titre n'est affiché.

## Personnalisation (volet Format)

- **Liens** : couleur par défaut, *utiliser la couleur des données* (colonne `Couleur`),
  **dégradé vers la couleur d'arrivée** (de la couleur du champ vers la couleur du nœud cible),
  opacité, **type de courbe** (Courbe / Ligne droite / Marches), courbure,
  **bordure** (activer/désactiver, couleur, épaisseur).
- **Nœuds** : couleur, **couleur = 1er lien sortant**, largeur, **espacement vertical des nœuds**.
- **Étiquettes des nœuds** : afficher, police, taille, couleur, gras, italique, afficher la valeur,
  **position** (à côté / en dessous du nœud), **arrière-plan** (activer + couleur + **opacité**),
  **retour à la ligne** au-delà de X caractères (réglable).
- **Titres de colonnes** : afficher, couleur du texte (blanc par défaut),
  couleur de fond (noir par défaut), police, taille, gras, italique,
  **marges au-dessus / en dessous** (pour aérer le graphique).
- **Valeurs des liens** : afficher la valeur du flux **au centre de chaque lien, inclinée
  selon la courbe et derrière les étiquettes de nœuds**, avec **unité**
  (champ *Unité* ou texte saisi), police, taille, couleur, gras, italique.

> **Dégradé des liens** : nécessite en général d'activer aussi *Nœuds → Couleur = 1er lien sortant*,
> car la couleur d'arrivée du dégradé est la couleur du nœud cible calculée par cette règle.

## Développement

```bash
npm install
npm start      # pbiviz start (aperçu en direct)
npm run package # génère le .pbiviz dans dist/
```

Les couleurs de la colonne `Couleur` acceptent les noms CSS (`red`, `orange`, `blue`…)
ou les codes hexadécimaux `#RRGGBB`.
