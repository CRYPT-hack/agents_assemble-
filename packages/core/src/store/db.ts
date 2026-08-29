import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS } from './schema.js';

/**
 * The workspace database. SQLite via `node:sqlite`, so the whole toolchain
 * installs with no native build step on any platform.
 *
 * WAL is on because the daemon writes while the console reads; `busy_timeout`
 * covers the brief overlap when several members hit the bus at once.
 */
export type Db = DatabaseSync;

export function openDatabase(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');

  migrate(db);
  return db;
}

/** Apply every migration the file has not seen yet. Idempotent. */
export function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');

  const rows = db.prepare('SELECT version FROM schema_version').all() as Array<{ version: number }>;
  const applied = new Set(rows.map((row) => row.version));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;

    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (cause) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${migration.version} (${migration.name}) failed`, { cause });
    }
  }
}

/** Run `fn` inside a transaction, rolling back if it throws. */
export function transact<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** JSON columns are stored as text; these two keep the casts in one place. */
export const encodeJson = (value: unknown): string => JSON.stringify(value ?? null);

export function decodeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}
