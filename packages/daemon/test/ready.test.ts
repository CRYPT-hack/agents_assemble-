import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readyPattern, stripAnsi } from '../dist/index.js';

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

describe('escape stripping', () => {
  it('removes cursor moves so a phrase becomes contiguous', () => {
    const raw = 'Quick \x1b[1Csafety \x1b[1Ccheck: Is this a project you trust?';

    assert.equal(stripAnsi(raw), 'Quick safety check: Is this a project you trust?');
  });

  it('removes colour and screen control sequences', () => {
    const raw = '\x1b[38;2;255;193;7m\x1b[2J\x1b[Hhello\x1b[m';

    assert.equal(stripAnsi(raw), 'hello');
  });

  it('removes hyperlink sequences terminated by ST', () => {
    const raw = 'see \x1b]8;;https://example.com\x1b\\the docs\x1b]8;;\x1b\\ now';

    assert.equal(stripAnsi(raw), 'see the docs now');
  });

  it('leaves ordinary text alone', () => {
    assert.equal(stripAnsi('plain output'), 'plain output');
  });

  it('makes a real prompt matchable', () => {
    const raw =
      '\x1b[8;2HQuick \x1b[1Csafety \x1b[1Ccheck: \x1b[1CIs \x1b[1Cthis \x1b[1Ca \x1b[1Cproject \x1b[1Cyou \x1b[1Ctrust?';
    const rule = readyPattern({ pattern: 'safety check[\\s\\S]*trust', input: '\r' });

    assert.ok(rule);
    assert.equal(rule.test(stripAnsi(raw)), true);
    assert.equal(rule.test(raw), false, 'the raw stream is why the rule needed stripping');
  });
});
