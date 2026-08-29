import { invalid } from '../errors.js';
import { newId, nowIso } from '../ids.js';
import type { EventStore } from '../store/events.js';
import type { MemberStore } from '../store/members.js';
import type { InboxItem, MessageStore } from '../store/messages.js';
import type { Message, MessagePriority } from '../types.js';

export const WORKSPACE_SENDER = 'workspace';

export interface SendOptions {
  from: string;
  /** Handles for a direct message. Omit for a broadcast. */
  to?: string[];
  /** Channel name. Mutually exclusive with `to`. */
  channel?: string;
  subject: string;
  body: string;
  priority?: MessagePriority;
  /** Message being answered. Its thread is inherited. */
  replyTo?: string;
  taskId?: string;
}

/**
 * The agent-to-agent bus.
 *
 * Three shapes of traffic, one log: a direct message to named members, a
 * broadcast to everyone currently working, and a channel post to whoever
 * subscribed. Delivery is per-recipient, so an agent can drain its own inbox
 * without disturbing anyone else's, and nothing is lost when an agent is busy —
 * the mail waits in the database until it asks.
 */
export class Bus {
  constructor(
    private readonly messages: MessageStore,
    private readonly members: MemberStore,
    private readonly events: EventStore,
  ) {}

  send(options: SendOptions): Message {
    const subject = options.subject.trim();
    if (subject === '') throw invalid('A message needs a subject');
    if (options.to && options.channel) {
      throw invalid('A message is either direct or to a channel, not both');
    }

    const id = newId('msg');
    const parent = options.replyTo ? this.messages.find(options.replyTo) : undefined;
    if (options.replyTo && !parent) {
      throw invalid(`Cannot reply to unknown message ${options.replyTo}`, { replyTo: options.replyTo });
    }

    const { kind, to, recipients } = this.resolveAudience(options);

    const message: Message = {
      id,
      kind,
      from: options.from,
      to,
      subject,
      body: options.body,
      priority: options.priority ?? 'normal',
      threadId: parent?.threadId ?? id,
      createdAt: nowIso(),
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      ...(options.taskId ? { taskId: options.taskId } : {}),
    };

    this.messages.insert(message, recipients);
    this.events.append('message.sent', options.from, {
      messageId: message.id,
      kind: message.kind,
      to: message.to,
      subject: message.subject,
      priority: message.priority,
      threadId: message.threadId,
    });

    return message;
  }

  /** Work out who hears this message, and under which kind it is filed. */
  private resolveAudience(options: SendOptions): {
    kind: Message['kind'];
    to: string[];
    recipients: string[];
  } {
    if (options.channel) {
      const channel = options.channel.replace(/^#/, '');
      const subscribers = this.messages.subscribers(channel);
      return { kind: 'channel', to: [channel], recipients: subscribers };
    }

    if (options.to && options.to.length > 0) {
      // A message to a handle nobody answers to is a silent dead letter; catch
      // the typo here instead.
      const unknown = options.to.filter((handle) => !this.members.findByHandle(handle));
      if (unknown.length > 0) {
        throw invalid(`Unknown recipients: ${unknown.join(', ')}`, { unknown });
      }
      return { kind: 'direct', to: options.to, recipients: options.to };
    }

    const everyone = this.members.activeHandles().filter((handle) => handle !== options.from);
    return { kind: 'broadcast', to: [], recipients: everyone };
  }

  /** A system announcement — used for joins, exits, and lease conflicts. */
  announce(subject: string, body: string, priority: MessagePriority = 'normal'): Message {
    return this.send({ from: WORKSPACE_SENDER, subject, body, priority });
  }

  inbox(handle: string, options: { unreadOnly?: boolean; limit?: number } = {}): InboxItem[] {
    return this.messages.inbox(handle, options);
  }

  unreadCount(handle: string): number {
    return this.messages.unreadCount(handle);
  }

  /**
   * Read an inbox and mark what it returned as read, in that order — an agent
   * that crashes mid-turn has still consumed the mail, which is the same
   * trade-off any mail client makes.
   */
  readInbox(handle: string, limit = 20): InboxItem[] {
    const items = this.messages.inbox(handle, { unreadOnly: true, limit });
    if (items.length > 0) {
      this.messages.markRead(handle, items.map((item) => item.id));
      this.events.append('message.read', handle, { count: items.length });
    }
    return items;
  }

  acknowledge(handle: string, messageIds: string[]): number {
    return this.messages.markAcked(handle, messageIds);
  }

  thread(threadId: string): Message[] {
    return this.messages.thread(threadId);
  }

  recent(limit = 100): Message[] {
    return this.messages.recent(limit);
  }

  join(channel: string, handle: string): void {
    this.messages.subscribe(channel.replace(/^#/, ''), handle);
  }

  leave(channel: string, handle: string): void {
    this.messages.unsubscribe(channel.replace(/^#/, ''), handle);
  }

  channels(): Array<{ channel: string; members: number }> {
    return this.messages.channels();
  }

  /** Who is on the bus right now, with how much unread mail each. */
  roster(): Array<{ handle: string; agentId: string; status: string; mission: string; unread: number }> {
    return this.members.list().map((member) => ({
      handle: member.handle,
      agentId: member.agentId,
      status: member.status,
      mission: member.mission,
      unread: this.messages.unreadCount(member.handle),
    }));
  }
}
