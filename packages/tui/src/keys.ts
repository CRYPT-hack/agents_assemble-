import { ESC } from './ansi.js';

export interface Key {
  /** Named key, or the literal character typed. */
  name: string;
  /** The raw sequence, for forwarding straight to an agent's terminal. */
  raw: string;
  ctrl: boolean;
}

const NAMED: Record<string, string> = {
  [`${ESC}[A`]: 'up',
  [`${ESC}[B`]: 'down',
  [`${ESC}[C`]: 'right',
  [`${ESC}[D`]: 'left',
  [`${ESC}[H`]: 'home',
  [`${ESC}[F`]: 'end',
  [`${ESC}[3~`]: 'delete',
  [`${ESC}[5~`]: 'pageup',
  [`${ESC}[6~`]: 'pagedown',
  [`${ESC}[Z`]: 'shifttab',
  [ESC]: 'escape',
  '\r': 'enter',
  '\n': 'enter',
  '\t': 'tab',
  '': 'backspace',
  '\b': 'backspace',
};

/**
 * Turn a raw stdin chunk into keys.
 *
 * A chunk can hold several keystrokes when someone types fast or pastes, so
 * this yields all of them. Anything unrecognised comes through as its own
 * characters, which is what lets a pasted block reach an agent intact.
 */
export function parseKeys(chunk: string): Key[] {
  const keys: Key[] = [];
  let index = 0;

  while (index < chunk.length) {
    const rest = chunk.slice(index);

    // Escape sequences first, longest match wins.
    const sequence = Object.keys(NAMED)
      .filter((candidate) => candidate.length > 1 && rest.startsWith(candidate))
      .sort((a, b) => b.length - a.length)[0];

    if (sequence) {
      keys.push({ name: NAMED[sequence] as string, raw: sequence, ctrl: false });
      index += sequence.length;
      continue;
    }

    const char = rest[0] as string;
    const code = char.charCodeAt(0);

    if (NAMED[char]) {
      keys.push({ name: NAMED[char] as string, raw: char, ctrl: false });
      index += 1;
      continue;
    }

    // Control characters: ctrl-a is 1, ctrl-z is 26.
    if (code < 27 && code !== 27) {
      keys.push({
        name: String.fromCharCode(code + 96),
        raw: char,
        ctrl: true,
      });
      index += 1;
      continue;
    }

    keys.push({ name: char, raw: char, ctrl: false });
    index += 1;
  }

  return keys;
}
