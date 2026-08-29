import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCommand } from '../dist/command.js';

describe('command grammar', () => {
  it('sends bare text to the focused terminal', () => {
    assert.deepEqual(parseCommand('npm test', 'claude'), {
      kind: 'type',
      handle: 'claude',
      text: 'npm test',
    });
  });

  it('refuses bare text when nothing is focused', () => {
    const command = parseCommand('npm test', undefined);
    assert.equal(command.kind, 'error');
  });

  it('messages a handle with @', () => {
    assert.deepEqual(parseCommand('@codex lexer moved', 'claude'), {
      kind: 'message',
      to: ['codex'],
      subject: 'lexer moved',
      body: '',
    });
  });

  it('splits a subject from a body on --', () => {
    assert.deepEqual(parseCommand('@codex lexer moved -- see src/lexer.ts', 'claude'), {
      kind: 'message',
      to: ['codex'],
      subject: 'lexer moved',
      body: 'see src/lexer.ts',
    });
  });

  it('will not send an empty message', () => {
    assert.equal(parseCommand('@codex', 'claude').kind, 'error');
    assert.equal(parseCommand('@codex   ', 'claude').kind, 'error');
  });

  it('broadcasts with /all', () => {
    assert.deepEqual(parseCommand('/all standup in five', undefined), {
      kind: 'broadcast',
      subject: 'standup in five',
      body: '',
    });
  });

  it('files work with /task', () => {
    assert.deepEqual(parseCommand('/task port the parser', undefined), {
      kind: 'task',
      title: 'port the parser',
    });
  });

  it('enlists with /add, mission and all', () => {
    assert.deepEqual(parseCommand('/add claude write the tests', undefined), {
      kind: 'enlist',
      agentId: 'claude',
      mission: 'write the tests',
    });
    assert.deepEqual(parseCommand('/add codex', undefined), {
      kind: 'enlist',
      agentId: 'codex',
      mission: '',
    });
  });

  it('starts and stops members', () => {
    assert.deepEqual(parseCommand('/stop claude', undefined), { kind: 'stop', handle: 'claude' });
    assert.deepEqual(parseCommand('/start claude', undefined), { kind: 'start', handle: 'claude' });
  });

  it('names the command it does not know', () => {
    const command = parseCommand('/frobnicate', undefined);
    assert.equal(command.kind, 'error');
    assert.match((command as { message: string }).message, /frobnicate/);
  });

  it('treats an empty line as nothing to do', () => {
    assert.equal(parseCommand('   ', 'claude').kind, 'error');
  });
});
