# Diffuser le complément Excel — phase 5

Suit `PLAN-COMPLEMENT-EXCEL.md` §5.3 et phase 5. Ce document est la procédure ; le plan reste
la décision.

> **Statut : outillage prêt, rien n'est publié.** Le workflow, le manifeste de production et sa
> vérification existent et sont éprouvés localement. Ce qui reste demande des droits que le
> dépôt n'a pas : activer Pages, et téléverser au centre d'administration M365.

---

## Ce qui part en ligne, et ce qui n'y va jamais

Le site ne contient **que le complément** : deux pages, leurs bundles, les styles, les polices,
les icônes, le manifeste. **Aucune donnée du classeur n'y passe** — le complément parle au
classeur ouvert dans Excel, sur le poste, et rien ne transite par l'hébergeur. C'est ce qui rend
un hébergement public acceptable pour un usage interne.

En contrepartie, une page qui vient d'Internet ne charge pas hors ligne. C'est un risque assumé
et documenté (PLAN §7) : à dire à l'utilisatrice, parce qu'elle le rencontrera un jour dans un
train.

---

## 1. Une fois : activer GitHub Pages

Réglages du dépôt ▸ **Pages** ▸ *Source* = **GitHub Actions**.

Sans ça, le workflow construit correctement et échoue à la dernière étape, en le disant.

## 2. Publier

Le workflow `.github/workflows/complement.yml` s'occupe de tout :

- automatiquement, à chaque poussée sur `main` qui touche `src/addin/`, `src/renderer/`,
  `src/shared/`, `build.mjs` ou `package.json` ;
- à la main, onglet *Actions* ▸ « Publier le complément Excel » ▸ *Run workflow*.

Il vérifie les types, lance `npm run test:addin`, construit `dist/addin/`, et **engendre le
manifeste avec l'adresse réelle du site** — il ne peut donc pas viser une adresse périmée.

Quand il a fini, vérifier à la main que la page répond :

```
https://<compte>.github.io/sankey-studio/index.html
```

Une page blanche avec « Sankey Studio fonctionne dans Excel. » est le bon résultat : hors
d'Excel, le complément n'a rien d'autre à dire.

## 3. Téléverser le manifeste au centre d'administration M365

Le manifeste publié est à `https://<compte>.github.io/sankey-studio/manifest.xml`. On peut aussi
le refaire localement, à l'identique :

```bash
npm run addin:manifeste -- https://<compte>.github.io/sankey-studio
```

Puis, dans <https://admin.microsoft.com> (il faut être administrateur) :

1. **Paramètres ▸ Applications intégrées ▸ Téléverser des applications personnalisées**
2. Type d'application : **Compléments Office** ; source : **fournir le lien du manifeste**
   (ou téléverser le fichier)
3. **Attribuer** : à toi seule d'abord, puis au groupe concerné une fois l'essai fait
4. Valider

La propagation n'est pas immédiate — comptez jusqu'à 24 h, souvent bien moins. Excel doit être
**fermé et rouvert**. Le complément apparaît alors dans *Accueil ▸ Diagramme de flux*.

## 4. Mettre à jour

Deux cas, et la différence compte :

| Ce qui change | Ce qu'il faut faire |
|---|---|
| Le **code** (renderer, pont, styles) | Pousser sur `main`. Le workflow republie ; les bundles sont hachés, Excel prend la nouvelle version au rechargement du volet. Rien à refaire côté administration |
| Le **manifeste** (nom, icônes, bouton de ruban, adresse) | Monter `version` dans `package.json`, pousser, puis **re-téléverser** au centre d'administration. Office ne recharge un manifeste déployé que si `<Version>` a changé — publier sans monter la version, c'est publier pour personne |

**Un délai à connaître** : GitHub Pages sert les pages HTML avec un cache de ~10 minutes. Juste
après une publication, le volet et la fenêtre d'édition peuvent donc être momentanément de deux
versions différentes. Ce cas est prévu : la fenêtre affiche « Le volet et cette fenêtre ne sont
pas de la même version… Ferme cette fenêtre et rouvre-la depuis le volet » (PLAN §9). Attendre
dix minutes et rouvrir suffit.

## 5. Essai sur un poste tiers

À faire avant d'attribuer le complément à qui que ce soit d'autre. Sur une machine qui n'a
jamais servi au développement :

- [ ] Le complément apparaît dans le ruban après redémarrage d'Excel
- [ ] Le volet s'ouvre et nomme le bon classeur
- [ ] La fenêtre d'édition s'ouvre seule ; sinon, le bouton du volet la fait apparaître
- [ ] Le diagramme vient du classeur — ni exemple, ni page vide
- [ ] Une modification dans la fenêtre arrive dans les tableaux Excel
- [ ] Une modification faite **dans Excel** revient dans la fenêtre
- [ ] Fermer la fenêtre puis la rouvrir : le diagramme est intact (il vit dans le classeur)
- [ ] Fermer le volet ferme la fenêtre — c'est le comportement attendu, pas une panne
- [ ] Le diagramme est à la bonne police (Source Sans Pro, pas une police système)
- [ ] Rien d'illisible dans les 34×32 px du coin haut-droit du volet (menu « personnalité »)

Sur un poste **Windows**, ces cases ne suffisent pas : la phase 6 a sa propre campagne de
mesures, avec la sonde — voir `RESULTATS-PHASE-6.md`. **La faire avant d'attribuer largement.**

## 6. Si l'administration refuse, ou traîne

Le chargement de côté reste possible, poste par poste, sans administrateur :

```bash
npm run addin:install          # macOS : conteneur d'Excel · Windows : Registre
```

C'est le mode de développement, pas un mode de diffusion : il suppose le dépôt et un serveur
HTTPS local sur la machine. Utilisable pour une démonstration, pas pour une équipe.

---

## Ce que la phase 5 n'a pas tranché

- **Le nom de domaine.** GitHub Pages est le choix par défaut, parce que le dépôt y est déjà et
  que ça ne coûte rien. Cloudflare Pages ferait aussi bien et permettrait, en plus, de fixer les
  en-têtes de cache — ce que Pages ne permet pas. À reconsidérer seulement si le cache de dix
  minutes devient gênant.
- **La visibilité du dépôt.** `gaspardlebasic/sankey-studio` est **public**, donc Pages
  fonctionne sans rien payer. À savoir si le dépôt passait un jour en privé : GitHub Pages n'est
  alors disponible qu'avec une offre payante (Pro, Team, Enterprise). Le complément ne publie
  aucune donnée, mais le **code** du renderer, lui, est déjà lisible par tous — c'est le cas
  aujourd'hui, indépendamment de cette phase.
