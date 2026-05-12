# Sentry — Configuration (5 minutes)

## 1. Créer le projet

1. Aller sur https://sentry.io → Sign Up (gratuit, 5 000 erreurs/mois)
2. Créer une organisation : `docline`
3. Créer un projet : Platform = **Browser JavaScript**, nom = `docline-frontend`
4. Copier le **DSN** (format : `https://xxxx@o123.ingest.sentry.io/456`)

## 2. Configurer le frontend

Ouvrir `src/pages/js/sentry-config.js` et remplacer :

```js
window.SENTRY_DSN = "VOTRE_DSN_ICI";
```

par votre DSN Sentry, par exemple :

```js
window.SENTRY_DSN = "https://abc123@o456789.ingest.sentry.io/1234567";
window.APP_VERSION = "1.0.0";  // incrémenter à chaque release
```

## 3. Configurer les Edge Functions

Ajouter le secret dans Supabase :

```bash
supabase secrets set SENTRY_DSN="https://abc123@o456789.ingest.sentry.io/1234567"
```

Puis redéployer toutes les fonctions :

```bash
supabase functions deploy --no-verify-jwt
```

## Ce qui est monitoré

| Source | Ce qui est capturé |
|---|---|
| Frontend (toutes les pages) | Erreurs JS, promesses rejetées, perf (Core Web Vitals) |
| Shell.js | Erreurs globales window.onerror |
| Edge Functions | Exceptions non catchées (stripe-webhook, send-otp, analyze-kyc, etc.) |
| Session Replay | 5 % des sessions normales, 100 % des sessions avec erreur |

## Alertes recommandées

Dans Sentry → Alerts → créer :
- **Erreur critique** : toute erreur dans `stripe-webhook` ou `send-otp` → notification Slack/email immédiate
- **Volume** : > 10 erreurs/heure → email
- **Performance** : P95 LCP > 3s → email hebdo
