# Prompt de reprise — projet Sankey

> Colle ce document au début d'une nouvelle conversation pour restaurer le contexte.
> Objectif : pouvoir vider la fenêtre de contexte sans perdre le fil.

## Résumé

On développe **deux livrables** dans `/Users/gaspardbenoit/Documents/sankey-studio/` :

1. **`powerbi-visual/`** — un **visuel personnalisé Power BI** (Sankey par colonnes),
   packagé en `.pbiviz` dans `dist/`. **Terminé** (v3.2.0). TypeScript + d3-sankey, API 5.11.
2. **la racine du dépôt** — le **complément Excel « Sankey Studio »** : éditeur graphique de
   diagrammes de flux, dans le classeur ouvert. **C'est le projet actif.**
   L'application de bureau Electron qui l'a précédé **a été retirée** : le complément est
   désormais le produit, et il l'est seul (plus de `src/main/`, plus de `.dmg`/`.exe`, plus de
   fichiers `.sankey`, plus de pilotage d'Excel). Electron ne sert plus que de banc d'essai.

Fichier source de données de référence : `flux lait essai.xlsx` (flux de production laitière).

## Comment travailler (contraintes de vérification)

- Je ne peux pas cliquer dans le ruban d'Excel via l'automatisation.
- `npm test` (128 tests) et `npm run smoke` conduisent l'éditeur par de **vrais** évènements
  souris/clavier dans une fenêtre Electron masquée — Electron n'est là que comme navigateur
  pilotable ; le faux pont est `tests/pont-essai.js`, aux mêmes capacités que le volet.
- Je vérifie le **renderer** via `npm run serve` (http://localhost:8811) dans le navigateur
  intégré, avec le crochet `window.__sankeyTest` (`caps`, `reconcile`, `setSynced`, `model`,
  `amorce`, `refresh`), et les bancs `/volet-essai.html`, `/fenetre-essai.html`,
  `/sonde-essai.html`.
- Pour le **complément Office**, je ne peux pas cliquer dans le ruban d'Excel, mais je vois tout le
  reste : le **journal du serveur** (`npm run addin:serve` écrit une ligne par requête — c'est là
  qu'un 404 de la webview se voit), **AppleScript** pour lire le classeur *ouvert* (valeurs et
  formules, avant/après une écriture du complément), et `screencapture` pour regarder l'écran.
  Piège d'AppleScript : la liste rendue par `get value of range` est séparée par des virgules
  **sans guillemets** — un nom qui contient une virgule casse tout découpage. Comparer sur les
  colonnes **numériques**, ou cellule par cellule.
- Toujours : `npx tsc --noEmit -p tsconfig.json` puis `node build.mjs`.

## Le complément (racine) — architecture

- **Stack** : TypeScript bundlé par **esbuild** (`build.mjs`), sans processus natif. Dépendances
  bundlées : `d3-sankey`, `d3-selection`.
- **Scripts** : `npm run build`, `npm test`, `npm run smoke`, `npm run serve`,
  `npm run addin:install -- --enligne`, `npm run addin:serve`, `npm run addin:manifeste`.
- **Fichiers clés** :
  - `src/renderer/engine.ts` — moteur de rendu Sankey (fond blanc, colonnes, dégradés, courbes,
    étiquettes, centrage vertical…). Porté depuis le visuel Power BI.
  - `src/renderer/editor.ts` — éditeur (état, grille, panneau latéral, synchro Excel, export, undo).
  - `src/renderer/types.ts` — `FlowModel/FlowNode/FlowLink` + `SankeyOptions`.
  - `src/addin/index.ts` / `index.html` — le **volet** : Office.js, le classeur, le courtier
    qui ouvre la fenêtre d'édition, et « Préparer le classeur ».
  - `src/addin/fenetre.ts` / `fenetre.html` — la **fenêtre d'édition** (98 % de l'écran).
  - `src/addin/pont.ts` / `pont-fenetre.ts` — les deux implémentations de `window.desktop`.
  - `src/addin/protocole.ts` — le tunnel volet ↔ fenêtre (sans Office ni DOM, donc éprouvable).
  - `src/addin/excel-office.ts` — l'adaptateur Office.js : lecture/écriture du classeur ouvert.
  - `src/shared/modele-excel.js` — le **schéma du classeur**, source de vérité unique.

## Modèle de données

- **FlowNode** : `id, name, column, title, order, filiere, color, x, y`.
- **FlowLink** : `id, source, target, value, unit, colorOverride?` (`colorOverride` = surcharge
  couleur propre au lien, **app only**, pas dans Excel).
- **Excel** : un onglet `Diagramme`, deux tableaux Excel (ListObjects) côte à côte :
  - **Noeuds** : Noeud · Numéro de colonne d'affichage · Intitulé de la colonne d'affichage ·
    Ordre vertical d'affichage · Filière · Couleur · ID
  - **Liens** : Origine · Destination · Valeur du flux · Unité · ID origine · ID destination
- **Règles importantes** :
  - Un **lien est identifié par le couple (ID origine, ID destination)** — pas de doublon.
  - La **couleur est portée par le nœud** ; un lien prend la couleur de son nœud d'origine
    (ou `colorOverride`, ou dégradé couleur origine → couleur destination si l'option est active).
  - L'**ordre** est par nœud (empilement vertical dans la colonne).
  - Le **numéro de colonne est un minimum** : le moteur décale un nœud d'une colonne vers la droite
    si un lien l'exige (flux gauche→droite valide ; évite un plantage d'affichage de d3-sankey).
  - La **Filière** filtre l'affichage (voir `viewNodes/viewLinks/viewModel` + `hiddenFilieres`).

## Fonctionnalités faites

Éditeur graphique **aimanté sur grille** (colonnes × couloirs × ordre, glisser pour réordonner) ;
aperçu Sankey live, éventuellement **par filière** à échelle commune ; **panneau d'apparence
complet** (cartes repliables : Liens, Nœuds, Étiquettes, Titres, Valeurs des liens) + couleur par
lien ; **types de nœuds** (produit / industrie) avec largeur, police et contour propres ;
**synchro Excel bidirectionnelle et automatique** depuis le classeur ouvert, avec
**préservation des formules** de « Valeur du flux » ; réconciliation par ID ; **filtre par
filière** ; **export PNG/SVG** ; undo/redo (Cmd+Z) ; apparence rangée dans le classeur ;
**préparation d'un classeur nu** (« Préparer le classeur », qui refuse plutôt que d'écraser).

## Pièges rencontrés (à connaître)

- **Octets NULL** : des éditions ont parfois transformé des séparateurs `" "` en octet `0x00`
  (le fichier devient « binary » pour `file`/`grep`, et les correspondances de clés échouent).
  Déjà arrivé 2×. En cas de bug de correspondance de clés inexpliqué : scanner les `\x00` et
  remplacer par un espace.

## À faire (prochaines étapes)

- **Campagne Windows** (`RESULTATS-PHASE-6.md`) : le complément **tourne** sous Windows (installé
  et vérifié le 2026-09-01, VM Parallels + Excel 365 ARM64), mais la grille de mesures — poids du
  tunnel, délais, polices — est vide.
- **Téléversement M365** (`DIFFUSION.md` §3) : demande un administrateur du tenant. En attendant,
  l'installation se fait poste par poste (`npm run addin:install -- --enligne`).
- Visuel Power BI : dédoubler l'« Ordre d'affichage des liens » en **ordre de départ / d'arrivée**
  (discuté, non implémenté ; l'app le contourne via l'ordre par nœud).

## Mémoire persistante

Le détail par phase vit dans mes fichiers de mémoire (chargés à chaque session) :
`sankey-desktop-app.md` (app + décisions + gotchas), `sankey-visual-ordering-open.md`
(feature ouverte du visuel Power BI).
