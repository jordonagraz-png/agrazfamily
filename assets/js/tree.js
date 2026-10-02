/* ==========================================================================
   Agraz Family Tree engine
   Reads an Ancestry family-tree export (GEDCOM 5.5.1, as a .ged or the .zip
   Ancestry gives you) into a compact model, and works out how any two people
   are related. Runs entirely in the browser — the file is never uploaded
   anywhere except, once parsed, to the family's private database.
   Loaded on demand by portal.js; exposes window.AgrazTree.
   ========================================================================== */
(function (root) {
  'use strict';

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const LIVING_YEARS = 100; // no death record and born within this many years → treated as living

  /* ---------- reading the file ---------- */
  // The first .ged inside a .zip (stored or deflated), unpacked with the browser's DecompressionStream.
  async function unzipGed(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let end = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error('not-zip');
    const count = dv.getUint16(end + 10, true);
    let p = dv.getUint32(end + 16, true);
    for (let k = 0; k < count && dv.getUint32(p, true) === 0x02014b50; k++) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), noteLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + noteLen;
      if (!/\.ged$/i.test(name) || /(^|\/)__MACOSX\//.test(name)) continue;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = u8.subarray(start, start + size);
      if (method === 0) return data;
      if (method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('zip-method');
      const out = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      return new Uint8Array(out);
    }
    throw new Error('no-ged');
  }
  async function readFile(file) {
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const bytes = u8[0] === 0x50 && u8[1] === 0x4b ? await unzipGed(buf) : u8;
    return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
  }

  /* ---------- small helpers ---------- */
  const strip = x => String(x || '').replace(/^@|@$/g, '');
  function yearOf(s) { const m = /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(String(s || '')); return m ? Number(m[1]) : null; }
  function cleanDate(s) {
    let x = String(s || '').trim().replace(/\s+/g, ' ').replace(/,(?=\S)/g, ', ');
    if (!x) return '';
    x = x.replace(/^bet\.?\s+(.+?)\s+and\s+(.+)$/i, '$1–$2')
      .replace(/^(abt|about|circa|ca|c|est|cal)\.?\s+/i, 'about ')
      .replace(/^bef\.?\s+/i, 'before ').replace(/^aft\.?\s+/i, 'after ')
      .replace(/^from\s+(.+?)\s+to\s+(.+)$/i, '$1–$2')
      .replace(/^(\d{4})\s*-\s*(\d{4})$/, '$1–$2');
    return x.replace(/\b([A-Za-z]{3,9})\b/g, w => {
      const i = MONTHS.findIndex(m => m.toLowerCase().startsWith(w.toLowerCase()) && w.length >= 3);
      return i >= 0 ? MONTHS[i].slice(0, 3) : w;
    });
  }
  const cleanPlace = s => String(s || '').split(',').map(t => t.trim()).filter(Boolean).join(', ');
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /* ---------- GEDCOM → compact model ---------- */
  function parse(text, opts) {
    opts = opts || {};
    const nowY = opts.year || new Date().getFullYear();
    const recs = new Map(), order = [], stack = [];
    let head = null;
    for (const raw of String(text).split(/\r\n|\r|\n/)) {
      const m = /^\s*(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/.exec(raw);
      if (!m) continue;
      const lvl = Number(m[1]), tag = m[3], val = m[4] || '';
      if (tag === 'CONC' || tag === 'CONT') { const up = stack[lvl - 1]; if (up) up.v += (tag === 'CONT' ? '\n' : '') + val; continue; }
      const node = { t: tag, v: val, c: [] };
      if (lvl === 0) {
        node.id = m[2] ? strip(m[2]) : null;
        if (node.id) recs.set(node.id, node);
        if (tag === 'HEAD') head = node;
        order.push(node);
        stack.length = 0; stack[0] = node;
        continue;
      }
      const up = stack[lvl - 1];
      if (!up) continue;
      up.c.push(node);
      stack[lvl] = node; stack.length = lvl + 1;
    }
    const kid = (n, t) => (n ? n.c.find(x => x.t === t) : null);
    const kids = (n, t) => (n ? n.c.filter(x => x.t === t) : []);
    const val = (n, t) => { const k = kid(n, t); return k ? k.v.trim() : ''; };

    // Photos: Ancestry exports each photo's title, size and dimensions (not the image itself).
    const media = new Map();
    for (const n of order) {
      if (n.t !== 'OBJE' || !n.id) continue;
      const file = kid(n, 'FILE'), form = kid(file, 'FORM');
      media.set(n.id, {
        title: (val(file, 'TITL') || val(n, 'TITL')).slice(0, 120),
        kind: val(form, '_MTYPE').toLowerCase(),
        image: !val(form, 'TYPE') || val(form, 'TYPE').toLowerCase() === 'image',
        z: Number(val(form, '_SIZE')) || 0, w: Number(val(form, '_WDTH')) || 0, h: Number(val(form, '_HGHT')) || 0
      });
    }

    const event = (n, tag) => {
      const e = kid(n, tag);
      if (!e) return null;
      const date = val(e, 'DATE');
      return { d: cleanDate(date), p: cleanPlace(val(e, 'PLAC')), y: yearOf(date) };
    };

    const people = [], families = [];
    for (const n of order) {
      if (n.t !== 'INDI' || !n.id) continue;
      const nm = kid(n, 'NAME');
      const rawName = nm ? nm.v : '';
      const given = (val(nm, 'GIVN') || rawName.split('/')[0]).trim().replace(/\s+/g, ' ');
      const surname = (val(nm, 'SURN') || (rawName.split('/')[1] || '')).trim().replace(/\s+/g, ' ');
      const suffix = val(nm, 'NSFX');
      const birth = event(n, 'BIRT') || event(n, 'BAPM') || event(n, 'CHR');
      const death = event(n, 'DEAT');
      const burial = event(n, 'BURI');
      const living = !death && !burial && (birth && birth.y ? birth.y > nowY - LIVING_YEARS : true);
      const p = {
        id: n.id,
        n: [given, surname, suffix].filter(Boolean).join(' ') || 'Unknown',
        g: given, s: surname,
        x: (val(n, 'SEX') || '').toUpperCase().slice(0, 1).replace(/[^MF]/, ''),
        fc: kids(n, 'FAMC').map(k => strip(k.v)).filter(id => recs.has(id)),
        fs: kids(n, 'FAMS').map(k => strip(k.v)).filter(id => recs.has(id))
      };
      if (living) {
        // Privacy: for living relatives keep only the birth year — no full date, no places.
        p.L = 1;
        if (birth && birth.y) p.b = { d: String(birth.y), y: birth.y };
      } else {
        if (birth && (birth.d || birth.p)) p.b = birth;
        if (death) p.d = death;
        if (burial && burial.p) p.bu = burial.p;
        const seen = new Set();
        p.r = kids(n, 'RESI').map(e => ({ y: yearOf(val(e, 'DATE')) || 0, p: cleanPlace(val(e, 'PLAC')) }))
          .filter(r => r.p && !seen.has(r.p) && seen.add(r.p)).sort((a, b) => a.y - b.y).slice(0, 6);
        if (!p.r.length) delete p.r;
      }
      // Photo fingerprints (bytes, width, height, title; m = their main photo), so the
      // family's own copies can be matched to the right person later.
      const ph = [];
      kids(n, 'OBJE').forEach(o => {
        const md = media.get(strip(o.v));
        if (!md || !md.image) return;
        const prim = val(o, '_PRIM') === 'Y';
        if (prim || md.kind === 'portrait') ph.push({ z: md.z, w: md.w, h: md.h, t: md.title, m: prim ? 1 : 0 });
      });
      if (ph.length) p.ph = ph.sort((a, b) => b.m - a.m).slice(0, 4);
      people.push(p);
    }
    for (const n of order) {
      if (n.t !== 'FAM' || !n.id) continue;
      const f = { id: n.id, h: strip(val(n, 'HUSB')), w: strip(val(n, 'WIFE')), c: kids(n, 'CHIL').map(k => strip(k.v)).filter(id => recs.has(id)) };
      if (!recs.has(f.h)) delete f.h;
      if (!recs.has(f.w)) delete f.w;
      const marr = event(n, 'MARR');
      if (marr && (marr.d || marr.p)) f.m = marr;
      if (kid(n, 'DIV')) f.dv = 1;
      families.push(f);
    }
    // Living spouses' marriage details are trimmed too.
    const byId = new Map(people.map(p => [p.id, p]));
    families.forEach(f => {
      if (f.m && [f.h, f.w].some(id => id && byId.get(id) && byId.get(id).L)) f.m = f.m.y ? { d: String(f.m.y), y: f.m.y } : undefined;
      if (!f.m) delete f.m;
    });

    const tree = kid(kid(head, 'SOUR'), '_TREE');
    const years = people.map(p => p.b && p.b.y).filter(Boolean);
    const model = {
      v: 1,
      name: tree ? tree.v.trim().slice(0, 80) : '',
      treeId: tree ? val(tree, 'RIN').slice(0, 20) : '',
      source: tree ? 'Ancestry' : (val(kid(head, 'SOUR'), 'NAME') || val(head, 'SOUR')).slice(0, 40),
      people, families,
      earliest: years.length ? Math.min(...years) : null,
      portraits: people.filter(p => p.ph).length
    };
    model.generations = generations(model);
    return model;
  }

  /* ---------- navigating the model ---------- */
  function index(model) {
    const P = new Map(model.people.map(p => [p.id, p]));
    const F = new Map(model.families.map(f => [f.id, f]));
    const fam = id => F.get(id);
    const ix = {
      model, P, F,
      get: id => P.get(id),
      parents(id) { const p = P.get(id); if (!p) return []; const out = []; (p.fc || []).forEach(fid => { const f = fam(fid); if (f) [f.h, f.w].forEach(x => { if (x && P.has(x) && !out.includes(x)) out.push(x); }); }); return out; },
      father(id) { return ix.parents(id).find(x => P.get(x).x === 'M') || null; },
      mother(id) { return ix.parents(id).find(x => P.get(x).x === 'F') || null; },
      unions(id) { const p = P.get(id); if (!p) return []; return (p.fs || []).map(fid => fam(fid)).filter(Boolean).map(f => ({ fam: f, spouse: f.h === id ? f.w : f.h })); },
      spouses(id) { return ix.unions(id).map(u => u.spouse).filter(x => x && P.has(x)); },
      children(id) { const out = []; ix.unions(id).forEach(u => u.fam.c.forEach(c => { if (!out.includes(c)) out.push(c); })); return out; },
      siblings(id) {
        const p = P.get(id), out = [];
        (p && p.fc || []).forEach(fid => { const f = fam(fid); if (f) f.c.forEach(c => { if (c !== id && !out.includes(c)) out.push(c); }); });
        return out;
      }
    };
    return ix;
  }
  // The longest line from an ancestor down to a descendant, in generations.
  function generations(model) {
    const ix = index(model), memo = new Map();
    const depth = (id, seen) => {
      if (memo.has(id)) return memo.get(id);
      if (seen.has(id)) return 0;
      seen.add(id);
      let d = 1;
      ix.children(id).forEach(c => { d = Math.max(d, 1 + depth(c, seen)); });
      seen.delete(id);
      memo.set(id, d);
      return d;
    };
    let max = 0;
    model.people.forEach(p => { max = Math.max(max, depth(p.id, new Set())); });
    return max;
  }
  function lifespan(p) {
    if (!p) return '';
    const b = p.b && p.b.y, d = p.d && p.d.y;
    if (p.L) return b ? `b. ${b}` : '';
    if (b && d) return `${b}–${d}`;
    if (b) return `${b}–`;
    if (d) return `–${d}`;
    return '';
  }
  function search(ix, q, limit) {
    const words = fold(q).split(' ').filter(Boolean);
    if (!words.length) return [];
    const scored = [];
    ix.model.people.forEach(p => {
      const name = fold(p.n);
      if (!words.every(w => name.split(' ').some(t => t.startsWith(w)))) return;
      const score = (name.startsWith(words[0]) ? 0 : 1) + (p.L ? 0.1 : 0);
      scored.push([score, p]);
    });
    return scored.sort((a, b) => a[0] - b[0] || a[1].n.localeCompare(b[1].n)).slice(0, limit || 12).map(x => x[1]);
  }

  /* ---------- relationships ---------- */
  const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  const ordWord = n => ORD[n] || `${n}th`;
  const ordNum = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const sexed = (p, m, f, n) => (p && p.x === 'M' ? m : p && p.x === 'F' ? f : n);
  const greats = (k, word) => (k <= 0 ? word : k === 1 ? `great-${word}` : `${ordNum(k)} great-${word}`);
  const timesRemoved = r => (r === 1 ? 'once removed' : r === 2 ? 'twice removed' : `${r} times removed`);

  function ancestors(ix, id) {
    const dist = new Map([[id, 0]]), queue = [id];
    while (queue.length) {
      const cur = queue.shift(), d = dist.get(cur);
      if (d > 60) continue;
      ix.parents(cur).forEach(par => { if (!dist.has(par)) { dist.set(par, d + 1); queue.push(par); } });
    }
    return dist;
  }
  // Blood relationship of `to` to `from` (e.g. "great-grandfather"), or null.
  function blood(ix, from, to, cache) {
    if (from === to) return 'you';
    const A = (cache && cache.get(from)) || ancestors(ix, from);
    if (cache) cache.set(from, A);
    const B = ancestors(ix, to);
    let best = null;
    B.forEach((b, c) => { if (A.has(c)) { const a = A.get(c); if (!best || a + b < best.a + best.b) best = { a, b }; } });
    if (!best) return null;
    const { a, b } = best, p = ix.get(to);
    if (a === 0) return greats(b - 2, sexed(p, b === 1 ? 'son' : 'grandson', b === 1 ? 'daughter' : 'granddaughter', b === 1 ? 'child' : 'grandchild')).replace('great-son', 'son');
    if (b === 0) return a === 1 ? sexed(p, 'father', 'mother', 'parent') : greats(a - 2, sexed(p, 'grandfather', 'grandmother', 'grandparent'));
    if (a === 1 && b === 1) {
      const shared = ix.parents(from).filter(x => ix.parents(to).includes(x)).length;
      return (shared === 1 ? 'half-' : '') + sexed(p, 'brother', 'sister', 'sibling');
    }
    if (a === 1) return greats(b - 2, sexed(p, 'nephew', 'niece', 'niece or nephew'));
    if (b === 1) return greats(a - 2, sexed(p, 'uncle', 'aunt', 'aunt or uncle'));
    const r = Math.abs(a - b);
    return `${ordWord(Math.min(a, b) - 1)} cousin${r ? ` ${timesRemoved(r)}` : ''}`;
  }
  // How `to` is related to `from`, in words, or null when they aren't connected.
  function relationship(ix, from, to, cache) {
    if (!ix.get(from) || !ix.get(to)) return null;
    const p = ix.get(to);
    const direct = blood(ix, from, to, cache);
    if (direct) return direct;
    if (ix.spouses(from).includes(to)) return sexed(p, 'husband', 'wife', 'spouse');
    // a blood relative's husband or wife (a parent's spouse is a step-parent)
    let best = null;
    ix.spouses(to).forEach(s => {
      const rel = blood(ix, from, s, cache);
      if (rel && rel !== 'you' && (!best || rel.length < best.length)) best = rel;
    });
    if (best) {
      if (best === 'father' || best === 'mother') return sexed(p, 'stepfather', 'stepmother', 'step-parent');
      if (best === 'brother' || best === 'sister') return sexed(p, 'brother-in-law', 'sister-in-law', 'sibling-in-law');
      return `${sexed(p, 'husband', 'wife', 'spouse')} of your ${best}`;
    }
    // your husband's or wife's blood relatives (in-laws)
    for (const s of ix.spouses(from)) {
      const rel = blood(ix, s, to, cache);
      if (rel && rel !== 'you') {
        const sp = ix.get(s);
        if (rel === 'father' || rel === 'mother') return `${rel}-in-law`;
        if (/^(brother|sister)$/.test(rel)) return `${rel}-in-law`;
        return `your ${sexed(sp, 'husband', 'wife', 'spouse')}’s ${rel}`;
      }
    }
    return null;
  }

  /* ---------- matching the family's photos to people ---------- */
  // Ancestry keeps each photo's exact size in bytes, its dimensions and its title, so a
  // copy downloaded from Ancestry (or the original on someone's computer) can be matched
  // to the right person without anyone tagging it by hand.
  function photoMatcher(model) {
    const bySize = new Map(), byTitle = new Map(), byDims = new Map(), names = [];
    const add = (map, key, v) => { if (!map.has(key)) map.set(key, []); map.get(key).push(v); };
    model.people.forEach(p => {
      (p.ph || []).forEach(f => {
        const v = { pid: p.id, f };
        if (f.z) add(bySize, f.z, v);
        if (f.t) add(byTitle, fold(f.t), v);
        if (f.w && f.h) add(byDims, `${f.w}x${f.h}`, v);
      });
      const nm = fold(p.n);
      if (nm.split(' ').length >= 2) names.push([nm, p.id]);
    });
    names.sort((a, b) => b[0].length - a[0].length);
    const best = list => list.slice().sort((a, b) => b.f.m - a.f.m)[0];
    // file: { name, size, w, h } → { pid, how } or null. how: exact | title | name | dims
    return function match(file) {
      const base = fold(String(file.name || '').replace(/\.[a-z0-9]+$/i, ''));
      const sized = (bySize.get(file.size) || []).filter(v => !file.w || !v.f.w || (v.f.w === file.w && v.f.h === file.h));
      if (sized.length) return { pid: best(sized).pid, how: 'exact' };
      const titled = byTitle.get(base) || [];
      if (base && titled.length && new Set(titled.map(v => v.pid)).size === 1) return { pid: titled[0].pid, how: 'title' };
      const named = base && names.find(([nm]) => (` ${base} `).includes(` ${nm} `));
      if (named) return { pid: named[1], how: 'name' };
      const dims = file.w && file.h ? byDims.get(`${file.w}x${file.h}`) || [] : [];
      if (dims.length && new Set(dims.map(v => v.pid)).size === 1) return { pid: dims[0].pid, how: 'dims' };
      return null;
    };
  }

  // Split a model into pieces small enough for one database document each (~600 KB).
  function chunk(model, limit) {
    limit = limit || 600000;
    const parts = [];
    let cur = { people: [], families: [] }, size = 0;
    const push = (key, item) => {
      const n = JSON.stringify(item).length;
      if (size + n > limit && (cur.people.length || cur.families.length)) { parts.push(cur); cur = { people: [], families: [] }; size = 0; }
      cur[key].push(item); size += n;
    };
    model.people.forEach(p => push('people', p));
    model.families.forEach(f => push('families', f));
    parts.push(cur);
    return parts;
  }

  root.AgrazTree = { readFile, unzipGed, parse, index, lifespan, search, relationship, generations, photoMatcher, chunk, fold, yearOf, cleanDate };
})(typeof window !== 'undefined' ? window : globalThis);
