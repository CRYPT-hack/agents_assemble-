import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Workspace, dbPath } from '@assemble/core';

import { createServer } from '../dist/index.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-mcp-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Assemble Test']);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'initial']);
  return dir;
}

/** Tool replies are JSON in a single text block. */
function payload(result: unknown): any {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  assert.equal(content[0]?.type, 'text');
  return JSON.parse(content[0]!.text);
}

describe('mcp tools', () => {
  let repo: string;
  let workspace: Workspace;
  let client: Client;
  let close: () => void;

  before(async () => {
    repo = makeRepo();
    workspace = await Workspace.open({ cwd: repo });
    await workspace.crew.enlist({ agentId: 'claude', mission: 'build the parser' });
    await workspace.crew.enlist({ agentId: 'codex', mission: 'write the tests' });

    const built = createServer({ handle: 'claude', dbPath: dbPath(repo) });
    close = built.close;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([built.server.connect(serverTransport), client.connect(clientTransport)]);
  });

  after(async () => {
    await client?.close();
    close?.();
    workspace?.close();
    rmSync(repo, { recursive: true, force: true });
  });

  it('advertises the coordination tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    assert.deepEqual(names, [
      'channels',
      'check_inbox',
      'claim_files',
      'claim_task',
      'create_task',
      'list_tasks',
      'read_thread',
      'release_files',
      'reply_to_message',
      'send_message',
      'set_my_status',
      'update_task',
      'who_is_editing',
      'whos_here',
    ]);
  });

  it('reports the crew, and who the caller is', async () => {
    const result = payload(await client.callTool({ name: 'whos_here', arguments: {} }));

    assert.equal(result.me, 'claude');
    assert.deepEqual(
      result.members.map((member: { handle: string }) => member.handle).sort(),
      ['claude', 'codex'],
    );
  });

  it('sends a message that lands in another member inbox', async () => {
    await client.callTool({
      name: 'send_message',
      arguments: { to: ['codex'], subject: 'parser shape', body: 'parse(input): Ast' },
    });

    const inbox = workspace.bus.inbox('codex', { unreadOnly: true });
    assert.ok(inbox.some((message) => message.subject === 'parser shape'));
  });

  it('claims files and then refuses an overlapping claim', async () => {
    const granted = payload(
      await client.callTool({
        name: 'claim_files',
        arguments: { paths: ['src/parser/**/*.ts'], reason: 'rewrite' },
      }),
    );
    assert.equal(granted.granted, true);

    const conflict = workspace.leases.acquire({ holder: 'codex', paths: ['src/parser/lexer.ts'] });
    assert.equal(conflict.granted, undefined);
    assert.equal(conflict.conflicts[0]?.lease.holder, 'claude');
  });

  it('tells a blocked claimant who is in the way', async () => {
    workspace.leases.acquire({ holder: 'codex', paths: ['docs/**'], reason: 'writing docs' });

    const blocked = payload(
      await client.callTool({ name: 'claim_files', arguments: { paths: ['docs/guide.md'] } }),
    );

    assert.equal(blocked.granted, false);
    assert.equal(blocked.blockedBy[0].holder, 'codex');
    assert.equal(blocked.blockedBy[0].reason, 'writing docs');
  });

  it('creates and claims a task through the board', async () => {
    const created = payload(
      await client.callTool({ name: 'create_task', arguments: { title: 'ship the lexer' } }),
    );

    const claimed = payload(
      await client.callTool({ name: 'claim_task', arguments: { taskId: created.id } }),
    );
    assert.equal(claimed.claimed, true);
    assert.equal(claimed.task.assignee, 'claude');

    const again = workspace.board.claim(created.id, 'codex');
    assert.equal(again, undefined);
  });

  it('drains the inbox and marks it read', async () => {
    workspace.bus.send({ from: 'codex', to: ['claude'], subject: 'heads up', body: 'lexer moved' });

    const first = payload(await client.callTool({ name: 'check_inbox', arguments: {} }));
    assert.ok(first.messages.some((message: { subject: string }) => message.subject === 'heads up'));

    const second = payload(await client.callTool({ name: 'check_inbox', arguments: {} }));
    assert.equal(
      second.messages.some((message: { subject: string }) => message.subject === 'heads up'),
      false,
    );
  });

  it('records the caller status against its own handle', async () => {
    await client.callTool({
      name: 'set_my_status',
      arguments: { status: 'blocked', note: 'waiting on the lexer' },
    });

    const member = workspace.crew.require('claude');
    assert.equal(member.status, 'blocked');
    assert.equal(member.note, 'waiting on the lexer');
  });

  it('returns an error result rather than throwing on bad input', async () => {
    const result = await client.callTool({
      name: 'send_message',
      arguments: { to: ['ghost'], subject: 'hello', body: 'there' },
    });

    assert.equal(result.isError, true);
    assert.match(payload(result).error, /Unknown recipients/);
  });
});
