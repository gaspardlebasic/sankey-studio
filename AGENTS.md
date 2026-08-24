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

6. **`npm run test:live`** — tests unitaires de `src/main/excel-live.js` : forme du message
   envoyé à Excel, relecture de sa réponse, invariants des scripts embarqués. Ne parle pas à
   Excel. L'aller-retour réel se mesure avec `npm run proto:excel -- "<classeur ouvert>"`.

Le pilotage d'Excel (`src/main/excel-control.js`) se valide sans envoyer d'Apple event :
`osacompile -o /dev/null script.applescript` vérifie la syntaxe *et* le dictionnaire Excel.
Le dictionnaire lui-même se lit dans `/Applications/Microsoft Excel.app/Contents/Resources/Excel.sdef`
(`sdef` en ligne de commande exige Xcode complet, absent ici).

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

## Skills partagées (`.claude/skills/`)

Versionnées avec le dépôt : tout agent qui ouvre le projet les voit. Elles s'invoquent par
leur nom (`/thermos`, `/tdd`, …) ; celles marquées **sur demande** ne se déclenchent jamais
toutes seules.

| Skill | Quand | Déclenchement |
|---|---|---|
| `thermos` | Lance les deux revues thermo en parallèle puis synthétise | sur demande |
| `thermo-nuclear-review` | Audit bugs / sécurité / régressions du diff de la branche | sur demande |
| `thermo-nuclear-code-quality-review` | Revue de maintenabilité très stricte (abstractions, fichiers > 1 000 lignes, spaghetti) | sur demande |
| `improve-codebase-architecture` | Repère les modules trop plats, rend un rapport HTML de pistes d'approfondissement | sur demande |
| `codebase-design` | Vocabulaire des modules profonds (*module, interface, depth, seam, leverage*) | automatique |
| `domain-modeling` | Tenir `CONTEXT.md` et les ADR à jour | automatique |
| `grilling` | Passer un plan au gril avant de coder | automatique |
| `diagnosing-bugs` | Boucle de diagnostic pour un bug tenace ou une lenteur | automatique |
| `tdd` | Boucle rouge → vert et critères d'un bon test | automatique |

`thermos` s'appuie sur deux sous-agents déclarés dans `.claude/agents/`.

Origine : [cursor/plugins](https://github.com/cursor/plugins) (dossier `thermos/`, commit
`4612556`) et [mattpocock/skills](https://github.com/mattpocock/skills) (branche `main`).
Ce sont des copies figées — pour les mettre à jour, retélécharger les `SKILL.md` depuis ces
dépôts.

**Attention à l'ordre :** `improve-codebase-architecture` et `domain-modeling` écrivent dans
`CONTEXT.md` et `docs/adr/`, qui n'existent pas encore ici ; elles les créeront à la volée.
Les conventions de test du projet (§ « Vérifier une fonctionnalité ») priment sur les
recommandations génériques de `tdd`.

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
  - `src/main/excel-live.js` — **écriture/lecture « à chaud »** dans le classeur *déjà ouvert*
    dans Excel : JXA sur macOS, COM/PowerShell sur Windows. Chemin par défaut dès qu'Excel
    tient le classeur (cf. « Écrire dans le classeur ouvert »).
  - `src/renderer/ui.ts` — modales et sélecteur de couleurs en surcouche (grille teintes × nuances).
  - `src/main/preload.js` — pont `contextBridge` (`window.desktop`).

### Scripts
```bash
npm start           # build le renderer + lance Electron
npm test            # tests des fonctionnalités d'édition (diagramme complexe)
npm test -- liaison # filtre les tests par nom
npm run smoke       # test de fumée (barre d'outils, aperçu, titre, garde-fou Excel)
npm run verifier -- "Fichier.sankey"   # diagnostic d'un projet
npm run test:live   # tests unitaires de l'écriture à chaud (sans Excel)
npm run proto:excel -- "/chemin/Classeur.xlsx"   # aller-retour réel dans Excel (classeur ouvert)
npm run serve       # sert dist/renderer sur http://localhost:8811 (dev navigateur)
npm run install:app # build + remplace /Applications/Sankey Studio.app
npm run dist        # -> release/Sankey Studio-<version>-arm64.dmg
npm run dist:dir    # dossier .app non compressé (test rapide)
npm run dist:win    # -> installeur NSIS + portable Windows
```
`install:app` ferme Sankey Studio si elle tourne (autorisé par l'utilisateur) puis installe.
Avant de builder : `npx tsc --noEmit -p tsconfig.json` puis `node build.mjs`.

### Modèle de données
- **FlowNode** : `id, name, column, title, order, lane, filiere, color, x, y`.
  `lane` = **couloir** horizontal (entier >= 1, 1 par défaut).
- **FlowLink** : `id, source, target, value, unit, colorOverride?`
  (`colorOverride` = surcharge couleur propre au lien, **app only**, absente de l'Excel).
- **Excel** : un onglet `Diagramme`, deux tableaux Excel (ListObjects) côte à côte :
  - **Noeuds** (A..H) : Filière · Noeud · Numéro de colonne d'affichage · Intitulé de la colonne d'affichage · Ordre vertical d'affichage · Couleur · ID · **Couloir**
  - une colonne vide (`GAP = 1`), puis **Liens** (J..O) : Origine · Destination · Valeur du flux · Unité · ID origine · ID destination
  - Lecture **et** écriture sont indexées par **nom d'entête**, jamais par position : un
    classeur écrit avant l'arrivée d'une colonne n'a pas la même largeur de tableau, et les
    deux tableaux ne sont pas forcément aux mêmes adresses qu'aujourd'hui. « Couloir » est
    d'ailleurs ajouté **en fin** de liste pour ne pas bousculer les colonnes existantes.
  - `readDiagram` renvoie **`hasLane`** : si le classeur ignore les couloirs, la
    réconciliation **garde** ceux de l'app au lieu de tout remettre à 1.
  - À la réécriture, la **mise en forme utilisateur est préservée** (`preserve` dans
    `updateExistingWorkbook` : styles de cellules `s=`, hauteurs de lignes, `<cols>`,
    `tableStyleInfo`) — attention aux attributs à préfixe (`x14ac:` …) qu'il faut retirer.

### Règles métier (importantes)
- **Couloirs (`lane`)** : bandes horizontales empilées, une troisième coordonnée de placement à
  côté de la colonne et de l'ordre vertical. L'`order` est propre à une **cellule
  (colonne × couloir)** : deux nœuds de couloirs différents peuvent porter le même ordre dans la
  même colonne. Sert à isoler des familles de flux (entrants hors périmètre, cœur, sortants).
  - **Un seul couloir = mise en page d'avant, au pixel près.** Aucun décor n'est dessiné et le
    moteur garde le centrage par colonne obtenu de d3. Le chemin « couloirs » ne s'active qu'à
    partir de deux couloirs — c'est ce qui garantit qu'aucun diagramme existant ne bouge.
  - Vue d'édition : `layoutGrid()` empile les bandes, chacune aussi haute que sa colonne la plus
    chargée ; filet pointillé + nom à gauche (double-clic pour renommer). Glisser un nœud sous la
    dernière bande en crée une, comme glisser à droite crée une colonne.
  - **Les bandes sont figées à l'instant du `mousedown`** (`dragState.bandes`) : pendant un
    glisser, retirer un nœud d'un couloir fait remonter les suivants, et la bande visée se
    déroberait sous le curseur (le nœud atterrissait un couloir trop bas).
  - Aperçu : `placerParCouloirs()` reprend les hauteurs calculées par d3 (proportionnelles au
    flux) et les redistribue. Si l'ensemble ne tient pas, **tout** est réduit du même facteur —
    nœuds ET rubans — pour que les épaisseurs restent comparables.
  - **Empilement des rubans : trier sur la position peinte (`y0`), jamais sur `order`.**
    L'ordre vertical étant propre à une cellule (colonne × couloir), un nœud du couloir du dessus
    peut porter un ordre plus grand qu'un nœud du couloir du dessous ; les comparer faisait
    arriver en bas du nœud un flux venu d'en haut, et les rubans se croisaient. Un flux venu d'en
    haut doit arriver en haut. Les rubans portent `data-source`/`data-target` pour que les tests
    puissent le vérifier sur le tracé réellement peint.
  - Les **noms de couloirs** vivent dans `options.lanes.titles` (apparence, pas dans Excel) et
    s'affichent dans une **gouttière réservée à gauche** : posés sur le dessin, ils
    chevaucheraient le premier nœud et la barre des entêtes de colonnes.
- **Filières empilées : grille de colonnes commune.** `renderSankeyGroups` calcule UNE
  correspondance colonne -> couche (`denseColonnes`) et UN nombre de couches pour l'ensemble des
  diagrammes, puis la passe à chaque `drawSankey`. Sans cela chacun étale ses propres colonnes sur
  toute la largeur et la colonne 3 d'une filière ne tombe pas en face de celle de la suivante.
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
- **Hauteur des nœuds variable** : en édition, le nom passe à la ligne (`wrapText`, 18 caractères,
  4 lignes max) et la boîte grandit — `nodeH(n)` fait autorité, il n'y a plus de pas vertical
  régulier. Toute mesure verticale passe par `nodeH()` et `rankAtY()`, jamais par `NODE_H`/`ROW_H`.
- **Aperçu par filière** : `options.filieres.split` empile un Sankey par filière sous son nom
  (`renderSankeyGroups` dans engine.ts ; `drawSankey` dessine un diagramme dans un `<g>` fourni
  et **renvoie l'échelle obtenue** en pixels par unité de flux). Réglages dans la carte
  « Marges du graphique » (marges haut/bas via `options.chart`). Les liens qui traversent deux
  filières n'appartiennent à aucun bloc et disparaissent dans ce mode.
- **Échelle commune (`filieres.sameScale`)** : ne pas tenter de prédire l'échelle de d3-sankey
  analytiquement — la colonne contraignante n'est pas celle qu'on croit, et les marges internes
  (barre des titres de colonnes) diffèrent d'un bloc à l'autre. `mesurerEchelle()` lance le layout
  dans un `<g>` **détaché** à deux hauteurs d'essai ; l'échelle étant affine en la hauteur, on en
  déduit la hauteur à donner à chaque bloc pour que tous partagent la même échelle.
- **Panneau des paramètres** : `.card-body` est une grille à 2 colonnes ; `numberField` et
  `colorField` posent la classe `half`. `buildSidebar()` reconstruit tout à chaque changement
  d'option : `card()` mémorise l'état plié/déplié par titre (`cartesOuvertes`), sinon les sections
  se replient sous les doigts de l'utilisatrice.
- **Identifiants SVG uniques par diagramme** : en mode « par filière » plusieurs Sankey partagent
  le même SVG. `drawSankey` préfixe donc ses `id` de dégradés (`d<n>-grad<i>`) ; sans cela tous les
  `url(#grad0)` pointent vers le premier bloc et les couleurs partent en vrille. **Ne pas mettre la grille sur un `<details>`** : le contenu
  après `<summary>` est enveloppé dans une boîte anonyme qui ignore le placement en grille.
- **Sélection au `mousedown`** : un champ du panneau qui se valide reconstruit canevas et panneau
  entre l'enfoncement et le relâchement ; si la sélection attendait le `click`, celui-ci n'atteignait
  plus le nœud (il fallait cliquer deux fois). Ne pas déplacer cette sélection vers `click`.
- **L'intitulé appartient à la COLONNE** : `setColumnTitle()` l'applique à tous ses nœuds, et
  `moveNodeToCell` fait adopter au nœud déplacé l'intitulé de sa nouvelle colonne. Ne jamais écrire
  `n.title` sur un seul nœud.
- **Enregistrement et synchro automatiques** : `persist()` déclenche deux minuteurs — réécriture du
  `.sankey` ouvert (800 ms) et envoi vers Excel (1200 ms, `pushToExcel({silencieux:true})`). Le mode
  silencieux **diffère sans modale** si le classeur est ouvert : seul le bouton « App → Excel »
  avertit explicitement.
- **Excel pour Mac ouvre les fichiers OneDrive depuis SharePoint** (`full name` d'un classeur ouvert
  renvoie une URL `https://…sharepoint.com/…`), pas la copie locale. Une écriture de l'app sur le
  disque n'est donc visible dans Excel qu'une fois **téléversée par OneDrive** ; ouvrir avant fait
  apparaître l'ancienne version, et l'enregistrer la redescend. L'app le signale dans le statut
  quand le chemin est sous `CloudStorage`/OneDrive.
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
- **Ne jamais écrire le `.xlsx` pendant qu'Excel tient le classeur** : sur macOS l'écriture
  réussit sur le disque mais Excel écrase tout à sa prochaine sauvegarde (c'était la cause de la
  « perte des couleurs »). Deux issues : écrire **dans** le classeur ouvert (`excel-live.js`,
  chemin normal) ou **différer** (`pendingExcelWrite`) si le pilotage d'Excel est impossible.
  L'app re-lit à la sauvegarde Excel (fs.watch, self-write supprimé via `lastWriteTs`).
- Bidirectionnelle : `⬆︎ App→Excel` (préserve les valeurs Excel), `⬇︎ Excel→App` (avertit si des
  modifs locales seraient écrasées). Réconciliation **par ID** avec `syncedNodeIds/syncedLinkIds`.
- **Quand l'écriture à chaud n'est pas possible, le verrou prévient par une modale**, jamais par
  un simple message de statut :
  `resolveExcelLock(contexte)` sert aussi bien l'édition d'un nœud que le bouton
  « ⬆︎ App → Excel » (`pushToExcel` la consulte **avant** d'écrire, et retente une fois si le
  classeur a été rouvert entre-temps). `pushEnCours` empêche la récursion, `closeWorkbookInExcel`
  relançant l'écriture en attente.
- **Garde-fou d'édition** : toute modification de structure passe par `beginEdit()` dans
  `editor.ts` (ajout/suppression de nœud ou de lien, déplacement, champs du panneau, couleur d'un
  nœud). Si le classeur est ouvert dans Excel (`excelLocked`) **et** que l'app ne sait pas y écrire
  (`!excelLive`), l'édition est **refusée** et une modale explique qu'il faut enregistrer et fermer
  le classeur. Avec `excelLive`, l'édition continue normalement. Option `prefs.autoCloseExcel`
  (localStorage `sankey-prefs`, propre au poste) : l'app demande elle-même à Excel d'enregistrer
  puis de fermer, via `excel:closeInExcel`. L'apparence (options du diagramme) n'est **pas**
  bloquée : elle ne part jamais dans Excel.
- macOS exige l'autorisation « Automatisation » ; `NSAppleEventsUsageDescription` est déclaré dans
  `package.json` (`mac.extendInfo`). Refus → état `denied`, message explicite dans l'app.
- `extractValueFormulas` relit les cellules « Valeur du flux » contenant `<f>` et `buildModelRows`
  les ré-émet comme cellules formule.

#### Écrire dans le classeur ouvert (`excel-live.js`)

Renversement du rapport de force : quand Excel tient le classeur, ne pas lui disputer le
fichier, mais **lui demander d'écrire**. C'est la seule voie qui marche pour un fichier
SharePoint, qu'Excel pour Mac ouvre depuis son **URL** et non depuis la copie locale — écrire le
`.xlsx` sur le disque est alors sans effet visible, et la sauvegarde d'Excel l'écrase.

- **Le coût n'est pas le nombre de cellules, c'est le nombre d'évènements envoyés à Excel.**
  Mesuré ici : **425 ms par cellule** une par une, contre **~0,05 ms** en affectant un tableau 2D
  à une plage entière. Facteur ~8 000. Ne **jamais** boucler sur les cellules.
- Coût quasi **constant** quelle que soit la taille (mesures macOS, Excel 16.112, M-series) :

  | nœuds | liens | cellules | dans Excel | total (dont ~500 ms de démarrage d'`osascript`) |
  |------:|------:|---------:|-----------:|------:|
  |    50 |    44 |      614 |    1 038 ms | 1 573 ms |
  |   200 |   194 |    2 564 |    1 052 ms | 1 585 ms |
  |   500 |   494 |    6 464 |    1 309 ms | 1 853 ms |
  | 1 000 |   994 |   12 964 |    1 302 ms | 1 826 ms |
  | 2 000 | 1 994 |   25 964 |    1 365 ms | 1 887 ms |

  « Plusieurs centaines de lignes » n'est donc pas un problème.
- **macOS : JXA (`osascript -l JavaScript`), pas AppleScript** — UTF-8 et JSON natifs, or les
  noms de nœuds sont accentués. Le script est passé par stdin (il ne peut pas vivre dans un
  fichier : l'asar n'est pas lisible par `osascript`) et reçoit le chemin d'un JSON en `argv`.
- **Ajouter une colonne manquante** : écrire l'en-tête dans la colonne qui suit le tableau l'y
  étend (auto-extension, ~50 ms), à condition que cette colonne soit libre — sinon l'état
  `no-column` et l'app retombe sur l'écriture du fichier. C'est ainsi qu'un classeur d'avant les
  couloirs gagne sa colonne « Couloir » sans être fermé.
- **Redimensionner les tableaux**, toujours **limité aux colonnes du tableau** — sinon le tableau
  voisin (Liens, colonne I) se décale avec. À la hausse : `insert into range … shift shift down`
  **dans** le tableau. Écrire *sous* le tableau l'étend aussi tout seul, mais Excel le reconstruit
  entièrement — mesuré **1 500 ms contre 260 ms**, soit l'essentiel du coût d'une écriture avec
  ajout de nœud. À la baisse : `delete range … shift shift up`. Un tableau Excel ne peut pas avoir
  zéro ligne : on en garde une, vide.
- Figer l'écran et passer le calcul en manuel **n'aide pas** : les quatre évènements Apple
  supplémentaires coûtent plus que ce qu'ils économisent (562 ms contre 231 ms). Ne pas le faire —
  et surtout ne pas laisser Excel en calcul manuel si le script échoue en cours de route.
  Sur Windows, COM expose `ListObject.Resize`, plus direct — mais **Resize ne vide pas** les
  cellules sorties du tableau, il faut les effacer soi-même.
- **Formules** : relire la colonne « Valeur du flux » **avant** d'écrire, réassocier par
  `(ID origine, ID destination)` puis réémettre. `range.formula` est en syntaxe **US**
  (`=SUM(...)`) dans les deux sens, quelle que soit la langue de l'interface — `formula local`
  donne `=SOMME(...)`. C'est la même syntaxe que le `<f>` du XML, donc les deux chemins
  d'écriture sont cohérents.
- **PowerShell** : script en **ASCII pur** (stdin est décodé avec la page de code de la console,
  pas en UTF-8 ; le JSON, lui, passe par un fichier lu en UTF-8) et `To-Grid` doit rendre
  `,$a` — sans la virgule, PowerShell déplie le tableau 2D. Non testé faute de machine Windows.
- **Contrepartie** : `Ctrl-Z` dans Excel ne défait pas une écriture par automatisation.
- Essai sur le vrai fichier (`Flux légumineuses.xlsx`, ouvert depuis SharePoint) : 500 cellules
  réécrites à l'identique, **21 formules `'Données de flux'!B…` conservées**, 1,35 s.
  `npm run proto:excel -- "<chemin>"` refait la mesure et compare cellule à cellule.

**Branchement dans l'app.** `excel:write` choisit son chemin selon l'état du classeur : ouvert
dans Excel → écriture à chaud ; fermé → écriture du `.xlsx` (`excel.js`). `excel:read` fait de
même : quand Excel tient le classeur, le fichier sur le disque est en retard sur ce qui est à
l'écran. Conséquences côté renderer :

- `workbookState()` est renvoyé au renderer avec un drapeau **`live`** (`avecPilotage` dans
  `main.js`) : vrai dès que le classeur est ouvert **et** que la plateforme sait piloter Excel.
  Optimiste à dessein — on ne dépense pas un aller-retour de plus pour le vérifier ; si
  l'autorisation manque, l'écriture rend `denied` et l'app repasse par l'avertissement.
- `beginEdit()` **n'interdit plus** l'édition quand `excelLive` : le garde-fou ne vaut que si
  l'app ne sait pas écrire dans le classeur ouvert. Idem pour le sélecteur de couleurs.
- `pushToExcel` ne demande de fermer Excel que si l'écriture à chaud a échoué (`res.liveState`
  remet `excelLive` à faux avant la seconde tentative).
- **Enregistrement** : seul un « App → Excel » explicite demande à Excel d'enregistrer
  (`options.save`). La synchro de fond ne le fait pas — sinon OneDrive téléverserait à chaque
  frappe. Excel montre donc le classeur comme modifié : c'est dit dans le panneau.
- Une écriture à chaud dure ~1 s, pendant laquelle l'utilisatrice continue d'éditer :
  `pushEnCours` **reprogramme** l'écriture suivante au lieu de la jeter (sinon le dernier
  changement d'une salve n'arrive jamais dans Excel).
- `prefs.autoCloseExcel` devient un **repli**, plus le mode normal.

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
- **Éprouver le chemin Windows de `excel-live.js`** : écrit, jamais exécuté (ni machine Windows ni
  `pwsh` ici). Les tests n'en gardent que les invariants.
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
