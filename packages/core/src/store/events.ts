import { newId, nowIso } from '../ids.js';
import type { EventType, WorkspaceEvent } from '../types.js';
import { decodeJson, encodeJson, type Db } from './db.js';

interface EventRow {
  seq: number;
  id: string;
  type: string;
  actor: string;
  payload: string;
  created_at: string;
}

function hydrate(row: EventRow): WorkspaceEvent {
  return {
    id: row.id,
    seq: row.seq,
    type: row.type as EventType,
    actor: row.actor,
    payload: decodeJson<unknown>(row.payload, {}),
    createdAt: row.created_at,
  };
}

/**
 * Append-only log of everything that happened in the workspace.
 *
 * The console tails it, and a client that drops off reconnects with the last
 * `seq` it saw rather than re-reading the world. High-volume terminal output is
 * deliberately not stored here — it streams straight over the socket.
 */
export class EventStore {
  constructor(private readonly db: Db) {}

  append(type: EventType, actor: string, payload: unknown = {}): WorkspaceEvent {
    const id = newId('evt');
    const createdAt = nowIso();

    const result = this.db
      .prepare('INSERT INTO events (id, type, actor, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, type, actor, encodeJson(payload), createdAt);

    return {
      id,
      seq: Number(result.lastInsertRowid),
      type,
      actor,
      payload,
      createdAt,
    };
  }

  /** Events after `seq`, oldest first. `seq: 0` replays from the beginning. */
  since(seq: number, limit = 500): WorkspaceEvent[] {
    const rows = this.db
      .prepare(
        `SELECT seq, id, type, actor, payload, created_at
         FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?`,
      )
      .all(seq, limit) as unknown as EventRow[];
    return rows.map(hydrate);
  }

  /** Most recent events, newest first — what the console shows on open. */
  recent(limit = 100): WorkspaceEvent[] {
    const rows = this.db
      .prepare(
        `SELECT seq, id, type, actor, payload, created_at
         FROM events ORDER BY seq DESC LIMIT ?`,
      )
      .all(limit) as unknown as EventRow[];
    return rows.map(hydrate);
  }

  latestSeq(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').get() as unknown as {
      seq: number;
    };
    return row.seq;
  }
}
