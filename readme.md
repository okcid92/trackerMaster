# Extension Chrome - Web Focus Tracker

Extension Chrome de suivi du temps passe sur les sites internet, inspiree des logiques avancees de type Webtime Tracker, avec un code original et simplifie.

## Fonctions principales

- Tracking automatique du site actif (par domaine).
- Gestion de sessions robuste avec decoupage a minuit.
- Pause automatique du tracking en etat idle / locked.
- Badge optionnel sur l'icone de l'extension.
- Vue popup avec 3 periodes:
  - `Jour`
  - `Moyenne` (moyenne journaliere depuis le debut)
  - `All-time`
- Donut de repartition du temps par domaine.
- Tableau domaines + pourcentage + duree.
- Navigation entre jours dans la vue `Jour`.
- Export des donnees au format CSV.
- Import des donnees depuis un CSV exporte (format `Domain,YYYY-MM-DD,...`).
- Suppression complete des donnees de tracking.

## Architecture

- `manifest.json` : declaration Manifest V3 et permissions.
- `background.js` : moteur de tracking, sessions, idle, badge, API messages popup.
- `popup.html` : interface utilisateur.
- `popup.css` : design et animations de l'interface popup.
- `popup.js` : calcul des stats, rendu graphique/tableau, interactions utilisateur.

## Installation (mode developpeur)

1. Ouvrir `chrome://extensions`.
2. Activer `Mode developpeur`.
3. Cliquer `Load unpacked` / `Charger l'extension non empaquetee`.
4. Choisir ce dossier.

## Utilisation

1. Naviguer normalement sur le web.
2. Ouvrir le popup de l'extension.
3. Changer de vue (`Jour`, `Moyenne`, `All-time`) pour analyser le temps passe.
4. Ajuster les reglages:
   - seuil idle (secondes),
   - affichage du badge.
5. Utiliser:

- `Exporter CSV` pour sauvegarder les donnees,
- `Importer CSV` pour ouvrir une page dediee d'import,
- `Effacer les donnees` pour reset total.

## Format CSV

- En-tete: `Domain,YYYY-MM-DD,YYYY-MM-DD,...`
- Une ligne par domaine, avec le nombre de secondes par jour.
- A l'import:
  - L'import se fait dans un onglet dedie (evite la fermeture du popup Chrome pendant le choix du fichier).
  - `Fusionner` = ajoute les donnees importees aux donnees existantes.
  - `Remplacer` = remplace completement les donnees existantes.

## Donnees et vie privee

- Toutes les donnees restent en local (`chrome.storage.local`).
- Aucune synchronisation distante n'est implementee.
- Le tracking cible uniquement les URLs `http://` et `https://`.
