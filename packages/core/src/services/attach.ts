import { openDatabase, type Db } from '../store/db.js';
import { EventStore } from '../store/events.js';
import { LeaseStore } from '../store/leases.js';
import { MemberStore } from '../store/members.js';
import { MessageStore } from '../store/messages.js';
import { TaskStore } from '../store/tasks.js';
import { Board } from './board.js';
import { Bus } from './bus.js';
import { Leases } from './leases.js';

export interface AttachOptions {
  /** Absolute path of an existing workspace database. */
  dbPath: string;
  /** Lease duration when a caller does not name one. */
  leaseTtlSeconds?: number;
}

/**
 * Everything a participant needs, without the worktree machinery.
 *
 * The MCP server runs inside a member's own worktree, where `git rev-parse`
 * would point at that worktree rather than the project — so it attaches to the
 * workspace database directly instead of discovering it. Members coordinate;
 * only the daemon creates and destroys worktrees.
 */
export interface AttachedWorkspace {
  db: Db;
  events: EventStore;
  members: MemberStore;
  bus: Bus;
  leases: Leases;
  board: Board;
  close(): void;
}

export function attachWorkspace(options: AttachOptions): AttachedWorkspace {
  const db = openDatabase(options.dbPath);

  const members = new MemberStore(db);
  const messages = new MessageStore(db);
  const tasks = new TaskStore(db);
  const leaseStore = new LeaseStore(db);

  const events = new EventStore(db);
  const bus = new Bus(messages, members, events);
  const leases = new Leases(leaseStore, events, options.leaseTtlSeconds ?? 1800);
  const board = new Board(tasks, events);

  return {
    db,
    events,
    members,
    bus,
    leases,
    board,
    close: () => db.close(),
  };
}
