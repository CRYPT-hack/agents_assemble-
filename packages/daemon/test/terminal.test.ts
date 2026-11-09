import assert from 'node:assert/strict';
import { execPath } from 'node:process';
import { dirname } from 'node:path';
import { describe, it } from 'node:test';

import { resolveCommand } from '../dist/index.js';

describe('command resolution', () => {
  it('resolves a bare command on PATH to a path that exists', () => {
    const resolved = resolveCommand('node');

    assert.notEqual(resolved, 'node', 'a bare name on PATH should not stay bare');
    assert.match(resolved, /node(\.exe)?$/i);
  });

  it('leaves an absolute path alone', () => {
    assert.equal(resolveCommand(execPath), execPath);
  });

  it('leaves an unknown command alone so the spawn error can name it', () => {
    assert.equal(resolveCommand('no-such-agent-cli-xyz'), 'no-such-agent-cli-xyz');
  });

  it('searches the PATH it is given rather than the ambient one', () => {
    const resolved = resolveCommand('node', {
      PATH: dirname(execPath),
      PATHEXT: '.EXE',
    });

    assert.equal(resolved.toLowerCase(), execPath.toLowerCase());
  });
});
