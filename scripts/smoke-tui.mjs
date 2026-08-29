/**
 * End-to-end check of the terminal console, driven through a real pty.
 *
 * Nothing else can prove this: the console only exists when stdout is a
 * terminal, so a unit test cannot reach it. This spawns `assemble up` in a
 * pseudo-terminal, types at it the way a person would, and asserts on the bytes
 * that come back.
 *
 * Run it by hand: `node scripts/smoke-tui.mjs` (needs the optional pty package).
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const pty = require('@homebridge/node-pty-prebuilt-multiarch');

const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'pipe' });

const repo = mkdtempSync(join(tmpdir(), 'assemble-smoke-'));
git(repo, ['init', '-b', 'main']);
git(repo, ['config', 'user.email', 'demo@example.com']);
git(repo, ['config', 'user.name', 'Demo']);
writeFileSync(join(repo, 'README.md'), '# smoke\n');
git(repo, ['add', '.']);
git(repo, ['commit', '-m', 'initial']);

const cli = join(process.cwd(), 'packages', 'cli', 'dist', 'bin.js');

const term = pty.spawn(process.execPath, [cli, 'up', '--port', '4341'], {
  name: 'xterm-256color',
  cols: 150,
  rows: 40,
  cwd: repo,
  env: { ...process.env, TERM: 'xterm-256color' },
});

let raw = '';
term.onData((chunk) => {
  raw += chunk;
});

let exitCode = null;
term.onExit(({ exitCode: code }) => {
  exitCode = code;
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const type = async (text, pause = 1500) => {
  term.write(text);
  await wait(pause);
};

// Starting a workspace cuts branches and checks out worktrees, which is slow
// the first time on Windows; wait for the console to actually be up.
const upBy = Date.now() + 20000;
while (!raw.includes('No crew yet') && Date.now() < upBy) await wait(250);
const beforeCrew = raw;

await type('/add shell watch the build\r', 4000);
await type('/add shell run the tests\r', 4000);
await type('/task tokenise escaped quotes\r', 1200);
await type('@shell-2 heads up, rebasing\r', 1500);
const withCrew = raw;

await type('/quit\r', 500);

// Give it a moment to unwind on its own; killing would hide a hang.
const deadline = Date.now() + 8000;
while (exitCode === null && Date.now() < deadline) await wait(200);
const exitedOnCommand = exitCode !== null;

if (!exitedOnCommand) term.kill();
await wait(500);
try {
  rmSync(repo, { recursive: true, force: true });
} catch {
  // Windows holds the worktree handle briefly after the shells die.
}

const ESC = String.fromCharCode(27);
const strip = (text) => text.replace(new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g'), '');

const report = {
  exitedOnCommand,
  exitCode,
  enteredAltScreen: raw.includes(`${ESC}[?1049h`),
  leftAltScreen: raw.includes(`${ESC}[?1049l`),
  showedEmptyState: strip(beforeCrew).includes('No crew yet'),
  drewPanes: strip(withCrew).includes('╭') && strip(withCrew).includes('shell'),
  drewWires: strip(withCrew).includes('◀') || strip(withCrew).includes('▶'),
  drewBus: strip(withCrew).includes('assemble-smoke'),
  drewTraffic: strip(withCrew).includes('─▶'),
  sawShellRunning: /PowerShell|bash/.test(strip(withCrew)),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
