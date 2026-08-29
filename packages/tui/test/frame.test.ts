import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { startDaemon, type Daemon } from '@assemble/daemon';

import { Screen, Tui } from '../dist/index.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-tui-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Assemble Test']);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'initial']);
  return dir;
}

/** A terminal of a fixed size that throws its output away. */
function fakeScreen(cols: number, rows: number): Screen {
  const out = {
    columns: cols,
    rows,
    write: () => true,
    on: () => out,
    off: () => out,
  } as unknown as NodeJS.WriteStream;

  const input = {
    isTTY: false,
    on: () => input,
    off: () => input,
    resume: () => input,
    pause: () => input,
    setEncoding: () => input,
    setRawMode: () => input,
  } as unknown as NodeJS.ReadStream;

  return new Screen(out, input);
}

const strip = (line: string): string => line.replace(/\[[0-9;?]*[A-Za-z]/g, '');

describe('terminal console', () => {
  let repo: string;
  let daemon: Daemon;

  before(async () => {
    repo = makeRepo();
    daemon = await startDaemon({ cwd: repo, port: 0 });
  });

  after(async () => {
    await daemon?.close();
    rmSync(repo, { recursive: true, force: true });
  });

  it('says what to do when there is no crew', () => {
    const tui = new Tui({ daemon, screen: fakeScreen(120, 34) });
    const text = tui.frame().map(strip).join('\n');

    assert.match(text, /No crew yet/);
    assert.match(text, /\/add claude/);
    assert.match(text, /\/quit/);
  });

  it('draws a pane per member, with the bus between them', async () => {
    await daemon.workspace.crew.enlist({ agentId: 'claude', handle: 'alice', mission: 'write the parser' });
    await daemon.workspace.crew.enlist({ agentId: 'codex', handle: 'bob', mission: 'write the tests' });
    await daemon.workspace.crew.enlist({ agentId: 'gemini', handle: 'carol', mission: 'review both' });

    const tui = new Tui({ daemon, screen: fakeScreen(160, 44) });
    const lines = tui.frame().map(strip);
    const text = lines.join('\n');

    for (const handle of ['alice', 'bob', 'carol']) {
      assert.ok(text.includes(handle), `${handle} should have a pane`);
    }

    // Window chrome, wires, and the bus in the middle.
    assert.ok(text.includes('╭'), 'panes should be boxed');
    assert.ok(text.includes('─'), 'wires and borders should be drawn');
    assert.ok(text.includes('▶') || text.includes('◀'), 'wires should arrive with an arrowhead');

    const busName = daemon.workspace.config.name.slice(0, 8);
    assert.ok(text.includes(busName), 'the bus should be labelled with the workspace');
  });

  it('shows each mission and the crew counts', () => {
    const tui = new Tui({ daemon, screen: fakeScreen(160, 44) });
    const text = tui.frame().map(strip).join('\n');

    assert.match(text, /write the parser/);
    assert.match(text, /3 crew/);
    assert.match(text, /0 running/);
  });

  it('offers the command line at the bottom', () => {
    const tui = new Tui({ daemon, screen: fakeScreen(160, 44) });
    const lines = tui.frame().map(strip);
    const last = lines[lines.length - 1] ?? '';

    assert.match(last, /alice/);
    assert.match(last, /@handle to message/);
  });

  it('fits the frame to the terminal it was given', () => {
    for (const [cols, rows] of [
      [80, 24],
      [120, 30],
      [200, 60],
    ] as Array<[number, number]>) {
      const tui = new Tui({ daemon, screen: fakeScreen(cols, rows) });
      const lines = tui.frame();

      assert.equal(lines.length, rows, `${cols}x${rows} should produce ${rows} lines`);
      for (const line of lines) {
        assert.ok(strip(line).length <= cols, `a line overflowed ${cols} columns`);
      }
    }
  });

  it('still lays out when the terminal is too narrow for a grid', () => {
    const tui = new Tui({ daemon, screen: fakeScreen(60, 20) });
    const text = tui.frame().map(strip).join('\n');

    assert.ok(text.includes('alice'), 'a narrow terminal should still show a pane');
  });
});
