/**
 * Schema migrations, applied in order and recorded in `schema_version`.
 *
 * Each entry is append-only: never edit a shipped migration, add another one.
 * Everything the workspace knows lives here, so a crashed daemon rehydrates the
 * whole crew — members, mail, leases, board — from one file.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
      CREATE TABLE members (
        id          TEXT PRIMARY KEY,
        handle      TEXT NOT NULL UNIQUE,
        agent_id    TEXT NOT NULL,
        mission     TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL,
        worktree    TEXT NOT NULL,
        branch      TEXT NOT NULL,
        pid         INTEGER,
        note        TEXT,
        created_at  TEXT NOT NULL,
        started_at  TEXT,
        ended_at    TEXT
      );

      CREATE TABLE messages (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        sender      TEXT NOT NULL,
        recipients  TEXT NOT NULL DEFAULT '[]',
        subject     TEXT NOT NULL DEFAULT '',
        body        TEXT NOT NULL DEFAULT '',
        priority    TEXT NOT NULL DEFAULT 'normal',
        thread_id   TEXT NOT NULL,
        reply_to    TEXT,
        task_id     TEXT,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX messages_thread ON messages (thread_id, created_at);
      CREATE INDEX messages_sender ON messages (sender, created_at);

      CREATE TABLE deliveries (
        message_id  TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
        recipient   TEXT NOT NULL,
        read_at     TEXT,
        acked_at    TEXT,
        PRIMARY KEY (message_id, recipient)
      );
      CREATE INDEX deliveries_inbox ON deliveries (recipient, read_at);

      CREATE TABLE leases (
        id           TEXT PRIMARY KEY,
        holder       TEXT NOT NULL,
        paths        TEXT NOT NULL DEFAULT '[]',
        mode         TEXT NOT NULL DEFAULT 'exclusive',
        reason       TEXT NOT NULL DEFAULT '',
        acquired_at  TEXT NOT NULL,
        expires_at   TEXT NOT NULL,
        released_at  TEXT
      );
      CREATE INDEX leases_active ON leases (released_at, expires_at);

      CREATE TABLE tasks (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        body        TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'backlog',
        assignee    TEXT,
        created_by  TEXT NOT NULL,
        depends_on  TEXT NOT NULL DEFAULT '[]',
        labels      TEXT NOT NULL DEFAULT '[]',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX tasks_status ON tasks (status, updated_at);

      CREATE TABLE events (
        seq         INTEGER PRIMARY KEY AUTOINCREMENT,
        id          TEXT NOT NULL UNIQUE,
        type        TEXT NOT NULL,
        actor       TEXT NOT NULL,
        payload     TEXT NOT NULL DEFAULT '{}',
        created_at  TEXT NOT NULL
      );
      CREATE INDEX events_type ON events (type, seq);

      CREATE TABLE subscriptions (
        channel   TEXT NOT NULL,
        handle    TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (channel, handle)
      );
    `,
  },
];
