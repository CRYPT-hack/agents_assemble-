import { notFound } from '../errors.js';
import { nowIso } from '../ids.js';
import type { Task, TaskStatus } from '../types.js';
import { decodeJson, encodeJson, type Db } from './db.js';

interface TaskRow {
  id: string;
  title: string;
  body: string;
  status: string;
  assignee: string | null;
  created_by: string;
  depends_on: string;
  labels: string;
  created_at: string;
  updated_at: string;
}

function hydrate(row: TaskRow): Task {
  const task: Task = {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status as TaskStatus,
    createdBy: row.created_by,
    dependsOn: decodeJson<string[]>(row.depends_on, []),
    labels: decodeJson<string[]>(row.labels, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.assignee !== null) task.assignee = row.assignee;
  return task;
}

const SELECT = `
  SELECT id, title, body, status, assignee, created_by, depends_on, labels, created_at, updated_at
  FROM tasks
`;

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  assignee?: string;
  label?: string;
  limit?: number;
}

export class TaskStore {
  constructor(private readonly db: Db) {}

  insert(task: Task): Task {
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, body, status, assignee, created_by, depends_on, labels,
                            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.title,
        task.body,
        task.status,
        task.assignee ?? null,
        task.createdBy,
        encodeJson(task.dependsOn),
        encodeJson(task.labels),
        task.createdAt,
        task.updatedAt,
      );
    return task;
  }

  find(id: string): Task | undefined {
    const row = this.db.prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as TaskRow | undefined;
    return row ? hydrate(row) : undefined;
  }

  require(id: string): Task {
    const task = this.find(id);
    if (!task) throw notFound('task', id);
    return task;
  }

  list(filter: TaskFilter = {}): Task[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      values.push(...statuses);
    }
    if (filter.assignee) {
      clauses.push('assignee = ?');
      values.push(filter.assignee);
    }
    if (filter.label) {
      // labels is a JSON array of strings; the quoted form avoids matching a
      // label that merely contains this one as a substring.
      clauses.push('labels LIKE ?');
      values.push(`%"${filter.label}"%`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`${SELECT} ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...values, filter.limit ?? 200) as unknown as TaskRow[];
    return rows.map(hydrate);
  }

  update(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): Task {
    const sets: string[] = [];
    const values: Array<string | null> = [];

    if (patch.title !== undefined) {
      sets.push('title = ?');
      values.push(patch.title);
    }
    if (patch.body !== undefined) {
      sets.push('body = ?');
      values.push(patch.body);
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      values.push(patch.status);
    }
    if ('assignee' in patch) {
      sets.push('assignee = ?');
      values.push(patch.assignee ?? null);
    }
    if (patch.dependsOn !== undefined) {
      sets.push('depends_on = ?');
      values.push(encodeJson(patch.dependsOn));
    }
    if (patch.labels !== undefined) {
      sets.push('labels = ?');
      values.push(encodeJson(patch.labels));
    }

    sets.push('updated_at = ?');
    values.push(patch.updatedAt ?? nowIso());

    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    return this.require(id);
  }

  /**
   * Claim a task for `handle`, but only if nobody else already holds it. The
   * guard lives in the WHERE clause so two agents racing for the same task
   * cannot both win.
   */
  claim(id: string, handle: string, at: string = nowIso()): Task | undefined {
    const result = this.db
      .prepare(
        `UPDATE tasks SET assignee = ?, status = 'claimed', updated_at = ?
         WHERE id = ? AND status = 'backlog' AND assignee IS NULL`,
      )
      .run(handle, at, id);
    return Number(result.changes) > 0 ? this.require(id) : undefined;
  }

  /** Board counts by status, for the console header. */
  counts(): Record<string, number> {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status')
      .all() as unknown as Array<{ status: string; n: number }>;
    return Object.fromEntries(rows.map((row) => [row.status, row.n]));
  }
}
