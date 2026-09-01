# Résultats — premier essai du complément dans Excel (macOS)

Mené le **2026-09-01**. Suit `PLAN-COMPLEMENT-EXCEL.md`. La phase 0 avait éprouvé la **sonde**
dans Excel (`RESULTATS-PHASE-0.md`) ; c'est ici le **complément lui-même** — volet courtier,
fenêtre d'édition, tunnel, synchro — qui tourne pour la première fois dans Excel.

## Verdict : **il fonctionne**, et l'essai a trouvé un défaut que rien d'autre ne pouvait trouver

Poste : Excel pour Mac 16.01, `fr-FR`, écran 1512 pt. Classeur : une **copie** de
`Flux APS test.xlsx` — **122 nœuds, 129 liens, 18 formules** inter-onglets dans « Valeur du flux »,
et **un tableau étranger** (`Flux!flux_lait`, 34 lignes). Chargement de côté
(`npm run addin:install` + `npm run addin:serve`), pas de diffusion.

| Point | Résultat | |
|---|---|---|
| Chargement du manifeste (dossier `wef`) | bouton **Accueil ▸ Sankey Studio ▸ Diagramme de flux** | ✅ |
| Volet | s'ouvre, nomme le bon classeur | ✅ |
| `DialogApi 1.2` | présent : la **fenêtre d'édition s'ouvre seule** | ✅ |
| Tunnel volet ↔ fenêtre | l'éditeur démarre et lit le classeur à travers lui | ✅ |
| Ressources servies | **aucun 404** — pages, bundles, styles, icônes du ruban | ✅ |
| Polices (question I) | Source Sans Pro chargée **dans les deux pages** | ✅ |
| Amorce | le diagramme vient du classeur — ni exemple, ni page vide | ✅ |
| Lecture | 122 nœuds, **129 liens** *(après correctif ; 32 avant)* | ⚠️ voir plus bas |
| Synchro montante | un nœud déplacé → **une seule ligne changée** dans le classeur | ✅ |
| Formules (critère D) | **18 → 18**, colonne « Valeur du flux » identique cellule à cellule | ✅ |
| Tableau étranger | `flux_lait` **intact** après écriture | ✅ |
| Synchro descendante | cellule modifiée dans Excel → « Importé depuis Excel » en ~3 s | ✅ |
| Coin haut-droit du volet | le menu « personnalité » ne recouvre rien de cliquable | ✅ |

Le volet reste **étroit** : c'est voulu depuis la phase 4. `elargirVolet()` n'est appelé que dans
le repli sans fenêtre d'édition — en mode courtier le volet n'a rien à montrer de large.

---

## Le défaut : 32 liens lus au lieu de 129

`trouverTableaux()` cherchait le tableau des liens **dans tout le classeur** et retenait le
premier portant un en-tête « Origine ». Le classeur d'essai en a un autre — `flux_lait`, sur la
feuille *Flux*, avec ses propres colonnes « Origine » et « Destination » — et il vient **avant**
ceux du diagramme. Le complément a donc lu les liens du mauvais tableau.

Le paramètre `nomFeuille`, accepté par les **quatre** fonctions publiques de l'adaptateur,
n'était jamais transmis au repérage : il ne servait à rien.

**Ce n'était pas qu'une lecture fausse.** Le test de non-régression le montre : à la première
écriture, le complément aurait **remplacé le contenu de `flux_lait`** par les liens du diagramme.
Rien n'a été écrit pendant l'essai (vérifié dans le classeur en mémoire), et il tournait de toute
façon sur une copie — mais c'est exactement la panne qu'on ne veut pas découvrir chez
l'utilisatrice.

**Correctif** (`src/addin/excel-office.ts`) : les deux tableaux doivent venir de la **même
feuille**, et c'est d'abord la feuille demandée (« Diagramme »). À défaut, une feuille qui porte
**les deux** — jamais deux moitiés cueillies sur deux feuilles. C'est la règle qu'appliquait déjà
`src/main/excel.js`, qui ne lit que les tableaux d'une seule feuille ; l'adaptateur ne l'avait
pas reprise.

**Pourquoi les tests ne l'avaient pas vu** : le faux classeur de `tests/addin-synchro.test.js`
portait bien un troisième tableau, mais inoffensif — en-têtes `Mois` / `Volume`, sur la même
feuille. Il imitait la forme du piège sans en avoir le fond. Il porte désormais un vrai
`Flux!flux_lait` avec sa colonne « Origine », et `tests/addin-office.test.js` a **4 tests de
repérage** — éprouvés par mutation : **0/4** sur l'ancien code, dont l'écrasement de `flux_lait`.

> **La leçon, pour les fixtures à venir** : un faux classeur doit imiter ce qui *piège*, pas ce
> qui *décore*. Un intrus sans colonne « Origine » et sans feuille à lui ne prouvait rien.

---

## Ce que cet essai ne dit pas

- **Le poids des messages du tunnel** (`PLAN` §7, question ouverte nº 1) : la sonde le mesure
  (`npm run addin:install -- --sonde`, essai H), ça n'a pas été fait ici. Le complément a
  fonctionné avec un modèle réel, ce qui est déjà un signal — mais pas un plafond.
- **Windows** : rien n'a changé, la campagne de `RESULTATS-PHASE-6.md` reste entière.
- **Un classeur ouvert depuis OneDrive/SharePoint** : l'essai portait sur une copie locale du
  Bureau. La phase 0 avait, elle, sondé le classeur SharePoint ouvert.

## Refaire cet essai

```bash
npm run addin:certs      # une seule fois : certificat HTTPS de développement
npm run build
npm run addin:install    # dépose le manifeste dans le conteneur d'Excel
npm run addin:serve      # à laisser tourner ; journalise chaque requête d'Office
```

Puis quitter Excel **complètement**, le rouvrir sur une **copie** d'un classeur réel, et cliquer
*Accueil ▸ Diagramme de flux*. Le journal du serveur est l'instrument : il montre ce que la
webview d'Office demande vraiment, et un 404 y est visible alors qu'il ne l'est nulle part
ailleurs.

Après une reconstruction, **fermer et rouvrir le volet** : le bundle change de nom, la webview
ne le reprend qu'au rechargement de la page.
