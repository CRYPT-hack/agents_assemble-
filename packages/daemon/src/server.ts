import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import { Workspace, dbPath, tokenPath } from '@assemble/core';

import { authorize, loadOrCreateToken, type Guard } from './auth.js';

import { sendJson } from './http.js';
import { buildRouter } from './routes.js';
import { Runtime } from './runtime.js';
import { SocketHub } from './sockets.js';
import { serveStatic } from './static.js';

export interface DaemonOptions {
  /** Any path inside the repository to work. Defaults to the process cwd. */
  cwd?: string;
  /** Port to listen on. 0 picks a free one, which the tests rely on. */
  port?: number;
  host?: string;
  /** Directory of the built console. Resolved from the ui package by default. */
  uiRoot?: string;
  /** Command members run to reach the bus. */
  mcpCommand?: string;
  mcpArgs?: string[];
}

export interface Daemon {
  workspace: Workspace;
  runtime: Runtime;
  hub: SocketHub;
  server: Server;
  /** Every API call and socket must present this. */
  token: string;
  /** Where the console lives, e.g. `http://127.0.0.1:4319`. */
  url: string;
  close(): Promise<void>;
}

/** Where the console's built files ended up, if the package is installed. */
function findUiRoot(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    return join(dirname(require.resolve('@assemble/ui/package.json')), 'dist');
  } catch {
    return undefined;
  }
}

/**
 * Start the workspace daemon: the process that owns the agents, serves the
 * console, and keeps the workspace open for as long as the crew is working.
 */
export async function startDaemon(options: DaemonOptions = {}): Promise<Daemon> {
  const workspace = await Workspace.open({
    ...(options.cwd ? { cwd: options.cwd } : {}),
    launcher: {
      ...(options.mcpCommand ? { command: options.mcpCommand } : {}),
      ...(options.mcpArgs ? { args: options.mcpArgs } : {}),
    },
  });

  const runtime = new Runtime(workspace, {
    mcpCommand: options.mcpCommand ?? 'assemble-mcp',
    mcpArgs: options.mcpArgs ?? [],
    dbPath: dbPath(workspace.config.repoRoot),
    pathPrefix: [join(workspace.config.repoRoot, 'node_modules', '.bin')],
  });

  // Nothing survived the last shutdown; say so before serving anyone.
  workspace.crew.reconcile(runtime.handles());

  const router = buildRouter(workspace, runtime);
  const uiRoot = options.uiRoot ? resolve(options.uiRoot) : findUiRoot();

  // The guard's port is filled in once the socket is bound, because port 0 —
  // which the tests use — is only resolved by listening.
  const guard: Guard = { token: loadOrCreateToken(tokenPath(workspace.config.repoRoot)), port: 0 };

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');

      // The console itself is not behind the token — being served is how it
      // gets one — but everything that can act on the workspace is.
      if (isApi) {
        const verdict = authorize(request, url, guard);
        if (!verdict.ok) {
          sendJson(response, verdict.status, {
            error: { code: 'unauthorized', message: verdict.message, details: {} },
          });
          return;
        }
      }

      if (await router.handle(request, response)) return;

      // The console is a single-page app, so unknown paths fall back to its
      // index.html — but never under /api, where an unmatched route is a 404
      // and callers deserve JSON rather than a page.
      if (!isApi && uiRoot && request.method === 'GET' && serveStatic(uiRoot, url.pathname, response, guard.token)) {
        return;
      }

      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'not_found', message: `No route for ${url.pathname}` } }));
    })();
  });

  const hub = new SocketHub(server, workspace, runtime, guard);
  hub.start();

  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4319;

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolvePromise();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  guard.port = actualPort;

  return {
    workspace,
    runtime,
    hub,
    server,
    token: guard.token,
    url: `http://${host}:${actualPort}`,
    close: async () => {
      runtime.stopAll();
      hub.stop();
      await new Promise<void>((done) => server.close(() => done()));
      workspace.close();
    },
  };
}
