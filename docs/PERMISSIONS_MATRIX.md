# Matrice des permissions

Les permissions sont calculées par `symphony_default_perms(département, niveau)` et contrôlées côté serveur par `symphony_can()`. Le niveau `super_admin` reçoit `*`. Le menu masque ce qui n'est pas autorisé, mais c'est la base qui refuse.

## Correspondance avec les rôles demandés

| Rôle demandé | Dans Symphony |
|---|---|
| Platform Admin | `super_admin` |
| Executive | Direction, niveau l3 |
| Department Manager | niveau l3 du département |
| Team Leader | responsable d'équipe (`team_members.is_lead`), avec `tickets.assign` (l2+) |
| Agent | niveau l1 |
| Specialist | agent avec compétences vérifiées (`staff_skills`) |
| Billing Agent | département Facturation, l1 ou l2 |

## Clés communes à tous les niveaux

`overview`, `tickets.create`, `tickets.work`

## Par département

| Département | l1 | l2 ajoute | l3 ajoute |
|---|---|---|---|
| Direction | analytics.view, doctors.view, kyc.view, payments.view, revenue.view, marketing.view, demand.view, incidents.view, team.view, tasks.view_all, tickets.view_all, billing.view | tickets.assign, doctors.edit, kyc.decide, payments.decide, featured.manage, security.view, billing.extend, ads.manage | team.manage, simulate.use, users.sensitive, tickets.configure |
| Opérations | kyc.view, doctors.view, payments.view, incidents.view | tickets.assign, kyc.decide, payments.decide | doctors.edit, team.view |
| Succès client | doctors.view, kyc.view, incidents.view | tickets.assign, kyc.decide, doctors.edit | payments.view, team.view |
| Facturation | payments.view, revenue.view, doctors.view, billing.view | tickets.assign, payments.decide, billing.extend, billing.documents | team.view |
| Commercial | doctors.view, demand.view, analytics.view | tickets.assign, doctors.edit, featured.manage | revenue.view, team.view |
| Marketing | marketing.view, analytics.view, demand.view, doctors.view | tickets.assign, featured.manage, ads.manage | team.view |
| Produit et données | incidents.view, analytics.view | tickets.assign, security.view | simulate.use, team.view |
| Technique | incidents.view, security.view | tickets.assign, simulate.use | team.view |

Tous les niveaux l3 ont en plus `tasks.view_all` et `tickets.view_all`.

## Actions sensibles et contrôle serveur

| Action | Permission | Contrôle |
|---|---|---|
| Voir tous les tickets | tickets.view_all | `ticket_can_view`, règle de lecture |
| Prendre un ticket | tickets.work + appartenance à l'équipe + compétence | `ticket_claim` |
| Affecter / réaffecter | tickets.view_all + tickets.assign, ou responsable de l'équipe | `ticket_assign` (raison obligatoire pour réaffecter) |
| Gérer équipes, compétences, plafonds | team.manage | `org_*` |
| Décider un KYC | kyc.decide | `kyc_decide` |
| Saisir facture, avoir, ajustement | billing.documents | `billing_record` |
| Enregistrer un paiement | billing.documents ou payments.decide | `billing_record` |
| Demander / valider une prolongation | billing.extend (validation par une autre personne) | `billing_extension_*` |
| Lire le registre de facturation | billing.view | règles de lecture, `billing_account` |
| Valider un paiement d'abonnement | payments.decide | fonction `admin-kyc-action` |
| Supprimer un compte médecin | users.sensitive, et aucun historique de paiement | fonction `admin-kyc-action` |
| Lire les rendez-vous de tous les cabinets | users.sensitive | règle de lecture |
| Réglages, codes promo | settings.manage | règles d'écriture |
| Publicité | ads.manage | règles d'écriture |

Note : les membres existants gardent la liste `permissions` enregistrée à leur création. Les nouvelles clés s'appliquent aux comptes créés ou réenregistrés depuis le QG. Les deux membres actuels sont `super_admin`.
