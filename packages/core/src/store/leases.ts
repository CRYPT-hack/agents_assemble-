import { nowIso } from '../ids.js';
import type { Lease, LeaseMode } from '../types.js';
import { decodeJson, encodeJson, type Db } from './db.js';

interface LeaseRow {
  id: string;
  holder: string;
  paths: string;
  mode: string;
  reason: string;
  acquired_at: string;
  expires_at: string;
  released_at: string | null;
}

function hydrate(row: LeaseRow): Lease {
  const lease: Lease = {
    id: row.id,
    holder: row.holder,
    paths: decodeJson<string[]>(row.paths, []),
    mode: row.mode as LeaseMode,
    reason: row.reason,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
  };
  if (row.released_at !== null) lease.releasedAt = row.released_at;
  return lease;
}

const SELECT = `
  SELECT id, holder, paths, mode, reason, acquired_at, expires_at, released_at
  FROM leases
`;

export class LeaseStore {
  constructor(private readonly db: Db) {}

  insert(lease: Lease): Lease {
    this.db
      .prepare(
        `INSERT INTO leases (id, holder, paths, mode, reason, acquired_at, expires_at, released_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        lease.id,
        lease.holder,
        encodeJson(lease.paths),
        lease.mode,
        lease.reason,
        lease.acquiredAt,
        lease.expiresAt,
        lease.releasedAt ?? null,
      );
    return lease;
  }

  find(id: string): Lease | undefined {
    const row = this.db.prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as LeaseRow | undefined;
    return row ? hydrate(row) : undefined;
  }

  /** Leases that are neither released nor expired as of `at`. */
  active(at: string = nowIso()): Lease[] {
    const rows = this.db
      .prepare(`${SELECT} WHERE released_at IS NULL AND expires_at > ? ORDER BY acquired_at ASC`)
      .all(at) as unknown as LeaseRow[];
    return rows.map(hydrate);
  }

  activeFor(holder: string, at: string = nowIso()): Lease[] {
    const rows = this.db
      .prepare(
        `${SELECT} WHERE holder = ? AND released_at IS NULL AND expires_at > ? ORDER BY acquired_at ASC`,
      )
      .all(holder, at) as unknown as LeaseRow[];
    return rows.map(hydrate);
  }

  release(id: string, at: string = nowIso()): boolean {
    const result = this.db
      .prepare('UPDATE leases SET released_at = ? WHERE id = ? AND released_at IS NULL')
      .run(at, id);
    return Number(result.changes) > 0;
  }

  /** Drop every lease a member holds — what happens when its process exits. */
  releaseAllFor(holder: string, at: string = nowIso()): number {
    const result = this.db
      .prepare('UPDATE leases SET released_at = ? WHERE holder = ? AND released_at IS NULL')
      .run(at, holder);
    return Number(result.changes);
  }

  /** Extend a lease that is still live. Returns the new expiry, or undefined. */
  renew(id: string, expiresAt: string): string | undefined {
    const result = this.db
      .prepare('UPDATE leases SET expires_at = ? WHERE id = ? AND released_at IS NULL')
      .run(expiresAt, id);
    return Number(result.changes) > 0 ? expiresAt : undefined;
  }
}
