import { createReadStream, existsSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Serve the built console.
 *
 * Single-page app rules: a request for a real file gets that file, anything
 * else gets `index.html` so client-side routes survive a refresh. Paths are
 * resolved and checked against the root, so `..` cannot escape it.
 */
export function serveStatic(root: string, pathname: string, response: ServerResponse): boolean {
  const rootPath = resolve(root);
  if (!existsSync(rootPath)) return false;

  const requested = resolve(join(rootPath, normalize(pathname).replace(/^([/\\])+/, '')));
  const inside = requested === rootPath || requested.startsWith(rootPath + sep);

  let file = inside && existsSync(requested) && statSync(requested).isFile() ? requested : '';
  if (!file) {
    const index = join(rootPath, 'index.html');
    if (!existsSync(index)) return false;
    file = index;
  }

  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
  });
  createReadStream(file).pipe(response);
  return true;
}
