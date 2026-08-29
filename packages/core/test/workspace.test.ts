import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { Workspace } from '../dist/index.js';

function run(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** A throwaway repository with one commit, which is all `enlist` requires. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-test-'));
  run(dir, ['init', '-b', 'main']);
  run(dir, ['config', 'user.email', 'test@example.com']);
  run(dir, ['config', 'user.name', 'Assemble Test']);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  run(dir, ['add', '.']);
  run(dir, ['commit', '-m', 'initial']);
  return dir;
}

describe('workspace', () => {
  let repo: string;
  let workspace: Workspace;

  before(async () => {
    repo = makeRepo();
    workspace = await Workspace.open({ cwd: repo });
  });

  after(() => {
    workspace?.close();
    rmSync(repo, { recursive: true, force: true });
  });

  it('opens on a repository and adopts its branch as the base', () => {
    assert.equal(workspace.config.baseBranch, 'main');
    assert.equal(workspace.config.branchPrefix, 'assemble/');
  });

  it('enlists members into their own worktrees', async () => {
    const first = await workspace.crew.enlist({ agentId: 'claude', mission: 'build the parser' });
    const second = await workspace.crew.enlist({ agentId: 'codex', mission: 'write the tests' });

    assert.equal(first.member.handle, 'claude');
    assert.equal(second.member.handle, 'codex');
    assert.equal(first.member.branch, 'assemble/claude');
    assert.notEqual(first.member.worktree, second.member.worktree);
    assert.equal(workspace.crew.list().length, 2);
  });

  it('mints a distinct handle for a second member of the same agent', async () => {
    const third = await workspace.crew.enlist({ agentId: 'claude', mission: 'review' });
    assert.equal(third.member.handle, 'claude-2');
  });

  it('delivers a direct message to one inbox only', () => {
    workspace.bus.send({
      from: 'claude',
      to: ['codex'],
      subject: 'parser signature',
      body: 'parse(input: string): Ast',
    });

    const codex = workspace.bus.readInbox('codex');
    assert.ok(codex.some((message) => message.subject === 'parser signature'));
    assert.equal(workspace.bus.inbox('claude-2', { unreadOnly: true }).some((m) => m.subject === 'parser signature'), false);
  });

  it('threads a reply onto the message it answers', () => {
    const root = workspace.bus.send({ from: 'claude', to: ['codex'], subject: 'ping', body: 'ready?' });
    const reply = workspace.bus.send({
      from: 'codex',
      to: ['claude'],
      subject: 're: ping',
      body: 'ready',
      replyTo: root.id,
    });

    assert.equal(reply.threadId, root.threadId);
    assert.equal(workspace.bus.thread(root.threadId).length, 2);
  });

  it('refuses a message to a handle nobody answers to', () => {
    assert.throws(
      () => workspace.bus.send({ from: 'claude', to: ['nobody'], subject: 'hello', body: 'there' }),
      /Unknown recipients/,
    );
  });

  it('grants a lease and blocks an overlapping one', () => {
    const first = workspace.leases.acquire({
      holder: 'claude',
      paths: ['src/parser/**/*.ts'],
      reason: 'rewriting the parser',
    });
    assert.ok(first.granted);

    const second = workspace.leases.acquire({ holder: 'codex', paths: ['src/parser/lexer.ts'] });
    assert.equal(second.granted, undefined);
    assert.equal(second.conflicts[0]?.lease.holder, 'claude');

    const elsewhere = workspace.leases.acquire({ holder: 'codex', paths: ['test/**/*.ts'] });
    assert.ok(elsewhere.granted);
  });

  it('releases a lease back to the crew', () => {
    const held = workspace.leases.heldBy('claude');
    assert.ok(held[0]);
    workspace.leases.release(held[0].id, 'claude');

    const retry = workspace.leases.acquire({ holder: 'codex', paths: ['src/parser/lexer.ts'] });
    assert.ok(retry.granted);
  });

  it('lets exactly one member claim a task', () => {
    const task = workspace.board.create({ title: 'ship the lexer', createdBy: 'workspace' });

    assert.ok(workspace.board.claim(task.id, 'claude'));
    assert.equal(workspace.board.claim(task.id, 'codex'), undefined);
    assert.equal(workspace.board.find(task.id)?.assignee, 'claude');
  });

  it('holds a task back until its dependency is done', () => {
    const first = workspace.board.create({ title: 'design api', createdBy: 'workspace' });
    const second = workspace.board.create({
      title: 'implement api',
      createdBy: 'workspace',
      dependsOn: [first.id],
    });

    assert.equal(workspace.board.available().some((task) => task.id === second.id), false);

    workspace.board.claim(first.id, 'codex');
    workspace.board.transition(first.id, 'codex', 'done');

    assert.ok(workspace.board.available().some((task) => task.id === second.id));
  });

  it('returns work to the pool when a member stands down', () => {
    const task = workspace.board.create({ title: 'orphan work', createdBy: 'workspace' });
    workspace.board.claim(task.id, 'claude-2');
    workspace.leases.acquire({ holder: 'claude-2', paths: ['docs/**'] });

    workspace.crew.standDown('claude-2', 'out of budget');

    assert.equal(workspace.board.find(task.id)?.status, 'backlog');
    assert.equal(workspace.board.find(task.id)?.assignee, undefined);
    assert.equal(workspace.leases.heldBy('claude-2').length, 0);
    assert.equal(workspace.crew.require('claude-2').status, 'stopped');
  });

  it('records every step on the event stream', () => {
    const events = workspace.events.since(0, 1000);
    const types = new Set(events.map((event) => event.type));

    assert.ok(types.has('workspace.opened'));
    assert.ok(types.has('member.created'));
    assert.ok(types.has('message.sent'));
    assert.ok(types.has('lease.acquired'));
    assert.ok(types.has('task.created'));
  });
});
