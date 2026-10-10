# Décisions produit et techniques

Chaque décision indique ce qui a été choisi, pourquoi, et ce qui reste ouvert.

## Organisation

| Décision | Raison |
|---|---|
| `symphony_staff` est la seule source de vérité sur l'équipe. `symphony_agents` est déclarée obsolète, `admin_roles` n'est plus lue par aucune règle d'accès. | La page Agents lisait une table vide : les agents créés au QG n'apparaissaient jamais. |
| Départements en table (`departments`), avec les clés existantes (`direction`, `ops`, `customer_success`, `billing`, `sales`, `marketing`, `devops`, `rd`). | Évite de casser les permissions déjà attribuées. |
| Une équipe par département est créée d'office et sert de file par défaut. | Les tickets ont toujours une file valide dès le premier jour. |
| Une compétence permet de recevoir des tickets, elle ne donne aucun droit. | Demande explicite : « a skill is not a permission ». |
| Les comptes et les accès se gèrent au QG ; la page Équipe gère équipes, compétences, charge et disponibilité. | Un seul endroit pour créer un compte. |

## Billetterie

| Décision | Raison |
|---|---|
| File (équipe) et affectation (agent) sont deux champs distincts. Un ticket en file n'a jamais de responsable (contrainte en base). | Modèle demandé, et évite les tickets « affectés à une file ». |
| Répartition par défaut : compétence requise, disponibilité « Disponible », charge sous le plafond, charge la plus faible, puis agent servi il y a le plus longtemps. Politiques `round_robin` et `manual` disponibles par service. | Équité et respect des compétences sans réglage. |
| Si personne n'est éligible, le ticket reste en file et l'événement `no_eligible_agent` est tracé. Rien n'est forcé. | Ne jamais confier un ticket à quelqu'un qui ne peut pas le traiter. |
| Prise en charge atomique (`select … for update` + contrôle du responsable attendu). | Deux agents ne peuvent pas prendre le même ticket. |
| Délais par priorité (réponse / résolution) : urgente 1 h / 4 h, haute 4 h / 1 j, normale 1 j / 3 j, basse 3 j / 7 j. Le délai de résolution est suspendu pendant l'attente du médecin ou d'une autre équipe. | Valeurs de départ raisonnables, à ajuster avec l'usage. |
| Une affectation non prise en main en 30 minutes revient en file. Un ticket urgent ou haut en retard est escaladé. Balayage toutes les 5 minutes (pg_cron). | Demande « requeue when an assignment is not acknowledged ». |
| Note obligatoire pour résoudre, escalader, rouvrir ; raison obligatoire pour réaffecter ou rendre un ticket. | Traçabilité. |
| Historique (`ticket_events`) écrit uniquement par le serveur, en ajout seul ; une modification ou suppression lève une erreur. | Demande explicite. |
| L'ancienne page Incidents reste accessible par son adresse mais n'est plus dans la navigation. Ses deux tables sont vides. | Pas de perte de données, pas de doublon visible. |

## KYC

| Décision | Raison |
|---|---|
| La décision passe par `kyc_decide` : le serveur identifie le vérificateur (`auth.uid()`), exige un motif d'au moins 5 caractères pour un refus, refuse d'approuver sans document. | Interdiction de laisser le navigateur fabriquer l'identité du vérificateur. |
| Un médecin ne peut modifier sur sa fiche ni le statut KYC (sauf soumission), ni la mise en vedette, ni l'activation, ni l'essai, ni l'échéance. | Faille P0 : un médecin pouvait s'auto-approuver. |
| Le journal KYC est écrit par un déclencheur à chaque changement d'état. | Les soumissions des médecins étaient rejetées en silence. |
| Un compte qui a un historique de paiement ne peut pas être supprimé, seulement désactivé. Une suppression est tracée dans `org_events`. | « Preserve existing user data and financial records. » |

## Facturation (LedgerDesk)

| Décision | Raison |
|---|---|
| Nouveau registre `billing_entries` en ajout seul ; corrections par avoir ou ajustement. Numéros attribués par le serveur (`FAC-2026-00001`…). | Il n'existait aucun registre : impossible de produire un solde ou un relevé. |
| Montants en dinars entiers. | Le dinar ne se fractionne pas en pratique dans la facturation Docline. |
| Un paiement d'abonnement validé écrit facture et paiement automatiquement, avec le montant de la demande du médecin ou le tarif configuré. Si le montant est inconnu, rien n'est écrit. | Une seule source de vérité, aucune valeur inventée. |
| Les octrois manuels (`admin_grant`) et le plan gratuit ne créent pas d'écriture. | Pas de flux d'argent. |
| Prolongation d'échéance : demandée par une personne, validée par une autre (« quatre yeux »), 30 jours maximum, 3 par compte. | « Controlled deadline extensions with approval. » |
| Le bordereau de versement est bloqué tant que les coordonnées bancaires de Docline ne sont pas renseignées (`app_settings.billing_bank`). La « référence client » est dérivée de l'identifiant du compte. | Interdiction d'inventer des coordonnées bancaires. |
| WhatsApp : l'outil ouvre la conversation et note « ouvert, envoi non confirmé ». L'email note « envoyé » ou « échec » selon la réponse réelle du fournisseur. | « WhatsApp must report its real outcome. » |
| PDF : par la fenêtre d'impression du navigateur. | Pas de dépendance supplémentaire. |

## Sécurité

| Décision | Raison |
|---|---|
| Plus aucune règle d'accès ne compare une adresse email écrite en dur. | Les règles suivaient des personnes, pas des postes. |
| Justificatifs de paiement en stockage privé, ouverts par URL signée de 10 minutes. | Bucket public auparavant. |
| Les coordonnées bancaires fictives ont été retirées de la page Tarifs. | Un médecin aurait pu virer de l'argent vers un compte inexistant. |

## Questions ouvertes (informations métier nécessaires)

1. **Coordonnées bancaires réelles de Docline** (titulaire, banque, RIB, CCP et clé) pour la page Tarifs et le bordereau.
2. **Mentions légales des documents** (raison sociale, NIF, NIS, RC, adresse) : les relevés n'en affichent aucune tant qu'elles ne sont pas fournies.
3. **Durée de l'essai** : 7 jours dans le code, 30 jours dans certains textes marketing.
4. **Délais de traitement** des tickets : valeurs de départ à confirmer.
