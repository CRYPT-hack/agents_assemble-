import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { dirname } from 'node:path';

/**
 * Who is allowed to drive the workspace.
 *
 * The daemon can start processes and type into running shells, so an open port
 * on loopback is not a small thing: any page in the operator's browser can
 * reach 127.0.0.1, and a `fetch` from a hostile site would otherwise be
 * indistinguishable from the console. Three checks, and a request has to pass
 * all of them:
 *
 * 1. **Host** must name loopback. A DNS rebinding attack points a hostile
 *    domain at 127.0.0.1, but the browser still sends that domain in `Host`.
 * 2. **Origin**, when present, must be this daemon. Browsers always send it on
 *    cross-origin requests, which is what makes this a CSRF check.
 * 3. **Token**, which the console gets by being served from here and the CLI
 *    reads from the workspace directory. A page that cannot read either cannot
 *    guess it.
 */

export const TOKEN_HEADER = 'x-assemble-token';

export interface Guard {
  token: string;
  port: number;
}

export function createToken(): string {
  return randomBytes(24).toString('hex');
}

/**
 * The token for this workspace, created on first use.
 *
 * It lives beside the database, which is already excluded from the repository,
 * and is written owner-only where the platform understands that.
 */
export function loadOrCreateToken(file: string): string {
  try {
    if (existsSync(file)) {
      const existing = readFileSync(file, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
  } catch {
    // Unreadable token file: mint a new one over the top of it.
  }

  const token = createToken();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${token}\n`, { encoding: 'utf8', mode: 0o600 });

  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows does not model this permission; the directory is already private.
  }

  return token;
}

export type Verdict = { ok: true } | { ok: false; status: number; message: string };

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Strip the port from a Host or Origin authority. */
function hostnameOf(authority: string): string {
  const withoutScheme = authority.replace(/^[a-z]+:\/\//i, '');
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(withoutScheme);
  return match?.[1]?.toLowerCase() ?? '';
}

function portOf(authority: string): number | undefined {
  const withoutScheme = authority.replace(/^[a-z]+:\/\//i, '');
  const match = /:(\d+)$/.exec(withoutScheme);
  return match?.[1] ? Number(match[1]) : undefined;
}

/** Constant-time-ish comparison, so a wrong token leaks nothing by timing. */
function sameToken(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;

  let difference = 0;
  for (let i = 0; i < given.length; i += 1) {
    difference |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

export function tokenFrom(request: IncomingMessage, url: URL): string {
  const header = request.headers[TOKEN_HEADER];
  if (typeof header === 'string' && header !== '') return header;

  return url.searchParams.get('token') ?? '';
}

/** Run every check. Returns why it failed, so the daemon can say so. */
export function authorize(request: IncomingMessage, url: URL, guard: Guard): Verdict {
  const host = request.headers.host ?? '';
  if (!LOOPBACK.has(hostnameOf(host))) {
    return {
      ok: false,
      status: 403,
      message: 'This workspace only answers to loopback. Reach it at 127.0.0.1.',
    };
  }

  const origin = request.headers.origin;
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    const sameHost = LOOPBACK.has(hostnameOf(origin));
    const samePort = portOf(origin) === guard.port;

    if (!sameHost || !samePort) {
      return {
        ok: false,
        status: 403,
        message: `Refused a request from ${origin}. The workspace is not a public API.`,
      };
    }
  }

  if (!sameToken(tokenFrom(request, url), guard.token)) {
    return {
      ok: false,
      status: 401,
      message:
        'Missing or wrong workspace token. The console is served with one; the CLI reads it from ' +
        '.assemble/token inside the repository.',
    };
  }

  return { ok: true };
}
