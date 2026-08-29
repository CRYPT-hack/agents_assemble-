import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { Workspace, assertHandle, assertRef, isHandle, toHandle } from '../dist/index.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-guards-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Assemble Test']);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'initial']);
  return dir;
}

describe('names that become paths and refs', () => {
  it('accepts ordinary handles', () => {
    for (const handle of ['claude', 'claude-2', 'codex_1', 'a', 'my.agent']) {
      assert.equal(isHandle(handle), true, `${handle} should be usable`);
    }
  });

  it('refuses anything that would climb out of the worktree root', () => {
    for (const handle of ['..', '../escape', 'a/../b', 'a/b', 'a\\b', '.hidden', '']) {
      assert.equal(isHandle(handle), false, `${handle} should be refused`);
    }
  });

  it('refuses handles that would break a branch name', () => {
    for (const handle of ['-lead', 'has space', 'star*', 'colon:', 'tilde~']) {
      assert.throws(() => assertHandle(handle), /not a usable handle/);
    }
  });

  it('turns arbitrary text into something usable', () => {
    assert.equal(toHandle('Claude Code'), 'claude-code');
    assert.equal(toHandle('../../etc/passwd'), 'etc-passwd');
    assert.equal(toHandle('!!!'), 'agent');
  });

  /**
   * git reads its arguments positionally, so a ref that starts with a dash is
   * not a ref — it is an option, and some of git's options run programs.
   */
  it('refuses a ref that git would read as an option', () => {
    assert.throws(() => assertRef('--upload-pack=touch /tmp/pwn'), /cannot start with a dash/);
    assert.throws(() => assertRef('-b'), /cannot start with a dash/);
  });

  it('refuses refs git itself would reject', () => {
    for (const ref of ['has space', 'a..b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'ends.', 'x.lock']) {
      assert.throws(() => assertRef(ref), /cannot/);
    }
  });

  it('accepts the refs people actually use', () => {
    for (const ref of ['main', 'assemble/claude', 'release/1.2.x', 'feature_a']) {
      assert.equal(assertRef(ref), ref);
    }
  });
});

describe('a workspace refuses what it cannot safely do', () => {
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

  it('will not enlist a member whose handle escapes the workspace', async () => {
    await assert.rejects(
      () => workspace.crew.enlist({ agentId: 'claude', handle: '../../../escaped' }),
      /not a usable handle/,
    );

    // Nothing half-created: no worktree, no member, no stray directory.
    assert.equal(workspace.crew.list().length, 0);
    assert.equal(existsSync(join(repo, '..', 'escaped')), false);
    assert.deepEqual(readdirSync(workspace.config.worktreeRoot), []);
  });

  it('will not cut a branch from something that is really a git option', async () => {
    await assert.rejects(
      () => workspace.crew.enlist({ agentId: 'claude', base: '--upload-pack=echo' }),
      /cannot start with a dash/,
    );

    assert.equal(workspace.crew.list().length, 0);
  });

  it('will not carry a message from somebody who does not exist', async () => {
    await workspace.crew.enlist({ agentId: 'claude', handle: 'alice' });

    assert.throws(
      () => workspace.bus.send({ from: 'ghost', subject: 'I am not real' }),
      /needs a real sender/,
    );

    // The workspace itself, and real members, still speak.
    assert.ok(workspace.bus.send({ from: 'workspace', subject: 'announcement' }));
    assert.ok(workspace.bus.send({ from: 'alice', subject: 'genuine' }));
  });

  it('will not renew a claim that has already lapsed', () => {
    const granted = workspace.leases.acquire({
      holder: 'alice',
      paths: ['src/**'],
      ttlSeconds: 30,
    }).granted;
    assert.ok(granted);

    // Someone else may have taken these paths in the meantime.
    workspace.leases.release(granted.id, 'alice');

    assert.throws(() => workspace.leases.renew(granted.id, 'alice'), /already lapsed/);
  });

  it('will not let one member renew another member claim', async () => {
    await workspace.crew.enlist({ agentId: 'codex', handle: 'bob' });

    const granted = workspace.leases.acquire({ holder: 'alice', paths: ['docs/**'] }).granted;
    assert.ok(granted);

    assert.throws(() => workspace.leases.renew(granted.id, 'bob'), /belongs to alice/);
  });
});

describe('a config that came with the repository', () => {
  let repo: string;

  before(() => {
    repo = makeRepo();

    // A hostile clone: the workspace config is committed, and it decides which
    // program "claude" actually is.
    mkdirSync(join(repo, '.assemble'), { recursive: true });
    writeFileSync(
      join(repo, '.assemble', 'workspace.json'),
      JSON.stringify({
        name: 'trap',
        repoRoot: repo,
        worktreeRoot: join(repo, '.assemble', 'worktrees'),
        baseBranch: 'main',
        branchPrefix: 'assemble/',
        leaseTtlSeconds: 1800,
        agents: { claude: { command: 'definitely-not-claude' } },
      }),
    );

    git(repo, ['add', '-f', '.assemble/workspace.json']);
    git(repo, ['commit', '-m', 'ship a workspace config']);
  });

  after(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('does not let it choose which programs the agents are', async () => {
    const workspace = await Workspace.open({ cwd: repo });

    try {
      assert.equal(workspace.config.agents, undefined, 'committed agent definitions should be dropped');

      const result = await workspace.crew.enlist({ agentId: 'claude', handle: 'alice' });
      assert.equal(result.spec.command, 'claude', 'the catalog entry should win');
    } finally {
      workspace.close();
    }
  });

  it('says so, rather than dropping them quietly', async () => {
    const workspace = await Workspace.open({ cwd: repo });

    try {
      const told = workspace.bus
        .recent(20)
        .some((message) => message.subject.includes('ignored agent definitions'));

      assert.ok(told, 'the crew should be told the definitions were ignored');
    } finally {
      workspace.close();
    }
  });
});
