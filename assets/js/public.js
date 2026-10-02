/* Agraz Family — public site interactions */
(function () {
  'use strict';

  // Clickjacking guard: GitHub Pages can't send frame-ancestors, so hide the page
  // if it's framed by a different origin (never navigates the top frame).
  try { if (self !== top && top.location.origin !== self.location.origin) document.documentElement.style.visibility = 'hidden'; }
  catch (e) { document.documentElement.style.visibility = 'hidden'; }

  // Old links like agrazfamily.com/#memories now live in the private hub.
  var legacy = { memories: 'photos', events: 'calendar', updates: 'updates', memorial: 'memorial' };
  var h = location.hash.slice(1);
  if (legacy[h]) { location.replace('/family/#' + legacy[h]); return; }

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- the front porch comes first ----------
     Every way into the Family Hub passes through this page once per visit. The hub sends people
     here with its intended page in the hash (#enter=<hash>), which never reaches any server; we
     remember the visit, clear it from the address bar and carry it on the Family Login buttons. */
  try { sessionStorage.setItem('agraz-seen-public', '1'); } catch (e) {}
  (function () {
    var m = /^#enter=(.*)$/.exec(location.hash);
    if (!m) return;
    var dest = '';
    try { dest = decodeURIComponent(m[1]); } catch (e) {}
    if (!/^#[\w?=&%.:+-]*$/.test(dest)) dest = '';
    history.replaceState(null, '', location.pathname + location.search);
    if (!dest || dest === '#' || dest === '#home') return;
    document.querySelectorAll('a[href^="/family/"]').forEach(function (a) { a.setAttribute('href', '/family/' + dest); });
    // a quiet way on, once they've had a look around
    var bar = document.createElement('a');
    bar.className = 'btn btn-light hub-continue';
    bar.href = '/family/' + dest;
    bar.textContent = 'Continue to the Family Hub →';
    try {
      var css = new CSSStyleSheet();
      css.replaceSync('.hub-continue{position:fixed;right:18px;bottom:18px;z-index:80;box-shadow:0 18px 40px -16px rgba(0,0,0,.55);animation:hubContinueIn .9s cubic-bezier(.16,1,.3,1) 1.6s both}@keyframes hubContinueIn{from{opacity:0;transform:translateY(16px)}}@media(prefers-reduced-motion:reduce){.hub-continue{animation:none}}');
      document.adoptedStyleSheets = document.adoptedStyleSheets.concat(css);
    } catch (e) {}
    document.body.appendChild(bar);
  })();

  /* ---------- the hero follows the sun (photo chosen + preloaded in <head>) ---------- */
  var hero = document.getElementById('hero-img');
  if (hero && window.__heroUrl) {
    var u = window.__heroUrl;
    hero.srcset = [800, 1600, 2400].map(function (w) { return u + w + ' ' + w + 'w'; }).join(', ');
    hero.src = u + '1600';
  }
  var root = document.documentElement;

  /* ---------- theme ---------- */
  function effectiveTheme() {
    var t = root.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('agraz-theme', next); } catch (e) {}
    });
  });

  /* ---------- header ---------- */
  var header = document.querySelector('.site-header');
  function onScroll() { header.classList.toggle('scrolled', window.scrollY > 40); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- mobile menu ---------- */
  var menuBtn = document.getElementById('menu-btn');
  var menu = document.getElementById('mobile-menu');
  var menuIcon = menuBtn.querySelector('use');
  function setMenu(open) {
    menu.hidden = !open;
    document.body.classList.toggle('menu-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menuIcon.setAttribute('href', menuIcon.getAttribute('href').replace(/#.*$/, '#') + (open ? 'x' : 'menu'));
  }
  menuBtn.addEventListener('click', function () { setMenu(menu.hidden); });
  menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuBtn.focus(); } });
  window.addEventListener('resize', function () { if (window.innerWidth > 900 && !menu.hidden) setMenu(false); });

  /* ---------- reveal on scroll ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if (REDUCED || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.14, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ---------- active section in nav ---------- */
  var links = {};
  document.querySelectorAll('.site-nav a[href^="#"]').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
  if ('IntersectionObserver' in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        Object.keys(links).forEach(function (k) { links[k].classList.toggle('active', k === en.target.id); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(links).forEach(function (id) { var el = document.getElementById(id); if (el) spy.observe(el); });
  }

  /* ---------- gentle parallax on the story photo ---------- */
  var par = document.querySelector('[data-parallax]');
  if (par && !REDUCED) {
    var ticking = false;
    var update = function () {
      ticking = false;
      var r = par.parentElement.getBoundingClientRect();
      var vh = window.innerHeight;
      if (r.bottom < 0 || r.top > vh) return;
      var p = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2); // -1 … 1
      par.style.transform = 'translate3d(0,' + (p * -6).toFixed(2) + '%,0)';
    };
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  /* ---------- misc ---------- */
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
