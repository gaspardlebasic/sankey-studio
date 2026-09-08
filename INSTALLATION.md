# Installer le complément Sankey Studio

Trois chemins, selon ce qu'on cherche. Les trois servent **le même complément** ; ils ne
diffèrent que par l'endroit d'où vient la page et par qui pose le manifeste.

| | Pour qui | Ce qu'il faut sur le poste | Ce que ça donne |
|---|---|---|---|
| **[A. Mode développement](#a--mode-développement)** | qui modifie le code | Node, le dépôt, un serveur HTTPS local, un certificat | le complément servi depuis `https://localhost:3000`, rechargé à chaque `npm run build` |
| **[B. Console d'administration Microsoft 365](#b--console-dadministration-microsoft-365)** | tout le monde, d'un coup | **rien** | le complément apparaît seul dans le ruban, sur tous les postes attribués |
| **[C. Servi depuis GitHub, poste par poste](#c--servi-depuis-github-sans-passer-par-microsoft-365)** | qui n'a pas les droits M365 | **rien** — ni Node, ni dépôt, ni serveur, ni certificat | le complément vient du site publié ; il faut le déclarer une fois sur chaque poste |

> **C'est le §C qui est en usage aujourd'hui**, faute de droits d'administration dans le tenant
> `basic.coop`. Il donne exactement le même complément que le §B — la même page, sur le même
> hébergeur ; seule la façon de le déclarer à Excel change.

Dans tous les cas, il n'y a **aucun logiciel à installer** : un complément Office est un
manifeste XML qui désigne deux pages web. Rien du classeur ne quitte le poste — le complément
parle à Excel, pas à l'hébergeur.

---

## A — Mode développement

Le complément est servi depuis `https://localhost:3000` par un serveur du dépôt, et le manifeste
`src/addin/manifest.xml` (celui qui vise `localhost`) est chargé « de côté » dans Excel.

### Prérequis, sur les deux systèmes

- **Node 22+** et **npm**
- **Excel de bureau** — Microsoft 365, lancé au moins une fois
- le dépôt cloné, et `npm install` fait une fois

Excel **en ligne** et Excel **web** ne conviennent pas : le chargement de côté décrit ici
s'adresse à Excel de bureau.

### 1. Une seule fois : le certificat HTTPS

```bash
npm run addin:certs
```

Office refuse de charger un complément qui n'est pas en HTTPS, **y compris depuis
`localhost`**. `office-addin-dev-certs` engendre un certificat et installe une autorité de
confiance dans le trousseau (macOS) ou le magasin de certificats (Windows) : la commande demande
le mot de passe de session. Elle n'a besoin d'être passée qu'une fois par poste.

### 2. Construire et servir

```bash
npm run build
```

```bash
npm run addin:serve
```

Le second est à **laisser tourner** tant que le volet est ouvert dans Excel : il sert
`dist/addin` en HTTPS sur le port 3000, et journalise chaque requête — c'est le seul endroit où
l'on voit ce que la webview d'Office demande vraiment.

Si le port 3000 est déjà pris : `SANKEY_PORT=3100 npm run addin:serve`. Mais le manifeste code
l'adresse en dur, donc ce port de repli ne sert qu'à *essayer* le serveur, pas à faire marcher
le complément dans Excel.

### 3. Charger le manifeste de côté

```bash
npm run addin:install
```

La même commande sur les deux systèmes, **deux mécanismes différents** — Office n'en offre pas
un seul :

- **macOS** — le manifeste est **copié** dans le conteneur d'Excel :
  `~/Library/Containers/com.microsoft.Excel/Data/Documents/wef/sankey-studio.xml`.
  C'est une copie : après toute modification de `src/addin/manifest.xml`, **relancer la
  commande**.
- **Windows** — le **chemin** du manifeste est inscrit dans le Registre, sous
  `HKCU\Software\Microsoft\Office\16.0\WEF\Developer`, sous le nom de valeur `sankey-studio.xml`.
  C'est un chemin, pas une copie : Office relit le fichier du dépôt à chaque démarrage d'Excel,
  et une modification du manifeste est prise au redémarrage — mais **le dépôt doit rester en
  place**.

Rien de tout cela n'est à l'échelle du système, rien ne demande de droits d'administration, et
rien ne survit à un retrait.

### 4. Ouvrir le complément

1. Quitter Excel **complètement** (macOS : ⌘Q — fermer la fenêtre ne suffit pas)
2. Rouvrir Excel, ouvrir le classeur
3. **Accueil ▸ Diagramme de flux**

Le bouton n'est pas là ? *Insertion ▸ Mes compléments ▸ **Compléments de développement*** ▸
« Sankey Studio ».

Sur un classeur qui n'a pas encore les tableaux `Noeuds` et `Liens`, le volet propose
**« Préparer le classeur »**.

### 5. Le cycle de travail ensuite

| Ce qui change | Ce qu'il faut faire |
|---|---|
| le code du renderer, du volet, les styles | `npm run build`, puis fermer et rouvrir le volet |
| `src/addin/manifest.xml` | macOS : `npm run addin:install` puis redémarrer Excel · Windows : redémarrer Excel |
| rien ne bouge malgré tout | vider le cache d'Excel — voir [Dépannage](#dépannage) |

### 6. Retirer

```bash
npm run addin:install -- --retirer
```

Retire le complément **et** la sonde, sur les deux systèmes. Redémarrer Excel pour qu'il
disparaisse du ruban.

### Le cas particulier de Windows : si le Registre est verrouillé

Une stratégie d'entreprise peut interdire l'écriture sous `WEF\Developer`, ou faire ignorer la
clé. Le script le dit et imprime le repli documenté par Microsoft — le **catalogue de
confiance**, un dossier *partagé* déclaré dans Excel :

1. Partager le dossier qui contient le manifeste (clic droit ▸ Propriétés ▸ Partage) et noter son
   chemin réseau, de la forme `\\<poste>\<partage>`
2. Excel ▸ **Fichier ▸ Options ▸ Centre de gestion de la confidentialité ▸ Paramètres du
   Centre… ▸ Catalogues de compléments approuvés**
3. Coller le chemin réseau, **Ajouter le catalogue**, cocher **« Afficher dans le menu »**
4. OK, puis redémarrer Excel complètement
5. **Insertion ▸ Mes compléments ▸ DOSSIER PARTAGÉ ▸ « Sankey Studio »**

Un chemin **UNC** est exigé : un dossier local (`C:\…`) n'est pas accepté comme catalogue.

> **État de ce chemin.** Le **mécanisme** Windows est prouvé : une clé `WEF\Developer` pointant
> sur un manifeste a bien fait apparaître le complément dans Excel 365 (ARM64, Windows 11,
> 2026-09-01). Mais le script `addin:install` lui-même n'y a pas encore tourné — l'inscription
> avait été faite à la main. Ce qui reste non éprouvé est mince (l'appel à `reg`), mais il reste.

---

## B — Console d'administration Microsoft 365

C'est le déploiement propre : l'administrateur téléverse le manifeste une fois, l'attribue à des
personnes ou à des groupes, et le complément apparaît sur leurs postes **sans que personne
n'installe quoi que ce soit**. Ni Node, ni dépôt, ni certificat, ni serveur.

### Prérequis

- le complément **publié** en HTTPS sur une origine unique — aujourd'hui GitHub Pages :
  <https://gaspardlebasic.github.io/sankey-studio/> (voir [DIFFUSION.md](DIFFUSION.md) pour la
  publication elle-même)
- le rôle d'**administrateur général** ou **administrateur d'applications Azure AD** dans le
  tenant Microsoft 365

> **À savoir avant de commencer.** `gaspard@basic.coop` n'a pas ce rôle dans le tenant
> `basic.coop` : le centre d'administration refuse la page des applications intégrées. **Cette
> section n'a donc jamais été exécutée.** Elle est à passer à l'informatique de la boîte — le
> lien du manifeste lui suffit — ou à faire une fois le droit ouvert. En attendant, c'est le
> [§C](#c--servi-depuis-github-sans-passer-par-microsoft-365) qui s'applique.

### 1. Le manifeste

Il est publié à côté du complément :

```
https://gaspardlebasic.github.io/sankey-studio/manifest.xml
```

On peut le refabriquer localement, à l'identique — c'est utile pour le téléverser en tant que
fichier, ou pour viser un autre hébergeur :

```bash
npm run addin:manifeste -- https://gaspardlebasic.github.io/sankey-studio
```

Le script part de `src/addin/manifest.xml`, remplace **les URL et rien d'autre**, dérive
`<Version>` de `package.json`, et **refuse** de produire un manifeste bancal : base en `http://`,
`localhost` oublié, URL hors de la base, `dist/addin` incomplet. Le résultat est dans
`dist/addin/manifest.xml`.

### 2. Téléverser

Dans <https://admin.microsoft.com> :

1. **Paramètres ▸ Applications intégrées ▸ Téléverser des applications personnalisées**
2. Type d'application : **Compléments Office**
3. Source : **fournir le lien du manifeste** (l'URL ci-dessus) — ou téléverser le fichier
4. **Attribuer** : à soi seule d'abord, le temps d'un essai ; au groupe concerné ensuite
5. Vérifier les autorisations demandées, puis valider

### 3. Attendre, puis vérifier

La propagation n'est pas immédiate : **jusqu'à 24 h**, souvent bien moins. Excel doit être
**fermé et rouvert** sur le poste. Le complément apparaît ensuite dans **Accueil ▸ Diagramme de
flux**.

Avant d'attribuer largement, dérouler la liste d'essai de
[DIFFUSION.md §5](DIFFUSION.md) sur un poste qui n'a jamais servi au développement — et, sur
Windows, la campagne de `RESULTATS-PHASE-6.md`.

### 4. Mettre à jour

Deux cas, et la différence est celle qui coûte le plus cher quand on l'ignore :

| Ce qui change | Ce qu'il faut faire |
|---|---|
| le **code** (renderer, volet, styles) | pousser sur `main`. Le workflow republie ; les bundles sont hachés, Excel prend la nouvelle version au rechargement du volet. **Rien à refaire côté administration** |
| le **manifeste** (nom, icônes, bouton de ruban, adresse) | monter `version` dans `package.json`, publier, puis **re-téléverser** au centre d'administration |

**Office ne recharge un complément déployé que si `<Version>` a changé.** Publier une correction
de manifeste sans monter la version, c'est publier pour personne.

### 5. Retirer

Centre d'administration ▸ **Applications intégrées** ▸ le complément ▸ **Supprimer**. C'est le
seul des trois modes où l'on peut retirer le complément **à distance** — un chargement de côté,
lui, se retire poste par poste.

---

## C — Servi depuis GitHub, sans passer par Microsoft 365

Le complément est **déjà publié** — pages, bundles, polices, icônes et manifeste, en HTTPS sur
une origine unique :

```
https://gaspardlebasic.github.io/sankey-studio/
https://gaspardlebasic.github.io/sankey-studio/manifest.xml
```

Il ne manque qu'une chose : **dire à Excel que ce manifeste existe**. C'est tout ce que fait la
console d'administration du §B, et c'est ce qu'on fait ici à la main, poste par poste, sans rien
demander à personne. La page venant de l'hébergeur, il n'y a sur le poste **ni serveur local, ni
certificat, ni dépôt**.

Deux variantes, selon ce qu'il y a sur la machine.

### C.1 — Avec le dépôt : le script s’en charge

Sur un poste qui a déjà Node et le dépôt (une machine de développement, ou la sienne) :

```bash
npm install
npm run addin:manifeste -- https://gaspardlebasic.github.io/sankey-studio
npm run addin:install -- --enligne
```

`--enligne` pose le manifeste de **production** au lieu de celui de développement, au même
endroit et sous le même nom : le second **remplace** le premier au lieu de cohabiter avec lui
(même `<Id>` : deux manifestes de même identité donneraient un doublon dans le ruban). Le script
**refuse** d'installer un manifeste qui viserait encore `localhost` — sans ce garde-fou, une
installation « sans serveur » donnerait une page blanche qu'Excel n'expliquerait pas.

Node et le dépôt ne servent **qu'au moment de l'installation** : une fois le manifeste posé, on
peut les retirer du poste, le complément continue de fonctionner.

Retrait : `npm run addin:install -- --retirer`.

### C.2 — Sans rien : à la main, sur un poste nu

C'est la variante à donner à quelqu'un d'autre. Elle ne demande **ni Node, ni le dépôt, ni les
droits d'administration** : on télécharge le manifeste publié, on le range à un endroit stable,
et on le déclare à Excel. Le mécanisme est celui du §A.3 — seule la provenance du manifeste
change.

Le fichier téléchargé doit **rester en place** : sur Windows, Excel le relit à chaque démarrage.
Le dossier des téléchargements ou un dossier temporaire ne conviennent donc pas.

#### macOS

Excel pour Mac doit avoir été lancé **au moins une fois** (c'est ce qui crée son conteneur).

```bash
mkdir -p ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef
curl -fL -o ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef/sankey-studio.xml \
  https://gaspardlebasic.github.io/sankey-studio/manifest.xml
```

Sans terminal : télécharger `manifest.xml` depuis le navigateur, le **renommer**
`sankey-studio.xml`, puis dans le Finder faire **⇧⌘G** et coller
`~/Library/Containers/com.microsoft.Excel/Data/Documents/wef` — créer le dossier `wef` s'il
n'existe pas — et y déposer le fichier.

Retrait : supprimer ce fichier.

#### Windows

Dans une invite de commandes **ordinaire**, ouverte par la personne qui utilisera Excel — surtout
pas « en tant qu'administrateur » : la clé est sous `HKCU`, et une session ouverte sous un autre
compte écrirait dans la mauvaise ruche du Registre, sans erreur et sans effet.

```bat
mkdir "%LOCALAPPDATA%\SankeyStudio"
curl -L -o "%LOCALAPPDATA%\SankeyStudio\sankey-studio.xml" https://gaspardlebasic.github.io/sankey-studio/manifest.xml
reg add "HKCU\Software\Microsoft\Office\16.0\WEF\Developer" /v sankey-studio.xml /t REG_SZ /d "%LOCALAPPDATA%\SankeyStudio\sankey-studio.xml" /f
```

Retrait :

```bat
reg delete "HKCU\Software\Microsoft\Office\16.0\WEF\Developer" /v sankey-studio.xml /f
```

Si le Registre est verrouillé par une stratégie d'entreprise, le repli est le même qu'en
développement : le [catalogue de confiance](#le-cas-particulier-de-windows--si-le-registre-est-verrouillé).

> C'est **exactement** cette procédure qui a fait tourner le complément dans la VM Windows 11 le
> 2026-09-01 : manifeste téléchargé depuis GitHub Pages, rangé sous `AppData\Local`, chemin
> inscrit sous `WEF\Developer`, Excel redémarré.

#### Puis, sur les deux systèmes

1. Quitter Excel **complètement**, le rouvrir
2. Ouvrir le classeur
3. **Accueil ▸ Diagramme de flux**

### Ce que le §C coûte, comparé au §B

- il faut le faire **sur chaque poste** ;
- il faut le **refaire si le manifeste change** — c'est-à-dire si le nom, les icônes, le bouton
  de ruban ou l'adresse changent. **Pas** si le code change : les bundles portent une empreinte
  dans leur nom, le volet prend la nouvelle version au rechargement ;
- rien n'est centralisé : personne ne peut retirer le complément à distance, ni savoir qui l'a.

En revanche il ne coûte **aucun droit** : ni administration M365, ni administration du poste.

---

## Dépannage

**Le complément n'apparaît pas dans le ruban.**
Excel a-t-il été quitté **complètement** ? Sur macOS, fermer la fenêtre ne suffit pas — ⌘Q.
Chercher ensuite dans *Insertion ▸ Mes compléments ▸ Compléments de développement*. Sur Windows,
si rien n'y est : la clé du Registre est ignorée, passer au [catalogue de
confiance](#le-cas-particulier-de-windows--si-le-registre-est-verrouillé).

**Le volet s'ouvre sur une page blanche.**
En mode développement : `npm run addin:serve` tourne-t-il, et son journal montre-t-il des
requêtes ? Un 404 ou un échec de certificat s'y voit, jamais dans Excel. En mode publié :
`https://<base>/index.html` répond-il dans un navigateur ?

**Une modification ne se voit pas.**
Les bundles JS portent une empreinte et se rechargent seuls ; **les pages HTML, les styles et le
manifeste, non**. Sur Mac :

```bash
npm run excel:cache
```

Il vide le cache HTTP du conteneur d'Excel, ceux de WebKit et le cache des compléments d'Office —
et **jamais** `Data/Documents/wef/`, qui porte le manifeste chargé de côté : l'effacer
désinstallerait le complément. Quitter et rouvrir Excel ensuite. **Ce script est spécifique à
macOS** ; sous Windows, l'équivalent documenté par Microsoft est de vider
`%LOCALAPPDATA%\Microsoft\Office\16.0\Wef\` — non éprouvé ici.

**Le volet et la fenêtre d'édition ne sont pas de la même version.**
GitHub Pages sert les pages HTML avec un cache d'environ dix minutes : juste après une
publication, les deux peuvent différer. Le cas est prévu — la fenêtre le dit et demande à être
fermée puis rouverte depuis le volet. Attendre dix minutes suffit.

**« Le complément ne charge pas hors ligne. »**
C'est attendu, et c'est le prix d'une page servie depuis Internet : en modes B et C, il faut une
connexion à l'ouverture du volet. À dire à l'utilisatrice avant qu'elle ne le découvre dans un
train.

**L'éditeur reste dans le volet au lieu d'ouvrir une fenêtre.**
L'Excel du poste n'offre pas `DialogApi 1.2`. C'est un repli de compatibilité, pas une panne :
l'éditeur fonctionne, à l'étroit.

**Le panneau affiche « Synchronisation manuelle ».**
L'Excel du poste n'offre pas `ExcelApi 1.7` : la synchronisation automatique dans les deux sens
n'est pas possible, les deux boutons du panneau sont alors le seul chemin.

---

Publication et hébergement : [DIFFUSION.md](DIFFUSION.md). Architecture et règles du dépôt :
[AGENTS.md](AGENTS.md).
