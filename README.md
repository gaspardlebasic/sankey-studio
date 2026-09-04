# Sankey Studio (complément Excel)

> Le complément vit **à la racine du dépôt**. Le visuel personnalisé Power BI dont il réutilise
> le moteur de rendu est dans [`powerbi-visual/`](powerbi-visual/).

Éditeur graphique de diagrammes de flux (Sankey) **dans Excel**. Le diagramme vit dans le
classeur — deux tableaux sur un onglet `Diagramme` — et le complément l'édite au canevas, dans
les deux sens : ce qui est dessiné part dans les tableaux, ce qui est saisi dans les tableaux
revient au dessin.

Il n'y a **pas d'application à installer** : deux pages web, servies en HTTPS, qu'Excel héberge.
Rien du classeur ne transite par l'hébergeur — le complément parle au classeur ouvert, sur le
poste.

## Installer

```bash
npm install
npm run addin:install -- --enligne
```

Puis quitter Excel **complètement**, le rouvrir, ouvrir le classeur, et cliquer
*Accueil ▸ Diagramme de flux*. Détails et variantes (déploiement M365, mode développement,
retrait) dans [DIFFUSION.md](DIFFUSION.md).

## Comment ça se présente

Le **volet** tient Office.js et le classeur ; il ouvre une **fenêtre d'édition** à 98 % de
l'écran, où vit l'éditeur — un volet de 755 px ne suffit pas à un diagramme qui en fait 1 362.
Sur un Excel sans `DialogApi 1.2`, l'éditeur reste dans le volet.

## Ce que fait l'éditeur

- **Édition aimantée sur une grille** colonnes × ordre vertical, avec des **couloirs**
  (3ᵉ coordonnée de placement). Déplacer un nœud change sa case ; les autres glissent en douceur.
- **Créer et relier** : « ＋ Nœud », double-clic sur le fond, ou le bouton **＋** d'un nœud
  sélectionné (nouveau nœud déjà relié). Un point de liaison sur chaque bord d'un nœud
  sélectionné : tirer à droite crée un lien sortant, à gauche un lien entrant.
- **Renommer** par double-clic, en place.
- **Annuler / Rétablir** : Cmd+Z / Cmd+Shift+Z. Suppr retire l'élément sélectionné.
- **Filtre par filière** : le panneau « Filières affichées » choisit ce qui est représenté.
- **Types de nœuds** — **produit / commodité** ou **industrie / étape**. Chaque type a sa
  largeur (0 = le nœud disparaît, seul son nom reste), sa police et son contour. Tant qu'une
  case n'est pas cochée, le type suit les réglages généraux : un diagramme existant ne bouge pas
  d'un pixel.
- **Aperçu Sankey en direct**, porté du visuel Power BI : colonnes, courbes, dégradés, centrage
  vertical, étiquettes. Option « par filière » : un Sankey par filière, empilés, avec une échelle
  commune si on la demande.
- **Panneau d'apparence** en cartes repliables : liens (couleur, dégradé, opacité, courbure,
  bordure), nœuds, étiquettes, titres de colonnes, valeurs des liens, marges du graphique.
  **Couleur par lien** possible, sinon le lien prend celle de son nœud d'origine.
- **Palette de la charte** : chaque champ couleur propose les 17 couleurs du design system
  (wheat, peach, buckwheat, …) en versions claire et foncée.
- **Export image** : ⇩ PNG (2×) et ⇩ SVG, sur le fond transparent.
- **Enregistrer** (Cmd+S) range l'**apparence** dans le classeur (`document.settings`). Le
  diagramme, lui, est déjà dans les tableaux.

## Le classeur

Un onglet `Diagramme`, deux tableaux Excel (ListObjects) côte à côte, séparés par une colonne
vide :

| Tableau **Noeuds** | Tableau **Liens** |
|---|---|
| Filière · Noeud · Numéro de colonne d'affichage · Intitulé de la colonne d'affichage · Ordre vertical d'affichage · Couleur · ID · Couloir · Type | Filière · Origine · Destination · Valeur du flux · Unité · ID origine · ID destination |

- Sur un classeur qui n'a pas encore ces tableaux, le volet propose **« Préparer le classeur »**.
  Il **refuse** plutôt que d'écraser : diagramme déjà présent, feuille du même nom non vide,
  demi-diagramme.
- Les tableaux sont retrouvés **par leurs en-têtes**, sur une seule et même feuille. L'écriture
  se fait **colonne par colonne, par nom d'en-tête** : un autre ordre de colonnes est toléré, et
  une colonne ajoutée par l'utilisatrice n'est pas écrasée.
- Les **valeurs de flux calculées par une formule** (liées au reste du classeur) sont
  **préservées** à l'écriture : seules les autres propriétés sont mises à jour.
- La **mise en forme appliquée dans Excel est conservée** — style des tableaux, largeurs,
  formats de nombres, couleurs.
- Un **lien est identifié par le couple (ID origine, ID destination)**. Aucun doublon autorisé.
- Le **numéro de colonne est un minimum** : si un lien relie deux nœuds de la même colonne, le
  nœud d'arrivée est décalé d'une colonne à droite.
- Le complément **n'enregistre jamais le classeur de lui-même** : Excel le montre comme modifié,
  à l'utilisatrice de décider. `Ctrl-Z` d'Excel ne défait pas nos écritures.

## Synchronisation

Automatique dans les deux sens dès qu'Excel offre `ExcelApi 1.7` : une modification du dessin
part dans les tableaux après 300 ms, une saisie dans les tableaux revient au dessin. Sur un Excel
plus ancien, le panneau affiche une section **« Synchronisation manuelle »** avec deux boutons —
c'est alors le seul chemin.

## Développer

```bash
npm run build   # dist/addin (le produit) + dist/renderer (le banc d'essai)
npm test        # toutes les suites
npm run smoke   # test de fumée de bout en bout
npm run serve   # bancs d'essai dans un navigateur, sur http://localhost:8811
```

Instructions complètes — architecture, règles métier, pièges — dans [AGENTS.md](AGENTS.md).

## Structure

- `src/addin/` — le complément : volet, fenêtre d'édition, adaptateur Office.js, tunnel,
  manifestes, sonde.
- `src/renderer/` — l'éditeur : `engine.ts` (rendu Sankey, porté du visuel Power BI),
  `editor.ts` (état, interactions, panneau), `types.ts`, `ui.ts`, `index.html`, `styles.css`.
- `src/shared/modele-excel.js` — le schéma du classeur, source de vérité unique.
- `tests/` — suites Node, bancs HTML, et les bancs Electron (Electron sert de navigateur
  pilotable, ce n'est pas le produit).
- `build.mjs` — bundling esbuild.
