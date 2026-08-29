import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { Workspace } from '../dist/index.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-restart-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Assemble Test']);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'initial']);
  return dir;
}

/**
 * A workspace that was killed leaves members marked working whose processes
 * died with it. Reopening must not inherit that fiction.
 */
describe('restart reconciliation', () => {
  let repo: string;
  let workspace: Workspace;

  before(async () => {
    repo = makeRepo();
    workspace = await Workspace.open({ cwd: repo });

    await workspace.crew.enlist({ agentId: 'claude', handle: 'alice', mission: 'parse' });
    await workspace.crew.enlist({ agentId: 'codex', handle: 'bob', mission: 'test' });

    workspace.crew.setStatus('alice', 'working');
    workspace.crew.setStatus('bob', 'working');

    workspace.leases.acquire({ holder: 'alice', paths: ['src/**'], reason: 'rewriting' });
    const task = workspace.board.create({ title: 'ship it', createdBy: 'workspace' });
    workspace.board.claim(task.id, 'alice');
  });

  after(() => {
    workspace?.close();
    rmSync(repo, { recursive: true, force: true });
  });

  it('stands down members that are no longer running', () => {
    const stale = workspace.crew.reconcile([]);

    assert.deepEqual(stale.map((member) => member.handle).sort(), ['alice', 'bob']);
    assert.equal(workspace.crew.require('alice').status, 'stopped');
    assert.equal(workspace.crew.require('bob').status, 'stopped');
  });

  it('frees their claims and returns their work', () => {
    assert.equal(workspace.leases.heldBy('alice').length, 0);
    assert.equal(workspace.board.list({ assignee: 'alice' }).length, 0);
    assert.equal(workspace.board.available().length, 1);
  });

  it('reports the restart once, not once per member', () => {
    const notices = workspace.bus
      .recent(50)
      .filter((message) => message.subject === 'workspace restarted');

    assert.equal(notices.length, 1);
    assert.match(notices[0]!.body, /alice, bob/);
  });

  it('leaves members that really are running alone', () => {
    workspace.crew.setStatus('alice', 'working');

    const stale = workspace.crew.reconcile(['alice']);
    assert.deepEqual(stale, []);
    assert.equal(workspace.crew.require('alice').status, 'working');
  });
});
