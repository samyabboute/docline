# Feuille de route

État au 10 octobre 2026. « Fait » veut dire appliqué en production et vérifié par des tests à blanc sur la base réelle (transaction annulée), sauf mention contraire.

| Phase | Contenu | État |
|---|---|---|
| 0 | Audit, décisions, modèle, permissions, feuille de route, recette | Fait (`docs/`) |
| 1 | Sécurité P0 : abonnements, incidents, profils (`20261010_security_p0.sql`) | Fait |
| 1 | Garde-fou du profil médecin, KYC côté serveur (`20261010c_kyc_guard.sql`) | Fait |
| 1 | Justificatifs privés, règles par permission, coordonnées bancaires fictives retirées (`20261010d`, `20261010e`) | Fait |
| 2 | Départements, équipes, compétences, disponibilité, charge (`20261010_org_ticketing.sql`) | Fait |
| 2 | Page Équipe reconstruite sur `symphony_staff` | Fait, vérifiée avec données d'exemple ; à vérifier avec un vrai compte |
| 3 | Billetterie : files, répartition, prise atomique, cycle de vie, délais, escalade, historique | Fait |
| 3 | Page Tickets (9 vues, création guidée, détail, actions) | Fait, vérifiée avec données d'exemple ; à vérifier avec un vrai compte |
| 4 | KYC : décision serveur, motif obligatoire, vérificateur serveur, journal | Fait |
| 4 | Fonction `admin-kyc-action` sur permissions, plus d'effacement du journal | Déployée, non testée de bout en bout |
| 4 | Fiche médecin centrale (CRM) reliée aux tickets, à la facturation et au KYC (`20261011_doctor_hub.sql`) | Fait, vérifiée avec données d'exemple |
| 4 | Gestion des utilisateurs : revue bouton par bouton | À faire |
| 5 | LedgerDesk : registre, compte, 12 mois, prolongations, relevé, bordereau, email, WhatsApp | Fait, vérifié avec données d'exemple |
| 5 | Bordereau de versement | **Bloqué** : coordonnées bancaires de Docline non fournies |
| 5 | Mentions légales sur les documents | **Bloqué** : NIF, NIS, RC, raison sociale non fournis |
| 6 | Publicité : flux réels, indicateurs | À faire. Dépendance : aucun fournisseur de diffusion n'est branché ; seules les vues de la salle d'attente sont comptées |
| 7 | Statistiques : indicateurs définis, agrégation serveur, accès au détail | À faire |
| 8 | Système de design commun, accessibilité, recette mobile | En partie (nouvelles pages responsives) ; à faire sur les anciennes pages |
| — | Recherche globale | À faire |
| — | Retrait définitif de `admin_roles` et `symphony_agents` | Après une période d'observation |

## Prochaines étapes, dans l'ordre

1. Renseigner `billing_bank` dans les réglages (dès réception des coordonnées).
2. Revue de la page Médecins et Cliniques : chaque bouton.
3. Statistiques avec définitions et période de comparaison.
4. Publicité : campagnes, contenus, validations ; indicateurs limités aux vues réellement mesurées.
5. Recherche globale (médecins, tickets, pièces comptables).
