# Installation de Sankey Studio sous ONLYOFFICE

Ce guide explique comment installer et utiliser **Sankey Studio** dans **ONLYOFFICE Spreadsheet Editor** (tableur), que ce soit dans l'application de bureau (*ONLYOFFICE Desktop Editors*) ou sur un serveur (*ONLYOFFICE Docs / DocSpace / Nextcloud*).

---

## 1. Génération du paquet du plugin

Le paquet d'installation est généré automatiquement lors de la construction du projet :

```bash
npm run build
# ou spécifiquement :
npm run onlyoffice:package
```

Cela produit :
- Le dossier prêt à l'emploi : `dist/onlyoffice/`
- L'archive installable en un clic : `dist/sankey-studio.plugin`

---

## 2. Installation dans ONLYOFFICE Desktop Editors

### Méthode 1 : Via le Gestionnaire de plugins (Recommandé)

1. Lance **ONLYOFFICE Desktop Editors** et ouvre un classeur Excel (`.xlsx`).
2. Va dans l'onglet **Modules complémentaires** (ou **Plugins** dans le ruban supérieur).
3. Clique sur **Gestionnaire de plugins** (Plugin Manager).
4. Clique sur **Ajouter un plugin** ou glisse-dépose le fichier `dist/sankey-studio.plugin` dans la fenêtre.
5. L'icône **Sankey Studio** apparaît désormais dans l'onglet des modules complémentaires !

### Méthode 2 : Déclaration manuelle par dossier

Si tu préfères installer le plugin directement dans ton profil utilisateur :

- **macOS** :
  ```bash
  mkdir -p "$HOME/Library/Application Support/ONLYOFFICE/DesktopEditors/data/plugins/sankey-studio"
  cp -R dist/onlyoffice/* "$HOME/Library/Application Support/ONLYOFFICE/DesktopEditors/data/plugins/sankey-studio/"
  ```
- **Windows** (PowerShell) :
  ```powershell
  New-Item -ItemType Directory -Force -Path "$env:APPDATA\ONLYOFFICE\DesktopEditors\data\plugins\sankey-studio"
  Copy-Item -Recurse dist\onlyoffice\* "$env:APPDATA\ONLYOFFICE\DesktopEditors\data\plugins\sankey-studio\"
  ```
- **Linux** :
  ```bash
  mkdir -p ~/.local/share/onlyoffice/desktopeditors/data/plugins/sankey-studio
  cp -r dist/onlyoffice/* ~/.local/share/onlyoffice/desktopeditors/data/plugins/sankey-studio/
  ```

Redémarre ensuite ONLYOFFICE Desktop Editors.

---

## 3. Installation sur ONLYOFFICE Docs (Serveur Web / DocSpace / Nextcloud)

Pour rendre Sankey Studio disponible à tous les utilisateurs d'une instance ONLYOFFICE Document Server :

1. Copie le dossier `dist/onlyoffice` dans le répertoire des plugins du serveur ONLYOFFICE :
   ```bash
   cp -r dist/onlyoffice /var/www/onlyoffice/documentserver/sdkjs-plugins/sankey-studio
   ```
2. Si tu utilises Docker :
   ```bash
   docker cp dist/onlyoffice <id-conteneur-documentserver>:/var/www/onlyoffice/documentserver/sdkjs-plugins/sankey-studio
   ```
3. Redémarre les services ONLYOFFICE Document Server (ou le conteneur Docker).

---

## 4. Utilisation

1. Ouvre n'importe quel classeur `.xlsx` dans ONLYOFFICE Spreadsheet Editor.
2. Dans le ruban, rends-toi dans l'onglet **Modules complémentaires** (ou **Compléments**).
3. Clique sur le bouton **Sankey Studio**.
4. Une fenêtre modale d'édition s'ouvre au format confortable (1280×800) par-dessus la grille.
5. **Amorçage** :
   - Si le classeur contient déjà les tableaux « Nœuds » et « Liens », Sankey Studio les charge immédiatement.
   - Si le classeur est vierge, un écran d'accueil propose **« Préparer le classeur »** : un clic crée la feuille `Diagramme` avec les tableaux et colonnes requis.
6. Toutes les modifications apportées dans Sankey Studio sont reportées directement dans le classeur ouvert.
