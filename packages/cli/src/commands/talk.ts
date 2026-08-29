import type { Message } from '@assemble/core';

import { flagBool, flagString, type Parsed } from '../args.js';
import { attachHere, clientFor } from '../context.js';
import { bold, cyan, dim, green, magenta, print, red, shortTime, warn, yellow } from '../output.js';

function paintPriority(priority: string): string {
  if (priority === 'urgent') return red(priority);
  if (priority === 'high') return yellow(priority);
  return dim(priority);
}

function paintAddress(message: Message): string {
  if (message.kind === 'broadcast') return magenta('everyone');
  if (message.kind === 'channel') return cyan(`#${message.to[0] ?? ''}`);
  return message.to.join(', ');
}

/** `assemble send <handle...> --subject "..."` — talk to the crew yourself. */
export async function sendCommand(parsed: Parsed): Promise<number> {
  const subject = flagString(parsed.flags, 'subject', 's');
  if (!subject) {
    warn('A message needs a subject: `assemble send codex -s "interface" -b "parse(x)"`');
    return 2;
  }

  const to = parsed.positionals;
  const payload = {
    from: flagString(parsed.flags, 'from') ?? 'workspace',
    subject,
    body: flagString(parsed.flags, 'body', 'b') ?? '',
    ...(to.length > 0 ? { to } : {}),
    ...(flagString(parsed.flags, 'channel') ? { channel: flagString(parsed.flags, 'channel') } : {}),
    ...(flagString(parsed.flags, 'priority') ? { priority: flagString(parsed.flags, 'priority') } : {}),
  };

  const client = clientFor(parsed);
  if (await client.alive()) {
    const { message } = await client.post<{ message: Message }>('/api/messages', payload);
    print(`${green('sent')} ${dim(message.id)} to ${paintAddress(message)}`);
    return 0;
  }

  const workspace = await attachHere();
  try {
    const message = workspace.bus.send(payload as Parameters<typeof workspace.bus.send>[0]);
    print(`${green('sent')} ${dim(message.id)} to ${paintAddress(message)}`);
    return 0;
  } finally {
    workspace.close();
  }
}

/** `assemble inbox <handle>` — read what is waiting for a member. */
export async function inboxCommand(parsed: Parsed): Promise<number> {
  const handle = parsed.positionals[0];
  if (!handle) {
    warn('Whose inbox? `assemble inbox codex`');
    return 2;
  }

  const drain = flagBool(parsed.flags, 'read', false);
  const workspace = await attachHere();

  try {
    const messages = drain
      ? workspace.bus.readInbox(handle, 50)
      : workspace.bus.inbox(handle, { unreadOnly: true, limit: 50 });

    if (messages.length === 0) {
      print(dim(`Nothing waiting for ${handle}.`));
      return 0;
    }

    for (const message of messages) {
      print(
        `${dim(shortTime(message.createdAt))} ${bold(message.from)} → ${paintAddress(message)}  ${paintPriority(message.priority)}`,
      );
      print(`  ${bold(message.subject)}`);
      if (message.body) print(`  ${message.body.split('\n').join('\n  ')}`);
      print(`  ${dim(`${message.id}  thread ${message.threadId}`)}`);
      print();
    }

    if (!drain) print(dim('Left unread. Pass --read to mark these read.'));
    return 0;
  } finally {
    workspace.close();
  }
}

/** `assemble feed` — the whole conversation, newest last. */
export async function feedCommand(parsed: Parsed): Promise<number> {
  const limit = Number(flagString(parsed.flags, 'limit', 'n') ?? '30');
  const workspace = await attachHere();

  try {
    const messages = workspace.bus.recent(Number.isFinite(limit) ? limit : 30).reverse();

    if (messages.length === 0) {
      print(dim('Nothing said yet.'));
      return 0;
    }

    for (const message of messages) {
      const from = message.from === 'workspace' ? dim(message.from) : bold(message.from);
      print(`${dim(shortTime(message.createdAt))} ${from} → ${paintAddress(message)}: ${message.subject}`);
      if (message.body) {
        const first = message.body.split('\n')[0] ?? '';
        print(`    ${dim(first.length > 100 ? `${first.slice(0, 100)}…` : first)}`);
      }
    }
    return 0;
  } finally {
    workspace.close();
  }
}

/** `assemble leases` — who is holding which files right now. */
export async function leasesCommand(): Promise<number> {
  const workspace = await attachHere();

  try {
    const leases = workspace.leases.active();
    if (leases.length === 0) {
      print(dim('No files are claimed.'));
      return 0;
    }

    for (const lease of leases) {
      print(`${bold(lease.holder)} ${dim(lease.mode)} ${dim(`until ${shortTime(lease.expiresAt)}`)}`);
      for (const path of lease.paths) print(`  ${path}`);
      if (lease.reason) print(`  ${dim(lease.reason)}`);
      print();
    }
    return 0;
  } finally {
    workspace.close();
  }
}
