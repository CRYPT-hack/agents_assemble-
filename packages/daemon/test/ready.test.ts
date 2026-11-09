import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readyPattern } from '../dist/index.js';

describe('first-run prompt rules', () => {
  it('is off when no rule is configured', () => {
    assert.equal(readyPattern(undefined), null);
    assert.equal(readyPattern(false), null);
  });

  it('matches the prompt case-insensitively', () => {
    const rule = readyPattern({ pattern: 'do you trust this folder', input: '\r' });

    assert.ok(rule);
    assert.equal(rule.test('Quick safety check: Is this a project you trust?'), false);
    assert.equal(rule.test('Do You Trust This Folder?'), true);
  });

  it('matches a prompt that spans more than one line', () => {
    const rule = readyPattern({ pattern: 'safety check[\\s\\S]*trust', input: '\r' });

    assert.ok(rule);
    assert.equal(rule.test('Quick safety check:\nIs this a project you created or one you trust?'), true);
  });

  it('disables itself rather than throwing on a bad pattern', () => {
    assert.equal(readyPattern({ pattern: '([unclosed', input: '\r' }), null);
  });
});
