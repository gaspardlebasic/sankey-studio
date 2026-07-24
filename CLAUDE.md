# CLAUDE.md — module Power BI Sankey

Ce dépôt contient **deux livrables** autour du même moteur de rendu Sankey.
Réponds en **français** (l'utilisateur travaille en français).

## Les deux projets

| Dossier | Quoi | État |
|---|---|---|
| `sankey-flux-visual/` | **Visuel personnalisé Power BI** (Sankey par colonnes), packagé en `.pbiviz` dans `dist/`. TypeScript + d3-sankey, API pbiviz 5.11. | Terminé (v3.2.0) |
| `sankey-app/` | **Application de bureau Electron « Sankey Studio »** : éditeur graphique de diagrammes de flux synchronisé avec Excel. Réutilise le moteur du visuel Power BI. | **Projet actif** — phases 1–6 faites |

Jeu de données de référence : `flux lait essai.xlsx` (flux de production laitière).
Un prompt de reprise détaillé existe dans `CONTEXTE-REPRISE.md`.

---

## sankey-app (projet actif)

### Stack & structure
- **Electron + TypeScript**. Process principal en `src/main/*.js`, renderer en `src/renderer/*.ts`.
- Renderer bundlé par **esbuild** (`build.mjs`). Dépendances bundlées : `jszip`, `d3-sankey`, `d3-selection`.
- Fichiers clés :
  - `src/renderer/engine.ts` — moteur de rendu Sankey (porté du visuel Power BI) : fond blanc, colonnes, dégradés, courbes, étiquettes, centrage vertical.
  - `src/renderer/editor.ts` — éditeur : état, grille aimantée, panneau latéral, synchro Excel, export, undo/redo.
  - `src/renderer/types.ts` — `FlowModel/FlowNode/FlowLink` + `SankeyOptions`.
  - `src/main/main.js` — IPC : projet (save/open), Excel (choose/openExisting/read/write/watch), `export:save`.
  - `src/main/excel.js` — lecture/écriture `.xlsx` par **manipulation ciblée du zip** (JSZip), en préservant les autres onglets et les formules.
  - `src/main/preload.js` — pont `contextBridge` (`window.desktop`).

### Scripts
```bash
npm start        # build le renderer + lance Electron
npm run serve    # sert dist/renderer sur http://localhost:8811 (dev navigateur)
npm run dist     # -> release/Sankey Studio-<version>-arm64.dmg
npm run dist:dir # dossier .app non compressé (test rapide)
```
Avant de builder : `npx tsc --noEmit -p tsconfig.json` puis `node build.mjs`.

### Modèle de données
- **FlowNode** : `id, name, column, title, order, filiere, color, x, y`.
- **FlowLink** : `id, source, target, value, unit, colorOverride?`
  (`colorOverride` = surcharge couleur propre au lien, **app only**, absente de l'Excel).
- **Excel** : un onglet `Diagramme`, deux tableaux Excel (ListObjects) côte à côte :
  - **Noeuds** : Filière · Noeud · Numéro de colonne d'affichage · Intitulé de la colonne d'affichage · Ordre vertical d'affichage · Couleur · ID
  - **Liens** : Origine · Destination · Valeur du flux · Unité · ID origine · ID destination
  - La lecture est indexée par **nom d'entête** (l'ordre des colonnes peut varier).
  - À la réécriture, la **mise en forme utilisateur est préservée** (`preserve` dans
    `updateExistingWorkbook` : styles de cellules `s=`, hauteurs de lignes, `<cols>`,
    `tableStyleInfo`) — attention aux attributs à préfixe (`x14ac:` …) qu'il faut retirer.

### Règles métier (importantes)
- Un **lien est identifié par le couple (ID origine, ID destination)** — jamais de doublon.
- La **couleur est portée par le nœud** ; un lien prend la couleur de son nœud d'origine
  (ou `colorOverride`, ou dégradé origine→destination si l'option est active).
- L'**ordre** est par nœud (empilement vertical dans la colonne).
- Le **numéro de colonne est un minimum** : le moteur calcule le `layer` de chaque nœud par plus
  long chemin et décale un nœud d'une colonne à droite si un lien l'exige (flux gauche→droite
  toujours valide). Ça évite un plantage d3-sankey (colonne finale vide → « Cannot read 'sort' »).
  Le layout est aussi enveloppé dans un try/catch → message clair au lieu d'un écran blanc.
- La **Filière** filtre l'affichage : `viewNodes/viewLinks/viewModel` + `hiddenFilieres`.
- Les **valeurs de flux** vivent **uniquement dans Excel** (formules préservées à l'écriture) ;
  l'apparence vit dans l'app (projet `.sankey` JSON).

### Synchro Excel
- Non-simultanée : l'app écrit quand le fichier est libre, **diffère** si Excel tient le verrou
  (`~$<base>`), re-lit à la sauvegarde Excel (fs.watch, self-write supprimé via `lastWriteTs`).
  **Ne jamais écrire pendant que le verrou est présent** : sur macOS l'écriture réussit sur le
  disque mais Excel écrase tout à sa prochaine sauvegarde (c'était la cause de la « perte des
  couleurs »). `excel:write` renvoie `locked` → écriture différée (`pendingExcelWrite`).
- Bidirectionnelle : `⬆︎ App→Excel` (préserve les valeurs Excel), `⬇︎ Excel→App` (avertit si des
  modifs locales seraient écrasées). Réconciliation **par ID** avec `syncedNodeIds/syncedLinkIds`.
- `extractValueFormulas` relit les cellules « Valeur du flux » contenant `<f>` et `buildModelRows`
  les ré-émet comme cellules formule.

### Vérification (contraintes)
Je **ne peux pas** piloter la fenêtre Electron ni les dialogues natifs via l'automatisation. Donc :
- **renderer** : `npm run serve` + navigateur intégré + crochet `window.__sankeyTest`
  (`reconcile`, `setSynced`, `model`, `refresh`).
- **excel.js** : Node + **openpyxl** (installé, validateur fiable) — round-trip.
- **démarrage Electron** : `npx electron .` en cherchant les erreurs dans les logs.

### Pièges à connaître
- **electron-builder épinglé à 24.13.3** — la 26.x plante (`ERR_REQUIRE_ESM` sur
  `@noble/hashes/blake2.js`).
- **Icône** : PNG → `sips` → `iconutil` (.icns). **zsh ne découpe pas `$var` en mots** →
  les boucles `for … set -- $pair` échouent ; appeler `sips` taille par taille.
- **Octets NULL** : des éditions ont déjà transformé des séparateurs `" "` en `0x00` (le fichier
  devient « binary » pour `file`/`grep -a`, les correspondances de clés échouent). Déjà arrivé 2×.
  En cas de bug de clés inexpliqué : scanner les `\x00`, remplacer par un espace.

### À faire
- **Signature + notarisation** macOS (actuellement `identity: null` → clic droit → Ouvrir au
  1er lancement). Puis builds **Windows (.exe)** et **Linux (AppImage/deb)**.

---

## sankey-flux-visual (terminé, contexte)
- Visuel Power BI Sankey par colonnes, TypeScript + d3-sankey, API pbiviz 5.11, packagé `.pbiviz`.
- Feature ouverte (non implémentée) : dédoubler l'« Ordre d'affichage des liens » en **ordre de
  départ / d'arrivée**. L'app de bureau contourne ça via l'ordre par nœud.

---

## Mémoire persistante
Le détail par phase vit dans les fichiers de mémoire (chargés à chaque session) :
`sankey-desktop-app.md` (app + décisions + gotchas), `sankey-visual-ordering-open.md`.
