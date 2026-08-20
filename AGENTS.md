# AGENTS.md — module Power BI Sankey

Instructions de projet pour les agents de codage (Claude Code, Mistral Vibe, …) **et** pour
les humains. Fichier de référence unique : `CLAUDE.md` ne fait que pointer ici.
Réponds en **français** (l'utilisateur travaille en français).

## Démarrage rapide

```bash
cd sankey-app
npm install          # une seule fois
npm start            # build du renderer + lancement d'Electron
npm run smoke        # test de fumée de bout en bout (16 vérifications)
npm run install:app  # reconstruit et remplace /Applications/Sankey Studio.app (macOS)
```

Avant de proposer un changement : `npx tsc --noEmit -p tsconfig.json`, puis `npm test` et
`npm run smoke`.

## Vérifier une fonctionnalité

La fenêtre Electron et les dialogues natifs **ne sont pas pilotables** par automatisation.
Trois moyens, du plus au moins pratique :

1. **`npm test`** — suite des fonctionnalités d'édition (`tests/run.js`), sur un diagramme
   complexe : deux filières dont une masquée, ordres qui se télescopent entre filières, noms
   de nœuds en double, canevas qui déborde. **Ajoute-y un test pour toute fonctionnalité
   d'édition** ; `npm test -- liaison` filtre par nom.
   - Les assertions mesurent la **géométrie réellement peinte**
     (`el.querySelector('.node-box').getBoundingClientRect()`). Ne jamais recalculer un point
     de clic à partir du modèle : on reproduirait la formule de l'app et un décalage entre le
     dessin et le test passerait inaperçu.
   - Les nœuds portent un `data-id` dans le DOM : s'en servir pour les retrouver.
   - Pour tester une saisie, `typeField` frappe **caractère par caractère** — c'est ainsi qu'on
     détecte un gestionnaire qui reconstruit le panneau et fait perdre le focus.
   - Piège : un accent grave mal échappé dans `tests/helpers.js` casse le code injecté et
     laisse Electron bloqué sur une boîte d'erreur. Le runner en garde le contrôle au démarrage.
2. **`npm run smoke`** — test de fumée plus large (barre d'outils, bascule Aperçu, titre de la
   fenêtre, garde-fou Excel), même technique, via le crochet `window.__sankeyTest`
   (`model`, `nodeCount`, `loadProject`, `links`, `selection`, `hidden`, `setExcelLocked`,
   `setExcelPath`, `prefs`, `reconcile`, `setSynced`, `refresh`).
3. **`npm run verifier -- "fichier.sankey"`** — diagnostic statique d'un projet : identifiants
   en double, compteur périmé, liens orphelins ou dupliqués.
4. **`npm run serve`** — sert `dist/renderer` sur <http://localhost:8811> ; un navigateur
   (ou un MCP de navigateur, cf. plus bas) permet d'inspecter et de piloter la page.
5. **`src/main/excel.js`** — se teste en Node, avec **openpyxl** comme validateur de
   round-trip sur un `.xlsx` réel.

Le pilotage d'Excel (`src/main/excel-control.js`) se valide sans envoyer d'Apple event :
`osacompile -o /dev/null script.applescript` vérifie la syntaxe *et* le dictionnaire Excel.

## Piloter le navigateur depuis l'agent (MCP)

Mistral Vibe lit ses serveurs MCP dans `~/.vibe/config.toml`. Pour inspecter le rendu servi
par `npm run serve` :

```toml
[[mcp_servers]]
name = "playwright"
transport = "stdio"
command = "npx"
args = ["-y", "@playwright/mcp@latest"]
```

Les outils apparaissent ensuite sous `playwright_*`. Au premier usage réel, Playwright a
besoin d'un navigateur : `npx playwright install chrome` (une seule fois).

Vibe ne gère pas les serveurs MCP en OAuth : s'en tenir à `stdio` ou à une clé statique.
Le dossier du projet doit être déclaré de confiance (`~/.vibe/trusted_folders.toml`) pour que
ce fichier soit chargé — Vibe le demande au premier lancement dans le dossier.

Le MCP n'est **pas nécessaire** pour valider une modification : `npm run smoke` couvre le
parcours d'édition sans navigateur. Le MCP sert à regarder le rendu et à explorer.

---

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
  - `src/main/excel-control.js` — pilotage d'Excel (enregistrer + fermer un classeur) :
    AppleScript sur macOS, COM/PowerShell sur Windows.
  - `src/renderer/ui.ts` — modales et sélecteur de couleurs en surcouche (grille teintes × nuances).
  - `src/main/preload.js` — pont `contextBridge` (`window.desktop`).

### Scripts
```bash
npm start           # build le renderer + lance Electron
npm test            # tests des fonctionnalités d'édition (diagramme complexe)
npm test -- liaison # filtre les tests par nom
npm run smoke       # test de fumée (barre d'outils, aperçu, titre, garde-fou Excel)
npm run verifier -- "Fichier.sankey"   # diagnostic d'un projet
npm run serve       # sert dist/renderer sur http://localhost:8811 (dev navigateur)
npm run install:app # build + remplace /Applications/Sankey Studio.app
npm run dist        # -> release/Sankey Studio-<version>-arm64.dmg
npm run dist:dir    # dossier .app non compressé (test rapide)
npm run dist:win    # -> installeur NSIS + portable Windows
```
`install:app` ferme Sankey Studio si elle tourne (autorisé par l'utilisateur) puis installe.
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
- **Les identifiants doivent être uniques, sans exception.** `nodeById`, le registre `nodeEls`
  et le rendu des liens travaillent par identifiant : un doublon fait raccrocher les liens au
  mauvais nœud et donne l'impression d'une application « complètement buguée ». Le compteur
  enregistré dans un projet n'est **jamais** cru sur parole (`Math.max(idCounter, guessCounter())`),
  `newId()` saute les identifiants déjà pris, `repairDuplicateIds()` renumérote un fichier déjà
  abîmé à l'ouverture, et `syncCounterWithModel()` rattrape les identifiants venus d'Excel.
- **Aucun gestionnaire de champ texte ne doit appeler `buildSidebar()` à chaque frappe** : le
  panneau serait reconstruit et le champ perdrait le focus dès le 1er caractère. Utiliser le
  4e argument `onCommit` de `textField` (évènement `change`).
- La **couleur est portée par le nœud** ; un lien prend la couleur de son nœud d'origine
  (ou `colorOverride`, ou dégradé origine→destination si l'option est active).
- L'**ordre** est par nœud (empilement vertical dans la colonne).
- Le **numéro de colonne est un minimum** : le moteur calcule le `layer` de chaque nœud par plus
  long chemin et décale un nœud d'une colonne à droite si un lien l'exige (flux gauche→droite
  toujours valide). Ça évite un plantage d3-sankey (colonne finale vide → « Cannot read 'sort' »).
  Le layout est aussi enveloppé dans un try/catch → message clair au lieu d'un écran blanc.
- La **Filière** filtre l'affichage : `viewNodes/viewLinks/viewModel` + `hiddenFilieres`.
- **Barre d'outils** : `＋ Nœud` · bascule segmentée Édition/Aperçu (`.segmented`, cadre unique,
  segment actif en noir) · Enregistrer / Enregistrer sous… / Ouvrir · export PNG/SVG. Le titre de
  la fenêtre porte le nom du projet ouvert (`updateWindowTitle` → `document.title`, qu'Electron
  reprend), « Sankey Studio » si aucun. `loadExample()` reste appelée au 1er démarrage mais
  n'a plus de bouton.
- **Interaction du canevas (plus de modes)** : un seul mode d'édition. Glisser un nœud le déplace ;
  sélectionner un nœud fait apparaître un **point de liaison sur chaque bord** (`linkDot`) — tirer
  depuis le point droit crée un lien *sortant*, depuis le gauche un lien *entrant* (`linkDrag`,
  aperçu `.link-preview`, cible surlignée `.drop-target`). Échap ou relâchement dans le vide
  annule. Le bouton « + » à droite reste le raccourci « nouveau nœud déjà relié ».
- Les **valeurs de flux** vivent **uniquement dans Excel** (formules préservées à l'écriture) ;
  l'apparence vit dans l'app (projet `.sankey` JSON).

### Synchro Excel
- **Détection du classeur ouvert : deux signaux obligatoires.** Excel ne crée un fichier verrou
  `~$<base>` que pour un fichier **local** ; pour un classeur ouvert depuis **OneDrive**, il n'en
  crée aucun. `workbookState()` (`src/main/excel-control.js`) combine donc le fichier verrou et
  l'interrogation d'Excel (`isOpenInExcel`, AppleScript / COM, résultat mis en cache 1,2 s) ;
  `mode` indique lequel a répondu (`verrou`, `excel`, `refuse`, `indetermine`) et l'app affiche un
  avertissement quand la détection est dégradée. `excel:write` refait la vérification avant
  d'écrire, et un `setInterval` de 4 s interroge Excel car `fs.watch` ne voit rien sur OneDrive.
- **Piège AppleScript Excel Mac** : `full name of wb` dans un `repeat with wb in workbooks` lève
  une erreur `-50`. Passer par `name of every workbook` puis agir par index (`workbook idx`).
- Non-simultanée : l'app écrit quand le fichier est libre, **diffère** si Excel tient le verrou,
  re-lit à la sauvegarde Excel (fs.watch, self-write supprimé via `lastWriteTs`).
  **Ne jamais écrire pendant que le verrou est présent** : sur macOS l'écriture réussit sur le
  disque mais Excel écrase tout à sa prochaine sauvegarde (c'était la cause de la « perte des
  couleurs »). `excel:write` renvoie `locked` → écriture différée (`pendingExcelWrite`).
- Bidirectionnelle : `⬆︎ App→Excel` (préserve les valeurs Excel), `⬇︎ Excel→App` (avertit si des
  modifs locales seraient écrasées). Réconciliation **par ID** avec `syncedNodeIds/syncedLinkIds`.
- **Le verrou prévient toujours par une modale**, jamais par un simple message de statut :
  `resolveExcelLock(contexte)` sert aussi bien l'édition d'un nœud que le bouton
  « ⬆︎ App → Excel » (`pushToExcel` la consulte **avant** d'écrire, et retente une fois si le
  classeur a été rouvert entre-temps). `pushEnCours` empêche la récursion, `closeWorkbookInExcel`
  relançant l'écriture en attente.
- **Garde-fou d'édition** : toute modification de structure passe par `beginEdit()` dans
  `editor.ts` (ajout/suppression de nœud ou de lien, déplacement, champs du panneau, couleur d'un
  nœud). Si le classeur est ouvert dans Excel (`excelLocked`), l'édition est **refusée** et une
  modale explique qu'il faut enregistrer et fermer le classeur. Option `prefs.autoCloseExcel`
  (localStorage `sankey-prefs`, propre au poste) : l'app demande elle-même à Excel d'enregistrer
  puis de fermer, via `excel:closeInExcel`. L'apparence (options du diagramme) n'est **pas**
  bloquée : elle ne part jamais dans Excel.
- macOS exige l'autorisation « Automatisation » ; `NSAppleEventsUsageDescription` est déclaré dans
  `package.json` (`mac.extendInfo`). Refus → état `denied`, message explicite dans l'app.
- `extractValueFormulas` relit les cellules « Valeur du flux » contenant `<f>` et `buildModelRows`
  les ré-émet comme cellules formule.

### Vérification
Voir « Vérifier une fonctionnalité » en tête de fichier. En complément : `npx electron .`
démarre l'app en cherchant les erreurs dans les logs.

### Pièges à connaître
- **electron-builder épinglé à 24.13.3** — la 26.x plante (`ERR_REQUIRE_ESM` sur
  `@noble/hashes/blake2.js`).
- **Icône** : source = `build/icon.svg` (glyphe Sankey au style du dictionnaire BASIC :
  viewBox 50, trait 2.5, `fill none`, onglets, bouts francs — tuile noire / glyphe blanc).
  **macOS ne rogne pas les icônes** : la tuile doit dessiner elle-même la forme attendue,
  sinon elle déborde des bords arrondis du Dock. Grille Apple (macOS 11+) : corps de
  **824×824 centré dans 1024, rayon 185,4**, glyphe à ~519 px pour laisser respirer.
  C'est la seule entorse assumée au « rayon 0 » de la charte : la convention système prime.
  Pipeline : `npx electron scripts/render-icon.js` (Chromium rend le SVG en PNG ; **qlmanage
  rastérise en escalier**, ne pas l'utiliser) puis `node scripts/make-icons.mjs` → `.icns`
  (sips + iconutil) et `.ico` (empaqueté à la main : en-tête + PNG bruts, pas d'ImageMagick ici).
  **zsh ne découpe pas `$var` en mots** → appeler `sips` taille par taille.
  Les angles des bandes doivent être des **tracés fermés** (`Z`), sinon les segments juxtaposés
  laissent des marches aux jonctions.
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
