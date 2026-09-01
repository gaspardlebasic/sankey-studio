# AGENTS.md — Sankey Studio

Instructions de projet pour les agents de codage (Claude Code, Mistral Vibe, …) **et** pour
les humains. Fichier de référence unique : `CLAUDE.md` ne fait que pointer ici.
Réponds en **français** (l'utilisateur travaille en français).

## Démarrage rapide

```bash
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

7. **`npm run test:addin`** — tests de l'adaptateur Office.js, sur un **faux classeur en
   mémoire** (`tests/faux-office.js`) qui reproduit le différé `load`/`sync` et le décalage
   limité aux colonnes du tableau. Ne parle pas à Excel.
   - Le faux **interdit** une suppression de lignes plus large que les colonnes du tableau :
     l'écriture qui suit masquerait le décalage du tableau voisin, donc aucune assertion ne
     pourrait le voir. L'invariant est une précondition, pas un test.
   - **Éprouver la suite par mutation** avant de la croire : casser volontairement l'adaptateur
     (écrire par position au lieu du nom d'en-tête, passer `null` à `buildModelRows`) doit faire
     échouer des tests. Trois mutations ont été vérifiées ; la première version de la suite n'en
     détectait aucune.
   - La même commande lance `tests/addin-synchro.test.js` : auto-écho, anti-rebond et
     branchement de `Table.onChanged`. Deux mutations vérifiées (filtre d'écho passoire,
     écoute de tous les tableaux du classeur).
   - Et `tests/addin-protocole.test.js` : le tunnel volet ↔ fenêtre sur un canal en toc —
     poignée de main branchée en retard, deux appels en vol à ne pas mélanger, délai de garde,
     désaccord de version, message étranger. Les minuteurs y sont **injectés** : un délai de
     garde ne se mesure pas en temps réel. Deux vrais défauts trouvés par ces tests (le
     « bonjour » qui se reprogrammait après avoir abouti).

8. **`tests/volet-essai.html`** — le renderer **sous les capacités du complément**, sans Excel :
   `npm run serve` puis <http://localhost:8811/volet-essai.html>. La page pose un faux
   `window.desktop` (mêmes capacités que `src/addin/pont.ts`) au-dessus d'un classeur en mémoire.
   `window.__volet` donne le journal des appels, l'apparence rangée et `modifierDansExcel()`
   pour jouer une saisie faite dans Excel. C'est là qu'on éprouve l'amorce, la synchro
   automatique et le panneau.

9. **`tests/fenetre-essai.html`** — le couple **volet courtier + fenêtre d'édition** de la
   phase 4, sans Excel : `npm run serve` puis <http://localhost:8811/fenetre-essai.html>.
   La page parente joue le volet et tient le classeur ; un iframe charge le **vrai** code de la
   fenêtre (`tests/fenetre-cadre.html`, qui pose un faux Office.js réduit à `messageParent`).
   `window.__essai` donne le journal, le cumul d'octets et `modifierDansExcel()`.
   C'est le seul endroit où l'on voit **le poids des messages** — l'inconnue que Microsoft ne
   documente pas. Ce qu'il ne prouve pas : `displayDialogAsync` et les limites réelles du canal,
   qui ne s'éprouvent que dans Excel.

10. **`/sonde-essai.html`** — **la sonde elle-même**, hors d'Excel : `npm run serve` puis
    <http://localhost:8811/sonde-essai.html>. Le serveur sert les **vraies** pages de
    `src/addin` en n'y remplaçant qu'Office.js par `tests/faux-office-sonde.js` — les dupliquer
    ici les laisserait diverger sans qu'on le voie. Le faux impose un plafond de 1 Mo
    (`window.__limiteFausse`) et sait jouer un poste sans `DialogApi 1.2`
    (`window.__sansDialog = true`), pour vérifier que l'échelle de mesure s'arrête au bon palier
    dans les deux modes d'échec, et que la sonde refuse de mesurer plutôt que de fausser.
    **Pourquoi ce banc existe** : la sonde part sur un poste Windows pour répondre aux questions
    qui décident du chantier (phase 6). Un instrument faux ferait perdre le déplacement.

11. **`node tests/addin-manifeste.test.js`** (dans `npm run test:addin`) — les **manifestes**.
    Un manifeste invalide ne se découvre qu'au pire moment : Excel refuse de charger, sans
    motif, sur le poste de quelqu'un d'autre. Contrôle les pièges connus (les deux tirets d'un
    commentaire, les balises non refermées) **et les règles propres au projet** qu'aucun
    validateur générique ne verrait : une seule origine pour toutes les pages, HTTPS partout,
    `ExcelApi 1.1` et rien de plus, `AppDomains` cohérent avec `SourceLocation`.
    Trois mutations vérifiées.

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

Ce dépôt contient **deux livrables** autour du même moteur de rendu Sankey : l'application de
bureau vit **à la racine**, le visuel Power BI dans `powerbi-visual/`.
Réponds en **français** (l'utilisateur travaille en français).

## Les deux projets

| Dossier | Quoi | État |
|---|---|---|
| `powerbi-visual/` | **Visuel personnalisé Power BI** (Sankey par colonnes), packagé en `.pbiviz` dans `dist/`. TypeScript + d3-sankey, API pbiviz 5.11. | Terminé (v3.2.0) |
| _racine du dépôt_ | **Application de bureau Electron « Sankey Studio »** : éditeur graphique de diagrammes de flux synchronisé avec Excel. Réutilise le moteur du visuel Power BI. | **Projet actif** — phases 1–6 faites |

Jeu de données de référence : `flux lait essai.xlsx` (flux de production laitière).
Un prompt de reprise détaillé existe dans `CONTEXTE-REPRISE.md`.
Le chantier qui double la synchro Excel d'un **complément Office** est décrit dans
`PLAN-COMPLEMENT-EXCEL.md` : **phases 0 à 5 faites, phase 6 outillée**. Le complément lui-même
**a tourné dans Excel pour Mac le 2026-09-01** — volet, fenêtre d'édition, aller-retour complet
sur un classeur réel : `RESULTATS-ESSAI-MAC.md`. La **diffusion** (hébergement, manifeste de production) est décrite dans
`DIFFUSION.md` ; la **validation Windows** a son instrument prêt et sa grille de relevés vide
dans `RESULTATS-PHASE-6.md`. Ces deux-là demandent des droits d'administration ou un poste
Windows : le dépôt porte l'outillage, pas les résultats.
La forme retenue est **volet courtier + fenêtre d'édition séparée** (PLAN §5.4) : le volet est
trop étroit pour le canevas, l'éditeur vit donc dans une fenêtre à 98 % de l'écran.
Mesures de la phase 0 dans `RESULTATS-PHASE-0.md`, fonctionnement dans « Les deux coquilles ».
L'app Electron n'est **pas** touchée par ce chantier (PLAN §5.1).

---

## L'application de bureau (projet actif, à la racine)

### Stack & structure
- **Electron + TypeScript**. Process principal en `src/main/*.js`, renderer en `src/renderer/*.ts`.
- Renderer bundlé par **esbuild** (`build.mjs`). Dépendances bundlées : `jszip`, `d3-sankey`, `d3-selection`.
- Fichiers clés :
  - `src/renderer/engine.ts` — moteur de rendu Sankey (porté du visuel Power BI) : fond blanc, colonnes, dégradés, courbes, étiquettes, centrage vertical.
  - `src/renderer/editor.ts` — éditeur : état, grille aimantée, panneau latéral, synchro Excel, export, undo/redo.
  - `src/renderer/types.ts` — `FlowModel/FlowNode/FlowLink` + `SankeyOptions`.
  - `src/main/main.js` — IPC : projet (save/open), Excel (choose/openExisting/read/write/watch), `export:save`.
  - `src/shared/modele-excel.js` — **schéma du classeur, source de vérité unique** : ordre des
    colonnes (`NODE_COLS`/`LINK_COLS`), ordre de tri des lignes, types, `buildModelRows`.
    Partagé par l'écriture du `.xlsx` **et** par le complément Office. Ne jamais dupliquer
    ces règles ailleurs : les deux chemins produiraient des classeurs différents.
  - `src/addin/excel-office.ts` — **adaptateur Office.js** : `initialiserClasseur()` prépare un
    classeur nu (feuille + deux tableaux vides) et **refuse** plutôt que d'écraser — diagramme
    déjà là, feuille du même nom non vide, demi-diagramme. C'est la seule fonction qui écrive
    dans un classeur dont on ne sait rien. Elle lit et écrit dans le classeur
    *ouvert*, depuis l'intérieur d'Excel. Écrit **colonne par colonne, par nom d'en-tête**,
    donc tolère un autre ordre de colonnes et n'écrase pas une colonne ajoutée par
    l'utilisatrice. Les deux tableaux sont retrouvés par leurs en-têtes **sur une seule et même
    feuille**, celle qu'on demande d'abord (« Diagramme ») : un classeur réel en porte d'autres,
    et le premier essai dans Excel a montré qu'un tableau sans rapport, sur une autre feuille,
    peut lui aussi avoir une colonne « Origine ». Voir `PLAN-COMPLEMENT-EXCEL.md`.
  - `src/addin/pont.ts` — **la seconde implémentation de `window.desktop`**, au-dessus d'Office.js
    (cf. « Les deux coquilles »). Apparence dans `document.settings`, écoute du classeur,
    largeur du volet. C'est aussi la cible du courtier : la fenêtre d'édition l'appelle à distance.
  - `src/addin/protocole.ts` — **le tunnel** volet ↔ fenêtre d'édition : `Mandataire` (fenêtre) et
    `Courtier` (volet), corrélation des appels, délai de garde, poignée de main, version du
    protocole. Ne connaît ni Office ni le DOM — donc éprouvable sans Excel.
  - `src/addin/pont-fenetre.ts` — **la troisième implémentation de `window.desktop`**, côté
    fenêtre : cinq méthodes passent par le tunnel, le reste est local. **Aucune ne lève** — un
    tunnel peut expirer, ce qu'Office.js ne fait jamais.
  - `src/addin/courtier-volet.ts` — cycle de vie de la fenêtre d'édition (`displayDialogAsync`,
    relais, fermeture) et traduction des codes d'erreur d'Office.
  - `src/addin/navigateur.ts` — ce que les deux coquilles du complément font sans Excel
    (presse-papier) : partagé, donc jamais transmis par le tunnel.
  - `src/addin/fenetre.ts` / `fenetre.html` — la fenêtre d'édition : `Office.onReady` → écoute du
    volet → poignée de main → `createApp`.
  - `src/addin/synchro.ts` — rythme de la synchro descendante : filtre d'auto-écho et anti-rebond.
    Volontairement séparé d'Office.js pour être éprouvable sans Excel.
  - `src/addin/index.ts` / `index.html` — la coquille du volet. Avant d'ouvrir la fenêtre, il
    demande `diagrammePresent()` : sur un classeur qui n'a pas les deux tableaux, il propose
    **« Préparer le classeur »** (`initialiserClasseur()`) au lieu d'ouvrir un éditeur qui n'aurait
    rien à lire. Ce bouton est dans le VOLET et pas dans la fenêtre — il touche au classeur, donc
    à Office.js, et le contrat `window.desktop` décrit ce dont le *renderer* a besoin, pas ce dont
    le volet a besoin. `Office.onReady` → pont → volet
    courtier (ou, si `DialogApi 1.2` manque, repli avec l'éditeur dans le volet). Sortie
    `dist/addin/` — **deux pages, deux bundles hachés**, construits ensemble.
  - `src/addin/manifest.xml` — manifeste du complément (bouton de ruban, `ExcelApi 1.1`), qui
    **vise localhost et doit le rester** : celui de production en est engendré par
    `scripts/manifeste-prod.mjs`, avec les URL changées et rien d'autre.
    `manifest-sonde.xml` reste celui de la sonde.
    **Piège XML** : un commentaire ne peut pas contenir deux tirets consécutifs — une ligne de
    commande à options longues casse le fichier, et Excel refuse alors de charger le complément
    sans dire pourquoi. Éprouvé par `tests/addin-manifeste.test.js`.
  - `src/addin/sonde.html` / `sonde.js` — banc d'essai **dans** Excel (`npm run addin:serve`) :
    phase 0 (exigences, lecture, écriture, formules, évènements, stockage, largeur) **et**
    phase 6 (H · poids et délai des messages du tunnel, I · polices dans la webview).
    `sonde-fenetre.html` est la fenêtre qu'ouvre H — elle n'utilise pas `protocole.ts`, dont les
    délais de garde masqueraient justement ce qu'on mesure.
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
                    # + /volet-essai.html   : le renderer sous les capacités du complément
                    # + /fenetre-essai.html : volet courtier + fenêtre d'édition (phase 4)
                    # + /sonde-essai.html   : la sonde elle-même, hors d'Excel (phase 6)
npm run test:addin  # tests de l'adaptateur Office.js, du rythme de synchro et du tunnel
npm run addin:certs   # UNE FOIS : certificat HTTPS de dev (demande le mot de passe)
npm run addin:install # charge le manifeste de côté (-- --sonde, -- --retirer)
npm run addin:install -- --enligne  # pose le manifeste PUBLIÉ : ni serveur local ni certificat
                                    # (mode de diffusion sans droits M365, DIFFUSION.md §6)
                    # macOS : conteneur d'Excel · Windows : clé WEF\Developer du Registre
npm run addin:serve   # sert dist/addin en HTTPS sur https://localhost:3000
npm run addin:manifeste -- https://hote/chemin   # manifeste de production (voir DIFFUSION.md)
npm run install:app # build + remplace /Applications/Sankey Studio.app
npm run dist        # -> release/Sankey Studio-<version>-arm64.dmg
npm run dist:dir    # dossier .app non compressé (test rapide)
npm run dist:win    # -> installeur NSIS + portable Windows
```
`install:app` ferme Sankey Studio si elle tourne (autorisé par l'utilisateur) puis installe.
Avant de builder : `npx tsc --noEmit -p tsconfig.json` puis `node build.mjs`.

### Modèle de données
- **FlowNode** : `id, name, column, title, order, lane, kind, filiere, color, x, y`.
  `lane` = **couloir** horizontal (entier >= 1, 1 par défaut) ;
  `kind` = **type** du nœud, `"produit"` (défaut) ou `"industrie"`.
- **FlowLink** : `id, source, target, value, unit, colorOverride?`
  (`colorOverride` = surcharge couleur propre au lien, **app only**, absente de l'Excel).
- **Excel** : un onglet `Diagramme`, deux tableaux Excel (ListObjects) côte à côte :
  - **Noeuds** (A..I) : Filière · Noeud · Numéro de colonne d'affichage · Intitulé de la colonne d'affichage · Ordre vertical d'affichage · Couleur · ID · **Couloir** · **Type**
  - une colonne vide (`GAP = 1`), puis **Liens** (K..Q) : Filière · Origine · Destination · Valeur du flux · Unité · ID origine · ID destination
  - **Rangement imposé à l'écriture** : les nœuds descendent par **filière**, puis **colonne**,
    **couloir** et **ordre vertical** ; les liens suivent leur **origine**, puis leur
    **destination**. Le classeur se lit ainsi dans l'ordre où on voit le diagramme. Le tri vit
    dans `buildModelRows` (`src/main/excel.js`) — donc valable pour le fichier **et** pour
    l'écriture à chaud — et il est repris à l'identique par `formatExcelClipboard`
    (`src/renderer/editor.ts`) pour que le collage donne exactement les mêmes lignes. Le tri
    porte sur des **copies** : le modèle de l'app n'est jamais réordonné.
  - Lecture **et** écriture sont indexées par **nom d'entête**, jamais par position : un
    classeur écrit avant l'arrivée d'une colonne n'a pas la même largeur de tableau, et les
    deux tableaux ne sont pas forcément aux mêmes adresses qu'aujourd'hui. « Couloir » puis
    « Type » sont d'ailleurs ajoutés **en fin** de liste pour ne pas bousculer les colonnes
    existantes.
  - `readDiagram` renvoie **`hasLane`** et **`hasKind`** : si le classeur ignore les couloirs
    (ou les types), la réconciliation **garde** ceux de l'app au lieu de tout remettre au défaut.
  - « Type » s'écrit **en clair** (« Produit » / « Industrie ») : c'est une colonne que
    l'utilisatrice lit et remplit. La relecture (`typeDepuisTexte`) tolère la casse, les
    accents et les formulations (« Étape de transformation », « commercialisation »…) ;
    tout ce qui n'évoque pas une industrie est un produit.
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
- **Types de nœuds (`kind`)** : un nœud est soit un **produit / commodité** qui circule, soit une
  **industrie** — étape de transformation ou de commercialisation. Le type vit dans Excel
  (colonne « Type ») et pilote l'apparence dans l'aperçu : largeur, police, position de
  l'étiquette et contour.
  - **Chaque réglage de type vaut `null` tant qu'il n'est pas repris en main** : le type suit
    alors `options.nodes.nodeWidth` / `options.nodeLabels`. C'est ce qui garantit qu'un projet
    d'avant les types s'affiche **au pixel près** comme avant (test dédié dans `tests/run.js`),
    et cocher la case du panneau reprend la valeur en cours plutôt qu'un défaut arbitraire.
  - **La largeur est propre au type, la grille se cale sur la plus large employée**, et chaque
    nœud est **centré sur l'axe de sa colonne** (`axeColonne`). Un produit de largeur 0 tombe
    donc exactement là où passait le milieu de sa boîte : les rubans se rejoignent sur l'axe,
    sans nœud visible. Une largeur uniforme redonne la géométrie d'avant, à l'identique.
  - **Contour** : un liseré autour du nœud, à `distance` de son bord, d'épaisseur `width` et
    d'arrondi `radius`, en couleur du nœud assombrie (`fonce`) ou en noir transparent (`noir`).
    Le trait étant centré sur son tracé, le rectangle est écarté de `distance + width / 2`.
    Le moteur **réserve la place du débordement dans les marges** (`debordement`) : sinon le
    contour de la première et de la dernière colonne serait rogné par le bord du cadre. Cette
    marge n'est prise que si un contour est demandé.
  - **Position de l'étiquette** : `options.nodeLabels.position` vaut « À côté », « En dessous »
    ou **« Centré sur le nœud »**, et chaque type peut la reprendre à son compte
    (`nodeTypes.<type>.position`, `null` = suivre le réglage global). « Centré » pose le nom
    **sur** la boîte, sans écart — utile pour des industries larges.
    - Aux **colonnes extrêmes du dessin**, l'étiquette se cale sur le côté du nœud tourné vers
      l'intérieur (`start` à gauche, `end` à droite) : centrée, un nom plus large que la boîte
      sortirait du cadre à gauche. Le bord se mesure sur les **abscisses des nœuds réellement
      peints**, jamais sur un numéro de colonne : d3 tasse les couches quand la plus longue
      chaîne de liens est plus courte que le nombre de colonnes, et une colonne de la grille
      peut rester vide (le cas du diagramme de `tests/fixtures/complexe.sankey`).
    - Les étiquettes de l'aperçu portent `data-label-for` (identifiant du nœud) : c'est par là
      que les tests mesurent la position réellement peinte.
  - **Deux cartes d'apparence, une par type** (`TITRES_TYPES`) et non une seule : une carte
    unique porterait deux fois « Largeur », « Contour »… — indistinguables pour l'utilisatrice
    comme pour les tests, qui repèrent les champs par leur intitulé.
  - La vue d'édition reprend la **graisse et l'italique** du type, pas sa taille : les boîtes y
    sont de gabarit fixe (`nodeH`, `wrapText` à 18 caractères).
- **Filières empilées : grille de colonnes commune.** `renderSankeyGroups` calcule UNE
  correspondance colonne -> couche (`denseColonnes`) et UN nombre de couches pour l'ensemble des
  diagrammes, puis la passe à chaque `drawSankey`. Sans cela chacun étale ses propres colonnes sur
  toute la largeur et la colonne 3 d'une filière ne tombe pas en face de celle de la suivante.
- **Liens qui sautent une colonne : une place leur est réservée** (`options.links.traversee`,
  « Réserver un passage » par défaut ; « Tracer tout droit » redonne le rendu d'avant).
  Cas signalé : A en colonne 1, B en 2, C en 3, avec les liens A→B, B→C **et** A→C — tracé tout
  droit, le ruban A→C passe **sur** B. Le cas `a-b-c-d` doublé d'un `a-d` (deux colonnes
  traversées) est le même problème en plus long.
  - Le moteur traite un tel lien pour ce qu'il est : un flux **qui traverse** la colonne. Il le
    découpe en segments passant par une **escale** — un nœud de passage, haut comme le ruban, qui
    prend sa place dans l'empilement de la colonne (`decomposer`), puis recolle les segments en un
    seul ruban (`recoller`) dont les extrémités restent les vrais nœuds : couleurs, dégradé,
    infobulle et repères `data-source`/`data-target` sont inchangés. Une escale ne se peint
    jamais (`ENode.passage`), n'a pas d'étiquette et ne compte pas dans les bandes de couloir.
  - **Deux passes de disposition** (`disposer`, extrait pour ça) : la première donne les
    positions réelles, la seconde refait tout avec les escales. C'est la première qui dit **où**
    chaque escale se glisse — couloir le plus proche parmi ceux traversés, puis rang intercalaire
    entre les nœuds voisins (`planifierPassages`). Un ordre fractionnaire suffit : il ne sert
    qu'à trier. Le repère est la trajectoire naturelle du ruban, donc un flux qui longe le haut du
    diagramme continue de le longer.
  - **Décider sur les couches PEINTES, pas sur les numéros de colonne** : d3-sankey borne
    `node.layer` à la longueur de sa plus longue chaîne (cf. plus bas), si bien qu'un lien
    « colonne 4 → colonne 6 » peut finir entre deux couches voisines et n'avoir rien à traverser.
    D'où la lecture des couches **après** la première disposition.
  - Conséquence heureuse : la colonne traversée compte enfin le flux qui la traverse — une coupe
    verticale du diagramme totalise le même flux partout.
  - `ribbonPath` trace un ruban comme une **ligne brisée décalée de ± une demi-épaisseur**
    (`bordRuban`), les escales n'étant que des points de plus. Sans escale, le tracé est celui
    d'avant, caractère pour caractère.
  - Les tests mesurent le **recouvrement réellement peint** (`noeudsRecouverts` dans
    `tests/helpers.js`, par `isPointInFill` sur le tracé) et vérifient que le rendu « tout droit »,
    lui, recouvre bien le nœud traversé — sans quoi le test ne prouverait rien.
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
- **Enregistrement automatique, mais PLUS de synchro Excel automatique DANS L'APP** : `persist()`
  ne déclenche que la réécriture du `.sankey` ouvert (800 ms). `planifierEnvoiExcel()` ne fait
  rien quand la capacité `envoiAutomatique` est fausse — le cas d'Electron, où une écriture à
  chaud coûte ~1 s et ferait téléverser OneDrive à chaque frappe. L'envoi y reste explicite :
  « App → Excel » (`pushToExcel`) ou **« 📋 Copier les données Excel »**. Ne pas activer cette
  capacité pour Electron sans demande. Dans le volet Excel, elle est vraie (écriture : 12 ms).
- **Copie presse-papier (`formatExcelClipboard`)** : produit le TSV des deux tableaux tels qu'ils
  vivent dans l'onglet `Diagramme` — 8 colonnes Nœuds, **une colonne vide** (le `GAP`), 7 colonnes
  Liens, en-têtes compris — à coller en **A1**. La colonne « Valeur du flux » recopie la **formule**
  du classeur (`excel:formulas` → `readValueFormulas()` → `extractValueFormulas()`, indexée
  `id:<src> <tgt>` puis repli `name:<Origine> <Destination>`), préfixée de `=` ; sans formule connue,
  la valeur calculée est collée. Même règle que l'écriture : **ne jamais écraser un calcul** qui
  pointe vers les autres onglets.
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

### Les deux coquilles (Electron / complément Excel)

Le **même renderer** (`src/renderer/`) tourne dans deux coquilles : l'app Electron et un
**complément Office**. Chantier décrit dans `PLAN-COMPLEMENT-EXCEL.md` (phases 0 à 4 faites ;
mesures dans `RESULTATS-PHASE-0.md`).

La coquille complément a **deux contextes** depuis la phase 4 : le **volet**, qui tient Office.js
et le classeur, et une **fenêtre d'édition** séparée (Dialog API, 98 % de l'écran), qui tient
l'éditeur. Le volet plafonne à 755 px alors qu'un diagramme réel en fait 1 362 — d'où la fenêtre.
Voir « Le tunnel volet ↔ fenêtre » plus bas.

- Toute la surface native passe par **un seul accesseur**, `window.desktop`, implémenté **trois**
  fois : `src/main/preload.js` (IPC Electron), `src/addin/pont.ts` (Office.js) et
  `src/addin/pont-fenetre.ts` (le tunnel). Aucune fuite d'Electron ailleurs dans le renderer —
  **ne pas en introduire**.
- **Le renderer ne teste jamais la plateforme : il demande une CAPACITÉ** (`caps()` dans
  `editor.ts`). Six, chacune avec un consommateur réel :

  | Capacité | Electron | Volet Excel | Ce qu'elle commande |
  |---|:--:|:--:|---|
  | `fichiers` | ✓ | — | dialogues natifs, projets `.sankey`, classeur choisi sur le disque |
  | `excel` | ✓ | ✓ | panneau de synchro, lecture/écriture |
  | `classeurImpose` | — | ✓ | pas de « connecter » / « dissocier » : c'est le classeur ouvert |
  | `classeurVerrouillable` | ✓ | — | garde-fou `beginEdit()`, modales de verrou, pilotage d'Excel |
  | `envoiAutomatique` | — | ✓ | écrire vers Excel à chaque modification |
  | `apparenceDansClasseur` | — | ✓ | l'apparence est rangée dans le classeur, pas dans un `.sankey` |

  Ajouter une capacité **seulement** quand un point d'appel en a besoin ; `d.isElectron` ne
  subsiste que comme repli de `caps()` pour un pont qui n'en déclarerait aucune.
- **Dans le volet, le modèle vient du classeur et de lui seul** : `amorcerDepuisClasseur()` lit
  les tableaux au démarrage — ni exemple, ni cache `localStorage`, qui écraseraient les tableaux
  de l'utilisatrice dès la première écriture automatique. Rien ne part vers Excel tant que cette
  lecture n'a pas réussi (`amorceFaite`).
- **L'apparence voyage dans le classeur** (`document.settings`, ~1,9 Ko) : `ProjectAppearance` =
  `ProjectFile` moins le modèle, plus les `colorOverride` des liens indexés par le couple d'IDs
  (ils n'existent pas dans Excel et ne survivraient pas à une relecture). Les couleurs sont
  rendues aux liens **après** la lecture du classeur : avant, les liens n'existent pas.
- **Synchro descendante** : `Table.onChanged` sur les **deux tableaux du diagramme seulement**
  (`ecouterTableaux`), anti-rebond de 300 ms, et **filtre d'auto-écho** (`src/addin/synchro.ts`)
  à deux signaux — `triggerSource === "ThisLocalAddin"` quand Excel le donne, sinon une fenêtre
  de 1,2 s après notre écriture. Sans lui, notre propre écriture nous revient et la synchro boucle.
- **Piège de la boucle montante** : une écriture réussie appelle `persist()`, qui reprogramme
  l'envoi. `planifierEnvoiExcel()` ne part donc que si `dirtySinceSync` — ne pas retirer ce test.
- `pushEnCours` est **conservé** dans les deux coquilles : c'est le garde-fou de réentrance
  (deux écritures concurrentes), pas une optimisation du coût.
- **Manifeste** : n'y déclarer que `ExcelApi 1.1`. Un jeu d'exigences plus élevé empêche le
  complément de **se charger du tout** sur un Excel plus ancien ; ce dont on a besoin
  (`onChanged` = 1.7, `setWidth`, réglages) se sonde à l'exécution avec `isSetSupported`.
- **Servir le complément** : HTTPS obligatoire, **même origine pour ses deux pages**, bundles au
  nom **haché** (les webviews Office cachent durement). `npm run addin:serve` refuse de démarrer
  si le port 3000 est déjà pris — `SANKEY_PORT=3100` pour un essai.
- Ce qui reste vrai dans le complément : `Ctrl-Z` d'Excel ne défait pas nos écritures, et Excel
  montre le classeur comme modifié tant que l'utilisatrice ne l'enregistre pas (seul un
  « App → Excel » explicite demande l'enregistrement).

### Le tunnel volet ↔ fenêtre (complément, phase 4)

Une fenêtre de dialogue Office est **aveugle** : elle n'a que `messageParent` et
`isSetSupported` — ni `Excel.run`, ni `document.settings`. C'est la contrainte qui explique tout
le reste.

- **Cinq méthodes traversent** (`readExcel`, `writeExcel`, `excelFormulas`, `lireApparence`,
  `ecrireApparence`) et **un évènement**. Le presse-papier, l'export d'image et les constantes de
  verrou restent locaux à la fenêtre : les faire traverser serait du poids pour rien.
- **Tout transite en chaînes**, et **aucune limite de taille n'est documentée** par Microsoft.
  Mesuré sur `tests/fenetre-essai.html` : ~6 Ko par modification sur le classeur d'essai, soit
  ~70 Ko extrapolés sur un vrai projet. **Ne pas faire grossir les messages sans mesurer.**
- **L'ordre d'amorçage n'est pas négociable** : `Office.onReady` → écouter le volet et attendre
  que l'écoute soit posée → poignée de main (capacités, nom du classeur) → `createApp`. Le
  renderer lit ses capacités de façon **synchrone** au démarrage.
- **Aucune méthode du pont de la fenêtre ne lève.** Un tunnel expire, Office.js non : chaque
  méthode rend la forme d'échec que le renderer sait lire (`{ ok: false, error }`).
- **Deux caches, donc dérive de version possible.** `VERSION_PROTOCOLE` dans `protocole.ts`, et
  un message de désaccord explicite. `build.mjs` reconstruit **les deux pages ensemble** :
  ne pas casser ça. Le banc `tests/fenetre-essai.html` code la version en dur — la mettre à jour
  avec le protocole.
- **`DialogApi 1.2`** (`messageChild`) est sondé à l'exécution, **jamais déclaré** dans le
  manifeste. S'il manque, repli : l'éditeur reste dans le volet. **Jamais vérifié sous Windows.**
- Office n'autorise **qu'une fenêtre à la fois**, elle se ferme avec le volet, et sur Excel pour
  le web elle doit naître d'un clic — d'où le bouton du volet, en plus de l'ouverture au
  démarrage.

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

## powerbi-visual (terminé, contexte)
- Visuel Power BI Sankey par colonnes, TypeScript + d3-sankey, API pbiviz 5.11, packagé `.pbiviz`.
- Feature ouverte (non implémentée) : dédoubler l'« Ordre d'affichage des liens » en **ordre de
  départ / d'arrivée**. L'app de bureau contourne ça via l'ordre par nœud.

---

## Mémoire persistante
Le détail par phase vit dans les fichiers de mémoire (chargés à chaque session) :
`sankey-desktop-app.md` (app + décisions + gotchas), `sankey-visual-ordering-open.md`.
