# Plan — niveaux d'agrégation et diagramme interactif

Afficher d'abord un diagramme **agrégé**, puis **déplier** à la demande les nœuds pour
lesquels un détail existe (« Légumineuses » → Pois, Féverole, Lentille). Le dépliage se fait
dans l'aperçu du complément **et** dans un export HTML interactif, lisible hors d'Excel.

Décisions prises le 2026-10-14 :

1. Le **⊕ est porté par un nœud** — produit comme industrie. Un produit de largeur 0 n'a
   pas de boîte visible : son ⊕ tombe au milieu du ruban, il se lit comme un « + sur le flux ».
2. **On n'exige pas que tout soit saisi au niveau le plus fin** : un flux peut être connu au
   niveau agrégé seulement (cf. « Le non détaillé »).
3. Il faudra un **export HTML interactif**.
4. **Cas A seulement** : un parent s'éclate en enfants **dans sa propre colonne et son
   propre couloir**. Ouvrir une boîte noire sur plusieurs colonnes (cas B) est hors champ.

## Le modèle : une hiérarchie de nœuds

Un nœud peut avoir un **parent**. Replié, le parent se dessine à sa place et ses enfants
disparaissent : les flux qui les touchent se reportent sur lui. Déplié, le parent cède sa
place à ses enfants, empilés dans la même cellule (colonne × couloir).

- **Profondeur libre** (un parent peut avoir un parent) ; 2 ou 3 niveaux en pratique.
- Un enfant appartient à la **même filière** que son parent.
- **Colonne et couloir d'un enfant suivent ceux de son parent** (cas A). Le complément les
  réaligne à la relecture ; un écart saisi à la main est corrigé et signalé.
- L'**ordre vertical d'un enfant se lit entre frères et sœurs** : déplier remplace le parent
  par ses enfants, dans leur ordre, sans les mêler aux voisins du parent.
- Un enfant sans couleur propre **prend celle de son parent** (à l'affichage).
- Un parent inconnu, d'une autre filière, ou qui ferait une boucle (A parent de B parent
  de A) est **ignoré** : le nœud est traité comme une racine, et le panneau le signale.

## Format Excel

Deux colonnes **en fin** du tableau Noeuds, sur le modèle « Origine » / « ID origine » :

| … | ID | Couloir | Type | **Parent** | **ID parent** |
|---|---|---|---|---|---|
| | N2 | 1 | Produit | | |
| | N3 | 1 | Produit | Légumineuses | N2 |

- Un classeur sans elles s'affiche exactement comme avant. Elles sont **ajoutées d'office**
  comme les autres colonnes manquantes ; la plupart des classeurs n'ayant qu'une colonne vide
  entre les deux tableaux, l'ajout **insère des colonnes vides** pour écarter le tableau des
  liens (accord de l'utilisatrice, 2026-10-15). ONLYOFFICE les lit sans les ajouter.
- **« Parent » se saisit à la main** (un nom) ; le complément remplit « ID parent ». La
  résolution suit celle des liens : l'ID d'abord, sinon le nom **dans la même filière**.
- Sans la colonne « Parent », la relecture **garde** la hiérarchie connue de l'app
  (`hasParent`, comme `hasLane` / `hasKind`).
- **Rangement** : les nœuds descendent en **plan** — chaque enfant juste sous son parent, les
  frères et sœurs par ordre vertical. Le tri reste dans `buildModelRows` et nulle part ailleurs.
- **Le tableau Liens ne change pas.** Un lien peut viser un nœud de n'importe quel niveau.

## Le non détaillé : un flux agrégé est un total

Un lien est **couvert** par un autre quand son origine est égale à celle de l'autre ou en
descend, et sa destination aussi. Le lien couvert **fait partie** du lien qui le couvre : il
ne s'y ajoute pas.

| Saisi dans Liens | Replié | Déplié |
|---|---|---|
| Exploitations → Légumineuses 100 · → Pois 40 · → Féverole 25 | Légumineuses **100** | Pois 40 · Féverole 25 · **(non détaillé) 35** |
| → Pois 40 · → Féverole 25 seulement | Légumineuses **65** | Pois 40 · Féverole 25 |
| → Légumineuses 100 seulement | Légumineuses **100** | **(non détaillé) 100** |

- Le reste va à un nœud virtuel **« (non détaillé) »**, enfant du parent déplié : grisé ou en
  mosaïque, jamais écrit dans Excel.
- Si le détail **dépasse** le total, c'est une **incohérence** : on dessine le détail, et le
  panneau la signale. On ne corrige jamais les données en silence.
- Le calcul est une **fonction pure** — projeter les liens sur un état de dépliage —, dans
  `src/shared/agregation.js`, éprouvée en Node (`tests/agregation.test.js`).

## Interaction (aperçu et export HTML)

- **⊕** sur tout nœud replié qui a des enfants ; une fois déplié, un **cadre léger** entoure
  ses enfants, avec le nom du parent et un **⊖**.
- **Transition animée** : le ruban se scinde en rubans parallèles, les voisins s'écartent.
- Barre d'outils : **Tout replier · Niveau 1 / 2 / 3 · Tout déplier**.
- **Vue de présentation** : l'état de dépliage d'ouverture, rangé dans l'apparence
  (`document.settings`), pas dans Excel. Les exports PNG/SVG reprennent l'état affiché.

## Édition

La vue d'édition montre **ce qui est déplié**, comme l'aperçu : on place ce qu'on voit.

- **Regrouper** (Ctrl+G) : des nœuds de la même filière, colonne et couloir ; crée le parent
  et demande son nom. Sinon, refus clair. **Dégrouper** (Ctrl+Maj+G).
- Glisser un enfant hors de la cellule de son groupe le **détache**.
- Panneau d'un **enfant** : « Regroupé dans » (liste des parents possibles, ou aucun).
- Panneau d'un **parent** : ses enfants (ordre par glisser), ＋ Ajouter un sous-nœud, le
  **bilan** entrées / sorties, la part non détaillée et les incohérences ; Déplier, Dégrouper.
- Tirer un lien vers un parent replié crée un flux **non détaillé** ; le bandeau le dit.

## Export HTML interactif

Un **fichier autonome**, lisible hors ligne et envoyable par mail : données, moteur de rendu,
apparence et **polices embarquées**. Lecture seule : ⊕ / ⊖, niveaux, valeur au survol.
S'ouvre sur la vue de présentation.

## Étapes

1. **Modèle et classeur** — colonnes Parent / ID parent (lecture, écriture, rangement en
   plan, réalignement colonne / couloir), `FlowNode.parent`, réconciliation ; fonction de
   projection et ses tests. *Aucun changement visible tant qu'on ne déplie rien : tout est
   affiché déplié, comme aujourd'hui.*
2. **Aperçu interactif** — ⊕ / ⊖, niveaux, animation, nœud « (non détaillé) ».
3. **Édition** — Regrouper / Dégrouper, panneaux, glisser pour rattacher ou détacher, vue de
   présentation, ajout des colonnes Parent au premier regroupement.
4. **Export HTML interactif.**

Question ouverte (étape 2) : peut-on **masquer** le « (non détaillé) » dans la vue de
présentation, au prix d'un parent déplié plus mince que replié ?

## Avancement

- [x] Étape 1 — modèle et classeur (2026-10-15). Reste connu : un nom de parent
  introuvable est signalé, mais la réécriture suivante vide la case « Parent » — à
  conserver tel quel quand l'étape 3 donnera un vrai panneau pour le corriger.
- [x] Étape 2 — aperçu interactif (2026-10-15). Le « (non détaillé) » reste toujours
  affiché (question ouverte non tranchée) ; l'aperçu s'ouvre tout replié.
- [x] Étape 3 — édition (2026-10-15). Écarts au plan : pas de sélection multiple (Ctrl+G
  groupe le nœud sélectionné, « Regroupé dans » range les autres) ; la vue d'édition montre
  tout en plan, avec des accolades, au lieu de suivre le dépliage de l'aperçu ; « Dégrouper »
  garde le parent et ses flux.
- [x] Étape 4 — export HTML (2026-10-15). Bouton « HTML » de la barre d'outils ; la page
  porte les filières affichées et s'ouvre sur la vue de présentation.
