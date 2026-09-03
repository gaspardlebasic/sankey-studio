# Diffuser le complément Excel — phase 5

Suit `PLAN-COMPLEMENT-EXCEL.md` §5.3 et phase 5. Ce document est la procédure ; le plan reste
la décision.

> **Statut : publié le 2026-09-01.** Pages est activé (source = GitHub Actions), le workflow a
> tourné, et le site répond :
> **<https://gaspardlebasic.github.io/sankey-studio/>** — pages, bundles, polices, icônes et
> manifeste (`.../manifest.xml`, `<Version>` 0.1.0.0), tout en HTTPS sur une origine unique.
> **Reste la seule étape qui demande un administrateur : le téléversement au centre
> d'administration M365 (§3), à faire depuis ton compte.**

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

## 1. Une fois : activer GitHub Pages — **fait le 2026-09-01**

Réglages du dépôt ▸ **Pages** ▸ *Source* = **GitHub Actions**.

Sans ça, le workflow construit correctement et échoue à la dernière étape, en le disant.

En ligne de commande, si c'était à refaire sur un autre dépôt :

```bash
gh api -X POST repos/<compte>/<dépôt>/pages -f build_type=workflow
```

## 2. Publier

Le workflow `.github/workflows/complement.yml` s'occupe de tout :

- automatiquement, à chaque poussée sur `main` qui touche `src/addin/`, `src/renderer/`,
  `src/shared/`, `build.mjs` ou `package.json` ;
- à la main, onglet *Actions* ▸ « Publier le complément Excel » ▸ *Run workflow*.

Il vérifie les types, lance `npm run test:addin`, construit `dist/addin/`, et **engendre le
manifeste avec l'adresse réelle du site** — il ne peut donc pas viser une adresse périmée.

Quand il a fini, vérifier à la main que la page répond :

```
https://gaspardlebasic.github.io/sankey-studio/index.html
```

Une page blanche avec « Sankey Studio fonctionne dans Excel. » est le bon résultat : hors
d'Excel, le complément n'a rien d'autre à dire.

## 3. Téléverser le manifeste au centre d'administration M365

Le manifeste publié est à `https://gaspardlebasic.github.io/sankey-studio/manifest.xml`. On peut aussi
le refaire localement, à l'identique :

```bash
npm run addin:manifeste -- https://gaspardlebasic.github.io/sankey-studio
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

**Voir la nouvelle version sur son propre poste** : `npm run excel:cache` vide le cache d'Excel
pour Mac (cache HTTP du conteneur, WebKit, cache des compléments d'Office ; jamais le manifeste
chargé de côté). Quitter puis rouvrir Excel ensuite — un Excel ouvert garde sa page en mémoire.

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

## 6. Sans droits d'administration — **c'est le cas ici**

`gaspard@basic.coop` n'a pas le rôle d'administrateur dans le tenant `basic.coop` : le centre
d'administration refuse la page des applications intégrées. Le §3 est donc hors d'atteinte tant
que l'informatique de la boîte n'ouvre pas le droit, ou ne téléverse pas le manifeste elle-même
(c'est ce qu'il faudra lui demander : le lien du manifeste suffit).

En attendant, le complément s'installe **poste par poste**, sans rien demander à personne :

```bash
npm run addin:manifeste -- https://gaspardlebasic.github.io/sankey-studio
npm run addin:install -- --enligne
```

Puis quitter Excel **complètement** et le rouvrir. `--enligne` pose le manifeste de
**production** — celui qui vise le site publié — au lieu de celui de développement. Sur ce
poste-là, il n'y a donc **ni serveur local, ni certificat, ni dépôt** : la page vient de
l'hébergeur, exactement comme si elle avait été déployée par l'administration. Le script refuse
d'installer un manifeste qui viserait encore `localhost` — sans ce garde-fou, l'installation
« sans serveur » donnerait une page blanche qu'Excel n'expliquerait pas.

Ce que ce mode ne donne pas, par rapport à un déploiement M365 :

- il faut le faire **sur chaque poste**, et le refaire si le manifeste change (pas si le code
  change : les bundles sont hachés, le volet reprend la nouvelle version au rechargement) ;
- il faut Node et le dépôt **au moment de l'installation** — mais plus après ;
- rien n'est centralisé : personne ne peut retirer le complément à distance.

Pour l'enlever : `npm run addin:install -- --retirer`.

Le mode **développement** (`npm run addin:install` sans `--enligne`) reste ce qu'il était : il
vise `https://localhost:3000` et suppose `npm run addin:serve` en marche.

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
