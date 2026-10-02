/* ==========================================================================
   Agraz Family Hub — the living welcome photo
   Turns the welcome photo into a cinemagraph on a canvas: the sea below the
   horizon rolls, sunlight glitters on the water, stars twinkle and the sun's
   glow breathes. The photo itself is untouched and the page's CSS background
   stays underneath, so if anything here can't run, the still photo remains.
   Loaded on demand by portal.js (never with reduced motion); exposes
   window.AgrazLive.
   ========================================================================== */
(function () {
  'use strict';

  // A soft point of light with a faint four-pointed glint, drawn once and reused.
  function sparkSprite() {
    const c = document.createElement('canvas'), n = 64, g = c.getContext('2d');
    c.width = c.height = n;
    const rg = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.18, 'rgba(255,246,224,.85)');
    rg.addColorStop(0.45, 'rgba(255,226,180,.18)');
    rg.addColorStop(1, 'rgba(255,226,180,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, n, n);
    g.strokeStyle = 'rgba(255,250,236,.55)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(n / 2, 2); g.lineTo(n / 2, n - 2);
    g.moveTo(2, n / 2); g.lineTo(n - 2, n / 2);
    g.stroke();
    return c;
  }
  function glowSprite(rgb) {
    const c = document.createElement('canvas'), n = 256, g = c.getContext('2d');
    c.width = c.height = n;
    const rg = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    rg.addColorStop(0, `rgba(${rgb},.9)`);
    rg.addColorStop(0.25, `rgba(${rgb},.35)`);
    rg.addColorStop(0.6, `rgba(${rgb},.08)`);
    rg.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = rg;
    g.fillRect(0, 0, n, n);
    return c;
  }
  // Long, faint rays fanning out from the sun.
  function raySprite() {
    const c = document.createElement('canvas'), n = 512, g = c.getContext('2d');
    c.width = c.height = n;
    g.translate(n / 2, n / 2);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + (i % 3) * 0.07, w = 0.035 + (i % 4) * 0.018;
      const lg = g.createLinearGradient(0, 0, Math.cos(a) * n / 2, Math.sin(a) * n / 2);
      lg.addColorStop(0, 'rgba(255,236,200,.5)');
      lg.addColorStop(1, 'rgba(255,236,200,0)');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, n / 2, a - w, a + w);
      g.closePath();
      g.fill();
    }
    return c;
  }

  /* ---------- the GPU version: every point of water moves on its own ---------- */
  const VERT = 'attribute vec2 p;varying vec2 v;void main(){v=vec2((p.x+1.)*.5,(1.-p.y)*.5);gl_Position=vec4(p,0.,1.);}';
  const FRAG = `precision mediump float;
uniform sampler2D img;uniform vec2 res;uniform float t,hy,se,calm,glit,stars,dpr;uniform vec3 sun;varying vec2 v;
float lum(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
float hash(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5453);}
void main(){
  vec2 uv=v;float y=uv.y*res.y;
  float below=step(hy,y);
  float d=clamp((y-hy)/max(1.,se-hy),0.,1.);
  float fade=y>se?max(0.,1.-(y-se)/(36.*dpr)):1.;
  float amp=(.25+5.2*pow(d,1.4))*fade*calm*below*dpr;
  float z=log(d+.035)*10.5;
  float x=uv.x*res.x/res.y;
  float w1=sin(z-t*1.1+sin(x*2.6+t*.35)*.9);
  float w2=sin(z*2.2+x*8./(.32+d)-t*1.8);
  float w3=sin(x*21./(.25+d)+z*3.6+t*2.4+w1);
  vec2 off=vec2(w1*.55+w2*.3+w3*.15,(w2*.5+w3*.5)*.3)*amp/res;
  vec4 c=texture2D(img,uv+off);
  float L=lum(c.rgb);
  // glitter: brief, tiny flashes on the brightest water, riding the waves
  vec2 cs=vec2(6.*dpr);
  vec2 cell=floor((uv+off*1.5)*res/cs);
  vec2 f=fract((uv+off*1.5)*res/cs)-.5;
  float h=hash(cell);
  float flash=pow(max(0.,sin(t*(1.6+h*2.4)+h*80.)),36.);
  float g=flash*smoothstep(.5,.05,length(f))*smoothstep(.74,.97,L)*step(.6,h)*below*fade*glit;
  c.rgb+=vec3(1.,.96,.88)*g*1.4;
  // stars: tiny points much brighter than their surroundings, twinkling at their own pace
  if(stars>0.&&below<.5){
    vec2 px=1./res*2.*dpr;
    float a=(lum(texture2D(img,uv+vec2(px.x,0.)).rgb)+lum(texture2D(img,uv-vec2(px.x,0.)).rgb)+lum(texture2D(img,uv+vec2(0.,px.y)).rgb)+lum(texture2D(img,uv-vec2(0.,px.y)).rgb))*.25;
    float star=smoothstep(.12,.3,L-a);
    float tw=sin(t*(1.2+hash(floor(uv*res/(3.*dpr)))*2.6)+hash(floor(uv*res/(3.*dpr))+7.)*6.28);
    c.rgb+=c.rgb*star*max(0.,tw)*1.1*stars;
  }
  // the sun's glow breathes and its rays turn very slowly
  if(sun.z>0.){
    vec2 q=(uv*res-sun.xy)/res.y;float r=length(q);
    float glow=exp(-r*r/(sun.z*sun.z*.09))*(.16+.06*sin(t*.6));
    float ang=atan(q.y,q.x);
    float rays=pow(abs(sin(ang*9.+t*.02)),10.)*.6+pow(abs(sin(ang*5.-t*.015+1.3)),14.)*.4;
    rays*=exp(-r/(sun.z*.9))*(.07+.03*sin(t*.35+1.))*smoothstep(0.,.02,r);
    c.rgb+=vec3(1.,.86,.66)*(glow+rays*(1.-below*.6));
  }
  gl_FragColor=vec4(c.rgb,1.);
}`;
  function gpu(cv) {
    const gl = cv.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); return gl.getShaderParameter(x, gl.COMPILE_STATUS) ? x : null; };
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]].forEach(([k, val]) => gl.texParameteri(gl.TEXTURE_2D, k, val));
    const U = {};
    ['img', 'res', 't', 'hy', 'se', 'calm', 'glit', 'stars', 'dpr', 'sun'].forEach(n => { U[n] = gl.getUniformLocation(prog, n); });
    return {
      upload(base) { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, base); },
      draw(t, W, H, geo, o, dpr, sun) {
        gl.viewport(0, 0, W, H);
        gl.uniform1i(U.img, 0);
        gl.uniform2f(U.res, W, H);
        gl.uniform1f(U.t, t); gl.uniform1f(U.hy, geo.hy); gl.uniform1f(U.se, geo.se);
        gl.uniform1f(U.calm, o.calm); gl.uniform1f(U.glit, o.glitter); gl.uniform1f(U.stars, o.stars); gl.uniform1f(U.dpr, dpr);
        gl.uniform3f(U.sun, sun ? sun.x : 0, sun ? sun.y : 0, sun ? (sun.size / H) * o.sunRays : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
      lost: () => gl.isContextLost()
    };
  }

  // host: the element whose CSS background is the photo. o: { src, posX, posY (0–1, like
  // background-position), horizon and seaEnd (fractions of the photo's height), calm (wave
  // strength, 0–1), glitter (0–1), stars (0–1), sunRays (0–1) }
  function mount(host, o) {
    let cv = document.createElement('canvas'), ctx = null, G = null;
    cv.className = 'welcome-canvas';
    cv.setAttribute('aria-hidden', 'true');
    const SPARK = sparkSprite(), GLOW = glowSprite('255,214,160'), RAYS = raySprite();
    let img = null, base = null, W = 0, H = 0, dpr = 1, geo = null, raf = 0, visible = true, dead = false;
    let water = [], stars = [], sun = null, sparks = [];
    const t0 = performance.now();

    const load = cors => new Promise((resolve, reject) => {
      const im = new Image();
      if (cors) im.crossOrigin = 'anonymous';
      im.decoding = 'async';
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = o.src;
    });

    function layout() {
      const r = host.getBoundingClientRect();
      if (!img || !r.width || !r.height) return;
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      W = Math.round(r.width * dpr); H = Math.round(r.height * dpr);
      cv.width = W; cv.height = H;
      // the same crop as `background-size: cover` with the photo's background-position
      const s = Math.max(W / img.naturalWidth, H / img.naturalHeight), dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      const ox = (W - dw) * o.posX, oy = (H - dh) * o.posY;
      base = document.createElement('canvas');
      base.width = W; base.height = H;
      const b = base.getContext('2d');
      b.drawImage(img, ox, oy, dw, dh);
      geo = { hy: oy + dh * o.horizon, se: Math.min(H + 2, oy + dh * o.seaEnd), dh };
      analyse(b);
      // the GPU version when the photo is readable and WebGL works; otherwise row-by-row on a 2D canvas
      if (!G && !ctx && readable && !glTried) { glTried = true; G = gpu(cv); }
      if (G) { try { G.upload(base); } catch (e) { G = null; } }
      if (!G && !ctx) {
        if (glTried) { // a canvas that tried WebGL can't switch to 2D, so swap in a fresh one
          const fresh = document.createElement('canvas');
          fresh.className = cv.className; fresh.setAttribute('aria-hidden', 'true');
          fresh.width = W; fresh.height = H;
          if (cv.parentNode) cv.replaceWith(fresh);
          cv = fresh;
        }
        ctx = cv.getContext('2d');
      }
      draw(performance.now());
    }

    // Where the light is: the brightest water (for glitter), stars, and the sun. Needs the photo to
    // be readable (CORS); without it the waves still roll, just without the extra light.
    let readable = false, glTried = false;
    function analyse(b) {
      water = []; stars = []; sun = null;
      let px;
      try { px = b.getImageData(0, 0, W, H).data; readable = true; } catch (e) { readable = false; return; }
      const step = Math.max(2, Math.round(2.5 * dpr)), lum = i => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      const sea = [], hy = Math.max(0, Math.round(geo.hy)), se = Math.min(H, Math.round(geo.se));
      for (let y = hy + step * 2; y < se; y += step) for (let x = 0; x < W; x += step) sea.push([x, y, lum((y * W + x) * 4)]);
      if (sea.length) {
        const sorted = sea.map(p => p[2]).sort((a, b2) => a - b2), cut = Math.max(150, sorted[Math.floor(sorted.length * 0.965)]);
        water = sea.filter(p => p[2] >= cut);
        if (water.length > 900) water = water.sort((a, b2) => b2[2] - a[2]).slice(0, 900);
      }
      // stars: small points much brighter than what's around them
      if (o.stars) {
        const r = step * 2;
        for (let y = r; y < Math.min(hy, H - r); y += step) for (let x = r; x < W - r; x += step) {
          const L = lum((y * W + x) * 4);
          if (L < 120) continue;
          const around = (lum((y * W + x - r) * 4) + lum((y * W + x + r) * 4) + lum(((y - r) * W + x) * 4) + lum(((y + r) * W + x) * 4)) / 4;
          if (L - around > 45) stars.push([x, y]);
        }
        if (stars.length > 260) stars = stars.filter((_, i) => i % Math.ceil(stars.length / 260) === 0);
      }
      // the sun: the middle of the brightest patch of sky just above the horizon
      if (o.sunRays) {
        let sx = 0, sy = 0, n = 0;
        const top = Math.max(0, Math.round(geo.hy - geo.dh * 0.22));
        for (let y = top; y < hy; y += step) for (let x = 0; x < W; x += step) {
          if (lum((y * W + x) * 4) > 247) { sx += x; sy += y; n++; }
        }
        if (n > 3) sun = { x: sx / n, y: sy / n, size: Math.min(W, H) * (0.55 + Math.min(1, n / 900) * 0.6) };
      }
    }

    // How far a row of water is pushed sideways (and a touch up or down) at time t:
    // tiny ripples at the horizon, broad swells close by.
    function wave(y, t) {
      const span = Math.max(1, geo.se - geo.hy), d = Math.min(1, Math.max(0, (y - geo.hy) / span));
      const fade = y > geo.se ? Math.max(0, 1 - (y - geo.se) / (36 * dpr)) : 1;
      const amp = (0.3 + 5.2 * Math.pow(d, 1.4)) * dpr * fade * o.calm;
      const ph = Math.log(d + 0.035) * 10.5 - t * 1.15;
      return [amp * (Math.sin(ph) * 0.62 + Math.sin(ph * 2.27 + t * 0.83 + 1.7) * 0.38), amp * 0.2 * Math.sin(ph * 0.7 + t * 0.55)];
    }

    function draw(now) {
      if (!base) return;
      const t = (now - t0) / 1000, hy = Math.max(0, Math.min(H, Math.floor(geo.hy)));
      if (G) { G.draw(t, W, H, geo, o, dpr, sun); return; }
      if (!ctx) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      if (hy > 0) ctx.drawImage(base, 0, 0, W, hy, 0, 0, W, hy);
      const strip = Math.max(1, Math.round(2 * dpr));
      for (let y = hy; y < H; y += strip) {
        const [dx, dy] = wave(y, t);
        ctx.drawImage(base, 0, y, W, strip, dx, y + dy, W, strip + 1);
      }
      ctx.globalCompositeOperation = 'lighter';
      // the sun's glow breathes, and its rays turn very slowly
      if (sun) {
        ctx.globalAlpha = 0.16 + 0.07 * Math.sin(t * 0.6);
        ctx.drawImage(GLOW, sun.x - sun.size / 2, sun.y - sun.size / 2, sun.size, sun.size);
        const rs = sun.size * 2.2;
        ctx.save();
        ctx.translate(sun.x, sun.y);
        ctx.rotate(t * 0.012);
        ctx.globalAlpha = (0.05 + 0.025 * Math.sin(t * 0.35 + 1)) * o.sunRays;
        ctx.drawImage(RAYS, -rs / 2, -rs / 2, rs, rs);
        ctx.restore();
      }
      // glitter on the water: brief points of light that ride the waves
      if (water.length && o.glitter) {
        const want = Math.min(90, Math.round(water.length / 5)) * o.glitter;
        while (sparks.length < want) {
          const p = water[(Math.random() * water.length) | 0];
          sparks.push({ x: p[0], y: p[1], born: t - Math.random() * 0.2, life: 0.35 + Math.random() * 0.75, s: (4 + Math.random() * 9) * dpr * (0.6 + (p[2] - 150) / 210) });
        }
        sparks = sparks.filter(p => {
          const k = (t - p.born) / p.life;
          if (k >= 1) return false;
          const [dx, dy] = wave(p.y, t);
          ctx.globalAlpha = Math.sin(k * Math.PI) * 0.75 * o.glitter;
          ctx.drawImage(SPARK, p.x + dx - p.s / 2, p.y + dy - p.s / 2, p.s, p.s);
          return true;
        });
      }
      // stars twinkle
      if (stars.length) {
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i], tw = Math.sin(t * (1.3 + (i % 7) * 0.37) + i * 2.1);
          if (tw < 0.35) continue;
          const size = (5 + (i % 5)) * dpr;
          ctx.globalAlpha = (tw - 0.35) * 0.9 * o.stars;
          ctx.drawImage(SPARK, s[0] - size / 2, s[1] - size / 2, size, size);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    function loop(now) {
      raf = 0;
      if (dead || !visible || document.hidden) return;
      draw(now);
      raf = requestAnimationFrame(loop);
    }
    function start() { if (!raf && !dead && base) raf = requestAnimationFrame(loop); }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

    let resizeTimer = 0;
    const ro = window.ResizeObserver ? new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 120); }) : null;
    const io = window.IntersectionObserver ? new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); if (visible) start(); else stop(); }) : null;
    const onVis = () => { if (document.hidden) stop(); else start(); };

    load(true).catch(() => load(false)).then(im => {
      if (dead) return;
      img = im;
      host.appendChild(cv);
      layout();
      requestAnimationFrame(() => cv.classList.add('on'));
      if (ro) ro.observe(host);
      if (io) io.observe(host);
      document.addEventListener('visibilitychange', onVis);
      start();
    }).catch(() => { /* the still photo stays */ });

    return {
      destroy() {
        dead = true;
        stop();
        if (ro) ro.disconnect();
        if (io) io.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        cv.remove();
      }
    };
  }

  window.AgrazLive = { mount };
})();
