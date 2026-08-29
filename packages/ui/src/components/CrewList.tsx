import type { JSX } from 'react';

import type { Member } from '../types';

interface Props {
  members: Member[];
  selected?: string;
  onSelect(handle: string): void;
  onStart(handle: string): void;
  onStop(handle: string): void;
}

/** Status drives the dot colour; the class names live in styles.css. */
function statusClass(status: string): string {
  if (status === 'working') return 'ok';
  if (status === 'blocked' || status === 'failed') return 'bad';
  if (status === 'waiting' || status === 'review') return 'warn';
  return 'idle';
}

export function CrewList({ members, selected, onSelect, onStart, onStop }: Props): JSX.Element {
  if (members.length === 0) {
    return <p className="empty">Nobody enlisted yet. Add an agent below.</p>;
  }

  return (
    <ul className="crew">
      {members.map((member) => (
        <li
          key={member.handle}
          className={member.handle === selected ? 'selected' : ''}
          onClick={() => onSelect(member.handle)}
        >
          <div className="row">
            <span className={`dot ${statusClass(member.status)}`} />
            <strong>{member.handle}</strong>
            <span className="agent">{member.agentId}</span>
            {member.unread ? <span className="badge">{member.unread}</span> : null}
          </div>

          <div className="mission">{member.mission || <em>no mission set</em>}</div>
          <div className="meta">
            <code>{member.branch}</code>
            <span>{member.status}</span>
          </div>

          <div className="actions">
            {member.running ? (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onStop(member.handle);
                }}
              >
                stop
              </button>
            ) : (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onStart(member.handle);
                }}
              >
                start
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
