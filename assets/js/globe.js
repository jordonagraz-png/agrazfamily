/* ==========================================================================
   Agraz Family Globe — a dotted Earth with live daylight, drawn on a canvas.
   No libraries. Land dots come from /assets/data/land.bin, built from
   Natural Earth (public domain) by tools/make-land-mask.mjs. The sun's
   position is computed from the clock, so day and night are real.
   Loaded on demand by portal.js; exposes window.AgrazGlobe.
   ========================================================================== */
(function () {
  'use strict';

  const RAD = Math.PI / 180;
  const EARTH_KM = 6371;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrap = d => ((d + 540) % 360) - 180;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Unit vector for a latitude/longitude: y is north, z faces lng 0 on the equator.
  function vec(lat, lng) {
    const p = lat * RAD, l = lng * RAD, c = Math.cos(p);
    return [c * Math.sin(l), Math.sin(p), c * Math.cos(l)];
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // Where the sun is directly overhead at `date` (low-precision solar ephemeris, ~0.1°).
  function subsolar(date) {
    const d = date.getTime() / 864e5 - 10957.5; // days since 2000-01-01 12:00 UTC
    const g = (357.529 + 0.98560028 * d) * RAD;
    const q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
    const e = (23.439 - 0.00000036 * d) * RAD;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
    const dec = Math.asin(Math.sin(e) * Math.sin(L)) / RAD;
    const gmst = 280.46061837 + 360.98564736629 * d;
    return { lat: dec, lng: wrap(((ra - gmst) % 360 + 360) % 360) };
  }
  // The sun's height above the horizon at a place, in degrees (negative = below).
  function sunAltitude(lat, lng, date) {
    const s = subsolar(date || new Date());
    return Math.asin(clamp(dot(vec(lat, lng), vec(s.lat, s.lng)), -1, 1)) / RAD;
  }
  // Great-circle distance in km.
  function distanceKm(a, b) {
    return Math.acos(clamp(dot(vec(a.lat, a.lng), vec(b.lat, b.lng)), -1, 1)) * EARTH_KM;
  }

  // Land mask: rows of evenly spaced dots (fewer toward the poles), one bit each.
  function decodeLand(buf) {
    const b = new Uint8Array(buf);
    if (b[0] !== 0x4c || b[1] !== 0x44) throw new Error('Unexpected land data');
    const step = (b[2] | (b[3] << 8)) / 100;
    const rows = Math.round(180 / step);
    const out = [];
    let k = 0;
    for (let i = 0; i < rows; i++) {
      const lat = 90 - step * (i + 0.5);
      const n = Math.max(1, Math.round((360 / step) * Math.cos(lat * RAD)));
      for (let j = 0; j < n; j++, k++) {
        if ((b[4 + (k >> 3)] >> (k & 7)) & 1) out.push.apply(out, vec(lat, -180 + (j + 0.5) * 360 / n));
      }
    }
    return new Float32Array(out);
  }
  let landPromise = null;
  function loadLand() {
    if (!landPromise) {
      landPromise = fetch('/assets/data/land.bin')
        .then(r => { if (!r.ok) throw new Error('land ' + r.status); return r.arrayBuffer(); })
        .then(decodeLand)
        .catch(e => { landPromise = null; throw e; });
    }
    return landPromise;
  }

  // Ocean colours (RGB): night, deep day, sunlit day, twilight tint, atmosphere rim.
  const NIGHT = [4, 11, 16], DEEP = [11, 42, 56], LIT = [24, 80, 96], DUSK = [150, 82, 58], RIM = [96, 176, 172];
  const SHADE = 160; // resolution of the ocean shading texture

  function create(stage, opts) {
    opts = opts || {};
    const canvas = stage.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const pinLayer = opts.pinLayer;
    const land = opts.land;
    const shade = document.createElement('canvas');
    shade.width = shade.height = SHADE;
    const sctx = shade.getContext('2d');
    const img = sctx.createImageData(SHADE, SHADE);

    const view = { lng: opts.lng == null ? -60 : opts.lng, lat: opts.lat == null ? 22 : opts.lat };
    let W = 0, H = 0, dpr = 1, R = 0, cx = 0, cy = 0;
    let looping = false, raf = 0, last = 0, clock = 0, running = false, drawQueued = false;
    let spin = !REDUCED, idleUntil = 0, vel = 0, drag = null, anim = null;
    let time = null; // null = live
    let people = [], clusters = [], meId = null, picking = false, draft = null, active = new Set();
    const pinEls = new Map();
    const stars = Array.from({ length: 150 }, () => [Math.random(), Math.random(), 0.25 + Math.random() * 0.75, Math.random() * 6.3]);

    // ---- projection (view centred on view.lng / view.lat) ----
    let cl = 1, sl = 0, cp = 1, sp = 0;
    function setRot() {
      cl = Math.cos(view.lng * RAD); sl = Math.sin(view.lng * RAD);
      cp = Math.cos(view.lat * RAD); sp = Math.sin(view.lat * RAD);
    }
    function rot(x, y, z, out) {
      const x1 = x * cl - z * sl, z1 = x * sl + z * cl;
      out[0] = x1; out[1] = y * cp - z1 * sp; out[2] = y * sp + z1 * cp;
      return out;
    }
    const tmp = [0, 0, 0];
    function toLatLng(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const x = (clientX - r.left - cx) / R, y = -(clientY - r.top - cy) / R;
      const d = x * x + y * y;
      if (d > 1) return null;
      const z = Math.sqrt(1 - d);
      const yw = y * cp + z * sp, z1 = -y * sp + z * cp;
      const xw = x * cl + z1 * sl, zw = -x * sl + z1 * cl;
      return { lat: Math.asin(clamp(yw, -1, 1)) / RAD, lng: Math.atan2(xw, zw) / RAD };
    }

    // ---- people → clusters (people closer than ~26px on screen share a pin) ----
    function recluster() {
      const limit = (26 / Math.max(R, 1)) * EARTH_KM;
      clusters = [];
      const placed = people.filter(p => p.lat != null && p.lng != null);
      placed.sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0));
      placed.forEach(p => {
        const c = clusters.find(k => distanceKm(k.people[0], p) < limit);
        if (c) c.people.push(p); else clusters.push({ people: [p] });
      });
      clusters.forEach(c => {
        const s = c.people.reduce((acc, p) => { const v = vec(p.lat, p.lng); return [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]]; }, [0, 0, 0]);
        const n = Math.hypot(s[0], s[1], s[2]) || 1;
        c.v = [s[0] / n, s[1] / n, s[2] / n];
        c.id = c.people.map(p => p.id).join(',');
        c.me = c.people.some(p => p.id === meId);
      });
      if (!pinLayer) return;
      const keep = new Set(clusters.map(c => c.id));
      pinEls.forEach((el, id) => { if (!keep.has(id)) { el.remove(); pinEls.delete(id); } });
      clusters.forEach(c => {
        let el = pinEls.get(c.id);
        if (!el) {
          el = document.createElement('button');
          el.type = 'button';
          el.className = 'gpin';
          el.dataset.action = 'globe-pin';
          el.dataset.ids = c.id;
          pinLayer.appendChild(el);
          pinEls.set(c.id, el);
        }
        el.classList.toggle('is-me', c.me);
        el.innerHTML = opts.pinHTML ? opts.pinHTML(c.people, time || new Date()) : '';
      });
      paintActive();
      measure();
    }
    function refreshLabels() {
      if (!opts.pinHTML) return;
      clusters.forEach(c => { const el = pinEls.get(c.id); if (el) el.innerHTML = opts.pinHTML(c.people, time || new Date()); });
      measure();
    }
    function measure() {
      clusters.forEach(c => { const el = pinEls.get(c.id), lab = el && el.querySelector('.gpin-label'); c.lw = lab ? lab.offsetWidth : 0; });
    }
    function paintActive() {
      clusters.forEach(c => { c.active = c.people.some(p => active.has(p.id)); const el = pinEls.get(c.id); if (el) el.classList.toggle('is-active', c.active); });
    }

    // Labels sit right of their pin, or left, wherever they don't cover another pin or label;
    // if neither fits, the label waits for hover or focus. You and the selected pin go first.
    function layoutLabels(vis) {
      const faces = vis.map(p => ({ x0: p.x - 18, x1: p.x + 18 + (p.n - 1) * 18, y0: p.y - 18, y1: p.y + 18 }));
      const taken = [];
      const clear = r => r.x0 >= 6 && r.x1 <= W - 6 && r.y0 >= 52 && r.y1 <= H - 6 &&
        !faces.some(b => r.x0 < b.x1 && r.x1 > b.x0 && r.y0 < b.y1 && r.y1 > b.y0) &&
        !taken.some(b => r.x0 < b.x1 && r.x1 > b.x0 && r.y0 < b.y1 && r.y1 > b.y0);
      const rank = p => (p.c.active ? 1000 : 0) + (p.c.me ? 500 : 0) + p.z * 100;
      vis.slice().sort((a, b) => rank(b) - rank(a)).forEach(p => {
        if (!p.c.lw) p.c.lw = (p.el.querySelector('.gpin-label') || {}).offsetWidth || 0;
        const w = p.c.lw + 4, off = 24 + (p.n - 1) * 18;
        const mid = p.x + (p.n - 1) * 9;
        const spots = [
          ['right', { x0: p.x + off - 2, x1: p.x + off + w, y0: p.y - 19, y1: p.y + 19 }],
          ['flip', { x0: p.x - 26 - w, x1: p.x - 22, y0: p.y - 19, y1: p.y + 19 }],
          ['above', { x0: mid - w / 2, x1: mid + w / 2, y0: p.y - 62, y1: p.y - 20 }],
          ['below', { x0: mid - w / 2, x1: mid + w / 2, y0: p.y + 20, y1: p.y + 62 }]
        ];
        const spot = spots.find(sp => clear(sp[1]));
        ['flip', 'above', 'below'].forEach(k => p.el.classList.toggle(k, !!spot && spot[0] === k));
        p.el.classList.toggle('no-label', !spot);
        if (spot) taken.push(spot[1]);
      });
    }

    // ---- sizing ----
    function resize() {
      const r = stage.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      R = Math.min(W, H) * (W < 560 ? 0.43 : 0.41);
      cx = W / 2; cy = H / 2;
      recluster();
      draw();
    }
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(stage); else window.addEventListener('resize', resize);

    // ---- drawing ----
    function oceanTexture(sun) {
      const d = img.data, h = [sun[0], sun[1], sun[2] + 1];
      const hn = Math.hypot(h[0], h[1], h[2]) || 1;
      h[0] /= hn; h[1] /= hn; h[2] /= hn;
      for (let j = 0; j < SHADE; j++) {
        const y = 1 - (2 * j + 1) / SHADE;
        for (let i = 0; i < SHADE; i++) {
          const x = (2 * i + 1) / SHADE - 1, k = (j * SHADE + i) * 4, q = x * x + y * y;
          if (q > 1.02) { d[k + 3] = 0; continue; }
          const z = Math.sqrt(Math.max(0, 1 - q));
          const s = x * sun[0] + y * sun[1] + z * sun[2];
          const day = smooth(-0.14, 0.2, s), lit = Math.max(0, s);
          const dusk = Math.exp(-(s / 0.08) * (s / 0.08)) * 0.24;
          const limb = 0.5 + 0.5 * z;
          const rim = Math.pow(1 - z, 3) * (0.06 + 0.94 * day) * 0.7;
          const spec = Math.pow(Math.max(0, x * h[0] + y * h[1] + z * h[2]), 140) * 0.32 * day;
          for (let c = 0; c < 3; c++) {
            const dayC = DEEP[c] + (LIT[c] - DEEP[c]) * lit;
            let v = (NIGHT[c] + (dayC - NIGHT[c]) * day) * limb;
            v += DUSK[c] * dusk * (1 - day * 0.6) * 0.5 + RIM[c] * rim + 255 * spec;
            d[k + c] = v > 255 ? 255 : v;
          }
          d[k + 3] = 255;
        }
      }
      sctx.putImageData(img, 0, 0);
    }

    function draw() {
      drawQueued = false;
      if (!W) return;
      setRot();
      const now = time || new Date();
      const sp0 = subsolar(now), sunW = vec(sp0.lat, sp0.lng);
      const sunV = rot(sunW[0], sunW[1], sunW[2], [0, 0, 0]);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // stars
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const a = REDUCED ? s[2] * 0.6 : s[2] * (0.35 + 0.65 * Math.abs(Math.sin(s[3] + clock * 0.0007 * (0.5 + s[2]))));
        ctx.fillStyle = `rgba(232,240,255,${(a * 0.8).toFixed(3)})`;
        ctx.fillRect(s[0] * W, s[1] * H, s[2] > 0.85 ? 1.6 : 1.1, s[2] > 0.85 ? 1.6 : 1.1);
      }

      // atmosphere glow
      const glow = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.22);
      glow.addColorStop(0, 'rgba(120,200,190,0.30)');
      glow.addColorStop(0.35, 'rgba(90,160,170,0.10)');
      glow.addColorStop(1, 'rgba(60,120,140,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, 6.2832); ctx.fill();

      // ocean
      oceanTexture(sunV);
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(shade, cx - R, cy - R, R * 2, R * 2);
      ctx.restore();

      // land dots, bucketed by brightness so each colour is one fill
      if (land) {
        const BUCKETS = 10, paths = [];
        for (let b = 0; b < BUCKETS * 2; b++) paths.push(new Path2D());
        const base = Math.max(0.55, R / 290) * 1.05;
        for (let i = 0; i < land.length; i += 3) {
          const x = land[i], y = land[i + 1], z = land[i + 2];
          rot(x, y, z, tmp);
          if (tmp[2] <= 0.02) continue;
          const s = x * sunW[0] + y * sunW[1] + z * sunW[2];
          const day = smooth(-0.1, 0.12, s);
          const depth = 0.35 + 0.65 * tmp[2];
          const lvl = Math.min(BUCKETS - 1, Math.floor(depth * (0.45 + 0.55 * Math.max(day, 0)) * BUCKETS));
          const p = paths[(day > 0.5 ? BUCKETS : 0) + lvl];
          const px = cx + tmp[0] * R, py = cy - tmp[1] * R, r = base * (0.6 + 0.4 * tmp[2]);
          p.moveTo(px + r, py); p.arc(px, py, r, 0, 6.2832);
        }
        for (let b = 0; b < BUCKETS; b++) {
          const t = (b + 1) / BUCKETS;
          ctx.fillStyle = `rgba(120,165,180,${(0.18 + 0.42 * t).toFixed(3)})`; // night land
          ctx.fill(paths[b]);
          ctx.fillStyle = `rgba(250,236,206,${(0.28 + 0.72 * t).toFixed(3)})`; // daylight land
          ctx.fill(paths[BUCKETS + b]);
        }
      }

      // arcs from me to everyone else
      const mine = clusters.find(c => c.me);
      if (mine && clusters.length > 1) {
        ctx.save();
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        ctx.setLineDash([3, 6]);
        ctx.lineDashOffset = REDUCED ? 0 : -clock * 0.02;
        clusters.forEach(c => {
          if (c === mine) return;
          const a = mine.v, b = c.v, om = Math.acos(clamp(dot(a, b), -1, 1));
          if (om < 1e-3) return;
          const lift = 0.06 + 0.22 * (om / Math.PI), so = Math.sin(om);
          ctx.beginPath();
          let pen = false;
          for (let k = 0; k <= 48; k++) {
            const t = k / 48, wa = Math.sin((1 - t) * om) / so, wb = Math.sin(t * om) / so, up = 1 + lift * Math.sin(Math.PI * t);
            rot((a[0] * wa + b[0] * wb) * up, (a[1] * wa + b[1] * wb) * up, (a[2] * wa + b[2] * wb) * up, tmp);
            const vis = tmp[2] > 0 || tmp[0] * tmp[0] + tmp[1] * tmp[1] > 1;
            const px = cx + tmp[0] * R, py = cy - tmp[1] * R;
            if (vis) { if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; } } else pen = false;
          }
          ctx.strokeStyle = 'rgba(242,196,120,0.85)';
          ctx.stroke();
        });
        ctx.restore();
      }

      // the spot being picked
      if (draft) {
        const v = vec(draft.lat, draft.lng);
        rot(v[0], v[1], v[2], tmp);
        if (tmp[2] > 0) {
          const px = cx + tmp[0] * R, py = cy - tmp[1] * R, pulse = REDUCED ? 0.5 : (clock % 1600) / 1600;
          ctx.beginPath(); ctx.arc(px, py, 6 + 18 * pulse, 0, 6.2832);
          ctx.strokeStyle = `rgba(242,196,120,${(0.9 * (1 - pulse)).toFixed(3)})`; ctx.lineWidth = 2; ctx.stroke();
          ctx.beginPath(); ctx.arc(px, py, 6, 0, 6.2832); ctx.fillStyle = '#f2c478'; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = '#0c1c21'; ctx.stroke();
        }
      }

      // HTML pins follow the globe
      const vis = [];
      clusters.forEach(c => {
        const el = pinEls.get(c.id);
        if (!el) return;
        rot(c.v[0], c.v[1], c.v[2], tmp);
        const px = cx + tmp[0] * R, py = cy - tmp[1] * R, front = tmp[2] > 0.08;
        el.style.transform = `translate3d(${px.toFixed(1)}px,${py.toFixed(1)}px,0)`;
        el.style.zIndex = String(Math.round(10 + tmp[2] * 100 + (c.active ? 200 : 0)));
        el.classList.toggle('is-back', !front);
        el.tabIndex = front ? 0 : -1;
        if (front) vis.push({ c, el, x: px, y: py, z: tmp[2], n: Math.min(c.people.length, 3) });
      });
      layoutLabels(vis);
    }

    function frame(ts) {
      raf = 0;
      const dt = last ? Math.min(64, ts - last) : 16;
      last = ts;
      clock += dt;
      let moving = false;
      if (anim) {
        const t = clamp((ts - anim.t0) / anim.ms, 0, 1), e = ease(t);
        view.lng = wrap(anim.from.lng + anim.dl * e);
        view.lat = anim.from.lat + (anim.to.lat - anim.from.lat) * e;
        if (t >= 1) anim = null;
        moving = true;
      } else if (!drag && Math.abs(vel) > 0.002) {
        view.lng = wrap(view.lng - vel * dt);
        vel *= Math.pow(0.94, dt / 16);
        moving = true;
      } else if (!drag && spin && performance.now() > idleUntil) {
        view.lng = wrap(view.lng - 0.0035 * dt);
        moving = true;
      }
      draw();
      if (running && (moving || drag || !REDUCED)) raf = requestAnimationFrame(frame);
      else { looping = false; last = 0; }
    }
    function loop() {
      if (!running) return;
      if (!raf) { looping = true; raf = requestAnimationFrame(frame); }
    }
    function requestDraw() {
      if (looping || drawQueued) return;
      drawQueued = true;
      requestAnimationFrame(draw);
    }
    function poke(ms) { idleUntil = performance.now() + (ms || 7000); }

    // ---- input ----
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false };
      anim = null; vel = 0; poke();
      canvas.setPointerCapture(e.pointerId);
      loop();
    });
    canvas.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, now = performance.now();
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 5) drag.moved = true;
      const k = 1 / (R * RAD);
      view.lng = wrap(view.lng - dx * k);
      view.lat = clamp(view.lat + dy * k, -70, 70);
      vel = (dx * k) / Math.max(1, now - drag.t);
      drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
      poke();
      requestDraw();
    });
    const endDrag = e => {
      if (!drag) return;
      const wasClick = !drag.moved;
      if (wasClick) vel = 0;
      drag = null;
      poke();
      if (wasClick && picking && e.type === 'pointerup') {
        const ll = toLatLng(e.clientX, e.clientY);
        if (ll) { draft = ll; if (opts.onPick) opts.onPick(ll); }
      }
      loop();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('keydown', e => {
      const k = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[e.key];
      if (!k) return;
      e.preventDefault();
      api.focus(clamp(view.lat + k[1], -70, 70), view.lng + k[0], 350);
    });

    const onVis = () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; looping = false; } else loop(); };
    document.addEventListener('visibilitychange', onVis);
    const ticker = setInterval(() => { if (running && !time) { refreshLabels(); requestDraw(); } }, 30e3);

    const api = {
      setPeople(list, me) { people = list || []; meId = me || null; recluster(); requestDraw(); },
      setTime(date) { time = date || null; refreshLabels(); requestDraw(); },
      setActive(ids) { active = new Set(ids || []); paintActive(); requestDraw(); },
      focus(lat, lng, ms) {
        poke(9000);
        vel = 0;
        const to = { lat: clamp(lat, -70, 70), lng: wrap(lng) };
        if (REDUCED || ms === 0) { view.lat = to.lat; view.lng = to.lng; requestDraw(); return; }
        anim = { from: { lat: view.lat, lng: view.lng }, to, dl: wrap(to.lng - view.lng), t0: performance.now(), ms: ms || 1100 };
        loop();
      },
      setPicking(on) { picking = !!on; canvas.classList.toggle('picking', picking); if (!on) draft = null; requestDraw(); },
      setDraft(ll) { draft = ll; requestDraw(); },
      setSpin(on) { spin = !!on && !REDUCED; if (spin) { idleUntil = 0; loop(); } },
      get spinning() { return spin; },
      start() { if (running) return; running = true; resize(); loop(); },
      stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; looping = false; },
      destroy() {
        api.stop();
        clearInterval(ticker);
        document.removeEventListener('visibilitychange', onVis);
        if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
        pinEls.forEach(el => el.remove()); pinEls.clear();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      },
      toLatLng
    };
    resize();
    return api;
  }

  window.AgrazGlobe = { create, loadLand, subsolar, sunAltitude, distanceKm };
})();
