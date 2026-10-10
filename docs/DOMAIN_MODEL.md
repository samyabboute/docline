# Modèle de données de Symphony

Migrations : `supabase/migrations/20261010_org_ticketing.sql`, `20261010b_ticket_reads.sql`, `20261010c_kyc_guard.sql`, `20261010f_ledgerdesk.sql`.

## Organisation

```
departments (key)
  └─ teams (id, department_key, lead_staff_id)
       └─ team_members (team_id, staff_id, is_lead)
symphony_staff (id, email, department → departments.key, role l1/l2/l3/super_admin,
                availability, max_active_tickets, supervisor_id, last_assigned_at, permissions)
  └─ staff_skills (staff_id, skill_key → skills.key, level 1..3, verified_by, expires_at)
org_events (ajout seul) : changements d'équipe, de compétence, de disponibilité, suppressions de comptes
```

Identité de l'agent connecté : `symphony_current_staff()` (correspondance par email, côté serveur).

## Billetterie

```
ticket_services (key, department_key, default_team_id, required_skill_key, routing_policy, categories)
tickets (id, ref TK-000001, service_key, team_id = file, assignee_id = affectation,
         status, priority, impact, doctor_id, response_due_at, resolution_due_at, sla_paused_at, …)
  ├─ ticket_assignments (méthode claim/auto/manual, acknowledged_at, ended_at, end_reason)
  ├─ ticket_events (ajout seul, écrit par le serveur)
  └─ ticket_comments (notes internes)
```

Cycle de vie :

```
queued → assigned → in_progress ⇄ waiting_requester / waiting_team
                 ↘ escalated ↗
in_progress / waiting / escalated → resolved → closed
resolved / closed → queued (réouverture, note obligatoire)
assigned (non pris en main 30 min) → queued (balayage)
```

Fonctions : `ticket_create`, `ticket_claim`, `ticket_assign`, `ticket_release`, `ticket_transition`, `ticket_comment`, `ticket_list`, `ticket_detail`, `ticket_sweep` (pg_cron, toutes les 5 min).

## KYC

`profiles.kyc_status` : `not_submitted` → `pending_review` (médecin) → `approved` / `rejected` (`kyc_decide`, équipe).
Garde-fou `profiles_guard` sur les colonnes de contrôle. Journal `kyc_audit_log` écrit par `profiles_kyc_log`.

## Facturation

```
billing_entries (ajout seul) : number, doctor_id, kind invoice/payment/credit/adjustment,
                               amount_da, direction (+1 dû, -1 en faveur du médecin),
                               method, external_ref, invoice_id, subscription_id, payment_request_id, source
billing_extensions : old_due, new_due, reason, status pending/approved/rejected/cancelled, requested_by, decided_by
billing_document_events (ajout seul) : relevé / bordereau, canal print/email/whatsapp, résultat réel
profiles.payment_deadline, profiles.extension_count : échéance courante (colonnes existantes)
```

Solde = somme de `amount_da × direction`. Sources existantes conservées : `subscriptions` (droits d'accès), `payment_requests` (demandes des médecins, justificatifs).
