/**
 * The command line at the bottom of the canvas.
 *
 * One box, because switching between "type at an agent", "message an agent" and
 * "file a task" should not mean moving your hands. The prefix decides where the
 * text goes; with no prefix it goes to whichever terminal has focus, which is
 * what you want ninety percent of the time.
 */

export type Command =
  | { kind: 'type'; handle: string; text: string }
  | { kind: 'message'; to: string[]; subject: string; body: string }
  | { kind: 'broadcast'; subject: string; body: string }
  | { kind: 'task'; title: string }
  | { kind: 'enlist'; agentId: string; mission: string }
  | { kind: 'start'; handle: string }
  | { kind: 'stop'; handle: string }
  | { kind: 'help' }
  | { kind: 'error'; message: string };

/** `subject -- body` splits a one-liner into a subject and the rest. */
function split(text: string): { subject: string; body: string } {
  const at = text.indexOf(' -- ');
  if (at === -1) return { subject: text.trim(), body: '' };
  return { subject: text.slice(0, at).trim(), body: text.slice(at + 4).trim() };
}

export function parseCommand(input: string, focused: string | undefined): Command {
  const text = input.trim();
  if (text === '') return { kind: 'error', message: 'Nothing to send' };

  if (text.startsWith('@')) {
    const space = text.indexOf(' ');
    if (space === -1) return { kind: 'error', message: 'Say something after the handle' };

    const to = text.slice(1, space);
    const { subject, body } = split(text.slice(space + 1));
    if (!subject) return { kind: 'error', message: 'Say something after the handle' };

    return { kind: 'message', to: [to], subject, body };
  }

  if (text.startsWith('/')) {
    const space = text.indexOf(' ');
    const verb = (space === -1 ? text.slice(1) : text.slice(1, space)).toLowerCase();
    const rest = space === -1 ? '' : text.slice(space + 1).trim();

    switch (verb) {
      case 'all':
      case 'say': {
        const { subject, body } = split(rest);
        return subject
          ? { kind: 'broadcast', subject, body }
          : { kind: 'error', message: 'Say something to broadcast' };
      }
      case 'task':
        return rest ? { kind: 'task', title: rest } : { kind: 'error', message: 'Give the task a title' };
      case 'add': {
        const gap = rest.indexOf(' ');
        const agentId = gap === -1 ? rest : rest.slice(0, gap);
        const mission = gap === -1 ? '' : rest.slice(gap + 1).trim();
        return agentId
          ? { kind: 'enlist', agentId, mission }
          : { kind: 'error', message: 'Which agent? Try /add claude write the parser' };
      }
      case 'start':
        return rest ? { kind: 'start', handle: rest } : { kind: 'error', message: 'Which member?' };
      case 'stop':
        return rest ? { kind: 'stop', handle: rest } : { kind: 'error', message: 'Which member?' };
      case 'help':
      case '?':
        return { kind: 'help' };
      default:
        return { kind: 'error', message: `Unknown command /${verb}. Try /help.` };
    }
  }

  if (!focused) {
    return { kind: 'error', message: 'Click a terminal first, or use @handle to send a message.' };
  }
  return { kind: 'type', handle: focused, text };
}

export const COMMAND_HELP: Array<[string, string]> = [
  ['<text>', 'type it into the focused terminal'],
  ['@handle <text>', 'message that agent'],
  ['/all <text>', 'message everyone working'],
  ['/task <title>', 'put work on the shared board'],
  ['/add <agent> <mission>', 'enlist another agent'],
  ['/start <handle>', 'start a stopped member'],
  ['/stop <handle>', 'stop a running member'],
];
