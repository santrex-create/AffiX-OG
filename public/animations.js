// =================================================================
// Affix-OG · Presentation-layer animation enhancements (additive only)
// Does not read/write telemetry state or alter any app.js behavior —
// purely handles scroll-reveal choreography and live-value pulses.
// =================================================================
(function () {
  'use strict';

  function initScrollReveal() {
    var selectors = [
      '.stat-card',
      '.story-grid',
      '.about-grid > *',
      '.history-grid > *',
      '.ai-grid > *',
      '.acknowledgement-grid > *',
      '.technology-card',
      '.contact-form'
    ];
    var nodes = new Set();
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) { nodes.add(el); });
    });

    if (!('IntersectionObserver' in window) || nodes.size === 0) {
      nodes.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    nodes.forEach(function (el, i) {
      el.classList.add('reveal');
      el.style.transitionDelay = Math.min(i % 6, 5) * 0.06 + 's';
      observer.observe(el);
    });
  }

  // Re-check reveal state whenever a page becomes active (SPA navigation),
  // since elements inside display:none containers can't be measured until shown.
  function observePageSwitches() {
    var appContent = document.getElementById('appContent');
    if (!appContent) return;
    var mo = new MutationObserver(function () {
      document.querySelectorAll('.reveal:not(.is-visible)').forEach(function (el) {
        var rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          el.classList.add('is-visible');
        }
      });
    });
    mo.observe(appContent, { attributes: true, attributeFilter: ['class'], subtree: true });
  }

  // Subtle "value updated" pulse on live clinical readouts — mirrors the way
  // real ICU monitors flash a reading briefly on refresh, without touching
  // the underlying update logic in app.js.
  function initValuePulse() {
    var ids = ['valSpo2', 'valHR', 'valTemp', 'valHRV', 'valSnore', 'valApnea', 'valRoom', 'valHumid', 'valScore', 'valBatt'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var timer = null;
      var mo = new MutationObserver(function () {
        el.classList.remove('pulse-update');
        // Force reflow so the animation can restart on rapid updates
        void el.offsetWidth;
        el.classList.add('pulse-update');
        clearTimeout(timer);
        timer = setTimeout(function () { el.classList.remove('pulse-update'); }, 650);
      });
      mo.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initScrollReveal();
    observePageSwitches();
    initValuePulse();
  });
})();
