/* ==========================================================================
   Agraz Family — signature moments (both pages)
   · the arrival: the A drawn in light becomes the horizon (once a session)
   · light that knows the hour, and the living ocean on the sign-in photo
   · en agraz: a vine across Our Name whose grapes ripen as you read
   · the living shoreline, and a few small graces for the pointer
   · threads of light between the family in the Family Tree
   Everything is decoration (aria-hidden, no pointer events) layered over the
   pages' own markup; with reduced motion it simply holds still, complete.
   ========================================================================== */
(function () {
  'use strict';

  const root = document.documentElement;
  const NS = 'http://www.w3.org/2000/svg';
  const mq = q => window.matchMedia && window.matchMedia(q).matches;
  const REDUCED = mq('(prefers-reduced-motion: reduce)');
  const BOT = !!navigator.webdriver; // automated test browsers: no motion to wait on
  const MOTION = !REDUCED && !BOT;
  const FINE = mq('(hover: hover) and (pointer: fine)');
  const V = (() => { try { return new URL(document.currentScript.src).search; } catch (e) { return ''; } })();
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const f1 = n => (Math.round(n * 10) / 10).toString();
  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  function div(cls, parent) {
    const el = document.createElement('div');
    el.className = cls;
    el.setAttribute('aria-hidden', 'true');
    if (parent) parent.appendChild(el);
    return el;
  }
  // a small seeded random, so the vine grows the same way on every visit
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // smooth path through points (Catmull–Rom as cubic Béziers)
  function smooth(P) {
    let d = `M${f1(P[0][0])} ${f1(P[0][1])}`;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
      d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
    }
    return d;
  }
  // run fn while el is on screen and the tab is visible
  function whileVisible(el, on, off) {
    let seen = false;
    const sync = () => { if (seen && !document.hidden) on(); else off(); };
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { seen = es[es.length - 1].isIntersecting; sync(); }).observe(el);
    else seen = true;
    document.addEventListener('visibilitychange', sync);
    sync();
  }
  root.classList.add('sg');

  /* =====================================================================
     The hour: where the light comes from and what colour it is
     ===================================================================== */
  const HOUR_STOPS = [ // through the photos' day, 5:30 → 20:00
    [0, [255, 158, 150]], [0.1, [255, 178, 158]], [0.24, [255, 208, 164]], [0.4, [255, 236, 206]],
    [0.6, [255, 240, 214]], [0.76, [255, 206, 140]], [0.9, [255, 160, 96]], [1, [250, 128, 92]]
  ];
  function hour(d) {
    d = d || new Date();
    const t = d.getHours() + d.getMinutes() / 60;
    const day = (t - 5.5) / 14.5;
    if (day >= 0 && day <= 1) {
      let i = 0;
      while (i < HOUR_STOPS.length - 2 && day > HOUR_STOPS[i + 1][0]) i++;
      const [a, ca] = HOUR_STOPS[i], [b, cb] = HOUR_STOPS[i + 1], k = clamp((day - a) / (b - a), 0, 1);
      const elev = Math.sin(Math.PI * day);
      return { night: false, az: day, elev, rgb: ca.map((c, j) => Math.round(lerp(c, cb[j], k))), a: lerp(0.42, 0.26, elev) };
    }
    const n = (((t - 20) % 24) + 24) % 24 / 9.5; // the moon crosses from 8pm to 5:30am
    return { night: true, az: clamp(n, 0, 1), elev: Math.sin(Math.PI * clamp(n, 0, 1)), rgb: [190, 208, 255], a: 0.34 };
  }

  // A warm light leak over a photo: a glow from where the sun (or moon) is, two soft rays
  // reaching into the frame, and the faint ghosts a lens makes. It moves with the clock.
  function hourLight(host) {
    if (!host || $('.sg-light', host)) return;
    const box = div('sg-light', host);
    const glow = document.createElement('i'), rays = [document.createElement('i'), document.createElement('i')], ghosts = [0, 1, 2].map(() => document.createElement('i'));
    glow.className = 'sg-l-glow';
    rays.forEach(r => { r.className = 'sg-l-ray'; });
    ghosts.forEach(g => { g.className = 'sg-l-ghost'; });
    box.append(glow, ...rays, ...ghosts);
    const paint = () => {
      const W = host.offsetWidth, H = host.offsetHeight;
      if (!W || !H) return;
      const h = hour(), c = h.rgb.join(','), narrow = W < 700, A = h.a * (narrow ? 0.6 : 1), al = v => (Math.round(v * 1000) / 1000).toString();
      // morning light from the left (east), evening from the right; high at noon, low at the ends of the day
      const sx = h.night ? W * lerp(0.7, 0.98, h.az) : W * lerp(-0.16, 1.16, h.az);
      const sy = h.night ? H * lerp(-0.02, -0.16, h.elev) : H * lerp(0.5, -0.3, h.elev);
      const R = Math.hypot(W, H) * (h.night ? 0.5 : 0.6);
      glow.style.background = `radial-gradient(circle at ${f1(sx)}px ${f1(sy)}px, rgba(${c},${al(A)}) 0, rgba(${c},${al(A * 0.45)}) ${f1(R * 0.14)}px, rgba(${c},${al(A * 0.12)}) ${f1(R * 0.4)}px, rgba(${c},0) ${f1(R)}px)`;
      // two long soft streaks through the light, pointing into the frame
      const cx = W * 0.5, cy = H * 0.56, ang = Math.atan2(cy - sy, cx - sx), len = Math.hypot(W, H) * 1.5;
      rays.forEach((r, i) => {
        const th = (i ? 0.11 : 0.06) * H + 24;
        r.style.width = f1(len * 2) + 'px';
        r.style.height = f1(th) + 'px';
        r.style.translate = `${f1(sx - len)}px ${f1(sy - th / 2)}px`;
        r.style.rotate = f1((ang + (i ? -0.12 : 0.05)) * 180 / Math.PI) + 'deg';
        r.style.background = `radial-gradient(ellipse 50% 50% at 50% 50%, rgba(${c},${al(A * (i ? 0.3 : 0.42))}), rgba(${c},${al(A * (i ? 0.08 : 0.12))}) 30%, rgba(${c},0) 70%)`;
        r.hidden = h.night && i === 1;
      });
      // a lens's faint ghosts on the line from the light through the middle — only when the sun is low
      const gs = [[1.3, 0.045, 0.2], [1.62, 0.1, 0.1], [2.0, 0.024, 0.26]], m = Math.min(W, H), low = !h.night && h.elev < 0.6 && !narrow;
      ghosts.forEach((g, i) => {
        const [k, r, a] = gs[i], gx = sx + (cx - sx) * k, gy = sy + (cy - sy) * k, rad = m * r;
        g.hidden = !low;
        g.style.width = g.style.height = f1(rad * 2) + 'px';
        g.style.translate = `${f1(gx - rad)}px ${f1(gy - rad)}px`;
        g.style.background = i === 1
          ? `radial-gradient(circle, rgba(${c},0) 55%, rgba(${c},${al(a * A)}) 67%, rgba(${c},0) 74%)`
          : `radial-gradient(circle, rgba(${c},${al(a * A)}), rgba(${c},0) 70%)`;
      });
      box.dataset.hour = h.night ? 'moon' : (h.az < 0.25 ? 'dawn' : h.az > 0.75 ? 'dusk' : 'day');
      box.style.setProperty('--sg-c', h.rgb.join(' '));
    };
    paint();
    requestAnimationFrame(() => box.classList.add('on'));
    if (window.ResizeObserver) { let t = 0; new ResizeObserver(() => { clearTimeout(t); t = setTimeout(paint, 150); }).observe(host); }
    setInterval(paint, 5 * 60 * 1000);
    whileVisible(host, () => box.classList.remove('sg-paused'), () => box.classList.add('sg-paused'));
    return box;
  }

  /* =====================================================================
     The arrival: the brand mark's A is drawn in one stroke of light; its
     wave becomes the horizon of the photo, and the light settles into it.
     ===================================================================== */
  const HORIZON = { dawn: 0.39, day: 0.535, dusk: 0.54, night: 0.695 }; // where the sea meets the sky in each photo
  function horizonFrac() {
    const v = parseFloat(getComputedStyle(root).getPropertyValue('--tod-horizon'));
    return Number.isFinite(v) ? v : (HORIZON[root.dataset.tod] || 0.54);
  }
  // y of the horizon inside `host`, for a photo drawn with `cover` at position posY in a box (top, w, h)
  function horizonY(box, posY, ratio) {
    const s = Math.max(box.w / (ratio * 1000), box.h / 1000), dh = 1000 * s, oy = (box.h - dh) * posY;
    return box.top + oy + dh * horizonFrac();
  }
  const posYOf = v => { const p = (v || '').split(/\s+/)[1] || '50%'; return /%$/.test(p) ? parseFloat(p) / 100 : 0.5; };

  function arrive(host, place) {
    const key = 'sg-arrived' + location.pathname;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) { return; }
    if (!MOTION || !host || !Element.prototype.animate) return;
    const W = host.offsetWidth, H = host.offsetHeight;
    if (!W || !H) return;
    const narrow = W < 640, p = place(W, H, narrow);
    const k = p.size / 42, X = u => p.cx + (u - 32) * k, Y = v => p.top + (v - 11) * k;
    const wrap = div('sg-arrive', host);
    wrap.style.setProperty('--sg-c', hour().rgb.join(' '));
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' }, wrap);
    const legs = svgEl('path', { d: `M${f1(X(13))} ${f1(Y(53))}L${f1(X(32))} ${f1(Y(11))}L${f1(X(51))} ${f1(Y(53))}`, pathLength: 1 }, svg);
    // the logo's wave, as one long line that starts life the size of the crossbar
    const A = 4 * k, hz = svgEl('g', {}, svg);
    const wave = svgEl('path', { d: `M0 0Q${f1(W / 8)} ${f1(-A)} ${f1(W / 4)} 0T${f1(W / 2)} 0T${f1(W * 0.75)} 0T${W} 0`, pathLength: 1 }, hz);
    const sun = svgEl('circle', { cx: f1(X(32)), cy: f1(Y(29.2)), r: f1(Math.max(2.4, 2.4 * k)) }, svg);
    const head = svgEl('circle', { cx: 0, cy: 0, r: 2.6 }, svg);
    const cw = 26.8 * k, sx0 = cw / W, hy = p.horizon;
    const T0 = `translate(${f1(X(18.6))}px, ${f1(Y(40.5))}px) scale(${sx0.toFixed(4)}, 1)`;
    const T1 = `translate(${f1(-W * 0.04)}px, ${f1(hy)}px) scale(1.08, .32)`;
    const ease = 'cubic-bezier(.65,0,.35,1)', run = [];
    const go = (el, kf, o) => { const a = el.animate(kf, Object.assign({ fill: 'both', easing: ease }, o)); run.push(a); return a; };
    go(legs, [{ strokeDasharray: '0 1' }, { strokeDasharray: '1 0' }], { duration: 520 });
    go(head, [{ transform: `translate(${f1(X(13))}px, ${f1(Y(53))}px)`, opacity: 1 }, { transform: `translate(${f1(X(32))}px, ${f1(Y(11))}px)`, opacity: 1, offset: 0.5 }, { transform: `translate(${f1(X(51))}px, ${f1(Y(53))}px)`, opacity: 0 }], { duration: 520 });
    go(sun, [{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(1.35)', offset: 0.6 }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 280, easing: 'ease-out' });
    go(wave, [{ strokeDasharray: '0 1' }, { strokeDasharray: '1 0' }], { duration: 260, delay: 380 });
    go(hz, [{ transform: T0 }, { transform: T1 }], { duration: 420, delay: 600, easing: 'cubic-bezier(.7,0,.2,1)' });
    // (the fades only hold their end, so they never cover the entrances before them)
    go(wave, [{ strokeWidth: 1.7, opacity: 1 }, { strokeWidth: 1.7 / 0.32, opacity: 1, offset: 0.62 }, { strokeWidth: 1.2 / 0.32, opacity: 0 }], { duration: 640, delay: 600, easing: 'ease-in-out', fill: 'forwards' });
    go(legs, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 620, fill: 'forwards' });
    go(sun, [{ opacity: 1 }, { opacity: 0 }], { duration: 320, delay: 640, easing: 'ease-in', fill: 'forwards' });
    let gone = false;
    const end = fast => {
      if (gone) return;
      gone = true;
      ['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach(t => window.removeEventListener(t, skip, true));
      if (!fast) { wrap.remove(); return; }
      wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).onfinish = () => wrap.remove();
    };
    const skip = () => end(true);
    ['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach(t => window.addEventListener(t, skip, { capture: true, passive: true }));
    setTimeout(() => end(false), 1260);
  }

  /* =====================================================================
     Public page
     ===================================================================== */
  function publicPage() {
    const hero = $('.hero');
    hourLight(hero);
    arrive(hero, (W, H, narrow) => {
      const img = $('#hero-img'), cs = img ? getComputedStyle(img) : null;
      const ratio = img && img.naturalWidth ? img.naturalWidth / img.naturalHeight : 1.5;
      // the photo is still settling (scale 1.1 → 1) when the light lands
      const y = horizonY({ top: 0, w: W, h: H }, posYOf(cs && cs.objectPosition), ratio);
      const size = narrow ? clamp(H * 0.16, 96, 150) : clamp(H * 0.25, 130, 230);
      return { cx: W * (narrow ? 0.5 : 0.72), top: H * (narrow ? 0.11 : 0.16), size, horizon: H / 2 + (y - H / 2) * 1.025 };
    });
    shoreline(hero);
    vine();
    if (FINE && MOTION) {
      lantern(hero);
      lantern($('#family-hub'));
      magnetic($$('.hero-ctas .btn, .hub-card .btn'));
      lean($('.mosaic'));
    }
  }

  // The edge of the hero is a shoreline: two layers of the logo's wave wash slowly past each other.
  function shoreline(hero) {
    if (!hero || !MOTION || !$('.hero-wave', hero)) return;
    const s = div('sg-shore', hero);
    s.append(document.createElement('i'), document.createElement('i'));
    hero.classList.add('sg-shore-on');
    whileVisible(hero, () => s.classList.remove('sg-paused'), () => s.classList.add('sg-paused'));
  }

  // A warm light that follows the pointer, like carrying a lamp across the photo.
  function lantern(host) {
    if (!host) return;
    const el = div('sg-lantern', host);
    let x = 0, y = 0, tx = 0, ty = 0, raf = 0, on = false;
    const step = () => {
      raf = 0;
      x += (tx - x) * 0.12; y += (ty - y) * 0.12;
      el.style.transform = `translate3d(${f1(x)}px, ${f1(y)}px, 0)`;
      if (Math.abs(tx - x) + Math.abs(ty - y) > 0.4) raf = requestAnimationFrame(step);
    };
    host.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      const r = host.getBoundingClientRect();
      tx = e.clientX - r.left; ty = e.clientY - r.top;
      if (!on) { on = true; x = tx; y = ty; el.classList.add('on'); }
      if (!raf) raf = requestAnimationFrame(step);
    }, { passive: true });
    host.addEventListener('pointerleave', () => { on = false; el.classList.remove('on'); });
  }

  // Buttons lean a little toward the pointer, and their icon a little further.
  function magnetic(els) {
    els.forEach(el => {
      const icon = $('.i', el);
      el.classList.add('sg-mag');
      el.addEventListener('pointermove', e => {
        if (e.pointerType !== 'mouse') return;
        const r = el.getBoundingClientRect(), dx = (e.clientX - r.left) / r.width - 0.5, dy = (e.clientY - r.top) / r.height - 0.5;
        el.classList.add('sg-near');
        el.style.translate = `${f1(dx * 12)}px ${f1(dy * 8)}px`;
        if (icon) icon.style.translate = `${f1(dx * 6)}px ${f1(dy * 4)}px`;
      }, { passive: true });
      el.addEventListener('pointerleave', () => { el.classList.remove('sg-near'); el.style.translate = ''; if (icon) icon.style.translate = ''; });
    });
  }

  // Photos in the mosaic turn gently toward the pointer; the picture inside drifts the other way.
  function lean(mosaic) {
    if (!mosaic) return;
    document.body.classList.add('sg-lean');
    let cur = null;
    const reset = m => { m.classList.remove('sg-leaning'); m.style.rotate = ''; const im = $('img', m); if (im) im.style.translate = ''; };
    mosaic.addEventListener('pointermove', e => {
      const m = e.target.closest && e.target.closest('.m');
      if (cur && cur !== m) reset(cur);
      cur = m;
      if (!m || e.pointerType !== 'mouse') return;
      const r = m.getBoundingClientRect(), nx = ((e.clientX - r.left) / r.width - 0.5) * 2, ny = ((e.clientY - r.top) / r.height - 0.5) * 2;
      const mag = Math.min(1, Math.hypot(nx, ny)), deg = (r.width > 480 ? 2.2 : 3.4) * mag;
      m.classList.add('sg-leaning');
      m.style.rotate = mag > 0.02 ? `${f1(-ny)} ${f1(nx)} 0 ${deg.toFixed(2)}deg` : '';
      const im = $('img', m);
      if (im) im.style.translate = `${f1(-nx * 7)}px ${f1(-ny * 7)}px`;
    }, { passive: true });
    mosaic.addEventListener('pointerleave', () => { if (cur) reset(cur); cur = null; });
  }

  /* =====================================================================
     En agraz — a vine along the top of Our Name. It grows as the section
     comes up the page, bears fruit, and the grapes ripen as you read: the
     oldest deep purple, each younger cluster a little greener, and the
     newest still green — still ripening, not yet all it will become.
     ===================================================================== */
  const LEAF = (() => { // a grape leaf, hanging from its stalk at (0,0), 100 units long
    const R = [[0, 17], [27, 5], [23, 27], [50, 33], [29, 49], [45, 76], [15, 69], [0, 100]];
    const L = R.slice(0, -1).reverse().map(([x, y]) => [-x, y]);
    const pts = R.concat(L.slice(0, -1)).concat([[0, 17]]);
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], mx = (ax + bx) / 2, my = (ay + by) / 2, nx = by - ay, ny = ax - bx, s = 0.16 * (i % 2 ? 1 : 0.5);
      // bulge each edge outward a little so the lobes look grown, not cut
      const out = (mx * nx + (my - 50) * ny) > 0 ? 1 : -1;
      d += `Q${f1(mx + nx * s * out)} ${f1(my + ny * s * out)} ${bx} ${by}`;
    }
    return { blade: d + 'Z', veins: 'M0 0V17M0 17Q1 50 0 88M0 24Q18 26 40 34M0 24Q-18 26 -40 34M0 44Q20 52 38 70M0 44Q-20 52 -38 70' };
  })();

  function vine() {
    const sec = $('#name');
    if (!sec || !window.CSS) return;
    const svg = svgEl('svg', { class: 'sg-vine', 'aria-hidden': 'true', focusable: 'false' });
    sec.prepend(svg);
    const sda = MOTION && CSS.supports('animation-timeline: view()') && CSS.supports('animation-range: contain 10% contain 20%');
    if (MOTION) svg.classList.add(sda ? 'sg-sda' : 'sg-scrub');
    let lastW = 0;
    const build = () => {
      const W = sec.clientWidth, pad = parseFloat(getComputedStyle(sec).paddingTop) || 100;
      if (!W || W === lastW) return;
      lastW = W;
      grow(svg, W, clamp(pad - 6, 64, 168));
    };
    build();
    if (window.ResizeObserver) { let t = 0; new ResizeObserver(() => { clearTimeout(t); t = setTimeout(build, 160); }).observe(sec); }
    if (MOTION && !sda) {
      // no scroll timelines: scrub the same animations from the scroll position
      let raf = 0, live = false;
      const tick = () => {
        raf = 0;
        const r = svg.getBoundingClientRect(), vh = window.innerHeight, span = Math.max(1, vh - r.height);
        svg.style.setProperty('--sgp', clamp((vh - r.height - r.top) / span, -1, 3).toFixed(4));
      };
      const onScroll = () => { if (live && !raf) raf = requestAnimationFrame(tick); };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
      whileVisible(sec, () => { live = true; onScroll(); }, () => { live = false; });
      tick();
    }
  }

  function grow(svg, W, H) {
    const rnd = rng(W < 640 ? 7 : 11), u = H / 150, R = (a, b) => lerp(a, b, rnd());
    while (svg.firstChild) svg.firstChild.remove();
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    const narrow = W < 640, y0 = Math.max(12, 18 * u), xe = W * (narrow ? 0.9 : 0.88);
    const ph1 = R(0, 6), ph2 = R(0, 6);
    const yAt = x => y0 + 5.5 * u * Math.sin(x / (170 * u) + ph1) + 2.2 * u * Math.sin(x / (57 * u) + ph2);
    const DRAW = [0.0, 0.46]; // the stem grows over this part of the timeline
    const at = x => lerp(DRAW[0], DRAW[1], clamp((x + 16) / (xe + 16), 0, 1));
    const range = (el, a, b) => { el.style.setProperty('--a', a.toFixed(4)); el.style.setProperty('--b', b.toFixed(4)); el.style.setProperty('--d', (1 / Math.max(0.001, b - a)).toFixed(4)); };
    const g = svgEl('g', {}, svg);
    const back = svgEl('g', {}, g), front = svgEl('g', {}, g);

    // the stem, ending in a curl
    const P = [];
    for (let x = -16; x < xe; x += 44) P.push([x, yAt(x)]);
    const ex = xe, ey = yAt(xe);
    P.push([ex, ey]);
    const cr = 9 * Math.max(u, 0.7);
    for (let i = 1; i <= 7; i++) { const a = -Math.PI / 2 + i * 0.85, r = cr * (1 - i / 9); P.push([ex + 6 * u + Math.cos(a) * r, ey + cr * 0.6 + Math.sin(a) * r]); }
    const stem = svgEl('path', { class: 'sg-stem sg-v', d: smooth(P), pathLength: 1 }, back);
    range(stem, DRAW[0], DRAW[1] + 0.04);

    const tendril = (x, y, dir, size) => {
      const T = [[x, y]], c = size * u;
      for (let i = 1; i <= 9; i++) { const a = i * 0.72, r = c * (1.1 - i / 10); T.push([x + dir * (c * 0.9 + Math.sin(a) * r * 0.8 - i * 0.4), y + c * 0.5 + i * c * 0.12 - Math.cos(a) * r * 0.6]); }
      const t = svgEl('path', { class: 'sg-tendril sg-v', d: smooth(T), pathLength: 1 }, back);
      const s = at(x);
      range(t, s, s + 0.07);
    };
    const leaf = (x, y, rot, size, parent) => {
      const o = svgEl('g', { transform: `translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)}) scale(${(size * u / 100).toFixed(4)})` }, parent || back);
      const l = svgEl('g', { class: 'sg-leaf sg-v' }, o);
      svgEl('path', { d: LEAF.blade }, l);
      svgEl('path', { d: LEAF.veins }, l);
      const s = at(x);
      range(l, s - 0.01, s + 0.075);
    };

    // clusters: the eldest on the old wood, the newest by the growing tip
    const n = W < 560 ? 3 : W < 1000 ? 4 : W < 1700 ? 5 : 6;
    const TARGET = { 3: [1, 0.6, 0], 4: [1, 0.8, 0.35, 0], 5: [1, 0.8, 0.6, 0.35, 0], 6: [1, 1, 0.8, 0.6, 0.35, 0] }[n];
    const FINAL = { 1: 'var(--g4)', 0.8: 'var(--g3)', 0.6: 'var(--g2)', 0.35: 'var(--g1)', 0: 'var(--g0)' };
    const RIPE_BY = 0.86; // where on the timeline each cluster reaches its colour (the section near the top of the screen)
    const x0 = W * (narrow ? 0.1 : 0.07), span = xe * 0.95 - x0;
    const rr = clamp(5.6 * u, 3.7, 6.3);
    const ROWS = [[4, 4, 3, 3, 2, 1], [4, 3, 3, 2, 1], [3, 3, 2, 1], [3, 2, 1], [2, 1]];
    for (let k = 0; k < n; k++) {
      const cx = x0 + span * (k + 0.5) / n + R(-0.04, 0.04) * span / n, cy = yAt(cx);
      const sway = R(-1, 1) * 7 * u, top = cy + 13 * u;
      const avail = H - top - 3;
      let rows = ROWS.find(rw => rr * 2 + (rw.length - 1) * rr * 1.62 <= avail) || ROWS[ROWS.length - 1];
      if (k === n - 1 && rows.length > 3) rows = rows.slice(1); // the youngest cluster is a little smaller
      const s = at(cx);
      const ped = svgEl('path', { class: 'sg-ped sg-v', d: `M${f1(cx)} ${f1(cy)}Q${f1(cx + sway * 0.2)} ${f1(cy + 8 * u)} ${f1(cx + sway)} ${f1(top)}`, pathLength: 1 }, back);
      range(ped, s, s + 0.035);
      leaf(cx + R(-4, 4) * u, cy, (k % 2 ? -1 : 1) * R(48, 70), R(26, 34), back);
      const target = TARGET[k], cl = svgEl('g', {}, front);
      cl.style.setProperty('--gf', FINAL[target]);
      const tilt = sway * 0.06;
      rows.forEach((cnt, j) => {
        for (let i = 0; i < cnt; i++) {
          const gx = cx + sway + (i - (cnt - 1) / 2) * rr * 1.92 + R(-0.18, 0.18) * rr + j * tilt * rr, gy = top + rr + j * rr * 1.62 + R(-0.12, 0.12) * rr;
          const pop = svgEl('g', { class: 'sg-pop sg-v' }, cl);
          const a = s + 0.03 + j * 0.008 + R(0, 0.012);
          range(pop, a, a + 0.05);
          const c = svgEl('circle', { class: 'sg-ripe', cx: f1(gx), cy: f1(gy), r: f1(rr * R(0.92, 1.05)) }, pop);
          svgEl('circle', { class: 'sg-hl', cx: f1(gx - rr * 0.36), cy: f1(gy - rr * 0.38), r: f1(rr * 0.26) }, pop);
          if (target > 0) {
            // berries colour one by one (véraison), each cluster only as far as its age
            c.classList.add('sg-v');
            const ra = Math.min(RIPE_BY - 0.12, s + 0.12) + R(-0.04, 0.05);
            range(c, ra, ra + (RIPE_BY - ra) / target);
          }
        }
      });
    }
    // leaves and tendrils along the stem between the clusters
    const nl = Math.round(W / (narrow ? 120 : 150));
    for (let i = 0; i < nl; i++) {
      const x = W * 0.03 + (xe - W * 0.06) * (i + R(0.2, 0.8)) / nl, y = yAt(x);
      leaf(x, y, (i % 2 ? 1 : -1) * R(30, 80), R(18, 30));
      if (i % 3 === 1) tendril(x + 6 * u, y, i % 2 ? 1 : -1, R(8, 12));
    }
    tendril(W * 0.015, yAt(W * 0.015), 1, 9);
  }

  /* =====================================================================
     Family Hub
     ===================================================================== */
  function hubPage() {
    const art = $('.auth-art'), welcome = $('.welcome');
    hourLight(art);
    hourLight(welcome);
    livingOcean(art);
    // the arrival plays once, over whichever photo the family sees first
    let done = false;
    const firstLook = () => {
      if (done) return;
      const st = document.body.dataset.state;
      if (st !== 'auth' && st !== 'app') return;
      done = true;
      setTimeout(() => {
        if (st === 'auth') arrive(art, (W, H, narrow) => {
          const cs = getComputedStyle(art, '::before');
          return { cx: W * (narrow ? 0.79 : 0.5), top: H * (narrow ? 0.16 : 0.17), size: narrow ? clamp(H * 0.36, 60, 92) : clamp(H * 0.21, 120, 190), horizon: horizonY({ top: 0, w: W, h: H }, posYOf(cs.backgroundPosition), 1.5) };
        });
        else if (welcome && welcome.offsetWidth) arrive(welcome, (W, H, narrow) => {
          const bg = $('.welcome-bg', welcome), cs = getComputedStyle(bg), off = bg.offsetTop;
          return { cx: W * (narrow ? 0.84 : W >= 1000 ? 0.64 : 0.8), top: H * (narrow ? 0.09 : 0.12), size: narrow ? clamp(H * 0.2, 48, 70) : clamp(H * 0.34, 90, 150), horizon: horizonY({ top: off, w: bg.offsetWidth, h: bg.offsetHeight }, posYOf(cs.backgroundPosition), 1.5) };
        });
      }, 60);
    };
    new MutationObserver(firstLook).observe(document.body, { attributes: true, attributeFilter: ['data-state'] });
    firstLook();
    threads();
  }

  // The sign-in photo gets the same living ocean as the hub's welcome photo (assets/js/livephoto.js).
  function livingOcean(art) {
    if (!art || !MOTION) return;
    let live = null, lib = null;
    const load = () => lib || (lib = window.AgrazLive ? Promise.resolve() : new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = '/assets/js/livephoto.js' + V;
      sc.onload = res; sc.onerror = rej;
      document.head.appendChild(sc);
    }));
    const mount = () => {
      const cs = getComputedStyle(art, '::before'), rs = getComputedStyle(root);
      const src = (cs.backgroundImage.match(/url\("?([^")]+)"?\)/) || [])[1];
      if (!src || !/^https:\/\/images\.unsplash\.com\//.test(src)) return;
      const pos = cs.backgroundPosition.split(/\s+/).map(v => (/%$/.test(v) ? parseFloat(v) / 100 : 0.5));
      const num = (k, d) => { const v = parseFloat(rs.getPropertyValue(k)); return Number.isFinite(v) ? v : d; };
      live = 'loading';
      load().then(() => {
        if (live !== 'loading') return;
        live = window.AgrazLive.mount(art, { src, posX: pos[0], posY: pos[1] === undefined ? 0.5 : pos[1], horizon: num('--tod-horizon', 0.5), seaEnd: num('--tod-sea-end', 1),
          calm: num('--tod-calm', 1), glitter: num('--tod-glitter', 1), stars: num('--tod-stars', 0), sunRays: num('--tod-rays', 0) });
      }).catch(() => { live = null; });
    };
    // keep the canvas breathing in time with the photo's slow zoom underneath
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      if (!(n instanceof HTMLCanvasElement) || !n.animate) return;
      const base = document.getAnimations ? document.getAnimations().find(a => a.effect && a.effect.target === art && a.effect.pseudoElement === '::before') : null;
      const z = n.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }], { duration: 24000, iterations: Infinity, direction: 'alternate', easing: 'cubic-bezier(.22,.61,.36,1)' });
      if (base && base.startTime != null) z.startTime = base.startTime;
    }))).observe(art, { childList: true });
    const sync = () => {
      const on = document.body.dataset.state === 'auth' && art.offsetWidth > 0;
      if (on && !live) mount();
      else if (!on && live) { if (live.destroy) live.destroy(); live = null; }
    };
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['data-state'] });
    sync();
  }

  /* =====================================================================
     Threads of light — choose someone in the Family Tree and a pulse of
     light runs from them along the lines to their parents (and on to the
     grandparents) and down to their children.
     ===================================================================== */
  function threads() {
    const view = $('#view-tree');
    if (!view || !MOTION || !Element.prototype.animate) return;
    let lastChart = null, lastPid = '', pend = 0, timer = 0;
    const check = () => {
      pend = 0;
      const chart = $('#fam-chart'), focus = chart && $('[data-slot="focus"]', chart);
      const pid = focus ? focus.dataset.pid || '' : '';
      if (!chart || (chart === lastChart && pid === lastPid)) return;
      lastChart = chart; lastPid = pid;
      clearTimeout(timer);
      timer = setTimeout(() => pulse(chart), 640); // after the view glides and the lines draw in
    };
    new MutationObserver(() => { if (!pend) pend = requestAnimationFrame(check); }).observe(view, { childList: true, subtree: true });
  }
  const CURVE = /^M(-?[\d.]+) (-?[\d.]+) ?C(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)$/;
  function pulse(chart) {
    const lines = $('#fam-lines', chart), focus = $('[data-slot="focus"]', chart);
    if (!chart.isConnected || !lines || !focus || document.hidden) return;
    const segs = $$('path.fl', lines).filter(p => !p.classList.contains('knot')).map(p => {
      const m = CURVE.exec((p.getAttribute('d') || '').trim());
      return m ? m.slice(1).map(Number) : null;
    }).filter(Boolean);
    if (!segs.length) return;
    // where each card sits in the chart, by layout (a hovered card lifts, but its lines don't)
    const at = el => { let x = 0, y = 0, e = el; while (e && e !== chart) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; } return e === chart ? [x, y] : null; };
    const cards = $$('.tcard', chart).filter(c => !c.classList.contains('void') && !c.classList.contains('unknown')).map(c => {
      const o = at(c);
      if (!o) return null;
      const x = o[0] + c.offsetWidth / 2;
      return { el: c, top: [x, o[1] - 2], bot: [x, o[1] + c.offsetHeight + 2] };
    }).filter(Boolean);
    const near = (a, x, y) => Math.abs(a[0] - x) < 3.5 && Math.abs(a[1] - y) < 3.5;
    const start = s => [s[0], s[1]], end = s => [s[6], s[7]];
    const fwd = s => `C${s[2]} ${s[3]} ${s[4]} ${s[5]} ${s[6]} ${s[7]}`, rev = s => `C${s[4]} ${s[5]} ${s[2]} ${s[3]} ${s[0]} ${s[1]}`;
    const me = cards.find(c => c.el === focus);
    if (!me) return;
    let ov = $('.sg-threads', chart);
    if (!ov) { ov = svgEl('svg', { class: 'sg-threads', 'aria-hidden': 'true', focusable: 'false' }); chart.appendChild(ov); }
    ['viewBox', 'width', 'height'].forEach(a => ov.setAttribute(a, lines.getAttribute(a) || ''));
    const light = (d, delay, dim, target) => {
      const glow = svgEl('path', { class: 'sg-th-glow', d, pathLength: 1 }, ov), core = svgEl('path', { class: 'sg-th-core', d, pathLength: 1 }, ov);
      const dur = 1150, kf = [{ strokeDasharray: '0.001 2', strokeDashoffset: 0, opacity: 0 }, { opacity: dim, offset: 0.12 }, { opacity: dim, offset: 0.78 }, { strokeDasharray: '0.22 2', strokeDashoffset: -0.98, opacity: 0 }];
      [glow, core].forEach(p => { p.animate(kf, { duration: dur, delay, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'both' }).onfinish = () => p.remove(); });
      if (target) setTimeout(() => lit(target.el), delay + dur * 0.8);
    };
    // upward: from a card's top to the junction, then on to each parent's bottom
    const up = (card, delay, dim, depth) => {
      const j = segs.find(s => near(end(s), card.top[0], card.top[1]));
      if (!j) return;
      segs.filter(s => s !== j && near(end(s), j[0], j[1])).forEach(s => {
        const parent = cards.find(c => near(c.bot, s[0], s[1]));
        light(`M${j[6]} ${j[7]}${rev(j)}${rev(s)}`, delay, dim, parent);
        if (parent && depth < 2) up(parent, delay + 820, dim * 0.62, depth + 1);
      });
    };
    lit(focus);
    up(me, 0, 1, 1);
    // downward: from the chosen person's bottom to each union's junction, then to every child
    segs.filter(s => near(start(s), me.bot[0], me.bot[1])).forEach(j => {
      segs.filter(s => near(start(s), j[6], j[7])).forEach(s => {
        const kid = cards.find(c => near(c.top, s[6], s[7]));
        light(`M${j[0]} ${j[1]}${fwd(j)}${fwd(s)}`, 60, 0.95, kid);
      });
    });
  }
  function lit(el) {
    el.classList.remove('sg-lit');
    void el.offsetWidth;
    el.classList.add('sg-lit');
    setTimeout(() => el.classList.remove('sg-lit'), 1300);
  }

  if ($('.hero')) publicPage();
  else if ($('#app')) hubPage();
})();
