import { useState } from 'react';
import type { JSX } from 'react';

import type { Message } from '../types';

interface Props {
  messages: Message[];
  handles: string[];
  onSend(to: string[], subject: string, body: string): void;
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
 * Everything the crew has said, plus a box to say something yourself.
 *
 * This is the view that makes a workspace feel like a team rather than a set of
 * parallel terminals — one agent's handoff is visible to you the moment it is
 * visible to its recipient.
 */
export function Feed({ messages, handles, onSend }: Props): JSX.Element {
  const [to, setTo] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!subject.trim()) return;
    onSend(to ? [to] : [], subject, body);
    setSubject('');
    setBody('');
  };

  return (
    <div className="feed">
      <div className="messages">
        {messages.length === 0 ? <p className="empty">Nothing said yet.</p> : null}

        {messages.map((message) => (
          <article key={message.id} className={`message ${message.priority}`}>
            <header>
              <strong>{message.from}</strong>
              <span className="arrow">→</span>
              <span className="to">{address(message)}</span>
              <time>{time(message.createdAt)}</time>
            </header>
            <h4>{message.subject}</h4>
            {message.body ? <pre>{message.body}</pre> : null}
          </article>
        ))}
      </div>

      <form className="composer" onSubmit={submit}>
        <select value={to} onChange={(event) => setTo(event.target.value)}>
          <option value="">everyone</option>
          {handles.map((handle) => (
            <option key={handle} value={handle}>
              {handle}
            </option>
          ))}
        </select>
        <input
          placeholder="subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
        <input placeholder="message" value={body} onChange={(event) => setBody(event.target.value)} />
        <button type="submit">send</button>
      </form>
    </div>
  );
}
