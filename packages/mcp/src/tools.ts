import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AttachedWorkspace, MemberStatus, MessagePriority, TaskStatus } from '@assemble/core';
import { z } from 'zod';

import type { Identity } from './identity.js';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/** Tool replies are JSON so an agent can parse them instead of guessing. */
function ok(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string, details?: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message, details }, null, 2) }],
    isError: true,
  };
}

/** Turn a thrown error into a reply the calling agent can act on. */
function guard(fn: () => unknown): ToolResult {
  try {
    return ok(fn());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(message);
  }
}

const priority = z.enum(['low', 'normal', 'high', 'urgent']);
const taskStatus = z.enum(['backlog', 'claimed', 'in_progress', 'review', 'blocked', 'done', 'cancelled']);
const memberStatus = z.enum(['working', 'waiting', 'blocked', 'review', 'done']);

/**
 * The coordination tools every member gets.
 *
 * They are deliberately small and blunt: an agent in the middle of a refactor
 * should be able to ask "who else is in this file" or "has anyone taken this
 * task" in one call, and get an answer it can branch on without prose parsing.
 */
export function registerTools(server: McpServer, workspace: AttachedWorkspace, identity: Identity): void {
  const me = identity.handle;

  // -- who is here ---------------------------------------------------------

  server.registerTool(
    'whos_here',
    {
      title: 'Who is here',
      description:
        'List every member of this workspace: handle, which agent it runs, what it is working on, ' +
        'its status, and how much unread mail it has. Call this before addressing anyone.',
      inputSchema: {},
    },
    async () => guard(() => ({ me, members: workspace.bus.roster() })),
  );

  // -- messaging -----------------------------------------------------------

  server.registerTool(
    'send_message',
    {
      title: 'Send a message',
      description:
        'Message other members. Give `to` for a direct message, `channel` to post to a channel, ' +
        'or neither to broadcast to everyone currently working. Use this to hand off an interface, ' +
        'warn about a change, ask a question, or report that you are done.',
      inputSchema: {
        subject: z.string().min(1).describe('One line saying what this is about'),
        body: z.string().default('').describe('The message itself'),
        to: z.array(z.string()).optional().describe('Handles to address directly'),
        channel: z.string().optional().describe('Channel to post to, without the #'),
        priority: priority.optional().describe('urgent interrupts, low waits'),
        taskId: z.string().optional().describe('Task this message concerns'),
      },
    },
    async (args) =>
      guard(() =>
        workspace.bus.send({
          from: me,
          subject: args.subject,
          body: args.body ?? '',
          ...(args.to ? { to: args.to } : {}),
          ...(args.channel ? { channel: args.channel } : {}),
          ...(args.priority ? { priority: args.priority as MessagePriority } : {}),
          ...(args.taskId ? { taskId: args.taskId } : {}),
        }),
      ),
  );

  server.registerTool(
    'reply_to_message',
    {
      title: 'Reply to a message',
      description: 'Answer a message you received. The reply stays in the same thread.',
      inputSchema: {
        messageId: z.string().describe('Id of the message you are answering'),
        body: z.string().describe('Your reply'),
        subject: z.string().optional().describe('Defaults to re: the original subject'),
        priority: priority.optional(),
      },
    },
    async (args) =>
      guard(() => {
        const original = workspace.bus.thread(args.messageId).find((m) => m.id === args.messageId);
        const parent = original ?? workspace.bus.recent(200).find((m) => m.id === args.messageId);
        if (!parent) throw new Error(`No message ${args.messageId}`);

        return workspace.bus.send({
          from: me,
          to: parent.from === 'workspace' ? [] : [parent.from],
          subject: args.subject ?? `re: ${parent.subject}`,
          body: args.body,
          replyTo: parent.id,
          ...(args.priority ? { priority: args.priority as MessagePriority } : {}),
        });
      }),
  );

  server.registerTool(
    'check_inbox',
    {
      title: 'Check inbox',
      description:
        'Read the messages waiting for you and mark them read. Do this between steps of your own ' +
        'work — another member may have taken a file you were about to edit, or finished something ' +
        'you were waiting on.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20).describe('How many messages to take'),
        peek: z.boolean().default(false).describe('Read without marking anything read'),
      },
    },
    async (args) =>
      guard(() => {
        const limit = args.limit ?? 20;
        const messages = args.peek
          ? workspace.bus.inbox(me, { unreadOnly: true, limit })
          : workspace.bus.readInbox(me, limit);
        return { unreadRemaining: workspace.bus.unreadCount(me), messages };
      }),
  );

  server.registerTool(
    'read_thread',
    {
      title: 'Read a thread',
      description: 'Every message in one conversation, oldest first.',
      inputSchema: { threadId: z.string().describe('Thread id from any message in it') },
    },
    async (args) => guard(() => workspace.bus.thread(args.threadId)),
  );

  server.registerTool(
    'channels',
    {
      title: 'Channels',
      description:
        'List channels, or join or leave one. Channels are for standing topics — `build`, ' +
        '`api`, `review` — so a message reaches whoever cares without naming them.',
      inputSchema: {
        action: z.enum(['list', 'join', 'leave']).default('list'),
        channel: z.string().optional().describe('Required for join and leave'),
      },
    },
    async (args) =>
      guard(() => {
        if (args.action === 'join') {
          if (!args.channel) throw new Error('join needs a channel');
          workspace.bus.join(args.channel, me);
        } else if (args.action === 'leave') {
          if (!args.channel) throw new Error('leave needs a channel');
          workspace.bus.leave(args.channel, me);
        }
        return { channels: workspace.bus.channels() };
      }),
  );

  // -- file leases ---------------------------------------------------------

  server.registerTool(
    'claim_files',
    {
      title: 'Claim files',
      description:
        'Declare that you are about to edit these paths, before you edit them. If another member ' +
        'already holds an overlapping claim you get told who, and should message them rather than ' +
        'edit anyway. Globs are allowed: `src/parser/**/*.ts`.',
      inputSchema: {
        paths: z.array(z.string()).min(1).describe('Repository-relative paths or globs'),
        reason: z.string().default('').describe('What you are about to do to them'),
        mode: z
          .enum(['exclusive', 'shared'])
          .default('exclusive')
          .describe('shared for reading, exclusive for editing'),
        ttlSeconds: z.number().int().min(30).max(86400).optional().describe('How long you need them'),
      },
    },
    async (args) =>
      guard(() => {
        const result = workspace.leases.acquire({
          holder: me,
          paths: args.paths,
          reason: args.reason ?? '',
          mode: args.mode ?? 'exclusive',
          ...(args.ttlSeconds ? { ttlSeconds: args.ttlSeconds } : {}),
        });

        if (result.granted) return { granted: true, lease: result.granted };

        return {
          granted: false,
          blockedBy: result.conflicts.map((conflict) => ({
            holder: conflict.lease.holder,
            paths: conflict.lease.paths,
            reason: conflict.lease.reason,
            since: conflict.lease.acquiredAt,
            expires: conflict.lease.expiresAt,
            collisions: conflict.pairs,
          })),
          advice: 'Message the holder, work on something else, or wait for the claim to expire.',
        };
      }),
  );

  server.registerTool(
    'release_files',
    {
      title: 'Release files',
      description: 'Give back a claim once you have finished with those paths.',
      inputSchema: {
        leaseId: z.string().optional().describe('A specific claim; omit to release all of yours'),
      },
    },
    async (args) =>
      guard(() => {
        if (args.leaseId) {
          workspace.leases.release(args.leaseId, me);
          return { released: [args.leaseId] };
        }
        const count = workspace.leases.releaseAll(me);
        return { released: count };
      }),
  );

  server.registerTool(
    'who_is_editing',
    {
      title: 'Who is editing',
      description:
        'Ask who currently claims some paths, without claiming them yourself. Cheap to call before ' +
        'you plan an edit.',
      inputSchema: { paths: z.array(z.string()).min(1) },
    },
    async (args) =>
      guard(() => ({
        paths: workspace.leases.whoHolds(args.paths),
        mine: workspace.leases.heldBy(me),
      })),
  );

  // -- task board ----------------------------------------------------------

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        'Read the shared board. `available: true` narrows it to unclaimed tasks whose dependencies ' +
        'are already done — the work you can actually start right now.',
      inputSchema: {
        available: z.boolean().default(false),
        status: taskStatus.optional(),
        assignee: z.string().optional(),
        mine: z.boolean().default(false),
      },
    },
    async (args) =>
      guard(() => {
        if (args.available) return { tasks: workspace.board.available() };
        return {
          tasks: workspace.board.list({
            ...(args.status ? { status: args.status as TaskStatus } : {}),
            ...(args.mine ? { assignee: me } : args.assignee ? { assignee: args.assignee } : {}),
          }),
        };
      }),
  );

  server.registerTool(
    'create_task',
    {
      title: 'Create a task',
      description:
        'Put work on the shared board — for yourself, for a named member, or for whoever picks it ' +
        'up. Use this instead of doing an unrelated piece of work yourself mid-task.',
      inputSchema: {
        title: z.string().min(1),
        body: z.string().default(''),
        assignee: z.string().optional().describe('Handle to give it to, or omit for the backlog'),
        dependsOn: z.array(z.string()).default([]).describe('Task ids that must finish first'),
        labels: z.array(z.string()).default([]),
      },
    },
    async (args) =>
      guard(() =>
        workspace.board.create({
          title: args.title,
          body: args.body ?? '',
          createdBy: me,
          dependsOn: args.dependsOn ?? [],
          labels: args.labels ?? [],
          ...(args.assignee ? { assignee: args.assignee } : {}),
        }),
      ),
  );

  server.registerTool(
    'claim_task',
    {
      title: 'Claim a task',
      description:
        'Take a task from the backlog. Exactly one member wins a claim; if you lose, pick another ' +
        'task rather than working on it anyway.',
      inputSchema: { taskId: z.string() },
    },
    async (args) =>
      guard(() => {
        const task = workspace.board.claim(args.taskId, me);
        if (!task) {
          const current = workspace.board.find(args.taskId);
          return { claimed: false, heldBy: current?.assignee, status: current?.status };
        }
        return { claimed: true, task };
      }),
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update a task',
      description:
        'Move your task along the board: in_progress when you start, blocked when you are stuck ' +
        '(say why, and message whoever can unblock you), review when it is ready, done when it is.',
      inputSchema: {
        taskId: z.string(),
        status: taskStatus,
        note: z.string().optional().describe('Appended to the task, and visible to everyone'),
      },
    },
    async (args) =>
      guard(() =>
        workspace.board.transition(args.taskId, me, args.status as TaskStatus, args.note),
      ),
  );

  // -- self ----------------------------------------------------------------

  server.registerTool(
    'set_my_status',
    {
      title: 'Set my status',
      description:
        'Tell the workspace what you are doing. This is what the console shows and what other ' +
        'members see in `whos_here`, so keep it current — especially when you become blocked.',
      inputSchema: {
        status: memberStatus,
        note: z.string().optional().describe('One line: what you are on right now'),
      },
    },
    async (args) =>
      guard(() => {
        const member = workspace.members.requireByHandle(me);
        const patch: { status: MemberStatus; note?: string } = { status: args.status as MemberStatus };
        if (args.note !== undefined) patch.note = args.note;

        const updated = workspace.members.update(member.id, patch);
        workspace.events.append('member.status', me, { status: args.status, note: args.note });
        return updated;
      }),
  );
}
