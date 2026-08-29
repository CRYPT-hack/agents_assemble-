import { useState } from 'react';
import type { JSX } from 'react';

import type { Task } from '../types';

interface Props {
  tasks: Task[];
  onCreate(title: string): void;
  onMove(id: string, status: string): void;
}

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'claimed', label: 'Claimed' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'review', label: 'Review' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
];

/** The same board the agents read through their tools, drawn for a human. */
export function Board({ tasks, onCreate, onMove }: Props): JSX.Element {
  const [title, setTitle] = useState('');

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!title.trim()) return;
    onCreate(title.trim());
    setTitle('');
  };

  return (
    <div className="board">
      <form className="composer" onSubmit={submit}>
        <input
          placeholder="add a task the crew can claim"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button type="submit">file</button>
      </form>

      <div className="columns">
        {COLUMNS.map((column) => {
          const inColumn = tasks.filter((task) => task.status === column.key);
          return (
            <section key={column.key}>
              <h4>
                {column.label} <span className="count">{inColumn.length}</span>
              </h4>

              {inColumn.map((task) => (
                <article key={task.id} className="task">
                  <div className="title">{task.title}</div>
                  <div className="meta">
                    <span>{task.assignee ?? 'unclaimed'}</span>
                    {task.status !== 'done' ? (
                      <button onClick={() => onMove(task.id, 'done')}>done</button>
                    ) : null}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
