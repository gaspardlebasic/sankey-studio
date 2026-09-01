# Résultats — phase 0 (sonde complément Excel)

Suit `PLAN-COMPLEMENT-EXCEL.md` §6. Menée le 2026-08-31.

## Verdict : **GO** — aucun critère d'abandon déclenché

Poste d'essai : Excel pour Mac **16.112.821.2**, écran 1512 pt. Classeur réel ouvert depuis
OneDrive/SharePoint (122 nœuds, 129 liens, 2 001 cellules, 18 formules inter-onglets).

| Question | Critère du plan | Mesuré | |
|---|---|---|---|
| A · Jeux d'exigences | ExcelApi ≥ **1.7** | **1.21** | ✅ |
| B · Lecture des tableaux | trouvés par en-têtes | 2 001 cellules en **26 ms** | ✅ |
| C · Écriture chronométrée | **< 5 s** | 2 001 cellules en **12 ms** | ✅ |
| D · Formules préservées | même compte | **18 → 18**, 0 écart sur 2 001 cellules | ✅ |
| E · `Table.onChanged` | l'évènement arrive | `RangeEdited en B118 (Local)` | ✅ |
| F · Stockage | écrire ~2 Ko | **2 048 Ko** acceptés | ✅ |
| F2 · Persistance | survivre à une réouverture | marqueur 2 Ko **retrouvé intact** | ✅ |
| G · Largeur du volet | — | défaut **350 px**, `setWidth` → **755 px** | ⚠️ §G |

**Le chiffre qui change tout : 12 ms contre ~1 350 ms.** La référence JXA était de 1,35 s pour
**500** cellules avec un plancher d'~1 s (démarrage d'`osascript` + évènements Apple). Office.js
fait **2 001** cellules en 12 ms, dans le processus d'Excel. Environ **110× plus rapide**, et sans
plancher.

Conséquences directes sur le plan :

- **La synchro montante automatique redevient évidente** (décision ouverte en phase 3) : à 12 ms,
  écrire à chaque modification ne coûte rien. Et comme écrire ne déclenche aucun enregistrement,
  OneDrive ne téléverse pas.
- La machinerie née du coût de l'écriture — `pushEnCours` qui **reprogramme** l'écriture suivante
  pour ne pas perdre le dernier changement d'une salve — **n'a probablement plus lieu d'être**.

**Seul point d'attention : G, la largeur du canevas.** Voir plus bas — c'est désormais la seule
question ouverte du chantier.

---

## G · Largeur du volet — **mesuré**, et c'est la question qui décide

Mesuré hors Excel : le renderer est une page web ordinaire (`npm run serve`), donc les largeurs
d'un volet se simulent exactement. Projet d'essai : le vrai `Flux légumineuses.sankey`
— **78 nœuds, 81 liens, 7 colonnes**. Mesures prises sur les rectangles réels des éléments
(`getBoundingClientRect`), pas sur `window.innerWidth` (faussé par l'émulation).

Deux constantes du poste, **confirmées dans Excel** : le volet s'ouvre à **350 px**, et
`setWidth(756)` le porte à **755 px** — le plafond de 50 % de la fenêtre est donc bien atteignable
par programme, et il vaut exactement ce que la simulation avait prévu.
(La doc annonce 270 px de défaut sur Mac ; l'observé est 350 px.)

| Largeur du volet | Mode | Canevas visible | Part du diagramme |
|---|---|---|---|
| 270 px (défaut Mac) | Édition | 270 px | **20 %** |
| 756 px (plafond, 50 %) | Édition, panneau en place | 468 px | **34 %** |
| 756 px | Édition, **panneau masqué** (simule le reflux phase 4) | 756 px | **56 %** |
| n'importe laquelle | **Aperçu** | — | **100 %** |

**Ce que ça dit :**

1. Le diagramme en mode **Édition** fait **1 362 px de large** et cette largeur est *fixe* : c'est
   la grille (7 colonnes × largeur de nœud). Elle ne s'adapte pas au conteneur.
2. Le mode **Aperçu**, lui, tient dans son conteneur à toute largeur — **lire** un diagramme dans
   un volet ne pose aucun problème. Seule l'**édition** déborde.
3. Le panneau latéral fait 288 px, soit **38 % du volet à son plafond**. Le reflux de la phase 4
   (panneau en tiroir/onglets) n'est pas un raffinement : sans lui, il reste 468 px de canevas.
4. À 270 px, la **barre d'outils elle-même déborde** : 643 px de contenu dans 270 px.

**Lecture honnête** : même après le reflux de la phase 4, on voit **un peu plus de la moitié**
d'un diagramme réel, avec défilement horizontal. C'est utilisable, mais pour une activité où on
fait glisser des nœuds d'une colonne à l'autre, ne jamais voir plus de 3,5 colonnes sur 7 est un
vrai handicap. **Le repli §9 (fenêtre à part) a de bonnes chances d'être nécessaire** — la
décision reste au terme de la phase 4, une fois le reflux réellement construit.

## F · Poids de l'apparence — **mesuré** (partiellement)

Sur les deux vrais projets, le bloc à persister dans le classeur est **minuscule** :

| Projet | Nœuds | Liens | `options` | Fichier `.sankey` entier |
|---|---|---|---|---|
| Flux légumineuses | 78 | 81 | **1 869 o** | 36 Ko |
| Flux APS | 122 | 129 | **1 791 o** | 54 Ko |

L'essentiel du `.sankey` est le **modèle**, qui dans le complément viendra d'Excel. Ce qu'il faut
stocker (`options` + `idCounter` + `hiddenFilieres` + `colorOverrides`, cf. PLAN §5.2) pèse donc
**~2 Ko**. Aucune limite de `document.settings` ne sera approchée. Reste à confirmer dans Excel
que le chemin d'écriture fonctionne et **survit à une fermeture/réouverture** du classeur.

---

## Détail des relevés

**A · Jeux d'exigences.** `ExcelApi 1.21`, `TaskPaneApi 1.1`, `Settings 1.1`, `DialogApi 1.1`
**et 1.2** — le repli §9 (fenêtre à part avec `messageChild`) est donc techniquement ouvert.
*Faux négatif de la sonde corrigé après coup* : elle interrogeait un jeu `CustomXmlParts 1.1`
qui n'existe pas côté Excel (c'est une API Word). Les parties XML personnalisées d'Excel relèvent
d'`ExcelApi 1.5`, largement satisfait — le repli de stockage existe bien.

**B · Lecture.** 3 tableaux dans le classeur (`Flux!flux_lait`, `Diagramme!Noeuds`,
`Diagramme!Liens`) : la recherche **par en-têtes** a isolé les deux bons et ignoré le troisième.
Nœuds `A2:I123` (122 × 9), Liens `K2:Q130` (129 × 7) — la colonne vide `GAP` est bien là.
`hasLane` et `hasKind` vrais : ce classeur porte déjà « Couloir » et « Type ».

**D · Formules.** 18 formules inter-onglets (`=Lentilles!C68`…), **18 après réécriture**, en
syntaxe US comme attendu. Aucun écart sur les 2 001 cellules comparées une à une.

**E · Évènements.** `RangeEdited en B118 (source : Local)` reçu à la frappe. La source `Local`
permettra de distinguer nos propres écritures — utile pour l'auto-écho de la phase 3.

**F · Stockage.** Tous les paliers passent jusqu'à **2 Mo**, soit **mille fois** le besoin réel
(~2 Ko, cf. plus bas). Aucune contrainte de taille à prévoir.

## Reste à faire

**Toutes les mesures sont faites.** Il ne reste que **G**, qui est une décision et non une
mesure — voir plus bas.

### Note de méthode sur F2

Le premier protocole de persistance était **incapable de répondre** : le test F **supprimait sa
propre clé** en partant, donc chaque passage repartait de zéro et rendait un journal identique
quoi qu'il arrive. Il ne disait pas non plus d'**enregistrer** le classeur, alors que `saveAsync`
ne fait que ranger le réglage dans le classeur *en mémoire* — sans Cmd-S il n'atteint jamais le
fichier.

**F2** corrige les deux : il pose un marqueur horodaté portant l'identifiant de la session du
volet, et n'efface rien. Résultat obtenu — marqueur de 2 048 o retrouvé **intact**, écrit dans
une **autre session d'Excel**, sur un classeur **OneDrive** : le réglage fait donc aussi
l'aller-retour par le fichier dans le cloud.

À retenir pour la suite : ne jamais écrire un test dont le succès et l'échec produisent la même
sortie.

---

## Comment lancer la sonde

**Une seule fois** — installe le certificat de développement. Un complément ne se charge qu'en
HTTPS, y compris depuis `localhost` ; cette commande installe une autorité de confiance dans le
trousseau et **demande ton mot de passe**, c'est donc à toi de la lancer :

```bash
npm run addin:certs
```

*(Besoin de développement seulement : en production le complément sera servi par un hébergeur
statique public, sans aucun certificat sur les postes — PLAN §5.3.)*

**À chaque session :**

```bash
npm run addin:serve
```

Puis, dans un autre terminal ou dans le Finder :

1. **Quitte Excel complètement**, puis rouvre-le (le manifeste est lu au démarrage).
2. Ouvre une **COPIE** de ton classeur — la sonde réécrit les tableaux, et `Ctrl-Z` ne défait pas
   une écriture par complément.
3. **Insertion ▸ Mes compléments ▸ Compléments de développement ▸ « Sankey Studio — sonde »**.
4. Clique **« Tout lancer »** (lecture seule), puis **E** et enfin **C+D2** (écriture, double clic
   de confirmation).
5. Copie-colle le journal ici.

Le manifeste est déjà déposé dans
`~/Library/Containers/com.microsoft.Excel/Data/Documents/wef/sankey-sonde.xml`
(`npm run addin:install` pour le reposer, `npm run addin:install -- --retirer` pour l'enlever).

### Ce que chaque essai répond

| Essai | Question du plan | Critère |
|---|---|---|
| A | Jeux d'exigences | **ExcelApi ≥ 1.7** sinon abandon (pas d'`onChanged`) |
| B | Lecture des deux tableaux, `hasLane`/`hasKind` | tableaux trouvés par en-têtes |
| C | Écriture chronométrée | **> 5 s = abandon** ; référence JXA 1 350 ms |
| D | Formules préservées | même compte avant/après |
| E | `Table.onChanged` | l'évènement arrive |
| F | Stockage | écrit, relu, et survit à une réouverture |

---

## Fichiers de la sonde

- `src/addin/manifest-sonde.xml` — manifeste XML, exigence déclarée volontairement basse
  (`ExcelApi 1.1`) pour pouvoir *sonder* au lieu d'être refusé au chargement.
- `src/addin/sonde.html` / `src/addin/sonde.js` — le banc d'essai (JS simple, aucun bundle).
- `scripts/serve-addin.mjs` — serveur HTTPS local, port 3000, `Cache-Control: no-store`.
- `scripts/install-addin.mjs` — chargement de côté macOS (`--retirer` pour désinstaller).
