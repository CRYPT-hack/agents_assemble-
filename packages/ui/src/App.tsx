import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';

import { api } from './api';
import { Board } from './components/Board';
import { CrewList } from './components/CrewList';
import { Enlist } from './components/Enlist';
import { Feed } from './components/Feed';
import { Leases } from './components/Leases';
import { TerminalPane } from './components/TerminalPane';
import type { Agent, Lease, Member, Message, Task } from './types';
import { useLive } from './useLive';

type Tab = 'feed' | 'board' | 'leases' | 'events';

/**
 * The console.
 *
 * One socket keeps it live; everything else is refetched whenever an event says
 * something changed, which is cheap at this scale and keeps a single source of
 * truth in the daemon rather than a second one in the browser.
 */
export function App(): JSX.Element {
  const live = useLive();

  const [members, setMembers] = useState<Member[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);

  const [selected, setSelected] = useState<string>();
  const [tab, setTab] = useState<Tab>('feed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const [memberList, messageList, taskList, leaseList] = await Promise.all([
        api.members(),
        api.messages(),
        api.tasks(),
        api.leases(),
      ]);

      setMembers(memberList.members);
      setMessages(messageList.messages);
      setTasks(taskList.tasks);
      setLeases(leaseList.leases);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void api.agents().then((result) => setAgents(result.agents));
    void refresh();
  }, [refresh]);

  // Any workspace event may have changed what is on screen. Terminal output is
  // not an event, so this does not fire on every keystroke an agent prints.
  useEffect(() => {
    void refresh();
  }, [live.events.length, refresh]);

  useEffect(() => {
    if (!selected && members.length > 0) setSelected(members[0]?.handle);
  }, [members, selected]);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const running = members.filter((member) => member.running).length;
  const handles = members.map((member) => member.handle);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="mark">A</span>
          <div>
            <h1>{live.snapshot?.config.name ?? 'workspace'}</h1>
            <p>{live.snapshot?.config.repoRoot}</p>
          </div>
        </div>

        <div className="stats">
          <span>
            <b>{members.length}</b> members
          </span>
          <span>
            <b>{running}</b> running
          </span>
          <span>
            <b>{leases.length}</b> claims
          </span>
          <span>
            <b>{tasks.filter((task) => task.status !== 'done').length}</b> open tasks
          </span>
          <span className={live.connected ? 'link ok' : 'link bad'}>
            {live.connected ? 'live' : 'reconnecting'}
          </span>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <main>
        <aside className="left">
          <h3>Crew</h3>
          <CrewList
            members={members}
            {...(selected ? { selected } : {})}
            onSelect={setSelected}
            onStart={(handle) => void act(() => api.start(handle))}
            onStop={(handle) => void act(() => api.stop(handle))}
          />
          <Enlist
            agents={agents}
            busy={busy}
            onEnlist={(agentId, mission, start) =>
              void act(() => api.enlist({ agentId, mission, start }))
            }
          />
        </aside>

        <section className="centre">
          <div className="pane-head">
            <h3>{selected ? `${selected} · terminal` : 'terminal'}</h3>
            {selected ? <code>{members.find((m) => m.handle === selected)?.branch}</code> : null}
          </div>
          {selected ? (
            <TerminalPane key={selected} handle={selected} live={live} />
          ) : (
            <p className="empty">Select a member to watch it work.</p>
          )}
        </section>

        <aside className="right">
          <nav className="tabs">
            {(['feed', 'board', 'leases', 'events'] as Tab[]).map((name) => (
              <button
                key={name}
                className={name === tab ? 'active' : ''}
                onClick={() => setTab(name)}
              >
                {name}
              </button>
            ))}
          </nav>

          {tab === 'feed' ? (
            <Feed
              messages={messages}
              handles={handles}
              onSend={(to, subject, body) =>
                void act(() => api.send({ from: 'workspace', to, subject, body }))
              }
            />
          ) : null}

          {tab === 'board' ? (
            <Board
              tasks={tasks}
              onCreate={(title) => void act(() => api.createTask({ title }))}
              onMove={(id, status) => void act(() => api.moveTask(id, status))}
            />
          ) : null}

          {tab === 'leases' ? <Leases leases={leases} /> : null}

          {tab === 'events' ? (
            <ul className="events">
              {live.events.map((event) => (
                <li key={event.id}>
                  <span className="type">{event.type}</span>
                  <span className="actor">{event.actor}</span>
                  <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
                </li>
              ))}
            </ul>
          ) : null}
        </aside>
      </main>
    </div>
  );
}
