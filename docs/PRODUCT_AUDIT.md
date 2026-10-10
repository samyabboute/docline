# Audit produit et technique de Symphony

Audit réalisé le 10 octobre 2026, à partir du dépôt et de la base de production (projet Supabase `ferkzwzypmdtuypxribz`).

## Socle technique réel

| Élément | Réalité |
|---|---|
| Interface | Pages HTML et JavaScript sans framework (`src/pages`), servies par un Worker Cloudflare (`worker.js`, routes propres) |
| Données | Supabase Postgres avec règles d'accès (RLS) et fonctions SQL (`security definer`) |
| Traitements serveur | Fonctions Edge Deno (`supabase/functions`) : emails (Resend), paiements (Chargily, Stripe historique), KYC, notifications |
| Authentification | Supabase Auth (email et mot de passe) pour les médecins et l'équipe ; sessions par SMS pour les patients |
| Permissions de l'équipe | Table `symphony_staff` (département + niveau l1/l2/l3), fonctions `symphony_me`, `symphony_can`, `symphony_is_staff` ; filtrage des pages par `symphony-access.js` |
| Tests | Aucun test automatisé dans le dépôt. Outils maison dans `.qa/` (comparaison code et schéma, contrôle des appels de fonctions, chargement des pages avec un faux client) |
| Volume | 7 profils, 5 abonnements, 2 membres de l'équipe, 0 ticket, 0 paiement, 0 facture. La plateforme n'est pas encore lancée : les migrations sont peu risquées pour les données. |

## Modules de Symphony et leurs sources de données

| Page | Rôle | Sources |
|---|---|---|
| `symphony-hq` | QG : tableau de bord, tâches, équipe et accès | `symphony_staff`, `symphony_tasks`, RPC `symphony_*` |
| `symphony-agents` | Annuaire des agents | **`symphony_agents`, une table séparée et vide** |
| `symphony-users` | Gestion des médecins, plans, KYC | `profiles`, `subscriptions`, `payment_requests`, fonction `activate-plan` |
| `symphony-crm` | Fiche médecin | `profiles`, `subscriptions`, `audit_log`, `payment_requests` |
| `symphony-kyc` | File de vérification KYC | `profiles`, `kyc_audit_log` |
| `symphony-incidents` | Incidents | `incidents`, `incident_updates` |
| `symphony-ads` | Vidéos publicitaires de la salle d'attente | `ad_campaigns` |
| `symphony-analytics`, `symphony-revenue` | Statistiques et revenus | `subscriptions`, `profiles`, `feedback`, `audit_log` |
| `symphony` | Ancien tableau de bord monolithique (16 modules) | Presque toutes les tables |

## Problèmes classés

### P0 : sécurité, perte de données, défaillance critique

| # | Problème | État |
|---|---|---|
| P0-1 | **Abonnements** : la policy `admin_payment_update` (ALL, authenticated, `true`) permettait à n'importe quel médecin connecté de modifier tous les abonnements. L'inscription créait en plus un plan payant actif sans date de fin depuis le navigateur. | **Corrigé** le 10/10 (`20261010_security_p0.sql`), vérifié en production |
| P0-2 | **Incidents** : la policy nommée `service_role_incidents` valait `true` pour tout le monde, y compris les visiteurs anonymes. | **Corrigé** le 10/10, vérifié |
| P0-3 | **Profils** : tout utilisateur connecté lisait tous les profils (emails, téléphones, références KYC), et les visiteurs anonymes toutes les colonnes des médecins publics. | **Corrigé** le 10/10 : vue `public_doctors` limitée aux colonnes publiques, fonctions dédiées pour la salle d'attente et l'agenda clinique |
| P0-4 | Rendez-vous et résultats d'analyses lisibles et modifiables par n'importe qui. | Corrigé le 07/10 |
| P0-5 | **Effacement de l'historique KYC** : l'action de suppression de `admin-kyc-action` vide `kyc_audit_log` pour le médecin. | **Corrigé** le 10/10 : plus d'effacement ; suppression refusée si historique de paiement ; trace dans `org_events` |
| P0-6 | **Auto-approbation KYC** : un médecin pouvait modifier toute sa fiche, y compris `kyc_status`, `featured`, `is_active`, l'essai et l'échéance. | **Corrigé** le 10/10 (`20261010c_kyc_guard.sql`), vérifié |
| P0-7 | **Coordonnées bancaires fictives** affichées sur la page Tarifs alors que le virement est activé. | **Corrigé** le 10/10 : lues dans les réglages ; message d'attente tant qu'elles manquent |

### P1 : fonctionnalité essentielle cassée

| # | Problème |
|---|---|
| | *État au 10/10 : P1-1 à P1-7 corrigés (voir IMPLEMENTATION_ROADMAP.md).* |
| P1-1 | **Trois modèles d'équipe concurrents** : `symphony_staff` (permissions, QG), `symphony_agents` (page Agents) et `admin_roles` (anciennes règles). La page Agents lit une table vide : les agents créés au QG n'y apparaissent jamais. C'est la cause racine des agents qui n'apparaissent pas et ne peuvent pas être affectés. |
| P1-2 | **Pas de départements, d'équipes ni de compétences en base** : le département est une simple colonne texte, les compétences n'existent pas. |
| P1-3 | **Deux systèmes de tickets concurrents** (`incidents` et `symphony_tasks`), sans files d'attente, sans prise en charge concurrente sûre, sans historique fiable généré côté serveur. |
| P1-4 | **Décision KYC écrite par le navigateur** : statut et identité du vérificateur envoyés par le client. L'écriture du journal échoue en silence pour tout membre de l'équipe hors des deux emails administrateurs. Aucune raison obligatoire pour un refus. |
| P1-5 | `is_admin()` compare `symphony_staff.id` à `auth.uid()`, alors que les membres créés au QG ont un identifiant indépendant : la fonction renvoie faux pour eux. |
| P1-6 | Plusieurs règles d'accès comparent des emails écrits en dur (`samyabboute5@gmail.com`, `contact@docline.health`) au lieu des permissions. |
| P1-7 | Bucket de stockage `payment-proofs` public : un justificatif de paiement est lisible par quiconque connaît son adresse. |

### P2 : manque majeur d'usage, de flux ou de suivi

| # | Problème |
|---|---|
| P2-1 | La fiche médecin (`symphony-crm`) n'est pas reliée aux tickets, ni aux paiements détaillés, ni à la publicité. On n'y arrive que par un paramètre d'adresse. |
| P2-2 | Facturation : aucun registre comptable (factures de Docline aux médecins, paiements, avoirs). `payment_requests` ne suffit pas à reconstituer un solde ni un relevé. |
| P2-3 | Publicité : configuration des vidéos uniquement. Le compteur de vues existe, mais aucune impression, aucun clic ni aucun budget n'est mesuré. Aucun fournisseur externe n'est branché. |
| P2-4 | Statistiques : indicateurs sans définition ni période de comparaison, et sans accès aux données détaillées. |
| P2-5 | Pas de recherche globale. |
| P2-6 | Aucun médecin n'est actuellement visible dans l'annuaire public : le seul médecin vérifié n'a pas `is_public`. |

### P3 : finitions

| # | Problème |
|---|---|
| P3-1 | L'ancien `symphony.html` duplique des modules qui existent ailleurs. |
| P3-2 | Erreurs Sentry dans la console : identifiant de projet jamais configuré (`VOTRE_DSN_ICI`). |
