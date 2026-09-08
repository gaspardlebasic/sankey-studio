# AGENTS.md — Sankey Studio

Instructions de projet pour les agents de codage (Claude Code, Mistral Vibe, …) **et** pour
les humains. Fichier de référence unique : `CLAUDE.md` ne fait que pointer ici.
Réponds en **français** (l'utilisateur travaille en français).

## Démarrage rapide

**Sankey Studio est un complément Excel, et rien d'autre.** Il n'y a plus d'application de
bureau : la coquille Electron, le format `.sankey`, l'écriture du `.xlsx` fermé et le pilotage
d'Excel ont été retirés. Electron ne subsiste que comme **banc d'essai** (cf. plus bas).

```bash
npm install          # une seule fois
npm run build        # construit dist/addin (le complément) et dist/renderer (le banc)
npm test             # toutes les suites
npm run smoke        # test de fumée de bout en bout (17 vérifications)
npm run addin:install -- --enligne   # installe le complément publié sur ce poste
npm run excel:cache  # vide le cache d'Excel pour Mac après une publication
```

Avant de proposer un changement : `npx tsc --noEmit -p tsconfig.json`, puis `npm test` et
`npm run smoke`.

## Clore une tâche : commiter et pousser, sans le demander

**À la fin de chaque tâche, commite et pousse sur `main` de ta propre initiative.** Ne
t'arrête pas pour demander l'autorisation : c'est la règle du dépôt, elle vaut accord une
fois pour toutes.

L'ordre est toujours le même :

```bash
npx tsc --noEmit -p tsconfig.json && npm test && npm run smoke   # tout doit être vert
git commit
git push                # pousser sur main publie le complément (.github/workflows/complement.yml)
npm run excel:cache     # les pages HTML ne portent pas d'empreinte : Excel sert l'ancienne sinon
```

Trois réserves, et trois seulement :

- **Rien ne part si une suite échoue.** Un travail inachevé se signale, il ne se pousse pas.
- **Jamais `git add -A`.** Le dépôt porte parfois le travail en cours d'une autre session, et
  un `git status` propre au démarrage ne le garantit pas : il apparaît en cours de route.
  Nommer les fichiers qu'on a soi-même touchés. Déjà vu : un `add -A` avait emporté 800 lignes
  d'un chantier voisin dans un commit qui n'avait rien à voir.
- **Pousser publie.** `main` déclenche la mise en ligne du complément (DIFFUSION.md) : ce
  qui est poussé est servi aux postes qui l'ont installé. Raison de plus pour que les
  suites soient vertes — pas pour attendre un feu vert.

Le message de commit suit l'usage du dépôt : une ligne en français, au présent, qui dit ce
que le changement fait pour l'utilisatrice — « Le panneau des réglages ne saute plus »,
pas « fix: preserve scrollTop ».

## Vérifier une fonctionnalité

On ne peut pas cliquer dans le ruban d'Excel depuis un agent. Tout le reste s'éprouve, et
plutôt bien — du plus au moins pratique :

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
   - **Electron n'est PAS le produit ici** : c'est un navigateur pilotable, le seul qui accepte
     de vraies frappes et de vrais glissers. Le pont posé devant l'éditeur est
     `tests/pont-essai.js`, qui déclare **les mêmes capacités que le volet**. S'il diverge de
     `src/addin/pont.ts`, la suite éprouve un contrat qui n'existe pas : le tenir à jour.
   - Son bouchon `excel:read` **échoue** par défaut : `amorceFaite` reste faux, donc aucune
     écriture ne part toute seule pendant les tests d'édition. Le test qui a besoin d'un
     classeur lisible pose `excelSimule.lecture` (et lit `excelSimule.lectures` pour compter
     les allers-retours) — puis **rend l'amorce** (`T.amorce(false)`) dans son `finally`, sinon
     les tests suivants se remettraient à écrire.
2. **`npm run smoke`** — test de fumée plus large (barre d'outils, bascule Aperçu, palette,
   panneau), même technique, via le crochet `window.__sankeyTest` (`caps`, `model`, `nodeCount`,
   `loadProject`, `links`, `selection`, `hidden`, `setExcelPath`, `amorce`, `reconcile`,
   `setSynced`, `refresh`). Son bouchon `excel:read` rend un **vrai classeur** : le scénario
   passe donc par l'amorçage réel du complément (`amorcerDepuisClasseur` → `reconcileFromExcel`),
   et non par un modèle posé en dur.
3. **`npm run serve`** — sert `dist/renderer` sur <http://localhost:8811> ; un navigateur
   (ou un MCP de navigateur, cf. plus bas) permet d'inspecter et de piloter la page.

4. **`npm run test:addin`** — tests de l'adaptateur Office.js, sur un **faux classeur en
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

5. **`tests/volet-essai.html`** — le renderer **sous les capacités du complément**, sans Excel :
   `npm run serve` puis <http://localhost:8811/volet-essai.html>. La page pose un faux
   `window.desktop` (mêmes capacités que `src/addin/pont.ts`) au-dessus d'un classeur en mémoire.
   `window.__volet` donne le journal des appels, l'apparence rangée et `modifierDansExcel()`
   pour jouer une saisie faite dans Excel. C'est là qu'on éprouve l'amorce, la synchro
   automatique et le panneau.

6. **`tests/fenetre-essai.html`** — le couple **volet courtier + fenêtre d'édition** de la
   phase 4, sans Excel : `npm run serve` puis <http://localhost:8811/fenetre-essai.html>.
   La page parente joue le volet et tient le classeur ; un iframe charge le **vrai** code de la
   fenêtre (`tests/fenetre-cadre.html`, qui pose un faux Office.js réduit à `messageParent`).
   `window.__essai` donne le journal, le cumul d'octets et `modifierDansExcel()`.
   C'est le seul endroit où l'on voit **le poids des messages** — l'inconnue que Microsoft ne
   documente pas. Ce qu'il ne prouve pas : `displayDialogAsync` et les limites réelles du canal,
   qui ne s'éprouvent que dans Excel.

7. **`/sonde-essai.html`** — **la sonde elle-même**, hors d'Excel : `npm run serve` puis
    <http://localhost:8811/sonde-essai.html>. Le serveur sert les **vraies** pages de
    `src/addin` en n'y remplaçant qu'Office.js par `tests/faux-office-sonde.js` — les dupliquer
    ici les laisserait diverger sans qu'on le voie. Le faux impose un plafond de 1 Mo
    (`window.__limiteFausse`) et sait jouer un poste sans `DialogApi 1.2`
    (`window.__sansDialog = true`), pour vérifier que l'échelle de mesure s'arrête au bon palier
    dans les deux modes d'échec, et que la sonde refuse de mesurer plutôt que de fausser.
    **Pourquoi ce banc existe** : la sonde part sur un poste Windows pour répondre aux questions
    qui décident du chantier (phase 6). Un instrument faux ferait perdre le déplacement.

8. **`node tests/addin-manifeste.test.js`** (dans `npm run test:addin`) — les **manifestes**.
    Un manifeste invalide ne se découvre qu'au pire moment : Excel refuse de charger, sans
    motif, sur le poste de quelqu'un d'autre. Contrôle les pièges connus (les deux tirets d'un
    commentaire, les balises non refermées) **et les règles propres au projet** qu'aucun
    validateur générique ne verrait : une seule origine pour toutes les pages, HTTPS partout,
    `ExcelApi 1.1` et rien de plus, `AppDomains` cohérent avec `SourceLocation`.
    Trois mutations vérifiées.

9. **`node tests/addin-date-build.test.js`** (dans `npm run test:addin`) — la **date de
    construction** affichée par le volet. Deux choses, parce qu'une date fausse ressemble
    à une date : la **gravure** (le `define` de `build.mjs`, contrôlé sur le bundle
    réellement construit — mutation vérifiée : retirer le `define` fait échouer deux tests)
    et la **mise en forme**, éprouvée dans un fuseau imposé (`process.env.TZ`) contre une
    chaîne écrite à la main. Le test construit `dist/addin` s'il manque : sauter en silence
    ne dirait jamais rien.

Ce qu'aucun de ces bancs ne prouve : `displayDialogAsync`, les limites réelles du canal du
tunnel, et le comportement du ruban. Ceux-là ne s'éprouvent que **dans Excel** — sur macOS
(`RESULTATS-ESSAI-MAC.md`) et sur Windows (`RESULTATS-PHASE-6.md`).

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
| _racine du dépôt_ | **Complément Excel « Sankey Studio »** : éditeur graphique de diagrammes de flux, dans le classeur ouvert. Réutilise le moteur du visuel Power BI. | **Projet actif** |

Jeu de données de référence : `flux lait essai.xlsx` (flux de production laitière).
Un prompt de reprise détaillé existe dans `CONTEXTE-REPRISE.md`.
Le chantier qui double la synchro Excel d'un **complément Office** est décrit dans
`PLAN-COMPLEMENT-EXCEL.md` : **phases 0 à 5 faites, phase 6 outillée**. Le complément lui-même
**a tourné dans Excel pour Mac le 2026-09-01** — volet, fenêtre d'édition, aller-retour complet
sur un classeur réel : `RESULTATS-ESSAI-MAC.md`. L'**installation** — mode développement sur
macOS et Windows, console d'administration M365, et manifeste publié déclaré poste par poste
(avec ou sans le dépôt sur la machine), plus le dépannage — est dans `INSTALLATION.md`. La **diffusion** (hébergement, manifeste de production) est décrite dans
`DIFFUSION.md` ; la **validation Windows** a son instrument prêt et sa grille de relevés vide
dans `RESULTATS-PHASE-6.md`. Ces deux-là demandent des droits d'administration ou un poste
Windows : le dépôt porte l'outillage, pas les résultats.
La forme retenue est **volet courtier + fenêtre d'édition séparée** (PLAN §5.4) : le volet est
trop étroit pour le canevas, l'éditeur vit donc dans une fenêtre à 98 % de l'écran.
Mesures de la phase 0 dans `RESULTATS-PHASE-0.md`, fonctionnement dans « La coquille ».

> **L'application de bureau Electron a été retirée.** Le complément est devenu le produit, et
> il l'est seul : plus de `src/main/`, plus de `.dmg`/`.exe`, plus de fichiers `.sankey`, plus
> d'écriture du `.xlsx` fermé, plus de pilotage d'Excel. `PLAN-COMPLEMENT-EXCEL.md` et les
> `RESULTATS-*.md` restent tels quels : ce sont des archives de décision, elles décrivent
> l'époque où les deux coexistaient. Electron n'est plus qu'un banc d'essai.

---

## Le complément Excel (projet actif, à la racine)

### Stack & structure
- **TypeScript**, bundlé par **esbuild** (`build.mjs`). Dépendances bundlées : `d3-sankey`,
  `d3-selection`. Aucun code de serveur, aucun processus natif : le complément est **deux pages
  web** qu'Excel héberge.
- `build.mjs` produit **deux** cibles : `dist/addin` (le produit — deux pages, deux bundles
  hachés, construits ensemble) et `dist/renderer` (l'éditeur nu, **le banc d'essai**, servi par
  `npm run serve` et chargé par les bancs Electron).
- `src/renderer/` garde son nom : c'est le code d'édition, celui que la fenêtre du complément
  fait tourner. Il ne connaît d'Excel que le contrat `window.desktop`.
- Fichiers clés :
  - `src/renderer/engine.ts` — moteur de rendu Sankey (porté du visuel Power BI) : fond blanc, colonnes, dégradés, courbes, étiquettes, centrage vertical.
  - `src/renderer/editor.ts` — éditeur : état, grille aimantée, panneau latéral, synchro Excel, export, undo/redo.
  - `src/renderer/types.ts` — `FlowModel/FlowNode/FlowLink` + `SankeyOptions`.
  - `src/shared/modele-excel.js` — **schéma du classeur, source de vérité unique** : ordre des
    colonnes (`NODE_COLS`/`LINK_COLS`), ordre de tri des lignes, types, `buildModelRows`.
    C'est la **seule** description du classeur que le complément écrit : ne jamais la dupliquer
    ailleurs. Pur, sans Office.js — donc éprouvable en Node.
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
  - `src/addin/pont.ts` — **`window.desktop` tel que le volet le pose**, au-dessus d'Office.js
    (cf. « La coquille »). Apparence dans `document.settings`, écoute du classeur,
    largeur du volet. C'est aussi la cible du courtier : la fenêtre d'édition l'appelle à distance.
  - `src/addin/protocole.ts` — **le tunnel** volet ↔ fenêtre d'édition : `Mandataire` (fenêtre) et
    `Courtier` (volet), corrélation des appels, délai de garde, poignée de main, version du
    protocole. Ne connaît ni Office ni le DOM — donc éprouvable sans Excel.
  - `src/addin/pont-fenetre.ts` — **`window.desktop` côté fenêtre d'édition** : quatre méthodes
    passent par le tunnel, le reste est local. **Aucune ne lève** — un tunnel peut expirer, ce
    qu'Office.js ne fait jamais.
  - `src/addin/courtier-volet.ts` — cycle de vie de la fenêtre d'édition (`displayDialogAsync`,
    relais, fermeture) et traduction des codes d'erreur d'Office.
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
  - `src/renderer/ui.ts` — surcouches ancrées sur un bouton : sélecteur de couleurs (grille
    teintes × nuances) et menu de choix (`openMenuPopover`, employé par les exports). Les deux
    passent par la même coquille `ouvrirSurcouche` — voile, Échap, clic dehors, replacement,
    une seule ouverte à la fois : dupliquer ça laisserait deux fermetures diverger sans qu'on
    le voie.
  - `tests/pont-essai.js` — `window.desktop` **pour les bancs Electron**, aux mêmes capacités
    que le volet. Ce n'est pas une coquille du produit : c'est un décor de test.

### Scripts
```bash
npm run build       # construit dist/addin (le produit) et dist/renderer (le banc)
npm test            # tout : Office.js, synchro, tunnel, manifestes, puis l'édition
npm test -- liaison # filtre les tests d'édition par nom
npm run smoke       # test de fumée (amorçage depuis le classeur, barre d'outils, aperçu, panneau)
npm run serve       # sert dist/renderer sur http://localhost:8811 (banc navigateur)
                    # + /volet-essai.html   : le renderer sous les capacités du complément
                    # + /fenetre-essai.html : volet courtier + fenêtre d'édition (phase 4)
                    # + /sonde-essai.html   : la sonde elle-même, hors d'Excel (phase 6)
npm run test:addin  # adaptateur Office.js, rythme de synchro, tunnel, manifestes, date de build
npm run addin:certs   # UNE FOIS : certificat HTTPS de dev (demande le mot de passe)
npm run addin:install # charge le manifeste de côté (-- --sonde, -- --retirer)
npm run addin:install -- --enligne  # pose le manifeste PUBLIÉ : ni serveur local ni certificat
                                    # (mode de diffusion sans droits M365, DIFFUSION.md §6)
                    # macOS : conteneur d'Excel · Windows : clé WEF\Developer du Registre
npm run addin:serve   # sert dist/addin en HTTPS sur https://localhost:3000
npm run addin:manifeste -- https://hote/chemin   # manifeste de production (voir DIFFUSION.md)
npm run excel:cache   # vide le cache d'Excel pour Mac (-- --strict : refuse si Excel est ouvert)
```

**Après avoir publié, vider le cache d'Excel** (`scripts/vider-cache-excel.mjs`). Les bundles JS
portent une empreinte dans leur nom et se rechargent seuls ; **les pages HTML, les styles et le
manifeste, non** — Excel peut servir l'ancienne page longtemps. Le script vide le cache HTTP du
conteneur d'Excel, ceux de WebKit et le cache des compléments d'Office.
- **Il ne touche jamais `Data/Documents/wef/`**, qui porte le manifeste chargé de côté :
  l'effacer désinstallerait le complément du poste. C'est le seul dossier « wef » qui ne soit pas
  un cache, et rien ne l'en distingue que son chemin — d'où le garde-fou `estUnCache()` et
  `tests/cache-excel.test.js`, qui l'éprouve (mutation vérifiée : un `startsWith` trop large fait
  échouer le test).
- Le module s'importe **sans rien effacer** : `main()` n'est appelée que si le script est lancé
  directement. Un module qui agirait au chargement viderait le cache rien qu'à être éprouvé.
- Excel ouvert : le cache est vidé quand même, mais il faut **quitter et rouvrir** Excel pour que
  ça compte. Et GitHub Pages garde les pages HTML ~10 min : vider dans la minute qui suit une
  publication peut ramener l'ancienne page.
Avant de proposer un changement : `npx tsc --noEmit -p tsconfig.json`, `npm test`, `npm run smoke`.

**Il n'y a plus de commande d'empaquetage.** Livrer, c'est publier le site du complément :
pousser sur `main` déclenche `.github/workflows/complement.yml` (DIFFUSION.md). Installer sur
un poste, c'est `npm run addin:install -- --enligne`.

### Modèle de données
- **FlowNode** : `id, name, column, title, order, lane, kind, filiere, color, x, y`.
  `lane` = **couloir** horizontal (entier >= 1, 1 par défaut) ;
  `kind` = **type** du nœud, `"produit"` (défaut) ou `"industrie"`.
- **FlowLink** : `id, source, target, value, unit, colorOverride?, bio?`
  (`colorOverride` = surcharge couleur propre au lien, **app only**, absente de l'Excel ;
  `bio` = part du flux en bio / durable, de 0 à 1, **lue dans le classeur et jamais réécrite**).
- **Excel** : un onglet `Diagramme`, deux tableaux Excel (ListObjects) côte à côte :
  - **Noeuds** (A..I) : Filière · Noeud · Numéro de colonne d'affichage · Intitulé de la colonne d'affichage · Ordre vertical d'affichage · Couleur · ID · **Couloir** · **Type**
  - une colonne vide (`GAP = 1`), puis **Liens** (K..R) : Filière · Origine · Destination · Valeur du flux · Unité · ID origine · ID destination · **Part bio / durable**
  - **Rangement imposé à l'écriture** : les nœuds descendent par **filière**, puis **colonne**,
    **couloir** et **ordre vertical** ; les liens suivent leur **origine**, puis leur
    **destination**. Le classeur se lit ainsi dans l'ordre où on voit le diagramme. Le tri vit
    dans `buildModelRows` (`src/shared/modele-excel.js`) et **nulle part ailleurs** — une copie
    de cette règle divergerait sans qu'on le voie. Il porte sur des **copies** : le modèle de
    l'éditeur n'est jamais réordonné.
  - Lecture **et** écriture sont indexées par **nom d'entête**, jamais par position : un
    classeur écrit avant l'arrivée d'une colonne n'a pas la même largeur de tableau, et les
    deux tableaux ne sont pas forcément aux mêmes adresses qu'aujourd'hui. « Couloir » puis
    « Type » sont d'ailleurs ajoutés **en fin** de liste pour ne pas bousculer les colonnes
    existantes.
  - **« Part bio / durable » est LUE, jamais ÉCRITE** (`LINK_COL_BIO`,
    `LINK_COLS_ECRITES`). C'est une donnée de modélisation, souvent calculée
    (`=Bio!C2/Bio!D2`) : réécrire la colonne effacerait ce calcul, exactement ce qu'Excel a
    fait à « Valeur du flux » chez AgriParis Seine. La laisser hors des colonnes écrites la
    range parmi les **colonnes de l'utilisatrice** — sa formule survit, et elle voyage avec sa
    ligne au retri (`reporterEtrangeres`). Elle reste dans `LINK_COLS` pour qu'un classeur
    préparé par le complément la porte d'emblée. Toute colonne en lecture seule doit rester
    **en fin** de `LINK_COLS` : `buildModelRows` produit les cellules dans l'ordre de
    `LINK_COLS_ECRITES`.
    - Elle suit « Valeur du flux » sur deux points (demandés le 2026-09-07) : ses **formules
      sont posées une à une, sur leur cellule** — elle courait le même risque de colonne
      calculée, et un test le montre — et une **case vide s'y écrit `0`** (`zeroSiVide` de
      `reporterEtrangeres`) : un lien sans part bio en a une, et elle vaut zéro. Les **autres**
      colonnes de l'utilisatrice gardent leur vide : un 0 dans un « Commentaire » serait une
      donnée inventée.
  - `readDiagram` renvoie **`hasLane`** et **`hasKind`** : si le classeur ignore les couloirs
    (ou les types), la réconciliation **garde** ceux de l'app au lieu de tout remettre au défaut.
  - « Type » s'écrit **en clair** (« Produit » / « Industrie ») : c'est une colonne que
    l'utilisatrice lit et remplit. La relecture (`typeDepuisTexte`) tolère la casse, les
    accents et les formulations (« Étape de transformation », « commercialisation »…) ;
    tout ce qui n'évoque pas une industrie est un produit.
  - Et **`hasBio`** pour le tableau des liens, de même : sans la colonne, l'app garde les
    parts qu'elle connaît.
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
- **Un nœud créé est TOUJOURS un « produit »**, par quelque chemin que ce soit (`＋ Nœud`, le
  « + » du nœud sélectionné, une ligne saisie dans Excel dont la colonne « Type » est vide).
  Il reprenait le type du nœud sélectionné : enchaîner deux industries en créait une, en
  silence, et la règle (« ça dépend de ce qui était sélectionné ») ne se voyait pas depuis le
  canevas. Un défaut unique se dit en un mot et se corrige en un clic.
- **La couleur d'un nœud créé dépend du chemin de création**, et de lui seul :
  - le **« + » d'un nœud** crée un nœud lié qui **hérite de la couleur** du nœud d'origine
    (`color: src.color`, `addLinkedNode`). Le « + » prolonge une chaîne, et la couleur du nœud
    dont on part est celle qu'on a sous les yeux au moment du clic. Une couleur absente se
    recopie telle quelle : la suite du fil suit alors la couleur par défaut, comme son origine.
  - **`＋ Nœud`** (barre d'outils) et le **double-clic dans le vide** créent un nœud **sans
    couleur propre** (`color: null`, `addNode`) : il se peint donc avec la couleur par défaut du
    diagramme — **`#d4d4d4`** tant qu'on ne l'a pas changée dans la carte « Nœuds ». Ces deux
    chemins ne partent d'aucun nœud : il n'y a rien à hériter.
- **Alt + glisser un nœud le duplique**, liens compris (`dupliquerNoeud`). La copie reprend tout
  du nœud d'origine — nom, type, couleur, filière, couloir — et **se raccroche aux mêmes
  nœuds** : chaque lien de l'original est recopié dans son sens, avec sa valeur, son unité et son
  apparence. Dupliquer une étape, c'est la reprendre telle qu'elle est branchée.
  - La copie se pose **juste sous l'original**, dans la même cellule : elle est là où on l'a
    prise, et le glisser l'emmène ensuite où l'on veut. C'est elle qui est sélectionnée.
  - La duplication attend le **premier mouvement**, jamais l'enfoncement : un Alt+clic sans
    glisser ne crée rien. `altKey` est relevé au `mousedown` — relâcher la touche en cours de
    route ne retransforme pas la copie en déplacement.
  - Elle vient **après le `snapshot()`** du glisser : une seule annulation efface la copie, ses
    liens et son déplacement d'un coup.
  - La liste des liens à recopier est **figée avant** d'écrire dans `model.links` : parcourir le
    tableau qu'on est en train d'allonger recopierait les copies.
  - Le geste ne se voit pas : la boîte du nœud porte une infobulle qui l'annonce, et le bandeau
    d'état dit « Nœud dupliqué, avec ses liens. » — une copie posée sous l'original se
    confondrait sinon avec un simple déplacement.
- **Types de nœuds (`kind`)** : un nœud est soit un **produit / commodité** qui circule, soit une
  **industrie** — étape de transformation ou de commercialisation. Le type vit dans Excel
  (colonne « Type ») et pilote l'apparence dans l'aperçu : largeur, police, position de
  l'étiquette, contour et mosaïque.
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
  - **Mosaïque** (`nodeTypes.<type>.mosaique`) : le nœud est peint en **damier** — un carré
    sur deux de sa couleur, l'autre blanc, `taille` px de côté (10 par défaut). Sert à marquer
    une famille de nœuds **sans dépenser une couleur de plus** : le nœud garde la sienne, il la
    porte autrement.
    - C'est un `<pattern>` des `defs`, **partagé par (taille, couleur)** et préfixé comme les
      dégradés (`d<n>-mos<i>`) : sans ce préfixe, deux filières empilées dans le même SVG
      pointeraient toutes vers le damier du premier bloc.
    - La **couleur du nœud reste sa couleur** : contour, rubans et dégradés continuent de la
      lire telle quelle, et un nœud sans mosaïque est peint exactement comme avant (même
      attribut `fill`). Rien ne bouge dans la géométrie.
    - **Aperçu et exports seulement** — comme le contour. La vue d'édition garde ses boîtes
      pleines : elles y sont de gabarit fixe et servent à attraper le nœud, pas à le montrer.
    - Le test la mesure sur la **peinture** : l'aperçu est rastérisé (SVG → Image → canvas, le
      chemin même de l'export PNG) et deux colonnes de pixels distantes d'un carré sont lues.
      Un damier les met **en opposition de phase** — c'est ce qui le distingue de simples
      rayures, et c'est ce qu'un `fill="url(#…)"` lu dans le DOM ne dirait pas. Quatre
      mutations vérifiées (rayures au lieu d'un damier, tuile d'un seul carré, taille demandée
      ignorée, plus de carré blanc).
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
  - La vue d'édition reprend la **graisse, l'italique et la casse** du type, pas sa taille :
    les boîtes y sont de gabarit fixe (`nodeH`, `wrapText` à 18 caractères). Les capitales ne
    changent pas la découpe des lignes — elle se compte en signes — ni le nom du nœud, que le
    double-clic rouvre tel qu'il est écrit dans le classeur.
- **Un seul bloc de police, partout** (`TextStyle`, `fontControls`). Partout où le choix d'une
  police se pose — étiquettes des nœuds, polices propres aux types, titres de colonnes, noms de
  couloirs, noms de filières, valeurs des liens — ce sont les **mêmes** champs : police, graisse,
  taille, couleur, puis les bascules **[G] [i] [AA]**. Avant, les cartes des types offraient la
  graisse fine que les autres n'avaient pas et les autres offraient les bascules que les types
  n'avaient pas.
  - **`weight` (300…700) a remplacé le booléen `bold`** : la bascule [G] n'en est qu'un
    raccourci (700 / 400), et les deux commandes se remettent mutuellement en accord **sans
    reconstruire le panneau** — un panneau rebâti ferait perdre le focus et replierait les
    cartes ouvertes. D'où le `sync()` porté par chaque bascule.
  - **Un projet écrit avant** arrive avec `bold` et sans `weight` ni `uppercase` :
    `normaliserPolice` traduit l'un en l'autre à la relecture (`Object.assign` ne fusionne que
    le premier niveau, une carte relue arrive donc telle qu'elle a été écrite). Sans cette
    traduction, un titre gras reviendrait maigre et `String(undefined)` atterrirait dans le SVG.
  - **`uppercase` n'est qu'un affichage** : le nom du nœud, l'intitulé de colonne et le classeur
    gardent leur casse. La mise en capitales est faite **en JavaScript** (`texteAffiche`), pas
    par `text-transform` : le moteur mesure lui-même la largeur des textes (`estimateTextWidth`)
    pour dimensionner la barre d'un titre de colonne et la gouttière des couloirs, et une
    transformation faite par le navigateur seul lui échapperait. Une capitale étant plus large,
    l'estimation prend un facteur 1,08.
- **Filières empilées : grille de colonnes commune.** `renderSankeyGroups` calcule UNE
  correspondance colonne -> couche (`denseColonnes`) et UN nombre de couches pour l'ensemble des
  diagrammes, puis la passe à chaque `drawSankey`. Sans cela chacun étale ses propres colonnes sur
  toute la largeur et la colonne 3 d'une filière ne tombe pas en face de celle de la suivante.
- **Liens qui sautent une colonne : une place leur est réservée** (`options.links.traversee`,
  « Réserver un passage » par défaut ; « Tracer tout droit » redonne le rendu d'avant).
  Cas signalé : A en colonne 1, B en 2, C en 3, avec les liens A→B, B→C **et** A→C — tracé tout
  droit, le ruban A→C passe **sur** B. Le cas `a-b-c-d` doublé d'un `a-d` (deux colonnes
  traversées) est le même problème en plus long. **Le réglage vaut pour les DEUX vues** :
  l'aperçu (`engine.ts`) et la vue d'édition (`editor.ts`), chacune avec sa géométrie.
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
  - **Vue d'édition : l'escale prend la place d'un nœud entier** (`PASSAGE_H`), pas l'épaisseur
    d'un flux — les boîtes y sont de gabarit fixe et le lien n'est qu'un trait. Elle s'insère dans
    l'empilement de la cellule traversée (`casesEmpilees`), **repousse les nœuds suivants vers le
    bas**, et le trait la franchit de part en part, en ligne droite, sur la largeur qu'aurait eue
    un nœud (`pointsDePassage`, `linkPathD(…, via)`).
    - Mêmes **deux passes** que le moteur : `placerNoeuds()` sans escale donne la géométrie qui
      dit **où** chaque lien voudrait passer (`planifierEscales`), puis on replace tout. Sans lien
      traversant, la seconde passe n'a pas lieu et la mise en page est celle d'avant, au pixel près.
    - **À égalité, l'escale passe devant le nœud** (`rangDansCellule`, `>=`) : la vue d'édition est
      une grille, un lien qui traverse à la hauteur exacte d'un nœud y est le cas courant. Le lien
      garde sa trajectoire, le nœud descend d'un cran — c'est ce qui se voit. L'aperçu, lui, place
      ses escales sur des ordonnées continues où l'égalité n'arrive pas.
    - **`rankAtY` compte les escales dans les hauteurs mais pas dans les rangs** : sans quoi le
      rang visé par un glisser ne correspondrait plus à ce qui est peint. `escales` sert aussi à
      la hauteur du canevas — une place réservée peut clore une colonne.
    - Le test mesure le tracé **réellement peint** (`noeudsTraversesEdition` dans
      `tests/helpers.js` : un lien d'édition est un trait, on échantillonne `getPointAtLength`)
      et vérifie qu'en « tout droit » le même trait recouvre bien le nœud traversé. Attention au
      diagramme d'essai : il a **déjà** des liens qui sautent une colonne, la mise en page « sans
      place réservée » est donc celle du tracé tout droit, pas celle d'avant l'ajout du lien.
- **Part bio / durable : un bandeau vert sur la tranche haute du ruban.** Chaque lien porte
  une part de flux bio (colonne « Part bio / durable » du tableau des liens, de 0 à 1) ; le
  moteur la peint comme une **bande du ruban** — entièrement vert à 100 %, deux flux collés
  l'un à l'autre à 50 %, ruban inchangé à 0 %.
  - **Une bande, pas un ruban de plus** : `bandePath` trace la portion du ruban comprise entre
    deux décalages de son axe, et `ribbonPath` n'en est que le cas [-e/2, +e/2]. Le bandeau
    suit donc les mêmes escales et la même courbure, et l'**épaisseur du flux ne change pas** —
    une coupe verticale du diagramme totalise toujours le même flux. Un test compare les
    tracés `d` des rubans avec et sans part bio : ils doivent être identiques au caractère près.
  - **La saisie se fait dans le classeur**, comme la valeur du flux : le panneau l'affiche en
    lecture seule (nous n'écrivons jamais cette colonne, une saisie faite là serait perdue en
    silence).
  - **La colonne accepte une part ou des pour cent** (`partBioDepuisTexte`) : « 0,5 », « 50 »
    et une cellule mise en forme « 50 % » (qu'Excel rend en 0,5) disent tous la moitié — au
    delà de 1, c'est un pourcentage. Tout ce qui n'est pas un nombre vaut 0.
  - Les bandeaux vivent dans **leur propre groupe** (`gBio`), après tous les rubans : ils se
    posent au-dessus de leur ruban et jamais entre deux d'entre eux. Ils portent
    `data-source`/`data-target` comme les rubans, plus une classe `lien-bio` — d'où le
    `:not(.lien-bio)` des sélecteurs de tests qui visent le ruban.
  - Les tests mesurent la **part réellement peinte** (`mesurerBio` dans `tests/helpers.js`,
    par `isPointInFill` le long d'une verticale à la sortie du nœud d'origine) et vérifient
    que le bandeau part bien du **bord supérieur** du ruban.
  - Couleur et présence sont réglables dans la carte « Liens » (`options.links.bio`).
- **La colonne « Valeur du flux » ne doit JAMAIS se remplir toute seule.** Excel a une
  correction automatique — *« Remplir les formules dans les tableaux pour créer des colonnes
  calculées »* — qui recopie sur **toutes les lignes** une formule saisie dans UNE cellule d'une
  colonne de tableau, écrasant les nombres qui s'y trouvaient, et inscrit un
  `calculatedColumnFormula`. Constaté sur `Flux APS.xlsx` (AgriParis Seine) le 2026-09-04 :
  `='Blé tendre'!$C$8` était la formule légitime du **premier** lien (production de blé tendre
  non-bio) ; Excel l'a posée sur les 149 autres, et l'affectation des données de modélisation aux
  liens a été détruite. **Le complément n'en est pas la cause — il l'a propagée.**
  - **Ce que le complément faisait** : relire ces cellules comme autant de formules
    d'utilisatrice (`collecterFormules`) et les réécrire toutes. Il **cimentait** la corruption,
    et la recréait à la première écriture qui suivait une restauration.
  - **Ce qui trahit une recopie** : le **même texte de formule ET la même valeur calculée** sur
    au moins **quatre** liens (`SEUIL_RECOPIE`). Les deux moitiés comptent — une vraie colonne
    calculée écrite en référence structurée (`=[@Quantité]*1000`) porte le même texte partout
    mais donne des valeurs *différentes*, et deux liens peuvent légitimement valoir 0.
  - **On juge LIGNE PAR LIGNE**, jamais colonne entière : `lignesDeRemplissage()` rend les
    indices à ne pas préserver. C'est ce qui rattrape les remplissages **partiels** — cent lignes
    recopiées, trente rescapées, ce qu'on trouve après une restauration ou une correction faite à
    la main. L'ancien critère (« *toutes* les lignes, la même formule ») déclarait cette
    colonne-là saine, réémettait la recopie, et Excel tuait les trente survivantes.
  - **Quatre lignes concordantes, pas deux** : écrire la même référence sur quelques liens est
    un geste courant et délibéré — le flux qui sort d'un nœud vaut celui qui y entre, et une même
    cellule peut alimenter un petit groupe de liens. À deux, la détection prenait ce geste pour
    une recopie et effaçait les formules ; à quatre, la coïncidence n'en est plus une, car une
    recopie d'Excel s'étend à toute la colonne, jamais à une poignée de lignes. Contrepartie
    assumée : quatre liens qui visent délibérément la même cellule perdent leur formule (leur
    valeur, elle, est conservée) — Excel en aurait de toute façon fait une colonne calculée.
    Le seuil est **encadré par mutation** : le ramener à 3 ou le pousser à 5 doit faire échouer
    des tests de `tests/addin-office.test.js` (deux mutations vérifiées).
  - **Et on le DIT.** Défaire la recopie ne rend pas les valeurs qu'Excel a écrasées : elles sont
    perdues, et seule l'utilisatrice peut restaurer une version antérieure — tant qu'elle sait
    qu'il faut le faire. Le résultat d'écriture porte `remplissage: { formule, liens }`, et
    l'éditeur en fait une **carte d'alerte persistante** en tête du panneau (`buildAlertePanel`),
    qui nomme la formule, compte les liens et donne le réglage d'Excel à décocher. Elle survit
    aux reconstructions du panneau : l'écriture qui la découvre est le plus souvent automatique
    et silencieuse, et un message de la barre d'état serait remplacé avant d'être lu.
  - **Et on ne suppose pas : on relit.** Le complément n'écrit **qu'une** formule — un test le
    prouve — mais ce que le classeur porte APRÈS l'écriture est une autre affaire : Excel peut
    faire de « Valeur du flux » une colonne calculée au moment même où la formule s'y pose, et
    l'étendre à tous les liens. Constaté le **2026-09-07** sur `Flux APS.xlsx`, colonne vide et
    une seule formule saisie en N2 : toute la colonne est repartie avec `='Blé tendre'!$C$8` —
    la forme **ancrée**, donc la nôtre, donc étendue APRÈS notre écriture. Et le réglage d'Excel
    était bien décoché : sur ce Mac, une formule TAPÉE dans une colonne de tableau vide ne se
    recopie pas (vérifié). Deux gardes, dans cet ordre :
    0. **On n'affecte JAMAIS la colonne entière en `.formulas`** (`poserLesFormules`) : les
       valeurs partent en bloc, puis chaque formule est posée **sur sa seule cellule**.
       Affecter la colonne entière, c'est dire à Excel quelle est la formule DE LA COLONNE : il
       en fait une colonne calculée et étend **la première** à toutes les lignes qui en
       portaient une. Vu le 2026-09-07 sur `Flux APS.xlsx` : dix formules distinctes, toutes
       remplacées par la première — pendant que les lignes en nombres, reposées juste après,
       tenaient. C'est cette asymétrie qui a tranché : une écriture **ciblée** s'impose à Excel,
       une affectation de colonne entière lui donne une idée.
    1. `reposerLesNombres()` repose les nombres des lignes sans formule **dans le même envoi**,
       juste après l'affectation de la colonne — pas un aller-retour de plus. Une recopie
       passagère est démentie avant même le `sync`.
    2. `verifierColonneValeur()` **relit** la colonne après l'écriture — un aller-retour, et
       seulement quand une formule est en jeu. Si une ligne porte une formule qu'on n'y a pas
       mise, Excel tient sa colonne calculée : on repose **toutes** les valeurs (elles viennent
       du modèle, aucune n'est perdue), la colonne perd sa dernière formule, Excel abandonne, et
       le résultat porte `remplissage: { …, aLEcriture: true }`. L'alerte du volet raconte alors
       l'autre histoire — rien n'est perdu, mais la formule n'a pas pu rester.
       - **Le critère est « une formule là où nous avons écrit un NOMBRE »**, et surtout pas
         « la formule relue diffère de celle que nous avons posée ». Excel ne rend pas les
         formules telles qu'on les lui donne : il les range dans SA forme (noms de fonctions en
         anglais, lien vers un autre classeur réécrit avec son chemin). Le second critère crie
         au loup sur NOS PROPRES formules et les efface toutes à chaque modification — il l'a
         fait le 2026-09-07, quelques heures après avoir été écrit. Contrepartie assumée : une
         colonne dont *tous* les liens portent une formule ne peut pas trahir une recopie par ce
         signe-là ; il n'y a alors aucune valeur à y sauver non plus.
       - **Second signe** : deux liens sur lesquels nous avons posé des formules DIFFÉRENTES
         n'en rendent qu'UNE. Aucune réécriture d'Excel ne confond deux formules distinctes ;
         une colonne calculée, si. Deux liens qui visent délibérément la même cellule ne sont
         pas touchés — nous avions posé le même texte sur les deux.
    Le faux Office sait jouer cet Excel-là : `monterClasseur(tables, { recopie: "passagere" })`
    pour la recopie qu'une écriture suivante défait, `{ recopie: "colonneCalculee" }` pour celle
    qui tient. Sans ces deux gardes, les deux tests correspondants rendent la colonne entière
    remplie de la même formule — le symptôme signalé, reproduit.
- **Écrire une colonne, c'est écrire une plage de la HAUTEUR EXACTE des données**
  (`colonneDuCorps`, qui part de la première cellule et redimensionne). `getColumn()` prend la
  hauteur qu'a le tableau au moment du sync ; **Excel diffuse un tableau à une ligne sur toute
  la plage** au lieu de se plaindre, et une seule cellule efface alors une colonne entière. Le
  faux Office refuse désormais toute affectation mal dimensionnée (mutation vérifiée : forcer
  la hauteur à 1 fait échouer 11 tests).
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
  segment actif en noir) · **Enregistrer** · **resynchroniser** · export PNG/SVG. « Enregistrer » range l'**apparence**
  dans le classeur, rien d'autre : le diagramme, lui, vit déjà dans les tableaux. Ni « Enregistrer
  sous… » ni « Ouvrir » : il n'y a pas de fichier projet. Ni diagramme d'exemple : un modèle qui
  ne viendrait pas du classeur finirait par l'écraser.
- **Export : la taille se demande, elle ne se devine pas.** Les boutons PNG et SVG n'exportent
  plus au clic — ils ouvrent un menu (`ouvrirMenuExport`, `openMenuPopover` dans `ui.ts`) à deux
  lignes : **« Taille de la fenêtre »** et **« Dimensions personnalisées »**. Les deux annoncent leurs dimensions **en chiffres** :
  sans elles, « personnalisées » ne dirait ni si quelque chose a été réglé, ni quoi.
  - Les dimensions personnalisées se règlent dans la carte **« Cadre du graphique »** du
    panneau, sous l'intertitre « Taille du canevas », et sont
    gardées **par combinaison de filières AFFICHÉES** (`options.exportation.tailles`, donc dans
    l'apparence du classeur). Un diagramme de trois filières n'a pas la forme du même diagramme
    réduit à une seule : la taille qui lui va se règle une fois et revient d'elle-même.
  - La clé de la combinaison (`cleFilieresAffichees`) est la liste des filières visibles,
    **triée** — masquer A puis B doit retrouver le réglage fait en masquant B puis A — et
    **sérialisée en JSON** : un nom de filière peut contenir n'importe quel caractère, un
    séparateur choisi à la main finirait par s'y trouver et deux combinaisons porteraient la
    même clé.
  - Cocher une filière **reconstruit le panneau** : sans ça la carte montrerait
    encore les dimensions de la combinaison précédente. Une mutation le vérifie.
  - Sans réglage, la carte et le menu partent de la **taille de la fenêtre** : le point de
    départ est ce qu'on voit, et une combinaison n'hérite jamais du réglage d'une autre.
  - **« Taille de la fenêtre » est du WYSIWYG, sans plancher** (`tailleFenetre`). Un minimum de
    1280 × 720 s'appliquait naguère à toute fenêtre plus petite : le menu annonçait alors
    toujours les mêmes chiffres, insensibles au redimensionnement, et le fichier sortait dans
    un format que l'aperçu n'avait jamais montré. Qui veut une image plus grande que la
    fenêtre passe par les dimensions personnalisées. En **aperçu**, la taille annoncée est
    celle du **canevas peint** (marges du cadre comprises, elles vivent dedans) ; en édition,
    le canevas suit la grille et déborde, c'est donc le cadre qui est mesuré — les deux ne
    diffèrent que de la largeur d'un ascenseur, là où le système en dessine encore.
  - Le PNG reste rastérisé au **double** (`EXPORT_ECHELLE_PNG`) ; les dimensions réglées sont
    celles du canevas de dessin, pas celles du fichier PNG.
  - **Un fichier existant n'est jamais remplacé, et l'export n'en sait rien.** L'enregistrement
    est un `<a download>` cliqué (`saveExport`) : la webview qui héberge le complément s'occupe
    du reste et ne rend **aucun compte** — ni où, ni si. Sur **Excel pour Mac** (WKWebView),
    choisir un fichier qui existe déjà et confirmer « Remplacer » ne fait rien du tout : l'API
    de téléchargement de WebKit exige une destination « qui n'existe pas »
    (`WKDownloadDelegate`, en-tête : *« it must be a file that does not exist »*), et l'échec
    est silencieux. Ailleurs, un doublon est écrit à côté. Rien de tout cela n'est réparable
    depuis le JavaScript : le menu le **dit avant** que le panneau s'ouvre
    (`AVERTISSEMENT_ECRASEMENT`, ligne `note` de `openMenuPopover`) et le statut ne promet plus
    le succès qu'il ne peut pas connaître. Deux mutations vérifiées (avertissement retiré,
    statut réaffirmant « Image exportée. »).
  - Les tests mesurent le **fichier réellement produit** : `capterExport()` (tests/helpers.js)
    intercepte `URL.createObjectURL` et le clic de l'ancre — sinon Electron ouvrirait une boîte
    d'enregistrement et le test resterait dessus — puis on lit `width`/`height` dans le SVG.
    Calculer la taille attendue depuis le modèle reproduirait la formule de l'app, et un écart
    entre le choix et le fichier passerait inaperçu. Trois mutations vérifiées (clé de
    combinaison constante, export qui ignore la taille demandée, panneau non reconstruit).
  - **Le fichier porte le nom des filières AFFICHÉES** (`nomFichierExport`), joint par « - » :
    « Lentilles.svg », « Blé tendre - Lentilles.png ». C'est ce qui distingue deux exports du
    même classeur ; « sankey (1).png » et « sankey (2).png » ne le disaient plus. Le nom est
    assaini (caractères interdits par Windows et macOS) et borné à 80 signes — dix filières
    cochées feraient un nom qu'aucun système n'accepte. Sans filière nommée : « sankey ».
    Mutation vérifiée (nom constant).
- **Hauteur des nœuds variable** : en édition, le nom passe à la ligne (`wrapText`, 18 caractères,
  4 lignes max) et la boîte grandit — `nodeH(n)` fait autorité, il n'y a plus de pas vertical
  régulier. Toute mesure verticale passe par `nodeH()` et `rankAtY()`, jamais par `NODE_H`/`ROW_H`.
- **Marges du cadre (`options.chart`, carte « Cadre du graphique »)** : quatre marges — haut,
  bas, gauche, droite. Elles **rétrécissent le cadre**, elles n'agrandissent pas le canevas :
  `margesDuCadre()` (engine.ts) rend l'origine et la taille utiles, et le fond couvre toujours
  toute la surface. Les deux latérales existent pour les libellés — un nom **centré sur un
  nœud** de la première ou de la dernière colonne déborde de la moitié de sa longueur et se
  fait couper par le bord. Deux pièges : des marges plus larges que le canevas sont rognées à
  proportion (40 px de dessin restent garantis), et le décalage à gauche doit s'accompagner du
  rétrécissement de la largeur — sinon le dessin sort du cadre par la droite sans que rien ne
  le montre dans une fixture dont la dernière colonne est vide. Le test le vérifie par le
  **pas entre colonnes**, pas par la position du dernier nœud (trois mutations vérifiées).
- **Aperçu par filière** : `options.filieres.split` empile un Sankey par filière sous son nom
  (`renderSankeyGroups` dans engine.ts ; `drawSankey` dessine un diagramme dans un `<g>` fourni
  et **renvoie l'échelle obtenue** en pixels par unité de flux). Réglages dans la carte
  « Cadre du graphique » (marges du cadre via `options.chart`). Les liens qui traversent deux
  filières n'appartiennent à aucun bloc et disparaissent dans ce mode.
- **Échelle commune (`filieres.sameScale`)** : ne pas tenter de prédire l'échelle de d3-sankey
  analytiquement — la colonne contraignante n'est pas celle qu'on croit, et les marges internes
  (barre des titres de colonnes) diffèrent d'un bloc à l'autre. `mesurerEchelle()` lance le layout
  dans un `<g>` **détaché** à deux hauteurs d'essai ; l'échelle étant affine en la hauteur, on en
  déduit la hauteur à donner à chaque bloc pour que tous partagent la même échelle.
- **Une seule carte « Nœuds »**, qui règle la boîte *et* son étiquette. Elles en faisaient deux
  (« Nœuds » et « Étiquettes des nœuds ») alors qu'elles décrivent un seul objet : on ne choisit
  pas la largeur d'un nœud sans regarder le nom posé dessus, et l'aller-retour coûtait à chaque
  essai. Ordre de lecture : la boîte, puis le nom. « Afficher » y est devenu « Afficher
  l'étiquette », la carte portant aussi « Afficher la valeur ». Un test compte les réglages
  (`tests/run.js`, « la carte « Nœuds » réunit la boîte et son étiquette ») : aucun ne doit
  disparaître d'une fusion.
- **Panneau des paramètres** : `.card-body` est une grille à 2 colonnes ; `numberField` et
  `colorField` posent la classe `half`. `buildSidebar()` reconstruit tout à chaque changement
  d'option : `card()` mémorise l'état plié/déplié par titre (`cartesOuvertes`), sinon les sections
  se replient sous les doigts de l'utilisatrice.
- **Ordre des cartes de réglages** : `buildAppearance()` ne construit plus rien lui-même, il
  **appelle une fonction par carte**. Cette liste de sept lignes EST l'ordre du panneau, et le
  réordonner tient en une ligne déplacée — avant, l'ordre se déduisait de trois cents lignes de
  construction, et il était celui de l'écriture du code (on exportait en premier, on réglait les
  nœuds en sixième). L'ordre retenu va de ce qu'on dessine à la page qui le porte :
  **Nœuds → Produits → Industries → Liens → Colonnes → Couloirs → Empilement par filière →
  Cadre du graphique**.
  - **Colonnes avant Couloirs**, comme dans le panneau d'un nœud sélectionné (*Colonne*, puis
    *Couloir*, puis *Ordre vertical*) : la colonne existe toujours, le couloir est facultatif.
  - **Produits avant Industries**, l'ordre de `NODE_KINDS` et donc de la liste « Type ». Une
    carte et une liste qui se contredisent, ça se remarque.
  - **Ne pas imbriquer les cartes.** Toutes naissent repliées : le panneau est déjà une liste de
    huit titres. Imbriquer « Produits » dans « Nœuds » coûterait un clic de plus sans économiser
    une ligne à l'écran.
  - **« Empilement par filière »** et non « Filières empilées » : le panneau porte déjà, plus
    haut, « Filières affichées ». Deux intitulés qui commencent pareil, dans la même colonne, et
    qui ne font pas la même chose, se confondent.
  - **« Colonnes »** ne règle aujourd'hui que l'entête de colonne. Le titre court a été préféré
    à « Titres de colonnes » pour la symétrie avec « Couloirs » ; s'il faut un jour un réglage
    de largeur ou d'écart entre colonnes, c'est là qu'il ira.
- **Deux fusions, une seule raison** : une carte par objet réglé, pas par groupe d'options.
  - **« Valeurs des liens » vit dans la carte « Liens »**, sous un `subhead()`, comme
    « Étiquettes des nœuds » vit dans « Nœuds ». L'épaisseur d'un ruban et le chiffre qui
    l'annonce se règlent d'un même regard. L'intertitre garde le groupe **nommé** : c'est sous
    ce nom qu'on le cherchait quand il faisait carte à part.
    - **Le format du chiffre s'y règle, il ne se devine plus** (`formatValeurLien`,
      engine.ts). Deux réglages, et un seul agit à la fois : un **multiplicateur de l'unité**
      (aucun · milliers · millions) divise TOUTES les valeurs et les écrit arrondies à
      l'entier ; sans lui, la valeur garde son ordre de grandeur et n'est arrondie qu'à N
      **chiffres significatifs**. Le champ des chiffres significatifs **disparaît** dès qu'un
      multiplicateur agit — un réglage sans effet ne reste pas à l'écran —, donc ce choix-là
      **reconstruit le panneau**.
    - L'ancien format automatique (« k », « M », « Md ») est parti d'ici : il abrégeait chaque
      valeur pour elle-même, et « 999 » à côté de « 1,0 k » ne se comparait plus d'un regard.
      `formatNumber` le garde pour l'infobulle d'un ruban et la valeur écrite dans l'étiquette
      d'un nœud, où l'on lit une valeur à la fois.
    - L'unité, elle, **reste celle de l'utilisatrice** : coller un « k » devant « tonnes »
      qu'elle vient d'écrire au long ferait un libellé faux. Une note du panneau le rappelle.
    - Les décimales gardées se déduisent de l'ordre de grandeur du nombre **arrondi**, pas de
      l'original : 9,99 à deux chiffres fait 10, et la décimale de 9,99 écrirait « 10,0 ».
    - Les valeurs peintes portent `class="link-value"` et `data-source`/`data-target`, comme
      les rubans : un test lit le chiffre **réellement écrit sur le dessin**, jamais le modèle.
      Quatre mutations vérifiées (multiplicateur ignoré, chiffres significatifs ignorés, nom de
      fichier constant, panneau non reconstruit).
  - **« Export » a disparu dans « Cadre du graphique »**, parce qu'elle ne portait *que* la
    taille du canevas. Deux cartes obligeaient à l'aller-retour pour une seule question : quelle
    place occupe le dessin. Marges et taille y sont séparées par un `subhead()`.
  - Conséquence pour les tests : `carteDuPanneau()` cherche par **sous-chaîne du titre**. Un
    test qui a besoin d'une carte « laissée fermée » comme témoin doit la **refermer
    lui-même** — les cartes gardent leur état d'ouverture pendant toute la session, donc un
    test précédent a pu ouvrir n'importe laquelle d'entre elles.
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
- **Le bouton « resynchroniser » (`resynchroniser()`), à gauche des exports.** Une icône seule —
  le picto « comparer » de la charte BASIC, ses quatre tracés repris **tels quels** ; seuls le
  cadrage et l'épaisseur du trait sont ajustés, parce qu'un dessin fait pour 68 px ne se lit pas
  à 15 (calcul dans `resyncBtn`). Il n'apparaît que si la capacité `excel` est là.
  - **Deux temps, dans cet ordre : relire, puis réécrire.** Le premier rend au diagramme ce que
    le classeur est seul à savoir (valeurs, part bio, libellés retouchés dans Excel) ; le second
    réécrit ce qu'on vient de lire — c'est lui qui rend leurs identifiants aux lignes saisies à
    la main et remet les noms du tableau des liens d'accord avec ceux du tableau des nœuds.
  - **La réécriture passe par `pushToExcel`**, jamais par un `writeExcel` posé là : c'est
    `ecrireDiagramme` qui relit les formules et les repose une par une sur leur seule cellule
    (« Ce que l'écriture préserve »), et c'est de `pushToExcel` que vient l'alerte qui dit une
    recopie défaite. Écrire en direct ici court-circuiterait les deux.
  - **Une seule lecture, pas deux** : `pushToExcel({ valeursDejaLues: true })` saute sa relecture
    de courtoisie, le modèle portant déjà ces valeurs. Un aller-retour vers Excel se compte.
  - Relire d'abord, c'est laisser le classeur gagner : si des modifications locales attendent
    (`dirtySinceSync`), le bouton le **dit** et demande confirmation avant de les perdre.
  - Une lecture réussie vaut **amorce** : quand celle du démarrage a échoué, ce bouton est ce
    qui débloque la synchro automatique.
- **Enregistrement automatique** : `persist()` range l'apparence dans le classeur (800 ms) et
  programme l'envoi du modèle (`planifierEnvoiExcel`, 300 ms). Ce dernier ne part que si la
  capacité `envoiAutomatique` est vraie — elle l'est dès qu'Excel offre `ExcelApi 1.7`, parce
  qu'écrire coûte 12 ms et ne déclenche aucun enregistrement. Sans 1.7, ce sont les deux boutons
  du panneau qui font le travail.
- **Sélectionner dans l'APERÇU, c'est cliquer le LIBELLÉ.** La boîte d'un nœud y a la largeur
  de son type, couramment zéro pixel (les rubans se rejoignent alors sur l'axe de la colonne,
  sans nœud visible) : le nom est la seule prise qui existe toujours. Le rectangle reste
  accepté quand il a une largeur, et un clic dans le vide désélectionne — sinon la carte du
  panneau ne se refermerait jamais.
  - Le moteur pose une **zone de prise invisible** (`.node-label-hit`, `fill: none` +
    `pointer-events: all`) sur le bloc de l'étiquette : un `<text>` nu ne s'attrape que sur ses
    glyphes, et un clic entre deux lettres passe au travers. Elle vaut aussi dans un SVG
    exporté, où elle ne se voit pas.
  - Le repère de sélection (`.apercu-selection`) est posé **après coup par l'éditeur**, dans le
    groupe de l'étiquette dont il partage le système de coordonnées. Le moteur n'apprend pas
    la sélection : c'est lui qui fait aussi les exports, où un halo n'aurait rien à faire.
  - `select()` ne refait pas le Sankey dans l'aperçu — seul le repère bouge. Le refaire à
    chaque clic coûterait une disposition d3 complète pour rien.
- **Interaction du canevas (plus de modes)** : un seul mode d'édition. Glisser un nœud le déplace ;
  sélectionner un nœud fait apparaître un **point de liaison sur chaque bord** (`linkDot`) — tirer
  depuis le point droit crée un lien *sortant*, depuis le gauche un lien *entrant* (`linkDrag`,
  aperçu `.link-preview`, cible surlignée `.drop-target`). Échap ou relâchement dans le vide
  annule. Le bouton « + » à droite reste le raccourci « nouveau nœud déjà relié ».
- **La pastille d'un nœud ouvre sa couleur** (`pastilleCouleur`, `ouvrirCouleurDuNoeud`) : le
  petit rond du coin haut-droit montrait déjà la couleur effective, il la règle maintenant —
  un clic sélectionne le nœud et pose la palette contre la pastille. Régler la couleur là où
  on la voit évite l'aller-retour par le panneau.
  - Une **zone de prise** invisible de 10 px de rayon entoure le rond (5 px, ça ne s'attrape
    pas), et elle reste **dans la boîte** pour ne pas manger de clics du canevas. Le `mousedown`
    est arrêté sur place : sans ça, un appui sur la pastille amorcerait un glisser du nœud.
  - La palette se place **là où il y a la place** (`placeLibre` dans `ui.ts`, `placement:
    "libre"`) : dessous, à droite, à gauche, au-dessus — le premier côté où elle tient
    **entière** l'emporte, et de côté elle glisse verticalement pour ne pas sortir de la
    fenêtre. Surtout **ne rien faire défiler** : le placement du panneau (`place`, `placement:
    "sous"`) remonte le champ en faisant défiler le volet, ce qui sur le canevas emporterait le
    nœud qu'on vient de cliquer. Les deux placements coexistent pour cette seule raison.
  - Chaque choix rebâtit le canevas, donc **la pastille ancre n'est plus dans le document** :
    la palette ne se replace que si son ancre l'est encore (`isConnected`), et
    `ouvrirCouleurDuNoeud` ancre la pastille d'APRÈS la sélection, pas celle d'où vient le clic.
- Les **valeurs de flux** vivent **uniquement dans Excel** (formules préservées à l'écriture) ;
  l'**apparence** vit dans le classeur (`document.settings`).

### La coquille (le complément) et son contrat

Le complément a **deux contextes** (phase 4) : le **volet**, qui tient Office.js et le classeur,
et une **fenêtre d'édition** séparée (Dialog API, 98 % de l'écran), qui tient l'éditeur. Le volet
plafonne à 755 px alors qu'un diagramme réel en fait 1 362 — d'où la fenêtre. Voir « Le tunnel
volet ↔ fenêtre » plus bas.

- Toute la surface Excel passe par **un seul accesseur**, `window.desktop`, implémenté
  `src/addin/pont.ts` (le volet, sur Office.js) et `src/addin/pont-fenetre.ts` (la fenêtre, par
  le tunnel). Les bancs en posent de faux : `tests/pont-essai.js` et les pages de `tests/`.
  Aucun appel à Office.js ailleurs dans `src/renderer/` — **ne pas en introduire**.
- **Le renderer ne teste jamais la plateforme : il demande une CAPACITÉ** (`caps()` dans
  `editor.ts`). Il n'en reste que **deux**, et c'est voulu :

  | Capacité | Ce qu'elle commande |
  |---|---|
  | `excel` | un classeur est joignable en lecture/écriture |
  | `envoiAutomatique` | écrire à chaque modification, au lieu des deux boutons du panneau |

  La seconde est la seule variation qui subsiste, et elle ne dépend pas de la plateforme : elle
  se **sonde** (`ExcelApi 1.7`, `isSetSupported`). C'est pour ça que la seam reste — pas par
  nostalgie d'Electron. Ajouter une capacité **seulement** quand un point d'appel en a besoin.
- **Le modèle vient du classeur et de lui seul** : `amorcerDepuisClasseur()` lit
  les tableaux au démarrage — ni exemple, ni cache `localStorage`, qui écraseraient les tableaux
  de l'utilisatrice dès la première écriture automatique. Rien ne part vers Excel tant que cette
  lecture n'a pas réussi (`amorceFaite`).
- **L'apparence voyage dans le classeur** (`document.settings`, ~1,9 Ko) : `ProjectAppearance` =
  tout sauf le modèle, plus les `colorOverride` des liens indexés par le couple d'IDs
  (ils n'existent pas dans Excel et ne survivraient pas à une relecture). Les couleurs sont
  rendues aux liens **après** la lecture du classeur : avant, les liens n'existent pas.
- **Synchro descendante** : `Table.onChanged` sur les **deux tableaux du diagramme seulement**
  (`ecouterTableaux`), anti-rebond de 300 ms, et **filtre d'auto-écho** (`src/addin/synchro.ts`)
  à deux signaux — `triggerSource === "ThisLocalAddin"` quand Excel le donne, sinon une fenêtre
  de 1,2 s après notre écriture. Sans lui, notre propre écriture nous revient et la synchro boucle.
- **Piège de la boucle montante** : une écriture réussie appelle `persist()`, qui reprogramme
  l'envoi. `planifierEnvoiExcel()` ne part donc que si `dirtySinceSync` — ne pas retirer ce test.
- `pushEnCours` est le garde-fou de **réentrance** (deux écritures concurrentes), pas une
  optimisation du coût : le retirer ferait se marcher dessus deux écritures d'une même salve.
- **Le volet affiche la DATE DE CONSTRUCTION** du bundle qu'il exécute (`src/addin/date-build.ts`,
  gravée par le `define` de `build.mjs`). Elle ne sert qu'à une chose, mais elle y sert seule :
  distinguer « ma correction n'est pas encore publiée » de « Excel me sert une page en cache ».
  Les bundles portent une empreinte et se rechargent seuls ; **les pages HTML, non**. Elle est
  posée **avant** `Office.onReady`, sans rien demander à Excel, et se répète sous un message
  d'échec (`annoncer`) — c'est justement quand ça casse qu'on veut savoir quelle version tourne.
  Sans gravure, la ligne se cache plutôt que de mentir.
- **Manifeste** : n'y déclarer que `ExcelApi 1.1`. Un jeu d'exigences plus élevé empêche le
  complément de **se charger du tout** sur un Excel plus ancien ; ce dont on a besoin
  (`onChanged` = 1.7, `setWidth`, réglages) se sonde à l'exécution avec `isSetSupported`.
- **Servir le complément** : HTTPS obligatoire, **même origine pour ses deux pages**, bundles au
  nom **haché** (les webviews Office cachent durement). `npm run addin:serve` refuse de démarrer
  si le port 3000 est déjà pris — `SANKEY_PORT=3100` pour un essai.
- `Ctrl-Z` d'Excel ne défait pas nos écritures, et Excel montre le classeur comme modifié tant
  que l'utilisatrice ne l'enregistre pas (seul un « Diagramme → Excel » explicite demande
  l'enregistrement).
- **Le panneau n'a plus de section « Synchronisation Excel »** : classeur imposé, synchro
  automatique — il n'y avait plus rien à y décider. `buildExcelPanel()` ne rend une section
  (« Synchronisation manuelle », deux boutons) **que** si `envoiAutomatique` est faux ; c'est
  alors le seul moyen d'échanger avec le classeur, pas un confort. Ne pas la supprimer sans
  d'abord donner une autre issue aux Excel sans `ExcelApi 1.7`.

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
- **La fenêtre reste au-dessus d'Excel, et rien ne le change** (vérifié le 2026-09-04).
  `DialogOptions` n'a que `height`, `width`, `displayInIframe`, `promptBeforeOpen` et
  `asyncContext` : aucun réglage d'ordre d'empilement. La documentation ne promet que
  *non modale* — on peut continuer à travailler dans le classeur derrière — plus déplaçable
  et redimensionnable. `displayInIframe` ne concerne qu'Excel pour le web, et y donne une
  surcouche flottante : encore plus au-dessus. La seule façon d'avoir une fenêtre qui se
  comporte comme les autres serait de ne pas en ouvrir — l'éditeur dans le volet, c'est-à-dire
  le repli de compatibilité, à 755 px pour un diagramme qui en fait 1 362. Ne pas rouvrir la
  question sans un changement d'API de Microsoft.

### Synchro Excel

Le complément écrit **dans le classeur ouvert**, par Office.js. Tout ce qui servait autrefois à
disputer le fichier à Excel — verrou `~$`, `fs.watch`, AppleScript, JXA, COM/PowerShell,
écriture du `.xlsx` fermé par JSZip — a disparu avec la coquille Electron. Ce qui reste :

- **Montante** (diagramme → classeur) : `pushToExcel()`. Elle relit d'abord le classeur pour
  **conserver les valeurs déjà saisies** dans les liens existants, puis écrit. Automatique
  (300 ms d'apaisement) quand `envoiAutomatique` est vrai, par bouton sinon.
- **Descendante** (classeur → diagramme) : `Table.onChanged` sur les **deux tableaux du
  diagramme seulement**, anti-rebond de 300 ms, filtre d'auto-écho (cf. « La coquille »).
- Réconciliation **par ID**, avec `syncedNodeIds`/`syncedLinkIds` : c'est ce qui distingue une
  ligne supprimée dans Excel d'une ligne jamais synchronisée.
- **Les formules sont préservées** : avant d'écrire, `ecrireDiagramme` relit les cellules
  « Valeur du flux » qui commencent par `=`, les indexe par `(ID origine, ID destination)` puis
  les réémet. `range.formula` est en syntaxe **US** (`=SUM(...)`) dans les deux sens, quelle que
  soit la langue de l'interface — `formula local` donnerait `=SOMME(...)`.
  Une formule appartient à **un seul** lien : l'appariement se fait par ID d'abord, par noms
  ensuite, et la ligne d'origine est **consommée**. Sans ce jeton, deux liens portant les mêmes
  noms d'extrémités (le même « Transport → Pertes » dans deux filières) se partageaient la
  formule du premier — elle était recopiée sur le second, qui n'en avait pas.
  **Les références sont ancrées** en réémettant (`Lentilles!C68` → `Lentilles!$C$68`,
  `ancrerFormule`). Une formule suit son lien, donc elle change de ligne : sans `$`, c'est le
  genre de référence qu'Excel recale (recopie, colonne calculée qui se remplit seule) et la
  formule se met à lire une autre ligne de l'onglet source. Ne sont PAS touchés : les noms
  d'onglets (`T2!B7` garde son `2`), les chaînes littérales, les références structurées
  (`[@[Q4]]`, déjà relatives à leur ligne) et les appels de fonction (`LOG10(`). Contrepartie
  assumée : un tirer-recopier de la ligne ne fera plus glisser la référence.
- **Les identifiants sont posés dès qu'une ligne apparaît.** Une ligne saisie dans Excel n'a ni
  `ID` (nœuds) ni `ID origine`/`ID destination` (liens) : `reconcileFromExcel` rend
  `assigned = true` dans les deux cas, ce qui déclenche une réécriture qui les inscrit. Tant que
  ces colonnes sont vides, la ligne ne se reconnaît que par les NOMS — le repli fragile, celui
  qui confond deux homonymes.
- **Les formules d'une colonne de l'utilisatrice sont posées CELLULE PAR CELLULE**, comme
  celles de « Valeur du flux » (`poserLesFormules`, appelé aussi par `reporterEtrangeres`) : une
  affectation de colonne entière en `.formulas` dit à Excel quelle est la formule DE LA COLONNE.
  Nuance pour ces colonnes-là : nous ne savons pas ce que leurs formules produisent, donc pas de
  passe de valeurs en bloc avant — on ne touche que les cellules qui leur reviennent, sinon on
  les écraserait d'un blanc.
- **Les colonnes de l'utilisatrice voyagent avec leur ligne.** Une colonne que nous ne
  connaissons pas (un « Commentaire », une quantité brute) n'est pas calculée, mais elle est
  **déplacée** avec le nœud ou le lien de sa ligne. Ne pas y toucher du tout ne la protégeait
  qu'en apparence : les lignes sont **retriées à chaque écriture** (`buildModelRows` range par
  filière, colonne, couloir, ordre — **filière vide en dernier**), si bien qu'à la première
  édition qui change l'ordre, le
  repère se retrouvait en face d'un autre lien — et une formule qui le vise par son adresse
  (`=Q3*1000`) lisait la ligne du voisin. Une ligne nouvelle arrive avec ces cellules **vides**,
  jamais avec celles du voisin.
- **Enregistrement** : seul un « Diagramme → Excel » explicite le demande (`options.save`). La
  synchro de fond ne le fait jamais — sinon OneDrive téléverserait à chaque frappe. Excel montre
  donc le classeur comme modifié : c'est dit dans l'interface.
- **Contrepartie** : `Ctrl-Z` dans Excel ne défait pas une écriture du complément.

### Vérification
Voir « Vérifier une fonctionnalité » en tête de fichier.

### Pièges à connaître
- **Icône** : source = `build/icon.svg` (glyphe Sankey au style du dictionnaire BASIC :
  viewBox 50, trait 2.5, `fill none`, onglets, bouts francs — tuile noire / glyphe blanc).
  Les icônes du ruban (`build/addin/icon-*.png`, 16/32/64/80 px) en sont tirées ; c'est le seul
  usage qui reste depuis le retrait du `.icns`/`.ico`. `npx electron scripts/render-icon.js`
  rend le SVG en PNG 1024 avec Chromium (**qlmanage rastérise en escalier**, ne pas l'utiliser).
  Les angles des bandes doivent être des **tracés fermés** (`Z`), sinon les segments juxtaposés
  laissent des marches aux jonctions.
- **Octets NULL** : des éditions ont déjà transformé des séparateurs `" "` en `0x00` (le fichier
  devient « binary » pour `file`/`grep -a`, les correspondances de clés échouent). Déjà arrivé 2×.
  En cas de bug de clés inexpliqué : scanner les `\x00`, remplacer par un espace.
- **Le panneau se reconstruit tout seul pendant la saisie.** `buildSidebar()` vide `#sidebar` et
  le rebâtit ; les gestionnaires de champ s'en abstiennent, mais l'**écriture automatique vers
  Excel** le fait, 300 ms après la dernière frappe (`DELAI_ENVOI_EXCEL`, puis `pushToExcel`). Une
  frappe hésitante suffit donc à la déclencher en plein mot. `buildSidebar()` relève et repose
  pour cette raison **le défilement du panneau, le champ actif et la position du curseur** — un
  champ nouvellement ajouté n'a rien à faire pour en bénéficier, mais il doit passer par
  `field()` / `card()` : le repère se lit sur `.field > span` et sur le titre de la carte. Deux
  cartes portent des intitulés identiques (« Largeur », « Contour », « Police » dans les deux
  cartes de type) : c'est le titre de la carte qui les départage.

### À faire
- **La campagne de mesures Windows** (phase 6) : la grille de `RESULTATS-PHASE-6.md` est vide.
  Le complément lui-même **tourne** sous Windows (installé et vérifié le 2026-09-01, VM
  Parallels, Excel 365 ARM64) ; ce sont les mesures — poids du tunnel, délais, polices — qui
  restent à prendre.
- **Le téléversement M365** (DIFFUSION.md §3) demande un administrateur du tenant. En attendant,
  l'installation se fait poste par poste (`--enligne`, §6).

---

## powerbi-visual (terminé, contexte)
- Visuel Power BI Sankey par colonnes, TypeScript + d3-sankey, API pbiviz 5.11, packagé `.pbiviz`.
- Feature ouverte (non implémentée) : dédoubler l'« Ordre d'affichage des liens » en **ordre de
  départ / d'arrivée**. L'app de bureau contourne ça via l'ordre par nœud.

---

## Mémoire persistante
Le détail par phase vit dans les fichiers de mémoire (chargés à chaque session) :
`sankey-desktop-app.md` (app + décisions + gotchas), `sankey-visual-ordering-open.md`.
