// Stamps a fresh version on every script, stylesheet and icon the pages load
// (…/portal.js?v=202610021930), so browsers never mix a new page with old cached
// files after an update. Run before each release:  npm run stamp
import { readFileSync, writeFileSync } from 'node:fs';

const v = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const root = new URL('../', import.meta.url);
const pages = ['index.html', 'family/index.html', '404.html'];
for (const page of pages) {
  const file = new URL(page, root);
  const html = readFileSync(file, 'utf8')
    .replace(/\/assets\/icons\.svg(\?v=\w+)?#/g, `/assets/icons.svg?v=${v}#`)
    .replace(/(href="\/assets\/css\/[\w-]+\.css)(\?v=\w+)?"/g, `$1?v=${v}"`)
    .replace(/(src="\/assets\/js\/[\w-]+\.js)(\?v=\w+)?"/g, `$1?v=${v}"`);
  writeFileSync(file, html);
}
const sw = new URL('sw.js', root);
writeFileSync(sw, readFileSync(sw, 'utf8').replace(/const CACHE = 'agraz-[\w-]+';/, `const CACHE = 'agraz-${v}';`));
console.log(`stamped ${v}`);
