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
  // Life events beyond birth, death and burial (custom EVEN events carry their own TYPE).
  const EVENTS = { BAPM: 'Baptism', CHR: 'Christening', CONF: 'Confirmation', FCOM: 'First communion', BARM: 'Bar mitzvah', BASM: 'Bat mitzvah',
    GRAD: 'Graduation', EDUC: 'Education', OCCU: 'Occupation', _EMPLOY: 'Employment', _MILT: 'Military service', IMMI: 'Immigration', EMIG: 'Emigration',
    NATU: 'Naturalization', CENS: 'Census', RETI: 'Retirement', PROB: 'Probate', WILL: 'Will', CREM: 'Cremation', ADOP: 'Adoption', RELI: 'Religion',
    NATI: 'Nationality', TITL: 'Title', PROP: 'Property', ORDN: 'Ordination', _DEST: 'Destination', _FUN: 'Funeral' };
  const CITED = Object.assign({ BIRT: 'Birth', DEAT: 'Death', BURI: 'Burial', RESI: 'Residence', NAME: 'Name', SEX: 'Sex', MARR: 'Marriage', DIV: 'Divorce' }, EVENTS);

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
  // "parral, Chihuahua" → "Parral, Chihuahua": each part starts with a capital, the rest is left alone
  const cleanPlace = s => String(s || '').split(',').map(t => t.trim()).filter(Boolean).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(', ');
  const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();
  // Ancestry writes some text as HTML ("&#34;", "&lt;i&gt;Title&lt;/i&gt;"): back to plain text.
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const plain = s => (/[&<]/.test(s) ? s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] || all))
    .replace(/<\/?[a-z][^<>]*>/gi, '') : s);
  function httpsUrl(u) { u = String(u || '').trim().replace(/^http:\/\//i, 'https://'); return /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 400 ? u : ''; }
  function siteName(u) {
    const h = (/^https:\/\/(?:www\.)?([^/]+)/.exec(u) || [])[1] || '';
    return /newspapers\.com$/.test(h) ? 'Newspapers.com clipping' : /findagrave\.com$/.test(h) ? 'Find a Grave memorial' : /familysearch\.org$/.test(h) ? 'FamilySearch' : /legacy\.com$/.test(h) ? 'Obituary on Legacy.com' : h;
  }
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
      const lvl = Number(m[1]), tag = m[3], val = plain(m[4] || '');
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

    // Photos and documents: Ancestry exports each one's title, description, kind, size and
    // dimensions (not the image itself — that stays on Ancestry).
    const media = new Map(), sources = new Map(), notes = new Map();
    for (const n of order) {
      if (n.t === 'SOUR' && n.id) sources.set(n.id, oneLine(val(n, 'TITL') || val(n, 'ABBR')).slice(0, 100));
      if (n.t === 'NOTE' && n.id) notes.set(n.id, n.v);
      if (n.t !== 'OBJE' || !n.id) continue;
      const file = kid(n, 'FILE'), form = kid(file, 'FORM');
      media.set(n.id, {
        title: oneLine(val(file, 'TITL') || val(n, 'TITL')).slice(0, 120),
        kind: val(form, '_MTYPE').toLowerCase(),
        image: !val(form, 'TYPE') || val(form, 'TYPE').toLowerCase() === 'image',
        about: val(n, '_DSCR').replace(/\s+/g, ' ').slice(0, 500),
        url: httpsUrl(val(kid(n, '_ORIG'), '_URL')), // a clipping or memorial saved from the web
        z: Number(val(form, '_SIZE')) || 0, w: Number(val(form, '_WDTH')) || 0, h: Number(val(form, '_HGHT')) || 0
      });
    }
    const noteText = x => { const v = x.v.trim(), s = /^@[^@]+@$/.test(v) ? notes.get(strip(v)) || '' : x.v; return s.replace(/[ \t]+/g, ' ').trim(); };

    // Records: every source citation, anywhere under a person or family, becomes one record —
    // its collection (e.g. “1940 United States Federal Census”), the details Ancestry noted, the
    // record's id on Ancestry (_APID “1,<collection>::<record>”), any web address, and which
    // events it backs up.
    function addCite(into, c, why) {
      const sid = strip(c.v.trim()), title = sources.get(sid) || 'Record';
      let page = oneLine(val(c, 'PAGE'));
      const url = httpsUrl(val(kid(c, 'DATA'), 'WWW')) || httpsUrl((/URL:\s*(\S+)/i.exec(page) || [])[1]);
      page = page.replace(/;?\s*URL:\s*\S+/i, '').replace(/[;,\s]+$/, '').slice(0, 160);
      const ids = kids(c, '_APID').map(a => /^\d+,(\d+)::(\d+)$/.exec(a.v.trim())).filter(Boolean);
      (ids.length ? ids : [null]).forEach(m => {
        const key = m ? m[1] + ':' + m[2] : sid + '|' + page;
        let r = into.get(key);
        if (!r) {
          r = { t: title, e: new Set() };
          if (page) r.p = page;
          if (m) r.a = m[2] + ':' + m[1];
          if (url) r.u = url;
          into.set(key, r);
        }
        if (why) r.e.add(why);
      });
    }
    function citesUnder(node, into, why) {
      node.c.forEach(c => {
        if (c.t === 'SOUR' && /^@[^@]+@$/.test(c.v.trim())) addCite(into, c, why);
        else if (c.t !== 'OBJE') citesUnder(c, into, why);
      });
    }
    function citesOf(rec) {
      const into = new Map();
      rec.c.forEach(c => {
        if (c.t === 'SOUR' && /^@[^@]+@$/.test(c.v.trim())) addCite(into, c, '');
        else if (!['OBJE', 'FAMS', 'FAMC', 'CHIL', 'HUSB', 'WIFE'].includes(c.t)) citesUnder(c, into, CITED[c.t] || (c.t === 'EVEN' ? oneLine(val(c, 'TYPE')).slice(0, 30) : ''));
      });
      return into;
    }
    // A citation without a record id folds into the same collection's record that has one.
    const finishRecords = into => [...into.values()]
      .filter((r, i, all) => {
        if (r.a) return true;
        const twin = all.find(o => o !== r && o.t === r.t && (o.a || (all.indexOf(o) < i && (o.p || '') === (r.p || ''))));
        if (!twin) return true;
        r.e.forEach(x => twin.e.add(x));
        if (!twin.p && r.p) twin.p = r.p;
        if (!twin.u && r.u) twin.u = r.u;
        return false;
      })
      .map(r => { const e = [...r.e].join(' · ').slice(0, 80); delete r.e; if (e) r.e = e; r.y = yearOf(r.t) || yearOf(r.p) || 0; return r; })
      .sort((a, b) => (a.y || 9999) - (b.y || 9999)).slice(0, 40)
      .map(r => { if (!r.y) delete r.y; return r; });

    const event = (n, tag) => {
      const e = kid(n, tag);
      if (!e) return null;
      const date = val(e, 'DATE');
      return { d: cleanDate(date), p: cleanPlace(val(e, 'PLAC')), y: yearOf(date) };
    };

    const people = [], families = [], recordsOf = new Map();
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
        // Privacy: for living relatives keep only the birth year — no full date, no places,
        // no records, notes or photo descriptions.
        p.L = 1;
        if (birth && birth.y) p.b = { d: String(birth.y), y: birth.y };
      } else {
        if (birth && (birth.d || birth.p)) p.b = birth;
        if (death) {
          p.d = death;
          const cause = oneLine(val(kid(n, 'DEAT'), 'CAUS')).slice(0, 120);
          if (cause) p.d.c = cause;
        }
        if (burial && burial.p) p.bu = burial.p;
        const seen = new Set();
        const lived = kids(n, 'RESI').map(e => ({ y: yearOf(val(e, 'DATE')) || 0, p: cleanPlace(val(e, 'PLAC')) }))
          .filter(r => r.p).sort((a, b) => a.y - b.y);
        p.r = lived.filter(r => !seen.has(r.p) && seen.add(r.p)).slice(0, 6);
        if (!p.r.length) delete p.r;
        // The whole life story: every residence with its year, plus baptism, arrivals, military
        // service, work… each with its date, place and any note.
        const life = lived.map(r => ({ k: 'Residence', d: r.y ? String(r.y) : '', p: r.p, y: r.y }));
        n.c.forEach(e => {
          const label = e.t === 'EVEN' ? oneLine(val(e, 'TYPE')).slice(0, 40) || 'Event' : EVENTS[e.t];
          if (!label || ((e.t === 'BAPM' || e.t === 'CHR') && !kid(n, 'BIRT'))) return;
          const date = val(e, 'DATE'), x = { k: label, d: cleanDate(date), p: cleanPlace(val(e, 'PLAC')), y: yearOf(date) || 0 };
          const what = oneLine(e.v).slice(0, 160), note = kids(e, 'NOTE').map(noteText).filter(Boolean).join(' ').slice(0, 400);
          if (what) x.v = what;
          if (note) x.n = note;
          if (x.d || x.p || x.v || x.n) life.push(x);
        });
        if (life.length) {
          const dup = new Set();
          p.ev = life.filter(x => { const k = [x.k, x.d, x.p].join('|'); return !dup.has(k) && dup.add(k); })
            .sort((a, b) => (a.y || 9999) - (b.y || 9999)).slice(0, 60).map(x => { if (!x.y) delete x.y; if (!x.d) delete x.d; if (!x.p) delete x.p; return x; });
        }
        const nt = kids(n, 'NOTE').map(noteText).filter(Boolean).join('\n\n').slice(0, 3000);
        if (nt) p.nt = nt;
        const aka = kids(n, 'NAME').slice(1).map(x => oneLine(x.v.replace(/\//g, ''))).filter(x => x && x !== p.n).slice(0, 4);
        if (aka.length) p.aka = aka;
        // Photos and documents on Ancestry (titles and descriptions), and web links (obituaries, graves…).
        const md = [];
        kids(n, 'OBJE').forEach(o => {
          const x = media.get(strip(o.v));
          if (!x) return;
          const item = { t: x.title || 'Untitled', k: x.kind || (x.image ? 'photo' : 'file') };
          if (x.about) item.d = x.about;
          if (x.url) item.u = x.url;
          if (val(o, '_PRIM') === 'Y') item.m = 1;
          md.push(item);
        });
        if (md.length) p.md = md.sort((a, b) => (b.m || 0) - (a.m || 0)).slice(0, 60);
        const links = [], seenUrl = new Set();
        (function walk(node) { node.c.forEach(c => { if (c.t === '_URL' || c.t === 'WWW') { const u = httpsUrl(c.v); if (u && !seenUrl.has(u)) { seenUrl.add(u); links.push({ u, t: oneLine(val(node, 'TITL')).slice(0, 120) || siteName(u) }); } } else if (c.t !== 'SOUR') walk(c); }); })(n);
        if (links.length) p.ln = links.slice(0, 20);
        recordsOf.set(n.id, citesOf(n));
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
      // Marriage records count for both partners (if they've passed).
      const fr = citesOf(n);
      [f.h, f.w].forEach(id => { const into = id && recordsOf.get(id); if (into) fr.forEach((r, k) => { const have = into.get(k); if (have) r.e.forEach(x => have.e.add(x)); else into.set(k, { ...r, e: new Set(r.e) }); }); });
    }
    people.forEach(p => { const into = recordsOf.get(p.id); if (into && into.size) p.src = finishRecords(into); });
    // Living spouses' marriage details are trimmed too.
    const byId = new Map(people.map(p => [p.id, p]));
    families.forEach(f => {
      if (f.m && [f.h, f.w].some(id => id && byId.get(id) && byId.get(id).L)) f.m = f.m.y ? { d: String(f.m.y), y: f.m.y } : undefined;
      if (!f.m) delete f.m;
    });

    const tree = kid(kid(head, 'SOUR'), '_TREE');
    const years = people.map(p => p.b && p.b.y).filter(Boolean);
    const model = {
      v: 2,
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

  /* ---------- their world: history around a life ---------- */
  // [year, regions, what happened]. Regions: w world, mx Mexico/New Spain, us United States,
  // eu Europe, de German lands, uk Britain & Ireland, es Spain.
  const WORLD = [
    [1492, 'w', 'Columbus reaches the Americas'], [1517, 'de eu', 'Luther starts the Reformation in Germany'],
    [1521, 'mx es', 'Tenochtitlan falls and New Spain begins'], [1531, 'mx', 'The Virgin of Guadalupe appears to Juan Diego, as the story goes'],
    [1546, 'mx', 'Silver is found at Zacatecas, drawing settlers north'], [1588, 'es uk', 'The Spanish Armada sails against England'],
    [1598, 'mx', 'Juan de Oñate leads settlers up the Camino Real to New Mexico'], [1607, 'us uk', 'Jamestown, the first lasting English colony, is founded'],
    [1618, 'de eu', 'The Thirty Years’ War begins in the German lands'], [1620, 'us uk', 'The Mayflower lands at Plymouth'],
    [1631, 'mx', 'A silver strike at Parral brings settlers to Chihuahua'], [1648, 'de eu', 'The Peace of Westphalia ends the Thirty Years’ War'],
    [1666, 'uk', 'The Great Fire of London'], [1680, 'mx', 'The Pueblo Revolt drives the Spanish from New Mexico'],
    [1692, 'us', 'The Salem witch trials'], [1709, 'mx', 'The city of Chihuahua is founded'],
    [1718, 'mx us', 'San Antonio, Texas, is founded'], [1754, 'us', 'The French and Indian War begins'],
    [1767, 'mx es', 'The Jesuits are expelled from New Spain'], [1776, 'us w', 'The American colonies declare independence'],
    [1787, 'us', 'The U.S. Constitution is written'], [1789, 'eu w', 'The French Revolution begins'],
    [1803, 'us', 'The Louisiana Purchase doubles the United States'], [1810, 'mx', 'Father Hidalgo’s cry of Dolores starts Mexico’s War of Independence'],
    [1811, 'mx', 'Hidalgo is captured and executed in Chihuahua'], [1812, 'us uk', 'The War of 1812 begins'],
    [1815, 'eu', 'Napoleon is defeated at Waterloo'], [1821, 'mx es', 'Mexico wins its independence from Spain'],
    [1825, 'us', 'The Erie Canal opens'], [1836, 'mx us', 'Texas breaks away from Mexico'],
    [1837, 'uk', 'Queen Victoria’s reign begins'], [1845, 'uk eu', 'The Great Famine begins in Ireland'],
    [1846, 'mx us', 'The Mexican–American War begins'], [1848, 'mx us', 'The Treaty of Guadalupe Hidalgo: Mexico gives up the Southwest'],
    [1848, 'de eu', 'Revolutions sweep the German states and many emigrate to America'], [1849, 'us', 'The California Gold Rush'],
    [1861, 'us', 'The American Civil War begins'], [1862, 'mx', 'Cinco de Mayo: Mexico defeats the French at Puebla'],
    [1865, 'us', 'The Civil War ends and slavery is abolished'], [1867, 'mx', 'Benito Juárez restores the Republic after the French intervention'],
    [1869, 'us', 'The transcontinental railroad is completed'], [1871, 'de eu', 'Germany is unified'],
    [1871, 'us', 'The Great Chicago Fire'], [1876, 'mx', 'Porfirio Díaz comes to power'],
    [1876, 'w', 'Alexander Graham Bell patents the telephone'], [1884, 'mx us', 'The Mexican Central Railway links Mexico City with El Paso'],
    [1892, 'us', 'Ellis Island opens to immigrants'], [1903, 'w', 'The Wright brothers make the first flight'],
    [1906, 'us', 'The San Francisco earthquake'], [1908, 'us', 'Ford’s Model T goes on sale'],
    [1910, 'mx', 'The Mexican Revolution begins'], [1914, 'w', 'World War I begins'],
    [1916, 'mx us', 'Pancho Villa raids Columbus, New Mexico'], [1917, 'mx', 'Mexico’s Constitution of 1917 is signed'],
    [1918, 'w', 'World War I ends and a flu pandemic sweeps the world'], [1920, 'us', 'American women win the right to vote'],
    [1926, 'mx', 'The Cristero War begins'], [1927, 'w', 'Lindbergh flies solo across the Atlantic'],
    [1929, 'w', 'The stock market crashes and the Great Depression begins'], [1938, 'mx', 'Mexico takes control of its oil'],
    [1939, 'w', 'World War II begins'], [1941, 'us', 'Pearl Harbor: the U.S. enters World War II'],
    [1942, 'mx us', 'The Bracero Program brings Mexican workers north'], [1945, 'w', 'World War II ends'],
    [1950, 'us', 'The Korean War begins'], [1955, 'us', 'The Montgomery bus boycott'],
    [1957, 'w', 'Sputnik, the first satellite, is launched'], [1963, 'us', 'President Kennedy is assassinated'],
    [1964, 'us', 'The Civil Rights Act is signed'], [1968, 'mx', 'Mexico City hosts the Olympic Games'],
    [1969, 'w', 'People walk on the Moon'], [1970, 'mx', 'Mexico hosts the World Cup'],
    [1985, 'mx', 'A great earthquake strikes Mexico City'], [1989, 'w', 'The Berlin Wall falls'],
    [1991, 'w', 'The World Wide Web goes public'], [2001, 'us', 'The September 11 attacks'],
    [2007, 'w', 'The iPhone goes on sale'], [2020, 'w', 'The COVID-19 pandemic']
  ];
  // Where someone's life happened, from every place in their record.
  function regionsOf(p) {
    const s = [p.b && p.b.p, p.d && p.d.p, p.bu, ...(p.r || []).map(r => r.p), ...(p.ev || []).map(e => e.p)].filter(Boolean).join(' | ');
    const f = fold(s), R = new Set(['w']);
    if (/\b(mexico|chihuahua|jalisco|durango|sonora|zacatecas|coahuila|nuevo leon|guanajuato|michoacan|sinaloa|aguascalientes|puebla|oaxaca|veracruz|tamaulipas|new spain|nueva espana)\b/.test(f)) R.add('mx');
    if (/\b(usa|united states|texas|california|indiana|illinois|ohio|new york|new mexico|arizona|kentucky|pennsylvania|michigan|colorado|kansas|missouri|iowa|wisconsin|virginia|carolina|georgia|florida|tennessee|nevada|oregon|washington|utah|oklahoma|nebraska|minnesota|maryland|new jersey|massachusetts|alabama|louisiana)\b/.test(f)) R.add('us');
    if (/\b(germany|prussia|preussen|bavaria|bayern|hesse|hessen|baden|wurttemberg|saxony|sachsen|deutschland|westphalia|hannover|rheinland)\b/.test(f)) { R.add('de'); R.add('eu'); }
    if (/\b(england|scotland|ireland|wales|united kingdom|sussex|kent|yorkshire|london|lancashire|cornwall|devon)\b/.test(f)) { R.add('uk'); R.add('eu'); }
    if (/\b(spain|espana|cartagena|sevilla|seville|madrid|andalucia|castilla|galicia|vizcaya)\b/.test(f)) { R.add('es'); R.add('eu'); }
    if (/\b(france|italy|italia|netherlands|holland|switzerland|austria|poland|belgium|portugal|norway|sweden|denmark)\b/.test(f)) R.add('eu');
    if (R.size === 1) { R.add('us'); R.add('mx'); }
    return R;
  }
  // History during [from, to] that touched these regions: up to `max`, spread across the years,
  // local events before world ones.
  function world(regions, from, to, max) {
    max = max || 7;
    const hit = WORLD.filter(([y, r]) => y >= from && y <= to && r.split(' ').some(x => regions.has(x)));
    const local = hit.filter(([, r]) => r.split(' ').some(x => x !== 'w' && regions.has(x)));
    let pool = local.length >= max ? local : hit;
    if (pool.length > max) pool = Array.from({ length: max }, (_, i) => pool[Math.round(i * (pool.length - 1) / (max - 1))]);
    return pool.map(([y, , what]) => ({ y, what }));
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

  root.AgrazTree = { readFile, unzipGed, parse, index, lifespan, search, relationship, generations, photoMatcher, chunk, fold, yearOf, cleanDate, regionsOf, world };
})(typeof window !== 'undefined' ? window : globalThis);
