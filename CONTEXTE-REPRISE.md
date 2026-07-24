# Prompt de reprise — projet Sankey

> Colle ce document au début d'une nouvelle conversation pour restaurer le contexte.
> Objectif : pouvoir vider la fenêtre de contexte sans perdre le fil.

## Résumé

On développe **deux livrables** dans `/Users/gaspardbenoit/Downloads/module power bi sankey/` :

1. **`sankey-flux-visual/`** — un **visuel personnalisé Power BI** (Sankey par colonnes),
   packagé en `.pbiviz` dans `dist/`. **Terminé** (v3.2.0). TypeScript + d3-sankey, API 5.11.
2. **`sankey-app/`** — une **application de bureau Electron « Sankey Studio »** : éditeur graphique
   de diagrammes de flux synchronisé avec Excel. **C'est le projet actif.** Les 6 phases prévues
   sont faites + fonctionnalités supplémentaires (filière, export image).

Fichier source de données de référence : `flux lait essai.xlsx` (flux de production laitière).

## Comment travailler (contraintes de vérification)

- Je ne peux pas piloter la fenêtre Electron ni les boîtes de dialogue natives via l'automatisation.
- Donc je vérifie le **renderer** via `npm run serve` (sert `dist/renderer` sur http://localhost:8811)
  ouvert dans le navigateur intégré, avec le crochet de test `window.__sankeyTest`
  (`reconcile`, `setSynced`, `model`, `refresh`).
- Je vérifie **`excel.js`** en **Node + openpyxl** (openpyxl est installé, c'est un validateur fiable).
- Je vérifie le **démarrage Electron** avec `npx electron .` en cherchant les erreurs dans les logs.
- Toujours : `npx tsc --noEmit -p tsconfig.json` puis `node build.mjs`.

## sankey-app — architecture

- **Stack** : Electron + TypeScript ; renderer bundlé par **esbuild** (`build.mjs`) ; process
  principal en `src/main/*.js` ; renderer en `src/renderer/*.ts`. Dépendances : `jszip` (Excel),
  `d3-sankey`, `d3-selection` (bundlées).
- **Scripts** : `npm start` (build + electron), `npm run serve` (dev navigateur), `npm run dist`
  (.dmg), `npm run dist:dir` (dossier .app non compressé).
- **Fichiers clés** :
  - `src/renderer/engine.ts` — moteur de rendu Sankey (fond blanc, colonnes, dégradés, courbes,
    étiquettes, centrage vertical…). Porté depuis le visuel Power BI.
  - `src/renderer/editor.ts` — éditeur (état, grille, panneau latéral, synchro Excel, export, undo).
  - `src/renderer/types.ts` — `FlowModel/FlowNode/FlowLink` + `SankeyOptions`.
  - `src/main/main.js` — IPC : projet (save/open), Excel (choose/openExisting/read/write/watch),
    `export:save`.
  - `src/main/excel.js` — écriture/lecture `.xlsx` par **manipulation ciblée du zip** (JSZip),
    en préservant les autres onglets.

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

## Fonctionnalités faites (sankey-app)

Éditeur graphique **aimanté sur grille** (colonnes × ordre, glisser pour réordonner) ; aperçu Sankey
live ; **panneau d'apparence complet** (cartes repliables : Liens, Nœuds, Étiquettes, Titres,
Valeurs des liens) + couleur par lien ; **synchro Excel bidirectionnelle** (pull/push, surveillance
du fichier, écriture différée si Excel a le verrou `~$…`, **préservation des formules** de « Valeur
du flux ») ; réconciliation par ID ; **filtre par filière** ; **export PNG/SVG** ; fond blanc en
aperçu + barre de statut sous le canevas ; undo/redo (Cmd+Z) ; « Enregistrer » qui réécrit sans
redemander ; ouverture d'un classeur existant ; **packaging `.dmg` macOS** (arm64, non signé) via
electron-builder.

## Pièges rencontrés (à connaître)

- **electron-builder** épinglé à **24.13.3** (la 26.x plante : `ERR_REQUIRE_ESM` sur
  `@noble/hashes/blake2.js`).
- **Icône** : PNG brut → `sips` (redimension) → `iconutil` (.icns). Attention : **zsh ne découpe
  pas `$var` en mots** → une boucle `for … set -- $pair` échoue ; appeler `sips` taille par taille.
- **Octets NULL** : des éditions ont parfois transformé des séparateurs `" "` en octet `0x00`
  (le fichier devient « binary » pour `file`/`grep`, et les correspondances de clés échouent).
  Déjà arrivé 2×. En cas de bug de correspondance de clés inexpliqué : scanner les `\x00` et
  remplacer par un espace.

## À faire (prochaines étapes)

- **Signature + notarisation** macOS (compte Apple Developer ; actuellement `identity: null` →
  clic droit → Ouvrir au 1er lancement). Puis builds **Windows (.exe)** et **Linux (AppImage/deb)**.
- Visuel Power BI : dédoubler l'« Ordre d'affichage des liens » en **ordre de départ / d'arrivée**
  (discuté, non implémenté ; l'app le contourne via l'ordre par nœud).

## Mémoire persistante

Le détail par phase vit dans mes fichiers de mémoire (chargés à chaque session) :
`sankey-desktop-app.md` (app + décisions + gotchas), `sankey-visual-ordering-open.md`
(feature ouverte du visuel Power BI).
