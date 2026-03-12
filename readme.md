# Extension Chrome - Time Tracker

Cette extension Chrome suit le temps passe sur les sites web (par domaine) et affiche les stats du jour dans un popup.

## Fonctions

- Suivi automatique du site actif.
- Sauvegarde locale du temps passe par domaine.
- Affichage en temps reel du site en cours.
- Tableau des temps du jour (classe par temps decroissant).

## Fichiers

- `manifest.json` : configuration de l'extension (Manifest V3).
- `background.js` : logique de tracking (service worker).
- `popup.html` : interface popup.
- `popup.css` : styles popup.
- `popup.js` : affichage des stats et du timer live.

## Installation (mode developpeur)

1. Ouvrir `chrome://extensions` dans Chrome.
2. Activer le mode developpeur (en haut a droite).
3. Cliquer sur `Load unpacked` / `Charger l'extension non empaquetee`.
4. Selectionner le dossier du projet.

## Utilisation

1. Naviguer sur des sites web.
2. Cliquer sur l'icone de l'extension.
3. Voir:
   - le site actuellement tracke,
   - le temps en cours,
   - le total du jour par domaine.

## Notes

- Le tracking concerne uniquement les URLs `http` et `https`.
- Les donnees sont stockees en local avec `chrome.storage.local`.
