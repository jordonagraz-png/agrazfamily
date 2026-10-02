/* ==========================================================================
   La Nevería — an original beachside frozen-treat shop game (Agraz Family Hub)
   Take orders at the counter, then build, blend and top each treat to match
   its ticket. Serve fast and right for big tips.

   Plain browser script: no modules, no dependencies, no network requests.
   CSP-safe: all UI is drawn on a <canvas>; no inline styles, handlers or eval.

   Registers:
     window.AgrazGames.neveria = { id: 'neveria', title: 'La Nevería', mount, core }
   mount(host, { best, reduced, sound, seed, onOver(score), onServe(result) })
     → { start, pause, resume, destroy, setSound, state, debug }
   core: pure, DOM-free rules (makeOrder, grade, …) for unit tests.
   ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
     Core — pure game rules (deterministic for a given seeded rng)
     ====================================================================== */
  const SIZES = ['S', 'M', 'L'];
  const FLAVORS = ['vainilla', 'fresa', 'chocolate', 'mango', 'horchata', 'limon'];
  const MIXINS = ['galleta', 'fresas', 'mango', 'nuez', 'chispas', 'coco'];
  const BLENDS = ['chunky', 'regular', 'smooth'];
  const TOPPINGS = ['crema', 'chocolate', 'cajeta', 'chamoy', 'confeti', 'tajin', 'cereza', 'barquillo'];
  const BLEND_ZONES = [
    { id: 'chunky', from: 0.06, to: 0.36 },
    { id: 'regular', from: 0.36, to: 0.66 },
    { id: 'smooth', from: 0.66, to: 0.9 },
    { id: 'soupy', from: 0.9, to: 1 }
  ];
  const BLEND_CENTER = { chunky: 0.21, regular: 0.51, smooth: 0.78, soupy: 0.96 };
  const BLEND_RATE = 0.36;          // meter per second of holding (~2.8 s to the top)
  const MAX_TICKETS = 3;
  const MAX_SCOOPS = 3;
  const MAX_MIXINS = 3;
  const WEIGHTS = { size: 0.15, flavor: 0.25, mixins: 0.15, blend: 0.15, toppings: 0.3 };

  const LABEL = {
    size: { S: 'Small', M: 'Medium', L: 'Large' },
    flavor: { vainilla: 'Vainilla', fresa: 'Fresa', chocolate: 'Chocolate', mango: 'Mango', horchata: 'Horchata', limon: 'Limón' },
    mixin: { galleta: 'Galleta', fresas: 'Fresas', mango: 'Mango', nuez: 'Nuez', chispas: 'Chispas', coco: 'Coco' },
    blend: { chunky: 'Chunky', regular: 'Regular', smooth: 'Smooth', soupy: 'Soupy' },
    topping: { crema: 'Crema', chocolate: 'Chocolate', cajeta: 'Cajeta', chamoy: 'Chamoy', confeti: 'Confeti', tajin: 'Tajín', cereza: 'Cereza', barquillo: 'Barquillo' }
  };
  const ALIASES = {
    size: { small: 'S', chico: 'S', medium: 'M', mediano: 'M', large: 'L', grande: 'L' },
    flavor: { vanilla: 'vainilla', strawberry: 'fresa', lime: 'limon', lemon: 'limon' },
    mixin: { cookie: 'galleta', cookies: 'galleta', strawberries: 'fresas', nut: 'nuez', nuts: 'nuez', pecan: 'nuez', chips: 'chispas', coconut: 'coco' },
    blend: { none: null, no: null, off: null },
    topping: { whip: 'crema', whipped: 'crema', cream: 'crema', 'whipped cream': 'crema', sprinkles: 'confeti', grageas: 'confeti', chispitas: 'confeti', cherry: 'cereza', wafer: 'barquillo', caramel: 'cajeta', chili: 'tajin' }
  };

  const NAMES = ['Lupita', 'Mateo', 'Camila', 'Diego', 'Sofía', 'Javi', 'Paloma', 'Chuy', 'Valeria', 'Rafa', 'Ximena', 'Emilio',
    'Lucía', 'Toño', 'Inés', 'Marco', 'Renata', 'Pepe', 'Elena', 'Santi', 'Nico', 'Mari', 'Gabo', 'Itzel', 'Leo', 'Carmen',
    'Óscar', 'Dani', 'Maya', 'Memo', 'Ana', 'Beto'];
  const SKINS = ['#fbe0c8', '#f3cba5', '#e7b48a', '#d29a6c', '#b97c4f', '#9a6440', '#7a4b2e', '#5a3622'];
  const HAIRS = ['#1d1411', '#2f1d14', '#4a2e1e', '#6b4227', '#94582e', '#c58f4c', '#e0c27f', '#bdb6ad', '#7d2f1d'];
  const CLOTHES = ['#e58c63', '#2b6b66', '#c9933f', '#e85d8a', '#3a8fd0', '#7a5cc2', '#4caf7a', '#f2c14e', '#d9534f', '#f6f1e9', '#5c7a8a', '#132a30'];
  const HAIR_STYLES = ['short', 'long', 'bun', 'curly', 'pony', 'buzz', 'wavy', 'bald'];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function round(v, d) { const m = Math.pow(10, d); return Math.round(v * m) / m; }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function pickN(rng, arr, n) {
    const a = arr.slice();
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rng() * (a.length - i));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a.slice(0, n);
  }

  /** Normalise a user/test supplied id ("Limón", "whip", "m") → canonical id, null (blend none) or undefined (unknown). */
  function norm(kind, v) {
    if (v === null || v === undefined) return kind === 'blend' ? null : undefined;
    let s = String(v).trim();
    if (kind === 'size') { const u = s.toUpperCase(); if (SIZES.indexOf(u) >= 0) return u; }
    s = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const list = kind === 'flavor' ? FLAVORS : kind === 'mixin' ? MIXINS : kind === 'topping' ? TOPPINGS
      : kind === 'blend' ? ['chunky', 'regular', 'smooth', 'soupy'] : [];
    if (list.indexOf(s) >= 0) return s;
    const a = ALIASES[kind];
    if (a && Object.prototype.hasOwnProperty.call(a, s)) return a[s];
    if (kind === 'blend' && s === '') return null;
    return undefined;
  }
  function normList(kind, list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach(function (v) { const n = norm(kind, v); if (n && out.indexOf(n) < 0) out.push(n); });
    return out;
  }

  function blendZone(v) {
    v = Number(v) || 0;
    if (v < 0.06) return null;
    if (v < 0.36) return 'chunky';
    if (v < 0.66) return 'regular';
    if (v < 0.9) return 'smooth';
    return 'soupy';
  }

  /**
   * A new order for a difficulty level 0–3.
   * 0: one flavour + one topping · 1: maybe 2 flavours / a mix-in / a blend · 2: always blended, 2 toppings · 3: busiest.
   */
  function makeOrder(rng, level) {
    const lv = clamp(Math.floor(Number(level) || 0), 0, 3);
    const size = SIZES[Math.floor(rng() * 3)];
    const nF = lv === 0 ? 1 : lv === 1 ? (rng() < 0.35 ? 2 : 1) : lv === 2 ? (rng() < 0.6 ? 2 : 1) : (rng() < 0.3 ? 3 : 2);
    const flavors = pickN(rng, FLAVORS, nF);
    const nM = lv === 0 ? 0 : lv === 1 ? (rng() < 0.5 ? 1 : 0) : lv === 2 ? 1 : (rng() < 0.5 ? 2 : 1);
    const mixins = pickN(rng, MIXINS, nM);
    const roll = rng(), which = rng();
    const blend = (lv === 0 || (lv === 1 && roll < 0.5)) ? null : BLENDS[Math.floor(which * 3)];
    const nT = lv === 0 ? 1 : lv === 1 ? (rng() < 0.5 ? 2 : 1) : lv === 2 ? 2 : (rng() < 0.45 ? 3 : 2);
    const toppings = pickN(rng, TOPPINGS, nT);
    const complexity = (nF - 1) + nM + (blend ? 1 : 0) + (nT - 1);
    return {
      size: size, flavors: flavors, mixins: mixins, blend: blend, toppings: toppings,
      level: lv, complexity: complexity,
      patience: 60 + complexity * 8,                 // seconds before the customer gives up
      par: round(15 + complexity * 4.5, 1),           // serve within this for full speed credit
      value: 10 + SIZES.indexOf(size) * 2 + 2 * nF + 3 * nM + (blend ? 4 : 0) + 2 * nT
    };
  }

  function makeCustomer(rng) {
    const look = {
      skin: pick(rng, SKINS), hairColor: pick(rng, HAIRS), hair: pick(rng, HAIR_STYLES),
      shirt: pick(rng, CLOTHES), accent: pick(rng, CLOTHES), pattern: pick(rng, ['solid', 'solid', 'stripes', 'dots', 'flowers']),
      hat: null, glasses: false, earrings: false, beard: false, kid: false, blink: 0
    };
    const hr = rng();
    look.hat = hr < 0.12 ? 'sun' : hr < 0.24 ? 'cap' : null;
    look.glasses = rng() < 0.22;
    look.earrings = rng() < 0.28;
    look.beard = rng() < 0.14;
    look.kid = rng() < 0.18;
    look.blink = rng() * 4;
    if (look.kid) { look.beard = false; if (look.hairColor === '#bdb6ad') look.hairColor = '#4a2e1e'; }
    if (look.accent === look.shirt) look.accent = '#fffaf2';
    return { name: pick(rng, NAMES), look: look };
  }

  function emptyMade() { return { size: null, flavors: [], mixins: [], blendVal: 0, toppings: [], fx: {} }; }

  function jaccard(a, b) {
    if (!a.length && !b.length) return 1;
    let inter = 0;
    a.forEach(function (x) { if (b.indexOf(x) >= 0) inter++; });
    return inter / (a.length + b.length - inter);
  }
  function madeBlend(made) {
    if (typeof made.blend === 'string' || made.blend === null) {
      if (made.blend === null && typeof made.blendVal === 'number') return blendZone(made.blendVal);
      const z = norm('blend', made.blend);
      return z === undefined ? null : z;
    }
    if (typeof made.blendVal === 'number') return blendZone(made.blendVal);
    return null;
  }
  function blendScore(want, got) {
    if (!want) return got ? 0.25 : 1;
    if (!got) return 0;
    const o = { chunky: 0, regular: 1, smooth: 2, soupy: 3 };
    return [1, 0.5, 0.15, 0][Math.abs(o[want] - o[got])];
  }

  /**
   * Grade a served treat.
   * made: { size, flavors[], mixins[], blend ('chunky'|'regular'|'smooth'|'soupy'|null) or blendVal (0..1), toppings[] }
   * → { stars 1–5, tip (int), parts: { size, flavor, mixins, blend, toppings } each 0..1, speed, accuracy, quality }
   */
  function grade(order, made, waitedSec) {
    made = made || {};
    const oi = SIZES.indexOf(order.size), mi = SIZES.indexOf(norm('size', made.size));
    const parts = {
      size: mi < 0 || oi < 0 ? 0 : [1, 0.4, 0][Math.abs(oi - mi)],
      flavor: jaccard(order.flavors || [], normList('flavor', made.flavors || made.scoops)),
      mixins: jaccard(order.mixins || [], normList('mixin', made.mixins)),
      blend: blendScore(order.blend || null, madeBlend(made)),
      toppings: jaccard(order.toppings || [], normList('topping', made.toppings))
    };
    Object.keys(parts).forEach(function (k) { parts[k] = round(parts[k], 3); });
    let accuracy = 0;
    Object.keys(WEIGHTS).forEach(function (k) { accuracy += WEIGHTS[k] * parts[k]; });
    const pat = Math.max(2, Number(order.patience) || 90);
    const par = Math.min(Number(order.par) || 20, pat - 1);
    const w = Math.max(0, Number(waitedSec) || 0);
    const speed = w <= par ? 1 : clamp(1 - (w - par) / (pat - par), 0, 1);
    const q = accuracy * (0.72 + 0.28 * speed);
    const stars = q >= 0.92 ? 5 : q >= 0.78 ? 4 : q >= 0.6 ? 3 : q >= 0.4 ? 2 : 1;
    const tip = Math.max(0, Math.round((Number(order.value) || 20) * q * q + (stars === 5 ? 5 : 0)));
    return { stars: stars, tip: tip, parts: parts, speed: round(speed, 3), accuracy: round(accuracy, 3), quality: round(q, 3) };
  }

  function describeOrder(o) {
    const bits = [LABEL.size[o.size].toLowerCase() + ' cup', o.flavors.map(function (f) { return LABEL.flavor[f]; }).join(' and ')];
    if (o.mixins.length) bits.push('with ' + o.mixins.map(function (m) { return LABEL.mixin[m]; }).join(' and '));
    bits.push(o.blend ? 'blended ' + LABEL.blend[o.blend].toLowerCase() : 'not blended');
    bits.push('topped with ' + o.toppings.map(function (t) { return LABEL.topping[t]; }).join(' and '));
    return bits.join(', ');
  }

  const core = {
    SIZES: SIZES, FLAVORS: FLAVORS, MIXINS: MIXINS, BLENDS: BLENDS, TOPPINGS: TOPPINGS,
    BLEND_ZONES: BLEND_ZONES, BLEND_CENTER: BLEND_CENTER, BLEND_RATE: BLEND_RATE, LABEL: LABEL, WEIGHTS: WEIGHTS,
    mulberry32: mulberry32, makeOrder: makeOrder, makeCustomer: makeCustomer, grade: grade,
    blendZone: blendZone, emptyMade: emptyMade, norm: norm, describeOrder: describeOrder
  };

  /* ======================================================================
     Drawing helpers (canvas, no DOM)
     ====================================================================== */
  const C = {
    night: '#0c1c21', night2: '#132a30', onNight: '#f4ede2', onNight2: '#b8c6c4',
    paper: '#f6f1e9', card: '#fffdf9', ink: '#10252b', ink2: '#3b4f55', ink3: '#5d6f73',
    sunset: '#f2c3a1', accent: '#e58c63', accentDark: '#a94f2b', sea: '#2b6b66', gold: '#c9933f', goldLight: '#f2c14e',
    good: '#3f9f6b', warn: '#e3a33b', bad: '#d4553f'
  };
  const PAPEL = ['#e85d8a', '#f2a03d', '#f2c14e', '#4caf7a', '#3a8fd0', '#9b6ad6'];
  const TAGS = ['#e85d8a', '#3a8fd0', '#f2a03d', '#4caf7a', '#9b6ad6', '#e58c63', '#2b9a8f', '#d9534f', '#c9933f'];
  const FL = {
    vainilla: { c: '#f7e8bd', d: '#dcc285', sp: '#6b4a2a' },
    fresa: { c: '#f7a8bb', d: '#df7891', sp: '#d6455f' },
    chocolate: { c: '#7b4a31', d: '#55301d', sp: '#4a2818' },
    mango: { c: '#ffbf3f', d: '#e5961a', sp: '#f08c1a' },
    horchata: { c: '#f1e4cf', d: '#cdb28a', sp: '#a0683a' },
    limon: { c: '#c3e67f', d: '#93c24c', sp: '#6fae2f' }
  };
  const SYRUP = { chocolate: '#5a301c', cajeta: '#c47a2a', chamoy: '#b51f33' };
  const SPECKS = [[-0.3, 0.1], [0.25, -0.22], [0.42, 0.22], [-0.08, -0.48], [0.05, 0.38], [-0.52, -0.12], [0.16, 0.04], [-0.28, 0.42]];
  const CUP = { S: { tw: 62, bw: 44, h: 54 }, M: { tw: 74, bw: 52, h: 67 }, L: { tw: 86, bw: 58, h: 80 } };

  // Per-render context shared by the stateless drawing helpers below.
  const RC = { now: 0, reduced: false };

  const easeOutCubic = function (p) { return 1 - Math.pow(1 - p, 3); };
  const easeInOut = function (p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; };
  const easeOutBack = function (p) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
  const easeOutBounce = function (p) {
    const n1 = 7.5625, d1 = 2.75;
    if (p < 1 / d1) return n1 * p * p;
    if (p < 2 / d1) { p -= 1.5 / d1; return n1 * p * p + 0.75; }
    if (p < 2.5 / d1) { p -= 2.25 / d1; return n1 * p * p + 0.9375; }
    p -= 2.625 / d1; return n1 * p * p + 0.984375;
  };

  const colorMemo = {};
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbHex(a) { return '#' + a.map(function (v) { const s = clamp(Math.round(v), 0, 255).toString(16); return s.length < 2 ? '0' + s : s; }).join(''); }
  function mixC(a, b, t) {
    const key = a + b + t.toFixed(3);
    if (colorMemo[key]) return colorMemo[key];
    const x = hexRgb(a), y = hexRgb(b);
    return (colorMemo[key] = rgbHex([0, 1, 2].map(function (i) { return x[i] + (y[i] - x[i]) * t; })));
  }
  function shade(h, t) { return t < 0 ? mixC(h, '#000000', -t) : mixC(h, '#ffffff', t); }
  function avgC(list) {
    if (!list.length) return '#f3e3c8';
    const s = [0, 0, 0];
    list.forEach(function (h) { const v = hexRgb(h); s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; });
    return rgbHex(s.map(function (v) { return v / list.length; }));
  }
  function rgba(h, a) { const v = hexRgb(h); return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')'; }

  function rr(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, Math.max(0.01, r), 0, Math.PI * 2); }
  function ell(c, x, y, rx, ry, rot) { c.beginPath(); c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, Math.PI * 2); }
  function font(px, weight, display) {
    return (weight || 600) + ' ' + (Math.round(px * 10) / 10) + 'px ' +
      (display ? 'Fraunces, Georgia, "Times New Roman", serif' : 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');
  }
  function txt(c, s, x, y, px, col, align, weight, display) {
    c.font = font(px, weight, display);
    c.fillStyle = col;
    c.textAlign = align || 'center';
    c.textBaseline = 'middle';
    c.fillText(s, x, y);
  }
  function fitPx(c, s, maxW, px, weight, display, min) {
    c.font = font(px, weight, display);
    const w = c.measureText(s).width;
    return w <= maxW ? px : Math.max(min || 7, px * maxW / w);
  }
  function txtFit(c, s, x, y, maxW, px, col, align, weight, display) {
    txt(c, s, x, y, fitPx(c, s, maxW, px, weight, display, 7), col, align, weight, display);
  }
  function fxP(m, key, dur) {
    if (RC.reduced || !m || !m.fx) return 1;
    const t0 = m.fx[key];
    if (t0 === undefined) return 1;
    return clamp((RC.now - t0) / dur, 0, 1);
  }
  function starPath(c, x, y, r) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.46 : r;
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      if (i) c.lineTo(px, py); else c.moveTo(px, py);
    }
    c.closePath();
  }
  function checkMark(c, x, y, r) {
    c.fillStyle = C.good; circle(c, x, y, r); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = Math.max(1.4, r * 0.32); c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(x - r * 0.45, y + r * 0.02); c.lineTo(x - r * 0.1, y + r * 0.38); c.lineTo(x + r * 0.5, y - r * 0.35); c.stroke();
  }
  function coinIcon(c, x, y, r) {
    c.fillStyle = '#a8742a'; circle(c, x, y + r * 0.12, r); c.fill();
    c.fillStyle = C.goldLight; circle(c, x, y, r); c.fill();
    c.strokeStyle = '#d9a43a'; c.lineWidth = Math.max(1, r * 0.16); circle(c, x, y, r * 0.68); c.stroke();
    txt(c, '$', x, y + r * 0.06, r * 1.05, '#a8742a', 'center', 800);
  }

  /* ---------- people ---------- */
  function hairBack(c, L, hx, hy, r) {
    c.fillStyle = L.hairColor;
    switch (L.hair) {
      case 'long': rr(c, hx - r * 1.1, hy - r * 0.6, r * 2.2, r * 2.05, r * 0.7); c.fill(); break;
      case 'wavy':
        rr(c, hx - r * 1.12, hy - r * 0.55, r * 2.24, r * 1.35, r * 0.6); c.fill();
        for (let i = 0; i < 5; i++) { circle(c, hx - r * 0.9 + i * r * 0.45, hy + r * 0.82, r * 0.28); c.fill(); }
        break;
      case 'pony': ell(c, hx + r * 1.02, hy + r * 0.28, r * 0.32, r * 0.72, -0.35); c.fill(); break;
      case 'bun': circle(c, hx, hy - r * 1.02, r * 0.44); c.fill(); break;
      case 'curly':
        for (let i = 0; i <= 10; i++) {
          const a = Math.PI * 0.85 + i * (Math.PI * 1.3 / 10);
          circle(c, hx + Math.cos(a) * r * 0.98, hy + Math.sin(a) * r * 0.98, r * 0.38); c.fill();
        }
        break;
      default: break;
    }
  }
  function hairFront(c, L, hx, hy, r) {
    c.fillStyle = L.hairColor;
    switch (L.hair) {
      case 'bald':
        if (!L.hat) { circle(c, hx - r * 0.86, hy - r * 0.12, r * 0.2); c.fill(); circle(c, hx + r * 0.86, hy - r * 0.12, r * 0.2); c.fill(); }
        break;
      case 'buzz':
        c.globalAlpha = 0.88;
        c.beginPath(); c.arc(hx, hy, r * 1.01, Math.PI * 1.06, Math.PI * 1.94);
        c.quadraticCurveTo(hx, hy - r * 0.62, hx - r * 0.97, hy - r * 0.18); c.fill();
        c.globalAlpha = 1;
        break;
      case 'curly':
        for (let i = 0; i < 7; i++) { circle(c, hx - r * 0.78 + i * r * 0.26, hy - r * 0.74 + (i % 2) * r * 0.1, r * 0.28); c.fill(); }
        break;
      default:
        c.beginPath();
        c.moveTo(hx - r * 1.03, hy + r * 0.08);
        c.bezierCurveTo(hx - r * 1.12, hy - r * 1.4, hx + r * 1.12, hy - r * 1.4, hx + r * 1.03, hy + r * 0.08);
        c.bezierCurveTo(hx + r * 0.92, hy - r * 0.34, hx + r * 0.42, hy - r * 0.52, hx - r * 0.04, hy - r * 0.44);
        c.bezierCurveTo(hx - r * 0.42, hy - r * 0.36, hx - r * 0.86, hy - r * 0.24, hx - r * 1.03, hy + r * 0.08);
        c.fill();
        if (L.hair === 'long' || L.hair === 'wavy') {
          rr(c, hx - r * 1.08, hy - r * 0.2, r * 0.34, r * 1.15, r * 0.17); c.fill();
          rr(c, hx + r * 0.74, hy - r * 0.2, r * 0.34, r * 1.15, r * 0.17); c.fill();
        }
    }
  }
  function drawHead(c, L, hx, hy, r, mood, blink) {
    hairBack(c, L, hx, hy, r);
    c.fillStyle = shade(L.skin, -0.08);
    circle(c, hx - r * 0.96, hy + r * 0.12, r * 0.22); c.fill();
    circle(c, hx + r * 0.96, hy + r * 0.12, r * 0.22); c.fill();
    c.fillStyle = L.skin; circle(c, hx, hy, r); c.fill();
    if (L.earrings) {
      c.fillStyle = '#e8b64a';
      circle(c, hx - r * 0.98, hy + r * 0.44, r * 0.11); c.fill();
      circle(c, hx + r * 0.98, hy + r * 0.44, r * 0.11); c.fill();
    }
    if (L.beard) {
      c.fillStyle = L.hairColor;
      c.beginPath();
      c.moveTo(hx - r * 0.93, hy + r * 0.05);
      c.quadraticCurveTo(hx - r * 0.86, hy + r * 1.06, hx, hy + r * 1.07);
      c.quadraticCurveTo(hx + r * 0.86, hy + r * 1.06, hx + r * 0.93, hy + r * 0.05);
      c.quadraticCurveTo(hx + r * 0.5, hy + r * 0.66, hx, hy + r * 0.7);
      c.quadraticCurveTo(hx - r * 0.5, hy + r * 0.66, hx - r * 0.93, hy + r * 0.05);
      c.fill();
    }
    c.fillStyle = 'rgba(236,112,99,.3)';
    circle(c, hx - r * 0.56, hy + r * 0.34, r * 0.17); c.fill();
    circle(c, hx + r * 0.56, hy + r * 0.34, r * 0.17); c.fill();
    // eyes
    const ey = hy + r * 0.06, ex = r * 0.36, ink = '#2a1d17';
    c.strokeStyle = ink; c.fillStyle = ink; c.lineCap = 'round'; c.lineWidth = Math.max(1, r * 0.1);
    if (mood === 'delight') {
      [-1, 1].forEach(function (sd) { c.beginPath(); c.arc(hx + sd * ex, ey + r * 0.08, r * 0.13, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); });
    } else if (blink) {
      [-1, 1].forEach(function (sd) { c.beginPath(); c.moveTo(hx + sd * ex - r * 0.11, ey); c.lineTo(hx + sd * ex + r * 0.11, ey); c.stroke(); });
    } else {
      [-1, 1].forEach(function (sd) {
        c.fillStyle = ink; ell(c, hx + sd * ex, ey, r * 0.1, r * 0.13); c.fill();
        c.fillStyle = '#fff'; circle(c, hx + sd * ex + r * 0.035, ey - r * 0.05, r * 0.035); c.fill();
      });
    }
    if (mood === 'angry' || mood === 'worried') {
      c.lineWidth = Math.max(1, r * 0.09);
      [-1, 1].forEach(function (sd) {
        const inner = mood === 'angry' ? r * 0.2 : r * 0.36, outer = mood === 'angry' ? r * 0.36 : r * 0.26;
        c.beginPath(); c.moveTo(hx + sd * (ex - r * 0.16), ey - inner); c.lineTo(hx + sd * (ex + r * 0.16), ey - outer); c.stroke();
      });
    }
    // mouth
    const my = hy + r * 0.47, mc = L.beard ? '#f3d9c8' : '#5a2a20';
    c.strokeStyle = mc; c.lineWidth = Math.max(1, r * 0.09);
    if (mood === 'delight') {
      c.fillStyle = '#7a2a22';
      c.beginPath(); c.moveTo(hx - r * 0.28, my - r * 0.08); c.quadraticCurveTo(hx, my + r * 0.46, hx + r * 0.28, my - r * 0.08); c.closePath(); c.fill();
      c.fillStyle = '#f08c8c'; ell(c, hx, my + r * 0.14, r * 0.12, r * 0.07); c.fill();
    } else if (mood === 'neutral') {
      c.beginPath(); c.moveTo(hx - r * 0.16, my); c.lineTo(hx + r * 0.16, my); c.stroke();
    } else if (mood === 'worried') {
      c.beginPath(); c.moveTo(hx - r * 0.18, my + r * 0.04); c.quadraticCurveTo(hx - r * 0.06, my - r * 0.06, hx, my + r * 0.02);
      c.quadraticCurveTo(hx + r * 0.08, my + r * 0.08, hx + r * 0.18, my - r * 0.02); c.stroke();
    } else if (mood === 'angry') {
      c.beginPath(); c.arc(hx, my + r * 0.2, r * 0.2, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    } else {
      c.beginPath(); c.arc(hx, my - r * 0.14, r * 0.25, Math.PI * 0.18, Math.PI * 0.82); c.stroke();
    }
    if (L.glasses) {
      c.strokeStyle = '#2a2320'; c.lineWidth = Math.max(1, r * 0.08);
      circle(c, hx - ex, ey, r * 0.27); c.stroke();
      circle(c, hx + ex, ey, r * 0.27); c.stroke();
      c.beginPath(); c.moveTo(hx - ex + r * 0.27, ey); c.lineTo(hx + ex - r * 0.27, ey); c.stroke();
    }
    hairFront(c, L, hx, hy, r);
    if (L.hat === 'sun') {
      c.fillStyle = '#e4bd72'; rr(c, hx - r * 0.74, hy - r * 1.58, r * 1.48, r * 1.0, r * 0.46); c.fill();
      c.fillStyle = L.accent; c.fillRect(hx - r * 0.74, hy - r * 0.88, r * 1.48, r * 0.22);
      c.fillStyle = '#eccb86'; ell(c, hx, hy - r * 0.64, r * 1.72, r * 0.36); c.fill();
      c.strokeStyle = 'rgba(122,82,30,.35)'; c.lineWidth = Math.max(1, r * 0.06); ell(c, hx, hy - r * 0.64, r * 1.72, r * 0.36); c.stroke();
    } else if (L.hat === 'cap') {
      c.fillStyle = L.accent; c.beginPath(); c.arc(hx, hy - r * 0.22, r * 1.02, Math.PI, 0); c.closePath(); c.fill();
      c.fillStyle = shade(L.accent, -0.22); ell(c, hx + r * 0.78, hy - r * 0.24, r * 0.78, r * 0.17); c.fill();
      c.fillStyle = shade(L.accent, 0.25); circle(c, hx, hy - r * 1.22, r * 0.12); c.fill();
    }
  }
  function drawArm(c, L, sx, sy, s, a, side) {
    const len = 30 * s;
    const ex = sx + side * Math.sin(a) * len, ey = sy + Math.cos(a) * len;
    c.lineCap = 'round';
    c.strokeStyle = L.skin; c.lineWidth = 8 * s;
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke();
    c.strokeStyle = L.shirt; c.lineWidth = 10.5 * s;
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + (ex - sx) * 0.42, sy + (ey - sy) * 0.42); c.stroke();
    c.fillStyle = L.skin; circle(c, ex, ey, 4.8 * s); c.fill();
    return { x: ex, y: ey };
  }
  /** A person standing behind the counter; (x, waistY) anchors the waist, s ≈ 1 → 17 px head radius. */
  function drawPerson(c, L, x, waistY, s, mood, o) {
    o = o || {};
    s *= L.kid ? 0.84 : 1;
    const r = 17 * s, shY = waistY - 38 * s, hy = shY - 4 * s - r;
    const pants = mixC(L.accent, '#1b2a33', 0.6);
    const legSw = o.walk != null ? Math.sin(o.walk) * 4 * s : 0;
    c.fillStyle = pants;
    rr(c, x - 14 * s + legSw, waistY - 6 * s, 12 * s, 52 * s, 5 * s); c.fill();
    rr(c, x + 2 * s - legSw, waistY - 6 * s, 12 * s, 52 * s, 5 * s); c.fill();
    c.fillStyle = shade(L.skin, -0.05); c.fillRect(x - 5 * s, shY - 7 * s, 10 * s, 9 * s);
    // torso
    c.fillStyle = L.shirt;
    c.beginPath();
    c.moveTo(x - 22 * s, shY + 12 * s);
    c.quadraticCurveTo(x - 22 * s, shY, x - 11 * s, shY);
    c.lineTo(x + 11 * s, shY);
    c.quadraticCurveTo(x + 22 * s, shY, x + 22 * s, shY + 12 * s);
    c.lineTo(x + 19 * s, waistY + 4 * s);
    c.lineTo(x - 19 * s, waistY + 4 * s);
    c.closePath();
    c.fill();
    if (L.pattern !== 'solid') {
      c.save(); c.clip();
      c.fillStyle = L.accent; c.globalAlpha = 0.6;
      if (L.pattern === 'stripes') {
        for (let yy = shY + 6 * s; yy < waistY + 4 * s; yy += 9 * s) c.fillRect(x - 25 * s, yy, 50 * s, 3.4 * s);
      } else if (L.pattern === 'dots') {
        for (let yy = shY + 6 * s, row = 0; yy < waistY + 4 * s; yy += 8 * s, row++) {
          for (let xx = x - 20 * s + (row % 2) * 4 * s; xx < x + 22 * s; xx += 8 * s) { circle(c, xx, yy, 1.7 * s); c.fill(); }
        }
      } else {
        [[-10, 10], [9, 6], [-2, 24], [12, 26], [-14, 30]].forEach(function (p) {
          for (let i = 0; i < 5; i++) { const a = i * Math.PI * 0.4; circle(c, x + p[0] * s + Math.cos(a) * 2.4 * s, shY + p[1] * s + Math.sin(a) * 2.4 * s, 1.7 * s); c.fill(); }
        });
      }
      c.restore();
    }
    c.fillStyle = L.skin;
    c.beginPath(); c.moveTo(x - 6 * s, shY - 0.5); c.lineTo(x + 6 * s, shY - 0.5); c.lineTo(x, shY + 7 * s); c.closePath(); c.fill();
    // arms
    const swing = o.walk != null ? Math.sin(o.walk) * 0.35 : 0;
    drawArm(c, L, x - 19 * s, shY + 8 * s, s, 0.16 + swing, -1);
    let ra = 0.16 - swing;
    if (o.wave != null) ra = Math.PI - 0.55 + Math.sin(o.wave) * 0.35;
    else if (o.holding) ra = 0.95;
    const hand = drawArm(c, L, x + 19 * s, shY + 8 * s, s, ra, 1);
    drawHead(c, L, x, hy, r, mood, o.blink);
    if (o.holding) drawTreat(c, o.holding, hand.x + 2 * s, hand.y + 5 * s, s * 0.34);
    return { headTop: hy - r * (L.hat === 'sun' ? 1.6 : 1.15), hy: hy, r: r };
  }

  /* ---------- the treat (cup, scoops, blend, toppings) ---------- */
  function cupPath(c, cx, by, tw, bw, h) {
    c.beginPath();
    c.moveTo(cx - tw / 2, by - h);
    c.lineTo(cx + tw / 2, by - h);
    c.lineTo(cx + bw / 2, by);
    c.quadraticCurveTo(cx, by + h * 0.05, cx - bw / 2, by);
    c.closePath();
  }
  function drawCupBody(c, cx, by, tw, bw, h, s) {
    c.fillStyle = 'rgba(12,28,33,.15)'; ell(c, cx, by + 2 * s, bw * 0.72, 5 * s); c.fill();
    cupPath(c, cx, by, tw, bw, h);
    c.fillStyle = '#fffaf2'; c.fill();
    c.save(); c.clip();
    // wavy sea band + sunset band
    const y1 = by - h * 0.6;
    c.fillStyle = C.sea;
    c.beginPath(); c.moveTo(cx - tw, y1);
    for (let i = 0; i <= 8; i++) { const xx = cx - tw / 2 + (tw * i) / 8; c.quadraticCurveTo(xx - tw / 32, y1 + (i % 2 ? -3 : 3) * s, xx, y1); }
    c.lineTo(cx + tw, by + 4 * s); c.lineTo(cx - tw, by + 4 * s); c.closePath(); c.fill();
    c.fillStyle = C.accent; c.fillRect(cx - tw, by - h * 0.28, tw * 2, h * 0.09);
    c.fillStyle = 'rgba(255,255,255,.75)';
    for (let i = 0; i < 4; i++) { circle(c, cx - tw * 0.27 + i * tw * 0.18, by - h * 0.44, 1.6 * s); c.fill(); }
    c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(cx - tw * 0.36, by - h, tw * 0.1, h);
    c.restore();
    c.strokeStyle = 'rgba(16,37,43,.22)'; c.lineWidth = 1.2 * s; cupPath(c, cx, by, tw, bw, h); c.stroke();
    rr(c, cx - tw / 2 - 3 * s, by - h - 4 * s, tw + 6 * s, 8 * s, 4 * s);
    c.fillStyle = '#f2e7d7'; c.fill(); c.stroke();
  }
  function scoopBall(c, x, y, r, id) {
    const f = FL[id] || FL.vainilla;
    const skirt = function (col, dy) {
      c.fillStyle = col;
      for (let i = -2; i <= 2; i++) { circle(c, x + i * r * 0.43, y + r * 0.66 + dy - Math.abs(i) * r * 0.07, r * 0.31); c.fill(); }
    };
    skirt(f.d, r * 0.1);
    c.fillStyle = f.d; circle(c, x, y + r * 0.06, r); c.fill();
    skirt(f.c, 0);
    c.fillStyle = f.c; circle(c, x, y, r * 0.98); c.fill();
    c.fillStyle = f.sp;
    const n = id === 'horchata' || id === 'vainilla' ? 8 : id === 'fresa' || id === 'limon' ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const p = SPECKS[i];
      if (id === 'limon') { c.fillRect(x + p[0] * r, y + p[1] * r, r * 0.14, r * 0.05); }
      else { circle(c, x + p[0] * r, y + p[1] * r, r * (id === 'fresa' ? 0.08 : id === 'horchata' ? 0.055 : 0.04)); c.fill(); }
    }
    c.fillStyle = 'rgba(255,255,255,.5)'; ell(c, x - r * 0.38, y - r * 0.42, r * 0.27, r * 0.14, -0.7); c.fill();
  }
  function bit(c, id, x, y, sz, rot) {
    c.save(); c.translate(x, y); c.rotate(rot);
    switch (id) {
      case 'galleta':
        c.fillStyle = '#b97a40'; rr(c, -sz, -sz * 0.75, sz * 2, sz * 1.5, sz * 0.4); c.fill();
        c.fillStyle = '#4a2a1a'; circle(c, -sz * 0.35, -sz * 0.1, sz * 0.22); c.fill(); circle(c, sz * 0.4, sz * 0.2, sz * 0.18); c.fill();
        break;
      case 'fresas':
        c.fillStyle = '#e0384f'; c.beginPath(); c.moveTo(0, sz); c.quadraticCurveTo(-sz * 1.2, -sz * 0.2, 0, -sz * 0.8); c.quadraticCurveTo(sz * 1.2, -sz * 0.2, 0, sz); c.fill();
        c.fillStyle = '#ffd86b'; circle(c, -sz * 0.2, 0, sz * 0.12); c.fill(); circle(c, sz * 0.25, sz * 0.2, sz * 0.12); c.fill();
        break;
      case 'mango':
        c.fillStyle = '#ffa21a'; c.fillRect(-sz * 0.8, -sz * 0.8, sz * 1.6, sz * 1.6);
        c.fillStyle = '#ffc95a'; c.fillRect(-sz * 0.8, -sz * 0.8, sz * 1.6, sz * 0.45);
        break;
      case 'nuez':
        c.fillStyle = '#9a6236'; ell(c, 0, 0, sz * 1.05, sz * 0.62); c.fill();
        c.strokeStyle = '#6a3d1e'; c.lineWidth = Math.max(0.8, sz * 0.18); c.beginPath(); c.moveTo(-sz * 0.8, 0); c.lineTo(sz * 0.8, 0); c.stroke();
        break;
      case 'chispas':
        c.fillStyle = '#3f2416'; c.beginPath(); c.moveTo(0, -sz); c.quadraticCurveTo(sz * 0.9, sz * 0.6, 0, sz * 0.6); c.quadraticCurveTo(-sz * 0.9, sz * 0.6, 0, -sz); c.fill();
        break;
      case 'coco':
        c.fillStyle = '#fffdf6'; rr(c, -sz, -sz * 0.35, sz * 2, sz * 0.7, sz * 0.3); c.fill();
        c.strokeStyle = 'rgba(122,88,60,.35)'; c.lineWidth = 0.8; c.stroke();
        break;
      default: break;
    }
    c.restore();
  }
  function scoopLayout(n, sr) {
    if (n <= 1) return [[0, -sr * 0.42]];
    if (n === 2) return [[-sr * 0.6, -sr * 0.36], [sr * 0.6, -sr * 0.36]];
    return [[-sr * 0.62, -sr * 0.32], [sr * 0.62, -sr * 0.32], [0, -sr * 1.22]];
  }
  /** Draw a (possibly partial) treat. Returns the y of its top. */
  function drawTreat(c, m, cx, by, s, ghostLabel) {
    if (!m || !m.size) {
      const d = CUP.M;
      c.save();
      c.setLineDash([6 * s, 5 * s]); c.strokeStyle = 'rgba(16,37,43,.35)'; c.lineWidth = 2 * s;
      cupPath(c, cx, by, d.tw * s, d.bw * s, d.h * s); c.stroke();
      c.restore();
      if (ghostLabel) txt(c, ghostLabel, cx, by - d.h * s * 0.5, 11 * s + 2, 'rgba(16,37,43,.6)', 'center', 700);
      return by - d.h * s;
    }
    const d = CUP[m.size] || CUP.M;
    const ps = fxP(m, 'size', 0.35);
    c.save();
    if (ps < 1) { const k = 0.82 + 0.18 * easeOutBack(ps); c.translate(cx, by); c.scale(k, k); c.translate(-cx, -by); }
    const tw = d.tw * s, bw = d.bw * s, h = d.h * s, rimY = by - h;
    const zone = blendZone(m.blendVal);
    let top = rimY - 2 * s;
    if (m.flavors.length) {
      if (zone) top = drawDome(c, m, zone, cx, rimY, tw, s);
      else top = drawScoops(c, m, cx, rimY, tw, s);
    } else if (m.mixins.length) {
      m.mixins.forEach(function (id, j) {
        const p = easeOutCubic(fxP(m, 'm:' + id, 0.4));
        for (let i = 0; i < 4; i++) bit(c, id, cx - tw * 0.3 + i * tw * 0.2, rimY - 2 * s - (1 - p) * 40 * s - j * 2 * s, 3 * s, i + j);
      });
    }
    drawCupBody(c, cx, by, tw, bw, h, s);
    top = drawToppings(c, m, cx, rimY, top, tw, s);
    c.restore();
    return top;
  }
  function drawScoops(c, m, cx, rimY, tw, s) {
    const sr = tw * 0.31, pos = scoopLayout(m.flavors.length, sr);
    let top = rimY;
    m.flavors.forEach(function (f, i) {
      const p = fxP(m, 'f:' + f, 0.55);
      const drop = (1 - easeOutBounce(p)) * 70 * s;
      const x = cx + pos[i][0], y = rimY + pos[i][1] - drop;
      scoopBall(c, x, y, sr, f);
      top = Math.min(top, rimY + pos[i][1] - sr);
    });
    // mix-ins sprinkled on the scoops
    m.mixins.forEach(function (id, j) {
      const rnd = mulberry32(hashStr(id));
      const p = easeOutCubic(fxP(m, 'm:' + id, 0.5));
      for (let i = 0; i < 5; i++) {
        const sp = pos[(i + j) % pos.length];
        const a = Math.PI * (1.1 + rnd() * 0.8), dist = sr * (0.35 + rnd() * 0.45);
        const x = cx + sp[0] + Math.cos(a) * dist, y = rimY + sp[1] + Math.sin(a) * dist * 0.9;
        bit(c, id, x, y - (1 - p) * (50 + i * 8) * s, 3.4 * s, rnd() * 6);
      }
    });
    return top;
  }
  function drawDome(c, m, zone, cx, rimY, tw, s) {
    const cols = m.flavors.map(function (f) { return FL[f].c; });
    const col = avgC(cols);
    const hgt = zone === 'soupy' ? tw * 0.1 : tw * 0.38;
    const top = rimY - hgt;
    const domePath = function () {
      c.beginPath();
      c.moveTo(cx - tw * 0.53, rimY + 3 * s);
      if (zone === 'soupy') c.quadraticCurveTo(cx, top - hgt, cx + tw * 0.53, rimY + 3 * s);
      else c.bezierCurveTo(cx - tw * 0.5, top - hgt * 0.27, cx + tw * 0.5, top - hgt * 0.27, cx + tw * 0.53, rimY + 3 * s);
      c.closePath();
    };
    domePath();
    c.fillStyle = col; c.fill();
    c.save(); domePath(); c.clip();
    const rnd = mulberry32(hashStr(m.flavors.join('') + zone));
    if (zone === 'chunky') {
      for (let i = 0; i < 9; i++) {
        c.fillStyle = cols[i % cols.length];
        circle(c, cx + (rnd() - 0.5) * tw * 0.9, rimY - rnd() * hgt * 0.9, tw * (0.08 + rnd() * 0.07)); c.fill();
      }
    } else if (zone === 'regular') {
      c.strokeStyle = rgba(cols.length > 1 ? cols[1] : shade(col, 0.35), 0.85);
      c.lineWidth = 3 * s;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(cx + (i - 1) * tw * 0.18, rimY - hgt * 0.3, tw * 0.16, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); }
    }
    c.fillStyle = 'rgba(255,255,255,.35)'; ell(c, cx - tw * 0.2, top + hgt * 0.32, tw * 0.16, hgt * 0.14, -0.4); c.fill();
    c.restore();
    if (zone === 'soupy') {
      c.fillStyle = col;
      [[-0.3, 9], [0.12, 14], [0.36, 7]].forEach(function (d) { rr(c, cx + d[0] * tw - 2.5 * s, rimY - 2 * s, 5 * s, d[1] * s, 2.5 * s); c.fill(); });
    }
    // mix-in bits
    const n = zone === 'chunky' ? 5 : zone === 'regular' ? 3 : zone === 'smooth' ? 2 : 0;
    m.mixins.forEach(function (id) {
      const r2 = mulberry32(hashStr(id + 'd'));
      for (let i = 0; i < n; i++) {
        const dx = (r2() - 0.5) * tw * 0.75;
        const yy = rimY - hgt * (0.15 + r2() * 0.6) * (1 - Math.pow(Math.abs(dx) / (tw * 0.55), 2));
        bit(c, id, cx + dx, yy, (zone === 'chunky' ? 3.6 : 2.4) * s, r2() * 6);
      }
    });
    if (zone === 'smooth' || zone === 'regular') {
      c.fillStyle = col;
      c.beginPath(); c.moveTo(cx - 6 * s, top + 3 * s); c.quadraticCurveTo(cx, top - 9 * s, cx + 7 * s, top - 3 * s); c.quadraticCurveTo(cx + 2 * s, top + 1 * s, cx + 6 * s, top + 4 * s); c.closePath(); c.fill();
    }
    return top - (zone === 'soupy' ? 0 : 4 * s);
  }
  function drawToppings(c, m, cx, rimY, top, tw, s) {
    const has = function (id) { return m.toppings.indexOf(id) >= 0; };
    const hw = tw * 0.42;
    let surf = top;
    if (has('crema')) surf = drawCrema(c, cx, top, tw, s, fxP(m, 't:crema', 0.5));
    const span = Math.max(8 * s, rimY - surf);
    const surfY = function (dx) { return surf + span * Math.min(1, Math.pow(Math.abs(dx) / hw, 2)) * 0.72 + 4 * s; };
    ['chocolate', 'cajeta', 'chamoy'].forEach(function (id, k) {
      if (!has(id)) return;
      const p = easeOutCubic(fxP(m, 't:' + id, 0.6)), col = SYRUP[id];
      const half = hw * (has('crema') ? 0.78 : 0.95);
      const dy = function (t) {
        const dx = (t * 2 - 1) * half;
        return { x: cx + dx, y: surfY(dx * (hw / half) * 0.8) + span * 0.06 + Math.sin(t * Math.PI * 4.2 + k * 1.7) * 3.6 * s + k * 4.5 * s };
      };
      c.save();
      // the drizzle sweeps across from the left as it is poured
      c.beginPath(); c.rect(cx - half - 8 * s, surf - 60 * s, (half * 2 + 16 * s) * p, rimY + 60 * s - surf); c.clip();
      c.strokeStyle = col; c.lineWidth = 3.2 * s; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath();
      for (let i = 0; i <= 28; i++) { const q = dy(i / 28); if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); }
      c.stroke();
      c.fillStyle = col; c.lineWidth = 3 * s;
      [0.14 + k * 0.05, 0.47 + k * 0.04, 0.83 - k * 0.05].forEach(function (t, j) {
        const q = dy(t), len = (5 + ((j + k) % 3) * 3.5) * s;
        c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x, q.y + len); c.stroke();
        circle(c, q.x, q.y + len + 0.6 * s, 2.3 * s); c.fill();
      });
      c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 1 * s;
      c.beginPath();
      for (let i = 2; i <= 26; i++) { const q = dy(i / 28); if (i > 2) c.lineTo(q.x - 0.6 * s, q.y - 1 * s); else c.moveTo(q.x - 0.6 * s, q.y - 1 * s); }
      c.stroke();
      c.restore();
    });
    if (has('confeti')) {
      const p = fxP(m, 't:confeti', 0.5), rnd = mulberry32(77);
      c.globalAlpha = 0.25 + 0.75 * p;
      for (let i = 0; i < 18; i++) {
        const dx = (rnd() - 0.5) * hw * 1.7, y = surfY(dx) - 2 * s + rnd() * span * 0.25 - (1 - easeOutCubic(p)) * 30 * s;
        c.save(); c.translate(cx + dx, y); c.rotate(rnd() * 3);
        c.fillStyle = PAPEL[i % PAPEL.length]; rr(c, -2.4 * s, -0.9 * s, 4.8 * s, 1.8 * s, 0.9 * s); c.fill();
        c.restore();
      }
      c.globalAlpha = 1;
    }
    if (has('tajin')) {
      const p = fxP(m, 't:tajin', 0.5), rnd = mulberry32(91);
      c.globalAlpha = 0.2 + 0.8 * p;
      for (let i = 0; i < 34; i++) {
        const dx = (rnd() - 0.5) * hw * 1.6, y = surfY(dx) - 2 * s + rnd() * span * 0.3 - (1 - p) * 20 * s;
        c.fillStyle = i % 3 ? '#d4471f' : '#a8301a'; circle(c, cx + dx, y, (0.8 + rnd() * 0.7) * s); c.fill();
      }
      c.globalAlpha = 1;
    }
    if (has('barquillo')) {
      const p = easeOutCubic(fxP(m, 't:barquillo', 0.45));
      c.save(); c.translate(cx + hw * 0.42, surf + 10 * s); c.rotate(0.42); c.translate(0, -(1 - p) * 40 * s);
      c.fillStyle = '#e2b066'; rr(c, -4.6 * s, -44 * s, 9.2 * s, 44 * s, 3 * s); c.fill();
      c.save(); rr(c, -4.6 * s, -44 * s, 9.2 * s, 44 * s, 3 * s); c.clip();
      c.strokeStyle = '#c18839'; c.lineWidth = 1.3 * s;
      for (let yy = -48; yy < 4; yy += 6) { c.beginPath(); c.moveTo(-6 * s, yy * s); c.lineTo(6 * s, (yy + 6) * s); c.stroke(); }
      c.restore();
      c.fillStyle = '#f3d29a'; ell(c, 0, -44 * s, 4.6 * s, 1.8 * s); c.fill();
      c.restore();
    }
    if (has('cereza')) {
      const p = fxP(m, 't:cereza', 0.55);
      const y = surf - 5 * s - (1 - easeOutBounce(p)) * 60 * s;
      c.strokeStyle = '#4f7f35'; c.lineWidth = 1.8 * s; c.lineCap = 'round';
      c.beginPath(); c.moveTo(cx + 1 * s, y - 5 * s); c.quadraticCurveTo(cx + 2 * s, y - 16 * s, cx + 9 * s, y - 21 * s); c.stroke();
      c.fillStyle = '#d61f3a'; circle(c, cx, y, 7.4 * s); c.fill();
      c.fillStyle = 'rgba(255,255,255,.6)'; ell(c, cx - 2.6 * s, y - 2.6 * s, 2.2 * s, 1.4 * s, -0.6); c.fill();
      surf = Math.min(surf, y - 14 * s);
    }
    return surf;
  }
  function drawCrema(c, cx, top, tw, s, p) {
    const e = RC.reduced ? 1 : easeOutBack(p);
    const w = tw * 0.68, by = top + 7 * s;
    if (e <= 0.01) return top;
    c.save(); c.translate(cx, by); c.scale(1, Math.max(0.02, e));
    const tiers = [[w, w * 0.27, 0], [w * 0.76, w * 0.25, -w * 0.21], [w * 0.5, w * 0.23, -w * 0.4]];
    tiers.forEach(function (t) {
      c.fillStyle = '#e9dccb'; ell(c, 0, t[2] - t[1] / 2 + 1.5 * s, t[0] / 2, t[1] / 2); c.fill();
      c.fillStyle = '#fffaf3'; ell(c, 0, t[2] - t[1] / 2, t[0] / 2, t[1] / 2); c.fill();
      c.strokeStyle = 'rgba(200,180,150,.55)'; c.lineWidth = 1 * s;
      c.beginPath(); c.ellipse(0, t[2] - t[1] / 2, t[0] / 2.6, t[1] / 3.2, 0, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
    });
    c.fillStyle = '#fffaf3';
    c.beginPath(); c.moveTo(-w * 0.14, -w * 0.48); c.quadraticCurveTo(-w * 0.04, -w * 0.78, w * 0.12, -w * 0.62); c.quadraticCurveTo(w * 0.02, -w * 0.58, w * 0.14, -w * 0.48); c.closePath(); c.fill();
    c.restore();
    return by - w * 0.66 * e;
  }

  /* ---------- ingredient icons (ticket + buttons) ---------- */
  function drawIcon(c, kind, id, x, y, s) {
    c.save();
    c.lineJoin = 'round'; c.lineCap = 'round';
    if (kind === 'size') iconCup(c, x, y, s, id);
    else if (kind === 'flavor') scoopBall(c, x, y - s * 0.05, s * 0.37, id);
    else if (kind === 'mixin') iconMixin(c, x, y, s * 1.2, id);
    else if (kind === 'blend') iconBlender(c, x, y, s, id, false);
    else if (kind === 'noblend') iconBlender(c, x, y, s, null, true);
    else if (kind === 'topping') iconTopping(c, x, y, s * 1.2, id);
    else if (kind === 'none') { c.strokeStyle = 'rgba(16,37,43,.3)'; c.lineWidth = 2; c.beginPath(); c.moveTo(x - s * 0.2, y); c.lineTo(x + s * 0.2, y); c.stroke(); }
    c.restore();
  }
  function iconCup(c, x, y, s, L) {
    const f = L === 'S' ? 0.8 : L === 'L' ? 1.1 : 0.95;
    const h = s * 0.76 * f, tw = s * 0.72 * f, bw = s * 0.5 * f, by = y + s * 0.38, ty = by - h;
    c.beginPath(); c.moveTo(x - tw / 2, ty); c.lineTo(x + tw / 2, ty); c.lineTo(x + bw / 2, by); c.lineTo(x - bw / 2, by); c.closePath();
    c.fillStyle = '#fffaf2'; c.fill();
    c.save(); c.clip(); c.fillStyle = C.sea; c.fillRect(x - tw, by - h * 0.2, tw * 2, h * 0.2); c.restore();
    c.lineWidth = Math.max(1, s * 0.05); c.strokeStyle = 'rgba(16,37,43,.5)'; c.stroke();
    rr(c, x - tw / 2 - s * 0.04, ty - s * 0.06, tw + s * 0.08, s * 0.1, s * 0.04); c.fillStyle = '#efe3d1'; c.fill(); c.stroke();
    txt(c, L, x, ty + h * 0.42, s * 0.36 * Math.max(0.85, f), C.ink, 'center', 800);
  }
  function iconMixin(c, x, y, s, id) {
    switch (id) {
      case 'galleta': {
        c.fillStyle = '#a8692f'; circle(c, x, y + s * 0.03, s * 0.34); c.fill();
        c.fillStyle = '#d0954f'; circle(c, x, y, s * 0.33); c.fill();
        c.fillStyle = '#4a2a1a';
        [[-0.14, -0.12], [0.12, -0.16], [0.16, 0.1], [-0.1, 0.14], [0.02, -0.01]].forEach(function (p) { circle(c, x + p[0] * s, y + p[1] * s, s * 0.05); c.fill(); });
        break;
      }
      case 'fresas': {
        c.fillStyle = '#e0384f';
        c.beginPath(); c.moveTo(x, y + s * 0.38);
        c.bezierCurveTo(x - s * 0.44, y + s * 0.08, x - s * 0.34, y - s * 0.26, x, y - s * 0.18);
        c.bezierCurveTo(x + s * 0.34, y - s * 0.26, x + s * 0.44, y + s * 0.08, x, y + s * 0.38); c.fill();
        c.fillStyle = '#ffd86b';
        [[-0.12, -0.02], [0.1, 0.0], [0, 0.16], [-0.16, 0.12], [0.16, 0.14]].forEach(function (p) { ell(c, x + p[0] * s, y + p[1] * s, s * 0.022, s * 0.035); c.fill(); });
        c.fillStyle = '#4caf50';
        c.beginPath(); c.moveTo(x - s * 0.2, y - s * 0.24); c.lineTo(x, y - s * 0.14); c.lineTo(x + s * 0.2, y - s * 0.24); c.lineTo(x + s * 0.06, y - s * 0.3); c.lineTo(x, y - s * 0.4); c.lineTo(x - s * 0.06, y - s * 0.3); c.closePath(); c.fill();
        break;
      }
      case 'mango': {
        const cube = function (cx, cy, e) {
          c.fillStyle = '#ffc95a'; c.beginPath(); c.moveTo(cx, cy - e); c.lineTo(cx + e, cy - e * 0.5); c.lineTo(cx, cy); c.lineTo(cx - e, cy - e * 0.5); c.closePath(); c.fill();
          c.fillStyle = '#ffa21a'; c.beginPath(); c.moveTo(cx - e, cy - e * 0.5); c.lineTo(cx, cy); c.lineTo(cx, cy + e); c.lineTo(cx - e, cy + e * 0.5); c.closePath(); c.fill();
          c.fillStyle = '#e8870f'; c.beginPath(); c.moveTo(cx + e, cy - e * 0.5); c.lineTo(cx, cy); c.lineTo(cx, cy + e); c.lineTo(cx + e, cy + e * 0.5); c.closePath(); c.fill();
        };
        cube(x - s * 0.17, y + s * 0.12, s * 0.17); cube(x + s * 0.17, y + s * 0.12, s * 0.17); cube(x, y - s * 0.12, s * 0.17);
        break;
      }
      case 'nuez': {
        [[-0.12, -0.04, -0.5], [0.13, 0.08, 0.4]].forEach(function (p) {
          c.fillStyle = '#7a4520'; ell(c, x + p[0] * s, y + p[1] * s + s * 0.02, s * 0.2, s * 0.13, p[2]); c.fill();
          c.fillStyle = '#a5683a'; ell(c, x + p[0] * s, y + p[1] * s, s * 0.2, s * 0.12, p[2]); c.fill();
          c.strokeStyle = '#6a3d1e'; c.lineWidth = Math.max(1, s * 0.035);
          c.save(); c.translate(x + p[0] * s, y + p[1] * s); c.rotate(p[2]);
          c.beginPath(); c.moveTo(-s * 0.15, 0); c.lineTo(s * 0.15, 0); c.stroke();
          c.beginPath(); c.moveTo(-s * 0.08, -s * 0.07); c.lineTo(-s * 0.06, s * 0.07); c.moveTo(s * 0.06, -s * 0.07); c.lineTo(s * 0.08, s * 0.07); c.stroke();
          c.restore();
        });
        break;
      }
      case 'chispas': {
        [[-0.16, 0.1], [0.14, 0.12], [0, -0.08], [-0.2, -0.14], [0.2, -0.14]].forEach(function (p, i) {
          const cx = x + p[0] * s, cy = y + p[1] * s, e = s * (i === 2 ? 0.14 : 0.11);
          c.fillStyle = '#3f2416';
          c.beginPath(); c.moveTo(cx, cy - e); c.quadraticCurveTo(cx + e * 0.95, cy + e * 0.65, cx, cy + e * 0.65); c.quadraticCurveTo(cx - e * 0.95, cy + e * 0.65, cx, cy - e); c.fill();
          c.fillStyle = 'rgba(255,255,255,.3)'; circle(c, cx - e * 0.2, cy + e * 0.1, e * 0.18); c.fill();
        });
        break;
      }
      case 'coco': {
        c.fillStyle = '#6e4325'; c.beginPath(); c.arc(x, y - s * 0.02, s * 0.34, 0, Math.PI); c.closePath(); c.fill();
        c.fillStyle = '#fffdf6'; c.beginPath(); c.arc(x, y - s * 0.02, s * 0.27, 0, Math.PI); c.closePath(); c.fill();
        c.fillStyle = '#efe6d6'; ell(c, x, y - s * 0.02, s * 0.34, s * 0.07); c.fill();
        c.fillStyle = '#fffdf6';
        [[-0.2, -0.22, 0.4], [0.06, -0.3, -0.3], [0.22, -0.18, 0.8]].forEach(function (p) { ell(c, x + p[0] * s, y + p[1] * s, s * 0.08, s * 0.03, p[2]); c.fill(); });
        c.strokeStyle = 'rgba(110,67,37,.4)'; c.lineWidth = 1;
        [[-0.2, -0.22, 0.4], [0.06, -0.3, -0.3], [0.22, -0.18, 0.8]].forEach(function (p) { ell(c, x + p[0] * s, y + p[1] * s, s * 0.08, s * 0.03, p[2]); c.stroke(); });
        break;
      }
      default: break;
    }
  }
  function iconBlender(c, x, y, s, zone, crossed) {
    const jt = y - s * 0.42, jb = y + s * 0.18, tw = s * 0.54, bw = s * 0.4;
    const jar = function () { c.beginPath(); c.moveTo(x - tw / 2, jt); c.lineTo(x + tw / 2, jt); c.lineTo(x + bw / 2, jb); c.lineTo(x - bw / 2, jb); c.closePath(); };
    jar(); c.fillStyle = 'rgba(255,255,255,.7)'; c.fill();
    if (!crossed) {
      c.save(); jar(); c.clip();
      const lv = jt + (jb - jt) * 0.3;
      c.fillStyle = '#f4b49c'; c.fillRect(x - tw, lv, tw * 2, jb - lv);
      if (zone === 'chunky') {
        c.fillStyle = '#b4562f';
        [[-0.1, 0.45], [0.08, 0.62], [-0.04, 0.8], [0.12, 0.38], [-0.14, 0.7]].forEach(function (p) { c.fillRect(x + p[0] * s - s * 0.045, jt + (jb - jt) * p[1], s * 0.09, s * 0.09); });
      } else if (zone === 'regular') {
        c.strokeStyle = '#c96b45'; c.lineWidth = Math.max(1.2, s * 0.06);
        c.beginPath(); c.moveTo(x - tw / 2, lv + s * 0.14);
        for (let i = 1; i <= 4; i++) c.quadraticCurveTo(x - tw / 2 + (i - 0.5) * tw / 4, lv + s * (i % 2 ? 0.04 : 0.24), x - tw / 2 + i * tw / 4, lv + s * 0.14);
        c.stroke();
      } else if (zone === 'smooth' || zone === 'soupy') {
        c.fillStyle = 'rgba(255,255,255,.55)'; ell(c, x - s * 0.06, lv + s * 0.14, s * 0.13, s * 0.04, -0.2); c.fill();
        c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = Math.max(1, s * 0.04);
        c.beginPath(); c.arc(x + s * 0.02, lv + s * 0.3, s * 0.1, Math.PI * 0.1, Math.PI * 1.3); c.stroke();
      }
      c.restore();
    }
    jar(); c.strokeStyle = 'rgba(16,37,43,.6)'; c.lineWidth = Math.max(1.2, s * 0.05); c.stroke();
    rr(c, x - tw / 2 - s * 0.02, jt - s * 0.08, tw + s * 0.04, s * 0.09, s * 0.03); c.fillStyle = C.night2; c.fill();
    rr(c, x - s * 0.27, jb, s * 0.54, s * 0.22, s * 0.06); c.fillStyle = C.sea; c.fill();
    c.fillStyle = '#fffaf2'; circle(c, x, jb + s * 0.11, s * 0.05); c.fill();
    if (crossed) {
      c.strokeStyle = C.bad; c.lineWidth = Math.max(2, s * 0.09);
      circle(c, x, y - s * 0.05, s * 0.4); c.stroke();
      c.beginPath(); c.moveTo(x - s * 0.28, y + s * 0.23); c.lineTo(x + s * 0.28, y - s * 0.33); c.stroke();
    }
  }
  function iconTopping(c, x, y, s, id) {
    switch (id) {
      case 'crema': {
        const w = s * 0.7, by = y + s * 0.3;
        [[w, w * 0.3, 0], [w * 0.74, w * 0.28, -w * 0.24], [w * 0.46, w * 0.26, -w * 0.46]].forEach(function (t) {
          c.fillStyle = '#c9b493'; ell(c, x, by + t[2] - t[1] / 2 + 1.5, t[0] / 2 + 1, t[1] / 2 + 1); c.fill();
          c.fillStyle = '#fffaf3'; ell(c, x, by + t[2] - t[1] / 2, t[0] / 2, t[1] / 2); c.fill();
          c.strokeStyle = 'rgba(150,120,80,.55)'; c.lineWidth = 1; c.stroke();
        });
        c.fillStyle = '#fffaf3';
        c.beginPath(); c.moveTo(x - w * 0.12, by - w * 0.56); c.quadraticCurveTo(x - w * 0.02, by - w * 0.88, x + w * 0.14, by - w * 0.7); c.quadraticCurveTo(x + w * 0.02, by - w * 0.66, x + w * 0.14, by - w * 0.56); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(150,120,80,.55)'; c.lineWidth = 1; c.stroke();
        break;
      }
      case 'chocolate': case 'cajeta': case 'chamoy': {
        const col = SYRUP[id];
        c.fillStyle = col; rr(c, x - s * 0.17, y - s * 0.14, s * 0.34, s * 0.52, s * 0.08); c.fill();
        c.fillStyle = 'rgba(255,250,242,.9)'; c.fillRect(x - s * 0.17, y + s * 0.04, s * 0.34, s * 0.14);
        c.fillStyle = col; circle(c, x, y + s * 0.11, s * 0.045); c.fill();
        c.fillStyle = '#f6f1e9'; c.beginPath(); c.moveTo(x - s * 0.15, y - s * 0.14); c.lineTo(x + s * 0.15, y - s * 0.14); c.lineTo(x + s * 0.05, y - s * 0.3); c.lineTo(x - s * 0.05, y - s * 0.3); c.closePath(); c.fill();
        c.fillRect(x - s * 0.02, y - s * 0.42, s * 0.04, s * 0.13);
        c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(x - s * 0.12, y - s * 0.1, s * 0.05, s * 0.12);
        c.fillStyle = col;
        c.beginPath(); c.moveTo(x + s * 0.3, y - s * 0.1); c.quadraticCurveTo(x + s * 0.4, y + s * 0.06, x + s * 0.3, y + s * 0.1); c.quadraticCurveTo(x + s * 0.2, y + s * 0.06, x + s * 0.3, y - s * 0.1); c.fill();
        break;
      }
      case 'confeti': {
        const rnd = mulberry32(5);
        for (let i = 0; i < 12; i++) {
          c.save(); c.translate(x + (rnd() - 0.5) * s * 0.66, y + (rnd() - 0.5) * s * 0.56); c.rotate(rnd() * 3);
          c.fillStyle = PAPEL[i % PAPEL.length]; rr(c, -s * 0.09, -s * 0.03, s * 0.18, s * 0.06, s * 0.03); c.fill();
          c.restore();
        }
        break;
      }
      case 'tajin': {
        c.fillStyle = '#d4471f';
        c.beginPath(); c.moveTo(x - s * 0.3, y - s * 0.12);
        c.quadraticCurveTo(x + s * 0.05, y - s * 0.2, x + s * 0.3, y + s * 0.26);
        c.quadraticCurveTo(x - s * 0.05, y + s * 0.12, x - s * 0.3, y + s * 0.04); c.closePath(); c.fill();
        c.fillStyle = 'rgba(255,255,255,.3)'; ell(c, x - s * 0.06, y - s * 0.07, s * 0.12, s * 0.025, 0.25); c.fill();
        c.strokeStyle = '#4f8f35'; c.lineWidth = Math.max(1.4, s * 0.07);
        c.beginPath(); c.moveTo(x - s * 0.3, y - s * 0.04); c.quadraticCurveTo(x - s * 0.42, y - s * 0.1, x - s * 0.38, y - s * 0.24); c.stroke();
        c.fillStyle = '#8fc24a'; c.beginPath(); c.arc(x + s * 0.2, y - s * 0.18, s * 0.15, Math.PI * 0.15, Math.PI * 1.15); c.closePath(); c.fill();
        c.fillStyle = '#c9e89a'; c.beginPath(); c.arc(x + s * 0.2, y - s * 0.18, s * 0.1, Math.PI * 0.15, Math.PI * 1.15); c.closePath(); c.fill();
        c.fillStyle = '#b8321a';
        [[-0.2, 0.3], [-0.05, 0.36], [0.1, 0.38], [-0.28, 0.22], [0.02, 0.28]].forEach(function (p) { circle(c, x + p[0] * s, y + p[1] * s, s * 0.025); c.fill(); });
        break;
      }
      case 'cereza': {
        c.strokeStyle = '#4f7f35'; c.lineWidth = Math.max(1.4, s * 0.06);
        c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + s * 0.02, y - s * 0.3, x + s * 0.2, y - s * 0.38); c.stroke();
        c.fillStyle = '#5ea34a'; ell(c, x + s * 0.13, y - s * 0.34, s * 0.1, s * 0.045, -0.5); c.fill();
        c.fillStyle = '#a3142b'; circle(c, x, y + s * 0.13, s * 0.25); c.fill();
        c.fillStyle = '#d61f3a'; circle(c, x - s * 0.01, y + s * 0.11, s * 0.23); c.fill();
        c.fillStyle = 'rgba(255,255,255,.6)'; ell(c, x - s * 0.08, y + s * 0.03, s * 0.07, s * 0.045, -0.6); c.fill();
        break;
      }
      case 'barquillo': {
        c.save(); c.translate(x, y); c.rotate(-0.7);
        c.fillStyle = '#e2b066'; rr(c, -s * 0.42, -s * 0.11, s * 0.84, s * 0.22, s * 0.06); c.fill();
        c.save(); rr(c, -s * 0.42, -s * 0.11, s * 0.84, s * 0.22, s * 0.06); c.clip();
        c.strokeStyle = '#b8802f'; c.lineWidth = Math.max(1, s * 0.035);
        for (let i = -6; i < 7; i++) { c.beginPath(); c.moveTo(i * s * 0.08, -s * 0.14); c.lineTo(i * s * 0.08 + s * 0.12, s * 0.14); c.stroke(); }
        c.restore();
        c.fillStyle = '#f5d9a3'; ell(c, s * 0.42, 0, s * 0.04, s * 0.11); c.fill();
        c.restore();
        break;
      }
      default: break;
    }
  }

  /* ======================================================================
     Audio — tiny WebAudio blips, created lazily on the first user gesture
     ====================================================================== */
  function makeAudio(on) {
    let ac = null, out = null, hum = null, noiseBuf = null;
    const A = { on: !!on };
    A.unlock = function () {
      if (!A.on) return;
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try { ac = new AC(); } catch (e) { ac = null; return; }
        out = ac.createGain(); out.gain.value = 0.32; out.connect(ac.destination);
      }
      if (ac.state === 'suspended' && ac.resume) { const p = ac.resume(); if (p && p.catch) p.catch(function () {}); }
    };
    const ready = function () { return A.on && ac && ac.state !== 'closed'; };
    function tone(f, dur, type, vol, f2, delay) {
      if (!ready()) return;
      try {
        const t = ac.currentTime + (delay || 0);
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(f, t);
        if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(out);
        o.start(t); o.stop(t + dur + 0.03);
      } catch (e) { /* audio is optional */ }
    }
    function noise(dur, vol, freq, q, delay) {
      if (!ready()) return;
      try {
        if (!noiseBuf) {
          const len = Math.floor(ac.sampleRate * 0.4);
          noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
          const d = noiseBuf.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        }
        const t = ac.currentTime + (delay || 0);
        const src = ac.createBufferSource(); src.buffer = noiseBuf;
        const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq || 2000; bp.Q.value = q || 1;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(bp); bp.connect(g); g.connect(out);
        src.start(t); src.stop(t + dur + 0.05);
      } catch (e) { /* optional */ }
    }
    A.tap = function () { tone(660, 0.06, 'triangle', 0.1, 540); };
    A.scoop = function () { tone(430, 0.13, 'sine', 0.22, 170); tone(900, 0.05, 'triangle', 0.05, 700, 0.03); };
    A.pop = function () { tone(300, 0.08, 'sine', 0.14, 620); };
    A.squirt = function () { noise(0.24, 0.12, 2400, 0.8); };
    A.shake = function () { noise(0.05, 0.1, 5200, 2); noise(0.05, 0.08, 5200, 2, 0.08); noise(0.05, 0.07, 5200, 2, 0.16); };
    A.plop = function () { tone(560, 0.1, 'sine', 0.16, 260); };
    A.err = function () { tone(220, 0.14, 'square', 0.04, 180); };
    A.chime = function () { tone(784, 0.2, 'sine', 0.09); tone(1046, 0.28, 'sine', 0.08, null, 0.1); };
    A.ticket = function () { tone(1200, 0.05, 'triangle', 0.07); tone(1500, 0.08, 'triangle', 0.06, null, 0.05); };
    A.ding = function () { tone(1318, 0.55, 'sine', 0.17); tone(1975, 0.65, 'sine', 0.06, null, 0.01); };
    A.coin = function () { tone(1568, 0.06, 'square', 0.03); tone(2093, 0.12, 'square', 0.028, null, 0.05); };
    A.star = function (i) { tone(660 * Math.pow(1.122, i * 2), 0.13, 'triangle', 0.08); };
    A.good = function () { tone(880, 0.1, 'triangle', 0.07); tone(1320, 0.15, 'triangle', 0.06, null, 0.07); };
    A.sad = function () { tone(392, 0.2, 'triangle', 0.09, 330); tone(311, 0.32, 'triangle', 0.08, 262, 0.18); };
    A.fanfare = function () { [523, 659, 784, 1046].forEach(function (f, i) { tone(f, 0.24, 'triangle', 0.09, null, i * 0.11); }); };
    A.humStart = function () {
      if (!ready() || hum) return;
      try {
        const o = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
        o.type = 'sawtooth'; o.frequency.value = 80; o2.type = 'square'; o2.frequency.value = 161;
        f.type = 'lowpass'; f.frequency.value = 700; g.gain.value = 0.0001;
        o.connect(f); o2.connect(f); f.connect(g); g.connect(out);
        g.gain.exponentialRampToValueAtTime(0.06, ac.currentTime + 0.08);
        o.start(); o2.start();
        hum = { o: o, o2: o2, f: f, g: g };
      } catch (e) { hum = null; }
    };
    A.humSet = function (v) {
      if (!hum || !ac) return;
      const t = ac.currentTime;
      hum.o.frequency.setTargetAtTime(80 + v * 90, t, 0.05);
      hum.o2.frequency.setTargetAtTime(161 + v * 180, t, 0.05);
      hum.f.frequency.setTargetAtTime(700 + v * 900, t, 0.05);
    };
    A.humStop = function () {
      const h = hum; hum = null;
      if (!h || !ac) return;
      try {
        const t = ac.currentTime;
        h.g.gain.cancelScheduledValues(t);
        h.g.gain.setValueAtTime(Math.max(0.0001, h.g.gain.value), t);
        h.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
        h.o.stop(t + 0.1); h.o2.stop(t + 0.1);
      } catch (e) { /* optional */ }
    };
    A.set = function (v) { A.on = !!v; if (!A.on) A.humStop(); };
    A.close = function () {
      A.humStop();
      if (ac && ac.close) { try { const p = ac.close(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ } }
      ac = null; out = null;
    };
    return A;
  }

  /* ======================================================================
     mount — the playable game
     ====================================================================== */
  function mount(host, opts) {
    if (!host || typeof host.appendChild !== 'function') throw new Error('neveria.mount: a host element is required');
    opts = opts || {};
    const reduced = !!opts.reduced;
    const onOver = typeof opts.onOver === 'function' ? opts.onOver : null;
    const onServe = typeof opts.onServe === 'function' ? opts.onServe : null;
    const seed0 = (typeof opts.seed === 'number' && isFinite(opts.seed)) ? (Math.floor(opts.seed) >>> 0) : null;
    let best = Math.max(0, Math.floor(Number(opts.best) || 0));
    const audio = makeAudio(opts.sound !== false);

    host.tabIndex = 0;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'La Nevería, a beachside frozen-treat shop game. Keys: 1 to 4 switch stations (Order, Build, Blend, Top), Enter serves, hold Space to blend, P or Escape pauses.');
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    canvas.style.userSelect = 'none';
    canvas.style.webkitUserSelect = 'none';
    canvas.style.webkitTapHighlightColor = 'transparent';
    const live = document.createElement('p');
    live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('role', 'status');
    host.appendChild(canvas);
    host.appendChild(live);
    const c = canvas.getContext('2d');

    let W = 0, H = 0, dpr = 1, L = null;
    let phase = 'ready', station = 'order';
    let anim = 0, gt = 0, lastTs = 0, raf = 0, destroyed = false;
    let runs = 0, shift = null, tickets = [], selected = -1, card = null, toast = null;
    let particles = [], flyers = [];
    let hits = [], press = null;
    let hold = null;
    let shownScore = 0, lastCoinSound = 0, newBest = false, overFired = false;
    let pulseSizes = -9;

    /* ---------------- layout ---------------- */
    function computeLayout() {
      const land = W >= 600 && W / H >= 1.12;
      const k = land ? clamp(Math.min(W / 960, H / 600), 0.74, 1.35) : clamp(Math.min(W / 360, H / 600), 0.88, 1.45);
      const hudH = Math.round(clamp(42 * k, 44, 56));
      const tabsH = Math.round(clamp(66 * k, 60, 82));
      const pad = Math.round(8 * k);
      const o = { land: land, k: k, pad: pad, hud: { x: 0, y: 0, w: W, h: hudH }, tabs: { x: 0, y: H - tabsH, w: W, h: tabsH } };
      if (land) {
        const colW = Math.round(clamp(W * 0.29, 230, 330));
        const railH = Math.round(clamp(58 * k, 50, 70));
        o.side = { x: 0, y: hudH, w: colW, h: H - hudH - tabsH };
        o.rail = { x: pad, y: hudH + pad, w: colW - pad * 2, h: railH };
        const cy = o.rail.y + railH + pad;
        o.card = { x: pad, y: cy, w: colW - pad * 2, h: H - tabsH - pad - cy };
        o.stage = { x: colW, y: hudH, w: W - colW, h: H - hudH - tabsH };
      } else {
        const railH = Math.round(clamp(48 * k, 50, 62));
        const cardH = Math.round(clamp(H * 0.16, 84, 124));
        o.rail = { x: pad, y: hudH + pad, w: W - pad * 2, h: railH };
        o.card = { x: pad, y: o.rail.y + railH + Math.round(pad * 0.75), w: W - pad * 2, h: cardH };
        const sy = o.card.y + cardH + pad;
        o.side = { x: 0, y: hudH, w: W, h: sy - hudH };
        o.stage = { x: 0, y: sy, w: W, h: H - tabsH - sy };
      }
      return o;
    }
    function resize() {
      if (destroyed) return;
      let w = host.clientWidth, h = host.clientHeight;
      if (w < 10) w = 360;
      if (h < 100) h = Math.round(clamp(w * 1.4, 480, 640));
      const nd = Math.min(2, window.devicePixelRatio || 1);
      if (w === W && h === H && nd === dpr && L) return;
      W = w; H = h; dpr = nd;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      L = computeLayout();
      render();
    }

    /* ---------------- helpers ---------------- */
    function playing() { return phase === 'playing' && !destroyed; }
    function cur() { return selected >= 0 && selected < tickets.length ? tickets[selected] : null; }
    function byRole(role) { if (!shift) return null; for (let i = 0; i < shift.list.length; i++) if (shift.list[i].role === role) return shift.list[i]; return null; }
    let liveFlip = false;
    function announce(msg) { liveFlip = !liveFlip; live.textContent = msg + (liveFlip ? '' : ' '); }
    function say(msg) { toast = { msg: msg, t0: anim }; }
    function report(e) { if (window.console && console.error) console.error('[neveria]', e); }
    function patienceLeft(cu) { return cu.arrivedAt === null ? 1 : clamp(1 - (gt - cu.arrivedAt) / cu.order.patience, 0, 1); }
    function madeView(m) {
      return { size: m.size, flavors: m.flavors.slice(), mixins: m.mixins.slice(), blend: blendZone(m.blendVal), blendVal: round(m.blendVal, 3), toppings: m.toppings.slice() };
    }
    function orderCopy(o) {
      return { size: o.size, flavors: o.flavors.slice(), mixins: o.mixins.slice(), blend: o.blend, toppings: o.toppings.slice(), level: o.level, complexity: o.complexity, patience: o.patience, par: o.par, value: o.value };
    }
    function ticketView(t) {
      const v = orderCopy(t.order);
      v.id = t.id; v.name = t.name; v.patienceLeft = round(patienceLeft(t), 3); v.made = madeView(t.made);
      return v;
    }
    function sceneU(r) { return clamp(Math.min(r.w / 360, r.h / 330), 0.8, 1.8); }

    /* ---------------- shift ---------------- */
    const SPOTS = { window: { x: 0.5, d: 0 }, line: { x: 0.7, d: 0.62 }, wait: [{ x: 0.17, d: 0.3 }, { x: 0.83, d: 0.3 }, { x: 0.33, d: 0.74 }] };
    function newShift() {
      const seed = seed0 !== null ? (seed0 + runs * 7919) >>> 0 : (Math.floor(Math.random() * 4294967296) >>> 0);
      runs++;
      const rng = mulberry32(seed);
      const n = 6 + Math.floor(rng() * 4);
      const used = {}, list = [];
      for (let i = 0; i < n; i++) {
        const cu = makeCustomer(rng);
        let name = cu.name, j = NAMES.indexOf(name);
        while (used[name]) { j = (j + 1) % NAMES.length; name = NAMES[j]; }
        used[name] = true;
        const order = makeOrder(rng, Math.min(3, Math.floor((i * 4) / n)));
        const gap = i === 0 ? 1.2 : i === 1 ? 9 : 15 + rng() * 9;
        list.push({
          idx: i, id: i + 1, name: name, look: cu.look, order: order, gap: gap, tag: TAGS[i % TAGS.length],
          role: null, x: 1.25, d: 0.5, tx: 0.5, td: 0, arrived: false, arrivedAt: null, walking: false, spot: -1,
          made: null, mood: 'happy', outcome: null, result: null, hopAt: -9, spawnAt: 0, leaveGt: 0, holding: null
        });
      }
      shift = { seed: seed, n: n, list: list, next: 0, nextAt: list[0].gap, score: 0, served: 0, left: 0, results: [], doneAt: null };
    }
    function spawn(cu, role) {
      const sp = SPOTS[role];
      cu.role = role; cu.x = reduced ? sp.x : 1.22; cu.d = sp.d; cu.tx = sp.x; cu.td = sp.d; cu.arrived = false; cu.spawnAt = anim;
      audio.chime();
      announce(cu.name + ' walked up to the counter.');
    }
    function moveCustomers(dt) {
      shift.list.forEach(function (cu) {
        if (!cu.role || cu.role === 'gone') return;
        if (cu.role === 'leave' && reduced) { if (gt - cu.leaveGt > 0.7) cu.role = 'gone'; return; }
        if (reduced) { cu.x = cu.tx; cu.d = cu.td; }
        const dx = cu.tx - cu.x, dd = cu.td - cu.d, dist = Math.hypot(dx, dd);
        if (dist > 0.0005) { const st = Math.min(1, (cu.role === 'leave' ? 0.55 : 0.5) * dt / dist); cu.x += dx * st; cu.d += dd * st; }
        const at = Math.hypot(cu.tx - cu.x, cu.td - cu.d) < 0.002;
        cu.walking = !at;
        if (at && !cu.arrived) {
          cu.arrived = true;
          if (cu.arrivedAt === null && (cu.role === 'window' || cu.role === 'line')) cu.arrivedAt = gt;
          if (cu.role === 'window') cu.waveAt = anim;
        }
        if (cu.role === 'leave' && at) cu.role = 'gone';
      });
    }
    function step(dt) {
      gt += dt;
      const s = shift;
      if (!byRole('window')) {
        const ln = byRole('line');
        if (ln) { ln.role = 'window'; ln.tx = SPOTS.window.x; ln.td = SPOTS.window.d; ln.arrived = false; }
      }
      if (s.next < s.n) {
        const busy = s.list.some(function (cu) { return cu.role && cu.role !== 'gone' && cu.role !== 'leave'; });
        if (!busy && s.nextAt - gt > 2.5) s.nextAt = gt + 2.5;
        if (gt >= s.nextAt) {
          const w = byRole('window'), ln = byRole('line');
          if (!w || !ln) {
            spawn(s.list[s.next], w ? 'line' : 'window');
            s.next++;
            if (s.next < s.n) s.nextAt = gt + s.list[s.next].gap;
          }
        }
      }
      moveCustomers(dt);
      s.list.forEach(function (cu) {
        if (cu.role === 'window' || cu.role === 'line' || cu.role === 'wait') {
          const p = patienceLeft(cu);
          cu.mood = p > 0.55 ? 'happy' : p > 0.25 ? 'neutral' : 'worried';
          if (cu.arrivedAt !== null && p <= 0) walkOut(cu);
        }
      });
      if (s.next >= s.n && s.list.every(function (cu) { return cu.role === 'gone' || cu.role === 'leave'; })) {
        if (s.doneAt === null) s.doneAt = gt;
        if (gt - s.doneAt >= 1.4) endShift();
      } else s.doneAt = null;
    }
    function removeTicket(i) {
      if (i < 0) return;
      const t = tickets[i];
      if (hold && hold.t === t) stopHold();
      tickets.splice(i, 1);
      if (selected === i) selected = tickets.length ? 0 : -1;
      else if (selected > i) selected--;
    }
    function walkOut(cu) {
      removeTicket(tickets.indexOf(cu));
      cu.role = 'leave'; cu.outcome = 'left'; cu.mood = 'angry'; cu.tx = 1.3; cu.td = cu.d; cu.arrived = false; cu.leaveGt = gt; cu.leaveAt = anim;
      shift.left++;
      shift.results.push({ id: cu.id, name: cu.name, stars: 0, tip: 0, left: true });
      audio.sad();
      say(cu.name + ' got tired of waiting…');
      announce(cu.name + ' left without a treat. No tip.');
    }
    function endShift() {
      if (phase !== 'playing') return;
      stopHold();
      card = null;
      phase = 'over';
      particles = particles.filter(function (p) { return p.kind !== 'coin'; });
      shownScore = shift.score;
      newBest = shift.score > best;
      if (newBest) best = shift.score;
      audio.fanfare();
      announce('Shift over! You served ' + shift.served + ' of ' + shift.n + ' customers and earned $' + shift.score + ' in tips.' + (newBest ? ' New best!' : ''));
      if (!overFired) {
        overFired = true;
        if (onOver) { try { onOver(shift.score); } catch (e) { report(e); } }
      }
    }

    /* ---------------- actions (taps, keys and debug all use these) ---------------- */
    function setStation(name) {
      if (!playing() || ['order', 'build', 'blend', 'top'].indexOf(name) < 0) return false;
      if (station !== name) { stopHold(); station = name; audio.tap(); }
      return true;
    }
    function actTake() {
      if (!playing() || card) return null;
      const cu = byRole('window');
      if (!cu || !cu.arrived) { say('No one is at the counter yet'); return null; }
      if (tickets.length >= MAX_TICKETS) { say('Ticket rail is full: serve someone first!'); audio.err(); return null; }
      const used = tickets.map(function (t) { return t.spot; });
      let spot = 0;
      while (used.indexOf(spot) >= 0) spot++;
      cu.role = 'wait'; cu.spot = spot; cu.tx = SPOTS.wait[spot].x; cu.td = SPOTS.wait[spot].d; cu.arrived = false;
      cu.made = emptyMade(); cu.takenAt = gt;
      tickets.push(cu);
      if (selected < 0) selected = tickets.length - 1;
      audio.ticket();
      if (!reduced && L) {
        const sr = L.stage, u = sceneU(sr), pos = spotXY(sr, cu.x, cu.d, u);
        const slot = railSlot(tickets.length - 1);
        flyers.push({ x0: pos.x, y0: pos.waist - 60 * u, x1: slot.x + slot.w / 2, y1: slot.y + slot.h / 2, t0: anim, dur: 0.55, col: cu.tag });
      }
      announce('Order ' + cu.id + ' from ' + cu.name + ': ' + describeOrder(cu.order) + '.');
      return ticketView(cu);
    }
    function actSelect(i) {
      if (!playing() || card) return false;
      i = Math.floor(Number(i));
      if (!(i >= 0 && i < tickets.length)) return false;
      if (selected !== i) { stopHold(); selected = i; audio.tap(); announce('Ticket ' + tickets[i].id + ' for ' + tickets[i].name + ': ' + describeOrder(tickets[i].order) + '.'); }
      return true;
    }
    function needTicket() {
      const t = cur();
      if (!t) { say(tickets.length ? 'Tap a ticket to work on it' : 'Take an order at the counter first (1)'); audio.err(); }
      return t;
    }
    function actSize(v) {
      if (!playing() || card) return false;
      const sz = norm('size', v), t = needTicket();
      if (!t || !sz) return false;
      if (t.made.size !== sz) { t.made.size = sz; t.made.fx.size = anim; }
      audio.tap();
      return true;
    }
    function actScoop(v) {
      if (!playing() || card) return false;
      const f = norm('flavor', v), t = needTicket();
      if (!t || !f) return false;
      const m = t.made;
      if (!m.size) { say('Pick a cup size first'); pulseSizes = anim; audio.err(); return false; }
      const i = m.flavors.indexOf(f);
      if (i >= 0) { m.flavors.splice(i, 1); audio.pop(); return true; }
      if (m.flavors.length >= MAX_SCOOPS) { say('That cup holds 3 scoops max'); audio.err(); return false; }
      m.flavors.push(f); m.fx['f:' + f] = anim;
      audio.scoop();
      return true;
    }
    function actMixin(v) {
      if (!playing() || card) return false;
      const id = norm('mixin', v), t = needTicket();
      if (!t || !id) return false;
      const m = t.made;
      if (!m.size) { say('Pick a cup size first'); pulseSizes = anim; audio.err(); return false; }
      const i = m.mixins.indexOf(id);
      if (i >= 0) { m.mixins.splice(i, 1); audio.pop(); return true; }
      if (m.mixins.length >= MAX_MIXINS) { say('3 mix-ins max'); audio.err(); return false; }
      m.mixins.push(id); m.fx['m:' + id] = anim;
      audio.plop();
      return true;
    }
    function actReset() {
      if (!playing() || card) return false;
      const t = needTicket();
      if (!t) return false;
      stopHold();
      const size = t.made.size;
      t.made = emptyMade();
      t.made.size = size;
      audio.pop();
      say('Fresh cup!');
      return true;
    }
    function actTopping(v) {
      if (!playing() || card) return false;
      const id = norm('topping', v), t = needTicket();
      if (!t || !id) return false;
      const m = t.made;
      if (!m.size || !m.flavors.length) { say('Add nieve first (2)'); audio.err(); return false; }
      const i = m.toppings.indexOf(id);
      if (i >= 0) { m.toppings.splice(i, 1); audio.pop(); return true; }
      m.toppings.push(id); m.fx['t:' + id] = anim;
      if (id === 'crema' || SYRUP[id]) audio.squirt();
      else if (id === 'confeti' || id === 'tajin') audio.shake();
      else audio.plop();
      return true;
    }
    function startHold(src) {
      if (!playing() || card || station !== 'blend' || hold) return false;
      const t = cur();
      if (!t) { say(tickets.length ? 'Tap a ticket to work on it' : 'Take an order first (1)'); audio.err(); return false; }
      const m = t.made;
      if (!m.size || !m.flavors.length) { say('Build the treat first (2)'); audio.err(); return false; }
      if (m.toppings.length) { say('Blend before adding toppings'); audio.err(); return false; }
      if (m.blendVal >= 1) { say('Too soupy! Start over at Build (2)'); audio.err(); return false; }
      hold = { src: src, t: t, from: m.blendVal };
      audio.humStart();
      return true;
    }
    function stopHold() {
      if (!hold) return;
      const t = hold.t, from = hold.from;
      hold = null;
      audio.humStop();
      if (!t || !t.made || t.made.blendVal === from) return;
      const z = blendZone(t.made.blendVal);
      const want = t.order.blend;
      if (L && station === 'blend') {
        const mp = meterRect(L.stage);
        floatText(z ? LABEL.blend[z] + (want === z ? '!' : '') : 'Keep going…', mp.x + mp.w / 2, mp.y + mp.h * (1 - t.made.blendVal) - 6,
          z && want === z ? C.good : z === 'soupy' ? C.bad : C.ink);
      }
      if (z && want === z) audio.good();
      announce('Blend: ' + (z ? LABEL.blend[z] : 'barely blended') + (want ? '. Ticket wants ' + LABEL.blend[want] + '.' : '. This ticket wants no blend.'));
    }
    function blendTick(dt) {
      const t = hold.t;
      if (!t || cur() !== t || station !== 'blend') { stopHold(); return; }
      t.made.blendVal = Math.min(1, t.made.blendVal + BLEND_RATE * dt);
      audio.humSet(t.made.blendVal);
      if (!reduced && Math.random() < dt * 10 && L) {
        const b = blenderPos(L.stage);
        particles.push({ kind: 'drop', x: b.cx + (Math.random() - 0.5) * 40 * b.s, y: b.by - 160 * b.s, vx: (Math.random() - 0.5) * 80, vy: -60 - Math.random() * 60, g: 420, age: 0, life: 0.6, col: avgC(t.made.flavors.map(function (f) { return FL[f].c; })) });
      }
      if (t.made.blendVal >= 1) stopHold();
    }
    function actServe() {
      if (!playing() || card) return null;
      const t = cur();
      if (!t) { say(tickets.length ? 'Tap a ticket to serve it' : 'No orders yet: take one at the counter (1)'); audio.err(); return null; }
      const m = t.made;
      if (!m.size || !m.flavors.length) { say('Build the treat first: cup + nieve (2)'); audio.err(); return null; }
      stopHold();
      const waited = t.arrivedAt === null ? 0 : gt - t.arrivedAt;
      const res = grade(t.order, madeView(m), waited);
      removeTicket(tickets.indexOf(t));
      t.result = res; t.outcome = 'served'; t.role = 'leave'; t.tx = -0.3; t.td = t.d; t.arrived = false; t.leaveGt = gt;
      t.mood = res.stars >= 5 ? 'delight' : res.stars >= 3 ? 'happy' : res.stars === 2 ? 'neutral' : 'worried';
      t.hopAt = anim + 0.15; t.holding = m;
      shift.score += res.tip; shift.served++;
      shift.results.push({ id: t.id, name: t.name, stars: res.stars, tip: res.tip, left: false, parts: res.parts });
      card = { cu: t, res: res, made: m, t: 0, dur: 3.6, coins: false, tipPos: null, starsPlayed: 0 };
      audio.ding();
      announce('Served ' + t.name + ': ' + res.stars + ' star' + (res.stars === 1 ? '' : 's') + ', $' + res.tip + ' tip.');
      const out = { id: t.id, name: t.name, stars: res.stars, tip: res.tip, parts: res.parts, speed: res.speed, accuracy: res.accuracy, quality: res.quality,
        waited: round(waited, 2), order: orderCopy(t.order), made: madeView(m), score: shift.score };
      if (onServe) { try { onServe(out); } catch (e) { report(e); } }
      return out;
    }
    function spawnCoins() {
      if (!card || card.coins) return;
      card.coins = true;
      const tip = card.res.tip;
      const from = card.tipPos || { x: W / 2, y: H / 2 };
      const to = L ? L.scorePos || { x: 30, y: 20 } : { x: 30, y: 20 };
      // reduced motion: no flying coins, the score simply updates
      const n = tip <= 0 || reduced ? 0 : clamp(Math.round(tip / 3), 4, 14);
      if (!n) return;
      let left = tip;
      for (let i = 0; i < n; i++) {
        const v = i === n - 1 ? left : Math.floor(tip / n);
        left -= v;
        const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 160;
        particles.push({ kind: 'coin', x: from.x, y: from.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, age: -i * 0.035, life: 1.25, sx: 0, sy: 0, tx: to.x, ty: to.y, value: v, landed: false });
      }
    }
    function dismissCard() {
      if (!card) return;
      spawnCoins();
      card = null;
    }
    function floatText(str, x, y, col) {
      particles.push({ kind: 'text', str: str, x: x, y: y, vx: 0, vy: reduced ? 0 : -26, g: 0, age: 0, life: 1.3, col: col || C.ink, station: station });
    }

    /* ---------------- public lifecycle ---------------- */
    function start() {
      if (destroyed) return;
      if (phase === 'playing') return;
      if (phase === 'paused') { resume(); return; }
      newShift();
      gt = 0; tickets = []; selected = -1; card = null; toast = null; particles = []; flyers = [];
      station = 'order'; shownScore = 0; newBest = false; overFired = false; hold = null;
      phase = 'playing';
      announce('The shop is open! ' + shift.n + ' customers are on their way. Take orders at the counter.');
      try { host.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    function pause() {
      if (phase !== 'playing') return;
      stopHold();
      phase = 'paused';
      announce('Paused.');
    }
    function resume() {
      if (phase !== 'paused') return;
      phase = 'playing';
      lastTs = 0;
      announce('Back to work!');
    }

    /* ---------------- update ---------------- */
    function updateParticles(dt) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age < 0) continue;
        if (p.kind === 'coin') {
          if (p.age < 0.38) { p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.sx = p.x; p.sy = p.y; }
          else {
            const q = clamp((p.age - 0.38) / 0.55, 0, 1), e = q * q * q;
            p.x = p.sx + (p.tx - p.sx) * e; p.y = p.sy + (p.ty - p.sy) * e;
            if (q >= 1 && !p.landed) {
              p.landed = true; shownScore += p.value;
              if (anim - lastCoinSound > 0.05) { audio.coin(); lastCoinSound = anim; }
              p.age = p.life;
            }
          }
        } else {
          p.vy += (p.g || 0) * dt; p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt;
        }
        if (p.age >= p.life) {
          if (p.kind === 'coin' && !p.landed) shownScore += p.value;
          particles.splice(i, 1);
        }
      }
      for (let i = flyers.length - 1; i >= 0; i--) if (anim - flyers[i].t0 > flyers[i].dur) flyers.splice(i, 1);
      if (shift && !particles.some(function (p) { return p.kind === 'coin'; }) && !(card && !card.coins)) shownScore = shift.score;
    }
    function update(dt) {
      anim += dt;
      updateParticles(dt);
      if (phase !== 'playing') return;
      if (card) {
        card.t += dt;
        const sp = Math.floor((card.t - 0.4) / 0.13) + 1;
        while (card.starsPlayed < Math.min(card.res.stars, sp)) { audio.star(card.starsPlayed); card.starsPlayed++; }
        if (card.t >= 0.4 + card.res.stars * 0.13 + 0.25) spawnCoins();
        if (card.t >= card.dur) dismissCard();
        return;
      }
      if (hold) blendTick(dt);
      step(dt);
    }
    function frame(ts) {
      if (destroyed) return;
      raf = requestAnimationFrame(frame);
      const nd = Math.min(2, window.devicePixelRatio || 1);
      if (nd !== dpr) resize();
      let dt = lastTs ? (ts - lastTs) / 1000 : 0;
      lastTs = ts;
      dt = clamp(dt, 0, 0.05);
      if (!document.hidden) update(dt);
      render();
    }

    /* ---------------- hit regions & buttons ---------------- */
    function addHit(r, id, en, tap, holdable) { hits.push({ x: r.x, y: r.y, w: r.w, h: r.h, id: id, en: en !== false, tap: tap, hold: !!holdable }); }
    function isPressed(id) { return press && press.id === id && (!press.up || anim - press.t < 0.12); }
    function pressWrap(r, id, fn) {
      if (isPressed(id)) {
        c.save();
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        c.translate(cx, cy); c.scale(0.94, 0.94); c.translate(-cx, -cy);
        fn(); c.restore();
      } else fn();
    }
    function pill(r, id, label, o, tap) {
      o = o || {};
      const en = o.enabled !== false, rad = o.radius != null ? o.radius : r.h / 2;
      addHit(r, id, en || !!o.explain, tap, o.hold);
      pressWrap(r, id, function () {
        if (en && !o.flat) { c.fillStyle = 'rgba(12,28,33,.22)'; rr(c, r.x, r.y + 3, r.w, r.h, rad); c.fill(); }
        c.fillStyle = en ? (o.fill || C.accentDark) : (o.offFill || 'rgba(16,37,43,.16)');
        rr(c, r.x, r.y, r.w, r.h, rad); c.fill();
        if (o.ring) { c.strokeStyle = o.ring; c.lineWidth = 2; rr(c, r.x + 1, r.y + 1, r.w - 2, r.h - 2, rad); c.stroke(); }
        const col = en ? (o.color || '#fff') : (o.offColor || 'rgba(16,37,43,.5)');
        let tx = r.x + r.w / 2;
        if (o.icon) {
          const is = Math.min(r.h * 0.5, 26 * L.k);
          c.font = font(o.px || 16, 800);
          const tw = Math.min(c.measureText(label).width, r.w - is - 30);
          const x0 = r.x + r.w / 2 - (tw + is + 8) / 2;
          o.icon(x0 + is / 2, r.y + r.h / 2, is, col);
          tx = x0 + is + 8 + tw / 2;
          txtFit(c, label, tx, r.y + r.h / 2 + (o.sub ? -6 : 1), r.w - is - 26, o.px || 16, col, 'center', 800);
        } else {
          txtFit(c, label, tx, r.y + r.h / 2 + (o.sub ? -6 : 1), r.w - 20, o.px || 16, col, 'center', 800);
        }
        if (o.sub) txtFit(c, o.sub, tx, r.y + r.h / 2 + 11, r.w - 20, 10.5 * L.k, en ? rgba(col === '#fff' ? '#ffffff' : C.ink, 0.75) : col, 'center', 600);
      });
    }
    function ingButton(r, kind, id, on, en, tap) {
      const key = kind + ':' + id, k = L.k;
      const label = kind === 'size' ? LABEL.size[id] : (LABEL[kind] && LABEL[kind][id]) || id;
      addHit(r, key, true, tap);
      pressWrap(r, key, function () {
        const rad = 10 * k;
        c.fillStyle = 'rgba(0,0,0,.2)'; rr(c, r.x, r.y + 2.5, r.w, r.h, rad); c.fill();
        c.fillStyle = en ? (on ? '#fff3e6' : '#fffaf2') : 'rgba(255,250,242,.55)'; rr(c, r.x, r.y, r.w, r.h, rad); c.fill();
        if (on) { c.lineWidth = 3; c.strokeStyle = C.accent; rr(c, r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3, rad - 1); c.stroke(); }
        c.globalAlpha = en ? 1 : 0.55;
        const wide = r.w > r.h * 1.9;
        if (wide) {
          const is = Math.min(r.h * 0.74, 44 * k);
          drawIcon(c, kind, id, r.x + 8 * k + is / 2, r.y + r.h / 2, is);
          txtFit(c, label, r.x + 14 * k + is, r.y + r.h / 2 + 1, r.w - is - 22 * k, 13.5 * k, C.ink, 'left', 700);
        } else {
          const lp = clamp(r.h * 0.2, 9.5, 13 * k);
          const is = Math.min(r.h - lp - 14, r.w * 0.66, 56 * k);
          drawIcon(c, kind, id, r.x + r.w / 2, r.y + 4 + is / 2 + (r.h - lp - 10 - is) / 2, is);
          txtFit(c, label, r.x + r.w / 2, r.y + r.h - lp * 0.5 - 6, r.w - 6, lp, C.ink, 'center', 700);
        }
        c.globalAlpha = 1;
        if (on) checkMark(c, r.x + r.w - 9 * k, r.y + 9 * k, 7 * k);
      });
    }
    function iconBtn(r, id, en, tap, drawFn, label) {
      addHit(r, id, en, tap);
      pressWrap(r, id, function () {
        c.fillStyle = 'rgba(0,0,0,.16)'; rr(c, r.x, r.y + 2, r.w, r.h, 10 * L.k); c.fill();
        c.fillStyle = en ? '#fffaf2' : 'rgba(255,250,242,.6)'; rr(c, r.x, r.y, r.w, r.h, 10 * L.k); c.fill();
        c.globalAlpha = en ? 1 : 0.5;
        drawFn(r.x + r.w / 2, r.y + r.h / 2 - (label ? 6 * L.k : 0), Math.min(r.w, r.h) * 0.42);
        if (label) txtFit(c, label, r.x + r.w / 2, r.y + r.h - 9 * L.k, r.w - 6, 10 * L.k, C.ink2, 'center', 700);
        c.globalAlpha = 1;
      });
    }

    /* ---------------- scene pieces ---------------- */
    function papel(x0, x1, y, k, fh) {
      const n = Math.max(4, Math.round((x1 - x0) / (42 * k)));
      const step = (x1 - x0) / n, fw = step * 0.8, sag = 7 * k;
      c.strokeStyle = 'rgba(16,37,43,.35)'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(x0, y); c.quadraticCurveTo((x0 + x1) / 2, y + sag * 2, x1, y); c.stroke();
      for (let i = 0; i < n; i++) {
        const cx = x0 + step * (i + 0.5), tt = (cx - x0) / (x1 - x0);
        const yy = y + sag * 4 * tt * (1 - tt);
        const ang = reduced ? 0 : Math.sin(anim * 1.7 + i * 0.8) * 0.07;
        c.save(); c.translate(cx, yy); c.rotate(ang);
        c.fillStyle = PAPEL[i % PAPEL.length];
        c.beginPath(); c.moveTo(-fw / 2, 0); c.lineTo(fw / 2, 0); c.lineTo(fw / 2, fh);
        const z = 5;
        for (let j = z; j >= 0; j--) { const zx = -fw / 2 + (fw * j) / z; c.lineTo(zx + fw / z / 2, fh - 4 * k); c.lineTo(zx, fh); }
        c.closePath(); c.fill();
        c.fillStyle = 'rgba(255,255,255,.42)';
        c.beginPath(); c.moveTo(0, fh * 0.28); c.lineTo(fw * 0.16, fh * 0.5); c.lineTo(0, fh * 0.72); c.lineTo(-fw * 0.16, fh * 0.5); c.closePath(); c.fill();
        circle(c, -fw * 0.3, fh * 0.32, fh * 0.07); c.fill(); circle(c, fw * 0.3, fh * 0.32, fh * 0.07); c.fill();
        circle(c, -fw * 0.3, fh * 0.66, fh * 0.07); c.fill(); circle(c, fw * 0.3, fh * 0.66, fh * 0.07); c.fill();
        for (let j = 0; j < 4; j++) { const tx = -fw * 0.36 + j * fw * 0.24; c.beginPath(); c.moveTo(tx, fh * 0.1); c.lineTo(tx + fw * 0.06, fh * 0.18); c.lineTo(tx + fw * 0.12, fh * 0.1); c.closePath(); c.fill(); }
        c.restore();
      }
    }
    function tiles(r, lip) {
      c.fillStyle = C.sea; c.fillRect(r.x, r.y, r.w, r.h);
      const ts = 30 * L.k;
      c.save(); c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
      c.strokeStyle = 'rgba(255,255,255,.09)'; c.lineWidth = 1;
      const x0 = r.x + ((r.w % ts) / 2) - ts;
      for (let x = x0; x < r.x + r.w; x += ts) { c.beginPath(); c.moveTo(x, r.y); c.lineTo(x, r.y + r.h); c.stroke(); }
      for (let y = r.y; y < r.y + r.h; y += ts) { c.beginPath(); c.moveTo(r.x, y); c.lineTo(r.x + r.w, y); c.stroke(); }
      c.fillStyle = 'rgba(246,241,233,.1)';
      for (let x = x0; x < r.x + r.w; x += ts) {
        for (let y = r.y; y < r.y + r.h; y += ts) {
          const cx = x + ts / 2, cy = y + ts / 2;
          for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; ell(c, cx + Math.cos(a) * ts * 0.18, cy + Math.sin(a) * ts * 0.18, ts * 0.13, ts * 0.07, a); c.fill(); }
          circle(c, cx, cy, ts * 0.06); c.fill();
        }
      }
      c.restore();
      if (lip !== false) {
        c.fillStyle = '#ecd6b5'; c.fillRect(r.x, r.y - 6 * L.k, r.w, 8 * L.k);
        c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(r.x, r.y - 6 * L.k, r.w, 1.5);
        c.fillStyle = 'rgba(0,0,0,.14)'; c.fillRect(r.x, r.y + 2 * L.k, r.w, 3 * L.k);
      }
    }
    function wall(r) {
      const g = c.createLinearGradient(0, r.y, 0, r.y + r.h);
      g.addColorStop(0, '#fbefdf'); g.addColorStop(1, '#f4d9c0');
      c.fillStyle = g; c.fillRect(r.x, r.y, r.w, r.h);
      c.fillStyle = 'rgba(229,140,99,.07)';
      const sw = 20 * L.k;
      for (let x = r.x; x < r.x + r.w; x += sw * 2) c.fillRect(x, r.y, sw, r.h);
      papel(r.x - 4, r.x + r.w + 4, r.y + 3, L.k, 22 * L.k);
    }
    function spotXY(r, x, d, u) {
      const counterY = r.y + r.h * 0.7;
      return { x: r.x + r.w * x, waist: counterY + 14 * u - d * 36 * u, sc: 1 - 0.3 * d };
    }
    function drawBackdrop(r, prog) {
      const u = sceneU(r);
      const horizon = r.y + r.h * 0.5, sandY = r.y + r.h * 0.6;
      const g = c.createLinearGradient(0, r.y, 0, horizon);
      g.addColorStop(0, mixC('#ffe9d2', '#f4a582', prog)); g.addColorStop(1, mixC('#fde3c6', '#f2946d', prog));
      c.fillStyle = g; c.fillRect(r.x, r.y, r.w, horizon - r.y + 1);
      const sx = r.x + r.w * 0.76, sy = horizon - r.h * (0.13 - prog * 0.08), sr = 20 * u;
      const gl = c.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 3.2);
      gl.addColorStop(0, 'rgba(255,240,210,.85)'); gl.addColorStop(1, 'rgba(255,240,210,0)');
      c.fillStyle = gl; c.fillRect(sx - sr * 3.2, sy - sr * 3.2, sr * 6.4, sr * 6.4);
      c.fillStyle = mixC('#fff3da', '#ffd9a8', prog); circle(c, sx, sy, sr); c.fill();
      const drift = reduced ? 0 : anim * 4;
      c.fillStyle = 'rgba(255,255,255,.55)';
      [[0.18, 0.2, 1], [0.52, 0.12, 0.8], [0.9, 0.26, 0.9]].forEach(function (cl, i) {
        let x = r.x + ((cl[0] * r.w + drift * (1 + i * 0.3)) % (r.w + 120 * u)) - 40 * u;
        const y = r.y + r.h * cl[1], s = cl[2] * u;
        ell(c, x, y, 26 * s, 8 * s); c.fill(); ell(c, x + 12 * s, y - 6 * s, 14 * s, 8 * s); c.fill(); ell(c, x - 10 * s, y - 3 * s, 12 * s, 6 * s); c.fill();
      });
      // sea
      const sg = c.createLinearGradient(0, horizon, 0, sandY);
      sg.addColorStop(0, '#2b6b66'); sg.addColorStop(1, '#3f8f86');
      c.fillStyle = sg; c.fillRect(r.x, horizon, r.w, sandY - horizon + 1);
      c.fillStyle = rgba('#ffe1c4', 0.35 + prog * 0.2); c.fillRect(sx - sr * 1.2, horizon + 3, sr * 2.4, 2); c.fillRect(sx - sr * 0.8, horizon + 9, sr * 1.6, 2);
      c.strokeStyle = 'rgba(255,255,255,.3)'; c.lineWidth = 1.5;
      for (let row = 0; row < 3; row++) {
        const y = horizon + (sandY - horizon) * (0.25 + row * 0.27), off = reduced ? 0 : (anim * (8 + row * 5)) % 40;
        for (let x = r.x - 40 + off + row * 13; x < r.x + r.w; x += 40) { c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 6, y - 3, x + 12, y); c.stroke(); }
      }
      // sand + foam
      c.fillStyle = '#f4dfbd'; c.fillRect(r.x, sandY, r.w, r.y + r.h - sandY);
      c.fillStyle = 'rgba(255,255,255,.75)';
      c.beginPath(); c.moveTo(r.x, sandY + 2);
      const fo = reduced ? 0 : Math.sin(anim * 0.8) * 3;
      for (let x = r.x; x <= r.x + r.w + 20; x += 20) c.quadraticCurveTo(x + 10, sandY + 6 + fo, x + 20, sandY + 2);
      c.lineTo(r.x + r.w, sandY - 2); c.lineTo(r.x, sandY - 2); c.closePath(); c.fill();
      // palm
      const px = r.x + r.w * 0.06, pb = sandY + 26 * u, sway = reduced ? 0 : Math.sin(anim * 0.9) * 0.05;
      c.strokeStyle = '#8a5a3c'; c.lineWidth = 7 * u; c.lineCap = 'round';
      const topX = px + 22 * u, topY = pb - 120 * u;
      c.beginPath(); c.moveTo(px, pb); c.quadraticCurveTo(px - 4 * u, pb - 70 * u, topX, topY); c.stroke();
      c.save(); c.translate(topX, topY); c.rotate(sway);
      [-2.7, -2.1, -1.2, -0.5, 0.15].forEach(function (a, i) {
        c.save(); c.rotate(a);
        c.fillStyle = i % 2 ? '#2f7d5b' : '#3f9a6c';
        c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(26 * u, -12 * u, 52 * u, 6 * u); c.quadraticCurveTo(26 * u, 2 * u, 0, 0); c.fill();
        c.restore();
      });
      c.fillStyle = '#7a4a2a'; circle(c, 2 * u, 3 * u, 4 * u); c.fill(); circle(c, -4 * u, 4 * u, 3.5 * u); c.fill();
      c.restore();
      // umbrella
      const ux = r.x + r.w * 0.93, ub = sandY + 22 * u;
      c.strokeStyle = '#7d6a58'; c.lineWidth = 2.2 * u; c.beginPath(); c.moveTo(ux, ub); c.lineTo(ux - 6 * u, ub - 58 * u); c.stroke();
      c.save(); c.translate(ux - 6 * u, ub - 58 * u); c.rotate(-0.12);
      for (let i = 0; i < 6; i++) {
        c.fillStyle = i % 2 ? '#f6f1e9' : C.accent;
        c.beginPath(); c.moveTo(0, -4 * u); c.arc(0, 8 * u, 34 * u, Math.PI + i * Math.PI / 6, Math.PI + (i + 1) * Math.PI / 6); c.closePath(); c.fill();
      }
      c.restore();
    }
    function counterFront(r, counterY, u) {
      c.fillStyle = '#f1dcbc'; c.fillRect(r.x, counterY - 5 * u, r.w, 12 * u);
      c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(r.x, counterY - 5 * u, r.w, 2);
      tiles({ x: r.x, y: counterY + 7 * u, w: r.w, h: r.y + r.h - counterY - 7 * u }, false);
      c.fillStyle = 'rgba(0,0,0,.16)'; c.fillRect(r.x, counterY + 7 * u, r.w, 4 * u);
    }
    function awning(r, u, noPlaque) {
      const ah = 22 * u, sw = 24 * u;
      c.fillStyle = 'rgba(12,28,33,.12)'; c.fillRect(r.x, r.y + ah, r.w, 8 * u);
      for (let i = 0, x = r.x; x < r.x + r.w; x += sw, i++) {
        c.fillStyle = i % 2 ? '#f6f1e9' : C.accent;
        c.fillRect(x, r.y, sw + 0.5, ah);
        c.beginPath(); c.arc(x + sw / 2, r.y + ah, sw / 2, 0, Math.PI); c.fill();
      }
      c.fillStyle = 'rgba(0,0,0,.08)'; c.fillRect(r.x, r.y, r.w, 3 * u);
      if (noPlaque) return r.y + ah + 6 * u;
      // plaque
      const pw = Math.min(150 * u, r.w * 0.46), ph = 24 * u, px = r.x + r.w / 2 - pw / 2, py = r.y + 6 * u;
      c.fillStyle = 'rgba(12,28,33,.25)'; rr(c, px, py + 2, pw, ph, 7 * u); c.fill();
      c.fillStyle = '#fffaf2'; rr(c, px, py, pw, ph, 7 * u); c.fill();
      c.strokeStyle = C.gold; c.lineWidth = 2; rr(c, px + 2.5, py + 2.5, pw - 5, ph - 5, 5 * u); c.stroke();
      txtFit(c, 'La Nevería', px + pw / 2, py + ph / 2 + 1, pw - 16, 15 * u, C.accentDark, 'center', 700, true);
      return r.y + ah + 6 * u;
    }

    /* ---------------- order station ---------------- */
    function drawOrderStation(r) {
      const u = sceneU(r), prog = shift ? clamp(gt / 220, 0, 1) * 0.8 : 0.2;
      drawBackdrop(r, prog);
      const counterY = r.y + r.h * 0.7;
      const ppl = shift ? shift.list.filter(function (cu) { return cu.role && cu.role !== 'gone'; }) : [];
      ppl.sort(function (a, b) { return b.d - a.d; });
      const heads = [];
      ppl.forEach(function (cu) {
        const p = spotXY(r, cu.x, cu.d, u);
        let a = 1;
        if (reduced) {
          a = clamp((anim - cu.spawnAt) / 0.35, 0, 1);
          if (cu.role === 'leave') a = clamp(1 - (gt - cu.leaveGt) / 0.7, 0, 1);
        }
        let bob = 0;
        if (!reduced) {
          if (cu.walking) bob = -Math.abs(Math.sin(anim * 9 + cu.idx)) * 3 * u;
          else bob = Math.sin(anim * 2 + cu.idx) * 0.8 * u;
          const ht = anim - cu.hopAt;
          if (ht > 0 && ht < (cu.mood === 'delight' ? 1.0 : 0.5)) bob -= Math.abs(Math.sin(ht * Math.PI * 2)) * 14 * u;
        }
        c.globalAlpha = a;
        const blink = ((anim + cu.look.blink) % 4.2) < 0.13;
        const waving = cu.role === 'window' && cu.arrived && cu.waveAt != null && anim - cu.waveAt < 1.4 && !reduced;
        const info = drawPerson(c, cu.look, p.x, p.waist + bob, u * p.sc * 1.2, cu.mood, {
          walk: cu.walking && !reduced ? anim * 9 + cu.idx : null,
          wave: waving ? anim * 10 : null,
          holding: cu.role === 'leave' && cu.outcome === 'served' ? cu.holding : null,
          blink: blink
        });
        c.globalAlpha = 1;
        heads.push({ cu: cu, x: p.x, top: info.headTop + bob, sc: p.sc, a: a });
        if (cu.role === 'window' || cu.role === 'wait') {
          addHit({ x: p.x - 30 * u * p.sc, y: info.headTop, w: 60 * u * p.sc, h: counterY - info.headTop }, 'cust-' + cu.id, true, function () {
            if (cu.role === 'window') actTake(); else if (cu.role === 'wait') actSelect(tickets.indexOf(cu));
          });
        }
      });
      counterFront(r, counterY, u);
      // props on the counter
      const jx = r.x + Math.max(16 * u, r.w * 0.045), jy = counterY - 4 * u;
      c.fillStyle = 'rgba(255,255,255,.55)'; rr(c, jx - 11 * u, jy - 26 * u, 22 * u, 26 * u, 5 * u); c.fill();
      ['#e2b066', '#d9a454', '#e8bd78'].forEach(function (col, i) {
        c.save(); c.translate(jx - 5 * u + i * 5 * u, jy - 6 * u); c.rotate(-0.2 + i * 0.2);
        c.fillStyle = col; rr(c, -2.5 * u, -30 * u, 5 * u, 30 * u, 2 * u); c.fill(); c.restore();
      });
      c.strokeStyle = 'rgba(16,37,43,.25)'; c.lineWidth = 1.2; rr(c, jx - 11 * u, jy - 26 * u, 22 * u, 26 * u, 5 * u); c.stroke();
      // napkins
      const nx = r.x + r.w - Math.max(16 * u, r.w * 0.045);
      c.fillStyle = '#c9933f'; rr(c, nx - 12 * u, counterY - 18 * u, 24 * u, 14 * u, 3 * u); c.fill();
      c.fillStyle = '#fffaf2'; c.fillRect(nx - 9 * u, counterY - 24 * u, 18 * u, 8 * u);
      const papelY = awning(r, u);
      papel(r.x - 4, r.x + r.w + 4, papelY, L.k, 24 * L.k);
      // overlays: patience, tags, speech bubble
      heads.forEach(function (h) {
        const cu = h.cu;
        if (cu.role !== 'window' && cu.role !== 'wait' && cu.role !== 'line') return;
        c.globalAlpha = h.a;
        const pl = patienceLeft(cu), bw = 38 * u * h.sc, by = h.top - 10 * u;
        c.fillStyle = 'rgba(12,28,33,.45)'; rr(c, h.x - bw / 2 - 1.5, by - 1.5, bw + 3, 7 * u + 3, 5 * u); c.fill();
        c.fillStyle = pl > 0.5 ? '#5cc48a' : pl > 0.25 ? C.goldLight : C.bad;
        rr(c, h.x - bw / 2, by, Math.max(3, bw * pl), 7 * u, 3.5 * u); c.fill();
        if (cu.role === 'wait') {
          const tw = 28 * u * h.sc, th = 16 * u * h.sc;
          c.fillStyle = cu.tag; rr(c, h.x - tw / 2, by - th - 4 * u, tw, th, 5 * u); c.fill();
          txt(c, '#' + cu.id, h.x, by - th / 2 - 4 * u + 1, 10.5 * u * h.sc, '#fff', 'center', 800);
          const sel = cur() === cu;
          if (sel) { c.strokeStyle = '#fff'; c.lineWidth = 2; rr(c, h.x - tw / 2 - 2, by - th - 6 * u, tw + 4, th + 4, 6 * u); c.stroke(); }
        }
        if (cu.role === 'window' && cu.arrived) {
          const full = tickets.length >= MAX_TICKETS;
          const t1 = full ? 'Hmm, busy…' : '¡Hola!', t2 = full ? 'Serve someone first' : 'Tap to take my order';
          c.font = font(10.5 * u, 600);
          const bw2 = Math.max(c.measureText(t2).width + 22 * u, 92 * u), bh2 = 38 * u;
          let bx = h.x + 20 * u;
          if (bx + bw2 > r.x + r.w - 6) bx = h.x - 20 * u - bw2;
          const byy = Math.max(papelY + 30 * L.k, h.top - bh2 - 14 * u);
          const pop = reduced ? 1 : easeOutBack(clamp((anim - (cu.waveAt || 0)) / 0.35, 0, 1));
          c.save(); c.translate(bx + bw2 / 2, byy + bh2); c.scale(pop, pop); c.translate(-(bx + bw2 / 2), -(byy + bh2));
          c.fillStyle = 'rgba(12,28,33,.18)'; rr(c, bx, byy + 2, bw2, bh2, 12 * u); c.fill();
          c.fillStyle = '#fffdf9'; rr(c, bx, byy, bw2, bh2, 12 * u); c.fill();
          const tailX = bx < h.x ? bx + bw2 - 16 * u : bx + 16 * u;
          c.beginPath(); c.moveTo(tailX - 6 * u, byy + bh2 - 1); c.lineTo(tailX + 6 * u, byy + bh2 - 1); c.lineTo(tailX + (bx < h.x ? 10 : -10) * u, byy + bh2 + 9 * u); c.closePath(); c.fill();
          txt(c, t1, bx + bw2 / 2, byy + 13 * u, 14 * u, C.accentDark, 'center', 700, true);
          txt(c, t2, bx + bw2 / 2, byy + 27 * u, 10.5 * u, C.ink2, 'center', 600);
          c.restore();
        }
        c.globalAlpha = 1;
      });
      // take-order button on the counter
      const w = byRole('window');
      const bh = clamp(50 * L.k, 46, 62), bw = Math.min(r.w - 32, 230 * L.k);
      const front = r.y + r.h - (counterY + 7 * u);
      const br = { x: r.x + r.w / 2 - bw / 2, y: counterY + 7 * u + Math.max(6, (front - bh) / 2), w: bw, h: bh };
      if (w && w.arrived) {
        const full = tickets.length >= MAX_TICKETS;
        pill(br, 'take', full ? 'Rail full' : 'Take order', {
          enabled: !full, explain: true, fill: C.goldLight, color: C.ink, offFill: 'rgba(255,255,255,.18)', offColor: 'rgba(255,255,255,.75)',
          px: 17 * L.k, icon: full ? null : function (x, y, s, col) { bellIcon(x, y, s, col); }
        }, actTake);
      } else if (shift) {
        const msg = shift.next >= shift.n ? (tickets.length ? 'Last customers! Finish their treats.' : 'That’s everyone for today!') : 'Waiting for the next customer…';
        txtFit(c, msg, r.x + r.w / 2, br.y + bh / 2, r.w - 30, 13 * L.k, 'rgba(255,255,255,.85)', 'center', 600);
      }
    }
    function bellIcon(x, y, s, col) {
      c.fillStyle = col;
      c.beginPath(); c.arc(x, y + s * 0.18, s * 0.4, Math.PI, 0); c.closePath(); c.fill();
      c.fillRect(x - s * 0.5, y + s * 0.2, s, s * 0.12);
      circle(c, x, y - s * 0.28, s * 0.08); c.fill();
    }

    /* ---------------- side: rail + ticket card ---------------- */
    function railSlot(i) {
      const r = L.rail, gap = 6 * L.k, tw = (r.w - gap * 2) / 3;
      return { x: r.x + i * (tw + gap), y: r.y + 6, w: tw, h: r.h - 6 };
    }
    function drawSide() {
      const s = L.side, k = L.k;
      c.fillStyle = C.night2; c.fillRect(s.x, s.y, s.w, s.h);
      const r = L.rail;
      c.strokeStyle = C.gold; c.lineWidth = 3; c.lineCap = 'round';
      c.beginPath(); c.moveTo(r.x + 2, r.y + 3); c.lineTo(r.x + r.w - 2, r.y + 3); c.stroke();
      for (let i = 0; i < MAX_TICKETS; i++) {
        const b = railSlot(i), t = tickets[i];
        if (!t) {
          c.save(); c.setLineDash([4, 4]); c.strokeStyle = 'rgba(244,237,226,.22)'; c.lineWidth = 1.5;
          rr(c, b.x + 1, b.y + 1, b.w - 2, b.h - 2, 8 * k); c.stroke(); c.restore();
          txtFit(c, 'Empty', b.x + b.w / 2, b.y + b.h / 2, b.w - 10, 11 * k, 'rgba(244,237,226,.32)', 'center', 600);
          continue;
        }
        const sel = i === selected, pl = patienceLeft(t);
        addHit({ x: b.x, y: b.y - 6, w: b.w, h: b.h + 6 }, 'tk' + i, true, function () { actSelect(i); });
        pressWrap(b, 'tk' + i, function () {
          const lift = sel ? -2 : 0;
          c.fillStyle = 'rgba(0,0,0,.3)'; rr(c, b.x, b.y + 2, b.w, b.h, 8 * k); c.fill();
          c.fillStyle = sel ? '#fffdf9' : '#e9e1d3'; rr(c, b.x, b.y + lift, b.w, b.h, 8 * k); c.fill();
          c.fillStyle = t.tag; rr(c, b.x, b.y + lift, 5 * k, b.h, 3); c.fill();
          if (sel) { c.strokeStyle = C.accent; c.lineWidth = 3; rr(c, b.x + 1.5, b.y + lift + 1.5, b.w - 3, b.h - 3, 7 * k); c.stroke(); }
          const blinkOn = pl < 0.25 && (reduced || Math.sin(anim * 10) > 0);
          if (blinkOn) { c.strokeStyle = C.bad; c.lineWidth = 2.5; rr(c, b.x + 1.5, b.y + lift + 1.5, b.w - 3, b.h - 3, 7 * k); c.stroke(); }
          const hr = Math.min(b.h * 0.3, 15 * k), hx = b.x + 9 * k + hr, hy = b.y + lift + b.h * 0.45;
          c.save(); circle(c, hx, hy, hr); c.clip();
          c.fillStyle = rgba(t.tag, 0.22); c.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
          drawHead(c, t.look, hx, hy + hr * 0.22, hr * 0.72, t.mood, false);
          c.restore();
          const tx = b.x + 14 * k + hr * 2, tw = b.x + b.w - tx - 6 * k;
          txtFit(c, t.name, tx, b.y + lift + b.h * 0.34, tw, 12.5 * k, C.ink, 'left', 700);
          txtFit(c, '#' + t.id, tx, b.y + lift + b.h * 0.62, tw, 10 * k, C.ink3, 'left', 600);
          // patience bar
          const bx = b.x + 9 * k, bw = b.w - 16 * k, by = b.y + lift + b.h - 8 * k;
          c.fillStyle = 'rgba(16,37,43,.12)'; rr(c, bx, by, bw, 4 * k, 2 * k); c.fill();
          c.fillStyle = pl > 0.5 ? C.good : pl > 0.25 ? C.warn : C.bad; rr(c, bx, by, Math.max(3, bw * pl), 4 * k, 2 * k); c.fill();
        });
        c.fillStyle = '#b07a3a'; rr(c, b.x + b.w / 2 - 4 * k, b.y - 7, 8 * k, 11, 2); c.fill();
      }
      drawTicketCard();
    }
    function ticketItems(t, land) {
      const o = t.order, m = t.made, z = blendZone(m.blendVal), items = [];
      items.push({ sec: 'Cup', kind: 'size', id: o.size, label: LABEL.size[o.size], ok: m.size === o.size });
      o.flavors.forEach(function (f) { items.push({ sec: 'Nieve', kind: 'flavor', id: f, label: LABEL.flavor[f], ok: m.flavors.indexOf(f) >= 0 }); });
      if (o.mixins.length) o.mixins.forEach(function (x) { items.push({ sec: 'Mix-ins', kind: 'mixin', id: x, label: LABEL.mixin[x], ok: m.mixins.indexOf(x) >= 0 }); });
      else if (land) items.push({ sec: 'Mix-ins', kind: 'none', id: '', label: 'None', ok: null });
      if (o.blend) items.push({ sec: 'Blend', kind: 'blend', id: o.blend, label: LABEL.blend[o.blend], ok: z === o.blend });
      else items.push({ sec: 'Blend', kind: 'noblend', id: '', label: 'No blend', ok: m.flavors.length ? !z : false });
      o.toppings.forEach(function (x) { items.push({ sec: 'Toppings', kind: 'topping', id: x, label: LABEL.topping[x], ok: m.toppings.indexOf(x) >= 0 }); });
      return items;
    }
    function flowTicket(items, r, land, s, k, top) {
      const pad = 10 * k, cells = [], heads = [], seps = [];
      const lp = land ? clamp(s * 0.4, 11, 14 * k) : clamp(s * 0.34, 9, 12 * k);
      const rowH = land ? s + 6 * k : s + lp + 8 * k;
      let x = r.x + pad, y = top, last = null;
      items.forEach(function (it) {
        c.font = font(lp, land ? 700 : 600);
        const tw = c.measureText(it.label).width;
        const cw = land ? s + tw + 20 * k : Math.max(s + 6 * k, tw + 8 * k);
        if (it.sec !== last) {
          if (land) {
            if (last !== null) y += rowH + 5 * k;
            x = r.x + pad;
            heads.push({ t: it.sec, x: x, y: y + 6 * k });
            y += 15 * k;
          } else if (last !== null && x + 10 * k + cw <= r.x + r.w - pad) { seps.push({ x: x + 4 * k, y: y }); x += 9 * k; }
          last = it.sec;
        }
        if (x + cw > r.x + r.w - pad && x > r.x + pad + 1) { x = r.x + pad; y += rowH + (land ? 5 * k : 0); }
        cells.push({ it: it, x: x, y: y, w: Math.min(cw, r.w - pad * 2) });
        x += cw + (land ? 6 * k : 0);
      });
      return { cells: cells, heads: heads, seps: seps, bottom: y + rowH, lp: lp, rowH: rowH };
    }
    function extrasOf(t) {
      const m = t.made, o = t.order, out = [];
      m.flavors.forEach(function (f) { if (o.flavors.indexOf(f) < 0) out.push(LABEL.flavor[f]); });
      m.mixins.forEach(function (f) { if (o.mixins.indexOf(f) < 0) out.push(LABEL.mixin[f]); });
      m.toppings.forEach(function (f) { if (o.toppings.indexOf(f) < 0) out.push(LABEL.topping[f]); });
      if (m.size && m.size !== o.size) out.unshift(LABEL.size[m.size] + ' cup');
      const z = blendZone(m.blendVal);
      if (z && z !== o.blend) out.push(o.blend ? LABEL.blend[z] + ' blend' : 'Blended');
      return out;
    }
    /** A small red note in the work area listing what's in the cup but not on the ticket. */
    function extrasNote(t, cx, y, maxW) {
      if (!t) return;
      const ex = extrasOf(t);
      if (!ex.length) return;
      const k = L.k, msg = 'Not on ticket: ' + ex.join(', ');
      c.font = font(11.5 * k, 700);
      const w = Math.min(maxW, c.measureText(msg).width + 22 * k), h = 24 * k;
      c.fillStyle = 'rgba(255,253,249,.95)'; rr(c, cx - w / 2, y, w, h, h / 2); c.fill();
      c.strokeStyle = rgba(C.bad, 0.5); c.lineWidth = 1.5; rr(c, cx - w / 2, y, w, h, h / 2); c.stroke();
      txtFit(c, msg, cx, y + h / 2 + 1, w - 16 * k, 11.5 * k, C.bad, 'center', 700);
    }
    function drawTicketCard() {
      const r = L.card, k = L.k, land = L.land;
      c.fillStyle = 'rgba(0,0,0,.28)'; rr(c, r.x, r.y + 3, r.w, r.h, 10 * k); c.fill();
      c.fillStyle = '#fffdf9'; rr(c, r.x, r.y, r.w, r.h, 10 * k); c.fill();
      c.fillStyle = C.night2;
      circle(c, r.x, r.y + r.h / 2, 6 * k); c.fill(); circle(c, r.x + r.w, r.y + r.h / 2, 6 * k); c.fill();
      const t = cur();
      if (!t) {
        const msg1 = tickets.length ? 'Tap a ticket above' : 'No orders yet';
        const msg2 = tickets.length ? 'to see what to make' : 'Take one at the Order counter (1)';
        txtFit(c, msg1, r.x + r.w / 2, r.y + r.h / 2 - 9 * k, r.w - 24, 15 * k, C.ink, 'center', 700, true);
        txtFit(c, msg2, r.x + r.w / 2, r.y + r.h / 2 + 11 * k, r.w - 24, 11.5 * k, C.ink3, 'center', 600);
        return;
      }
      let top = r.y + 6 * k;
      if (land) {
        c.fillStyle = t.tag; rr(c, r.x + 12 * k, r.y + 12 * k, 34 * k, 22 * k, 7 * k); c.fill();
        txt(c, '#' + t.id, r.x + 29 * k, r.y + 23.5 * k, 11.5 * k, '#fff', 'center', 800);
        txtFit(c, t.name + '’s order', r.x + 54 * k, r.y + 23 * k, r.w - 66 * k, 17 * k, C.ink, 'left', 700, true);
        const pl = patienceLeft(t), bx = r.x + 12 * k, bw = r.w - 24 * k;
        c.fillStyle = 'rgba(16,37,43,.1)'; rr(c, bx, r.y + 42 * k, bw, 6 * k, 3 * k); c.fill();
        c.fillStyle = pl > 0.5 ? C.good : pl > 0.25 ? C.warn : C.bad; rr(c, bx, r.y + 42 * k, Math.max(3, bw * pl), 6 * k, 3 * k); c.fill();
        c.strokeStyle = 'rgba(16,37,43,.15)'; c.setLineDash([3, 4]); c.lineWidth = 1;
        c.beginPath(); c.moveTo(r.x + 12 * k, r.y + 57 * k); c.lineTo(r.x + r.w - 12 * k, r.y + 57 * k); c.stroke(); c.setLineDash([]);
        top = r.y + 60 * k;
      }
      const items = ticketItems(t, land);
      let s = (land ? 42 : 40) * k, fl;
      for (; ;) {
        fl = flowTicket(items, r, land, s, k, top);
        if (fl.bottom <= r.y + r.h - 6 * k || s <= 18) break;
        s -= 1.5;
      }
      if (!land) {
        const off = Math.max(0, (r.y + r.h - 4 * k - fl.bottom) / 2);
        fl.cells.forEach(function (cl) { cl.y += off; });
        fl.seps.forEach(function (sp) { sp.y += off; });
      }
      fl.heads.forEach(function (h) { txt(c, h.t.toUpperCase(), h.x + 2, h.y, 9.5 * k, C.ink3, 'left', 800); });
      fl.seps.forEach(function (sp) {
        c.strokeStyle = 'rgba(16,37,43,.14)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(sp.x, sp.y + 4 * k); c.lineTo(sp.x, sp.y + s + fl.lp); c.stroke();
      });
      fl.cells.forEach(function (cl) {
        const it = cl.it;
        if (land) {
          const h = fl.rowH;
          c.fillStyle = it.ok ? 'rgba(63,159,107,.13)' : it.kind === 'none' ? 'rgba(16,37,43,.04)' : '#f5eee3';
          rr(c, cl.x, cl.y, cl.w, h, h / 2); c.fill();
          if (it.ok) { c.strokeStyle = 'rgba(63,159,107,.55)'; c.lineWidth = 1.5; rr(c, cl.x + 0.75, cl.y + 0.75, cl.w - 1.5, h - 1.5, h / 2); c.stroke(); }
          drawIcon(c, it.kind, it.id, cl.x + 5 * k + s / 2, cl.y + h / 2, s * 0.92);
          txtFit(c, it.label, cl.x + s + 11 * k, cl.y + h / 2 + 1, cl.w - s - 16 * k, fl.lp, it.kind === 'none' ? C.ink3 : C.ink, 'left', 700);
          if (it.ok) checkMark(c, cl.x + s * 0.88, cl.y + s * 0.2, Math.max(5.5, s * 0.17));
        } else {
          const cx = cl.x + cl.w / 2;
          drawIcon(c, it.kind, it.id, cx, cl.y + s / 2 + 2 * k, s);
          txt(c, it.label, cx, cl.y + s + fl.lp * 0.5 + 5 * k, fl.lp, C.ink2, 'center', 600);
          if (it.ok) checkMark(c, cx + s * 0.4, cl.y + s * 0.12 + 2 * k, Math.max(5.5, s * 0.17));
        }
      });
    }

    /* ---------------- build / blend / top ---------------- */
    function noTicketNote(r) {
      if (cur()) return;
      const k = L.k;
      const msg = tickets.length ? 'Tap a ticket to start' : 'Take an order first';
      c.font = font(14 * k, 700, true);
      const w = c.measureText(msg).width + 32 * k, h = 36 * k;
      c.fillStyle = 'rgba(12,28,33,.78)'; rr(c, r.x + r.w / 2 - w / 2, r.y + r.h * 0.42 - h / 2, w, h, h / 2); c.fill();
      txt(c, msg, r.x + r.w / 2, r.y + r.h * 0.42 + 1, 14 * k, C.onNight, 'center', 700, true);
    }
    function cupScale(sceneH, sceneW) { return clamp(Math.min((sceneH - 30 * L.k) / 150, sceneW / 130), 0.5, 2); }
    function drawBuild(r) {
      const k = L.k, pad = 8 * k, gap = 6 * k, t = cur(), m = t && t.made, en = !!t;
      wall(r);
      let scene, ctrlR;
      if (!L.land) {
        const bh = clamp(54 * k, 48, 84);
        const ph = bh * 2 + gap * 3;
        ctrlR = { x: r.x, y: r.y + r.h - ph, w: r.w, h: ph };
        tiles(ctrlR);
        const bw = (r.w - pad * 2 - gap * 5) / 6;
        FLAVORS.forEach(function (f, i) {
          ingButton({ x: r.x + pad + i * (bw + gap), y: ctrlR.y + gap, w: bw, h: bh }, 'flavor', f, !!(m && m.flavors.indexOf(f) >= 0), en, function () { actScoop(f); });
        });
        MIXINS.forEach(function (f, i) {
          ingButton({ x: r.x + pad + i * (bw + gap), y: ctrlR.y + gap * 2 + bh, w: bw, h: bh }, 'mixin', f, !!(m && m.mixins.indexOf(f) >= 0), en, function () { actMixin(f); });
        });
        scene = { x: r.x, y: r.y, w: r.w, h: ctrlR.y - r.y };
        const sw = clamp(64 * k, 54, 80);
        const top = scene.y + 30 * k, roomH = scene.h - (top - scene.y) - 10 * k;
        const stacked = roomH >= 44 * 3 + gap * 2;
        const sh = stacked ? Math.min(50 * k, (roomH - gap * 2) / 3) : 46;
        SIZES.forEach(function (sz, i) {
          // short screens: S/M/L in a row along the top instead of a column
          sizeButton(stacked ? { x: r.x + pad, y: top + i * (sh + gap), w: sw, h: sh } : { x: r.x + pad + i * (50 + gap), y: top, w: 50, h: sh }, sz, m, en);
        });
        iconBtn({ x: r.x + r.w - pad - sw, y: top, w: sw, h: Math.max(44, sh) }, 'reset', en && !!(m && (m.flavors.length || m.mixins.length || m.toppings.length || m.blendVal)), actReset, trashIcon, 'Start over');
        const s = Math.min(cupScale(scene.h - (stacked ? 0 : sh), r.w - sw * 2 - pad * 4), 1.3 * k);
        drawTreat(c, m, r.x + r.w / 2, ctrlR.y - 9 * k, s, en ? 'Pick a cup' : '');
        if (stacked) extrasNote(t, r.x + r.w / 2, top, r.w - (sw + pad * 2) * 2);
        else extrasNote(t, r.x + r.w / 2, top + sh + gap, r.w - pad * 2);
      } else {
        const cw = r.w * 0.56;
        ctrlR = { x: r.x + r.w - cw, y: r.y + 30 * k, w: cw - pad, h: r.h - 30 * k - pad };
        tiles({ x: r.x, y: r.y + r.h * 0.82, w: r.w - cw, h: r.h * 0.18 });
        c.fillStyle = 'rgba(0,0,0,.18)'; rr(c, ctrlR.x, ctrlR.y + 3, ctrlR.w, ctrlR.h, 14 * k); c.fill();
        c.save(); rr(c, ctrlR.x, ctrlR.y, ctrlR.w, ctrlR.h, 14 * k); c.clip(); tiles(ctrlR, false); c.restore();
        const ip = 10 * k, hdr = 18 * k, cols = 3;
        const bw = (ctrlR.w - ip * 2 - gap * (cols - 1)) / cols;
        const bh = clamp((ctrlR.h - ip * 2 - hdr * 3 - gap * 4) / 5, 44, 74 * k);
        let y = ctrlR.y + ip;
        const head = function (s) { txt(c, s.toUpperCase(), ctrlR.x + ip + 2, y + hdr / 2 - 1, 10.5 * k, 'rgba(246,241,233,.85)', 'left', 800); y += hdr; };
        head('Cup size');
        SIZES.forEach(function (sz, i) { sizeButton({ x: ctrlR.x + ip + i * (bw + gap), y: y, w: bw, h: bh }, sz, m, en); });
        y += bh + gap;
        head('Nieve');
        FLAVORS.forEach(function (f, i) {
          ingButton({ x: ctrlR.x + ip + (i % 3) * (bw + gap), y: y + Math.floor(i / 3) * (bh + gap), w: bw, h: bh }, 'flavor', f, !!(m && m.flavors.indexOf(f) >= 0), en, function () { actScoop(f); });
        });
        y += bh * 2 + gap * 2;
        head('Mix-ins');
        MIXINS.forEach(function (f, i) {
          ingButton({ x: ctrlR.x + ip + (i % 3) * (bw + gap), y: y + Math.floor(i / 3) * (bh + gap), w: bw, h: bh }, 'mixin', f, !!(m && m.mixins.indexOf(f) >= 0), en, function () { actMixin(f); });
        });
        scene = { x: r.x, y: r.y, w: r.w - cw, h: r.h };
        iconBtn({ x: r.x + pad * 1.5, y: r.y + 34 * k, w: Math.max(58, 70 * k), h: Math.max(48, 56 * k) }, 'reset', en && !!(m && (m.flavors.length || m.mixins.length || m.toppings.length || m.blendVal)), actReset, trashIcon, 'Start over');
        const s = Math.min(cupScale(r.h * 0.82 - 50 * k, scene.w - 30 * k), 1.45);
        drawTreat(c, m, scene.x + scene.w / 2 + 10 * k, r.y + r.h * 0.82 - 6 * k, s, en ? 'Pick a cup' : '');
        extrasNote(t, scene.x + scene.w / 2, r.y + r.h * 0.82 + 14 * k, scene.w - 24 * k);
      }
      noTicketNote(scene);
    }
    function sizeButton(b, sz, m, en) {
      const on = !!(m && m.size === sz), k = L.k;
      const pulse = !reduced && anim - pulseSizes < 1 && !(m && m.size);
      addHit(b, 'size:' + sz, true, function () { actSize(sz); });
      pressWrap(b, 'size:' + sz, function () {
        c.fillStyle = 'rgba(0,0,0,.18)'; rr(c, b.x, b.y + 2.5, b.w, b.h, 10 * k); c.fill();
        c.fillStyle = en ? (on ? '#fff3e6' : '#fffaf2') : 'rgba(255,250,242,.55)'; rr(c, b.x, b.y, b.w, b.h, 10 * k); c.fill();
        if (on || pulse) { c.lineWidth = 3; c.strokeStyle = pulse && !on ? rgba('#e58c63', 0.5 + 0.5 * Math.sin(anim * 14)) : C.accent; rr(c, b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3, 9 * k); c.stroke(); }
        c.globalAlpha = en ? 1 : 0.55;
        const wide = b.w > b.h * 1.5;
        const is = wide ? Math.min(b.h * 0.72, b.w * 0.32) : Math.min(b.h * 0.8, b.w * 0.5);
        if (wide) {
          drawIcon(c, 'size', sz, b.x + 8 * k + is / 2, b.y + b.h / 2, is);
          txtFit(c, LABEL.size[sz], b.x + 14 * k + is, b.y + b.h / 2 + 1, b.w - is - 20 * k, 13.5 * k, C.ink, 'left', 700);
        } else {
          drawIcon(c, 'size', sz, b.x + b.w / 2, b.y + b.h / 2, is);
        }
        c.globalAlpha = 1;
        if (on) checkMark(c, b.x + b.w - 9 * k, b.y + 9 * k, 7 * k);
      });
    }
    function trashIcon(x, y, s) {
      c.fillStyle = C.ink2;
      rr(c, x - s * 0.42, y - s * 0.42, s * 0.84, s * 0.14, s * 0.05); c.fill();
      rr(c, x - s * 0.14, y - s * 0.56, s * 0.28, s * 0.14, s * 0.05); c.fill();
      c.beginPath(); c.moveTo(x - s * 0.34, y - s * 0.22); c.lineTo(x + s * 0.34, y - s * 0.22); c.lineTo(x + s * 0.27, y + s * 0.5); c.lineTo(x - s * 0.27, y + s * 0.5); c.closePath(); c.fill();
      c.strokeStyle = '#fffaf2'; c.lineWidth = Math.max(1.2, s * 0.07);
      [-0.13, 0, 0.13].forEach(function (d) { c.beginPath(); c.moveTo(x + d * s, y - s * 0.1); c.lineTo(x + d * s * 0.85, y + s * 0.38); c.stroke(); });
    }
    function blenderPos(r) {
      const k = L.k, holdH = clamp(56 * k, 50, 68), gap = 8 * k;
      const floorY = r.y + r.h - holdH - gap * 2 - 4 * k;
      const avail = floorY - (r.y + 66 * k);
      const s = clamp(Math.min(avail / 212, (r.w * 0.42) / 110), 0.5, 1.15);
      const cx = L.land ? r.x + r.w * 0.4 : r.x + (r.w - 110 * k) * 0.5;
      return { cx: cx, by: floorY - 2 * k, s: s, floorY: floorY, holdH: holdH, gap: gap };
    }
    function meterRect(r) {
      const k = L.k, b = blenderPos(r);
      const w = clamp(30 * k, 26, 40);
      const x = L.land ? r.x + r.w * 0.72 : r.x + r.w - 16 * k - w;
      const y = r.y + 72 * k, h = b.floorY - y - 14 * k;
      return { x: x, y: y, w: w, h: h };
    }
    function drawBlend(r) {
      const k = L.k, t = cur(), m = t && t.made;
      wall(r);
      const b = blenderPos(r);
      tiles({ x: r.x, y: b.floorY, w: r.w, h: r.y + r.h - b.floorY });
      // status line
      let status = '', sc = C.ink2;
      if (!t) status = '';
      else if (!m.size || !m.flavors.length) { status = 'Build the treat first (2)'; sc = C.bad; }
      else if (m.toppings.length) { status = 'Blend before toppings!'; sc = C.bad; }
      else if (!t.order.blend) { status = blendZone(m.blendVal) ? 'Oops, this one wasn’t meant to be blended' : 'No blend on this ticket: skip to Top (4)'; sc = blendZone(m.blendVal) ? C.bad : C.sea; }
      else status = 'Blend it ' + LABEL.blend[t.order.blend].toUpperCase();
      // blender
      const holding = !!(hold && hold.t === t);
      drawBlender(c, m, b.cx, b.by, b.s, holding);
      // meter
      const mr = meterRect(r);
      drawMeter(mr, m ? m.blendVal : 0, t ? t.order.blend : null);
      if (status) {
        c.font = font(12.5 * k, 700);
        const sw = Math.min(r.w - 24, c.measureText(status).width + 24 * k);
        const sx = L.land ? r.x + r.w * 0.4 - sw / 2 : r.x + 12 * k;
        c.fillStyle = 'rgba(255,253,249,.92)'; rr(c, sx, r.y + 30 * k, sw, 24 * k, 12 * k); c.fill();
        txtFit(c, status, sx + sw / 2, r.y + 42.5 * k, sw - 16 * k, 12.5 * k, sc, 'center', 700);
      }
      // hold button
      const bw = Math.min(r.w - 32 * k, 300 * k);
      const br = { x: r.x + r.w / 2 - bw / 2, y: b.floorY + b.gap, w: bw, h: b.holdH };
      const can = !!(t && m.size && m.flavors.length && !m.toppings.length && m.blendVal < 1);
      pill(br, 'blend-hold', holding ? 'Blending…' : 'Hold to blend', {
        enabled: can, explain: true, hold: true, fill: holding ? C.goldLight : C.accent, color: C.ink, px: 17 * k, sub: 'press & hold · Space',
        offFill: 'rgba(255,255,255,.2)', offColor: 'rgba(255,255,255,.8)',
        icon: function (x, y, s, col) { drawIcon(c, 'blend', 'smooth', x, y, s * 1.1); }
      }, null);
      noTicketNote({ x: r.x, y: r.y, w: r.w, h: b.floorY - r.y });
    }
    function drawBlender(c2, m, cx, by, s, holding) {
      let ox = 0, oy = 0;
      if (holding && !reduced) { ox = Math.sin(anim * 61) * 1.8 * s; oy = Math.cos(anim * 53) * 1.1 * s; }
      c2.save(); c2.translate(ox, oy);
      c2.fillStyle = 'rgba(12,28,33,.16)'; ell(c2, cx, by + 2 * s, 56 * s, 7 * s); c2.fill();
      // base
      const bw = 104 * s, bh = 46 * s;
      c2.fillStyle = '#245c58'; rr(c2, cx - bw / 2, by - bh, bw, bh, 12 * s); c2.fill();
      c2.fillStyle = C.sea; rr(c2, cx - bw / 2, by - bh, bw, bh - 6 * s, 12 * s); c2.fill();
      c2.fillStyle = 'rgba(255,255,255,.12)'; rr(c2, cx - bw / 2 + 6 * s, by - bh + 4 * s, bw - 12 * s, 6 * s, 3 * s); c2.fill();
      const val = m ? m.blendVal : 0;
      c2.fillStyle = '#fffaf2'; circle(c2, cx, by - bh / 2 - 2 * s, 12 * s); c2.fill();
      c2.strokeStyle = C.night2; c2.lineWidth = 2.5 * s;
      const da = Math.PI * 0.75 + val * Math.PI * 1.5;
      c2.beginPath(); c2.moveTo(cx, by - bh / 2 - 2 * s); c2.lineTo(cx + Math.cos(da) * 9 * s, by - bh / 2 - 2 * s + Math.sin(da) * 9 * s); c2.stroke();
      ['#f2c14e', '#8fcf8a', '#5bb6c9'].forEach(function (col, i) {
        const z = blendZone(val), lit = z && BLENDS.indexOf(z) >= i || z === 'soupy';
        c2.fillStyle = lit ? col : 'rgba(255,255,255,.2)';
        circle(c2, cx + 28 * s + i * 8 * s, by - bh / 2 - 2 * s, 2.6 * s); c2.fill();
      });
      // jar
      const jt = by - bh - 148 * s, jb = by - bh - 4 * s, tw = 98 * s, bwj = 70 * s;
      const jar = function () {
        c2.beginPath(); c2.moveTo(cx - tw / 2, jt); c2.lineTo(cx + tw / 2, jt); c2.lineTo(cx + bwj / 2, jb - 8 * s);
        c2.quadraticCurveTo(cx + bwj / 2, jb, cx + bwj / 2 - 8 * s, jb); c2.lineTo(cx - bwj / 2 + 8 * s, jb);
        c2.quadraticCurveTo(cx - bwj / 2, jb, cx - bwj / 2, jb - 8 * s); c2.closePath();
      };
      // handle
      c2.strokeStyle = 'rgba(210,228,226,.9)'; c2.lineWidth = 9 * s;
      c2.beginPath(); c2.moveTo(cx + tw / 2 - 6 * s, jt + 24 * s); c2.quadraticCurveTo(cx + tw / 2 + 30 * s, jt + 40 * s, cx + bwj / 2 + 4 * s, jb - 40 * s); c2.stroke();
      c2.strokeStyle = 'rgba(16,37,43,.25)'; c2.lineWidth = 1.5; c2.stroke();
      jar(); c2.fillStyle = 'rgba(255,255,255,.4)'; c2.fill();
      if (m && m.flavors.length) {
        c2.save(); jar(); c2.clip();
        const cols = m.flavors.map(function (f) { return FL[f].c; });
        const col = avgC(cols), z = blendZone(val);
        const level = clamp(0.3 + 0.13 * m.flavors.length + 0.04 * m.mixins.length, 0, 0.85);
        let surf = jb - (jb - jt) * level;
        if (!z && !holding) {
          // scoops resting at the bottom
          m.flavors.forEach(function (f, i) {
            const sr = 22 * s;
            scoopBall(c2, cx + (i - (m.flavors.length - 1) / 2) * 30 * s, jb - sr * 0.9 - (i === 1 && m.flavors.length === 3 ? 18 * s : 0), sr, f);
          });
          m.mixins.forEach(function (id, j) { for (let i = 0; i < 4; i++) bit(c2, id, cx - 24 * s + i * 16 * s, jb - 56 * s - j * 6 * s, 3.6 * s, i + j); });
        } else {
          const wave = holding && !reduced ? Math.sin(anim * 22) * 4 * s : 0;
          const jg = c2.createLinearGradient(0, surf, 0, jb);
          jg.addColorStop(0, shade(col, 0.08)); jg.addColorStop(1, shade(col, -0.16));
          c2.fillStyle = jg;
          c2.beginPath(); c2.moveTo(cx - tw, surf + wave);
          c2.quadraticCurveTo(cx, surf - (holding && !reduced ? 14 * s : 0) - wave, cx + tw, surf + wave);
          c2.lineTo(cx + tw, jb + 4); c2.lineTo(cx - tw, jb + 4); c2.closePath(); c2.fill();
          const chunk = 1 - clamp(val / 0.66, 0, 1);
          const rnd = mulberry32(hashStr(m.flavors.join('')));
          const rot = holding && !reduced ? anim * 7 : 0;
          for (let i = 0; i < Math.round(10 * chunk + 2); i++) {
            const a = rnd() * Math.PI * 2 + rot, rad = rnd() * 30 * s;
            const px = cx + Math.cos(a) * rad, py = jb - (jb - surf) * 0.5 + Math.sin(a) * rad * 0.6;
            c2.fillStyle = cols[i % cols.length]; circle(c2, px, py, (5 + rnd() * 7) * s * Math.max(0.3, chunk)); c2.fill();
          }
          m.mixins.forEach(function (id, j) {
            for (let i = 0; i < 4; i++) {
              const a = rnd() * Math.PI * 2 + rot * 1.3, rad = rnd() * 28 * s;
              bit(c2, id, cx + Math.cos(a) * rad, jb - (jb - surf) * 0.45 + Math.sin(a) * rad * 0.6, (2 + 2.5 * chunk) * s, a + j);
            }
          });
          if (holding && !reduced) {
            c2.strokeStyle = 'rgba(255,255,255,.45)'; c2.lineWidth = 2.5 * s;
            for (let i = 0; i < 3; i++) {
              const a0 = anim * 9 + i * 2.1;
              c2.beginPath(); c2.ellipse(cx, jb - (jb - surf) * 0.45, (14 + i * 9) * s, (6 + i * 4) * s, 0, a0, a0 + 1.4); c2.stroke();
            }
          }
          if (val > 0.6) { c2.fillStyle = 'rgba(255,255,255,.3)'; ell(c2, cx - 18 * s, surf + 14 * s, 8 * s, 18 * s, 0.2); c2.fill(); }
        }
        c2.restore();
      }
      // glass shine + outline
      c2.fillStyle = 'rgba(255,255,255,.45)';
      c2.beginPath(); c2.moveTo(cx - tw / 2 + 9 * s, jt + 10 * s); c2.lineTo(cx - tw / 2 + 17 * s, jt + 10 * s); c2.lineTo(cx - bwj / 2 + 14 * s, jb - 14 * s); c2.lineTo(cx - bwj / 2 + 8 * s, jb - 14 * s); c2.closePath(); c2.fill();
      jar(); c2.strokeStyle = 'rgba(16,37,43,.35)'; c2.lineWidth = 2.2 * s; c2.stroke();
      c2.strokeStyle = 'rgba(16,37,43,.25)'; c2.lineWidth = 1.2 * s;
      for (let i = 1; i <= 4; i++) { const yy = jb - (jb - jt) * i / 5; c2.beginPath(); c2.moveTo(cx + tw * 0.18, yy); c2.lineTo(cx + tw * 0.3, yy); c2.stroke(); }
      // lid
      c2.fillStyle = C.night2; rr(c2, cx - tw / 2 - 5 * s, jt - 13 * s, tw + 10 * s, 15 * s, 6 * s); c2.fill();
      rr(c2, cx - 12 * s, jt - 22 * s, 24 * s, 11 * s, 4 * s); c2.fill();
      c2.restore();
      if (!m || !m.flavors.length) txt(c2, 'empty', cx, jb - 60 * s, 12 * s + 3, 'rgba(16,37,43,.4)', 'center', 700);
    }
    function drawMeter(r, val, want) {
      const k = L.k;
      c.fillStyle = 'rgba(12,28,33,.2)'; rr(c, r.x - 5, r.y - 5 + 3, r.w + 10, r.h + 10, 13); c.fill();
      c.fillStyle = C.night2; rr(c, r.x - 5, r.y - 5, r.w + 10, r.h + 10, 13); c.fill();
      const zc = { chunky: '#f2c14e', regular: '#8fcf8a', smooth: '#5bb6c9', soupy: '#e0614a' };
      const yOf = function (v) { return r.y + r.h * (1 - v); };
      c.save(); rr(c, r.x, r.y, r.w, r.h, 8); c.clip();
      c.fillStyle = '#efe7da'; c.fillRect(r.x, r.y, r.w, r.h);
      BLEND_ZONES.forEach(function (z) {
        c.fillStyle = rgba(zc[z.id], 0.3);
        c.fillRect(r.x, yOf(z.to), r.w, yOf(z.from) - yOf(z.to));
        if (val > z.from) { c.fillStyle = zc[z.id]; const top = Math.min(val, z.to); c.fillRect(r.x, yOf(top), r.w, yOf(z.from) - yOf(top)); }
        c.fillStyle = 'rgba(16,37,43,.25)'; c.fillRect(r.x, yOf(z.from) - 0.5, r.w, 1);
      });
      c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(r.x + r.w * 0.16, r.y, r.w * 0.14, r.h);
      c.restore();
      // labels + target
      BLEND_ZONES.forEach(function (z) {
        const cy = (yOf(z.from) + yOf(z.to)) / 2, isT = want === z.id;
        const lx = r.x - 10 * k;
        if (isT) {
          c.strokeStyle = C.goldLight; c.lineWidth = 3;
          rr(c, r.x - 3, yOf(z.to) - 1, r.w + 6, yOf(z.from) - yOf(z.to) + 2, 6); c.stroke();
          c.font = font(12 * k, 800);
          const lw = c.measureText(LABEL.blend[z.id]).width + 26 * k;
          c.fillStyle = C.goldLight; rr(c, lx - lw, cy - 11 * k, lw, 22 * k, 11 * k); c.fill();
          c.fillStyle = C.goldLight; c.beginPath(); c.moveTo(lx, cy - 6 * k); c.lineTo(lx + 7 * k, cy); c.lineTo(lx, cy + 6 * k); c.closePath(); c.fill();
          c.fillStyle = C.ink; starPath(c, lx - lw + 11 * k, cy, 5.5 * k); c.fill();
          txt(c, LABEL.blend[z.id], lx - 8 * k, cy + 1, 12 * k, C.ink, 'right', 800);
        } else {
          txt(c, LABEL.blend[z.id], lx, cy + 1, 11 * k, z.id === 'soupy' ? C.bad : C.ink2, 'right', 700);
        }
      });
      // needle
      const ny = yOf(val);
      c.fillStyle = '#fff'; c.fillRect(r.x - 2, ny - 1.5, r.w + 4, 3);
      c.beginPath(); c.moveTo(r.x + r.w + 4, ny); c.lineTo(r.x + r.w + 12, ny - 6); c.lineTo(r.x + r.w + 12, ny + 6); c.closePath(); c.fill();
    }
    function drawTop(r) {
      const k = L.k, pad = 8 * k, gap = 6 * k, t = cur(), m = t && t.made;
      const en = !!(t && m.size && m.flavors.length);
      wall(r);
      let scene;
      if (!L.land) {
        const bh = clamp(54 * k, 48, 84), ph = bh * 2 + gap * 3;
        const ctrlR = { x: r.x, y: r.y + r.h - ph, w: r.w, h: ph };
        tiles(ctrlR);
        const bw = (r.w - pad * 2 - gap * 3) / 4;
        TOPPINGS.forEach(function (id, i) {
          ingButton({ x: r.x + pad + (i % 4) * (bw + gap), y: ctrlR.y + gap + Math.floor(i / 4) * (bh + gap), w: bw, h: bh }, 'topping', id, !!(m && m.toppings.indexOf(id) >= 0), en, function () { actTopping(id); });
        });
        scene = { x: r.x, y: r.y, w: r.w, h: ctrlR.y - r.y };
        const s = Math.min(cupScale(scene.h, r.w - 40 * k), 1.3 * k);
        drawTreat(c, m, r.x + r.w / 2, ctrlR.y - 9 * k, s, t ? 'Build it first (2)' : '');
        extrasNote(t, r.x + r.w / 2, scene.y + 30 * k, r.w - 24 * k);
      } else {
        const cw = r.w * 0.56;
        const ctrlR = { x: r.x + r.w - cw, y: r.y + 30 * k, w: cw - pad, h: r.h - 30 * k - pad };
        tiles({ x: r.x, y: r.y + r.h * 0.82, w: r.w - cw, h: r.h * 0.18 });
        c.fillStyle = 'rgba(0,0,0,.18)'; rr(c, ctrlR.x, ctrlR.y + 3, ctrlR.w, ctrlR.h, 14 * k); c.fill();
        c.save(); rr(c, ctrlR.x, ctrlR.y, ctrlR.w, ctrlR.h, 14 * k); c.clip(); tiles(ctrlR, false); c.restore();
        const ip = 10 * k, hdr = 18 * k;
        txt(c, 'TOPPINGS', ctrlR.x + ip + 2, ctrlR.y + ip + hdr / 2 - 1, 10.5 * k, 'rgba(246,241,233,.85)', 'left', 800);
        const bw = (ctrlR.w - ip * 2 - gap) / 2;
        const bh = clamp((ctrlR.h - ip * 2 - hdr - gap * 3) / 4, 44, 100 * k);
        TOPPINGS.forEach(function (id, i) {
          ingButton({ x: ctrlR.x + ip + (i % 2) * (bw + gap), y: ctrlR.y + ip + hdr + Math.floor(i / 2) * (bh + gap), w: bw, h: bh }, 'topping', id, !!(m && m.toppings.indexOf(id) >= 0), en, function () { actTopping(id); });
        });
        scene = { x: r.x, y: r.y, w: r.w - cw, h: r.h };
        const s = Math.min(cupScale(r.h * 0.82 - 50 * k, scene.w - 30 * k), 1.45);
        drawTreat(c, m, scene.x + scene.w / 2 + 10 * k, r.y + r.h * 0.82 - 6 * k, s, t ? 'Build it first (2)' : '');
        extrasNote(t, scene.x + scene.w / 2, r.y + r.h * 0.82 + 14 * k, scene.w - 24 * k);
      }
      noTicketNote(scene);
    }

    /* ---------------- HUD + tabs ---------------- */
    function drawHud() {
      const r = L.hud, k = L.k, cy = r.y + r.h / 2;
      c.fillStyle = C.night; c.fillRect(r.x, r.y, r.w, r.h);
      const cr = 9.5 * k;
      coinIcon(c, r.x + 12 * k + cr, cy, cr);
      L.scorePos = { x: r.x + 12 * k + cr, y: cy };
      txt(c, '$' + Math.round(shownScore), r.x + 18 * k + cr * 2, cy + 1, 19 * k, C.onNight, 'left', 700, true);
      if (shift) {
        const n = shift.n, dr = 5 * k, gp = 4.5 * k, tot = n * dr * 2 + (n - 1) * gp;
        let x = r.x + r.w / 2 - tot / 2 + dr;
        if (L.land) txt(c, 'Customers', x - dr - 10 * k, cy + 1, 11 * k, C.onNight2, 'right', 600);
        shift.list.forEach(function (cu) {
          if (cu.outcome === 'served') {
            c.fillStyle = C.goldLight; circle(c, x, cy, dr); c.fill();
            c.fillStyle = C.night; starPath(c, x, cy + 0.3, dr * 0.66); c.fill();
          } else if (cu.outcome === 'left') {
            c.fillStyle = C.bad; circle(c, x, cy, dr); c.fill();
            c.strokeStyle = C.night; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x - dr * 0.4, cy - dr * 0.4); c.lineTo(x + dr * 0.4, cy + dr * 0.4); c.moveTo(x + dr * 0.4, cy - dr * 0.4); c.lineTo(x - dr * 0.4, cy + dr * 0.4); c.stroke();
          } else if (cu.role) {
            c.strokeStyle = C.onNight; c.lineWidth = 1.6; circle(c, x, cy, dr - 0.8); c.stroke();
            c.fillStyle = cu.tag; circle(c, x, cy, dr * 0.45); c.fill();
          } else {
            c.strokeStyle = 'rgba(184,198,196,.45)'; c.lineWidth = 1.4; circle(c, x, cy, dr - 0.8); c.stroke();
          }
          x += dr * 2 + gp;
        });
      }
      const pb = { x: r.x + r.w - 48 * k, y: r.y + (r.h - 44) / 2, w: 44, h: 44 };
      addHit({ x: pb.x - 4, y: r.y, w: pb.w + 4 + 4 * k, h: r.h }, 'pause', true, function () { if (phase === 'playing') pause(); else resume(); });
      pressWrap(pb, 'pause', function () {
        c.fillStyle = 'rgba(244,237,226,.1)'; circle(c, pb.x + pb.w / 2, pb.y + pb.h / 2, 16 * k); c.fill();
        c.fillStyle = C.onNight;
        rr(c, pb.x + pb.w / 2 - 6 * k, pb.y + pb.h / 2 - 7 * k, 4 * k, 14 * k, 1.5); c.fill();
        rr(c, pb.x + pb.w / 2 + 2 * k, pb.y + pb.h / 2 - 7 * k, 4 * k, 14 * k, 1.5); c.fill();
      });
    }
    function tabIcon(name, x, y, s, col) {
      c.fillStyle = col; c.strokeStyle = col; c.lineWidth = Math.max(1.6, s * 0.1); c.lineCap = 'round'; c.lineJoin = 'round';
      if (name === 'order') {
        rr(c, x - s * 0.48, y - s * 0.4, s * 0.96, s * 0.64, s * 0.2); c.stroke();
        c.beginPath(); c.moveTo(x - s * 0.18, y + s * 0.24); c.lineTo(x - s * 0.3, y + s * 0.46); c.lineTo(x + s * 0.02, y + s * 0.24); c.stroke();
        [-0.22, 0, 0.22].forEach(function (d) { circle(c, x + d * s, y - s * 0.08, s * 0.06); c.fill(); });
      } else if (name === 'build') {
        circle(c, x, y - s * 0.18, s * 0.26); c.fill();
        c.beginPath(); c.moveTo(x - s * 0.34, y - s * 0.02); c.lineTo(x + s * 0.34, y - s * 0.02); c.lineTo(x + s * 0.22, y + s * 0.48); c.lineTo(x - s * 0.22, y + s * 0.48); c.closePath(); c.stroke();
      } else if (name === 'blend') {
        c.beginPath(); c.moveTo(x - s * 0.3, y - s * 0.46); c.lineTo(x + s * 0.3, y - s * 0.46); c.lineTo(x + s * 0.2, y + s * 0.16); c.lineTo(x - s * 0.2, y + s * 0.16); c.closePath(); c.stroke();
        rr(c, x - s * 0.3, y + s * 0.22, s * 0.6, s * 0.26, s * 0.06); c.fill();
        c.beginPath(); c.arc(x, y - s * 0.12, s * 0.1, 0, Math.PI * 1.5); c.stroke();
      } else {
        c.beginPath(); c.ellipse(x, y + s * 0.26, s * 0.42, s * 0.16, 0, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.ellipse(x, y + s * 0.02, s * 0.3, s * 0.13, 0, 0, Math.PI * 2); c.stroke();
        circle(c, x, y - s * 0.3, s * 0.14); c.fill();
        c.beginPath(); c.moveTo(x, y - s * 0.42); c.quadraticCurveTo(x + s * 0.06, y - s * 0.58, x + s * 0.2, y - s * 0.6); c.stroke();
      }
    }
    function drawTabs() {
      const r = L.tabs, k = L.k;
      c.fillStyle = C.night; c.fillRect(r.x, r.y, r.w, r.h);
      c.fillStyle = 'rgba(244,237,226,.08)'; c.fillRect(r.x, r.y, r.w, 1);
      const pad = 6 * k, gap = 5 * k;
      const serveW = L.land ? clamp(r.w * 0.22, 150, 240) : clamp(r.w * 0.27, 92, 150);
      const tw = (r.w - pad * 2 - serveW - gap * 4) / 4;
      const names = ['order', 'build', 'blend', 'top'], labels = ['Order', 'Build', 'Blend', 'Top'];
      const waiting = byRole('window');
      names.forEach(function (nm, i) {
        const b = { x: r.x + pad + i * (tw + gap), y: r.y + pad, w: tw, h: r.h - pad * 2 };
        const act = station === nm;
        addHit(b, 'tab-' + nm, true, function () { setStation(nm); });
        pressWrap(b, 'tab-' + nm, function () {
          c.fillStyle = act ? C.paper : 'rgba(244,237,226,.06)'; rr(c, b.x, b.y, b.w, b.h, 12 * k); c.fill();
          const is = Math.min(b.h * 0.4, 24 * k);
          tabIcon(nm, b.x + b.w / 2, b.y + b.h * 0.38, is, act ? C.ink : C.onNight);
          txtFit(c, labels[i], b.x + b.w / 2, b.y + b.h * 0.79, b.w - 8, 11.5 * k, act ? C.ink : C.onNight2, 'center', 700);
          txt(c, String(i + 1), b.x + 9 * k, b.y + 10 * k, 9 * k, act ? 'rgba(16,37,43,.4)' : 'rgba(244,237,226,.35)', 'center', 700);
          if (nm === 'order' && waiting && waiting.arrived && tickets.length < MAX_TICKETS) {
            const pr = reduced ? 1 : 1 + 0.15 * Math.sin(anim * 8);
            c.fillStyle = C.accent; circle(c, b.x + b.w - 10 * k, b.y + 10 * k, 7 * k * pr); c.fill();
            txt(c, '!', b.x + b.w - 10 * k, b.y + 10.5 * k, 10 * k, C.night, 'center', 900);
          }
        });
      });
      const sb = { x: r.x + r.w - pad - serveW, y: r.y + pad, w: serveW, h: r.h - pad * 2 };
      const t = cur(), can = !!(t && t.made.size && t.made.flavors.length);
      const glow = can && !reduced ? 0.5 + 0.5 * Math.sin(anim * 4) : 0;
      if (can) { c.fillStyle = rgba('#f2c14e', 0.25 * glow); rr(c, sb.x - 3, sb.y - 3, sb.w + 6, sb.h + 6, 15 * k); c.fill(); }
      pill(sb, 'serve', 'Serve', {
        enabled: can, explain: true, fill: C.accent, color: C.night, radius: 12 * k, px: 17 * k, sub: L.land ? 'Enter' : null,
        offFill: 'rgba(229,140,99,.22)', offColor: 'rgba(244,237,226,.55)', flat: true,
        icon: function (x, y, s, col) { bellIcon(x, y, s, col); }
      }, actServe);
    }

    /* ---------------- overlays ---------------- */
    function drawToast(r) {
      if (!toast) return;
      const age = anim - toast.t0;
      if (age > 2.2) { toast = null; return; }
      const k = L.k, a = clamp(Math.min(age / 0.15, (2.2 - age) / 0.3), 0, 1);
      c.font = font(13 * k, 700);
      const w = Math.min(r.w - 24, c.measureText(toast.msg).width + 30 * k), h = 32 * k;
      const y = r.y + r.h - h - 10 * k - (reduced ? 0 : (1 - a) * 8);
      c.globalAlpha = a;
      c.fillStyle = 'rgba(12,28,33,.9)'; rr(c, r.x + r.w / 2 - w / 2, y, w, h, h / 2); c.fill();
      txtFit(c, toast.msg, r.x + r.w / 2, y + h / 2 + 1, w - 20, 13 * k, C.onNight, 'center', 700);
      c.globalAlpha = 1;
    }
    function drawFlyers() {
      flyers.forEach(function (f) {
        const p = clamp((anim - f.t0) / f.dur, 0, 1), e = easeInOut(p);
        const x = f.x0 + (f.x1 - f.x0) * e, y = f.y0 + (f.y1 - f.y0) * e - Math.sin(p * Math.PI) * 50;
        c.save(); c.translate(x, y); c.rotate((1 - p) * -0.6); c.scale(0.7 + 0.3 * p, 0.7 + 0.3 * p);
        c.fillStyle = '#fffdf9'; rr(c, -18, -12, 36, 24, 4); c.fill();
        c.fillStyle = f.col; c.fillRect(-18, -12, 5, 24);
        c.fillStyle = 'rgba(16,37,43,.25)'; c.fillRect(-9, -5, 20, 2.5); c.fillRect(-9, 1, 14, 2.5);
        c.restore();
      });
    }
    function drawParticles() {
      particles.forEach(function (p) {
        if (p.age < 0) return;
        const life = p.age / p.life;
        if (p.kind === 'coin') {
          coinIcon(c, p.x, p.y, 8 * (L ? L.k : 1));
        } else if (p.kind === 'text') {
          if (p.station && (p.station !== station || phase !== 'playing')) return;
          c.globalAlpha = clamp(1 - life * life, 0, 1);
          c.font = font(16 * L.k, 800, true);
          const w = c.measureText(p.str).width + 16 * L.k, px = clamp(p.x, w / 2 + 4, W - w / 2 - 4);
          c.fillStyle = 'rgba(255,253,249,.94)'; rr(c, px - w / 2, p.y - 13 * L.k, w, 26 * L.k, 13 * L.k); c.fill();
          txt(c, p.str, px, p.y + 1, 16 * L.k, p.col, 'center', 800, true);
          c.globalAlpha = 1;
        } else if (p.kind === 'spark') {
          c.globalAlpha = clamp(1 - life, 0, 1);
          c.fillStyle = p.col; starPath(c, p.x, p.y, p.r * (1 - life * 0.5)); c.fill();
          c.globalAlpha = 1;
        } else if (p.kind === 'drop') {
          c.globalAlpha = clamp(1 - life, 0, 1);
          c.fillStyle = p.col; circle(c, p.x, p.y, 3 * L.k); c.fill();
          c.globalAlpha = 1;
        }
      });
    }
    function cardPanel(x, y, w, h, k) {
      c.fillStyle = 'rgba(0,0,0,.3)'; rr(c, x, y + 6, w, h, 20 * k); c.fill();
      c.fillStyle = C.card; rr(c, x, y, w, h, 20 * k); c.fill();
      c.save(); rr(c, x, y, w, h, 20 * k); c.clip();
      c.fillStyle = C.sunset; c.fillRect(x, y, w, 10 * k);
      for (let i = 0; i < Math.ceil(w / (18 * k)); i++) { c.fillStyle = PAPEL[i % PAPEL.length]; c.fillRect(x + i * 18 * k, y, 18 * k, 5 * k); }
      c.restore();
    }
    function drawCard() {
      const cd = card, k = L.k, res = cd.res, cu = cd.cu;
      hits = [];
      addHit({ x: 0, y: 0, w: W, h: H }, 'card', true, function () { if (card && card.t > 0.3) dismissCard(); });
      const ap = reduced ? 1 : clamp(cd.t / 0.3, 0, 1);
      c.fillStyle = 'rgba(12,28,33,' + (0.55 * ap) + ')'; c.fillRect(0, 0, W, H);
      const w = Math.min(W - 24, 380 * k), h = Math.min(H - 24, 300 * k);
      const x = W / 2 - w / 2, y = H / 2 - h / 2;
      c.save();
      if (!reduced) { const sc = 0.8 + 0.2 * easeOutBack(ap); c.translate(W / 2, H / 2); c.scale(sc, sc); c.translate(-W / 2, -H / 2); }
      c.globalAlpha = reduced ? clamp(cd.t / 0.2, 0, 1) : 1;
      cardPanel(x, y, w, h, k);
      // avatar
      const ar = 36 * k, ax = x + 22 * k + ar, ay = y + 28 * k + ar;
      c.save(); circle(c, ax, ay, ar); c.clip();
      c.fillStyle = '#fde3c6'; c.fillRect(ax - ar, ay - ar, ar * 2, ar * 2);
      c.fillStyle = '#3f8f86'; c.fillRect(ax - ar, ay + ar * 0.2, ar * 2, ar);
      const hop = reduced ? 0 : Math.max(0, Math.sin(clamp((cd.t - 0.3) / 0.5, 0, 1) * Math.PI)) * 5 * k * (res.stars >= 4 ? 1 : 0);
      const ps = ar / 26;
      drawPerson(c, cu.look, ax, ay - ar * 0.1 + 59 * ps - hop, ps, cu.mood, { blink: false });
      c.restore();
      c.strokeStyle = cu.tag; c.lineWidth = 3; circle(c, ax, ay, ar); c.stroke();
      const title = ['¿Y esto?', 'Hmm…', '¡Bien!', '¡Qué rico!', '¡Perfecto!'][res.stars - 1];
      const tx = ax + ar + 16 * k, tw = x + w - tx - 70 * k;
      txtFit(c, title, tx, y + 50 * k, tw + 40 * k, 26 * k, C.accentDark, 'left', 700, true);
      txtFit(c, cu.name + ' · order #' + cu.id, tx, y + 76 * k, tw + 30 * k, 12 * k, C.ink3, 'left', 600);
      // the treat they got
      drawTreat(c, cd.made, x + w - 44 * k, y + 104 * k, 0.48 * k);
      // stars
      const sy = y + 136 * k, ss = 15 * k, sg = 38 * k;
      for (let i = 0; i < 5; i++) {
        const sx = x + w / 2 + (i - 2) * sg;
        const t0 = 0.4 + i * 0.13, on = i < res.stars;
        const p = reduced ? 1 : clamp((cd.t - t0) / 0.3, 0, 1);
        c.fillStyle = 'rgba(16,37,43,.1)'; starPath(c, sx, sy, ss); c.fill();
        if (on && p > 0) {
          const scl = reduced ? 1 : easeOutBack(p);
          c.save(); c.translate(sx, sy); c.scale(scl, scl);
          c.fillStyle = '#e0a52b'; starPath(c, 0, 1.5, ss); c.fill();
          c.fillStyle = C.goldLight; starPath(c, 0, 0, ss); c.fill();
          c.restore();
          if (!reduced && p < 1 && !cd['sp' + i]) {
            cd['sp' + i] = true;
            for (let j = 0; j < 5; j++) { const a = Math.random() * Math.PI * 2; particles.push({ kind: 'spark', x: sx, y: sy, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, g: 0, age: 0, life: 0.5, r: 4 * k, col: j % 2 ? C.goldLight : '#fff' }); }
          }
        }
      }
      // parts
      const pr = [['Size', res.parts.size], ['Nieve', res.parts.flavor], ['Mix-ins', res.parts.mixins], ['Blend', res.parts.blend], ['Toppings', res.parts.toppings], ['Speed', res.speed]];
      const cols = 3, gx = 6 * k, cw = (w - 32 * k - gx * (cols - 1)) / cols, ch = 24 * k;
      pr.forEach(function (it, i) {
        const cx0 = x + 16 * k + (i % cols) * (cw + gx), cy0 = y + 162 * k + Math.floor(i / cols) * (ch + 6 * k);
        const v = it[1], col = v >= 0.99 ? C.good : v >= 0.4 ? C.warn : C.bad;
        c.fillStyle = rgba(col, 0.12); rr(c, cx0, cy0, cw, ch, ch / 2); c.fill();
        c.fillStyle = col; circle(c, cx0 + ch / 2, cy0 + ch / 2, ch * 0.3); c.fill();
        c.strokeStyle = '#fff'; c.lineWidth = 2; c.lineCap = 'round';
        const mx = cx0 + ch / 2, my = cy0 + ch / 2, q = ch * 0.13;
        c.beginPath();
        if (v >= 0.99) { c.moveTo(mx - q, my); c.lineTo(mx - q * 0.2, my + q * 0.8); c.lineTo(mx + q * 1.1, my - q * 0.8); }
        else if (v >= 0.4) { c.moveTo(mx - q, my); c.lineTo(mx + q, my); }
        else { c.moveTo(mx - q * 0.8, my - q * 0.8); c.lineTo(mx + q * 0.8, my + q * 0.8); c.moveTo(mx + q * 0.8, my - q * 0.8); c.lineTo(mx - q * 0.8, my + q * 0.8); }
        c.stroke();
        txtFit(c, it[0], cx0 + ch + 4 * k, cy0 + ch / 2 + 1, cw - ch - 8 * k, 11.5 * k, C.ink2, 'left', 700);
      });
      // tip
      const tipT = 0.4 + res.stars * 0.13;
      const cnt = reduced ? res.tip : Math.round(res.tip * clamp((cd.t - tipT) / 0.45, 0, 1));
      const tipY = y + h - 50 * k;
      cd.tipPos = { x: W / 2, y: tipY };
      const tipStr = (res.tip > 0 ? '+$' : '$') + res.tip, tipLbl = res.tip > 0 ? 'tip' : 'no tip';
      c.font = font(32 * k, 700, true);
      const tw1 = c.measureText(tipStr).width;
      c.font = font(13 * k, 600);
      const tw2 = c.measureText(tipLbl).width;
      const tot = 26 * k + 8 * k + tw1 + 8 * k + tw2, tx0 = W / 2 - tot / 2;
      coinIcon(c, tx0 + 13 * k, tipY, 13 * k);
      txt(c, (res.tip > 0 ? '+$' : '$') + cnt, tx0 + 34 * k, tipY + 2, 32 * k, res.tip > 0 ? '#b07a1f' : C.ink3, 'left', 700, true);
      txt(c, tipLbl, tx0 + 42 * k + tw1, tipY + 6, 13 * k, C.ink3, 'left', 600);
      txt(c, 'Tap to continue', W / 2, y + h - 16 * k, 11 * k, C.ink3, 'center', 600);
      c.restore();
    }
    function overlayScale() { return clamp(Math.min(W / 380, H / 620), 0.78, 1.35); }
    function drawReady() {
      const k = overlayScale();
      c.fillStyle = 'rgba(12,28,33,.35)'; c.fillRect(0, 0, W, H);
      const w = Math.min(W - 28, 380 * k), h = Math.min(H - 110 * k, 396 * k);
      const x = W / 2 - w / 2, y = clamp(H / 2 - h / 2 + 46 * k, 118 * k, H - h - 12);
      cardPanel(x, y, w, h, k);
      // hero treat popping out of the top of the card
      const demo = { size: 'L', flavors: ['fresa', 'mango'], mixins: [], blendVal: 0, toppings: ['crema', 'chamoy', 'cereza', 'barquillo'], fx: {} };
      const bob = reduced ? 0 : Math.sin(anim * 2) * 3;
      drawTreat(c, demo, W / 2, y + 34 * k + bob, 0.74 * k);
      txt(c, 'La Nevería', W / 2, y + 68 * k, 34 * k, C.accentDark, 'center', 700, true);
      txtFit(c, 'Nieves, licuados & toppings by the beach', W / 2, y + 96 * k, w - 40, 12.5 * k, C.sea, 'center', 600);
      const lines = ['Take orders at the counter.', 'Build, blend & top to match the ticket.', 'Serve fast: happy customers tip more!'];
      lines.forEach(function (ln, i) {
        const ly = y + 130 * k + i * 36 * k;
        c.fillStyle = [C.accent, C.goldLight, '#5bb6c9'][i]; circle(c, x + 34 * k, ly, 13 * k); c.fill();
        txt(c, String(i + 1), x + 34 * k, ly + 1, 13 * k, C.ink, 'center', 800);
        txtFit(c, ln, x + 56 * k, ly + 1, w - 72 * k, 14 * k, C.ink, 'left', 600);
      });
      // today's nieves
      const fy = y + 252 * k, fs = Math.min(34 * k, (w - 40 * k) / 6);
      c.fillStyle = '#f6efe4'; rr(c, x + 16 * k, fy - fs * 0.62, w - 32 * k, fs * 1.24, fs * 0.62); c.fill();
      FLAVORS.forEach(function (f, i) {
        const fx = x + 16 * k + (w - 32 * k) * (i + 0.5) / 6;
        const hop = reduced ? 0 : Math.max(0, Math.sin(anim * 3 - i * 0.6)) * 3 * k;
        drawIcon(c, 'flavor', f, fx, fy - hop, fs * 0.9);
      });
      const bh = Math.max(48, 54 * k), bw = Math.min(w - 48 * k, 260 * k);
      pill({ x: W / 2 - bw / 2, y: y + h - bh - 44 * k, w: bw, h: bh }, 'start', 'Open the shop', { fill: C.accentDark, color: '#fff', px: 18 * k }, start);
      txt(c, best > 0 ? 'Best shift: $' + best + '   ·   Enter to start' : 'Press Enter to start', W / 2, y + h - 22 * k, 11.5 * k, C.ink3, 'center', 600);
    }
    function drawPaused() {
      hits = [];
      const k = overlayScale();
      c.fillStyle = 'rgba(12,28,33,.6)'; c.fillRect(0, 0, W, H);
      const w = Math.min(W - 40, 300 * k), h = 190 * k, x = W / 2 - w / 2, y = H / 2 - h / 2;
      cardPanel(x, y, w, h, k);
      txt(c, 'Paused', W / 2, y + 48 * k, 30 * k, C.accentDark, 'center', 700, true);
      txtFit(c, 'Your customers are waiting patiently.', W / 2, y + 80 * k, w - 30, 12.5 * k, C.ink3, 'center', 600);
      const bw = Math.min(w - 50, 200 * k), bh = Math.max(48, 50 * k);
      pill({ x: W / 2 - bw / 2, y: y + h - bh - 28 * k, w: bw, h: bh }, 'resume', 'Resume', { fill: C.accentDark, color: '#fff', px: 17 * k }, resume);
      txt(c, 'Esc / P', W / 2, y + h - 13 * k, 10 * k, C.ink3, 'center', 600);
    }
    function drawOver() {
      const k = overlayScale(), s = shift;
      c.fillStyle = 'rgba(12,28,33,.45)'; c.fillRect(0, 0, W, H);
      const w = Math.min(W - 24, 400 * k), h = Math.min(H - 24, 436 * k);
      const x = W / 2 - w / 2, y = H / 2 - h / 2;
      cardPanel(x, y, w, h, k);
      txt(c, '¡Cerramos!', W / 2, y + 44 * k, 30 * k, C.accentDark, 'center', 700, true);
      txt(c, 'Shift complete. Here’s how it went:', W / 2, y + 72 * k, 12.5 * k, C.ink3, 'center', 600);
      const score = s ? s.score : 0;
      coinIcon(c, W / 2 - 58 * k, y + 116 * k, 18 * k);
      txt(c, '$' + score, W / 2 - 32 * k, y + 118 * k, 40 * k, '#a8742a', 'left', 700, true);
      if (newBest) {
        c.fillStyle = C.accent; rr(c, W / 2 - 46 * k, y + 142 * k, 92 * k, 22 * k, 11 * k); c.fill();
        txt(c, 'NEW BEST!', W / 2, y + 153.5 * k, 11 * k, C.night, 'center', 800);
      }
      const served = s ? s.results.filter(function (r) { return !r.left; }) : [];
      const avg = served.length ? served.reduce(function (a, r) { return a + r.stars; }, 0) / served.length : 0;
      const stats = [['Served', (s ? s.served : 0) + '/' + (s ? s.n : 0)], ['Avg stars', served.length ? avg.toFixed(1) : '–'], ['Walk-outs', String(s ? s.left : 0)], ['Best', '$' + best]];
      const sw = (w - 32 * k - 3 * 6 * k) / 4, sy = y + 176 * k;
      stats.forEach(function (st, i) {
        const sx = x + 16 * k + i * (sw + 6 * k);
        c.fillStyle = '#f6efe4'; rr(c, sx, sy, sw, 54 * k, 12 * k); c.fill();
        txtFit(c, st[1], sx + sw / 2, sy + 22 * k, sw - 8, 19 * k, C.ink, 'center', 700, true);
        if (i === 1 && served.length) { c.fillStyle = C.goldLight; starPath(c, sx + sw / 2 + 24 * k, sy + 21 * k, 6 * k); c.fill(); }
        txtFit(c, st[0], sx + sw / 2, sy + 42 * k, sw - 8, 10.5 * k, C.ink3, 'center', 600);
      });
      // customer strip
      if (s) {
        const n = s.n, cw = Math.min(42 * k, (w - 24 * k) / n), cy = y + 266 * k;
        const x0 = W / 2 - (cw * n) / 2 + cw / 2;
        s.list.forEach(function (cu, i) {
          const cx = x0 + i * cw;
          c.save(); circle(c, cx, cy, cw * 0.4); c.clip();
          c.fillStyle = '#fde3c6'; c.fillRect(cx - cw, cy - cw, cw * 2, cw * 2);
          drawHead(c, cu.look, cx, cy + cw * 0.08, cw * 0.3, cu.outcome === 'served' ? (cu.result.stars >= 4 ? 'delight' : 'happy') : 'angry', false);
          c.restore();
          const lbl = cu.outcome === 'served' ? '★' + cu.result.stars : cu.outcome === 'left' ? 'left' : '–';
          txt(c, lbl, cx, cy + cw * 0.62, 10.5 * k, cu.outcome === 'served' ? '#a8742a' : C.bad, 'center', 800);
        });
        const top = served.slice().sort(function (a, b) { return b.tip - a.tip || b.stars - a.stars; })[0];
        if (top) txtFit(c, 'Star order: ' + top.name + '  ·  ' + top.stars + '★  ·  +$' + top.tip, W / 2, cy + cw * 0.62 + 26 * k, w - 30, 12.5 * k, C.sea, 'center', 700);
      }
      const bh = Math.max(48, 52 * k), bw = Math.min(w - 48 * k, 240 * k);
      pill({ x: W / 2 - bw / 2, y: y + h - bh - 22 * k, w: bw, h: bh }, 'again', 'Play again', { fill: C.accentDark, color: '#fff', px: 18 * k }, start);
    }

    /* ---------------- render ---------------- */
    function render() {
      if (destroyed || !L) return;
      RC.now = anim; RC.reduced = reduced;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      hits = [];
      if (phase === 'ready' || phase === 'over') {
        drawBackdrop({ x: 0, y: 0, w: W, h: H }, phase === 'over' ? 0.95 : 0.15);
        const u = sceneU({ x: 0, y: 0, w: W, h: H });
        const counterY = H * 0.72;
        counterFront({ x: 0, y: 0, w: W, h: H }, counterY, u);
        const py = awning({ x: 0, y: 0, w: W, h: H }, u, true);
        papel(-4, W + 4, py, overlayScale(), 24 * overlayScale());
        if (phase === 'ready') drawReady(); else drawOver();
        drawParticles();
        return;
      }
      drawHud();
      drawSide();
      const r = L.stage;
      c.save(); c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
      if (station === 'order') drawOrderStation(r);
      else if (station === 'build') drawBuild(r);
      else if (station === 'blend') drawBlend(r);
      else drawTop(r);
      drawToast(r);
      c.restore();
      drawTabs();
      drawFlyers();
      if (card) drawCard();
      drawParticles();
      if (phase === 'paused') drawPaused();
    }

    /* ---------------- input ---------------- */
    function localPt(e) {
      const b = canvas.getBoundingClientRect();
      return { x: (e.clientX - b.left) * (W / (b.width || W)), y: (e.clientY - b.top) * (H / (b.height || H)) };
    }
    function hitAt(p) {
      for (let i = hits.length - 1; i >= 0; i--) {
        const h = hits[i];
        if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) return h;
      }
      return null;
    }
    function onPointerDown(e) {
      if (destroyed) return;
      e.preventDefault();
      try { host.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
      audio.unlock();
      const h = hitAt(localPt(e));
      if (!h || !h.en) return;
      press = { id: h.id, t: anim, up: false };
      if (h.hold) {
        if (startHold(e.pointerId)) { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
      } else if (h.tap) h.tap();
    }
    function onPointerUp(e) {
      if (press) { press.up = true; press.t = anim; }
      if (hold && hold.src === e.pointerId) stopHold();
    }
    function onPointerMove(e) {
      if (e.pointerType !== 'mouse') return;
      const h = hitAt(localPt(e));
      const cur2 = h && h.en ? 'pointer' : 'default';
      if (canvas.style.cursor !== cur2) canvas.style.cursor = cur2;
    }
    function onKeyDown(e) {
      if (destroyed || e.altKey || e.ctrlKey || e.metaKey) return;
      const key = e.key;
      let handled = true;
      audio.unlock();
      if (key === ' ' || key === 'Spacebar') {
        if (!e.repeat) {
          if (phase === 'ready' || phase === 'over') start();
          else if (phase === 'paused') resume();
          else if (card) { if (card.t > 0.3) dismissCard(); }
          else if (station === 'blend') startHold('key');
          else if (station === 'order') actTake();
        }
      } else if (key === 'Enter') {
        if (!e.repeat) {
          if (phase === 'ready' || phase === 'over') start();
          else if (phase === 'paused') resume();
          else if (card) { if (card.t > 0.3) dismissCard(); }
          else actServe();
        }
      } else if (key === 'Escape' || key === 'p' || key === 'P') {
        if (phase === 'playing') pause(); else if (phase === 'paused') resume(); else handled = false;
      } else if (key >= '1' && key <= '4') {
        if (phase === 'playing' && !card) setStation(['order', 'build', 'blend', 'top'][Number(key) - 1]); else handled = false;
      } else if (key === 'ArrowLeft' || key === 'ArrowRight' || key === '[' || key === ']') {
        if (phase === 'playing' && !card && tickets.length) {
          const d = key === 'ArrowLeft' || key === '[' ? -1 : 1;
          actSelect(((selected < 0 ? 0 : selected + d) + tickets.length) % tickets.length);
        } else handled = false;
      } else handled = false;
      if (handled) e.preventDefault();
    }
    function onKeyUp(e) {
      if ((e.key === ' ' || e.key === 'Spacebar') && hold && hold.src === 'key') { stopHold(); e.preventDefault(); }
    }
    function onVisibility() { if (document.hidden) { stopHold(); if (phase === 'playing') pause(); } }
    function onBlur() { stopHold(); }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('lostpointercapture', onPointerUp);
    canvas.addEventListener('pointermove', onPointerMove);
    host.addEventListener('keydown', onKeyDown);
    host.addEventListener('keyup', onKeyUp);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    let ro = null;
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(function () { resize(); }); ro.observe(host); }
    else window.addEventListener('resize', resize);

    resize();
    raf = requestAnimationFrame(frame);
    try { host.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    announce('La Nevería. Press Enter or tap Open the shop to start.');

    /* ---------------- debug helpers (same code paths as taps) ---------------- */
    function ff(sec) {
      const n = Math.max(0, Math.ceil((Number(sec) || 0) / 0.05));
      for (let i = 0; i < n && !destroyed; i++) update(0.05);
      render();
    }
    function prep(st) {
      if (card) dismissCard();
      if (st) setStation(st);
      return playing();
    }
    const debug = {
      /** Fast-forward until someone is ready to order at the window (≤ maxSec). Returns their name or null. */
      arrive: function (maxSec) {
        if (!playing()) return null;
        if (card) dismissCard();
        const lim = maxSec == null ? 90 : maxSec;
        for (let t = 0; t < lim; t += 0.05) {
          const w = byRole('window');
          if (w && w.arrived) { render(); return w.name; }
          update(0.05);
          if (card) dismissCard();
          if (!playing()) break;
        }
        const w = byRole('window');
        render();
        return w && w.arrived ? w.name : null;
      },
      take: function () {
        if (!prep('order')) return null;
        const w = byRole('window');
        if (!w || !w.arrived) debug.arrive();
        const r = actTake(); render(); return r;
      },
      select: function (i) { prep(null); const r = actSelect(i); render(); return r; },
      station: function (name) { prep(null); const n = String(name || '').toLowerCase(); const r = setStation(n === 'serve' ? station : n); render(); return r; },
      size: function (v) { if (!prep('build')) return false; const r = actSize(v); render(); return r; },
      scoop: function (v) { if (!prep('build')) return false; const r = actScoop(v); render(); return r; },
      mixin: function (v) { if (!prep('build')) return false; const r = actMixin(v); render(); return r; },
      reset: function () { if (!prep('build')) return false; const r = actReset(); render(); return r; },
      blendTo: function (z) {
        if (!prep('blend')) return false;
        const t = cur();
        const target = typeof z === 'number' ? clamp(z, 0, 1) : BLEND_CENTER[norm('blend', z)];
        if (!t || target === undefined || target === null) return false;
        if (target < t.made.blendVal) { say('Can’t un-blend! Start over at Build (2)'); return false; }
        if (!startHold('debug')) return false;
        t.made.blendVal = target;
        stopHold();
        render();
        return blendZone(t.made.blendVal);
      },
      topping: function (v) { if (!prep('top')) return false; const r = actTopping(v); render(); return r; },
      serve: function () { if (!prep(null)) return null; const r = actServe(); render(); return r; },
      dismiss: function () { dismissCard(); render(); },
      fastForward: function (sec) { ff(sec); return phase; },
      /** Build the selected ticket exactly as ordered (does not serve). */
      makePerfect: function () {
        if (!prep(null)) return false;
        const t = cur();
        if (!t) return false;
        const o = t.order;
        setStation('build');
        t.made = emptyMade();
        actSize(o.size);
        o.flavors.forEach(actScoop);
        o.mixins.forEach(actMixin);
        if (o.blend) debug.blendTo(o.blend);
        setStation('top');
        o.toppings.forEach(actTopping);
        render();
        return true;
      },
      current: function () { const t = cur(); return t ? ticketView(t) : null; },
      customers: function () {
        return shift ? shift.list.map(function (cu) { return { id: cu.id, name: cu.name, role: cu.role, outcome: cu.outcome, patienceLeft: round(patienceLeft(cu), 3), order: orderCopy(cu.order) }; }) : [];
      },
      hits: function () { return hits.map(function (h) { return { id: h.id, x: h.x, y: h.y, w: h.w, h: h.h, enabled: h.en }; }); },
      layout: function () { return JSON.parse(JSON.stringify(L)); },
      render: render
    };

    return {
      start: function () { start(); render(); },
      pause: function () { pause(); render(); },
      resume: function () { resume(); render(); },
      setSound: function (on) { audio.set(on); },
      state: function () {
        return {
          phase: phase,
          score: shift ? shift.score : 0,
          best: best,
          station: station,
          tickets: tickets.map(ticketView),
          served: shift ? shift.served : 0,
          selected: selected,
          customers: shift ? shift.n : 0,
          left: shift ? shift.left : 0,
          results: shift ? shift.results.map(function (r) { return Object.assign({}, r); }) : [],
          time: round(gt, 2),
          card: !!card
        };
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        cancelAnimationFrame(raf);
        stopHold();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('lostpointercapture', onPointerUp);
        canvas.removeEventListener('pointermove', onPointerMove);
        host.removeEventListener('keydown', onKeyDown);
        host.removeEventListener('keyup', onKeyUp);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('blur', onBlur);
        if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
        audio.close();
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        if (live.parentNode) live.parentNode.removeChild(live);
        particles = []; flyers = []; tickets = []; hits = []; shift = null; card = null;
      },
      debug: debug
    };
  }

  window.AgrazGames = window.AgrazGames || {};
  window.AgrazGames.neveria = { id: 'neveria', title: 'La Nevería', mount: mount, core: core };
})();
