import { randomBytes } from 'node:crypto';

import type { Id, Iso8601 } from './types.js';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/**
 * Sortable, short identifier: 8 characters of millisecond timestamp followed by
 * 10 random characters. Lexical order matches creation order, which keeps
 * `ORDER BY id` meaningful and makes log files readable without a join.
 */
function ulidish(now: number): string {
  let time = '';
  let rest = now;
  for (let i = 0; i < 8; i += 1) {
    time = ALPHABET[rest % 32] + time;
    rest = Math.floor(rest / 32);
  }

  const bytes = randomBytes(10);
  let random = '';
  for (const byte of bytes) random += ALPHABET[byte % 32];

  return time + random;
}

export type IdPrefix = 'mbr' | 'msg' | 'tsk' | 'lse' | 'evt' | 'chn';

/** Mint a new prefixed id, e.g. `newId('msg')`. */
export function newId(prefix: IdPrefix, now = Date.now()): Id {
  return `${prefix}_${ulidish(now)}`;
}

/** True when `id` carries the given prefix. Cheap guard at API boundaries. */
export function hasPrefix(id: string, prefix: IdPrefix): boolean {
  return id.startsWith(`${prefix}_`);
}

/** Current time in the one format the whole codebase stores. */
export function nowIso(now = Date.now()): Iso8601 {
  return new Date(now).toISOString();
}
