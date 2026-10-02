// Unit tests for the family tree engine (assets/js/tree.js), using a small fictional
// family in tests/fixtures/sample-tree.ged. Real family data never goes in this repo.
//   npm run test:tree
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { zipOf } from './zip.mjs';

vm.runInThisContext(readFileSync(new URL('../assets/js/tree.js', import.meta.url), 'utf8'));
const T = globalThis.AgrazTree;
const GED = readFileSync(new URL('./fixtures/sample-tree.ged', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

const asFile = buf => ({ arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });

console.log('— reading the export');
{
  const fromZip = await T.readFile(asFile(zipOf('Sample Family Tree.ged', GED)));
  ok(fromZip === GED, 'reads the .ged inside an Ancestry .zip');
  ok((await T.readFile(asFile(Buffer.from('﻿' + GED)))) === GED, 'reads a plain .ged (and drops a byte-order mark)');
  let threw = false;
  try { await T.readFile(asFile(zipOf('notes.txt', 'hello'))); } catch (e) { threw = e.message === 'no-ged'; }
  ok(threw, 'a .zip without a family tree is refused');
}

console.log('— parsing');
const m = T.parse(GED, { year: 2026 });
const P = id => m.people.find(p => p.id === id);
ok(m.people.length === 16 && m.families.length === 6, '16 people and 6 families', [m.people.length, m.families.length]);
ok(m.name === 'Sample Family Tree' && m.treeId === '191301314' && m.source === 'Ancestry', 'knows the tree’s name, number and source');
ok(m.earliest === 1890 && m.generations === 5, 'earliest birth 1890, five generations', [m.earliest, m.generations]);
ok(P('I1').n === 'Mateo Agraz' && P('I2').n === 'Lucia Ferrer', 'names from GIVN/SURN or the NAME line');
ok(P('I1').b.d === '3 Mar 1890' && P('I1').b.p === 'Havana, Cuba' && P('I1').d.d === 'about 1960', 'dates and places, “abt” becomes “about”');
ok(T.cleanDate('Mar 4,1911') === 'Mar 4, 1911' && T.cleanDate('BET 1850 AND 1860') === '1850–1860' && T.cleanDate('Abt. 1795') === 'about 1795', 'messy dates are tidied');
ok(P('I2').d.d === '12 Dec 1970' && P('I2').bu === 'Woodlawn Cemetery, Miami, Florida, USA', 'long month names shortened; resting place kept');
ok(JSON.stringify(P('I1').r) === JSON.stringify([{ y: 1930, p: 'Tampa, Florida, USA' }]), 'places they lived (for those who have passed)');
const jordon = P('I11');
ok(jordon.L === 1 && jordon.b.d === '1990' && !jordon.b.p && !jordon.r, 'living relatives keep only their birth year — no date, place or residences', jordon);
ok(m.people.filter(p => p.L).length === 8, 'eight living relatives', m.people.filter(p => p.L).map(p => p.n));
const f4 = m.families.find(f => f.id === 'F4'), f1 = m.families.find(f => f.id === 'F1');
ok(f4.m.d === '1986' && !f4.m.p && f4.dv === 1, 'a living couple’s marriage keeps only the year; divorces noted');
ok(f1.m.d === '1922' && f1.m.p === 'Havana, Cuba', 'other marriages keep date and place');
ok(JSON.stringify(P('I1').ph) === JSON.stringify([{ z: 12345, w: 400, h: 500, t: 'Mateo Agraz 1920', m: 1 }]), 'photo fingerprint from Ancestry (size, dimensions, title)');
ok(!P('I3').ph, 'documents (like census pages) aren’t treated as someone’s photo');
ok(m.portraits === 2, 'two people have photos on Ancestry');
const bad = [];
const walk = (v, path, inArr) => {
  if (v === undefined) bad.push(path);
  else if (Array.isArray(v)) { if (inArr) bad.push(path); v.forEach((x, i) => walk(x, `${path}[${i}]`, true)); }
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, `${path}.${k}`, false));
};
walk(m, 'model', false);
ok(!bad.length, 'the model can be stored in Firestore (no lists inside lists, nothing undefined)', bad.slice(0, 3));

console.log('— relationships');
const ix = T.index(m), cache = new Map();
const rel = (a, b) => T.relationship(ix, a, b, cache);
const fromJordon = {
  I1: 'great-grandfather', I2: 'great-grandmother', I3: 'grandfather', I5: 'grandmother', I182483266401: 'father', I10: 'mother',
  I12: 'brother', I14: 'half-sister', I8: 'aunt', I4: 'great-aunt', I9: 'first cousin once removed', I16: 'niece',
  I15: 'sister-in-law', I13: 'stepmother', I6: 'husband of your great-aunt', I11: 'you'
};
Object.entries(fromJordon).forEach(([id, want]) => ok(rel('I11', id) === want, `to Jordon, ${P(id).n} is: ${want}`, rel('I11', id)));
ok(rel('I182483266401', 'I16') === 'granddaughter' && rel('I182483266401', 'I1') === 'grandfather', 'and from Hector: granddaughter, grandfather');
ok(rel('I10', 'I3') === 'father-in-law' && rel('I10', 'I1') === 'your husband’s grandfather', 'in-laws: father-in-law, “your husband’s grandfather”');
ok(rel('I16', 'I1') === '2nd great-grandfather', 'Sofia’s 2nd great-grandfather');
ok(ix.parents('I11').join() === 'I182483266401,I10' && ix.children('I182483266401').length === 3 && ix.siblings('I11').join() === 'I12', 'parents, children and siblings');
ok(T.lifespan(P('I1')) === '1890–1960' && T.lifespan(jordon) === 'b. 1990', 'life spans: 1890–1960, b. 1990');

console.log('— search');
ok(T.search(ix, 'agr jor').map(p => p.id).join() === 'I11', '“agr jor” finds Jordon Agraz');
ok(T.search(ix, 'elena').length === 2 && T.search(ix, 'zzz').length === 0, 'two Elenas; nobody called zzz');

console.log('— matching the family’s photos');
const match = T.photoMatcher(m);
ok(JSON.stringify(match({ name: 'download (3).jpg', size: 12345, w: 400, h: 500 })) === '{"pid":"I1","how":"exact"}', 'exact size + dimensions → Mateo, whatever the file is called');
ok(JSON.stringify(match({ name: 'IMG_3047.jpeg', size: 1, w: 10, h: 10 })) === '{"pid":"I182483266401","how":"title"}', 'the Ancestry title in the file name → Hector');
ok(JSON.stringify(match({ name: 'Carmen Agraz wedding.png', size: 1 })) === '{"pid":"I4","how":"name"}', 'a person’s full name in the file name → Carmen');
ok(JSON.stringify(match({ name: 'scan.png', size: 7, w: 400, h: 500 })) === '{"pid":"I1","how":"dims"}', 'unique dimensions → Mateo');
ok(match({ name: 'beach.png', size: 5, w: 3, h: 3 }) === null, 'anything else waits for someone to choose');

console.log('— storing');
const parts = T.chunk(m, 1200);
ok(parts.length > 1 && parts.reduce((n, p) => n + p.people.length, 0) === 16 && parts.reduce((n, p) => n + p.families.length, 0) === 6, `big trees split into pieces (${parts.length}) without losing anyone`);
ok(T.chunk(m).length === 1, 'a normal tree fits in one piece');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
