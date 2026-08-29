import type { JSX } from 'react';

import type { Message } from '../types';

interface Props {
  messages: Message[];
  onPickHandle(handle: string): void;
}

function address(message: Message): string {
  if (message.kind === 'broadcast') return 'everyone';
  if (message.kind === 'channel') return `#${message.to[0] ?? ''}`;
  return message.to.join(', ');
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Everything the crew has said, newest first.
 *
 * Read-only on purpose: there is exactly one place to type in this console, and
 * it is the command line. Clicking a handle here selects that agent's terminal.
 */
export function Feed({ messages, onPickHandle }: Props): JSX.Element {
  if (messages.length === 0) {
    return <p className="empty">Nothing said yet. Agents talk here as they work.</p>;
  }

  return (
    <div className="messages">
      {messages.map((message) => (
        <article key={message.id} className={`message ${message.priority} ${message.kind}`}>
          <header>
            <button className="who" onClick={() => onPickHandle(message.from)}>
              {message.from}
            </button>
            <span className="arrow">→</span>
            <span className="to">{address(message)}</span>
            {message.priority === 'urgent' || message.priority === 'high' ? (
              <span className={`prio ${message.priority}`}>{message.priority}</span>
            ) : null}
            <time>{time(message.createdAt)}</time>
          </header>

          <h4>{message.subject}</h4>
          {message.body ? <pre>{message.body}</pre> : null}
        </article>
      ))}
    </div>
  );
}
