import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { tokenPath } from '@assemble/core';

import { startDaemon, type Daemon } from '../dist/index.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-auth-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Assemble Test']);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'initial']);
  return dir;
}

/**
 * The daemon can start processes and type into running shells, so reaching it
 * has to be harder than knowing the port. Every page in the operator's browser
 * can talk to 127.0.0.1; none of them should be able to drive their agents.
 */
describe('who may drive the workspace', () => {
  let repo: string;
  let daemon: Daemon;
  let base: string;

  before(async () => {
    repo = makeRepo();
    daemon = await startDaemon({ cwd: repo, port: 0 });
    base = daemon.url;
  });

  after(async () => {
    await daemon?.close();
    rmSync(repo, { recursive: true, force: true });
  });

  it('turns away a caller with no token', async () => {
    const response = await fetch(`${base}/api/members`);
    const body = (await response.json()) as { error: { code: string } };

    assert.equal(response.status, 401);
    assert.equal(body.error.code, 'unauthorized');
  });

  it('turns away a caller with the wrong token', async () => {
    const response = await fetch(`${base}/api/members`, {
      headers: { 'x-assemble-token': 'a'.repeat(daemon.token.length) },
    });
    assert.equal(response.status, 401);
  });

  it('lets the token through', async () => {
    const response = await fetch(`${base}/api/members`, {
      headers: { 'x-assemble-token': daemon.token },
    });
    assert.equal(response.status, 200);
  });

  it('accepts the token in the query string, for sockets', async () => {
    const response = await fetch(`${base}/api/health?token=${daemon.token}`);
    assert.equal(response.status, 200);
  });

  /** Even holding the token, a request a website made is a request to refuse. */
  it('refuses a request sent from another site', async () => {
    const response = await fetch(`${base}/api/members`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-assemble-token': daemon.token,
        origin: 'https://evil.example',
      },
      body: JSON.stringify({ agentId: 'shell' }),
    });

    assert.equal(response.status, 403);
    assert.match(((await response.json()) as { error: { message: string } }).error.message, /evil\.example/);
  });

  /**
   * DNS rebinding points a hostile name at loopback; the Host header is what
   * gives it away. `fetch` refuses to set Host, so this one goes out raw.
   */
  it('refuses a request addressed to a name that is not loopback', async () => {
    const port = Number(new URL(base).port);

    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/api/members',
          headers: { host: 'evil.example', 'x-assemble-token': daemon.token },
        },
        (response) => {
          let body = '';
          response.on('data', (chunk) => {
            body += String(chunk);
          });
          response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
        },
      );

      request.on('error', reject);
      request.end();
    });

    assert.equal(result.status, 403);
    assert.match(result.body, /loopback/);
  });

  it('accepts the console own origin', async () => {
    const origin = base.replace('127.0.0.1', 'localhost');
    const response = await fetch(`${base}/api/health`, {
      headers: { 'x-assemble-token': daemon.token, origin },
    });
    assert.equal(response.status, 200);
  });

  it('refuses a socket without the token', async () => {
    const url = `${base.replace('http', 'ws')}/ws`;
    const closed = await new Promise<number>((resolve) => {
      void import('ws').then(({ WebSocket }) => {
        const socket = new WebSocket(url);
        socket.on('open', () => {
          socket.close();
          resolve(0);
        });
        socket.on('error', () => resolve(1));
      });
    });

    assert.equal(closed, 1, 'an unauthenticated socket should not open');
  });

  it('opens a socket that carries the token', async () => {
    const url = `${base.replace('http', 'ws')}/ws?token=${daemon.token}`;
    const opened = await new Promise<boolean>((resolve) => {
      void import('ws').then(({ WebSocket }) => {
        const socket = new WebSocket(url);
        socket.on('open', () => {
          socket.close();
          resolve(true);
        });
        socket.on('error', () => resolve(false));
      });
    });

    assert.equal(opened, true);
  });

  it('keeps the token in the workspace, where only its owner can read it', () => {
    const stored = readFileSync(tokenPath(repo), 'utf8').trim();

    assert.equal(stored, daemon.token);
    assert.ok(stored.length >= 32, 'a guessable token is no token');
  });
});
