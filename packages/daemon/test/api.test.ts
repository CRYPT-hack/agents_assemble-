import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { startDaemon, type Daemon } from '../dist/index.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-daemon-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Assemble Test']);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'initial']);
  return dir;
}

describe('daemon api', () => {
  let repo: string;
  let daemon: Daemon;
  let base: string;

  const api = async (path: string, init?: RequestInit): Promise<any> => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    return { status: response.status, body: await response.json() };
  };

  before(async () => {
    repo = makeRepo();
    daemon = await startDaemon({ cwd: repo, port: 0 });
    base = daemon.url;
  });

  after(async () => {
    await daemon?.close();
    rmSync(repo, { recursive: true, force: true });
  });

  it('reports health', async () => {
    const { status, body } = await api('/api/health');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(typeof body.pty, 'boolean');
  });

  it('lists the agent catalog', async () => {
    const { body } = await api('/api/agents');
    const ids = body.agents.map((agent: { id: string }) => agent.id);
    assert.ok(ids.includes('claude'));
    assert.ok(ids.includes('codex'));
  });

  it('enlists a member without starting it', async () => {
    const { status, body } = await api('/api/members', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'claude', mission: 'build the parser', start: false }),
    });

    assert.equal(status, 201);
    assert.equal(body.member.handle, 'claude');
    assert.equal(body.started, false);
    assert.match(body.busConfig, /\.mcp\.json$/);
  });

  it('shows the member in the roster with its worktree', async () => {
    const { body } = await api('/api/members');
    const member = body.members.find((m: { handle: string }) => m.handle === 'claude');

    assert.ok(member);
    assert.equal(member.running, false);
    assert.equal(member.branch, 'assemble/claude');
  });

  it('routes a message between two members', async () => {
    await api('/api/members', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'codex', mission: 'write the tests', start: false }),
    });

    const sent = await api('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ from: 'claude', to: ['codex'], subject: 'interface', body: 'parse(x)' }),
    });
    assert.equal(sent.status, 201);

    const { body } = await api('/api/messages?limit=10');
    assert.ok(body.messages.some((message: { subject: string }) => message.subject === 'interface'));
  });

  it('rejects a message to an unknown handle', async () => {
    const { status, body } = await api('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ from: 'claude', to: ['ghost'], subject: 'hi', body: '' }),
    });

    assert.equal(status, 400);
    assert.equal(body.error.code, 'invalid');
  });

  it('creates and advances a task', async () => {
    const created = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'ship the lexer', createdBy: 'workspace', assignee: 'claude' }),
    });
    assert.equal(created.status, 201);

    const updated = await api(`/api/tasks/${created.body.task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ actor: 'claude', status: 'in_progress', note: 'starting now' }),
    });

    assert.equal(updated.status, 200);
    assert.equal(updated.body.task.status, 'in_progress');
  });

  it('reports the git state of a member worktree', async () => {
    const { status, body } = await api('/api/members/claude/diff');
    assert.equal(status, 200);
    assert.equal(body.branch, 'assemble/claude');
    assert.deepEqual(body.changed, []);
  });

  it('refuses to stop a member that is not running', async () => {
    const { status, body } = await api('/api/members/claude/stop', { method: 'POST' });
    assert.equal(status, 409);
    assert.equal(body.error.code, 'not_running');
  });

  it('replays the event log from a sequence number', async () => {
    const { body } = await api('/api/events?since=0');
    const types = new Set(body.events.map((event: { type: string }) => event.type));

    assert.ok(types.has('member.created'));
    assert.ok(types.has('message.sent'));
    assert.ok(body.seq > 0);
  });

  it('answers an unknown route with a json error', async () => {
    const { status, body } = await api('/api/nope');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'not_found');
  });
});
