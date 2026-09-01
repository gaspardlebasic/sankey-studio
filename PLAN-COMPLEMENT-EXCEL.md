# Plan — Sankey Studio comme complément Excel

**Solution retenue : volet courtier + fenêtre d'édition séparée.** L'éditeur ne vit pas dans le
volet — il vit dans une **fenêtre d'édition** ouverte par le complément (Dialog API), qui prend
jusqu'à 99,5 % de l'écran. Le **volet** garde ce qu'elle ne peut pas avoir : Office.js et le
classeur ; il devient un **courtier**, et les deux se parlent par un tunnel de messages (§5.4,
§9). Ce choix était le repli du plan initial : la phase 0 (§G) l'a rendu nécessaire, en mesurant
qu'un diagramme réel fait 1 362 px de large là où le volet plafonne à 755 px.

**État : phases 0 à 5 faites (2026-08-31), phase 6 outillée.** Phase 0 : GO, 7 questions sur 7.
Phase 1 : adaptateur `src/addin/excel-office.ts` + schéma partagé `src/shared/modele-excel.js`,
18 tests sur faux classeur. Phases 2 et 3 : coquille, manifeste, capacités du renderer et
synchro évènementielle. Phase 4 : le tunnel, le volet courtier, la fenêtre d'édition, 17 tests.
Phase 5 : publication automatique sur GitHub Pages, manifeste de production engendré et vérifié.
Phase 6 : la sonde porte les deux questions qui décident, et a été éprouvée hors d'Excel.
**Le complément a tourné dans Excel pour Mac le 2026-09-01** — volet, fenêtre d'édition et
aller-retour complet sur un classeur réel, un défaut trouvé et corrigé : `RESULTATS-ESSAI-MAC.md`.
**Prochaine étape : publier (`DIFFUSION.md`) et mener la campagne de mesures Windows
(`RESULTATS-PHASE-6.md`).**
Ces trois-là demandent Excel, des droits d'administration ou un poste Windows : le dépôt porte
l'outillage, pas les résultats.
Mesures : **`RESULTATS-PHASE-0.md`**. Écriture mesurée à **12 ms pour 2 001 cellules**
(contre ~1 350 ms pour 500 en JXA). Questions ouvertes, toutes deux à trancher dans Excel :
le **poids des messages** du tunnel et la présence de **`DialogApi 1.2` sous Windows** (§7) —
**toutes deux tranchées sur macOS le 2026-09-01** (`RESULTATS-ESSAI-MAC.md`), et ouvertes
seulement sous Windows.
Ce document remplace la discussion ; le suivi d'avancement se fait en cochant les phases.

---

## 1. Pourquoi

L'app parle aujourd'hui à Excel par le **fichier** et par le **pilotage d'Excel**
(`excel.js` + `excel-live.js` + `excel-control.js`, ~1 780 lignes). Tout ce qui est difficile
là-dedans vient de OneDrive : Excel pour Mac ouvre le classeur depuis son **URL SharePoint**
et non depuis la copie locale, il ne pose pas de fichier verrou `~$`, et `fs.watch` ne voit
rien. D'où le sondage à 4 s, les modes `verrou`/`excel`/`indetermine`, le garde-fou d'édition,
la fermeture automatique d'Excel.

Un complément Office ne parle **ni au fichier ni à Excel** : il parle au **classeur en mémoire**.
Chemin local, dossier synchronisé, URL SharePoint, fichier jamais descendu sur le disque —
indifférent. Toute cette couche disparaît, et le chemin Windows (écrit, jamais exécuté) devient
le même code que macOS.

---

## 2. Architecture cible : un renderer, deux coquilles

Le pivot existe déjà dans le code. Toute la surface native passe par **un seul accesseur**,
`desktop()` (`src/renderer/editor.ts:2949`), qui expose **16 méthodes** sur ~30 points d'appel,
tous gardés par `d.isElectron`. Aucune fuite d'Electron ailleurs dans les 5 437 lignes du
renderer. Il « suffit » d'écrire une seconde implémentation de ce contrat au-dessus d'Office.js.

```
                    src/renderer/  (editor.ts, engine.ts, ui.ts — inchangé)
                              │
                     window.desktop  ← le contrat, 16 méthodes
                    ┌─────────┴──────────────┐
        src/main/preload.js          src/addin/pont-fenetre.ts
        (IPC → Electron)             (tunnel → volet)
                 │                            │  messageParent / messageChild
                 │                    src/addin/pont.ts
                 │                    (Office.js → classeur)
                 │                            │
        app autonome, fichiers        fenêtre d'édition + volet courtier
```

- **Coquille Electron** : conservée telle quelle. Mode autonome, fichiers `.sankey`, Excel fermé.
- **Coquille complément** : nouvelle. Mode connecté, Excel ouvert, synchro instantanée. Elle a
  **deux contextes** depuis la phase 4 — le volet, qui tient Office.js, et la fenêtre d'édition,
  qui tient l'éditeur — reliés par `src/addin/protocole.ts`.
- `d.isElectron` devient un **drapeau de capacités** — `peutOuvrirFichier`, `peutEnregistrerImage`,
  `synchroTempsReel`, `classeurVerrouillable` — au lieu d'un test de plateforme. C'est le seul
  refactor imposé au renderer, et il touche ~30 lignes.

---

## 3. Contraintes vérifiées (doc Microsoft, 2026-08-31)

| Point | Fait établi | Conséquence |
|---|---|---|
| Protocole | La page du complément doit être servie en **HTTPS** | Hébergement statique externe (§5.3) |
| Largeur du volet | Max **50 % de la fenêtre Excel**. **Observé sur le poste : défaut 350 px, plafond 755 px** (la doc annonce 270 px de défaut) | Trop étroit pour l'éditeur : d'où la fenêtre séparée (§5.4) |
| API de largeur | `Office.extensionLifeCycle.taskpane.setWidth(px)`, jeu **`TaskPaneApi 1.1`** (orthographe exacte) ; hors bornes = sans effet **et sans erreur** | Ouvrir large au démarrage |
| Évènements | `Worksheet.onChanged` / `Table.onChanged` = **ExcelApi 1.7** (2017) | Synchro descendante sans sondage |
| Menu « personnalité » | Obstrue le coin haut-droit du volet : 12×32 px sur Windows, **34×32 px** sur Mac | Ne rien mettre de cliquable là |
| Fenêtre d'édition | `displayDialogAsync` : **non modale**, déplaçable, redimensionnable, jusqu'à **99,5 %** de l'écran | C'est là que vit l'éditeur (§5.4) |
| Limite de la fenêtre | Dedans, **seules** `messageParent` et `isSetSupported` existent — pas de `Excel.run` | Le volet reste le courtier |

**Piège de manifeste** : déclarer un jeu d'exigences dans le manifeste empêche le complément de
**se charger du tout** sur un Excel plus ancien. Déclarer un minimum bas (`ExcelApi 1.1`) et
sonder à l'exécution avec `Office.context.requirements.isSetSupported`.

---

## 4. Le contrat à réimplémenter

Les 16 méthodes de `window.desktop`, et ce qu'elles deviennent côté complément. Ce tableau décrit
le pont du **volet** (`pont.ts`), qui parle à Excel. Depuis la phase 4, la **fenêtre d'édition**
en a un troisième (`pont-fenetre.ts`) : il passe au volet les **cinq** lignes marquées *lourde* ou
*moyenne* qui touchent au classeur, et fait le reste sur place.

| Méthode | Côté complément | Charge |
|---|---|---|
| `readExcel(path)` | `Excel.run` → lit les 2 tableaux → `{ok, live:true, data}` | **lourde** |
| `writeExcel(model, path, sheet, opts)` | `Excel.run` → écrit les 2 tableaux, préserve les formules | **lourde** |
| `excelFormulas(path)` | lit la colonne « Valeur du flux » en `.formulas` | moyenne |
| `isExcelLocked` / `watchExcel` / `closeExcelWorkbook` / `canControlExcel` | constantes triviales : **jamais verrouillé, pilotage inutile** | nulle |
| `onExcelChanged` | branché sur `Table.onChanged` — **remplace le sondage** | moyenne |
| `onExcelLock` | ne se déclenche jamais | nulle |
| `chooseExcel` / `openExistingExcel` | sans objet : le classeur est **celui qui est ouvert** | nulle |
| `saveProject` / `openProject` / `pendingProject` / `onProjectOpened` | l'apparence vit dans le classeur (§5.2) | moyenne |
| `exportSave(name, data, binary)` | téléchargement navigateur (`Blob` + `<a download>`) | faible |
| `copyToClipboard(text)` | `navigator.clipboard.writeText` | faible |

**Formes de données à respecter à l'octet près** (elles sont déjà consommées par le renderer) :

- `ExcelData` (`editor.ts:238`) : `{ nodes, links, hasLane?, hasKind? }`.
  `hasLane`/`hasKind` disent si le classeur porte les colonnes « Couloir » et « Type » ;
  sans elles, l'app garde les siennes. **Ne pas les oublier** : c'est la compat des vieux classeurs.
- `readExcel` → `{ ok, live, data }` ; `writeExcel` → `{ ok, live, path, sheetName, enregistre, formules, ms }`.
- `excelFormulas` → `{ ok, formules }`, indexé `id:<IDorigine> <IDdestination>` puis repli
  `name:<Origine> <Destination>`.

**Schéma du classeur** (source de vérité : `src/main/excel.js:46`) — à reproduire tel quel :

- Feuille `Diagramme`. Les deux tableaux se retrouvent **par leurs en-têtes**, jamais par leur
  adresse (`nodesT` = celui qui contient « Noeud », `linksT` = celui qui contient « Origine »).
- `NODE_COLS` (9) : Filière, Noeud, Numéro de colonne d'affichage, Intitulé de la colonne
  d'affichage, Ordre vertical d'affichage, Couleur, ID, Couloir, Type.
- `LINK_COLS` (7) : Filière, Origine, Destination, Valeur du flux, Unité, ID origine, ID destination.
- `GAP = 1` colonne vide entre les deux tableaux.
- Un lien est identifié par le **couple (ID origine, ID destination)** — pas d'identifiant propre.

---

## 5. Décisions prises

### 5.1 L'app Electron survit
Elle n'est pas touchée. `excel.js` / `excel-live.js` / `excel-control.js` **restent en place**
tant que le complément n'est pas éprouvé. Leur retrait éventuel est un chantier séparé, à décider
après plusieurs semaines d'usage réel.

### 5.2 L'apparence vit dans le classeur
Aujourd'hui `ProjectFile` (`editor.ts:2668`) = `{ version, model, options, idCounter, excelPath,
hiddenFilieres }`. Dans le complément, **`model` vient d'Excel** : il ne faut donc persister que
le reste. Définir un type réduit :

```
ProjectAppearance = { version, options, idCounter, hiddenFilieres,
                      colorOverrides: Record<"idSrc idTgt", string> }
```

`colorOverride` est aujourd'hui porté par `FlowLink` et n'existe pas dans Excel — il faut donc
l'extraire dans une table indexée par le couple d'IDs pour survivre à une relecture.

**Fait en phase 2** : `ProjectAppearance` (`editor.ts`), `serialiserApparence()` /
`appliquerApparence()`, rangé sous la clé `sankey-studio-apparence`. Les couleurs de liens sont
mises de côté (`couleursLiensEnAttente`) et rendues aux liens **après** la lecture du classeur —
ils n'existent pas avant. Mesuré sur le banc d'essai : **1 898 o**.

**Stockage** : `Office.context.document.settings` + `saveAsync()` — persisté **dans le classeur**,
donc le diagramme voyage avec le fichier. Repli si la taille coince : `workbook.customXmlParts`
(ExcelApi 1.5). **À mesurer en phase 0** : le poids de `options` sur un vrai projet.

### 5.3 Hébergement — **GitHub Pages**
Statique pur, HTTPS. Le dépôt y est déjà et le site ne coûte rien ; Cloudflare Pages ferait
aussi bien et permettrait en plus de fixer les en-têtes de cache, ce que Pages ne permet pas —
à reconsidérer seulement si le cache de dix minutes sur les pages HTML devient gênant
(`DIFFUSION.md`). La page est publique mais **ne porte
aucune donnée** — tout reste entre Excel et la webview. Nom de fichier des bundles **haché**
(`index.<empreinte>.js`, `fenetre.<empreinte>.js`) : les webviews Office cachent agressivement.
Les **deux pages** du complément doivent être servies depuis la **même origine**, sous-domaine
compris (§5.4) : une seule origine, pas de découpage `app.` / `editeur.`.

### 5.4 L'éditeur vit dans une fenêtre séparée, le volet est courtier
**La décision de ce chantier**, prise au terme de la phase 4 et mesurée en phase 0 (§G) : en
mode Édition, un diagramme réel fait **1 362 px** de large et cette largeur est fixe (7 colonnes
× largeur de nœud) ; le volet plafonne à **755 px**, et le panneau latéral en prend 288. Même
replié en colonne unique, le volet ne montrerait qu'un peu plus de la moitié du diagramme — pour
une activité qui consiste à faire glisser des nœuds d'une colonne à l'autre, c'est un handicap
qu'aucune mise en page ne rattrape.

Donc :

- **La fenêtre d'édition** (`fenetre.html`, Dialog API) héberge le renderer, non modale, à 98 %
  de l'écran. L'utilisatrice édite et clique dans Excel sans rien fermer.
- **Le volet** (`index.html`) ne montre plus l'éditeur : nom du classeur, état, un bouton. Il
  garde Office.js, le classeur et l'écoute des évènements.
- Ils se parlent par **`messageParent` / `messageChild`** (`DialogApi 1.2`), tunnel décrit en §9.
- **Repli de compatibilité** : si `DialogApi 1.2` manque, l'éditeur reste dans le volet, comme
  avant la phase 4. Étroit, mais entier — et c'est du code déjà écrit, pas une branche morte.

Ce que ça ne change pas : l'adaptateur, le schéma du classeur, les capacités, et **tout le
renderer**. Le contrat `window.desktop` a simplement une troisième implémentation.

---

## 6. Phases

### ~~Phase 0 — sonde~~ — **FAITE le 2026-08-31, verdict GO** (`RESULTATS-PHASE-0.md`)

Complément nu, chargé de côté sur Mac. Objectif : répondre aux questions qui décident du reste.

1. Sonder les jeux d'exigences sur ton Excel **et** sur un poste Windows de la boîte :
   `ExcelApi` (viser ≥ 1.7), `TaskPaneApi 1.1`, `Settings 1.1`.
2. Lire les deux tableaux du vrai `Flux légumineuses.xlsx` **ouvert depuis SharePoint**.
3. Réécrire 500 cellules et **chronométrer** — référence actuelle : **1,35 s** en JXA.
4. Vérifier que les **21 formules** `'Données de flux'!B…` survivent.
5. Recevoir un `Table.onChanged` après une frappe de l'utilisatrice.
6. Écrire puis relire un blob d'apparence de taille réelle dans `document.settings`.
7. **Photographier le volet à 50 % de largeur** avec le canevas dedans, pour juger §7.

Livrable qui reste utile : un **banc d'essai** dans le volet (bouton « diagnostic » qui fait
lecture → écriture → comparaison cellule à cellule et affiche les temps), équivalent de
`npm run proto:excel`.

**Abandon si** : `ExcelApi < 1.7` sur les postes Windows de la boîte, ou écriture > 5 s, ou
formules perdues. On repasse alors sur Graph (l'admin dirait oui).

### ~~Phase 1 — l'adaptateur Office.js~~ — **FAITE le 2026-08-31**

`src/addin/excel-office.ts` : `lireDiagramme()` / `ecrireDiagramme()` / `lireFormules()`.
C'est le cœur, et c'est la transposition de la logique métier de `excel-live.js` :

- **Une seule `context.sync()` par opération.** La leçon de `excel-live.js` — *le coût est le
  nombre d'allers-retours, pas le nombre de cellules* — vaut identiquement ici, mais l'API la
  rend naturelle. Ne jamais boucler cellule par cellule.
- **Formules** : relire la colonne « Valeur du flux » en `.formulas` **avant** d'écrire,
  réassocier par `(ID origine, ID destination)`, réémettre. `.formulas` est en syntaxe **US**
  (`=SUM(...)`) quelle que soit la langue de l'interface — même syntaxe que le `<f>` du XML,
  donc les deux chemins d'écriture restent cohérents.
- **Redimensionner les tableaux** : `table.rows.add()` / `range.delete(shift up)`, **limité aux
  colonnes du tableau** sinon le tableau voisin se décale. Un tableau Excel ne peut pas avoir
  zéro ligne : en garder une, vide.
- **Colonne manquante** (« Couloir », « Type » sur un vieux classeur) : écrire l'en-tête dans la
  colonne qui suit étend le tableau, à condition qu'elle soit libre. Sinon, renseigner
  `hasLane: false` / `hasKind: false` et laisser l'app garder ses valeurs.

### ~~Phase 2 — la coquille et le manifeste~~ — **FAITE le 2026-08-31**

- `src/addin/pont.ts` — la seconde implémentation de `window.desktop` : lecture/écriture par
  l'adaptateur, constantes triviales pour le verrou et le pilotage, apparence dans
  `document.settings`, presse-papier, `setWidth` au démarrage.
- `src/addin/index.ts` + `index.html` — la coquille. **Écart assumé au plan** : le pont n'est pas
  posé par un `<script>` séparé *avant* le bundle mais par l'entrée du bundle elle-même, dans
  `Office.onReady`. Un `<script>` ne suffit pas : `Office.onReady` est asynchrone, et le renderer
  lit `window.desktop` dès `createApp`. Une seule entrée, un seul ordre possible.
- Deuxième cible dans `build.mjs` → `dist/addin/bundle.<empreinte>.js`, `index.html` réécrit avec
  le nom obtenu, dossier vidé à chaque construction (sinon on ne sait plus lequel la page charge).
- **Capacités** — six, chacune avec un consommateur réel dans le renderer, pas une de plus :
  `fichiers`, `excel`, `classeurImpose`, `classeurVerrouillable`, `envoiAutomatique`,
  `apparenceDansClasseur`. Elles sont déclarées par les deux ponts (`preload.js`, `pont.ts`) et
  lues par `caps()` (`editor.ts`). Plus aucun `d.isElectron` dans le renderer, sauf comme repli
  de `caps()` pour un pont qui ne déclarerait rien.
- **Amorce** : dans le volet, le modèle vient du classeur et de lui seul — ni exemple, ni cache
  `localStorage`. Les envoyer dans le classeur de l'utilisatrice détruirait ses tableaux. Rien ne
  part vers Excel tant que la première lecture n'a pas réussi (`amorceFaite`).
- Manifeste `src/addin/manifest.xml` : `SourceLocation` HTTPS, bouton de ruban (`VersionOverrides`),
  `Requirements` minimal (`ExcelApi 1.1`), icônes 16/32/80 dans `build/addin/`.
- Chargement de côté : `npm run addin:install` (macOS, `wef`) ; `-- --sonde` pour la phase 0,
  `-- --retirer` pour les deux. Windows : dossier partagé déclaré comme catalogue de confiance
  dans le Centre de gestion de la confidentialité (phase 6).
- **Reste à faire** : le manifeste n'a pas été validé par `office-addin-manifest` (paquet absent).
  Il a en revanche été **chargé dans Excel pour Mac** le 2026-09-01, bouton de ruban compris
  (`RESULTATS-ESSAI-MAC.md`).

### ~~Phase 3 — synchro évènementielle~~ — **FAITE le 2026-08-31**

- `ecouterTableaux()` (`excel-office.ts`) branche `Table.onChanged` sur les **deux tableaux du
  diagramme et sur eux seuls** — le classeur d'essai en portait trois. `src/addin/synchro.ts`
  porte le rythme : anti-rebond de 300 ms (comme `notifyTimer`, `main.js:62`) et **filtre
  d'auto-écho** à deux signaux — `triggerSource === "ThisLocalAddin"`, qu'Excel nous donne, et
  une fenêtre de 1,2 s après chaque écriture, pour les hôtes qui ne le donnent pas.
  11 tests (`npm run test:addin`), éprouvés par mutation.
- Sondage, garde-fou `beginEdit()` et modales de verrou : neutralisés **par la capacité**
  `classeurVerrouillable`, pas par un `if` de plateforme. Le code Electron est intact.
- **Synchro montante automatique : oui**, gouvernée par `envoiAutomatique`. `planifierEnvoiExcel()`
  n'est plus vide, mais elle ne fait rien dans Electron (l'écriture y coûte ~1 s et ferait
  téléverser OneDrive à chaque frappe).
  - **Piège trouvé à l'écriture** : une écriture réussie appelle `persist()`, qui reprogrammait
    l'écriture suivante — boucle sans fin. Le minuteur ne part donc que si `dirtySinceSync`.
- **Écart assumé au plan** : `pushEnCours` est **conservé**. Ce n'est pas une optimisation du coût
  d'écriture, c'est le garde-fou de réentrance — deux `Excel.run` d'écriture concurrents se
  marcheraient dessus — et la reprogrammation est ce qui garantit que le dernier changement d'une
  salve arrive. À 12 ms il ne se déclenche presque jamais ; le retirer ne gagnerait rien et
  perdrait cette garantie.
- **Vérifié sans Excel** : `tests/volet-essai.html` (servi par `npm run serve`) fait tourner le
  renderer sous les capacités du complément, avec un faux pont et un classeur en mémoire.
  Constaté : le diagramme vient du classeur (pas d'exemple), le panneau ne propose plus de
  connecter un classeur, une modification part toute seule en **une** écriture (pas de boucle),
  l'apparence est rangée (1 898 o, conforme aux ~2 Ko mesurés en phase 0) et une modification
  « faite dans Excel » revient dans l'app.

### ~~Phase 4 — volet courtier + fenêtre d'édition~~ — **FAITE le 2026-08-31**

La phase qui décidait a décidé : **pas de reflux en colonne unique dans le volet**. Les mesures
de la phase 0 (§G) ne laissaient pas de marge — le canevas ne rentre pas, et le rendre étroit
n'y changeait rien. L'éditeur part donc dans une fenêtre (§5.4). Ce qui a été construit :

- `src/addin/protocole.ts` — **le tunnel**, sans Office ni DOM, donc éprouvable sans Excel :
  `Mandataire` (fenêtre) et `Courtier` (volet), corrélation des appels, délai de garde,
  poignée de main répétée, numéro de version. **17 tests** (`npm run test:addin`).
- `src/addin/pont-fenetre.ts` — la **troisième** implémentation de `window.desktop`. Cinq
  méthodes traversent (`readExcel`, `writeExcel`, `excelFormulas`, `lireApparence`,
  `ecrireApparence`) et un évènement ; le reste est local, parce qu'il n'a jamais eu besoin
  d'Excel — presse-papier (`navigateur.ts`), export d'image, constantes de verrou.
- `src/addin/courtier-volet.ts` — le **cycle de vie** de la fenêtre : ouverture, relais,
  fermeture, et les codes d'erreur d'Office traduits en français.
- `src/addin/fenetre.ts` / `fenetre.html` — la fenêtre. `src/addin/index.ts` / `index.html` —
  le volet, qui choisit à l'exécution entre le mode courtier et le repli de compatibilité.
- `build.mjs` construit **les deux pages ensemble**, chacune avec son bundle haché : les
  reconstruire séparément permettrait au volet et à la fenêtre de parler deux versions.

**Aucune méthode ne lève côté fenêtre.** Un tunnel peut expirer, ce qu'un appel direct à
Office.js ne fait jamais : chaque méthode rend la forme d'échec que le renderer sait déjà lire.

**Vérifié sans Excel** : `tests/fenetre-essai.html` (servi par `npm run serve`) fait tourner le
**vrai** code de la fenêtre dans un iframe, au-dessus d'un faux Office.js réduit à ce qu'une
fenêtre de dialogue offre — la page parente joue le volet et tient le classeur. Constaté :
l'éditeur démarre alors que tout passe par le tunnel, une modification part en **une** écriture
(pas de boucle), une modification « faite dans Excel » revient, et le journal donne **le poids de
chaque message** — l'inconnue que Microsoft ne documente pas. Sur le petit classeur d'essai :
amorçage **1,1 Ko** en 4 allers-retours, puis **~6 Ko par modification** (lecture 718 o +
écriture 810 o + apparence 2,2 Ko, envoyée deux fois). Extrapolé à *Flux légumineuses* (36 Ko de
`.sankey`), une modification pèsera **~70 Ko** d'aller-retour.

**Éprouvé dans Excel pour Mac le 2026-09-01** : `DialogApi 1.2` est présent, la fenêtre s'ouvre
seule, l'aller-retour complet passe sur un classeur de 122 nœuds et 129 liens, et la sonde a
mesuré le tunnel — **4 Mo passent dans les deux sens**, le modèle réel (46,7 Ko) en **1 ms**
(`RESULTATS-ESSAI-MAC.md`). L'extrapolation de ~70 Ko par modification était donc du bon ordre,
et sans conséquence. **Reste** : confirmer tout cela sur un poste Windows (phase 6).

### Phase 5 — diffusion — **le site est en ligne ; reste le centre d'administration M365**

Procédure complète : **`DIFFUSION.md`**. Ce qui reste demande des droits que le dépôt n'a pas —
activer Pages, et téléverser au centre d'administration M365.

**Fait** :

- **Hébergement** : `.github/workflows/complement.yml` publie `dist/addin/` sur **GitHub Pages**
  à chaque poussée sur `main` qui touche le complément. HTTPS, origine unique, aucun certificat
  à installer sur les postes — les trois exigences d'Office. Il vérifie les types et lance
  `npm run test:addin` avant de publier.
- **Manifeste de production engendré**, jamais écrit à la main
  (`scripts/manifeste-prod.mjs`, `npm run addin:manifeste`) : il copie le manifeste de
  développement en changeant **les URL et rien d'autre**, met `<Version>` d'après `package.json`,
  et **refuse de produire** un manifeste incohérent — `http://`, un `localhost` oublié, une URL
  hors de la base, un `AppDomains` qui ne correspond pas, un `dist/addin` incomplet. Dans le
  workflow, la base vient de Pages elle-même : elle ne peut pas être périmée.
- `dist/addin/` est **publiable tel quel** : les icônes du ruban y sont copiées
  (`dist/addin/assets/`), et `npm run addin:serve` les sert depuis le même endroit — le
  développement voit exactement l'arborescence de production.
- **13 tests de manifeste** (`tests/addin-manifeste.test.js`) : bien-formé, une seule origine,
  tout en HTTPS, jeu d'exigences minimal, `AppDomains` cohérent. Trois mutations vérifiées.
  Ils ont trouvé une vraie faute, deux fois : **XML interdit deux tirets consécutifs dans un
  commentaire**, et une ligne de commande à options longues casse le fichier — Excel aurait
  refusé de charger le complément sans dire pourquoi.

**Fait le 2026-09-01** : Pages activé (source = GitHub Actions), workflow passé, site en ligne
sur <https://gaspardlebasic.github.io/sankey-studio/> — les deux pages, les bundles hachés, les
polices, les icônes et le manifeste de production, tout en HTTPS sur une origine unique.

**Reste** : téléverser le manifeste au centre d'administration M365, attribuer, et faire l'essai
sur un poste tiers — la liste de contrôle est dans `DIFFUSION.md`. Ça demande un compte
administrateur : le dépôt ne peut pas le faire.

### Phase 6 — validation Windows — **instrument prêt, mesures à faire**

Le vrai test : c'est le chemin qui n'a jamais tourné. Il ne peut pas se faire ici — il faut un
poste Windows avec l'Excel de la boîte. Ce qui est fait, c'est **l'instrument** ; ce qui reste,
c'est le déplacement. Protocole et grille de relevés : **`RESULTATS-PHASE-6.md`**.

**Fait** — la sonde de la phase 0 porte maintenant les deux questions qui décident :

- **H · le tunnel** (`sonde.js` + `src/addin/sonde-fenetre.html`) : ouvre une vraie fenêtre,
  monte des paliers de 1 Ko à 4 Mo **dans les deux sens**, s'arrête au premier échec, puis
  mesure le **modèle réel du classeur ouvert** et le fait passer. Rend le plafond, les délais,
  et la marge (plafond ÷ modèle). N'utilise **pas** `protocole.ts` : ses délais de garde et ses
  reprises masqueraient ce qu'on cherche à voir.
- **I · les polices** : Source Sans Pro se charge-t-elle, et s'applique-t-elle, dans la webview
  d'Office ? Sans elle, tout le diagramme retombe sur une police système.
- **Chargement de côté sous Windows** (`scripts/install-addin.mjs`) : clé de développement du
  Registre (`HKCU\…\WEF\Developer`), avec le repli « catalogue de confiance » expliqué si une
  stratégie d'entreprise la verrouille. **Jamais exécuté** — c'est le premier point à valider.
- **La sonde a été éprouvée hors d'Excel** : `npm run serve` puis `/sonde-essai.html` sert ses
  vraies pages avec un faux Office.js et un plafond artificiel de 1 Mo. Vérifié que l'échelle
  s'arrête au bon palier dans les **deux** modes d'échec (`messageChild` qui refuse,
  `messageParent` qui part dans le silence), et que `DialogApi 1.2` absent fait refuser la
  mesure au lieu de la fausser.

**Reste** : porter tout ça sur un poste Windows, remplir `RESULTATS-PHASE-6.md`, et juger le
rendu du SVG à l'œil dans le complément lui-même — ça, aucune sonde ne le mesure.

**Total : 2 à 3 semaines**, phase 0 comprise.

---

## 7. Risques

| Risque | Gravité | Parade |
|---|---|---|
| ~~Le volet est trop étroit~~ | — | **Survenu**, mesuré en phase 0 §G. L'éditeur est parti dans une fenêtre séparée (§5.4) |
| ~~**Le poids des messages** du tunnel~~ | — | **Mesuré le 2026-09-01 sur macOS** (`RESULTATS-ESSAI-MAC.md`) : aucun palier n'échoue jusqu'à **4 Mo** dans les deux sens, le modèle réel pèse **46,7 Ko** et passe en **1 ms** — une marge d'au moins **87×**. Ni fragmentation ni envoi de différences. **Reste ouvert sous Windows** |
| **`DialogApi 1.2` absent sous Windows** — jamais vérifié là-bas, et sans `messageChild` le tunnel est à sens unique | moyenne | Sondé à l'exécution, jamais déclaré dans le manifeste ; le repli de compatibilité garde l'éditeur dans le volet. À vérifier en phase 6 **avant** la diffusion |
| **Dérive de version** entre les deux pages — deux caches, deux webviews | faible | Numéro de protocole dans la poignée de main, message de désaccord explicite, et les deux bundles reconstruits ensemble |
| **Hors ligne** : la page vient d'Internet. Contrairement à l'app Electron, un complément peut ne pas charger sans réseau | moyenne | Pas de bonne parade. À assumer et à dire |
| **Excel doit être ouvert** sur le bon classeur — l'inverse exact de la contrainte actuelle | moyenne | La coquille Electron reste, pour le mode autonome |
| **Le volet doit rester ouvert** : Office ferme la fenêtre d'édition avec lui | faible | Dit dans le volet. Fermer la fenêtre ne perd rien d'essentiel — le modèle vit dans le classeur, l'apparence dans `document.settings` ; seuls l'annulation et la sélection repartent à zéro |
| `Ctrl-Z` **ne défait pas** une écriture du complément | faible | Même limite qu'aujourd'hui ; le dire dans l'interface |
| Jeux d'exigences insuffisants sur un poste Windows | moyenne | Sondé en phase 0, avant tout engagement |
| Une mise à jour d'Office change le comportement | faible | Banc d'essai de la phase 0, rejouable |

**Bonus non recherché** : le même complément fonctionnerait dans **Excel sur le web**. Ne pas en
faire un objectif, mais ne pas le casser gratuitement.

---

## 8. Tests

- **`npm test` (`tests/run.js`) reste valable tel quel** : il teste le renderer, qui est partagé.
  Aucune raison de le toucher.
- **Faits** : `tests/addin-office.test.js` (adaptateur) et `tests/addin-synchro.test.js`
  (auto-écho, anti-rebond, branchement des tableaux), sur le **faux Office.js**
  `tests/faux-office.js` — `Excel.run` bouchonné sur un classeur en mémoire, avec le différé
  `load`/`sync` et les évènements. Ne parlent pas à Excel. `npm run test:addin`.
- **Fait** : `tests/addin-protocole.test.js` (17 tests) — le tunnel de la phase 4 sur un canal en
  toc : poignée de main branchée en retard, corrélation de deux appels en vol, délai de garde,
  erreur du pont, désaccord de version, message étranger. Puis `pont-fenetre.ts` lui-même :
  un tunnel qui expire doit rendre un échec, jamais lever.
- **Fait** : `tests/volet-essai.html`, servi par `npm run serve` — le renderer sous les capacités
  du complément (faux pont, classeur en mémoire). C'est là qu'on éprouve l'amorce, la synchro
  automatique et le panneau, sans Excel.
- **Fait** : `tests/fenetre-essai.html` — le couple volet + fenêtre de la phase 4, sans Excel.
  Le vrai code de la fenêtre tourne dans un iframe au-dessus d'un faux Office.js réduit à
  `messageParent` ; la page parente joue le volet. C'est là qu'on lit **le poids des messages**.
- **Fait** : `/sonde-essai.html` (même serveur) — **la sonde elle-même**, hors d'Excel, avec
  `tests/faux-office-sonde.js` et un plafond artificiel. Un instrument faux ferait perdre le
  déplacement sur le poste Windows : il s'éprouve comme le reste.
- **Fait** : `tests/addin-manifeste.test.js` — les manifestes eux-mêmes. Un manifeste invalide
  ne se découvre qu'au pire moment : Excel refuse de charger, sans motif, sur le poste d'un
  autre.
- **Aller-retour réel** : le banc d'essai de la phase 0, dans le volet. C'est le seul moyen — et
  la leçon de `verrou-excel-onedrive` s'applique intégralement : **essayer contre un classeur
  OneDrive réellement ouvert**, jamais seulement contre un fichier local.
- `npm run verifier` reste utile pour les identifiants dupliqués.

---

## 9. Le tunnel entre le volet et la fenêtre

La mécanique de la solution retenue (§5.4), construite en phase 4. Ce n'était **pas** une
réécriture : les phases 1 à 3 sont réutilisées telles quelles.

- Le **volet est un courtier** : il garde Office.js et le classeur, affiche l'état, ouvre la
  fenêtre. Il exécute ce que la fenêtre demande, et lui pousse les changements venus d'Excel.
- La **fenêtre héberge l'éditeur**, à 98 % de l'écran, non modale — l'utilisatrice édite le
  diagramme et clique dans Excel sans rien fermer.
- Ils échangent par `messageParent` / `messageChild` (`DialogApi 1.2`, **sondé à l'exécution** :
  ce jeu ne peut pas être déclaré dans le manifeste).
- La fenêtre doit être sur **exactement le même domaine** que le volet, sous-domaine compris —
  d'où une adresse déduite de celle du volet plutôt que codée en dur.
- `window.open` est proscrit : Dialog API uniquement.
- **Tout transite en chaînes** (JSON sérialisé), et **aucune limite de taille n'est documentée**.
  C'est la question ouverte nº1 (§7) : mesurée à ~6 Ko par modification sur le banc d'essai,
  extrapolée à ~70 Ko sur un vrai classeur.
- Volet et fenêtre sont **deux contextes d'exécution séparés** : recharger l'un perd l'état de
  l'autre, et leurs caches peuvent diverger — d'où le numéro de version du protocole.
- Office n'autorise qu'**une fenêtre à la fois**, et elle se ferme avec le volet.
- Nuance de forme : Microsoft écrit « Don't use a dialog box to interact with a document ».
  On reste formellement dans les clous (la fenêtre ne touche pas au classeur, elle relaie au
  volet), mais on force l'esprit du modèle. Sans conséquence pour un déploiement interne par le
  centre d'administration M365 — il n'y a pas de validation AppSource à passer.

---

## 10. Ce qu'on ne fait pas

- **Pas de Microsoft Graph.** Écarté pour cet essai, mais reste le repli de secours si la phase 0
  échoue — l'inscription Entra ID serait accordée.
- **Pas de pont vers l'app Electron.** Étudié et écarté : même travail Office.js, plus un serveur
  HTTPS local, plus un **certificat approuvé à installer sur chaque poste**, plus un **port codé
  en dur dans le manifeste**, plus deux artefacts à tenir en version. Strictement plus cher que
  le complément autonome, pour un bénéfice qui a fondu depuis qu'on sait le dialogue non modal.
- **Pas de retrait** de `excel.js` / `excel-live.js` / `excel-control.js` dans ce chantier.
- **Pas de manifeste JSON unifié** : XML, plus sûr pour un déploiement interne.

---

## Sources

- [Use the Office dialog API in your Office Add-ins](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/dialog-api-in-office-add-ins)
- [Task panes in Office Add-ins](https://learn.microsoft.com/en-us/office/dev/add-ins/design/task-pane-add-ins)
- [Office.TaskPane interface (`setWidth`)](https://learn.microsoft.com/en-us/javascript/api/office/office.taskpane)
- [Excel JavaScript API requirement sets](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/excel/excel-api-requirement-sets)
- [Work with events using the Excel JavaScript API](https://learn.microsoft.com/en-us/office/dev/add-ins/excel/excel-add-ins-events)
