// Locks a family tree (and, optionally, a research file) for the hub's one-tap import link.
//   node tools/lock-tree.mjs "Family Tree.zip" [research.json]
// Writes assets/data/tree-import.bin — gzip + AES-256-GCM, unreadable without the key — and
// prints the private link that holds the key. Give the link only to the family admin who will
// open it, and delete the .bin once the tree is in the hub.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, createCipheriv } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

// data: { kind: 'agraz-tree', v: 1, tree: <parsed model>, research?: <agraz-research file>,
//         places?: { 'place-key': { img: <data URL> } } (photos of the towns in the family's story) }
// → { bin: iv(12) + ciphertext + tag(16), key: base64url }
export function lockTree(data) {
  const key = randomBytes(32), iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(gzipSync(JSON.stringify(data))), c.final()]);
  return { bin: Buffer.concat([iv, body, c.getAuthTag()]), key: key.toString('base64url') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [treeFile, researchFile] = process.argv.slice(2);
  if (!treeFile) { console.error('usage: node tools/lock-tree.mjs <tree.zip|tree.ged> [research.json]'); process.exit(1); }
  vm.runInThisContext(readFileSync(new URL('../assets/js/tree.js', import.meta.url), 'utf8'));
  const T = globalThis.AgrazTree, buf = readFileSync(treeFile);
  const tree = T.parse(await T.readFile({ arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }));
  const research = researchFile ? JSON.parse(readFileSync(researchFile, 'utf8')) : undefined;
  // a research file may carry the town photos under "places"; they travel beside it, not inside it
  const places = research && research.places;
  if (research) delete research.places;
  const { bin, key } = lockTree({ kind: 'agraz-tree', v: 1, tree, research, places });
  writeFileSync(new URL('../assets/data/tree-import.bin', import.meta.url), bin);
  console.log(`${tree.people.length} people, ${tree.families.length} families${research ? `, research for ${Object.keys(research.people || {}).length}` : ''}${places ? `, ${Object.keys(places).length} place photos` : ''} → assets/data/tree-import.bin (${Math.round(bin.length / 1024)} KB)`);
  console.log(`Private link: https://www.agrazfamily.com/family/#tree?key=${key}`);
}
