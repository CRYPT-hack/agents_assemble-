import { nowIso } from '../ids.js';
import type { Message, MessageKind, MessagePriority } from '../types.js';
import { decodeJson, encodeJson, transact, type Db } from './db.js';

interface MessageRow {
  id: string;
  kind: string;
  sender: string;
  recipients: string;
  subject: string;
  body: string;
  priority: string;
  thread_id: string;
  reply_to: string | null;
  task_id: string | null;
  created_at: string;
}

function hydrate(row: MessageRow): Message {
  const message: Message = {
    id: row.id,
    kind: row.kind as MessageKind,
    from: row.sender,
    to: decodeJson<string[]>(row.recipients, []),
    subject: row.subject,
    body: row.body,
    priority: row.priority as MessagePriority,
    threadId: row.thread_id,
    createdAt: row.created_at,
  };
  if (row.reply_to !== null) message.replyTo = row.reply_to;
  if (row.task_id !== null) message.taskId = row.task_id;
  return message;
}

const SELECT = `
  SELECT id, kind, sender, recipients, subject, body, priority, thread_id, reply_to, task_id, created_at
  FROM messages
`;

/** One unread message plus the delivery row that made it unread. */
export interface InboxItem extends Message {
  readAt?: string;
  ackedAt?: string;
}

export class MessageStore {
  constructor(private readonly db: Db) {}

  /**
   * Store a message and fan it out to its recipients in one transaction, so an
   * inbox never sees a message the log does not have — or the reverse.
   */
  insert(message: Message, recipients: string[]): Message {
    return transact(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO messages (id, kind, sender, recipients, subject, body, priority,
                                 thread_id, reply_to, task_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          message.id,
          message.kind,
          message.from,
          encodeJson(message.to),
          message.subject,
          message.body,
          message.priority,
          message.threadId,
          message.replyTo ?? null,
          message.taskId ?? null,
          message.createdAt,
        );

      const deliver = this.db.prepare(
        'INSERT OR IGNORE INTO deliveries (message_id, recipient, read_at, acked_at) VALUES (?, ?, NULL, NULL)',
      );
      for (const recipient of new Set(recipients)) {
        if (recipient === message.from) continue; // never mail yourself
        deliver.run(message.id, recipient);
      }

      return message;
    });
  }

  find(id: string): Message | undefined {
    const row = this.db.prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as MessageRow | undefined;
    return row ? hydrate(row) : undefined;
  }

  /** Messages waiting for `handle`. Unread first, then by recency. */
  inbox(handle: string, options: { unreadOnly?: boolean; limit?: number } = {}): InboxItem[] {
    const { unreadOnly = true, limit = 50 } = options;
    const rows = this.db
      .prepare(
        `SELECT m.id, m.kind, m.sender, m.recipients, m.subject, m.body, m.priority,
                m.thread_id, m.reply_to, m.task_id, m.created_at,
                d.read_at, d.acked_at
         FROM deliveries d
         JOIN messages m ON m.id = d.message_id
         WHERE d.recipient = ? ${unreadOnly ? 'AND d.read_at IS NULL' : ''}
         ORDER BY
           CASE m.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
           m.created_at DESC
         LIMIT ?`,
      )
      .all(handle, limit) as unknown as Array<MessageRow & { read_at: string | null; acked_at: string | null }>;

    return rows.map((row) => {
      const item: InboxItem = hydrate(row);
      if (row.read_at !== null) item.readAt = row.read_at;
      if (row.acked_at !== null) item.ackedAt = row.acked_at;
      return item;
    });
  }

  unreadCount(handle: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM deliveries WHERE recipient = ? AND read_at IS NULL')
      .get(handle) as unknown as { n: number };
    return row.n;
  }

  /** Mark messages read for one recipient. Returns how many changed. */
  markRead(handle: string, messageIds: string[]): number {
    if (messageIds.length === 0) return 0;
    const at = nowIso();
    const placeholders = messageIds.map(() => '?').join(', ');
    const result = this.db
      .prepare(
        `UPDATE deliveries SET read_at = ?
         WHERE recipient = ? AND read_at IS NULL AND message_id IN (${placeholders})`,
      )
      .run(at, handle, ...messageIds);
    return Number(result.changes);
  }

  /** Acknowledge messages — a stronger signal than read: acted upon. */
  markAcked(handle: string, messageIds: string[]): number {
    if (messageIds.length === 0) return 0;
    const at = nowIso();
    const placeholders = messageIds.map(() => '?').join(', ');
    const result = this.db
      .prepare(
        `UPDATE deliveries SET acked_at = ?, read_at = COALESCE(read_at, ?)
         WHERE recipient = ? AND message_id IN (${placeholders})`,
      )
      .run(at, at, handle, ...messageIds);
    return Number(result.changes);
  }

  /** Every message in a thread, oldest first — the conversation as written. */
  thread(threadId: string): Message[] {
    const rows = this.db
      .prepare(`${SELECT} WHERE thread_id = ? ORDER BY created_at ASC`)
      .all(threadId) as unknown as MessageRow[];
    return rows.map(hydrate);
  }

  /** The whole log, newest first — what the console feed renders. */
  recent(limit = 100): Message[] {
    const rows = this.db
      .prepare(`${SELECT} ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as unknown as MessageRow[];
    return rows.map(hydrate);
  }

  // -- channels ------------------------------------------------------------

  subscribe(channel: string, handle: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO subscriptions (channel, handle, joined_at) VALUES (?, ?, ?)')
      .run(channel, handle, nowIso());
  }

  unsubscribe(channel: string, handle: string): void {
    this.db.prepare('DELETE FROM subscriptions WHERE channel = ? AND handle = ?').run(channel, handle);
  }

  subscribers(channel: string): string[] {
    const rows = this.db
      .prepare('SELECT handle FROM subscriptions WHERE channel = ? ORDER BY handle')
      .all(channel) as unknown as Array<{ handle: string }>;
    return rows.map((row) => row.handle);
  }

  channels(): Array<{ channel: string; members: number }> {
    const rows = this.db
      .prepare('SELECT channel, COUNT(*) AS members FROM subscriptions GROUP BY channel ORDER BY channel')
      .all() as unknown as Array<{ channel: string; members: number }>;
    return rows;
  }
}
