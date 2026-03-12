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
- Dashboard complet dans un onglet dedie:
  - KPIs globaux
  - detail par site et par jour
  - top jours d'activite
  - matrice sites x jours
- Donut de repartition du temps par domaine.
- Tableau domaines + pourcentage + duree.
- Navigation entre jours dans la vue `Jour`.
- Export des donnees au format CSV.
- Import des donnees depuis un CSV exporte (format `Domain,YYYY-MM-DD,...`).
- Suppression complete des donnees de tracking.
- Sync cloud Firebase (auth Google + multi-appareils).

## Architecture

- `manifest.json` : declaration Manifest V3 et permissions.
- `background.js` : moteur de tracking, sessions, idle, badge, API messages popup.
- `popup.html` : interface utilisateur.
- `popup.css` : design et animations de l'interface popup.
- `popup.js` : calcul des stats, rendu graphique/tableau, interactions utilisateur.

## Sync Cloud Firebase

L'extension utilise un mode hybride:

- ecriture locale immediate (`chrome.storage.local`) pour les performances,
- synchronisation cloud incremental toutes les 5 minutes.

### Configuration requise

1. Dans `manifest.json`:
   - remplacer `oauth2.client_id` par ton vrai Client ID OAuth Google.
2. Dans `background.js`:
   - remplacer `FIREBASE_PROJECT_ID = "YOUR_FIREBASE_PROJECT_ID"`.
3. Configurer Firestore et OAuth consent dans Google Cloud/Firebase.

### Structure Firestore proposee

Collection racine par utilisateur, puis sous-collection par appareil:

- `users/{uid}`
- `users/{uid}/devices/{deviceId}`
  - `deviceName`, `platform`, `lastSeenAt`, `extension`, etc.
- `users/{uid}/devices/{deviceId}/days/{YYYY-MM-DD}`
  - `dayKey`
  - `totalSeconds`
  - `domains` (map `domain -> seconds`)
  - `updatedAt`

Cette structure separe proprement:

- les donnees par utilisateur,
- puis par appareil,
- puis par jour.

### Appareil (multi-device)

- Au premier login Google, l'extension peut demander un nom d'appareil (ex: `Laptop Alou`).
- Le nom est modifiable dans le popup.

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
- `Effacer les donnees` pour reset total,
- `Ouvrir Dashboard complet` pour l'analyse avancee.

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
