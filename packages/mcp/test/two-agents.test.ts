import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Workspace, dbPath } from '@assemble/core';

/**
 * The whole point of the project, tested end to end.
 *
 * Two separate processes — one per member, exactly as the daemon launches them —
 * connect to the same workspace over stdio and coordinate: they see each other,
 * collide on a file, negotiate by message, hand the file over, and race for the
 * same task with only one winner.
 */

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'bin.js');

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-e2e-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Assemble Test']);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'initial']);
  return dir;
}

/** Connect a client to a freshly spawned server, as that member. */
async function joinAs(handle: string, db: string): Promise<Client> {
  const client = new Client({ name: `test-${handle}`, version: '0.0.0' });

  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      env: { ...(process.env as Record<string, string>), ASSEMBLE_HANDLE: handle, ASSEMBLE_DB: db },
      stderr: 'ignore',
    }),
  );

  return client;
}

/** Tool replies are JSON in one text block. */
function payload(result: unknown): any {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(content[0]!.text);
}

describe('two agents on one project', () => {
  let repo: string;
  let workspace: Workspace;
  let alice: Client;
  let bob: Client;

  before(async () => {
    repo = makeRepo();
    workspace = await Workspace.open({ cwd: repo });
    await workspace.crew.enlist({ agentId: 'claude', handle: 'alice', mission: 'write the parser' });
    await workspace.crew.enlist({ agentId: 'codex', handle: 'bob', mission: 'write the tests' });

    const db = dbPath(repo);
    alice = await joinAs('alice', db);
    bob = await joinAs('bob', db);
  });

  after(async () => {
    await alice?.close();
    await bob?.close();
    workspace?.close();
    rmSync(repo, { recursive: true, force: true });
  });

  it('each sees the other on the bus', async () => {
    const seen = payload(await alice.callTool({ name: 'whos_here', arguments: {} }));

    assert.equal(seen.me, 'alice');
    assert.deepEqual(
      seen.members.map((member: { handle: string }) => member.handle).sort(),
      ['alice', 'bob'],
    );
  });

  it('the first to claim a file gets it', async () => {
    const claim = payload(
      await alice.callTool({
        name: 'claim_files',
        arguments: { paths: ['src/parser.ts'], reason: 'writing the tokeniser' },
      }),
    );

    assert.equal(claim.granted, true);
    assert.deepEqual(claim.lease.paths, ['src/parser.ts']);
  });

  it('the second is told who holds it, and why', async () => {
    const blocked = payload(
      await bob.callTool({ name: 'claim_files', arguments: { paths: ['src/**/*.ts'] } }),
    );

    assert.equal(blocked.granted, false);
    assert.equal(blocked.blockedBy[0].holder, 'alice');
    assert.equal(blocked.blockedBy[0].reason, 'writing the tokeniser');
  });

  it('so it asks, rather than editing anyway', async () => {
    await bob.callTool({
      name: 'send_message',
      arguments: {
        to: ['alice'],
        subject: 'src/parser.ts',
        body: 'I need it for the tests. Tell me when you are out of it.',
        priority: 'high',
      },
    });

    const inbox = payload(await alice.callTool({ name: 'check_inbox', arguments: {} }));
    const asked = inbox.messages.find((message: { from: string }) => message.from === 'bob');

    assert.ok(asked, 'alice should have heard from bob');
    assert.equal(asked.subject, 'src/parser.ts');
    assert.equal(asked.priority, 'high');
  });

  it('and gets it once the holder lets go', async () => {
    await alice.callTool({ name: 'release_files', arguments: {} });
    await alice.callTool({
      name: 'send_message',
      arguments: { to: ['bob'], subject: 're: src/parser.ts', body: 'All yours.' },
    });

    const granted = payload(
      await bob.callTool({ name: 'claim_files', arguments: { paths: ['src/**/*.ts'] } }),
    );
    assert.equal(granted.granted, true);

    const inbox = payload(await bob.callTool({ name: 'check_inbox', arguments: {} }));
    assert.ok(inbox.messages.some((message: { subject: string }) => message.subject === 're: src/parser.ts'));
  });

  it('a task can only be claimed once, even in a race', async () => {
    const task = payload(
      await alice.callTool({ name: 'create_task', arguments: { title: 'tokenise escaped quotes' } }),
    );

    const [first, second] = await Promise.all([
      alice.callTool({ name: 'claim_task', arguments: { taskId: task.id } }),
      bob.callTool({ name: 'claim_task', arguments: { taskId: task.id } }),
    ]);

    const results = [payload(first), payload(second)];
    const winners = results.filter((result) => result.claimed);
    const losers = results.filter((result) => !result.claimed);

    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].heldBy, winners[0].task.assignee);
  });

  it('the workspace log names who did what', () => {
    const actors = new Set(workspace.events.since(0, 1000).map((event) => event.actor));

    assert.ok(actors.has('alice'));
    assert.ok(actors.has('bob'));
  });
});
