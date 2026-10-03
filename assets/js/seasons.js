/* ==========================================================================
   Agraz Family — the seasons, with a little Midwest in them (both pages)
   · <html data-season> is set in <head>: spring / summer / autumn / winter
     (?season=winter previews another one)
   · weather over the hero and the welcome banner: blossoms, fireflies,
     falling leaves, snow
   · a heartland postcard: rolling fields, a red barn with a barn quilt,
     a silo, a windmill and a water tower, dressed for the season
   All decoration (aria-hidden, no pointer events); with reduced motion it
   holds still.
   ========================================================================== */
(function () {
  'use strict';

  const root = document.documentElement;
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const season = SEASONS.includes(root.getAttribute('data-season')) ? root.getAttribute('data-season') : 'summer';
  const tod = root.getAttribute('data-tod') || 'day';
  const mq = q => window.matchMedia && window.matchMedia(q).matches;
  const REDUCED = mq('(prefers-reduced-motion: reduce)');
  const BOT = !!navigator.webdriver;
  const MOTION = !REDUCED && !BOT;
  if (MOTION) root.classList.add('season-motion');
  const $ = (s, el) => (el || document).querySelector(s);

  const WORDS = {
    spring: { name: 'Spring', chip: 'Spring planting', line: 'Tulips, thunderstorms and fresh starts.' },
    summer: { name: 'Summer', chip: 'Summer on the lake', line: 'Porch lights, fireflies and sweet corn.' },
    autumn: { name: 'Autumn', chip: 'Harvest season', line: 'Sweater weather and Sunday suppers.' },
    winter: { name: 'Winter', chip: 'Snowed in together', line: 'Hot cocoa and a full house.' }
  }[season];
  window.AgrazSeason = { season, name: WORDS.name };

  function div(cls, parent, before) {
    const el = document.createElement('div');
    el.className = cls;
    el.setAttribute('aria-hidden', 'true');
    if (parent) parent.insertBefore(el, before || null);
    return el;
  }

  // ---- a barn quilt: the eight-point star painted on barns across the heartland ----
  function quilt(x, y, s) {
    const h = s / 2, q = s / 4;
    return `<g class="hl-quilt" transform="translate(${x} ${y}) rotate(45)">
      <rect x="${-h}" y="${-h}" width="${s}" height="${s}" class="q-base"/>
      <path class="q-a" d="M0 ${-h}L${q} ${-q}L0 0Z M${h} 0L${q} ${q}L0 0Z M0 ${h}L${-q} ${q}L0 0Z M${-h} 0L${-q} ${-q}L0 0Z"/>
      <path class="q-b" d="M0 ${-h}L${-q} ${-q}L0 0Z M${h} 0L${q} ${-q}L0 0Z M0 ${h}L${q} ${q}L0 0Z M${-h} 0L${-q} ${q}L0 0Z"/>
      <rect x="${-q / 2}" y="${-q / 2}" width="${q}" height="${q}" class="q-c"/>
    </g>`;
  }
  const QUILT_ICON = `<svg class="season-quilt" viewBox="-12 -12 24 24" aria-hidden="true">${quilt(0, 0, 15)}</svg>`;

  // a little red barn with a gambrel roof (origin: bottom-left corner)
  function barn(x, y, w) {
    const h = w * .62, eave = h * .55, k = w * .2;
    return `<g class="hl-barn-g">
      <path class="hl-barn" d="M${x} ${y}V${y - eave}L${x + k} ${y - h * .9}L${x + w / 2} ${y - h * 1.18}L${x + w - k} ${y - h * .9}L${x + w} ${y - eave}V${y}Z"/>
      <path class="hl-roof" d="M${x - w * .04} ${y - eave + 1}L${x + k} ${y - h * .9 - 1}L${x + w / 2} ${y - h * 1.18 - 2}L${x + w - k} ${y - h * .9 - 1}L${x + w * 1.04} ${y - eave + 1}L${x + w - k} ${y - h * .86}L${x + w / 2} ${y - h * 1.1}L${x + k} ${y - h * .86}Z"/>
      <rect class="hl-trim" x="${x + w * .34}" y="${y - eave * .82}" width="${w * .32}" height="${eave * .82}"/>
      <path class="hl-trim-x" d="M${x + w * .34} ${y - eave * .82}L${x + w * .66} ${y}M${x + w * .66} ${y - eave * .82}L${x + w * .34} ${y}"/>
      <rect class="hl-lit" x="${x + w * .44}" y="${y - h * .96}" width="${w * .12}" height="${w * .1}"/>
      ${quilt(x + w / 2, y - h * .66, w * .14)}
    </g>`;
  }
  function silo(x, y, w, h) {
    return `<g><rect class="hl-silo" x="${x}" y="${y - h}" width="${w}" height="${h}"/>
      <path class="hl-silo-top" d="M${x - 1} ${y - h}a${w / 2 + 1} ${w / 2 + 1} 0 0 1 ${w + 2} 0Z"/>
      <path class="hl-silo-band" d="M${x} ${y - h * .7}h${w}M${x} ${y - h * .4}h${w}"/></g>`;
  }
  function windmill(x, y, h) {
    const r = h * .32;
    const blades = Array.from({ length: 12 }, (_, i) => {
      const a = i * Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
      return `M${(c * r * .25).toFixed(1)} ${(s * r * .25).toFixed(1)}L${(c * r).toFixed(1)} ${(s * r).toFixed(1)}`;
    }).join('');
    return `<g class="hl-mill">
      <path class="hl-tower" d="M${x - h * .12} ${y}L${x - 1} ${y - h}M${x + h * .12} ${y}L${x + 1} ${y - h}M${x - h * .09} ${y - h * .25}L${x + h * .09} ${y - h * .25}M${x - h * .06} ${y - h * .55}L${x + h * .06} ${y - h * .55}M${x - h * .09} ${y - h * .25}L${x + h * .06} ${y - h * .55}"/>
      <path class="hl-vane" d="M${x} ${y - h}l${r * 1.15} -2v4Z"/>
      <g transform="translate(${x} ${y - h})"><g class="hl-blades"><path class="hl-blade" d="${blades}"/><circle class="hl-hub" r="${r * .26}"/></g></g>
    </g>`;
  }
  function tower(x, y, h, word) {
    const w = h * .62, tank = h * .34;
    return `<g class="hl-water">
      <path class="hl-tower" d="M${x - w * .32} ${y}L${x - w * .2} ${y - h + tank}M${x + w * .32} ${y}L${x + w * .2} ${y - h + tank}M${x - w * .3} ${y - h * .25}L${x + w * .3} ${y - h * .25}M${x} ${y}V${y - h + tank}"/>
      <path class="hl-tank" d="M${x - w / 2} ${y - h + tank * .28}Q${x - w / 2} ${y - h + tank} ${x} ${y - h + tank}Q${x + w / 2} ${y - h + tank} ${x + w / 2} ${y - h + tank * .28}Z"/>
      <path class="hl-tank-top" d="M${x - w / 2 - 2} ${y - h + tank * .3}Q${x} ${y - h - tank * .5} ${x + w / 2 + 2} ${y - h + tank * .3}Z"/>
      <text class="hl-word" x="${x}" y="${y - h + tank * .78}" text-anchor="middle" font-size="${tank * .34}">${word}</text>
    </g>`;
  }
  // round trees in summer and spring, bare branches in winter, flame-colored in autumn
  function tree(x, y, r, cls) {
    if (season === 'winter' && cls !== 'pine') return `<path class="hl-bare" d="M${x} ${y}V${y - r * 2.1}M${x} ${y - r}l${-r * .6} ${-r * .7}M${x} ${y - r * 1.3}l${r * .55} ${-r * .6}M${x} ${y - r * 1.7}l${-r * .35} ${-r * .4}"/>`;
    if (cls === 'pine') return `<path class="hl-pine" d="M${x} ${y - r * 2.6}L${x + r * .8} ${y - r * .4}H${x - r * .8}Z"/>${season === 'winter' ? `<path class="hl-snowcap" d="M${x} ${y - r * 2.6}L${x + r * .32} ${y - r * 1.8}H${x - r * .32}Z"/>` : ''}`;
    return `<rect class="hl-trunk" x="${x - r * .1}" y="${y - r}" width="${r * .2}" height="${r}"/><circle class="hl-tree ${cls || ''}" cx="${x}" cy="${y - r * 1.4}" r="${r}"/>`;
  }
  function fieldRows(x0, x1, y, n) {
    let d = '';
    for (let i = 0; i < n; i++) d += `M${x0} ${y + i * 5}Q${(x0 + x1) / 2} ${y + i * 5 - 4} ${x1} ${y + i * 5 + 2}`;
    return `<path class="hl-rows" d="${d}"/>`;
  }
  function extras(big) {
    if (season === 'autumn') return big
      ? `<g class="hl-pumpkins"><circle cx="540" cy="128" r="4.5"/><circle cx="552" cy="130" r="3.5"/><circle cx="878" cy="131" r="4"/></g><g class="hl-bales"><rect x="905" y="121" width="16" height="10" rx="4"/><rect x="930" y="123" width="14" height="9" rx="4"/></g>`
      : `<g class="hl-pumpkins"><circle cx="98" cy="74" r="3"/><circle cx="105" cy="75" r="2.3"/></g>`;
    if (season === 'winter') return big
      ? `<g class="hl-snowman"><circle cx="560" cy="126" r="6"/><circle cx="560" cy="116" r="4.2"/><circle cx="560" cy="109" r="3"/></g>`
      : `<g class="hl-snowman"><circle cx="100" cy="72" r="4"/><circle cx="100" cy="66" r="2.8"/></g>`;
    if (season === 'spring') return big
      ? `<g class="hl-tulips">${[520, 530, 540, 550, 870, 880, 890].map((x, i) => `<path d="M${x} 134V${124 - (i % 2) * 2}"/><circle cx="${x}" cy="${123 - (i % 2) * 2}" r="2.6" class="t${i % 3}"/>`).join('')}</g>`
      : `<g class="hl-tulips">${[94, 100, 106].map((x, i) => `<path d="M${x} 77V70"/><circle cx="${x}" cy="69" r="2" class="t${i % 3}"/>`).join('')}</g>`;
    return big
      ? `<g class="hl-corn">${Array.from({ length: 14 }, (_, i) => `<path d="M${880 + i * 9} 136V${118 + (i % 3) * 2}"/>`).join('')}</g>`
      : `<g class="hl-corn">${Array.from({ length: 7 }, (_, i) => `<path d="M${168 + i * 6} 80V${68 + (i % 2) * 2}"/>`).join('')}</g>`;
  }

  // The wide view, for the bottom of the public page.
  function wideScene() {
    return `<svg class="heartland-svg" viewBox="0 0 1440 150" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <circle class="hl-moon" cx="1150" cy="34" r="13"/>
      <g class="hl-stars">${[[120, 30], [260, 18], [410, 44], [980, 22], [1260, 52], [1340, 20], [70, 70], [1400, 64], [860, 40]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.2"/>`).join('')}</g>
      <path class="hl-far" d="M0 96C160 70 300 84 450 90S760 66 920 80 1240 74 1440 88V150H0Z"/>
      ${tree(212, 92, 9, 'pine')}${tree(232, 94, 7, 'pine')}${tower(1010, 112, 64, 'AGRAZ')}${tree(1180, 100, 10)}${tree(1205, 102, 8)}
      <path class="hl-mid" d="M0 118C200 96 380 104 560 110S900 100 1080 108 1300 104 1440 112V150H0Z"/>
      ${fieldRows(1080, 1440, 118, 5)}${fieldRows(0, 380, 122, 4)}
      ${silo(704, 122, 22, 66)}${barn(596, 124, 100)}${windmill(800, 126, 70)}${tree(470, 120, 13)}${tree(500, 124, 10)}${tree(330, 124, 11)}${tree(372, 126, 8, 'pine')}
      <path class="hl-near" d="M0 134C240 122 480 128 720 132S1200 126 1440 134V150H0Z"/>
      <path class="hl-fence" d="M430 140H760M430 134H760${Array.from({ length: 12 }, (_, i) => `M${430 + i * 30} 130V144`).join('')}"/>
      ${extras(true)}
      <g class="hl-flies">${[[260, 112], [640, 96], [760, 110], [930, 100], [1120, 116], [400, 104], [1300, 108]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="1.8" class="f${i % 3}"/>`).join('')}</g>
    </svg>`;
  }
  // The postcard view, for the hub's sidebar.
  function cardScene() {
    return `<svg class="heartland-svg" viewBox="0 0 240 86" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <circle class="hl-sun" cx="196" cy="22" r="9"/>
      <path class="hl-far" d="M0 54C40 44 80 50 120 52S200 42 240 50V86H0Z"/>
      ${tree(22, 54, 5, 'pine')}${tree(32, 55, 4, 'pine')}${tree(214, 54, 6)}
      <path class="hl-mid" d="M0 68C50 58 100 62 150 64S210 60 240 66V86H0Z"/>
      ${fieldRows(150, 240, 70, 3)}
      ${silo(118, 70, 11, 34)}${barn(62, 72, 52)}${windmill(160, 74, 36)}
      <path class="hl-near" d="M0 78C60 72 120 75 180 77S220 75 240 78V86H0Z"/>
      ${extras(false)}
    </svg>`;
  }

  function addHeartland() {
    const footer = $('.site-footer');
    if (footer && !$('.heartland', footer)) {
      footer.classList.add('has-heartland');
      const box = div('heartland', footer, footer.firstChild);
      box.innerHTML = wideScene();
      const brand = $('.footer-brand p', footer);
      if (brand && !$('.season-line', footer)) {
        const p = document.createElement('p');
        p.className = 'season-line';
        p.innerHTML = `${QUILT_ICON}<span>From the shore to the heartland · <em>${WORDS.line}</em></span>`;
        brand.after(p);
      }
    }
    const side = $('.sidebar .side-user');
    if (side && !$('.heartland-card')) {
      const card = div('heartland-card', side.parentNode, side);
      card.innerHTML = `<div class="hc-art">${cardScene()}</div><p class="hc-cap">${QUILT_ICON}<span><strong>${WORDS.chip}</strong>Greetings from the heartland</span></p>`;
    }
    const welcome = $('.welcome-text');
    if (welcome && !$('.season-chip', welcome)) {
      const chip = document.createElement('p');
      chip.className = 'season-chip';
      chip.setAttribute('aria-hidden', 'true');
      chip.innerHTML = `${QUILT_ICON}<span>${WORDS.chip}</span>`;
      welcome.insertBefore(chip, welcome.firstChild);
    }
  }

  // ---- weather: a canvas of blossoms, fireflies, leaves or snow ----
  const LEAF = new Path2D('M0 -10 L2 -5 L6 -7 L5 -2 L10 -2 L7 2 L9 4 L3 4 L1 9 L0 5 L-1 9 L-3 4 L-9 4 L-7 2 L-10 -2 L-5 -2 L-6 -7 L-2 -5 Z');
  const PETAL = new Path2D('M0 -6 C4 -4 4 3 0 6 C-4 3 -4 -4 0 -6 Z');
  const PALETTE = {
    autumn: ['#c8541d', '#e08a2c', '#b23a1e', '#d9a33a', '#9c4a1c', '#e2b04a'],
    spring: ['#f6c1d0', '#f9d9e2', '#ffffff', '#f2a7bd', '#fbe7ee'],
    winter: ['#ffffff'],
    summer: ['#fff2a8', '#ffe27a', '#f9f6c8']
  }[season];
  const night = tod === 'dusk' || tod === 'night';
  const rnd = (a, b) => a + Math.random() * (b - a);

  function weather(host, density) {
    if (!host || host.querySelector(':scope > .season-sky')) return;
    const cv = document.createElement('canvas');
    cv.className = 'season-sky';
    cv.setAttribute('aria-hidden', 'true');
    const bg = host.querySelector(':scope > .welcome-bg, :scope > .hero-media');
    host.insertBefore(cv, bg ? bg.nextSibling : host.firstChild);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let W = 0, H = 0, dpr = 1, parts = [], running = false, seen = true, raf = 0, last = 0;

    function make(fresh) {
      const p = { x: rnd(0, W), y: fresh ? rnd(-H * .2, H) : rnd(-60, -10), c: PALETTE[(Math.random() * PALETTE.length) | 0], t: rnd(0, 6.28) };
      if (season === 'autumn') Object.assign(p, { s: rnd(.8, 1.6), vy: rnd(22, 46), sway: rnd(18, 42), spin: rnd(-1.6, 1.6), flip: rnd(1, 2.6), a: rnd(0, 6.28) });
      else if (season === 'spring') Object.assign(p, { s: rnd(.6, 1.1), vy: rnd(14, 30), sway: rnd(20, 50), spin: rnd(-2, 2), flip: rnd(1.5, 3), a: rnd(0, 6.28) });
      else if (season === 'winter') Object.assign(p, { s: rnd(.8, 2.8), vy: rnd(18, 52), sway: rnd(6, 22), o: rnd(.45, .95) });
      else Object.assign(p, { y: rnd(H * .25, H * .95), s: rnd(1.2, 2.4), vx: rnd(-10, 10), vy: rnd(-8, 8), pulse: rnd(.6, 1.6) });
      return p;
    }
    function count() {
      const area = W * H / 100000;
      const per = { autumn: 1.3, spring: 1.6, winter: 7, summer: night ? 2.4 : 1.2 }[season];
      return Math.max(6, Math.min(season === 'winter' ? 140 : 40, Math.round(area * per * density)));
    }
    function size() {
      const r = host.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const n = count();
      while (parts.length < n) parts.push(make(true));
      parts.length = n;
    }
    function draw(dt, now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const time = now / 1000;
      for (const p of parts) {
        if (season === 'summer') {
          p.t += dt * p.pulse;
          p.x += (p.vx + Math.sin(time * .7 + p.t) * 8) * dt;
          p.y += (p.vy + Math.cos(time * .5 + p.t) * 6) * dt;
          if (Math.random() < dt * .4) { p.vx = rnd(-12, 12); p.vy = rnd(-9, 9); }
          if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10;
          if (p.y < H * .15) p.vy = Math.abs(p.vy); if (p.y > H) p.vy = -Math.abs(p.vy);
          const glow = night ? (.45 + .55 * Math.max(0, Math.sin(p.t * 2))) : (.25 + .2 * Math.sin(p.t));
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * (night ? 7 : 4));
          g.addColorStop(0, `rgba(255, 238, 150, ${glow})`);
          g.addColorStop(.35, `rgba(255, 214, 90, ${glow * .45})`);
          g.addColorStop(1, 'rgba(255, 214, 90, 0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (night ? 7 : 4), 0, 6.283); ctx.fill();
          continue;
        }
        p.t += dt;
        p.y += p.vy * dt;
        const x = p.x + Math.sin(p.t * (season === 'winter' ? .8 : 1.1)) * p.sway;
        if (season === 'winter') {
          ctx.globalAlpha = p.o;
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(x, p.y, p.s, 0, 6.283); ctx.fill();
        } else {
          p.a += p.spin * dt;
          ctx.save();
          ctx.translate(x, p.y);
          ctx.rotate(p.a);
          ctx.scale(p.s * Math.cos(p.t * p.flip), p.s);
          ctx.globalAlpha = .92;
          ctx.fillStyle = p.c;
          ctx.fill(season === 'autumn' ? LEAF : PETAL);
          ctx.restore();
        }
        if (p.y > H + 20) Object.assign(p, make(false));
      }
      ctx.globalAlpha = 1;
    }
    function frame(now) {
      if (!running) return;
      const dt = Math.min(.05, (now - (last || now)) / 1000);
      last = now;
      draw(dt, now);
      raf = requestAnimationFrame(frame);
    }
    function sync() {
      const go = MOTION && seen && !document.hidden;
      if (go && !running) { running = true; last = 0; raf = requestAnimationFrame(frame); }
      else if (!go && running) { running = false; cancelAnimationFrame(raf); }
    }
    size();
    if (!MOTION) { draw(0, 0); return; } // reduced motion: one still frame
    if ('ResizeObserver' in window) new ResizeObserver(size).observe(host);
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { seen = es[0].isIntersecting; sync(); }).observe(host);
    document.addEventListener('visibilitychange', sync);
    sync();
  }

  function init() {
    addHeartland();
    if (BOT) return; // automated test browsers: nothing to wait on
    weather($('.hero'), 1);
    const w = $('.welcome');
    if (w) weather(w, 1.4);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
