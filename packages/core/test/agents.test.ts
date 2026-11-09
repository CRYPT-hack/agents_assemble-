import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

describe('bus config formats', () => {
  let repo: string;
  let workspace: Workspace;

  // Each file already holds a server, so the tests show the writer merges
  // rather than replacing whatever the repository already configured.
  before(async () => {
    repo = makeRepo();
    writeFileSync(
      join(repo, 'opencode.json'),
      `${JSON.stringify({ mcp: { existing: { type: 'local', command: ['existing'] } } }, null, 2)}\n`,
    );
    writeFileSync(
      join(repo, 'crush.json'),
      `${JSON.stringify({ mcp: { existing: { type: 'stdio', command: 'existing' } } }, null, 2)}\n`,
    );
    mkdirSync(join(repo, '.goose'), { recursive: true });
    writeFileSync(
      join(repo, '.goose', 'config.yaml'),
      'extensions:\n  existing:\n    enabled: true\n    type: stdio\n    name: existing\n    cmd: "existing"\n    args: []\n    envs: {}\n    timeout: 300\n',
    );
    git(repo, ['add', '.']);
    git(repo, ['commit', '-m', 'existing agent configs']);

    workspace = await Workspace.open({
      cwd: repo,
      overrides: {
        agents: {
          oc: {
            name: 'OC',
            command: 'oc',
            speaksMcp: true,
            mcpConfig: { file: 'opencode.json', format: 'opencode-json' },
          },
          cr: {
            name: 'CR',
            command: 'cr',
            speaksMcp: true,
            mcpConfig: { file: 'crush.json', format: 'crush-json' },
          },
          gs: {
            name: 'GS',
            command: 'gs',
            speaksMcp: true,
            mcpConfig: { file: '.goose/config.yaml', format: 'goose-yaml' },
          },
        },
      },
    });
  });

  after(() => {
    workspace?.close();
    rmSync(repo, { recursive: true, force: true });
  });

  it('writes OpenCode servers under mcp with one command array', async () => {
    const { member } = await workspace.crew.enlist({ agentId: 'oc', mission: 'x' });
    const config = JSON.parse(readFileSync(join(member.worktree, 'opencode.json'), 'utf8'));

    assert.equal(config.mcp.assemble.type, 'local');
    assert.deepEqual(config.mcp.assemble.command.slice(0, 1), ['assemble-mcp']);
    assert.ok(Array.isArray(config.mcp.assemble.command), 'OpenCode wants one command array');
    assert.equal(config.mcp.assemble.environment.ASSEMBLE_HANDLE, 'oc');
    assert.ok(config.mcp.existing, 'kept the server the repository already had');
  });

  it('writes Crush servers under mcp with command and args apart', async () => {
    const { member } = await workspace.crew.enlist({ agentId: 'cr', mission: 'x' });
    const config = JSON.parse(readFileSync(join(member.worktree, 'crush.json'), 'utf8'));

    assert.equal(config.mcp.assemble.type, 'stdio');
    assert.equal(config.mcp.assemble.command, 'assemble-mcp');
    assert.ok(Array.isArray(config.mcp.assemble.args));
    assert.equal(config.mcp.assemble.env.ASSEMBLE_HANDLE, 'cr');
    assert.ok(config.mcp.existing, 'kept the server the repository already had');
  });

  it('writes Goose extensions as YAML and keeps the rest of the file', async () => {
    const { member } = await workspace.crew.enlist({ agentId: 'gs', mission: 'x' });
    const config = readFileSync(join(member.worktree, '.goose', 'config.yaml'), 'utf8');

    assert.match(config, /^extensions:$/m);
    assert.match(config, /^ {2}assemble:$/m);
    assert.match(config, /ASSEMBLE_HANDLE: "gs"/);
    assert.match(config, /^ {2}existing:$/m);
  });
});
