import type { IncomingMessage, ServerResponse } from 'node:http';

import { AssembleError } from '@assemble/core';

export type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: RouteContext,
) => Promise<void> | void;

export interface RouteContext {
  /** Path parameters, e.g. `:handle` becomes `params.handle`. */
  params: Record<string, string>;
  query: URLSearchParams;
  /** Parsed JSON body, `{}` when there is none. */
  body: Record<string, unknown>;
}

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

const MAX_BODY = 4 * 1024 * 1024;

/**
 * A router small enough to read in one sitting.
 *
 * The daemon serves a handful of JSON endpoints and one WebSocket; a framework
 * would be more dependency than code. Patterns are `/api/members/:handle` —
 * static segments match literally, `:name` captures.
 */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split('/').filter(Boolean),
      handler,
    });
    return this;
  }

  get = (pattern: string, handler: Handler): this => this.add('GET', pattern, handler);
  post = (pattern: string, handler: Handler): this => this.add('POST', pattern, handler);
  patch = (pattern: string, handler: Handler): this => this.add('PATCH', pattern, handler);
  delete = (pattern: string, handler: Handler): this => this.add('DELETE', pattern, handler);

  /** Returns false when nothing matched, so the caller can fall through. */
  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);
    const method = (request.method ?? 'GET').toUpperCase();

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = match(route.segments, segments);
      if (!params) continue;

      try {
        const body = method === 'GET' || method === 'DELETE' ? {} : await readJson(request);
        await route.handler(request, response, { params, query: url.searchParams, body });
      } catch (error) {
        sendError(response, error);
      }
      return true;
    }

    return false;
  }
}

function match(pattern: string[], path: string[]): Record<string, string> | undefined {
  if (pattern.length !== path.length) return undefined;

  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i += 1) {
    const expected = pattern[i] as string;
    const actual = path[i] as string;

    if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
    else if (expected !== actual) return undefined;
  }
  return params;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new AssembleError('invalid', 'Request body is too large');
    chunks.push(chunk as Buffer);
  }

  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return {};

  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new AssembleError('invalid', 'Request body is not valid JSON');
  }
}

export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload ?? null);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  response.end(text);
}

const STATUS_FOR: Record<string, number> = {
  not_found: 404,
  unknown_agent: 404,
  unknown_member: 404,
  conflict: 409,
  lease_conflict: 409,
  invalid: 400,
  not_running: 409,
  git_failed: 500,
  spawn_failed: 500,
};

export function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof AssembleError) {
    sendJson(response, STATUS_FOR[error.code] ?? 500, error.toJSON());
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  sendJson(response, 500, { error: { code: 'internal', message, details: {} } });
}
