# CookCLI Recipes pour Home Assistant

Intégration Home Assistant permettant de parcourir vos recettes de cuisine depuis un serveur [CookCLI](https://github.com/cooklang/CookCLI).

Cette intégration fonctionne main dans la main avec une **stratégie de tableau de bord** et une **carte personnalisée** pour offrir une expérience complète : navigation parmi les recettes, page de détail par recette, affichage des ingrédients et des étapes.

## ✨ Fonctionnalités

- 📖 **Parcourir vos recettes** directement depuis Home Assistant
- 🗂️ **Tableau de bord automatique** : une page est générée pour chaque recette
- 🥕 **Vue détaillée** de chaque recette : ingrédients et étapes de préparation
- 🧭 **Carte de navigation** : liste toutes les recettes et permet de naviguer vers la page de détail

## 🧩 Architecture

Le projet est composé de **trois dépôts** qui travaillent ensemble :

| Composant | Rôle | Dépôt |
|---|---|---|
| **Intégration** | Se connecte au serveur CookCLI et expose les recettes à Home Assistant | [ha-cookcli](https://git.thethomaas.net/TheThomaas/ha-cookcli) |
| **Stratégie de tableau de bord** | Crée automatiquement une page par recette (ingrédients + étapes) | [ha-cookcli-strategy](https://git.thethomaas.net/TheThomaas/ha-cookcli-strategy) |
| **Carte personnalisée** | Liste toutes les recettes et permet de naviguer vers le détail d'une recette | [ha-cookcli-card](https://git.thethomaas.net/TheThomaas/ha-cookcli-card) |

## 📦 Installation

### Prérequis

- Une instance **Home Assistant** fonctionnelle (version récente recommandée)
- Un serveur **CookCLI** accessible depuis Home Assistant
- **[HACS](https://hacs.xyz/)** installé (recommandé)

### Installation via HACS

1. Ouvrez **HACS** dans Home Assistant.
2. Allez dans **Intégrations** → menu (⋮) → **Dépôts personnalisés**.
3. Ajoutez l'URL du dépôt :
   ```
   https://git.thethomaas.net/TheThomaas/ha-cookcli
   ```
   Catégorie : **Intégration**
4. Recherchez **CookCLI** dans HACS et installez-le.
5. **Redémarrez Home Assistant.**

### Installation manuelle

1. Téléchargez ou clonez ce dépôt.
2. Copiez le dossier `custom_components/cookcli` dans le répertoire `config/custom_components/` de votre instance Home Assistant.
3. **Redémarrez Home Assistant.**

### Installation de la carte et de la stratégie

Répétez l'opération via HACS (catégorie **Lovelace** / **Dashboard**) pour :

- [ha-cookcli-card](https://git.thethomaas.net/TheThomaas/ha-cookcli-card) — la carte
- [ha-cookcli-strategy](https://git.thethomaas.net/TheThomaas/ha-cookcli-strategy) — la stratégie de tableau de bord

## ⚙️ Configuration

1. Dans Home Assistant, allez dans **Paramètres** → **Appareils et services**.
2. Cliquez sur **Ajouter une intégration**.
3. Recherchez **CookCLI**.
4. Renseignez les informations demandées :
   - **Hôte / URL du serveur CookCLI** (ex. `http://192.168.1.10:9080`)
   - **Port** si nécessaire
5. Validez.

## 🚀 Utilisation

### Carte des recettes

Ajoutez la carte `cookcli-card` à un tableau de bord pour afficher la liste de toutes vos recettes. Cliquer sur une recette vous amène vers sa page de détail.

Exemple (YAML) :

```yaml
type: custom:cookcli-card
title: Mes recettes
```

> Adaptez la configuration selon les options exposées par la carte. Consultez le [README de ha-cookcli-card](https://git.thethomaas.net/TheThomaas/ha-cookcli-card) pour la liste complète des options.

### Stratégie de tableau de bord

La stratégie `cookcli-recipe-strategy` génère automatiquement un tableau de bord avec **une page par recette**. Chaque page affiche :

- la liste des **ingrédients**,
- les **étapes** de préparation.

Pour l'utiliser, créez un nouveau tableau de bord et sélectionnez la stratégie CookCLI, ou référencez-la dans votre configuration de tableau de bord.

## 📄 Licence

Ce projet est distribué sous licence présente dans le fichier [LICENSE](./LICENSE) du dépôt.

## 🔗 Liens

- **Intégration** : https://git.thethomaas.net/TheThomaas/ha-cookcli
- **Stratégie** : https://git.thethomaas.net/TheThomaas/ha-cookcli-strategy
- **Carte** : https://git.thethomaas.net/TheThomaas/ha-cookcli-card
- **CookCLI** : https://github.com/cooklang/CookCLI
- **Cooklang** : https://cooklang.org/

---

*Projet non officiel, non affilié à Home Assistant ni à Cooklang.*