# Résultats — phase 6 (validation Windows)

Suit `PLAN-COMPLEMENT-EXCEL.md` §6. **À remplir sur un poste Windows de la boîte** :
c'est le seul chemin du chantier qui n'a jamais tourné. Tout le reste — phases 0 à 4 — a été
mesuré sur Mac (`RESULTATS-PHASE-0.md`).

> **Statut : instrument prêt, mesures non faites.** La sonde porte les deux questions qui
> décident ; personne ne les a encore posées à un Excel pour **Windows**.
>
> Elles ont en revanche été posées à un Excel pour **Mac**, le 2026-09-01
> (`RESULTATS-ESSAI-MAC.md`) — d'où des **valeurs de comparaison** pour qui mènera la campagne :
> `DialogApi 1.2` présent, aucun palier du tunnel en échec jusqu'à **4 Mo** dans les deux sens,
> modèle réel de **46,7 Ko** passant en **1 ms**, écriture de **2 001 cellules en 15 ms**,
> **18 formules** préservées. Un écart franc avec ces chiffres sous Windows est en soi une
> information : c'est la plateforme qui diffère, pas le code.

---

## Ce que cette phase décide

| # | Question | Critère | Si non |
|---|---|---|---|
| **H** | `DialogApi 1.2` est-il présent ? | oui | Pas de `messageChild`, donc pas de tunnel : **l'éditeur reste dans le volet** sur ce poste (repli de compatibilité, déjà en place). À dire à l'utilisatrice avant qu'elle ne le découvre |
| **H** | Quel poids passe dans le tunnel ? | plafond ≥ **10 ×** le modèle, aller-retour < **200 ms** | Fragmenter les messages, ou n'envoyer que des différences (PLAN §7). C'est du travail non chiffré : le savoir avant la diffusion, pas après |
| A | Jeux d'exigences | `ExcelApi ≥ 1.7` | Pas de synchro évènementielle : mode manuel, boutons du panneau |
| C | Écriture chronométrée | < 5 s | Critère d'abandon du plan (rappel : 12 ms sur Mac) |
| D | Formules préservées | même compte | Critère d'abandon |
| I | Polices du diagramme | Source Sans Pro charge et s'applique | Le diagramme retombe sur une police système — laid, mais pas bloquant |
| — | Rendu du SVG | fluide sur un diagramme réel | À juger à l'œil, dans le complément lui-même |

---

## Préparation du poste Windows

Node 22+, Git, Excel de la boîte, et le dépôt cloné.

```bat
npm install
npm run addin:certs
npm run build
npm run addin:install -- --sonde
```

`addin:install` inscrit le chemin du manifeste sous
`HKCU\Software\Microsoft\Office\16.0\WEF\Developer`. **Ce chemin Windows n'a jamais été
exécuté** — si le complément n'apparaît pas dans *Insertion ▸ Mes compléments ▸ Compléments de
développement*, le script imprime le repli documenté par Microsoft (dossier partagé déclaré comme
catalogue de confiance). Noter lequel des deux a marché : la phase 5 en dépend.

Puis, dans un terminal à laisser tourner :

```bat
npm run addin:serve
```

Enfin : quitter Excel **complètement**, le rouvrir, ouvrir une **copie** du classeur réel
(la sonde réécrit les tableaux), et lancer la sonde.

---

## Protocole

1. **« Tout lancer »** — enchaîne A, B, D1, F, G et I sans rien écrire.
2. **« C+D2 · Aller-retour neutre »** — double clic volontaire, sur une copie. Chronomètre
   l'écriture et recompte les formules.
3. **« E · Écouter les modifications »**, puis taper dans une cellule d'un des deux tableaux.
4. **« H · Le tunnel volet ↔ fenêtre »** — ouvre une fenêtre, monte les paliers dans les deux
   sens, puis mesure le modèle réel de ce classeur. **C'est la mesure de la phase.** Un palier
   qui échoue arrête l'échelle : c'est le plafond, il est normal de le voir échouer.
5. **« Refermer la fenêtre de mesure »**, puis noter les chiffres ci-dessous.
6. Retirer la sonde, installer le complément (`npm run addin:install`), et **l'utiliser
   vraiment** dix minutes sur un diagramme réel : c'est là qu'on voit le rendu du SVG, les
   polices en situation, et si la fenêtre d'édition se comporte bien à côté d'Excel.

---

## Relevés

Poste : *(modèle, version de Windows)*
Excel : *(Fichier ▸ Compte ▸ À propos — version et canal)*
Classeur : *(nom, nombre de nœuds et de liens)*

| Question | Mesuré | |
|---|---|---|
| A · `ExcelApi` maximal | | |
| A · `TaskPaneApi 1.1` | | |
| A · `Settings 1.1` | | |
| A · **`DialogApi 1.2`** | | |
| B · Lecture | | |
| C · Écriture | | |
| D · Formules | | |
| E · `Table.onChanged` | | |
| F · Stockage | | |
| G · Largeur du volet (défaut / plafond) | | |
| **H · Plafond montant** (fenêtre → volet) | | |
| **H · Plafond descendant** (volet → fenêtre) | | |
| **H · Poids du modèle réel** | | |
| **H · Aller-retour du modèle réel** | | |
| H · Marge (plafond ÷ modèle) | | |
| I · Polices | | |
| — · Rendu du SVG, à l'œil | | |

## Ce qu'on en fait

- **Tout passe** → phase 5 (diffusion) sans réserve.
- **`DialogApi 1.2` absent** → la fenêtre d'édition n'existe pas sur ces postes. Le complément
  fonctionne quand même, à l'étroit. Décider avec l'utilisatrice si ça vaut le coup d'être
  diffusé en l'état.
- **Plafond trop bas ou aller-retour trop lent** → ne pas diffuser tel quel. Deux parades, par
  ordre de coût : n'envoyer que les différences plutôt que le modèle entier, ou fragmenter les
  messages. Les deux se logent dans `src/addin/protocole.ts` sans toucher au renderer.

---

## Note de méthode

La sonde a été **éprouvée hors d'Excel** avant de partir :

```bash
npm run serve   # puis http://localhost:8811/sonde-essai.html
```

Ce banc sert les **vraies** pages de la sonde en remplaçant seulement Office.js par un faux
(`tests/faux-office-sonde.js`), avec un plafond artificiel de 1 Mo. Vérifié ainsi : l'échelle
s'arrête au bon palier dans les **deux** modes d'échec — `messageChild` qui refuse (le volet le
voit tout de suite) et `messageParent` qui part dans le silence (le volet attend le délai de
garde) — le poids du modèle est bien mesuré, et l'absence de `DialogApi 1.2` fait refuser la
mesure au lieu de la fausser.

Ce que ce banc ne prouve pas, et qui est tout l'objet de la phase : **les limites réelles
d'Office**. Le faux plafond de 1 Mo est une invention ; le vrai est ce qu'on vient chercher.
