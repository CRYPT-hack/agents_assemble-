import type { JSX } from 'react';

import type { Lease, Message, Task, WorkspaceEvent } from '../types';
import type { Panel } from './TopBar';
import { Board } from './Board';
import { Feed } from './Feed';
import { Leases } from './Leases';

interface Props {
  panel: Panel;
  messages: Message[];
  tasks: Task[];
  leases: Lease[];
  events: WorkspaceEvent[];
  onClose(): void;
  onPickHandle(handle: string): void;
  onCreateTask(title: string): void;
  onMoveTask(id: string, status: string): void;
}

const TITLES: Record<Panel, string> = {
  feed: 'what the crew is saying',
  board: 'shared work',
  claims: 'who holds which files',
  events: 'workspace log',
};

/**
 * The detail views, as a panel over the canvas rather than a column beside it.
 *
 * The canvas is the product; these are things you open, read and close, so they
 * should not permanently eat a third of the screen.
 */
export function Drawer(props: Props): JSX.Element {
  const { panel } = props;

  return (
    <aside className="drawer">
      <header>
        <div>
          <span className="label">{panel}</span>
          <p>{TITLES[panel]}</p>
        </div>
        <button className="ghost" onClick={props.onClose} title="Close">
          ×
        </button>
      </header>

      {panel === 'feed' ? <Feed messages={props.messages} onPickHandle={props.onPickHandle} /> : null}

      {panel === 'board' ? (
        <Board tasks={props.tasks} onCreate={props.onCreateTask} onMove={props.onMoveTask} />
      ) : null}

      {panel === 'claims' ? <Leases leases={props.leases} /> : null}

      {panel === 'events' ? (
        <ul className="events">
          {props.events.length === 0 ? <li className="empty">Quiet so far.</li> : null}
          {props.events.map((event) => (
            <li key={event.id}>
              <span className="type">{event.type}</span>
              <button className="who" onClick={() => props.onPickHandle(event.actor)}>
                {event.actor}
              </button>
              <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}
