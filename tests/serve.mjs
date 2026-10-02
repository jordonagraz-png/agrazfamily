// Tiny static server for local preview and tests:  npm run serve
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml'
};

export function start(port = 0) {
  const server = http.createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep) && file !== ROOT) { res.writeHead(403).end(); return; }
    try {
      if ((await stat(file)).isDirectory()) {
        if (!path.endsWith('/')) { res.writeHead(301, { location: path + '/' }).end(); return; }
        file = join(file, 'index.html');
      }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      const body = await readFile(join(ROOT, '404.html')).catch(() => '');
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      res.end(body);
    }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await start(Number(process.env.PORT) || 8080);
  console.log(`Serving the site at http://127.0.0.1:${server.address().port}/`);
}
