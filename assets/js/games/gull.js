/* Gaviota: a one-button seagull flying game for the Agraz Family Hub.
 *
 * Plain browser script (no modules, no dependencies, no network). Registers
 *   window.AgrazGames.gull = { id: 'gull', title: 'Gaviota', mount }
 * mount(host, opts) creates a <canvas> inside `host` and returns
 *   { start, flap, pause, resume, destroy, setSound, state }.
 * Everything is drawn procedurally on the canvas. No inline styles, eval or
 * inline handlers, so it runs under the site's strict Content-Security-Policy.
 */
(function () {
  'use strict';

  /* ---------- tuning (world units: the world is H tall; its width follows the host's aspect) ---------- */
  var H = 640;              // fixed logical world height
  var HORIZON = 414;        // where the sky meets the sea
  var SEA_Y = 562;          // the waterline: touch it and the run ends
  var STEP = 1 / 120;       // fixed physics step (same speed on 60 Hz and 120 Hz screens)
  var MAX_DT = 0.1;         // clamp long frames (tab switches, hiccups)
  var GRAVITY = 1500;
  var FLAP_V = -455;
  var MAX_FALL = 740;
  var HIT_R = 12;           // forgiving circular hitbox (the drawn gull is bigger)
  var PW = 60;              // piling width
  var DECK_H = 24;          // pier-deck chunk the top piling hangs from
  var DECK_OVER = 20;       // deck overhang on each side of the piling
  var READY_Y = 282;
  var COOLDOWN = 0.6;       // seconds of ignored taps after a crash
  var CARD_DELAY = 0.42;    // game-over card slides in after this long
  var TAU = Math.PI * 2;
  var FD = "Fraunces, 'Iowan Old Style', Georgia, 'Times New Roman', serif";
  var FS = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

  // Difficulty ramps gently with the obstacle's index (so it is the same on every screen width).
  function ease01(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * (2 - x); }
  function speedFor(s) { return 152 + 50 * ease01(s / 50); }      // 152 -> 202 units/s
  function gapFor(n) { return 200 - 50 * ease01(n / 45); }        // 200 -> 150 units
  function spacingFor(n) { return 272 - 24 * ease01(n / 50); }    // 272 -> 248 units
  // Sunset -> dusk -> night as the score climbs (0 golden, 1 late sunset, 2 dusk, 3 night).
  function dayFor(s) {
    if (s <= 8) return 0;
    if (s <= 18) return (s - 8) / 10;
    if (s <= 26) return 1 + (s - 18) / 8;
    if (s <= 34) return 2 + (s - 26) / 8;
    return 3;
  }

  /* ---------- small helpers ---------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function easeOutBack(t) { var c = 1.4, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; }
  function hash(n) { var s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }
  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function css(c, a) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' +
      (a == null ? 1 : Math.round(clamp(a, 0, 1) * 1000) / 1000) + ')';
  }
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function circRect(cx, cy, r, x0, y0, x1, y1) {
    var nx = cx < x0 ? x0 : cx > x1 ? x1 : cx, ny = cy < y0 ? y0 : cy > y1 ? y1 : cy;
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  /* ---------- palette keyframes: golden hour, late sunset, dusk, night ---------- */
  var STOPS = {
    sky0:    ['#35587a', '#2b4569', '#17233f', '#050c18'],
    sky1:    ['#9b7f9e', '#82618a', '#3c3666', '#0b1a2c'],
    sky2:    ['#f0a77f', '#ea8d72', '#99587a', '#13283f'],
    sky3:    ['#fcd69b', '#f9b77f', '#e08a6c', '#22394f'],
    sun:     ['#fff6dc', '#ffe7bf', '#ffc09a', '#ff9c7a'],
    sunEdge: ['#ffc46e', '#ff9a58', '#ff7650', '#e8604a'],
    glow:    ['#ffc27a', '#ffa070', '#ef7d68', '#2c3d5c'],
    cloud:   ['#b08497', '#946888', '#4e4268', '#18253a'],
    cloudLit:['#ffd8a8', '#ffb48f', '#ec9488', '#3e4e6a'],
    coastFar:['#c49a9b', '#a77588', '#5d4a70', '#14253a'],
    coast:   ['#8a6577', '#71506a', '#3a3154', '#0a1724'],
    seaHz:   ['#f3c193', '#eda083', '#b46b7c', '#2a4259'],
    seaMid:  ['#5a8088', '#4c6e83', '#2f4a6a', '#122539'],
    seaDeep: ['#1f4a52', '#1c4153', '#14294a', '#071321'],
    front:   ['#2b6b66', '#28606a', '#1f4560', '#0f2234'],
    foam:    ['#fff4e4', '#ffeee2', '#ecd9e6', '#a9bdd3'],
    glint:   ['#ffe6b5', '#ffcf9e', '#f7ad90', '#d4e1f2'],
    amb:     ['#fff3e4', '#ffe6d8', '#cbbbd6', '#8495b5'],  // multiplied into foreground colours
    rim:     ['#ffc48a', '#ffa77c', '#e98a7a', '#7d90b6']   // warm rim light on pilings
  };
  var STOPS_RGB = {};
  (function () { for (var key in STOPS) STOPS_RGB[key] = STOPS[key].map(rgb); })();

  var BASE = {
    white: rgb('#ffffff'), white2: rgb('#eef1f3'), shade: rgb('#c4ced6'), grey: rgb('#9eabb4'),
    greyLt: rgb('#c7d0d6'), greyDk: rgb('#76848e'), black: rgb('#1d2227'), blackDk: rgb('#15181c'),
    beak: rgb('#f6b93b'), beakDk: rgb('#e3892f'), red: rgb('#d8432f'), eye: rgb('#14171a'),
    woodLt: rgb('#a8805a'), woodMid: rgb('#7d5c41'), woodDk: rgb('#3e2b1f'), woodDk2: rgb('#2a1d15'),
    grain: rgb('#3f2c20'), end: rgb('#c09a6e'), endDk: rgb('#5b4230'), deck: rgb('#8f6b4a'),
    iron: rgb('#36322e'), ironLt: rgb('#6d655c'), algae: rgb('#2f4a33'), barn: rgb('#d9d2c3'),
    rope: rgb('#c9a46a'), ropeDk: rgb('#7e6236'), ring: rgb('#e2643f'), ringW: rgb('#f4ede2'),
    lamp: rgb('#ffd27a'), lampOff: rgb('#7a6a55'), tower: rgb('#f4ede2'), stripe: rgb('#c4553e')
  };
  var NIGHT = rgb('#0c1c21'), CREAM = rgb('#f4ede2'), ACCENT = rgb('#e58c63'), SEA = rgb('#2b6b66'),
    GOLD = rgb('#c9933f'), MOON = rgb('#f6f0e2'), WHITE = [255, 255, 255];

  var MEDALS = [
    { at: 80, name: 'Legend', c: ['#e6fff7', '#6cc4b2', '#1f5d58'], edge: '#c9933f' },
    { at: 40, name: 'Gold', c: ['#fff4c8', '#e3b04f', '#9a6a1c'], edge: '#b07c2a' },
    { at: 20, name: 'Silver', c: ['#ffffff', '#c9d0d6', '#7d8891'], edge: '#8a959e' },
    { at: 10, name: 'Bronze', c: ['#f7c49b', '#c07b46', '#7b4524'], edge: '#8e532c' }
  ];
  function medalFor(s) { for (var i = 0; i < MEDALS.length; i++) if (s >= MEDALS[i].at) return MEDALS[i]; return null; }
  function nextMedal(s) { for (var i = MEDALS.length - 1; i >= 0; i--) if (s < MEDALS[i].at) return MEDALS[i]; return null; }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- scenery generated once (fixed seed, so the coast always looks the same) ---------- */
  var SCENE = (function () {
    var r = mulberry32(20240611), i;
    var clouds = [];
    for (i = 0; i < 9; i++) {
      var n = 3 + Math.floor(r() * 4), puffs = [], y = 46 + Math.pow(r(), 1.25) * 250;
      for (var j = 0; j < n; j++) {
        puffs.push({ dx: (j - (n - 1) / 2) * (24 + r() * 20) + (r() - 0.5) * 10, dy: (r() - 0.5) * 9,
          rx: 24 + r() * 36, ry: 5.5 + r() * 7.5 });
      }
      clouds.push({ f: (i + r() * 0.6) / 9, y: y, s: (0.75 + r() * 0.6) * (1.12 - 0.5 * y / HORIZON), p: puffs,
        sp: 2 + r() * 4, par: 0.035 + r() * 0.04 });
    }
    var stars = [];
    for (i = 0; i < 120; i++) {
      stars.push({ x: r(), y: Math.pow(r(), 1.5) * (HORIZON - 40), s: 0.5 + r() * r() * 1.5, ph: r() * TAU, sp: 0.6 + r() * 2.2 });
    }
    // Near coast (with the lighthouse headland) and a hazier far range; periodic so they tile forever.
    var NP = 2400, FP = 3000, LX = 620, near = new Float32Array(NP / 4 + 1), far = new Float32Array(FP / 4 + 1);
    for (i = 0; i <= NP / 4; i++) {
      var u = i * 4, a = TAU * u / NP;
      var h = -5 + 13 * Math.sin(2 * a + 1.1) + 8 * Math.sin(5 * a + 0.3) + 4 * Math.sin(11 * a + 2) + 1.6 * Math.sin(23 * a + 0.7);
      var d = u - LX;
      h += 30 * Math.exp(-(d * d) / (2 * 140 * 140));
      if (d > -24 && d < 30) h = Math.max(h, 33 + Math.sin(u * 0.4) * 0.6);
      else if (d >= 30 && d < 46) h = Math.max(h, lerp(33, 22, (d - 30) / 16));
      near[i] = Math.max(0, h);
    }
    for (i = 0; i <= FP / 4; i++) {
      var b = TAU * i * 4 / FP;
      far[i] = Math.max(0, 7 + 19 * Math.sin(2 * b + 0.4) + 11 * Math.sin(3 * b + 2.2) + 5 * Math.sin(7 * b + 1) + 2 * Math.sin(17 * b));
    }
    var lights = [];
    for (i = 0; i < 26; i++) {
      var lu = r() * NP, lh = near[Math.floor(lu / 4)];
      if (lh > 6 && Math.abs(lu - LX) > 70) lights.push({ u: lu, y: lh * (0.25 + r() * 0.5), ph: r() * TAU });
    }
    var birds = [];
    for (i = 0; i < 4; i++) birds.push({ f: r(), y: 212 + r() * 90, sp: 6 + r() * 6, ph: r() * TAU, s: 0.7 + r() * 0.5 });
    return { clouds: clouds, stars: stars, near: near, far: far, NP: NP, FP: FP, LX: LX, lights: lights, birds: birds };
  })();
  function coastAt(arr, P, u) {
    u = ((u % P) + P) % P;
    var f = u / 4, i = Math.floor(f), t = f - i;
    return arr[i] + (arr[i + 1] - arr[i]) * t;
  }

  /* ======================================================================== */
  function mount(host, opts) {
    opts = opts || {};
    var best = Math.max(0, Math.floor(+opts.best || 0));
    var reduced = !!opts.reduced;
    var soundOn = opts.sound !== false;
    var hasSeed = typeof opts.seed === 'number' && isFinite(opts.seed);
    var onOver = typeof opts.onOver === 'function' ? opts.onOver : null;
    var onScore = typeof opts.onScore === 'function' ? opts.onScore : null;
    var doc = host.ownerDocument || document;
    var win = doc.defaultView || window;
    var destroyed = false;
    var finePointer = false;
    try { finePointer = win.matchMedia('(pointer: fine)').matches; } catch (e) { /* ignore */ }

    /* ---------- DOM ---------- */
    var autoHeight = host.clientHeight < 2;   // host has no height of its own: derive one from the width
    var canvas = doc.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Gaviota: fly a seagull between the pier pilings. Tap, click, or press Space to flap.');
    var cs = canvas.style;   // CSSOM only (allowed by the CSP)
    cs.display = 'block';
    cs.width = '100%';
    cs.height = autoHeight ? '480px' : '100%';
    cs.touchAction = 'none';
    cs.userSelect = 'none';
    cs.webkitUserSelect = 'none';
    cs.webkitTapHighlightColor = 'transparent';
    cs.cursor = 'pointer';
    host.appendChild(canvas);
    var live = doc.createElement('p');
    live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    host.appendChild(live);
    var hadTab = host.hasAttribute('tabindex'), oldTab = host.getAttribute('tabindex');
    host.tabIndex = 0;
    try { host.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    var ctx = canvas.getContext('2d');

    /* ---------- sizing ---------- */
    var W = 600, k = 1, dpr = 1, GX = 150, cssW = 0, cssH = 0;
    function gullXFor(w) { return clamp(w * 0.3, 96, 300); }
    function resize(w, h) {
      if (destroyed || !(w >= 2)) return;
      if (autoHeight || !(h >= 2)) h = Math.round(clamp(w * 0.75, 420, 640));
      dpr = Math.min(2, win.devicePixelRatio || 1);
      cssW = w; cssH = h;
      cs.width = w + 'px';
      cs.height = h + 'px';
      var bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      k = bh / H;
      W = bw / k;
      if (phase === 'playing' || phase === 'paused') GX = Math.min(GX, W * 0.45);
      else GX = gullXFor(W);
      draw(acc / STEP);
    }
    var ro = null;
    function onWinResize() { resize(host.clientWidth, host.clientHeight); }
    if (typeof win.ResizeObserver === 'function') {
      ro = new win.ResizeObserver(function (entries) {
        var r = entries[entries.length - 1].contentRect;
        resize(r.width, r.height);
      });
    } else {
      win.addEventListener('resize', onWinResize);
    }

    /* ---------- state ---------- */
    var phase = 'ready', score = 0;
    var camX = 0, prevCam = 0, time = 0, animT = 0, realT = 0, acc = 0;
    var gull = { y: READY_Y, prevY: READY_Y, vy: 0, rot: 0, wa: 0.3, wb: 0, flapT: 9, dx: 0, vx: 0, spin: 0,
      floating: false, fvy: 0, floatT: 0 };
    var obstacles = [], nextWx = 0, lastGap = 0, obsIndex = 0, rng = Math.random;
    var overT = 0, cause = '', newBest = false;
    var dayT = 0, dayTarget = 0;
    var popT = 0, flashA = 0, shakeT = 0, shakeDur = 0.3, shakeMag = 0, fadeA = 0, toast = null;
    var feathers = [], drops = [], ripples = [], sparks = [];
    var liveTimer = 0;

    /* ---------- sound (WebAudio, created lazily on the first gesture) ---------- */
    var actx = null, master = null, noiseBuf = null;
    function unlockAudio() {
      if (!soundOn || destroyed) return;
      try {
        if (!actx) {
          var AC = win.AudioContext || win.webkitAudioContext;
          if (!AC) return;
          actx = new AC();
          master = actx.createGain();
          master.gain.value = 0.55;
          master.connect(actx.destination);
        }
        if (actx.state === 'suspended' && actx.resume) {
          var p = actx.resume();
          if (p && p.catch) p.catch(function () { /* ignore */ });
        }
      } catch (e) { actx = null; }
    }
    function envelope(g, t, peak, attack, decay) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }
    function blip(type, f0, f1, dur, vol, when) {
      var t = actx.currentTime + (when || 0);
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      envelope(g, t, vol, 0.006, dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    }
    function hiss(dur, vol, type, f0, f1, q, when) {
      if (!noiseBuf) {
        noiseBuf = actx.createBuffer(1, Math.floor(actx.sampleRate * 0.6), actx.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      var t = actx.currentTime + (when || 0);
      var src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
      src.buffer = noiseBuf;
      f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      envelope(g, t, vol, 0.01, dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t); src.stop(t + dur + 0.05);
    }
    function sfx(name) {
      if (!soundOn || !actx || destroyed) return;
      try {
        if (name === 'flap') {
          hiss(0.1, 0.13, 'bandpass', 1400, 520, 1.1);
          blip('sine', 420, 600, 0.06, 0.03);
        } else if (name === 'point') {
          blip('triangle', 1046.5, 1046.5, 0.1, 0.085);
          blip('triangle', 1568, 1568, 0.2, 0.075, 0.065);
        } else if (name === 'milestone') {
          [1046.5, 1318.5, 1568, 2093].forEach(function (f, i) { blip('triangle', f, f, 0.2, 0.07, 0.06 + i * 0.07); });
        } else if (name === 'crash') {
          blip('sine', 180, 48, 0.3, 0.38);
          hiss(0.14, 0.2, 'lowpass', 1800, 260, 0.7);
        } else if (name === 'splash') {
          hiss(0.5, 0.24, 'bandpass', 1900, 260, 0.9);
          hiss(0.22, 0.09, 'highpass', 3200, 1600, 0.6, 0.03);
        } else if (name === 'best') {
          [784, 988, 1175, 1568].forEach(function (f, i) { blip('triangle', f, f, 0.22, 0.07, 0.5 + i * 0.09); });
        }
      } catch (e) { /* audio is optional */ }
    }

    /* ---------- gameplay ---------- */
    function announce(text) {
      live.textContent = '';
      clearTimeout(liveTimer);
      liveTimer = setTimeout(function () { if (!destroyed) live.textContent = text; }, 60);
    }
    function safeCall(fn, v) { if (fn) { try { fn(v); } catch (e) { if (win.console) win.console.error(e); } } }

    function doFlap() {
      gull.vy = FLAP_V;
      gull.flapT = 0;
      sfx('flap');
      var n = reduced ? (Math.random() < 0.3 ? 1 : 0) : (Math.random() < 0.55 ? 1 : 2);
      for (var i = 0; i < n; i++) {
        feathers.push({ x: GX - 8 + Math.random() * 6, y: gull.y + 2 + Math.random() * 6,
          vx: -30 - Math.random() * 50, vy: 10 + Math.random() * 50, rot: Math.random() * TAU,
          vr: (Math.random() - 0.5) * 6, life: 1, dur: 0.9 + Math.random() * 0.6, ph: Math.random() * TAU,
          s: 0.8 + Math.random() * 0.5, grey: Math.random() < 0.35 });
      }
      if (feathers.length > 24) feathers.splice(0, feathers.length - 24);
    }

    function startRun() {
      var fromOver = phase === 'over';
      phase = 'playing';
      score = 0;
      rng = hasSeed ? mulberry32(opts.seed) : Math.random;
      obstacles.length = 0;
      obsIndex = 0;
      GX = gullXFor(W);
      nextWx = camX + GX + 430;
      lastGap = (DECK_H + SEA_Y) / 2;
      if (fromOver) {
        gull.y = gull.prevY = READY_Y;
        gull.rot = 0;
        fadeA = 0.5;
        drops.length = 0; ripples.length = 0; sparks.length = 0;
      }
      gull.dx = 0; gull.vx = 0; gull.spin = 0; gull.floating = false; gull.fvy = 0; gull.floatT = 0;
      overT = 0; cause = ''; newBest = false; popT = 0; toast = null; flashA = 0; shakeT = 0;
      dayTarget = 0;
      doFlap();
    }

    function spawnObstacle() {
      var n = obsIndex++;
      var gap = gapFor(n), lo = DECK_H + 48 + gap / 2, hi = SEA_Y - 46 - gap / 2, c;
      if (n === 0) {
        c = (lo + hi) / 2 + (rng() - 0.5) * 30;
      } else {
        // Wander smoothly: aim somewhere in range but never jump further than a gull can manage.
        var maxD = 115 + 60 * ease01(n / 50);
        var target = lo + rng() * (hi - lo);
        c = lastGap + clamp(target - lastGap, -maxD, maxD);
      }
      c = clamp(c, lo, hi);
      lastGap = c;
      var top = c - gap / 2, bot = c + gap / 2, r = Math.random, barn = [];
      for (var i = 0; i < 10; i++) barn.push([4 + r() * (PW - 8), SEA_Y - 6 - r() * 22, 1.2 + r() * 1.8]);
      obstacles.push({ wx: nextWx, top: top, bot: bot, passed: false, n: n,
        g: [7 + r() * 6, 19 + r() * 6, 31 + r() * 6, 44 + r() * 6], gp: r() * TAU,
        knotX: 12 + r() * (PW - 24), knotT: 0.25 + r() * 0.5, knot2: r() < 0.5,
        ring: SEA_Y - bot > 160 && r() < 0.4, ringY: bot + 54 + r() * 24,
        lantern: top > 160 && r() < 0.5, lanternY: top - 50 - r() * 26,
        rope: r() < 0.55, deckL: 13 + r() * 7, deckR: 13 + r() * 7, plank: r() * 9, barn: barn });
      nextWx += spacingFor(n);
    }

    function addPoint() {
      score++;
      popT = 1;
      dayTarget = dayFor(score);
      var m = medalFor(score);
      if (m && m.at === score) {
        toast = { text: m.name + ' medal!', t: 0, m: m };
        sfx('milestone');
      } else {
        sfx('point');
      }
      var n = reduced ? 1 : 5;
      for (var i = 0; i < n; i++) {
        sparks.push({ x: GX + (Math.random() - 0.5) * 20, y: gull.y + (Math.random() - 0.5) * 20,
          vx: (Math.random() - 0.5) * 60, vy: -30 - Math.random() * 60, life: 1, dur: 0.5 + Math.random() * 0.4,
          s: 2 + Math.random() * 2.5 });
      }
      safeCall(onScore, score);
    }

    function crash(why) {
      phase = 'over';
      overT = 0;
      cause = why;
      newBest = score > best;
      if (newBest) best = score;
      if (why === 'sea') {
        gull.floating = true;
        gull.fvy = Math.max(gull.vy, 200) * 0.5;
        gull.vy = 0;
        splash(GX, Math.min(1.2, 0.7 + Math.abs(gull.fvy) / 600));
        sfx('splash');
        flashA = reduced ? 0.18 : 0.32;
        if (!reduced) { shakeT = shakeDur = 0.26; shakeMag = 4.5; }
      } else {
        gull.vx = -60;
        gull.vy = why === 'piling' ? Math.min(gull.vy, -170) : 60;
        gull.spin = 8;
        sfx('crash');
        flashA = reduced ? 0.25 : 0.62;
        if (!reduced) { shakeT = shakeDur = 0.34; shakeMag = 7.5; }
        burst(GX + 10, gull.y);
      }
      if (newBest && score > 0) sfx('best');
      safeCall(onOver, score);
      announce('Score ' + score + (newBest && score > 0 ? '. New best!' : ''));
    }

    function splash(x, power) {
      var n = Math.round((reduced ? 8 : 22) * power);
      for (var i = 0; i < n; i++) {
        var a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
        var sp = (140 + Math.random() * 260) * power;
        drops.push({ x: x + (Math.random() - 0.5) * 16, y: SEA_Y - 4, vx: Math.cos(a) * sp * 0.75, vy: Math.sin(a) * sp,
          r: 1.3 + Math.random() * 2.3, life: 1 });
      }
      ripples.push({ x: x, r: 6, life: 1, sp: 70 });
      if (!reduced) ripples.push({ x: x, r: 2, life: 1.25, sp: 46 });
    }
    function burst(x, y) {
      var n = reduced ? 2 : 6;
      for (var i = 0; i < n; i++) {
        feathers.push({ x: x, y: y, vx: (Math.random() - 0.6) * 160, vy: -60 - Math.random() * 120,
          rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 10, life: 1, dur: 1.1 + Math.random() * 0.7,
          ph: Math.random() * TAU, s: 0.9 + Math.random() * 0.5, grey: Math.random() < 0.4 });
      }
    }

    function waveBack(x, cam) {
      var u = x + cam * 0.95;
      return SEA_Y - 5 + 3.6 * Math.sin(u * 0.034 + animT * 1.5) + 1.8 * Math.sin(u * 0.083 - animT * 2.1);
    }
    function waveFront(x, cam) {
      var u = x + cam * 1.12;
      return SEA_Y + 25 + 5.5 * Math.sin(u * 0.026 - animT * 1.15) + 2.4 * Math.sin(u * 0.069 + animT * 1.9);
    }

    function step(dt) {
      time += dt;
      prevCam = camX;
      gull.prevY = gull.y;
      if (phase === 'ready') {
        camX += speedFor(0) * dt;
        gull.y = READY_Y + Math.sin(time * 2.2) * 9;
        gull.vy = Math.cos(time * 2.2) * 9 * 2.2;
        gull.rot += (Math.sin(time * 2.2 + 1.3) * 0.06 - gull.rot) * Math.min(1, dt * 8);
      } else if (phase === 'playing') {
        camX += speedFor(score) * dt;
        gull.flapT += dt;
        gull.vy = Math.min(MAX_FALL, gull.vy + GRAVITY * dt);
        gull.y += gull.vy * dt;
        var tr = clamp(gull.vy / 640, -0.42, 1.1);
        gull.rot += (tr - gull.rot) * Math.min(1, dt * (tr > gull.rot ? 6 : 18));
        while (nextWx - camX < W + 140) spawnObstacle();
        while (obstacles.length && obstacles[0].wx - camX < -PW - DECK_OVER - 60) obstacles.shift();
        var gx = GX + 2, gy = gull.y, gwx = camX + GX;
        for (var i = 0; i < obstacles.length; i++) {
          var o = obstacles[i];
          if (!o.passed && o.wx + PW / 2 < gwx) { o.passed = true; addPoint(); }
          var sx = o.wx - camX;
          if (sx - DECK_OVER > gx + HIT_R || sx + PW + DECK_OVER < gx - HIT_R) continue;
          if (circRect(gx, gy, HIT_R, sx + 2, -999, sx + PW - 2, o.top) ||
              circRect(gx, gy, HIT_R, sx - DECK_OVER, -999, sx + PW + DECK_OVER, DECK_H) ||
              circRect(gx, gy, HIT_R, sx + 2, o.bot, sx + PW - 2, 9999)) {
            crash('piling');
            break;
          }
        }
        if (phase === 'playing') {
          if (gy - HIT_R <= 0) crash('sky');
          else if (gy + HIT_R >= SEA_Y) crash('sea');
        }
      } else if (phase === 'over') {
        overT += dt;
        if (!gull.floating) {
          gull.vy = Math.min(MAX_FALL, gull.vy + GRAVITY * dt);
          gull.y += gull.vy * dt;
          gull.dx += gull.vx * dt;
          gull.vx *= 1 - Math.min(1, dt * 1.5);
          gull.rot += gull.spin * dt;
          if (gull.y >= SEA_Y - 8) {
            gull.floating = true;
            gull.fvy = gull.vy * 0.45;
            gull.vy = 0;
            splash(GX + gull.dx, 0.85);
            sfx('splash');
          }
        } else {
          // Bob on the water like a slightly dazed cork.
          gull.floatT += dt;
          var target = waveBack(GX + gull.dx, camX) - 4;
          gull.fvy += ((target - gull.y) * 70 - gull.fvy * 7) * dt;
          gull.y += gull.fvy * dt;
          var rr0 = ((gull.rot + Math.PI) % TAU + TAU) % TAU - Math.PI;   // shortest way back upright
          gull.rot = rr0 + ((0.1 + Math.sin(animT * 1.8) * 0.06) - rr0) * Math.min(1, dt * 4);
        }
      }
      updateWing(dt);
      updateFx(dt, camX - prevCam);
      var dayRate = dayT > dayTarget + 0.01 ? 2 : phase === 'playing' ? 0.7 : 0.5;   // rewind quickly after a crash
      dayT += (dayTarget - dayT) * Math.min(1, dt * dayRate);
    }

    function updateWing(dt) {
      var ta, tb;
      if (phase === 'ready') {
        var cyc = time % 2.6;
        if (cyc < 1.55) { ta = 0.2 + 0.74 * Math.sin(cyc * 12.5); tb = -0.32 * Math.cos(cyc * 12.5); }
        else { ta = 0.34 + Math.sin(time * 3) * 0.04; tb = -0.12; }
      } else if (phase === 'playing' || phase === 'paused') {
        var f = gull.flapT;
        if (f < 0.07) { ta = -0.85; tb = 0.5; }
        else if (f < 0.26) { var p = (f - 0.07) / 0.19; ta = -0.85 + 1.85 * p; tb = 0.5 - 0.85 * p; }
        else { ta = 0.3 + clamp(gull.vy / 1400, -0.1, 0.45) + Math.sin(time * 5) * 0.04; tb = -0.12; }
      } else if (!gull.floating) { ta = 1.05; tb = 0.45; }
      else { ta = 0.05; tb = 0.02; }
      var s = Math.min(1, dt * 38);
      gull.wa += (ta - gull.wa) * s;
      gull.wb += (tb - gull.wb) * s;
    }

    function compact(arr) {
      var j = 0;
      for (var i = 0; i < arr.length; i++) if (arr[i].life > 0) arr[j++] = arr[i];
      arr.length = j;
    }
    function updateFx(dt, shift) {
      popT = Math.max(0, popT - dt / 0.32);
      flashA = Math.max(0, flashA - dt * 3.2);
      shakeT = Math.max(0, shakeT - dt);
      fadeA = Math.max(0, fadeA - dt * 2.2);
      if (toast) { toast.t += dt; if (toast.t > 1.9) toast = null; }
      var i, p;
      for (i = 0; i < feathers.length; i++) {
        p = feathers[i];
        p.life -= dt / p.dur;
        p.vy += 80 * dt; p.vy *= 1 - Math.min(1, 1.6 * dt); p.vx *= 1 - Math.min(1, 1.1 * dt);
        p.x += (p.vx + Math.sin(p.ph + realT * 5) * 20) * dt - shift;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      }
      for (i = 0; i < drops.length; i++) {
        p = drops[i];
        p.vy += 900 * dt;
        p.x += p.vx * dt - shift; p.y += p.vy * dt;
        if (p.vy > 0 && p.y > SEA_Y + 4) p.life = 0;
      }
      for (i = 0; i < ripples.length; i++) {
        p = ripples[i];
        p.r += p.sp * dt; p.sp *= 1 - Math.min(1, dt * 1.2);
        p.life -= dt * 0.9; p.x -= shift;
      }
      for (i = 0; i < sparks.length; i++) {
        p = sparks[i];
        p.life -= dt / p.dur;
        p.x += p.vx * dt - shift * 0.5; p.y += p.vy * dt; p.vy += 40 * dt;
      }
      compact(feathers); compact(drops); compact(ripples); compact(sparks);
    }

    /* ---------- input ---------- */
    function tap() {
      if (destroyed) return;
      if (phase === 'ready') startRun();
      else if (phase === 'playing') doFlap();
      else if (phase === 'paused') resume();
      else if (phase === 'over' && overT >= COOLDOWN) startRun();
    }
    function onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { host.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
      unlockAudio();
      tap();
    }
    function onKeyDown(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var c = e.code, key = e.key;
      if (c === 'Space' || key === ' ' || c === 'ArrowUp' || key === 'ArrowUp' || c === 'KeyW' || key === 'w' || key === 'W') {
        e.preventDefault();
        if (e.repeat) return;
        unlockAudio();
        tap();
      } else if (c === 'Escape' || key === 'Escape' || c === 'KeyP' || key === 'p' || key === 'P') {
        if (phase === 'playing') { e.preventDefault(); pause(); }
        else if (phase === 'paused') { e.preventDefault(); resume(); }
      }
    }
    function onVis() {
      if (doc.hidden && phase === 'playing') pause();
      lastTs = 0;
    }

    /* ---------- loop ---------- */
    var rafId = 0, lastTs = 0, lastDpr = win.devicePixelRatio || 1;
    function frame(ts) {
      if (destroyed) return;
      rafId = win.requestAnimationFrame(frame);
      var dt = lastTs ? (ts - lastTs) / 1000 : STEP;
      lastTs = ts;
      if (!(dt > 0)) dt = 0;
      if (dt > MAX_DT) dt = MAX_DT;
      if ((win.devicePixelRatio || 1) !== lastDpr) { lastDpr = win.devicePixelRatio || 1; resize(cssW, cssH); }
      realT += dt;
      if (phase !== 'paused') {
        animT += dt;
        acc += dt;
        var n = 0;
        while (acc >= STEP && n < 16) { step(STEP); acc -= STEP; n++; }
        if (n === 16) acc = 0;
      }
      draw(acc / STEP);
    }

    /* ======================= drawing ======================= */
    var PAL = {}, GC = {}, WC = {};
    var sunX = 0, sunY = 0, sunVis = 1, moonA = 0, moonX = 0, moonY = 0, starA = 0, beamA = 0, lampA = 0, rimK = 1;
    function updatePalette() {
      var t = clamp(dayT, 0, 3), i = Math.min(2, Math.floor(t)), f = t - i, key, a, b, o;
      for (key in STOPS_RGB) {
        a = STOPS_RGB[key][i]; b = STOPS_RGB[key][i + 1];
        o = PAL[key] || (PAL[key] = [0, 0, 0]);
        o[0] = a[0] + (b[0] - a[0]) * f; o[1] = a[1] + (b[1] - a[1]) * f; o[2] = a[2] + (b[2] - a[2]) * f;
      }
      var amb = PAL.amb;
      for (key in BASE) {
        var c = BASE[key], tinted = [c[0] * amb[0] / 255, c[1] * amb[1] / 255, c[2] * amb[2] / 255];
        GC[key] = css(tinted);
        WC[key] = tinted;
      }
      sunX = W * 0.6;
      sunY = t < 1 ? lerp(HORIZON - 100, HORIZON - 54, t) : t < 2 ? lerp(HORIZON - 54, HORIZON - 4, t - 1) : lerp(HORIZON - 4, HORIZON + 52, t - 2);
      sunVis = 1 - smooth(1.9, 2.75, t);
      moonA = smooth(2.15, 2.95, t);
      moonX = W * 0.24;
      moonY = lerp(176, 108, moonA);
      starA = smooth(1.7, 2.9, t);
      beamA = smooth(1.9, 2.75, t);
      lampA = smooth(1.4, 2.6, t);
      rimK = 1 - smooth(2, 3, t) * 0.65;
    }

    function draw(alpha) {
      if (destroyed || !ctx || canvas.width < 2 || canvas.height < 2) return;
      var cam = prevCam + (camX - prevCam) * alpha;
      var gy = gull.prevY + (gull.y - gull.prevY) * alpha;
      updatePalette();
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (shakeT > 0 && !reduced) {
        var m = shakeMag * (shakeT / shakeDur);
        ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
      }
      var farCam = reduced ? 0 : cam, farT = reduced ? 0 : animT;
      ensureBackdrop();
      ctx.drawImage(bg, -BGM, -BGM, bg.width / bgK, bg.height / bgK);
      drawStars(farT);
      drawClouds(farCam, farT);
      drawCoast(farCam, farT);
      drawBirds(farCam, farT);
      drawSea(cam);
      drawPilings(cam);
      drawBackWave(cam);
      drawPilingFoam(cam);
      drawRipples();
      var gxs = GX + gull.dx;
      if (gull.floating) {
        // sit *in* the water: draw the gull, then the wave again over its belly
        drawGull(gxs, gy, gull.rot, gull.wa, gull.wb);
        ctx.save();
        ctx.beginPath(); ctx.rect(gxs - 50, SEA_Y - 30, 100, 90); ctx.clip();
        drawBackWave(cam);
        ctx.restore();
      }
      drawFrontWave(cam);
      drawDrops();
      if (!gull.floating) drawGull(gxs, gy, gull.rot, gull.wa, gull.wb);
      if (gull.floating && cause !== 'sea') drawDizzy(gxs, gy);
      drawFeathers();
      drawSparks();
      ctx.setTransform(k, 0, 0, k, 0, 0);
      drawHUD();
      if (flashA > 0) { ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(255,248,236,' + flashA.toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
      if (fadeA > 0) { ctx.fillStyle = css(PAL.sky1, fadeA); ctx.fillRect(0, 0, W, H); }
      ctx.globalAlpha = 1;
    }

    // The sky, sun, moon, sea base and vignette only change with the time of day, so they are
    // painted into an offscreen canvas and re-painted only while the light shifts (about 4x a second).
    var bg = null, bgCtx = null, bgDay = -1, bgW = 0, bgK = 0, bgAt = -9, BGM = 12;
    function ensureBackdrop() {
      var dd = Math.abs(dayT - bgDay), bk = k / Math.max(1, dpr);   // smooth gradients: CSS resolution is plenty
      if (bg && bgW === W && bgK === bk && (dd < 0.002 || (dd < 0.08 && realT - bgAt < 0.25))) return;
      if (!bg) { bg = doc.createElement('canvas'); bgCtx = bg.getContext('2d'); }
      var bw = Math.ceil((W + 2 * BGM) * bk), bh = Math.ceil((H + 2 * BGM) * bk);
      if (bg.width !== bw) bg.width = bw;
      if (bg.height !== bh) bg.height = bh;
      bgW = W; bgK = bk; bgDay = dayT; bgAt = realT;
      var main = ctx;
      ctx = bgCtx;   // reuse the drawing helpers on the offscreen context
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, bw, bh);
      ctx.setTransform(bk, 0, 0, bk, BGM * bk, BGM * bk);
      drawSky();
      drawMoon();
      drawSun();
      drawSeaBase();
      drawVignette();
      ctx = main;
    }

    var SKY_POS = [0, 0.45, 0.8, 1], SKY_KEYS = ['sky0', 'sky1', 'sky2', 'sky3'], _sk = [0, 0, 0];
    function skyAt(t) {
      // Catmull-Rom through the four sky keys: no slope breaks, so no visible bands
      var i = t < SKY_POS[1] ? 0 : t < SKY_POS[2] ? 1 : 2;
      var u = (t - SKY_POS[i]) / (SKY_POS[i + 1] - SKY_POS[i]);
      var p0 = PAL[SKY_KEYS[Math.max(0, i - 1)]], p1 = PAL[SKY_KEYS[i]], p2 = PAL[SKY_KEYS[i + 1]], p3 = PAL[SKY_KEYS[Math.min(3, i + 2)]];
      var u2 = u * u, u3 = u2 * u;
      for (var c = 0; c < 3; c++) {
        _sk[c] = clamp(0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * u + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * u2 +
          (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * u3), 0, 255);
      }
      return _sk;
    }
    function drawSky() {
      var g = ctx.createLinearGradient(0, 0, 0, HORIZON);
      for (var i = 0; i <= 16; i++) g.addColorStop(i / 16, css(skyAt(i / 16)));
      ctx.fillStyle = g;
      ctx.fillRect(-12, -12, W + 24, HORIZON + 14);
    }

    function drawStars(t) {
      if (starA < 0.01) return;
      ctx.fillStyle = css(MOON);
      var st = SCENE.stars;
      for (var i = 0; i < st.length; i++) {
        var s = st[i];
        var tw = reduced ? 0.85 : 0.6 + 0.4 * Math.sin(realT * s.sp + s.ph);
        var fade = 1 - smooth(HORIZON - 150, HORIZON - 40, s.y);
        ctx.globalAlpha = starA * tw * fade * (0.45 + s.s * 0.4);
        var x = s.x * W, sz = s.s;
        if (moonA > 0.01 && Math.abs(x - moonX) < 26 && Math.abs(s.y - moonY) < 26) continue;
        ctx.fillRect(x - sz / 2, s.y - sz / 2, sz, sz);
        if (s.s > 1.5) {
          ctx.globalAlpha *= 0.5;
          ctx.fillRect(x - sz * 2, s.y - 0.3, sz * 4, 0.6);
          ctx.fillRect(x - 0.3, s.y - sz * 2, 0.6, sz * 4);
        }
      }
      ctx.globalAlpha = 1;
    }

    function drawMoon() {
      if (moonA < 0.01) return;
      ctx.save();
      ctx.globalAlpha = moonA;
      var g = ctx.createRadialGradient(moonX, moonY, 10, moonX, moonY, 110);
      g.addColorStop(0, 'rgba(230,236,255,0.32)');
      g.addColorStop(1, 'rgba(230,236,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(moonX - 110, moonY - 110, 220, 220);
      var d = ctx.createRadialGradient(moonX - 6, moonY - 6, 2, moonX, moonY, 21);
      d.addColorStop(0, '#fffaf0');
      d.addColorStop(1, '#e3dccb');
      ctx.fillStyle = d;
      ctx.beginPath(); ctx.arc(moonX, moonY, 20, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(150,145,140,0.22)';
      ctx.beginPath(); ctx.arc(moonX - 6, moonY - 4, 5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(moonX + 7, moonY + 5, 3.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(moonX + 2, moonY - 10, 2.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(moonX - 4, moonY + 10, 2, 0, TAU); ctx.fill();
      ctx.restore();
    }

    function drawSun() {
      var gl = 1 - smooth(2.3, 3, dayT) * 0.75;
      ctx.globalCompositeOperation = 'lighter';
      var R = Math.max(W, H) * 0.85;
      var g = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, R);
      for (var gi = 0; gi <= 10; gi++) {
        var rr1 = gi / 10;
        g.addColorStop(rr1, css(PAL.glow, 0.5 * gl * (Math.exp(-rr1 * 5.5) - Math.exp(-5.5) * rr1)));
      }
      ctx.fillStyle = g;
      ctx.fillRect(-12, -12, W + 24, HORIZON + 14);
      // horizon haze
      var hz = ctx.createLinearGradient(0, HORIZON - 110, 0, HORIZON);
      hz.addColorStop(0, css(PAL.sky3, 0));
      hz.addColorStop(1, css(PAL.sky3, 0.35));
      ctx.fillStyle = hz;
      ctx.fillRect(-12, HORIZON - 110, W + 24, 111);
      ctx.globalCompositeOperation = 'source-over';
      if (sunVis > 0.01 && sunY - 40 < HORIZON) {
        ctx.save();
        ctx.beginPath(); ctx.rect(-12, -12, W + 24, HORIZON + 12); ctx.clip();
        ctx.globalAlpha = sunVis;
        var h = ctx.createRadialGradient(sunX, sunY, 26, sunX, sunY, 58);
        h.addColorStop(0, css(PAL.sun, 0.45));
        h.addColorStop(1, css(PAL.sun, 0));
        ctx.fillStyle = h;
        ctx.beginPath(); ctx.arc(sunX, sunY, 58, 0, TAU); ctx.fill();
        var d = ctx.createRadialGradient(sunX - 5, sunY - 6, 2, sunX, sunY, 30);
        d.addColorStop(0, css(mixc(PAL.sun, WHITE, 0.6)));
        d.addColorStop(0.65, css(PAL.sun));
        d.addColorStop(1, css(PAL.sunEdge));
        ctx.fillStyle = d;
        ctx.beginPath(); ctx.arc(sunX, sunY, 29, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }

    function drawClouds(cam, t) {
      var span = Math.max(1900, W + 760), lit = css(PAL.cloudLit, 0.9);
      var top = css(mixc(PAL.cloud, PAL.sky1, 0.5), 0.5);
      var body = ctx.createLinearGradient(0, -14, 0, 12);
      body.addColorStop(0, css(mixc(PAL.cloud, PAL.sky0, 0.25), 0.92));
      body.addColorStop(1, css(mixc(PAL.cloud, PAL.cloudLit, 0.25), 0.92));
      var cl = SCENE.clouds;
      for (var i = 0; i < cl.length; i++) {
        var c = cl[i];
        var x = c.f * span - cam * c.par - t * c.sp;
        x = ((x % span) + span) % span - 380;
        if (x > W + 380) continue;
        ctx.save();
        ctx.translate(x, c.y);
        ctx.scale(c.s, c.s);
        var p, j;
        ctx.fillStyle = lit;
        ctx.beginPath();
        for (j = 0; j < c.p.length; j++) { p = c.p[j]; ctx.moveTo(p.dx + p.rx * 1.02, p.dy + p.ry * 0.34); ctx.ellipse(p.dx, p.dy + p.ry * 0.34, p.rx * 1.02, p.ry, 0, 0, TAU); }
        ctx.fill();
        ctx.fillStyle = body;
        ctx.beginPath();
        for (j = 0; j < c.p.length; j++) { p = c.p[j]; ctx.moveTo(p.dx + p.rx * 0.97, p.dy - p.ry * 0.1); ctx.ellipse(p.dx, p.dy - p.ry * 0.1, p.rx * 0.97, p.ry * 0.9, 0, 0, TAU); }
        ctx.fill();
        ctx.fillStyle = top;
        ctx.beginPath();
        for (j = 0; j < c.p.length; j++) { p = c.p[j]; ctx.moveTo(p.dx + p.rx * 0.7, p.dy - p.ry * 0.45); ctx.ellipse(p.dx, p.dy - p.ry * 0.45, p.rx * 0.7, p.ry * 0.45, 0, 0, TAU); }
        ctx.fill();
        ctx.restore();
      }
    }

    function drawCoast(cam, t) {
      var x, u, h;
      // far range
      var shiftF = 900;
      ctx.fillStyle = css(mixc(PAL.coastFar, PAL.sky3, 0.25));
      ctx.beginPath();
      ctx.moveTo(-12, HORIZON + 0.5);
      for (x = -12; x <= W + 12; x += 6) {
        h = coastAt(SCENE.far, SCENE.FP, x + cam * 0.022 + shiftF);
        ctx.lineTo(x, HORIZON - h);
      }
      ctx.lineTo(W + 12, HORIZON + 0.5);
      ctx.closePath();
      ctx.fill();
      // near coast with the lighthouse headland
      var NP = SCENE.NP, LX = SCENE.LX, par = 0.055;
      var shift = LX - W * 0.86;
      var g = ctx.createLinearGradient(0, HORIZON - 40, 0, HORIZON);
      g.addColorStop(0, css(PAL.coast));
      g.addColorStop(1, css(mixc(PAL.coast, PAL.seaHz, 0.3)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-12, HORIZON + 0.5);
      for (x = -12; x <= W + 12; x += 5) {
        h = coastAt(SCENE.near, NP, x + cam * par + shift);
        ctx.lineTo(x, HORIZON - h);
      }
      ctx.lineTo(W + 12, HORIZON + 0.5);
      ctx.closePath();
      ctx.fill();
      // town lights at dusk
      if (lampA > 0.02) {
        var L = SCENE.lights;
        for (var i = 0; i < L.length; i++) {
          var lx = L[i].u - cam * par - shift;
          lx = ((lx % NP) + NP) % NP;
          if (lx > W + 10) lx -= NP;
          if (lx < -10 || lx > W + 10) continue;
          var tw = reduced ? 1 : 0.75 + 0.25 * Math.sin(realT * 2 + L[i].ph);
          ctx.globalAlpha = lampA * tw * 0.9;
          ctx.fillStyle = '#ffd89a';
          ctx.fillRect(lx - 0.8, HORIZON - L[i].y - 0.8, 1.6, 1.6);
        }
        ctx.globalAlpha = 1;
      }
      // lighthouse (tiles with the coast)
      var base = ((LX - cam * par - shift) % NP + NP) % NP;
      for (var c = -1; c <= 1; c++) {
        var lxx = base + c * NP;
        if (lxx > -280 && lxx < W + 280) drawLighthouse(lxx, HORIZON - coastAt(SCENE.near, NP, LX), t);
      }
    }

    function drawLighthouse(x, by, t) {
      var hgt = 42, bw = 7, tw = 4.6;
      var body = css(mixc(mixc(BASE.tower, PAL.coast, 0.3), WC.tower, 0.4));
      var stripe = css(mixc(mixc(BASE.stripe, PAL.coast, 0.35), WC.stripe, 0.4));
      var dark = css(mixc(PAL.coast, NIGHT, 0.4));
      // keeper's cottage
      ctx.fillStyle = css(mixc(mixc(BASE.tower, PAL.coast, 0.45), WC.tower, 0.3));
      ctx.fillRect(x + 6, by - 9, 14, 9);
      ctx.fillStyle = stripe;
      ctx.beginPath(); ctx.moveTo(x + 4.5, by - 9); ctx.lineTo(x + 13, by - 15); ctx.lineTo(x + 21.5, by - 9); ctx.closePath(); ctx.fill();
      if (lampA > 0.02) { ctx.fillStyle = 'rgba(255,214,140,' + (lampA * 0.9).toFixed(3) + ')'; ctx.fillRect(x + 11, by - 6, 3, 3); }
      // tower
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.moveTo(x - bw, by); ctx.lineTo(x - tw, by - hgt); ctx.lineTo(x + tw, by - hgt); ctx.lineTo(x + bw, by); ctx.closePath(); ctx.fill();
      ctx.fillStyle = stripe;
      for (var s = 0; s < 2; s++) {
        var y0 = 0.22 + s * 0.36, y1 = y0 + 0.17;
        var w0 = lerp(bw, tw, y0), w1 = lerp(bw, tw, y1);
        ctx.beginPath(); ctx.moveTo(x - w0, by - hgt * y0); ctx.lineTo(x - w1, by - hgt * y1); ctx.lineTo(x + w1, by - hgt * y1); ctx.lineTo(x + w0, by - hgt * y0); ctx.closePath(); ctx.fill();
      }
      // shade side
      ctx.fillStyle = 'rgba(20,20,40,0.18)';
      ctx.beginPath(); ctx.moveTo(x + 1.5, by); ctx.lineTo(x + 1, by - hgt); ctx.lineTo(x + tw, by - hgt); ctx.lineTo(x + bw, by); ctx.closePath(); ctx.fill();
      // gallery, lamp room, roof
      ctx.fillStyle = dark;
      ctx.fillRect(x - 6.5, by - hgt - 2, 13, 2.2);
      var ly = by - hgt - 6;
      ctx.fillStyle = css(mixc(BASE.lampOff, BASE.lamp, 0.35 + 0.65 * lampA));
      ctx.fillRect(x - 3.4, by - hgt - 9, 6.8, 7);
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.moveTo(x - 5, by - hgt - 9); ctx.lineTo(x, by - hgt - 15); ctx.lineTo(x + 5, by - hgt - 9); ctx.closePath(); ctx.fill();
      // sweeping beam
      var a = reduced ? 0.9 : t * 0.85;
      var flare = Math.pow(Math.abs(Math.sin(a)), 10);
      if (beamA > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        for (var b = 0; b < 2; b++) {
          var d = b ? -Math.cos(a) : Math.cos(a), ad = Math.abs(d), dir = d >= 0 ? 1 : -1;
          var len = 40 + 300 * ad, hw = 7 + 24 * (1 - ad);
          if (reduced) { len = 150; hw = 14; }
          var g = ctx.createLinearGradient(x, ly, x + dir * len, ly);
          g.addColorStop(0, 'rgba(255,240,200,' + (0.36 * beamA).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(255,240,200,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(x, ly - 1.5); ctx.lineTo(x + dir * len, ly - hw); ctx.lineTo(x + dir * len, ly + hw * 0.7); ctx.lineTo(x, ly + 1.5); ctx.closePath(); ctx.fill();
        }
        var fr = 5 + 22 * (reduced ? 0.3 : flare);
        var fg = ctx.createRadialGradient(x, ly, 0, x, ly, fr);
        fg.addColorStop(0, 'rgba(255,246,215,' + (beamA * (0.6 + 0.4 * flare)).toFixed(3) + ')');
        fg.addColorStop(1, 'rgba(255,246,215,0)');
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(x, ly, fr, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    function drawBirds(cam, t) {
      if (dayT > 2.6) return;
      var span = W + 240, col = css(mixc(PAL.coast, NIGHT, 0.2), 0.75 * (1 - smooth(2, 2.6, dayT)));
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      var B = SCENE.birds;
      ctx.beginPath();
      for (var i = 0; i < B.length; i++) {
        var b = B[i];
        var x = b.f * span - cam * 0.11 + t * b.sp;
        x = ((x % span) + span) % span - 120;
        var y = b.y + Math.sin(t * 0.7 + b.ph) * 6;
        var w = reduced ? 0.6 : Math.sin(t * 6 + b.ph), s = 6 * b.s;
        ctx.moveTo(x - s, y - w * s * 0.5);
        ctx.quadraticCurveTo(x - s * 0.45, y - s * 0.55, x, y);
        ctx.quadraticCurveTo(x + s * 0.45, y - s * 0.55, x + s, y - w * s * 0.5);
      }
      ctx.stroke();
    }

    function drawSeaBase() {
      var g = ctx.createLinearGradient(0, HORIZON, 0, H);
      g.addColorStop(0, css(PAL.seaHz));
      g.addColorStop(0.16, css(mixc(PAL.seaHz, PAL.seaMid, 0.6)));
      g.addColorStop(0.55, css(PAL.seaMid));
      g.addColorStop(1, css(PAL.seaDeep));
      ctx.fillStyle = g;
      ctx.fillRect(-12, HORIZON, W + 24, H - HORIZON + 12);
    }
    function drawSea(cam) {
      ctx.fillStyle = css(mixc(PAL.sky3, WHITE, 0.3), 0.6);
      ctx.fillRect(-12, HORIZON - 0.6, W + 24, 1.4);
      // distant wave glints, denser and slower near the horizon
      ctx.strokeStyle = css(PAL.glint);
      ctx.lineCap = 'round';
      var rows = 16, i, x, j;
      for (i = 0; i < rows; i++) {
        var d = (i + 0.5) / rows;
        var y = HORIZON + 4 + (SEA_Y - HORIZON - 22) * Math.pow(d, 1.65);
        var spacing = 34 + 120 * d, len = 5 + 34 * d, par = 0.06 + 0.72 * d;
        var total = cam * par + animT * (3 + 9 * d) + i * 97.3;
        var n0 = Math.floor(total / spacing), x0 = n0 * spacing - total;
        ctx.globalAlpha = 0.06 + 0.16 * d;
        ctx.lineWidth = 0.7 + 1.5 * d;
        ctx.beginPath();
        for (x = x0, j = 0; x < W + spacing; x += spacing, j++) {
          var hsh = hash((n0 + j) * 7 + i * 131);
          var ll = len * (0.45 + hsh) * (0.7 + 0.3 * Math.sin(animT * 1.6 + hsh * 20));
          var lx = x + hsh * spacing * 0.5, yy = y + (hsh - 0.5) * (2 + 5 * d);
          ctx.moveTo(lx, yy);
          ctx.lineTo(lx + ll, yy);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // reflections of the sun and the moon
      ctx.globalCompositeOperation = 'lighter';
      if (sunVis > 0.01) reflection(sunX, PAL.glint, sunVis * (sunY < HORIZON ? 1 : 0.6), 1);
      if (moonA > 0.01) reflection(moonX, MOON, moonA * 0.75, 0.45);
      ctx.globalCompositeOperation = 'source-over';
      // two swell lines, broken into patches
      for (var L = 0; L < 2; L++) {
        var base = L ? SEA_Y - 32 : SEA_Y - 70, sp = L ? 0.82 : 0.62, amp = L ? 2.6 : 1.8, kx = L ? 0.045 : 0.06;
        ctx.strokeStyle = css(PAL.glint, (L ? 0.17 : 0.11) * (1 - 0.4 * starA));
        ctx.lineWidth = L ? 1.6 : 1.2;
        ctx.beginPath();
        var on = false;
        for (x = -10; x <= W + 10; x += 6) {
          var u = x + cam * sp;
          var mask = Math.sin(u * 0.011 + L * 2 + animT * 0.3) + 0.35 * Math.sin(u * 0.037 + L);
          var yy2 = base + amp * Math.sin(u * kx + animT * (L ? 1.3 : 1)) + amp * 0.5 * Math.sin(u * kx * 2.3 - animT * 1.7);
          if (mask > 0.15) { if (on) ctx.lineTo(x, yy2); else ctx.moveTo(x, yy2); on = true; } else on = false;
        }
        ctx.stroke();
      }
    }
    function reflection(cx, col, vis, width) {
      ctx.fillStyle = css(col);
      var y = HORIZON + 1, r = 0, sp = reduced ? 0.5 : 1;
      while (y < SEA_Y + 20) {
        var d = (y - HORIZON) / (SEA_Y - HORIZON);
        var hw = (5 + 62 * d) * width * (0.55 + 0.45 * Math.sin(animT * 2.6 * sp + r * 1.9));
        var jx = Math.sin(animT * 1.4 * sp + r * 2.7) * (2 + 10 * d);
        var gp = hw * 0.35 * hash(r * 3.1 + Math.floor(animT * 4 * sp));
        ctx.globalAlpha = vis * (0.6 - 0.32 * d) * (0.55 + 0.45 * Math.sin(animT * 3.3 * sp + r * 0.7));
        var hgt = 1 + 2.2 * d;
        ctx.fillRect(cx - hw + jx, y, hw - gp, hgt);
        ctx.fillRect(cx + gp + jx, y, hw - gp, hgt);
        y += 2 + 7 * d;
        r++;
      }
      ctx.globalAlpha = 1;
    }

    /* ---------- pier pilings ---------- */
    function drawPilings(cam) {
      var g = ctx.createLinearGradient(0, 0, PW, 0);
      g.addColorStop(0, css(WC.woodDk2));
      g.addColorStop(0.12, css(WC.woodDk));
      g.addColorStop(0.3, css(WC.woodMid));
      g.addColorStop(0.46, css(WC.woodLt));
      g.addColorStop(0.66, css(WC.woodMid));
      g.addColorStop(0.9, css(WC.woodDk));
      g.addColorStop(1, css(WC.woodDk2));
      for (var i = 0; i < obstacles.length; i++) {
        var o = obstacles[i], sx = o.wx - cam;
        if (sx > W + DECK_OVER + 20 || sx < -PW - DECK_OVER - 30) continue;
        ctx.save();
        ctx.translate(sx, 0);
        var rimSide = sx + PW / 2 < sunX ? 1 : -1;
        drawPost(o, -6, o.top - 2, g, rimSide, true);
        drawDeck(o);
        drawPost(o, o.bot + 2, H + 10, g, rimSide, false);
        ctx.restore();
      }
    }

    function drawPost(o, y0, y1, grad, rimSide, isTop) {
      var hgt = y1 - y0;
      if (hgt <= 0) return;
      ctx.fillStyle = grad;
      ctx.fillRect(0, y0, PW, hgt);
      // grain
      ctx.strokeStyle = css(WC.grain, 0.45);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var gi = 0; gi < o.g.length; gi++) {
        var gx = o.g[gi];
        ctx.moveTo(gx + Math.sin(y0 * 0.045 + o.gp + gx) * 1.3, y0);
        for (var y = y0 + 18; y <= y1 + 18; y += 18) ctx.lineTo(gx + Math.sin(y * 0.045 + o.gp + gx) * 1.3, Math.min(y, y1));
      }
      ctx.stroke();
      // knots and a crack
      var ky = y0 + hgt * o.knotT;
      if (hgt > 70) {
        ctx.fillStyle = css(WC.woodDk, 0.75);
        ctx.beginPath(); ctx.ellipse(o.knotX, ky, 3.4, 5.5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = css(WC.woodMid, 0.9);
        ctx.beginPath(); ctx.ellipse(o.knotX, ky, 1.4, 2.4, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = css(WC.woodDk2, 0.6);
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(o.knotX + 8, ky + 14); ctx.lineTo(o.knotX + 10, ky + 30); ctx.lineTo(o.knotX + 9, ky + 42); ctx.stroke();
      }
      // rim light from the low sun
      var rg = rimSide > 0 ? ctx.createLinearGradient(PW - 9, 0, PW - 1, 0) : ctx.createLinearGradient(9, 0, 1, 0);
      rg.addColorStop(0, css(PAL.rim, 0));
      rg.addColorStop(1, css(PAL.rim, 0.55 * rimK));
      ctx.fillStyle = rg;
      if (rimSide > 0) ctx.fillRect(PW - 9, y0, 8, hgt); else ctx.fillRect(1, y0, 8, hgt);
      var iron = css(WC.iron), ironLt = css(WC.ironLt);
      if (isTop) {
        // shadow under the deck
        var sg = ctx.createLinearGradient(0, DECK_H, 0, DECK_H + 26);
        sg.addColorStop(0, 'rgba(10,8,12,0.45)');
        sg.addColorStop(1, 'rgba(10,8,12,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(0, DECK_H, PW, 26);
        // iron strap near the bottom end
        if (hgt > 50) band(y1 - 22, iron, ironLt);
        // underside (end grain seen from below)
        ctx.fillStyle = css(WC.endDk);
        ctx.beginPath(); ctx.ellipse(PW / 2, y1, PW / 2, 5, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = css(WC.woodDk2, 0.5);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(PW / 2, y1 + 0.5, PW / 2 - 8, 3, 0, 0, Math.PI); ctx.stroke();
        if (o.lantern) drawLantern(PW / 2, o.lanternY);
      } else {
        // wet, weedy band at the waterline and barnacles
        var wg = ctx.createLinearGradient(0, SEA_Y - 46, 0, SEA_Y);
        wg.addColorStop(0, css(WC.algae, 0));
        wg.addColorStop(1, css(WC.algae, 0.85));
        ctx.fillStyle = wg;
        ctx.fillRect(0, Math.max(y0, SEA_Y - 46), PW, H + 10 - Math.max(y0, SEA_Y - 46));
        for (var b = 0; b < o.barn.length; b++) {
          var bb = o.barn[b];
          if (bb[1] < y0 + 6) continue;
          ctx.fillStyle = css(WC.barn, 0.85);
          ctx.beginPath(); ctx.arc(bb[0], bb[1], bb[2], 0, TAU); ctx.fill();
          ctx.fillStyle = css(WC.woodDk2, 0.7);
          ctx.beginPath(); ctx.arc(bb[0], bb[1], bb[2] * 0.4, 0, TAU); ctx.fill();
        }
        if (hgt > 60) band(y0 + (o.rope ? 34 : 18), iron, ironLt);
        if (o.rope) drawRope(y0 + 10);
        if (o.ring) drawRing(PW / 2, o.ringY);
        // top face (end grain seen from above)
        ctx.fillStyle = css(WC.end);
        ctx.beginPath(); ctx.ellipse(PW / 2, y0, PW / 2, 5.5, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = css(WC.woodMid, 0.55);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.ellipse(PW / 2, y0, PW / 2 - 7, 3.6, 0, 0, TAU);
        ctx.moveTo(PW / 2 + 14, y0);
        ctx.ellipse(PW / 2, y0, 14, 2, 0, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = css(WC.woodDk, 0.7);
        ctx.beginPath(); ctx.moveTo(PW / 2 - 4, y0 - 1); ctx.lineTo(PW / 2 + 9, y0 + 2.5); ctx.stroke();
        ctx.fillStyle = css(PAL.rim, 0.35 * rimK);
        ctx.beginPath(); ctx.ellipse(PW / 2, y0 - 1.5, PW / 2 - 6, 2, 0, Math.PI, TAU); ctx.fill();
      }
    }
    function band(y, iron, ironLt) {
      ctx.fillStyle = iron;
      ctx.fillRect(-0.5, y, PW + 1, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(-0.5, y, PW + 1, 1.2);
      ctx.fillStyle = ironLt;
      for (var i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(9 + i * 14, y + 3, 1.3, 0, TAU); ctx.fill(); }
    }
    function drawRope(y) {
      ctx.lineCap = 'round';
      for (var i = 0; i < 3; i++) {
        var yy = y + i * 5.5;
        ctx.strokeStyle = css(WC.ropeDk);
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(-1, yy + 1); ctx.lineTo(PW + 1, yy + 4); ctx.stroke();
        ctx.strokeStyle = css(WC.rope);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-1, yy); ctx.lineTo(PW + 1, yy + 3); ctx.stroke();
      }
      ctx.strokeStyle = css(WC.rope);
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(PW - 2, y + 14); ctx.quadraticCurveTo(PW + 7, y + 22, PW + 3, y + 34); ctx.stroke();
    }
    function drawRing(cx, cy) {
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(10,10,15,0.3)';
      ctx.beginPath(); ctx.arc(cx + 1.5, cy + 2, 13.5, 0, TAU); ctx.stroke();
      for (var i = 0; i < 8; i++) {
        ctx.strokeStyle = css(i % 2 ? WC.ringW : WC.ring);
        ctx.beginPath(); ctx.arc(cx, cy, 13.5, i * TAU / 8 - 0.02, (i + 1) * TAU / 8 + 0.02); ctx.stroke();
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(cx, cy, 15.5, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
      ctx.strokeStyle = css(WC.rope);
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cx, cy - 17); ctx.lineTo(cx, cy - 25); ctx.stroke();
    }
    function drawLantern(cx, cy) {
      ctx.fillStyle = css(WC.iron);
      ctx.fillRect(cx - 1, cy - 16, 2, 8);
      ctx.fillRect(cx - 6, cy - 9, 12, 2.5);
      var glow = lampA;
      ctx.fillStyle = css(mixc(BASE.lampOff, BASE.lamp, 0.25 + 0.75 * glow));
      ctx.fillRect(cx - 4.5, cy - 6.5, 9, 12);
      ctx.strokeStyle = css(WC.iron);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - 4.5, cy - 6.5, 9, 12);
      ctx.beginPath(); ctx.moveTo(cx, cy - 6.5); ctx.lineTo(cx, cy + 5.5); ctx.stroke();
      ctx.fillStyle = css(WC.iron);
      ctx.beginPath(); ctx.moveTo(cx - 6, cy - 6.5); ctx.lineTo(cx, cy - 11); ctx.lineTo(cx + 6, cy - 6.5); ctx.closePath(); ctx.fill();
      ctx.fillRect(cx - 5.5, cy + 5.5, 11, 2);
      if (glow > 0.02) {
        ctx.globalCompositeOperation = 'lighter';
        var r = 38 + (reduced ? 0 : Math.sin(realT * 7 + cy) * 1.5);
        var g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
        g.addColorStop(0, 'rgba(255,205,120,' + (0.55 * glow).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,170,90,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    function drawDeck(o) {
      var L = -o.deckL, R = PW + o.deckR;
      // stringer beam
      var g = ctx.createLinearGradient(0, 7, 0, DECK_H);
      g.addColorStop(0, css(WC.deck));
      g.addColorStop(1, css(WC.woodDk));
      ctx.fillStyle = g;
      ctx.fillRect(L + 3, 7, R - L - 6, DECK_H - 7);
      ctx.fillStyle = css(PAL.rim, 0.25 * rimK);
      ctx.fillRect(L + 3, 7, R - L - 6, 1.5);
      ctx.fillStyle = css(WC.ironLt);
      ctx.beginPath(); ctx.arc(L + 10, 15, 1.6, 0, TAU); ctx.arc(R - 10, 15, 1.6, 0, TAU); ctx.fill();
      // plank ends
      for (var x = L, i = 0; x < R - 2; x += 9, i++) {
        var w = Math.min(8, R - x), dh = hash(o.n * 17 + i) * 2.2;
        ctx.fillStyle = css(mixc(WC.deck, WC.woodLt, hash(o.n * 5 + i * 3) * 0.6));
        ctx.fillRect(x, -6, w, 13 - dh);
        ctx.fillStyle = css(WC.woodDk2, 0.35);
        ctx.fillRect(x, 5 - dh, w, 2);
      }
      // cross braces
      ctx.lineCap = 'butt';
      ctx.strokeStyle = css(WC.woodDk);
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(L + 6, DECK_H - 3); ctx.lineTo(1, DECK_H + 34);
      ctx.moveTo(R - 6, DECK_H - 3); ctx.lineTo(PW - 1, DECK_H + 34);
      ctx.stroke();
      ctx.strokeStyle = css(PAL.rim, 0.25 * rimK);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(L + 5, DECK_H - 4); ctx.lineTo(0, DECK_H + 33);
      ctx.moveTo(R - 5, DECK_H - 4); ctx.lineTo(PW, DECK_H + 33);
      ctx.stroke();
    }

    function drawBackWave(cam) {
      var g = ctx.createLinearGradient(0, SEA_Y - 12, 0, H);
      g.addColorStop(0, css(mixc(mixc(PAL.seaMid, PAL.front, 0.4), PAL.glint, 0.16)));
      g.addColorStop(0.3, css(mixc(PAL.seaMid, PAL.front, 0.6)));
      g.addColorStop(1, css(PAL.seaDeep));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-12, H + 12);
      var x;
      for (x = -12; x <= W + 12; x += 8) ctx.lineTo(x, waveBack(x, cam));
      ctx.lineTo(W + 12, H + 12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = css(PAL.foam, 0.4);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (x = -12; x <= W + 12; x += 8) { if (x === -12) ctx.moveTo(x, waveBack(x, cam)); else ctx.lineTo(x, waveBack(x, cam)); }
      ctx.stroke();
      // foam flecks riding the crests
      ctx.fillStyle = css(PAL.foam, 0.55);
      var sp = 46, tot = cam * 0.95, m0 = Math.floor(tot / sp);
      ctx.beginPath();
      for (var q = 0; q * sp < W + sp * 2; q++) {
        var idx = m0 + q, hh = hash(idx * 5.3 + 1);
        if (hh < 0.45) continue;
        var fx = idx * sp - tot + hh * 20, fy = waveBack(fx, cam) + 1;
        var fw = 4 + hh * 9;
        ctx.moveTo(fx + fw, fy);
        ctx.ellipse(fx, fy, fw, 1.3, 0, 0, TAU);
      }
      ctx.fill();
    }
    function drawPilingFoam(cam) {
      ctx.strokeStyle = css(PAL.foam, 0.7);
      ctx.fillStyle = css(PAL.foam, 0.7);
      ctx.lineWidth = 2;
      for (var i = 0; i < obstacles.length; i++) {
        var o = obstacles[i], sx = o.wx - cam;
        if (sx > W + 20 || sx < -PW - 20) continue;
        var cx = sx + PW / 2, cy = waveBack(cx, cam) + 1.5, wob = Math.sin(animT * 3 + o.n) * 2;
        ctx.beginPath(); ctx.ellipse(cx, cy, PW / 2 + 7 + wob, 3.8, 0, 0.1, Math.PI - 0.1); ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx - PW / 2 - 6 - wob, cy - 0.5, 2.4, 0, TAU);
        ctx.arc(cx + PW / 2 + 8 + wob, cy + 0.5, 1.8, 0, TAU);
        ctx.fill();
      }
    }
    function drawFrontWave(cam) {
      var g = ctx.createLinearGradient(0, SEA_Y + 14, 0, H);
      g.addColorStop(0, css(PAL.front));
      g.addColorStop(1, css(mixc(PAL.seaDeep, NIGHT, 0.3)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-12, H + 12);
      var x;
      for (x = -12; x <= W + 12; x += 8) ctx.lineTo(x, waveFront(x, cam));
      ctx.lineTo(W + 12, H + 12);
      ctx.closePath();
      ctx.fill();
      // translucent lip just under the crest, then the foam line
      ctx.lineJoin = 'round';
      ctx.strokeStyle = css(mixc(PAL.front, PAL.glint, 0.3), 0.55);
      ctx.lineWidth = 7;
      ctx.beginPath();
      for (x = -12; x <= W + 12; x += 8) { if (x === -12) ctx.moveTo(x, waveFront(x, cam) + 5); else ctx.lineTo(x, waveFront(x, cam) + 5); }
      ctx.stroke();
      ctx.strokeStyle = css(PAL.foam, 0.8);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (x = -12; x <= W + 12; x += 8) { if (x === -12) ctx.moveTo(x, waveFront(x, cam)); else ctx.lineTo(x, waveFront(x, cam)); }
      ctx.stroke();
      // foam caps on the crests and drifting foam streaks
      var per = TAU / 0.026, off = cam * 1.12 - animT * 1.15 / 0.026;
      var n0 = Math.floor((off + 0.25 * per) / per);
      ctx.fillStyle = css(PAL.foam, 0.85);
      for (var j = n0 - 1; j < n0 + W / per + 2; j++) {
        var cx = j * per - off + per * 0.25 - per * 0.5;
        var cy = waveFront(cx, cam);
        ctx.beginPath();
        ctx.moveTo(cx + 18, cy - 0.5);
        ctx.ellipse(cx, cy - 0.5, 18, 3, 0, 0, TAU);
        ctx.moveTo(cx + 9, cy - 2.2);
        ctx.ellipse(cx + 3, cy - 2.2, 6, 2.6, 0, 0, TAU);
        ctx.moveTo(cx + 29, cy + 1);
        ctx.ellipse(cx + 22, cy + 1, 7, 2, 0, 0, TAU);
        ctx.moveTo(cx - 15, cy + 0.6);
        ctx.ellipse(cx - 21, cy + 0.6, 6, 1.8, 0, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = css(PAL.foam, 0.22);
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      var sp = 70, tot = cam * 1.2, m0 = Math.floor(tot / sp);
      ctx.beginPath();
      for (var q = 0; q * sp < W + sp * 2; q++) {
        var idx = m0 + q, hh = hash(idx * 3.7);
        var fx = idx * sp - tot + hh * 30, fy = SEA_Y + 40 + hh * (H - SEA_Y - 50);
        ctx.moveTo(fx, fy); ctx.lineTo(fx + 8 + hh * 16, fy);
      }
      ctx.stroke();
    }

    /* ---------- the gull ---------- */
    function hp(x, y, cb, sb, out) {
      var dx = x + 17, dy = y - 1;
      out[0] = -17 + dx * cb - dy * sb;
      out[1] = 1 + dx * sb + dy * cb;
      return out;
    }
    var _a = [0, 0], _b = [0, 0];
    // Trailing-edge feather points of the hand (x < -17 rotates with the wrist bend) and arm.
    var TRAIL = [[-36.5, 3.9], [-32, 5.7], [-27, 6.9], [-21.5, 7.9], [-15.5, 8.8], [-9, 9.2], [-3, 8.2], [3.5, 4]];
    function wing(sx, sy, a, b, s, grey, black, light, isFar) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(a);
      ctx.scale(s, s);
      var cb = Math.cos(b), sb = Math.sin(b), i, p, q;
      ctx.fillStyle = grey;
      ctx.beginPath();
      ctx.moveTo(3, -3);
      ctx.quadraticCurveTo(-6, -6.4, -17, -4.4);
      p = hp(-28, -3.9, cb, sb, _a); ctx.lineTo(p[0], p[1]);
      q = hp(-36, -2.6, cb, sb, _b); p = hp(-40.5, 0.8, cb, sb, _a);
      ctx.quadraticCurveTo(q[0], q[1], p[0], p[1]);
      var px = -40.5, py = 0.8;
      for (i = 0; i < TRAIL.length; i++) {
        var t = TRAIL[i], mx = (px + t[0]) / 2, my = (py + t[1]) / 2 + 1.9;
        if (t[0] < -17) { q = hp(mx, my, cb, sb, _b); p = hp(t[0], t[1], cb, sb, _a); }
        else { q = mx < -17 ? hp(mx, my, cb, sb, _b) : (_b[0] = mx, _b[1] = my, _b); _a[0] = t[0]; _a[1] = t[1]; p = _a; }
        ctx.quadraticCurveTo(q[0], q[1], p[0], p[1]);
        px = t[0]; py = t[1];
      }
      ctx.closePath();
      ctx.fill();
      // black wingtip with a white "mirror" spot
      ctx.fillStyle = black;
      ctx.beginPath();
      p = hp(-29.5, -3.8, cb, sb, _a); ctx.moveTo(p[0], p[1]);
      q = hp(-36, -2.6, cb, sb, _b); p = hp(-40.5, 0.8, cb, sb, _a); ctx.quadraticCurveTo(q[0], q[1], p[0], p[1]);
      q = hp(-38.5, 4.2, cb, sb, _b); p = hp(-36.5, 3.9, cb, sb, _a); ctx.quadraticCurveTo(q[0], q[1], p[0], p[1]);
      q = hp(-34, 6.8, cb, sb, _b); p = hp(-32, 5.7, cb, sb, _a); ctx.quadraticCurveTo(q[0], q[1], p[0], p[1]);
      p = hp(-30, 6.1, cb, sb, _a); ctx.lineTo(p[0], p[1]);
      ctx.closePath();
      ctx.fill();
      if (!isFar) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        p = hp(-36.2, 1.1, cb, sb, _a);
        ctx.beginPath(); ctx.arc(p[0], p[1], 1.25, 0, TAU); ctx.fill();
        // white trailing edge on the arm and a soft leading-edge highlight
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        p = hp(-21.5, 7.4, cb, sb, _a); ctx.moveTo(p[0], p[1]);
        ctx.quadraticCurveTo(-9, 9.4, 3, 3.8);
        ctx.stroke();
        ctx.strokeStyle = light;
        ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(2, -2.6); ctx.quadraticCurveTo(-6, -5.8, -16, -4.1); ctx.stroke();
        ctx.strokeStyle = 'rgba(40,50,60,0.18)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-9, 8.6); ctx.lineTo(-7, 3);
        ctx.moveTo(-15, 8.4); ctx.lineTo(-13, 2.6);
        p = hp(-26, 6.4, cb, sb, _a); ctx.moveTo(p[0], p[1]); p = hp(-24, 1, cb, sb, _a); ctx.lineTo(p[0], p[1]);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawGull(x, y, rot, wa, wb) {
      var dazed = phase === 'over' && cause !== 'sea';
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      wing(1.5, -7.5, wa * 0.9 + 0.12, wb, 0.95, GC.greyDk, GC.blackDk, GC.greyDk, true);
      // tail
      ctx.fillStyle = GC.white2;
      ctx.beginPath();
      ctx.moveTo(-12, -4.5); ctx.lineTo(-27, -7.2); ctx.quadraticCurveTo(-29.6, -2.2, -27, 2.6); ctx.lineTo(-12, 4.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = GC.greyLt;
      ctx.beginPath(); ctx.moveTo(-24, -6.6); ctx.lineTo(-27, -7.2); ctx.quadraticCurveTo(-29.6, -2.2, -27, 2.6); ctx.lineTo(-24.5, 2.2); ctx.closePath(); ctx.fill();
      // body
      var g = ctx.createLinearGradient(0, -11, 0, 11);
      g.addColorStop(0, GC.white);
      g.addColorStop(0.55, GC.white);
      g.addColorStop(1, GC.shade);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, 17.5, 10.5, -0.06, 0, TAU); ctx.fill();
      // grey mantle
      ctx.fillStyle = GC.grey;
      ctx.beginPath(); ctx.moveTo(-16, -2); ctx.quadraticCurveTo(-6, -12.6, 7, -9.2); ctx.quadraticCurveTo(-3, -5.4, -16, -2); ctx.fill();
      // warm rim light on the belly
      ctx.strokeStyle = css(PAL.rim, 0.55 * rimK);
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.ellipse(0, 0.4, 16.6, 9.8, -0.06, 0.35, 1.9); ctx.stroke();
      // head
      ctx.fillStyle = GC.white;
      ctx.beginPath(); ctx.arc(12.5, -6.5, 8.4, 0, TAU); ctx.fill();
      // beak: yellow with an orange lower mandible and a red spot
      ctx.fillStyle = GC.beak;
      ctx.beginPath();
      ctx.moveTo(19.2, -8.4); ctx.quadraticCurveTo(26, -8.6, 30.2, -5.6); ctx.quadraticCurveTo(30.8, -4.1, 29.1, -4.4); ctx.lineTo(19.8, -5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = GC.beakDk;
      ctx.beginPath();
      ctx.moveTo(19.8, -5); ctx.lineTo(27.8, -4.5); ctx.quadraticCurveTo(26.9, -2.7, 24.8, -2.9); ctx.lineTo(19.5, -3.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = GC.red;
      ctx.beginPath(); ctx.arc(26.5, -4.1, 1, 0, TAU); ctx.fill();
      // eye
      if (dazed && gull.floating) {
        ctx.strokeStyle = GC.eye;
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(14, -10); ctx.lineTo(17, -7.2);
        ctx.moveTo(17, -10); ctx.lineTo(14, -7.2);
        ctx.stroke();
      } else {
        ctx.fillStyle = GC.eye;
        ctx.beginPath(); ctx.arc(15.4, -8.6, 1.75, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(15.95, -9.15, 0.62, 0, TAU); ctx.fill();
      }
      wing(-2.5, -4.5, wa, wb, 1.1, GC.grey, GC.black, GC.greyLt, false);
      ctx.restore();
    }

    function drawDizzy(x, y) {
      var t = reduced ? 0 : realT * 3.2;
      ctx.fillStyle = '#ffe08a';
      for (var i = 0; i < 3; i++) {
        var a = t + i * TAU / 3;
        star(x + 12 + Math.cos(a) * 13, y - 20 + Math.sin(a) * 4, 2.6 + (Math.sin(a) + 1) * 0.6);
      }
    }
    function star(x, y, r) {
      ctx.beginPath();
      for (var i = 0; i < 10; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.45 : r;
        if (i) ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); else ctx.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
      }
      ctx.closePath();
      ctx.fill();
    }

    /* ---------- particles ---------- */
    function drawFeathers() {
      for (var i = 0; i < feathers.length; i++) {
        var f = feathers[i];
        ctx.save();
        ctx.globalAlpha = clamp(f.life * 1.6, 0, 1);
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot);
        ctx.scale(f.s, f.s);
        ctx.fillStyle = f.grey ? GC.greyLt : GC.white;
        ctx.beginPath();
        ctx.moveTo(-4.5, 0.2);
        ctx.bezierCurveTo(-3, -3.2, 2.5, -3, 5.5, -0.6);
        ctx.bezierCurveTo(2.5, 1.8, -2.5, 2.8, -4.5, 0.2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(150,160,170,0.45)';
        ctx.lineWidth = 0.45;
        ctx.beginPath(); ctx.moveTo(-6, 0.6); ctx.quadraticCurveTo(0, -0.2, 5, -0.6); ctx.stroke();
        ctx.restore();
      }
    }
    function drawDrops() {
      ctx.fillStyle = css(PAL.foam, 0.9);
      for (var i = 0; i < drops.length; i++) {
        var d = drops[i];
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
      }
    }
    function drawRipples() {
      for (var i = 0; i < ripples.length; i++) {
        var r = ripples[i];
        ctx.strokeStyle = css(PAL.foam, clamp(r.life, 0, 1) * 0.7);
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.ellipse(r.x, SEA_Y - 3, r.r, r.r * 0.22, 0, 0, TAU); ctx.stroke();
      }
    }
    function drawSparks() {
      ctx.fillStyle = '#ffe3a0';
      for (var i = 0; i < sparks.length; i++) {
        var s = sparks[i];
        ctx.globalAlpha = clamp(s.life * 1.5, 0, 1);
        star(s.x, s.y, s.s);
      }
      ctx.globalAlpha = 1;
    }
    function drawVignette() {
      var g = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.45, W / 2, H * 0.45, Math.max(W, H) * 0.85);
      g.addColorStop(0, 'rgba(12,28,33,0)');
      g.addColorStop(1, 'rgba(12,28,33,0.28)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    /* ---------- HUD and screens ---------- */
    function setSpacing(v) { if ('letterSpacing' in ctx) ctx.letterSpacing = v; }
    function text(str, x, y, font, fill, align, stroke, sw) {
      ctx.font = font;
      ctx.textAlign = align || 'center';
      ctx.textBaseline = 'middle';
      if (stroke) {
        ctx.lineJoin = 'round';
        ctx.strokeStyle = stroke;
        ctx.lineWidth = sw || 6;
        ctx.strokeText(str, x, y);
      }
      ctx.fillStyle = fill;
      ctx.fillText(str, x, y);
    }
    function pill(cx, cy, w, h, fill) {
      rr(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
      ctx.fillStyle = fill;
      ctx.fill();
    }

    function drawHUD() {
      ctx.globalAlpha = 1;
      if (phase === 'ready') drawReady();
      if (phase === 'playing' || phase === 'paused' || (phase === 'over' && overT < CARD_DELAY + 0.3)) {
        var a = phase === 'over' ? 1 - clamp((overT - CARD_DELAY) / 0.3, 0, 1) : 1;
        drawScore(a);
      }
      if (toast && phase === 'playing') drawToast();
      if (phase === 'paused') drawPaused();
      if (phase === 'over' && overT >= CARD_DELAY) drawCard(clamp((overT - CARD_DELAY) / 0.38, 0, 1));
    }

    function drawScore(a) {
      var p = popT > 0 ? Math.sin((1 - popT) * Math.PI) * (reduced ? 0.08 : 0.28) : 0;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(W / 2, 74);
      ctx.scale(1 + p, 1 + p);
      ctx.font = '600 64px ' + FD;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(12,28,33,0.28)';
      ctx.fillText(String(score), 0, 4);
      text(String(score), 0, 0, '600 64px ' + FD, css(CREAM), 'center', 'rgba(12,28,33,0.55)', 7);
      ctx.restore();
    }
    function drawToast() {
      var t = toast.t, a = t < 0.2 ? t / 0.2 : t > 1.4 ? 1 - (t - 1.4) / 0.5 : 1;
      var y = 128 + (reduced ? 0 : (1 - easeOut(Math.min(1, t / 0.3))) * 10);
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.font = '600 15px ' + FS;
      var w = ctx.measureText(toast.text).width + 52;
      pill(W / 2, y, w, 32, 'rgba(12,28,33,0.55)');
      drawMedal(W / 2 - w / 2 + 18, y, 9, toast.m, true);
      text(toast.text, W / 2 + 10, y + 1, '600 15px ' + FS, css(CREAM));
      ctx.restore();
    }

    function drawReady() {
      var shadow = 'rgba(12,28,33,0.35)';
      ctx.save();
      ctx.shadowColor = shadow;
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 3;
      text('Gaviota', W / 2, 132, '600 58px ' + FD, css(CREAM));
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 1;
      setSpacing('0.5px');
      text('Fly the gull between the pier pilings', W / 2, 178, '500 15px ' + FS, 'rgba(244,237,226,0.92)');
      setSpacing('0px');
      ctx.restore();
      var pulse = reduced ? 1 : 1 + Math.sin(realT * 3.2) * 0.035;
      var py = 368;
      ctx.save();
      ctx.translate(W / 2, py);
      ctx.scale(pulse, pulse);
      ctx.font = '600 18px ' + FS;
      var label = 'Tap to fly', tw = ctx.measureText(label).width;
      var pw = tw + 70;
      pill(0, 0, pw, 46, 'rgba(12,28,33,0.58)');
      ctx.strokeStyle = 'rgba(244,237,226,0.35)';
      ctx.lineWidth = 1;
      rr(ctx, -pw / 2 + 0.5, -22.5, pw - 1, 45, 22.5);
      ctx.stroke();
      // a little tap ripple icon
      var ix = -pw / 2 + 26, rp = reduced ? 0.5 : (realT * 0.9) % 1;
      ctx.fillStyle = css(ACCENT);
      ctx.beginPath(); ctx.arc(ix, 0, 5, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(229,140,99,' + (0.9 * (1 - rp)).toFixed(3) + ')';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(ix, 0, 6 + rp * 8, 0, TAU); ctx.stroke();
      text(label, 12, 1, '600 18px ' + FS, css(CREAM));
      ctx.restore();
      var sub = finePointer ? 'or press Space' : '';
      var y2 = py + 44;
      if (best > 0) { sub = (sub ? sub + '  ·  ' : '') + 'Best ' + best; }
      if (sub) {
        ctx.font = '500 13px ' + FS;
        pill(W / 2, y2, ctx.measureText(sub).width + 26, 26, 'rgba(12,28,33,0.4)');
        text(sub, W / 2, y2 + 0.5, '500 13px ' + FS, 'rgba(244,237,226,0.95)');
      }
    }

    function drawPaused() {
      ctx.fillStyle = 'rgba(12,28,33,0.45)';
      ctx.fillRect(0, 0, W, H);
      var cy = H * 0.42, pw = Math.min(W - 40, 280);
      ctx.save();
      ctx.shadowColor = 'rgba(12,28,33,0.4)';
      ctx.shadowBlur = 24;
      rr(ctx, W / 2 - pw / 2, cy - 70, pw, finePointer ? 150 : 128, 22);
      ctx.fillStyle = 'rgba(19,42,48,0.92)';
      ctx.fill();
      ctx.restore();
      text('Paused', W / 2, cy - 22, '600 42px ' + FD, css(CREAM));
      var pp = reduced ? 1 : 1 + 0.03 * Math.sin(realT * 3);
      ctx.save();
      ctx.translate(W / 2, cy + 28);
      ctx.scale(pp, pp);
      text('Tap to resume', 0, 0, '600 17px ' + FS, css(mixc(CREAM, ACCENT, 0.35)));
      ctx.restore();
      if (finePointer) text('Space, P or Esc also work', W / 2, cy + 58, '500 13px ' + FS, 'rgba(244,237,226,0.65)');
    }

    function drawCard(p) {
      var e = reduced ? 1 : easeOutBack(p), alpha = clamp(p * 1.6, 0, 1);
      var cw = 330, chh = 300, s = Math.min(1, (W - 28) / cw, (H - 40) / chh);
      ctx.save();
      ctx.globalAlpha = alpha * 0.35;
      ctx.fillStyle = css(NIGHT);
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = alpha;
      ctx.translate(W / 2, H * 0.43 + (reduced ? 0 : (1 - e) * 70));
      ctx.scale(s, s);
      // card
      ctx.save();
      ctx.shadowColor = 'rgba(12,28,33,0.45)';
      ctx.shadowBlur = 34;
      ctx.shadowOffsetY = 12;
      rr(ctx, -cw / 2, -chh / 2, cw, chh, 24);
      ctx.fillStyle = css(CREAM);
      ctx.fill();
      ctx.restore();
      // sunset band across the top of the card
      ctx.save();
      rr(ctx, -cw / 2, -chh / 2, cw, chh, 24);
      ctx.clip();
      var bg = ctx.createLinearGradient(-cw / 2, 0, cw / 2, 0);
      bg.addColorStop(0, '#f2c3a1');
      bg.addColorStop(1, '#e58c63');
      ctx.fillStyle = bg;
      ctx.fillRect(-cw / 2, -chh / 2, cw, 6);
      ctx.restore();
      var title = cause === 'sea' ? 'Splash!' : cause === 'sky' ? 'Too high!' : 'Bonk!';
      var subtitle = cause === 'sea' ? 'Into the waves you go.' : cause === 'sky' ? 'The sky has a ceiling here.' : 'That piling came out of nowhere.';
      text(title, 0, -chh / 2 + 48, '600 34px ' + FD, css(NIGHT));
      text(subtitle, 0, -chh / 2 + 80, '500 13px ' + FS, 'rgba(12,28,33,0.6)');
      ctx.fillStyle = 'rgba(12,28,33,0.1)';
      ctx.fillRect(-cw / 2 + 24, -chh / 2 + 102, cw - 48, 1);
      // medal
      var m = medalFor(score), mx = -78, my = 14;
      if (m) {
        drawMedal(mx, my, 34, m, false);
        setSpacing('1.5px');
        text(m.name.toUpperCase(), mx, my + 60, '600 11px ' + FS, 'rgba(12,28,33,0.7)');
        setSpacing('0px');
      } else {
        ctx.strokeStyle = 'rgba(12,28,33,0.22)';
        ctx.lineWidth = 2;
        if (ctx.setLineDash) ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.arc(mx, my, 32, 0, TAU); ctx.stroke();
        if (ctx.setLineDash) ctx.setLineDash([]);
        var nm = nextMedal(score);
        text(String(nm.at), mx, my, '600 24px ' + FD, 'rgba(12,28,33,0.35)');
        text(nm.name + ' at ' + nm.at, mx, my + 56, '500 12px ' + FS, 'rgba(12,28,33,0.55)');
      }
      // numbers
      var nx = 62;
      setSpacing('1.5px');
      text('SCORE', nx, -26, '600 11px ' + FS, 'rgba(12,28,33,0.55)');
      setSpacing('0px');
      text(String(score), nx, 8, '600 46px ' + FD, css(NIGHT));
      setSpacing('1.5px');
      text('BEST', nx, 46, '600 11px ' + FS, 'rgba(12,28,33,0.55)');
      setSpacing('0px');
      text(String(best), nx, 70, '600 26px ' + FD, css(NIGHT));
      if (newBest && score > 0) {
        ctx.save();
        ctx.translate(cw / 2 - 52, -chh / 2 + 22);
        ctx.rotate(0.12);
        ctx.font = '600 12px ' + FS;
        var nbw = ctx.measureText('New best!').width + 22;
        pill(0, 0, nbw, 24, css(ACCENT));
        text('New best!', 0, 0.5, '600 12px ' + FS, '#fff');
        ctx.restore();
      }
      // call to action
      var ready = overT >= COOLDOWN;
      var cp = ready && !reduced ? 1 + 0.035 * Math.sin(realT * 3.4) : 1;
      ctx.globalAlpha = alpha * (ready ? 1 : 0.35);
      ctx.translate(0, chh / 2 - 36);
      ctx.scale(cp, cp);
      pill(0, 0, 190, 40, css(SEA));
      text('Tap to fly again', 0, 1, '600 15px ' + FS, css(CREAM));
      ctx.restore();
    }

    function drawMedal(x, y, r, m, small) {
      ctx.save();
      ctx.translate(x, y);
      if (!small) {
        // ribbon tails
        ctx.fillStyle = css(ACCENT);
        ctx.beginPath(); ctx.moveTo(-r * 0.55, r * 0.3); ctx.lineTo(-r * 0.95, r * 1.45); ctx.lineTo(-r * 0.62, r * 1.25); ctx.lineTo(-r * 0.4, r * 1.55); ctx.lineTo(-r * 0.05, r * 0.5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = css(SEA);
        ctx.beginPath(); ctx.moveTo(r * 0.55, r * 0.3); ctx.lineTo(r * 0.95, r * 1.45); ctx.lineTo(r * 0.62, r * 1.25); ctx.lineTo(r * 0.4, r * 1.55); ctx.lineTo(r * 0.05, r * 0.5); ctx.closePath(); ctx.fill();
      }
      // scalloped rim
      ctx.fillStyle = m.edge;
      ctx.beginPath();
      var n = 28, i;
      for (i = 0; i <= n * 2; i++) {
        var a = i * Math.PI / n, rad = i % 2 ? r * 0.94 : r;
        if (i) ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); else ctx.moveTo(rad, 0);
      }
      ctx.fill();
      var g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
      g.addColorStop(0, m.c[0]);
      g.addColorStop(0.55, m.c[1]);
      g.addColorStop(1, m.c[2]);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.86, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(0.8, r * 0.05);
      ctx.beginPath(); ctx.arc(0, 0, r * 0.68, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.64, 0, TAU); ctx.stroke();
      if (m.name === 'Legend') {
        // laurel and a golden star
        ctx.fillStyle = css(GOLD);
        for (var side = -1; side <= 1; side += 2) {
          for (i = 0; i < 5; i++) {
            var la = Math.PI / 2 + side * (0.5 + i * 0.42);
            ctx.save();
            ctx.translate(Math.cos(la) * r * 0.5, Math.sin(la) * r * 0.5);
            ctx.rotate(la + side * 0.9);
            ctx.beginPath(); ctx.ellipse(0, 0, r * 0.13, r * 0.055, 0, 0, TAU); ctx.fill();
            ctx.restore();
          }
        }
        ctx.fillStyle = '#ffe9a8';
        star(0, -r * 0.04, r * 0.36);
      } else {
        // a little gull in flight
        ctx.strokeStyle = 'rgba(40,25,10,0.45)';
        ctx.lineWidth = Math.max(1, r * 0.09);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        var s = r * 0.36;
        ctx.beginPath();
        ctx.moveTo(-s, -s * 0.2);
        ctx.quadraticCurveTo(-s * 0.45, -s * 0.75, 0, s * 0.15);
        ctx.quadraticCurveTo(s * 0.45, -s * 0.75, s, -s * 0.2);
        ctx.stroke();
      }
      // shine
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = Math.max(1, r * 0.07);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.76, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke();
      ctx.restore();
    }

    /* ---------- API ---------- */
    function pause() {
      if (destroyed || phase !== 'playing') return;
      phase = 'paused';
    }
    function resume() {
      if (destroyed || phase !== 'paused') return;
      phase = 'playing';
      gull.vy = Math.min(gull.vy, 0);   // a little mercy after a break
      lastTs = 0;
    }
    // API calls made from the integrator's own buttons can unlock audio too, when inside a user gesture.
    function gestureAudio() {
      var ua = win.navigator && win.navigator.userActivation;
      if (!ua || ua.isActive) unlockAudio();
    }
    function start() {
      if (destroyed || phase === 'playing') return;
      gestureAudio();
      startRun();
    }
    function apiFlap() {
      if (destroyed) return;
      gestureAudio();
      tap();
    }
    function setSound(on) {
      soundOn = !!on;
      if (soundOn) unlockAudio();
    }
    function state() {
      return { phase: phase, score: score, best: best, y: gull.y, vy: gull.vy };
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      win.cancelAnimationFrame(rafId);
      if (ro) ro.disconnect(); else win.removeEventListener('resize', onWinResize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('visibilitychange', onVis);
      clearTimeout(liveTimer);
      if (actx) {
        try { var pc = actx.close(); if (pc && pc.catch) pc.catch(function () { /* ignore */ }); } catch (e) { /* ignore */ }
        actx = null;
      }
      if (bg) { bg.width = bg.height = 0; bg = bgCtx = null; }
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (live.parentNode) live.parentNode.removeChild(live);
      if (hadTab) host.setAttribute('tabindex', oldTab); else host.removeAttribute('tabindex');
      feathers.length = drops.length = ripples.length = sparks.length = obstacles.length = 0;
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('keydown', onKeyDown);
    doc.addEventListener('visibilitychange', onVis);
    if (ro) ro.observe(host);
    resize(host.clientWidth, host.clientHeight);
    rafId = win.requestAnimationFrame(frame);

    return { start: start, flap: apiFlap, pause: pause, resume: resume, destroy: destroy, setSound: setSound, state: state };
  }

  window.AgrazGames = window.AgrazGames || {};
  window.AgrazGames.gull = { id: 'gull', title: 'Gaviota', mount: mount };
})();
