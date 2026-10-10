# Recette

Scénario automatique côté serveur : `.qa/regression.sql` (29 contrôles, transaction annulée, identités réelles de l'équipe et d'un médecin). Dernière exécution le 11/10 : 29/29 OK.
Contrôle code ↔ base : `node .qa/scan.js` (0 écart le 11/10).

## Déjà vérifié (tests à blanc sur la base de production, transaction annulée)

### Billetterie
- [x] Création avec affectation automatique à l'agent éligible.
- [x] Ticket laissé en file, avec événement tracé, quand aucun agent n'est éligible.
- [x] Seconde prise du même ticket refusée (`ALREADY_CLAIMED`).
- [x] Résolution sans note refusée.
- [x] Transition invalide refusée (résolu vers en cours).
- [x] Réouverture : retour en file, puis nouvelle affectation.
- [x] Historique impossible à supprimer.
- [x] Insertion directe dans `tickets` refusée.
- [x] Visiteur anonyme : 0 ticket visible.
- [x] Compteurs par vue (`ticket_list`) et détail (`ticket_detail`).

### KYC
- [x] Un médecin qui tente de s'auto-approuver, de se mettre en vedette ou de prolonger son essai : sans effet.
- [x] Un médecin peut soumettre un dossier ; le journal est écrit par le serveur.
- [x] Un médecin qui appelle `kyc_decide` : refusé.
- [x] Refus avec motif trop court : refusé.
- [x] Refus puis approbation : le vérificateur est enregistré par le serveur.

### Facturation
- [x] Facture, paiement et avoir : numéros FAC, PAI et AVO.
- [x] Paiement sans moyen de paiement : refusé.
- [x] Avoir sans justification : refusé.
- [x] Auto-validation d'une prolongation : refusée.
- [x] Seconde demande de prolongation en attente : refusée.
- [x] Validation par une autre personne : échéance et compteur mis à jour.
- [x] Solde juste : 5 900 − 3 000 − 500 = 2 400 DA.
- [x] Paiement d'abonnement validé : facture et paiement écrits automatiquement.

### Sécurité
- [x] Plus aucune règle d'accès comparant une adresse email écrite en dur (0 restante).
- [x] Bucket `payment-proofs` privé.

### Pages
- [x] Tickets, Équipe et LedgerDesk : syntaxe, rendu avec données d'exemple en largeur bureau et réduite, aucun débordement horizontal.

## À vérifier en cliquant, connecté (session requise)
- [ ] Se mettre « Disponible », créer un ticket Support général, le recevoir, le résoudre.
- [ ] Ajouter un agent à une équipe et lui donner une compétence, puis vérifier qu'il reçoit les tickets.
- [ ] Laisser un ticket affecté sans le commencer pendant 30 minutes : il doit revenir en file.
- [ ] KYC depuis la page KYC et depuis Médecins et Cliniques : approuver, puis refuser avec motif.
- [ ] Médecin : soumettre un dossier KYC depuis l'application.
- [ ] Valider un paiement d'abonnement, puis vérifier les écritures dans LedgerDesk.
- [ ] Relevé : impression en PDF, envoi par email (contrôler la réception), WhatsApp.
- [ ] Ouvrir un justificatif de paiement depuis LedgerDesk.
- [ ] Page Tarifs : le bloc virement affiche le message d'attente tant que `billing_bank` est vide.
- [ ] Téléphone (375 px) : Tickets, Équipe, LedgerDesk.
