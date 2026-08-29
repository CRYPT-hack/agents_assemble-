import { notFound } from '../errors.js';
import type { Member, MemberStatus } from '../types.js';
import type { Db } from './db.js';

interface MemberRow {
  id: string;
  handle: string;
  agent_id: string;
  mission: string;
  status: string;
  worktree: string;
  branch: string;
  pid: number | null;
  note: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

function hydrate(row: MemberRow): Member {
  const member: Member = {
    id: row.id,
    handle: row.handle,
    agentId: row.agent_id,
    mission: row.mission,
    status: row.status as MemberStatus,
    worktree: row.worktree,
    branch: row.branch,
    createdAt: row.created_at,
  };
  if (row.pid !== null) member.pid = row.pid;
  if (row.note !== null) member.note = row.note;
  if (row.started_at !== null) member.startedAt = row.started_at;
  if (row.ended_at !== null) member.endedAt = row.ended_at;
  return member;
}

const SELECT = `
  SELECT id, handle, agent_id, mission, status, worktree, branch, pid, note,
         created_at, started_at, ended_at
  FROM members
`;

export class MemberStore {
  constructor(private readonly db: Db) {}

  insert(member: Member): Member {
    this.db
      .prepare(
        `INSERT INTO members (id, handle, agent_id, mission, status, worktree, branch, pid, note,
                              created_at, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        member.id,
        member.handle,
        member.agentId,
        member.mission,
        member.status,
        member.worktree,
        member.branch,
        member.pid ?? null,
        member.note ?? null,
        member.createdAt,
        member.startedAt ?? null,
        member.endedAt ?? null,
      );
    return member;
  }

  list(): Member[] {
    const rows = this.db.prepare(`${SELECT} ORDER BY created_at ASC`).all() as unknown as MemberRow[];
    return rows.map(hydrate);
  }

  find(id: string): Member | undefined {
    const row = this.db.prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as MemberRow | undefined;
    return row ? hydrate(row) : undefined;
  }

  findByHandle(handle: string): Member | undefined {
    const row = this.db.prepare(`${SELECT} WHERE handle = ?`).get(handle) as unknown as MemberRow | undefined;
    return row ? hydrate(row) : undefined;
  }

  /** Same as `findByHandle`, but throws rather than returning `undefined`. */
  requireByHandle(handle: string): Member {
    const member = this.findByHandle(handle);
    if (!member) throw notFound('member', handle);
    return member;
  }

  /** Handles that are alive on the bus right now. */
  activeHandles(): string[] {
    const rows = this.db
      .prepare(`SELECT handle FROM members WHERE status NOT IN ('stopped', 'failed', 'done') ORDER BY handle`)
      .all() as unknown as Array<{ handle: string }>;
    return rows.map((row) => row.handle);
  }

  /** True when `handle` is already taken; used when minting the next one. */
  handleTaken(handle: string): boolean {
    const row = this.db.prepare('SELECT 1 AS one FROM members WHERE handle = ?').get(handle);
    return row !== undefined;
  }

  update(id: string, patch: Partial<Omit<Member, 'id'>>): Member {
    const columns: Record<keyof Omit<Member, 'id'>, string> = {
      handle: 'handle',
      agentId: 'agent_id',
      mission: 'mission',
      status: 'status',
      worktree: 'worktree',
      branch: 'branch',
      pid: 'pid',
      note: 'note',
      createdAt: 'created_at',
      startedAt: 'started_at',
      endedAt: 'ended_at',
    };

    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in patch)) continue;
      const value = patch[key as keyof typeof patch];
      sets.push(`${column} = ?`);
      values.push(value === undefined ? null : (value as string | number));
    }

    if (sets.length > 0) {
      this.db.prepare(`UPDATE members SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    }

    const member = this.find(id);
    if (!member) throw notFound('member', id);
    return member;
  }
}
