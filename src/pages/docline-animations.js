
// ── APPLE-STYLE ANIMATION ENGINE ────────────────────────────
var Animate = (function() {
  // Intersection observer for scroll-triggered animations
  var io = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold:0.08, rootMargin:'0px 0px -32px 0px' });

  function observeCards() {
    document.querySelectorAll('.card-enter').forEach(function(el) { io.observe(el); });
  }

  // Count-up animation for numbers
  function countUp(el, target, duration, prefix, suffix) {
    prefix = prefix || ''; suffix = suffix || ''; duration = duration || 800;
    var start = 0, startTime = null;
    var isFloat = target % 1 !== 0;
    function step(ts) {
      if (!startTime) startTime = ts;
      var progress = Math.min((ts - startTime) / duration, 1);
      var ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      var val = start + (target - start) * ease;
      el.textContent = prefix + (isFloat ? val.toFixed(2) : Math.floor(val).toLocaleString('fr-FR')) + suffix;
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = prefix + (isFloat ? target.toFixed(2) : target.toLocaleString('fr-FR')) + suffix;
    }
    requestAnimationFrame(step);
  }

  // Stagger children animations
  function stagger(parent, cls, delay) {
    cls = cls || 'anim-fade-up'; delay = delay || 60;
    var children = parent ? parent.querySelectorAll(':scope > *') : [];
    children.forEach(function(el, i) {
      el.classList.add(cls);
      el.style.animationDelay = (i * delay) + 'ms';
    });
  }

  // Topbar scroll effect
  function initScrollEffects() {
    var topbar = document.querySelector('.topbar');
    if (!topbar) return;
    var ticking = false;
    window.addEventListener('scroll', function() {
      if (!ticking) {
        requestAnimationFrame(function() {
          topbar.classList.toggle('scrolled', window.scrollY > 10);
          ticking = false;
        });
        ticking = true;
      }
    }, { passive:true });
  }

  // Mobile sidebar
  function initMobileSidebar() {
    var sidebar = document.querySelector('.sidebar');
    var btn = document.querySelector('.mobile-menu-btn');
    var backdrop = document.querySelector('.sidebar-backdrop');
    if (!sidebar || !btn) return;
    btn.addEventListener('click', function() {
      sidebar.classList.toggle('mobile-open');
      if (backdrop) backdrop.classList.toggle('show', sidebar.classList.contains('mobile-open'));
    });
    if (backdrop) backdrop.addEventListener('click', function() {
      sidebar.classList.remove('mobile-open');
      backdrop.classList.remove('show');
    });
  }

  // Page load stagger
  function initPageLoad() {
    // Stagger stat cards
    var statGrid = document.querySelector('.stat-grid');
    if (statGrid) {
      statGrid.querySelectorAll('.stat-card').forEach(function(card, i) {
        card.classList.add('card-enter');
        setTimeout(function() { card.classList.add('visible'); }, 80 + i * 60);
      });
    }
    // Stagger table rows
    var tbody = document.querySelector('tbody');
    if (tbody) {
      tbody.querySelectorAll('tr').forEach(function(row, i) {
        row.style.opacity = '0';
        row.style.transform = 'translateY(8px)';
        row.style.transition = 'opacity .35s var(--ease),transform .35s var(--ease)';
        setTimeout(function() { row.style.opacity = '1'; row.style.transform = 'none'; }, 100 + i * 30);
      });
    }
    observeCards();
    initScrollEffects();
    initMobileSidebar();
  }

  return { countUp:countUp, stagger:stagger, observeCards:observeCards, initPageLoad:initPageLoad };
})();

// Auto-init on DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() { Animate.initPageLoad(); });
