// Docline i18n — FR / EN / DE
// Usage: i18n.t('key') — returns string in current language
// i18n.setLang('fr') — switches language and re-renders
var i18n = (function() {
  var _lang = localStorage.getItem('docline-lang') || 'en';

  var _strings = {
    en: {
      // Nav
      nav_features: 'Features', nav_how: 'How it works', nav_pricing: 'Pricing',
      nav_cta: 'Get started free →',
      // Hero
      hero_badge: 'Now with Nex AI — your business advisor',
      hero_title1: 'Run your freelance',
      hero_title2: 'business from one place',
      hero_sub: 'CRM, EU-compliant invoicing, e-signatures, and an AI advisor built for European freelancers. Everything HoneyBook does — at 30× the price — you get here for €12/month.',
      hero_btn1: 'Start for free',
      hero_btn2: 'See what\'s inside',
      // Trust
      trust_gdpr: 'GDPR compliant', trust_eu: 'Data in Frankfurt EU',
      trust_esign: 'eIDAS e-signatures', trust_card: 'No credit card needed',
      // Stats
      stat_users: 'Beta users signed up', stat_margin: 'Gross margin',
      stat_price: 'Pro plan per month', stat_saved: 'Saved per new client',
      // Section labels
      features_eyebrow: 'Everything you need',
      features_title: 'Built for how European freelancers actually work',
      features_sub: 'Every tool, every feature — designed specifically for EU tax rules, GDPR compliance, and the way freelancers invoice clients.',
      // Features
      feat1_title: 'EU-compliant invoicing', feat1_desc: 'HT, TVA, TTC auto-calculated. French legal mentions. PDF export. Payment reminders. Auto-generated when contracts are signed.',
      feat2_title: 'Smart Files + E-Signatures', feat2_desc: 'One link with your proposal, contract, and invoice. Client reviews, signs electronically, and you\'re paid — without leaving the page.',
      feat3_title: 'Nex — AI business advisor', feat3_desc: 'Ask about your pipeline, generate client emails, get EU tax advice, understand your cash flow. Nex knows your business data in real time.',
      feat4_title: 'Pipeline CRM', feat4_desc: 'Kanban board with your full project lifecycle. See the value at each stage.',
      feat5_title: 'Client portal', feat5_desc: 'Share a branded link with your client. They see their invoices, sign contracts, and track project status — no account needed.',
      feat6_title: 'Workflow automation', feat6_desc: 'Contract signed → invoice created → reminder sent. Two-click automation that runs while you sleep.',
      // How it works
      how_eyebrow: 'Simple by design',
      how_title: 'From sign-up to first invoice in 4 steps',
      step1_title: 'Create your account', step1_desc: 'Sign up with email or Google. No credit card. Takes 30 seconds.',
      step2_title: 'Add your first client', step2_desc: 'Import from CSV or add manually. Your pipeline is ready instantly.',
      step3_title: 'Create a Smart File', step3_desc: 'Pick a contract template, add your services and pricing, generate the link.',
      step4_title: 'Client signs, you get paid', step4_desc: 'They sign electronically. Invoice is created automatically. Done.',
      // AI section
      ai_eyebrow: 'Meet Nex',
      ai_title: 'Your AI advisor who actually knows your business',
      ai_sub: 'Nex sees your real pipeline, your overdue invoices, your tasks due today. Ask anything — and get answers that are actually useful.',
      // Pricing
      pricing_eyebrow: 'Simple pricing',
      pricing_title: 'Start free. Upgrade when you\'re ready.',
      plan_free: 'Free', plan_pro: 'Pro',
      plan_free_per: 'forever', plan_pro_per: 'per month · billed monthly',
      // CTA
      cta_title: 'Your business deserves better than spreadsheets',
      cta_sub: 'Join European freelancers who run their entire business from one place. Free to start. No credit card.',
      cta_btn: 'Start for free today',
      cta_note: 'GDPR compliant · Data in Frankfurt EU · Cancel anytime',
      // Dashboard
      dash_greeting_am: 'Good morning',
      dash_greeting_pm: 'Good afternoon',
      dash_greeting_ev: 'Good evening',
      dash_greeting_sub: "Here's what's happening with your business today.",
      dash_pipeline_value: 'Pipeline value', dash_active: 'active',
      dash_revenue: 'Revenue this month', dash_paid: 'paid',
      dash_deals_won: 'Deals won',
      dash_due_today: 'Due today',
      dash_new_client: 'New client', dash_new_deal: 'New deal',
      dash_create_invoice: 'Create invoice', dash_smart_file: 'Smart File',
      // AI
      nex_placeholder: 'Ask Nex anything...',
      nex_welcome: 'Hi, I am Nex — your Docline business advisor. I can help you with:\n\n- EU invoicing rules (TVA, reverse charge)\n- French freelance taxation\n- Pricing strategy and client negotiation\n- Cash flow and business strategy\n\nWhat can I help you with today?',
      // Import
      import_title: 'Import your clients',
      import_sub: 'Upload a CSV or Excel file from your current tool. We\'ll detect the columns automatically.',
      import_btn: 'Choose file',
      import_drag: 'Drop your file here or click to browse',
      import_formats: 'Supports: CSV, XLS, XLSX from HubSpot, Notion, Excel, Google Sheets',
    },
    fr: {
      nav_features: 'Fonctionnalités', nav_how: 'Comment ça marche', nav_pricing: 'Tarifs',
      nav_cta: 'Commencer gratuitement →',
      hero_badge: 'Maintenant avec Nex AI — votre conseiller business',
      hero_title1: 'Gérez votre activité freelance',
      hero_title2: 'depuis un seul endroit',
      hero_sub: 'CRM, facturation HT/TVA/TTC, signatures électroniques et un conseiller IA conçu pour les freelances européens. Tout ce que fait HoneyBook — à 30× le prix — pour 12 €/mois.',
      hero_btn1: 'Commencer gratuitement',
      hero_btn2: 'Voir les fonctionnalités',
      trust_gdpr: 'Conforme RGPD', trust_eu: 'Données à Francfort EU',
      trust_esign: 'Signatures eIDAS', trust_card: 'Sans carte bancaire',
      stat_users: 'Utilisateurs bêta inscrits', stat_margin: 'Marge brute',
      stat_price: 'Plan Pro par mois', stat_saved: 'Économisés par nouveau client',
      features_eyebrow: 'Tout ce dont vous avez besoin',
      features_title: 'Conçu pour la façon de travailler des freelances européens',
      features_sub: 'Chaque outil, chaque fonctionnalité — pensé pour les règles fiscales européennes, la conformité RGPD et la facturation freelance.',
      feat1_title: 'Facturation UE conforme', feat1_desc: 'HT, TVA, TTC calculés automatiquement. Mentions légales françaises. Export PDF. Relances automatiques.',
      feat2_title: 'Smart Files + Signatures', feat2_desc: 'Un lien avec votre devis, contrat et facture. Le client signe électroniquement et vous êtes payé.',
      feat3_title: 'Nex — Conseiller IA', feat3_desc: 'Interrogez votre pipeline, rédigez des emails clients, obtenez des conseils fiscaux EU en temps réel.',
      feat4_title: 'CRM Pipeline', feat4_desc: 'Tableau kanban avec votre cycle de vie projet complet. Voyez la valeur à chaque étape.',
      feat5_title: 'Portail client', feat5_desc: 'Un lien sécurisé pour votre client. Il voit ses factures, signe les contrats, sans créer de compte.',
      feat6_title: 'Automatisation', feat6_desc: 'Contrat signé → facture créée → relance envoyée. Fonctionne pendant que vous dormez.',
      how_eyebrow: 'Simple par conception',
      how_title: 'De l\'inscription à la première facture en 4 étapes',
      step1_title: 'Créez votre compte', step1_desc: 'Inscrivez-vous par email ou Google. Sans CB. En 30 secondes.',
      step2_title: 'Ajoutez votre premier client', step2_desc: 'Importez depuis un CSV ou ajoutez manuellement. Votre pipeline est prêt.',
      step3_title: 'Créez un Smart File', step3_desc: 'Choisissez un modèle de contrat, ajoutez vos services et générez le lien.',
      step4_title: 'Le client signe, vous êtes payé', step4_desc: 'Il signe électroniquement. La facture est créée automatiquement.',
      ai_eyebrow: 'Découvrez Nex',
      ai_title: 'Votre conseiller IA qui connaît vraiment votre activité',
      ai_sub: 'Nex voit votre pipeline en temps réel, vos factures en retard, vos tâches du jour. Posez n\'importe quelle question.',
      pricing_eyebrow: 'Tarification simple',
      pricing_title: 'Commencez gratuitement. Passez Pro quand vous êtes prêt.',
      plan_free: 'Gratuit', plan_pro: 'Pro',
      plan_free_per: 'pour toujours', plan_pro_per: 'par mois · facturé mensuellement',
      cta_title: 'Votre activité mérite mieux que des tableurs',
      cta_sub: 'Rejoignez les freelances européens qui gèrent toute leur activité depuis un seul endroit.',
      cta_btn: 'Commencer gratuitement',
      cta_note: 'Conforme RGPD · Données à Francfort EU · Résiliable à tout moment',
      dash_greeting_am: 'Bonjour', dash_greeting_pm: 'Bon après-midi', dash_greeting_ev: 'Bonsoir',
      dash_greeting_sub: 'Voici ce qui se passe dans votre activité aujourd\'hui.',
      dash_pipeline_value: 'Valeur pipeline', dash_active: 'actifs',
      dash_revenue: 'Revenus ce mois', dash_paid: 'payés',
      dash_deals_won: 'Contrats gagnés', dash_due_today: 'À faire aujourd\'hui',
      dash_new_client: 'Nouveau client', dash_new_deal: 'Nouveau deal',
      dash_create_invoice: 'Créer une facture', dash_smart_file: 'Smart File',
      nex_placeholder: 'Demandez à Nex...',
      nex_welcome: 'Bonjour, je suis Nex — votre conseiller Docline. Je peux vous aider avec :\n\n- Règles de facturation EU (TVA, autoliquidation)\n- Fiscalité des freelances français (auto-entrepreneur, SAS...)\n- Stratégie de prix et négociation client\n- Trésorerie et stratégie business\n\nQue puis-je faire pour vous ?',
      import_title: 'Importez vos clients',
      import_sub: 'Téléchargez un fichier CSV ou Excel depuis votre outil actuel. Nous détecterons les colonnes automatiquement.',
      import_btn: 'Choisir un fichier',
      import_drag: 'Déposez votre fichier ici ou cliquez pour parcourir',
      import_formats: 'Formats supportés : CSV, XLS, XLSX depuis HubSpot, Notion, Excel, Google Sheets',
    },
    de: {
      nav_features: 'Funktionen', nav_how: 'So funktioniert\'s', nav_pricing: 'Preise',
      nav_cta: 'Kostenlos starten →',
      hero_badge: 'Jetzt mit Nex KI — Ihr Business-Berater',
      hero_title1: 'Führen Sie Ihr Freelance-',
      hero_title2: 'Geschäft von einem Ort aus',
      hero_sub: 'CRM, EU-konforme Rechnungsstellung, E-Signaturen und ein KI-Berater für europäische Freelancer. Alles was HoneyBook kann — für 12 €/Monat.',
      hero_btn1: 'Kostenlos starten',
      hero_btn2: 'Funktionen ansehen',
      trust_gdpr: 'DSGVO-konform', trust_eu: 'Daten in Frankfurt EU',
      trust_esign: 'eIDAS E-Signaturen', trust_card: 'Keine Kreditkarte nötig',
      stat_users: 'Beta-Nutzer angemeldet', stat_margin: 'Bruttomarge',
      stat_price: 'Pro-Plan pro Monat', stat_saved: 'Gespart pro Neukunde',
      features_eyebrow: 'Alles was Sie brauchen',
      features_title: 'Für die Arbeitsweise europäischer Freelancer entwickelt',
      features_sub: 'Jedes Tool, jede Funktion — speziell für EU-Steuerregeln, DSGVO-Konformität und Freelancer-Rechnungsstellung.',
      feat1_title: 'EU-konforme Rechnungsstellung', feat1_desc: 'Netto, MwSt., Brutto automatisch berechnet. Rechtliche Pflichtangaben. PDF-Export. Zahlungserinnerungen.',
      feat2_title: 'Smart Files + E-Signaturen', feat2_desc: 'Ein Link mit Angebot, Vertrag und Rechnung. Kunde prüft, unterschreibt und Sie werden bezahlt.',
      feat3_title: 'Nex — KI-Berater', feat3_desc: 'Fragen Sie nach Ihrer Pipeline, generieren Sie E-Mails, erhalten Sie EU-Steuerberatung in Echtzeit.',
      feat4_title: 'Pipeline CRM', feat4_desc: 'Kanban-Board mit vollem Projektlebenszyklus. Sehen Sie den Wert in jeder Phase.',
      feat5_title: 'Kundenportal', feat5_desc: 'Sicherer Link für Ihren Kunden. Er sieht Rechnungen, unterschreibt Verträge — ohne Konto.',
      feat6_title: 'Workflow-Automatisierung', feat6_desc: 'Vertrag unterschrieben → Rechnung erstellt → Erinnerung gesendet. Läuft automatisch.',
      how_eyebrow: 'Einfach per Design',
      how_title: 'Von der Anmeldung zur ersten Rechnung in 4 Schritten',
      step1_title: 'Konto erstellen', step1_desc: 'Mit E-Mail oder Google anmelden. Keine Kreditkarte. In 30 Sekunden.',
      step2_title: 'Ersten Kunden hinzufügen', step2_desc: 'CSV importieren oder manuell hinzufügen. Ihre Pipeline ist sofort bereit.',
      step3_title: 'Smart File erstellen', step3_desc: 'Vertragsvorlage wählen, Leistungen und Preise hinzufügen, Link generieren.',
      step4_title: 'Kunde unterschreibt, Sie werden bezahlt', step4_desc: 'Elektronische Unterschrift. Rechnung wird automatisch erstellt.',
      ai_eyebrow: 'Lernen Sie Nex kennen',
      ai_title: 'Ihr KI-Berater der Ihr Geschäft wirklich kennt',
      ai_sub: 'Nex sieht Ihre Pipeline in Echtzeit, überfällige Rechnungen, heutige Aufgaben. Stellen Sie jede Frage.',
      pricing_eyebrow: 'Einfache Preisgestaltung',
      pricing_title: 'Kostenlos starten. Upgraden wenn Sie bereit sind.',
      plan_free: 'Kostenlos', plan_pro: 'Pro',
      plan_free_per: 'für immer', plan_pro_per: 'pro Monat · monatlich abgerechnet',
      cta_title: 'Ihr Geschäft verdient mehr als Tabellenkalkulationen',
      cta_sub: 'Schließen Sie sich europäischen Freelancern an, die ihr gesamtes Geschäft von einem Ort aus führen.',
      cta_btn: 'Heute kostenlos starten',
      cta_note: 'DSGVO-konform · Daten in Frankfurt EU · Jederzeit kündbar',
      dash_greeting_am: 'Guten Morgen', dash_greeting_pm: 'Guten Nachmittag', dash_greeting_ev: 'Guten Abend',
      dash_greeting_sub: 'Hier ist, was heute in Ihrem Geschäft passiert.',
      dash_pipeline_value: 'Pipeline-Wert', dash_active: 'aktiv',
      dash_revenue: 'Umsatz diesen Monat', dash_paid: 'bezahlt',
      dash_deals_won: 'Gewonnene Aufträge', dash_due_today: 'Heute fällig',
      dash_new_client: 'Neuer Kunde', dash_new_deal: 'Neuer Deal',
      dash_create_invoice: 'Rechnung erstellen', dash_smart_file: 'Smart File',
      nex_placeholder: 'Fragen Sie Nex...',
      nex_welcome: 'Hallo, ich bin Nex — Ihr Docline-Berater. Ich kann Ihnen helfen mit:\n\n- EU-Rechnungsregeln (MwSt., Reverse Charge)\n- Deutscher Freelancer-Steuer (Freiberufler, Kleinunternehmer)\n- Preisstrategie und Kundenverhandlung\n- Cashflow und Business-Strategie\n\nWie kann ich Ihnen heute helfen?',
      import_title: 'Kunden importieren',
      import_sub: 'Laden Sie eine CSV- oder Excel-Datei von Ihrem aktuellen Tool hoch. Wir erkennen die Spalten automatisch.',
      import_btn: 'Datei auswählen',
      import_drag: 'Datei hier ablegen oder klicken zum Durchsuchen',
      import_formats: 'Unterstützt: CSV, XLS, XLSX von HubSpot, Notion, Excel, Google Sheets',
    }
  };

  function t(key) {
    var lang = _strings[_lang] || _strings.en;
    return lang[key] || _strings.en[key] || key;
  }

  function setLang(lang) {
    if (!_strings[lang]) return;
    _lang = lang;
    localStorage.setItem('docline-lang', lang);
    // Re-render page if renderI18n function exists
    if (typeof renderI18n === 'function') renderI18n();
    // Update lang buttons
    document.querySelectorAll('.lang-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.lang === lang);
    });
  }

  function getLang() { return _lang; }

  function initLangSwitcher(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = ['en','fr','de'].map(function(l) {
      var flags = {en:'🇬🇧',fr:'🇫🇷',de:'🇩🇪'};
      var labels = {en:'EN',fr:'FR',de:'DE'};
      return '<button class="lang-btn'+(l===_lang?' active':'')+'" data-lang="'+l+'" onclick="i18n.setLang(\''+l+'\')" title="'+l.toUpperCase()+'">'+flags[l]+' '+labels[l]+'</button>';
    }).join('');
  }

  return { t: t, setLang: setLang, getLang: getLang, initLangSwitcher: initLangSwitcher };
})();
