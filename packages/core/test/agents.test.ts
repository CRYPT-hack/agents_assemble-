import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { Workspace, findAgent, renderPrompt, resolveAgent } from '../dist/index.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-agents-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Assemble Test']);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'initial']);
  return dir;
}

describe('agent specs', () => {
  it('knows the catalog', () => {
    assert.equal(findAgent('claude')?.command, 'claude');
    assert.equal(findAgent('nothing-like-this'), undefined);
  });

  it('merges overrides onto a catalog entry', () => {
    const spec = resolveAgent('claude', { args: ['--permission-mode', 'acceptEdits'] });

    assert.equal(spec.command, 'claude');
    assert.deepEqual(spec.args, ['--permission-mode', 'acceptEdits']);
    assert.equal(spec.speaksMcp, true);
  });

  it('accepts an agent that is not in the catalog at all', () => {
    const spec = resolveAgent('myagent', { command: 'myagent', args: ['--yes'] });

    assert.equal(spec.id, 'myagent');
    assert.equal(spec.command, 'myagent');
    assert.equal(spec.speaksMcp, false);
  });

  it('refuses an unknown agent that names no command', () => {
    assert.throws(() => resolveAgent('myagent'), /not in the catalog/);
  });

  it('renders a mission into the prompt template', () => {
    const spec = resolveAgent('claude', { promptTemplate: 'Work on: {{mission}}. Ask before editing.' });
    assert.equal(renderPrompt(spec, 'the parser'), 'Work on: the parser. Ask before editing.');
  });
});

describe('workspace agent overrides', () => {
  let repo: string;
  let workspace: Workspace;

  before(async () => {
    repo = makeRepo();
    workspace = await Workspace.open({
      cwd: repo,
      overrides: {
        agents: {
          claude: { args: ['--dangerously-skip-permissions'] },
          house: { name: 'House Agent', command: 'house-cli', speaksMcp: true },
        },
      },
    });
  });

  after(() => {
    workspace?.close();
    rmSync(repo, { recursive: true, force: true });
  });

  it('applies workspace overrides when enlisting', async () => {
    const result = await workspace.crew.enlist({ agentId: 'claude', mission: 'parse' });
    assert.deepEqual(result.spec.args, ['--dangerously-skip-permissions']);
  });

  it('enlists an agent defined only by the workspace', async () => {
    const result = await workspace.crew.enlist({ agentId: 'house', mission: 'review' });

    assert.equal(result.member.handle, 'house');
    assert.equal(result.spec.command, 'house-cli');
  });

  it('writes the bus into the worktree with the member own identity', async () => {
    const member = workspace.crew.require('claude');
    const config = JSON.parse(readFileSync(join(member.worktree, '.mcp.json'), 'utf8'));

    assert.equal(config.mcpServers.assemble.env.ASSEMBLE_HANDLE, 'claude');
    assert.match(config.mcpServers.assemble.env.ASSEMBLE_DB, /workspace\.db$/);
  });
});
