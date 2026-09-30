# Création automatique de tâches Modulr

Version 11.2.3 : attribution au référent, puis au binôme, puis à l'utilisateur connecté uniquement lorsque les 2 rôles sont explicitement vides.

La création, la modification via formulaire et le changement d'état utilisent le même résolveur. Les listes de collaborateurs sont lues par leur valeur sélectionnée, sans parcourir leurs options pour chercher un nom. L'ordre des collaborateurs ne détermine pas l'attribution.

Le résolveur attend une valeur stable pendant 600 ms, avec une attente maximale de 6 secondes pour les champs en chargement. Une vérification de la fiche est nécessaire avant le recours au connecté. Un rôle absent du HTML, ambigu ou en chargement n'est pas considéré comme vide : la tâche n'est pas envoyée à un autre utilisateur.

Les responsables sont lus dans le devis identifié ou dans les champs dédiés de la fiche client. Les autres devis et anciennes tâches sont exclus de la recherche. Le serveur reçoit directement l'identifiant choisi dans `task_actors_list_id`, puis le changement d'état est lancé après la réponse.

## Installation / mise à jour

[Ouvrir le script dans Tampermonkey](https://raw.githubusercontent.com/BiggerThanTheMall/tache_automatique/main/creation_tache_automatique_changement_etat_devis.user.js), accepter la mise à jour, puis recharger Modulr. Vérifier la version 11.2.3 dans Tampermonkey.

## Vérification

Avec une version récente de Node.js :

```sh
npm install
npm test
```

Les tests reproduisent Louli après Ghaïs dans une liste, le chargement différé, la priorité du référent, le recours au binôme dans un formulaire, la création d'un devis, les rôles de la fiche client, les échecs de lecture et l'identifiant réellement envoyé au serveur. Aucun test ne crée de tâche dans Modulr.

## Historique

- 24/09/2026, 10 h 53 (Paris), 11.2.2 : suppression de `user_id` comme source de référent, lecture distincte du binôme et ajout de la priorité référent → binôme → connecté. Le formulaire de modification ne bénéficiait pas encore du même résolveur.
- 28/07/2026, 15 h 09, 11.2.1 : identification renforcée du client et du devis, enregistrement du devis et création de tâche par requêtes directes.
- 25/06/2026, 17 h 01, 10.4.0 : création de tâche sans second rafraîchissement et amélioration de l'exécution.
