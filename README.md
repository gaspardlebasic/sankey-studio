# Sankey Studio (application de bureau)

> L'application vit **à la racine du dépôt**. Le visuel personnalisé Power BI dont elle
> réutilise le moteur de rendu est dans [`powerbi-visual/`](powerbi-visual/).

Éditeur graphique de diagrammes de flux (Sankey), destiné à devenir une application
compilée macOS (puis Windows/Linux). Réutilise le moteur de rendu du visuel Power BI.

## Où on en est (étapes 1–2 réalisées)

- ✅ **Éditeur graphique** : créer des nœuds (bouton « + Nœud » ou double-clic sur le fond),
  les déplacer, les relier (mode « Lier » : clic origine → clic destination), affecter une
  **colonne** et un **intitulé** à chaque nœud.
- ✅ **Édition aimantée sur une grille** : les nœuds se placent sur une grille **colonnes × ordre
  vertical**. Déplacer un nœud horizontalement change sa **colonne**, verticalement son **ordre**
  (renumérotés automatiquement). Bandes de colonnes + libellés « Colonne N » affichés.
- ✅ **Filtre par filière** : colonne **Filière** dans le tableau des nœuds (Excel + panneau).
  Le panneau « Filières affichées » permet de **choisir quelles filières sont représentées** sur le
  schéma (cases à cocher, « Tout afficher / masquer »). Les nœuds masqués (et leurs liens)
  disparaissent en édition comme en aperçu.
- ✅ **Types de nœuds** : chaque nœud est un **produit / commodité** ou une **industrie / étape**
  (champ « Type » du panneau, colonne **Type** dans Excel). Deux cartes d'apparence — « Produits /
  commodités » et « Industries / étapes » — donnent à chaque type sa **largeur** (0 = le nœud
  disparaît, seul son nom reste), sa **police** (famille, graisse fine→grasse, taille, couleur,
  italique) et un **contour** : un liseré autour du nœud, à l'écart et à l'épaisseur voulus,
  arrondi, en couleur du nœud assombrie ou en noir transparent. Tant qu'une case n'est pas
  cochée, le type suit les réglages généraux — un diagramme existant ne bouge pas d'un pixel.
- ✅ **Export image** : boutons **⇩ PNG** (2×) et **⇩ SVG** (vectoriel) exportent le Sankey de la
  vue en cours. L'aperçu a un **fond blanc**, et la barre de statut est **sous** le canevas
  (ne recouvre jamais le graphique) — pratique pour les captures d'écran.
- ✅ **Palette du design system** : chaque champ couleur propose (bouton ▦) les 17 couleurs
  de la charte (wheat, peach, buckwheat, …) en versions **claire et foncée**.
- ✅ **Déplacement animé** : le nœud saisi suit la souris, les autres nœuds glissent en douceur
  vers leur nouvelle case (liens compris) — l'aimantation sur la grille reste inchangée.
- ✅ **Pastille de couleur** sur chaque nœud en mode édition (couleur effective de l'aperçu).
- ✅ **Renommer un nœud** : double-clic sur le nœud (édition en place) ou champ « Nom » du panneau.
- ✅ **Ajout rapide de nœud lié** : sélectionne un nœud → un bouton **＋** apparaît à sa droite →
  clic = nouveau nœud lié (colonne +1) avec édition immédiate du nom.
- ✅ **Canevas défilable** en mode édition quand les nœuds dépassent de l'écran.
- ✅ **Annuler / Rétablir** : **Cmd+Z** / **Cmd+Shift+Z** (déplacements, ajouts, suppressions,
  renommages, éditions de propriétés). Suppr/Retour arrière supprime l'élément sélectionné.
- ✅ **Aperçu Sankey en direct** (bouton « Aperçu ») : rendu complet porté depuis le visuel
  Power BI (colonnes, titres blanc/noir, courbes, dégradés, centrage vertical, étiquettes…).
- ✅ **Panneau d'apparence** : type de courbe, opacité, couleurs, dégradé départ→arrivée,
  couleur = 1er lien sortant, position des étiquettes, titres de colonnes, etc.
- ✅ **Projet** : enregistrer / ouvrir un fichier `.sankey` (JSON), autosauvegarde locale.
- ✅ **Application Electron** qui se lance et charge l'interface.

- ✅ **Pont Excel (écriture)** — bouton **⇄ Excel** : écrit un onglet avec **deux tableaux
  Excel** côte à côte (« Noeuds » et « Liens »), en **préservant les autres onglets** du
  classeur (formules, graphiques…) grâce à une écriture ciblée du `.xlsx`.

### Structure Excel générée (un seul onglet)

| Tableau **Noeuds** | Tableau **Liens** |
|---|---|
| Filière · Noeud · Numéro de colonne d'affichage · Intitulé de la colonne d'affichage · Ordre vertical d'affichage · Couleur · ID · Couloir · Type | Filière · Origine · Destination · Valeur du flux · Unité · ID origine · ID destination |

- La **mise en forme appliquée dans Excel est conservée** quand l'app réécrit l'onglet :
  style des tableaux, largeurs de colonnes, hauteurs de lignes, formats de nombres,
  couleurs/gras de cellules. L'app n'impose sa mise en forme qu'à la création du classeur.
- **Aucune écriture pendant qu'Excel a le classeur ouvert** : l'app diffère l'écriture
  jusqu'à sa fermeture (sinon la sauvegarde Excel écraserait les modifications de l'app).

- La colonne **Type** vaut « Produit » ou « Industrie », en clair : un produit est une
  commodité qui circule, une industrie l'étape de transformation ou de commercialisation qui
  la fait circuler. Chaque type a sa largeur, sa police et son contour dans l'app.
- La **couleur** est portée par le nœud ; un lien prend la couleur de son nœud d'origine.
- L'**ordre vertical** (par nœud) fixe l'empilement dans la colonne.
- Un **lien est identifié par le couple (ID origine, ID destination)** — pas d'identifiant
  « externe » : tout vit dans l'Excel. **Aucun doublon** de lien n'est autorisé.
- Le **numéro de colonne est un minimum** : si un lien relie deux nœuds de la même colonne,
  le nœud d'arrivée est automatiquement décalé d'une colonne vers la droite (flux toujours
  valide, jamais de plantage d'affichage).
- Colonnes **ID** (masquables) pour une synchro fiable app ↔ Excel.

Le panneau **Synchronisation Excel** permet d'**ouvrir un classeur existant** (charge son
diagramme) ou d'en **créer un nouveau**, puis de synchroniser dans les deux sens.

- 📋 **Copier les données Excel** : met les deux tableaux (Nœuds · colonne vide · Liens, en-têtes
  compris) dans le presse-papier, à **coller en A1** de l'onglet `Diagramme`. La colonne
  « Valeur du flux » reprend les **formules** du classeur (`=Autre onglet!B12*1000`), pas leurs
  résultats. C'est la voie **manuelle** : l'app n'écrit plus dans Excel en tâche de fond, seuls les
  boutons ⬆︎/⬇︎ et cette copie déclenchent un échange.

- ✅ **Relecture + synchro bidirectionnelle** — panneau **Synchronisation Excel** (barre latérale)
  qui affiche le **classeur connecté** et propose les deux sens :
  - **⬆︎ App → Excel** : écrit la structure de l'app (les valeurs saisies dans Excel sont conservées) ;
  - **⬇︎ Excel → App** : remplace le diagramme par le contenu du classeur.
  Le classeur est **surveillé** : à chaque sauvegarde dans Excel, l'app réimporte automatiquement
  (sauf si des modifications locales sont en attente — un message invite alors à choisir le sens).
  Les **valeurs de flux calculées par une formule** (liées au reste du classeur) sont **préservées**
  à l'écriture — seules les autres propriétés (unité, couleur, colonne…) sont mises à jour.
  Réconciliation **par ID** : lignes modifiées mises à jour, lignes ajoutées dans Excel créées
  (ID attribué + réécrit), lignes supprimées retirées de l'app. La **valeur d'un lien devient en
  lecture seule dans l'app** une fois lié (saisie côté Excel). Écriture **différée** si Excel tient
  le classeur ouvert (détection du verrou `~$…`).
  - **Avertissement** avant d'importer depuis Excel si des modifications locales non écrites
    seraient écrasées.
- ✅ **Enregistrer** réécrit le fichier projet ouvert **sans redemander** (mémorisé, même après
  redémarrage) ; **Cmd+S** ; **Enregistrer sous…** pour choisir un nouveau fichier.

- ✅ **Panneau d'apparence complet** — toutes les options de mise en forme, portées depuis le
  visuel Power BI, en **cartes repliables** : Liens (couleur, dégradé, opacité, type de courbe,
  courbure, bordure + couleur + épaisseur), Nœuds (couleur, largeur, espacement), Étiquettes des
  nœuds (police/taille/couleur/gras/italique, position, afficher la valeur, arrière-plan + opacité,
  retour à la ligne), Titres de colonnes (police, fond, marges), Valeurs des liens (police, unité).
  **Couleur par lien** : chaque lien peut recevoir une couleur propre (sinon il prend celle de son
  nœud d'origine) — sélectionne un lien pour la régler.

- ✅ **Application packagée (.dmg macOS)** — `npm run dist` produit un `.dmg` dans `release/`
  (via electron-builder). Icône dédiée incluse. Build **non signé** pour l'instant.

## Construire le .dmg

```bash
npm run dist        # -> release/Sankey Studio-<version>-arm64.dmg
npm run dist:dir    # variante non compressée (dossier .app), pour tester vite
```

Le build actuel cible **Apple Silicon (arm64)**. Comme il n'est pas signé/notarisé, au premier
lancement macOS affichera un avertissement : **clic droit sur l'app → Ouvrir** (une seule fois).
Pour supprimer complètement l'avertissement, il faudra signer + notariser (compte Apple
Developer, 99 $/an) — configurable ensuite dans le champ `build.mac` de `package.json`.

## À venir

- Signature/notarisation macOS ; builds **Windows (.exe)** et **Linux (AppImage/deb)**
  (ajouter les cibles dans `build` + lancer sur/pour ces plateformes).

## Démarrer

```bash
npm install
npm start      # build le renderer puis lance l'app Electron
```

Pour prévisualiser le rendu dans un navigateur (utile en développement) :

```bash
npm run serve  # sert dist/renderer sur http://localhost:8811
```

## Structure

- `src/main/` — processus principal Electron (`main.js`, `preload.js`) : fenêtre, dialogs
  d'enregistrement/ouverture ; le pont Excel viendra ici.
- `src/renderer/` — interface :
  - `engine.ts` — moteur de rendu Sankey (porté depuis `visual.ts`).
  - `editor.ts` — éditeur (état, nœuds/liens, interactions, panneau, persistance).
  - `types.ts` — modèle de données + options d'apparence.
  - `index.html` / `styles.css` — page et styles.
- `build.mjs` — bundling esbuild du renderer.
