// Sentry error monitoring — loaded on every page
// DSN is injected via window.SENTRY_DSN (set in sentry-config.js)
(function () {
  const DSN = window.SENTRY_DSN || "";
  if (!DSN || typeof Sentry === "undefined") return;

  Sentry.init({
    dsn: DSN,
    environment: window.location.hostname === "localhost" ? "development" : "production",
    release: window.APP_VERSION || "1.0.0",
    tracesSampleRate: 0.2,        // 20 % des sessions pour perf monitoring
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,       // RGPD : masque le texte par défaut
        blockAllMedia: true,
      }),
    ],
    beforeSend(event) {
      // Ne pas envoyer les erreurs réseau bénignes (offline)
      if (event.exception) {
        const msg = event.exception.values?.[0]?.value || "";
        if (/NetworkError|Failed to fetch|Load failed/i.test(msg)) return null;
      }
      return event;
    },
  });

  // Tag utilisateur (anonymisé — email hashé)
  const session = JSON.parse(localStorage.getItem("sb-session") || "{}");
  const uid = session?.user?.id;
  if (uid) {
    Sentry.setUser({ id: uid });
  }
})();
