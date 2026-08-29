import type { Task, TaskStatus } from '@assemble/core';

import { flagString, type Parsed } from '../args.js';
import { attachHere } from '../context.js';
import { bold, cyan, dim, green, paintStatus, print, red, table, warn, yellow } from '../output.js';

function paintTaskStatus(status: TaskStatus): string {
  switch (status) {
    case 'done':
      return green(status);
    case 'blocked':
      return red(status);
    case 'in_progress':
      return yellow(status);
    case 'review':
      return cyan(status);
    default:
      return paintStatus(status);
  }
}

/** `assemble tasks` — the shared board. */
export async function tasksCommand(parsed: Parsed): Promise<number> {
  const workspace = await attachHere();

  try {
    const status = flagString(parsed.flags, 'status');
    const tasks = workspace.board.list({
      ...(status ? { status: status as TaskStatus } : {}),
      ...(flagString(parsed.flags, 'assignee') ? { assignee: flagString(parsed.flags, 'assignee') } : {}),
    });

    if (tasks.length === 0) {
      print(dim('The board is empty. Add one with `assemble task "title"`.'));
      return 0;
    }

    print(
      table(
        ['ID', 'STATUS', 'OWNER', 'TITLE'],
        tasks.map((task) => [
          dim(task.id.slice(0, 12)),
          paintTaskStatus(task.status),
          task.assignee ?? dim('—'),
          task.title,
        ]),
      ),
    );

    const counts = workspace.board.counts();
    print();
    print(
      dim(
        Object.entries(counts)
          .map(([key, value]) => `${key} ${value}`)
          .join('   '),
      ),
    );
    return 0;
  } finally {
    workspace.close();
  }
}

/** `assemble task "title"` — put work on the board. */
export async function taskCommand(parsed: Parsed): Promise<number> {
  const title = parsed.positionals.join(' ').trim();
  if (!title) {
    warn('What should the task say? `assemble task "port the parser" --assignee codex`');
    return 2;
  }

  const workspace = await attachHere();
  try {
    const task: Task = workspace.board.create({
      title,
      body: flagString(parsed.flags, 'body', 'b') ?? '',
      createdBy: flagString(parsed.flags, 'from') ?? 'workspace',
      ...(flagString(parsed.flags, 'assignee', 'a')
        ? { assignee: flagString(parsed.flags, 'assignee', 'a') }
        : {}),
      ...(flagString(parsed.flags, 'labels')
        ? { labels: (flagString(parsed.flags, 'labels') as string).split(',').map((l) => l.trim()) }
        : {}),
    });

    print(`${green('filed')} ${bold(task.title)} ${dim(task.id)}`);
    if (task.assignee) print(`  ${dim('assigned to')} ${task.assignee}`);
    return 0;
  } finally {
    workspace.close();
  }
}
