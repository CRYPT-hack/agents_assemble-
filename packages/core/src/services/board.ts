import { AssembleError, invalid } from '../errors.js';
import { newId, nowIso } from '../ids.js';
import type { EventStore } from '../store/events.js';
import type { TaskFilter, TaskStore } from '../store/tasks.js';
import type { Task, TaskStatus } from '../types.js';

export interface CreateTaskOptions {
  title: string;
  body?: string;
  createdBy: string;
  assignee?: string;
  dependsOn?: string[];
  labels?: string[];
}

const TERMINAL: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['done', 'cancelled']);

/**
 * The shared task board.
 *
 * One list every member reads and writes, so work is claimed rather than
 * assumed. Claiming is a conditional update in the database, which is what
 * makes it safe for two agents that reach for the same task in the same second.
 */
export class Board {
  constructor(
    private readonly store: TaskStore,
    private readonly events: EventStore,
  ) {}

  create(options: CreateTaskOptions): Task {
    const title = options.title.trim();
    if (title === '') throw invalid('A task needs a title');

    const now = nowIso();
    const task: Task = {
      id: newId('tsk'),
      title,
      body: options.body ?? '',
      status: options.assignee ? 'claimed' : 'backlog',
      createdBy: options.createdBy,
      dependsOn: options.dependsOn ?? [],
      labels: options.labels ?? [],
      createdAt: now,
      updatedAt: now,
      ...(options.assignee ? { assignee: options.assignee } : {}),
    };

    this.store.insert(task);
    this.events.append('task.created', options.createdBy, {
      taskId: task.id,
      title: task.title,
      assignee: task.assignee,
    });
    return task;
  }

  list(filter: TaskFilter = {}): Task[] {
    return this.store.list(filter);
  }

  find(id: string): Task | undefined {
    return this.store.find(id);
  }

  counts(): Record<string, number> {
    return this.store.counts();
  }

  /** Tasks nobody owns whose dependencies are all done — safe to pick up. */
  available(): Task[] {
    const byId = new Map(this.store.list({ limit: 1000 }).map((task) => [task.id, task]));
    return [...byId.values()].filter((task) => {
      if (task.status !== 'backlog' || task.assignee) return false;
      return task.dependsOn.every((id) => byId.get(id)?.status === 'done');
    });
  }

  /**
   * Take ownership of a task. Returns `undefined` when somebody else got there
   * first, which the caller should treat as a normal outcome, not an error.
   */
  claim(taskId: string, handle: string): Task | undefined {
    const task = this.store.require(taskId);

    const blocking = task.dependsOn.filter((id) => this.store.find(id)?.status !== 'done');
    if (blocking.length > 0) {
      throw new AssembleError('conflict', `Task ${taskId} waits on ${blocking.join(', ')}`, {
        taskId,
        blocking,
      });
    }

    const claimed = this.store.claim(taskId, handle);
    if (claimed) {
      this.events.append('task.updated', handle, { taskId, status: claimed.status, assignee: handle });
    }
    return claimed;
  }

  /** Move a task along. Only its owner, or the workspace, may do this. */
  transition(taskId: string, handle: string, status: TaskStatus, note?: string): Task {
    const task = this.store.require(taskId);

    if (task.assignee && task.assignee !== handle && handle !== 'workspace') {
      throw new AssembleError('conflict', `Task ${taskId} is owned by ${task.assignee}`, {
        taskId,
        assignee: task.assignee,
      });
    }
    if (TERMINAL.has(task.status) && !TERMINAL.has(status)) {
      throw new AssembleError('conflict', `Task ${taskId} is already ${task.status}`, { taskId });
    }

    const patch: Partial<Task> = { status };
    if (status === 'in_progress' && !task.assignee) patch.assignee = handle;
    if (note) patch.body = task.body ? `${task.body}\n\n---\n${handle}: ${note}` : `${handle}: ${note}`;

    const updated = this.store.update(taskId, patch);
    this.events.append('task.updated', handle, { taskId, status, note });
    return updated;
  }

  /** Hand a task to another member, or back to the backlog with `undefined`. */
  reassign(taskId: string, handle: string, assignee: string | undefined): Task {
    this.store.require(taskId);
    const updated = this.store.update(taskId, {
      assignee,
      status: assignee ? 'claimed' : 'backlog',
    });
    this.events.append('task.updated', handle, { taskId, assignee, status: updated.status });
    return updated;
  }

  /** Return a member's claimed work to the pool — used when a member exits. */
  releaseFor(handle: string): number {
    const owned = this.store.list({ assignee: handle, status: ['claimed', 'in_progress'] });
    for (const task of owned) {
      this.store.update(task.id, { assignee: undefined, status: 'backlog' });
      this.events.append('task.updated', 'workspace', {
        taskId: task.id,
        status: 'backlog',
        reason: `${handle} ended`,
      });
    }
    return owned.length;
  }
}
