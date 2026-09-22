// Serves server/fixtures/sites on http://localhost:8099 so the batch command can be tried offline:
//   npm run fixtures   (in one terminal)
//   npm run evaluate -- --input server/fixtures/cases.sample.json --output kits.json
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/sites');
const TYPES = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain', '.xml': 'application/xml' };

export function startFixtureServer(port = Number(process.env.FIXTURE_PORT || 8099)) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!p.startsWith(root)) return res.writeHead(403).end();
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      if (!url.pathname.endsWith('/')) return res.writeHead(301, { location: url.pathname + '/' }).end();
      p = path.join(p, 'index.html');
    }
    if (!fs.existsSync(p)) return res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>');
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startFixtureServer().then((s) => console.log(`Fixture sites on http://localhost:${s.address().port}/ (acme, globex, initech)`));
}
