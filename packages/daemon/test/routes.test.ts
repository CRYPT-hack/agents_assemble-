import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { requiredRaw } from '../dist/routes.js';

describe('terminal input validation', () => {
  it('accepts a bare carriage return, which is how Enter reaches a pty', () => {
    assert.equal(requiredRaw({ data: '\r' }, 'data'), '\r');
  });

  it('accepts a newline and a single space', () => {
    assert.equal(requiredRaw({ data: '\n' }, 'data'), '\n');
    assert.equal(requiredRaw({ data: ' ' }, 'data'), ' ');
  });

  it('rejects a missing field', () => {
    assert.throws(() => requiredRaw({}, 'data'), /data is required/);
  });

  it('rejects a field that is not a string', () => {
    assert.throws(() => requiredRaw({ data: 42 }, 'data'), /data is required/);
  });
});
