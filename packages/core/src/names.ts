import { invalid } from './errors.js';

/**
 * Names that reach git and the filesystem.
 *
 * A handle becomes a directory under the worktree root and a branch under the
 * branch prefix, so it is not a label — it is a path component and a ref. Both
 * of those have rules, and neither forgives `..`. Everything that can name a
 * member goes through here first.
 */

/** Letters, digits, and the punctuation that survives both a path and a ref. */
const HANDLE = /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$/i;

/**
 * Punctuation git reserves in a ref name.
 *
 * Spelled as a set rather than a character class on purpose: a class holding
 * both brackets and a backslash is one escaping mistake away from silently
 * matching nothing, and a guard that quietly stops guarding is worse than one
 * that is simply absent.
 */
const BACKSLASH = String.fromCharCode(92);
const REF_FORBIDDEN = new Set(['~', '^', ':', '?', '*', '[', ']', BACKSLASH, ' ']);

function hasForbiddenCharacter(ref: string): boolean {
  for (const character of ref) {
    if (REF_FORBIDDEN.has(character)) return true;

    // Control characters and DEL: git rejects them, terminals mangle them.
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function isHandle(value: string): boolean {
  if (!HANDLE.test(value)) return false;
  // `..` would climb out of the worktree root; a lone dot names it.
  return !value.includes('..');
}

/** Check a handle, or say precisely why it cannot be one. */
export function assertHandle(value: string): string {
  const handle = value.trim();

  if (handle === '') throw invalid('A handle cannot be empty');
  if (!isHandle(handle)) {
    throw invalid(
      `${JSON.stringify(value)} is not a usable handle. Use letters, digits, dot, dash or ` +
        'underscore, up to 32 characters — it becomes a directory and a branch name.',
      { handle: value },
    );
  }

  return handle;
}

/** Turn arbitrary text into something that can be a handle. */
export function toHandle(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '')
    .slice(0, 32);

  return cleaned === '' ? 'agent' : cleaned;
}

/**
 * Check a git ref name — a branch to create, or a base to cut from.
 *
 * The leading-dash rule is the important one: git takes its arguments
 * positionally, so a "branch" called `--help` is not a branch, it is a flag.
 */
export function assertRef(value: string, what = 'ref'): string {
  const ref = value.trim();

  if (ref === '') throw invalid(`A ${what} cannot be empty`);
  if (ref.startsWith('-')) {
    throw invalid(`A ${what} cannot start with a dash — git would read it as an option`, { ref: value });
  }
  if (hasForbiddenCharacter(ref)) {
    throw invalid(`A ${what} cannot contain spaces, control characters, or any of ~^:?*[\\]`, {
      ref: value,
    });
  }
  if (ref.includes('..') || ref.includes('@{')) {
    throw invalid(`A ${what} cannot contain ".." or "@{"`, { ref: value });
  }
  if (ref.startsWith('/') || ref.endsWith('/') || ref.includes('//')) {
    throw invalid(`A ${what} cannot start, end, or double up on "/"`, { ref: value });
  }
  if (ref.endsWith('.') || ref.endsWith('.lock')) {
    throw invalid(`A ${what} cannot end with "." or ".lock"`, { ref: value });
  }

  return ref;
}
