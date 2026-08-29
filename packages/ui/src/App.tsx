import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';

import { api } from './api';
import type { Command } from './command';
import { Canvas } from './components/Canvas';
import { CommandBar } from './components/CommandBar';
import { Drawer } from './components/Drawer';
import { Hero } from './components/Hero';
import { TopBar, type Panel } from './components/TopBar';
import type { Agent, Lease, Member, Message, Task } from './types';
import { useLive } from './useLive';

/**
 * The console.
 *
 * One socket keeps it live; everything else is refetched whenever an event says
 * something changed, which is cheap at this scale and keeps a single source of
 * truth in the daemon rather than a second one in the browser.
 *
 * Two states only: no crew yet, which is the hero and its launcher, or a crew,
 * which is the canvas. There is no third screen to get lost in.
 */
export function App(): JSX.Element {
  const live = useLive();

  const [members, setMembers] = useState<Member[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);

  const [focused, setFocused] = useState<string>();
  const [panel, setPanel] = useState<Panel>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();

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
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
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
    if (!focused && members.length > 0) setFocused(members[0]?.handle);
  }, [members, focused]);

  const act = useCallback(
    async (fn: () => Promise<unknown>, said?: string): Promise<void> => {
      setBusy(true);
      try {
        await fn();
        await refresh();
        setNotice(said);
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const run = useCallback(
    (command: Command): void => {
      switch (command.kind) {
        case 'type':
          live.input(command.handle, `${command.text}\r`);
          setNotice(undefined);
          return;

        case 'message':
          void act(
            () => api.send({ from: 'workspace', to: command.to, subject: command.subject, body: command.body }),
            `sent to ${command.to.join(', ')}`,
          );
          return;

        case 'broadcast':
          void act(
            () => api.send({ from: 'workspace', subject: command.subject, body: command.body }),
            'broadcast to everyone working',
          );
          return;

        case 'task':
          void act(() => api.createTask({ title: command.title }), 'filed on the board');
          return;

        case 'enlist':
          void act(
            () => api.enlist({ agentId: command.agentId, mission: command.mission, start: true }),
            `${command.agentId} enlisted`,
          );
          return;

        case 'start':
          void act(() => api.start(command.handle), `${command.handle} started`);
          return;

        case 'stop':
          void act(() => api.stop(command.handle), `${command.handle} stopped`);
          return;

        case 'help':
          setNotice(undefined);
          return;

        case 'error':
          setNotice(command.message);
      }
    },
    [act, live],
  );

  const name = live.snapshot?.config.name ?? 'workspace';
  const running = members.filter((member) => member.running).length;
  const openTasks = tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled').length;
  const blocked = members.filter((member) => member.status === 'blocked').length;

  if (members.length === 0) {
    return (
      <div className="app">
        <TopBar
          name={name}
          {...(live.snapshot?.config.repoRoot ? { repoRoot: live.snapshot.config.repoRoot } : {})}
          connected={live.connected}
          readouts={[]}
          onPanel={setPanel}
        />
        <Hero
          agents={agents}
          busy={busy}
          {...(live.snapshot?.config.repoRoot ? { repoRoot: live.snapshot.config.repoRoot } : {})}
          {...(live.snapshot?.config.baseBranch ? { baseBranch: live.snapshot.config.baseBranch } : {})}
          onEnlist={(agentId, mission) =>
            void act(() => api.enlist({ agentId, mission, start: true }), `${agentId} enlisted`)
          }
        />
        {notice ? <div className="toast">{notice}</div> : null}
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar
        name={name}
        {...(live.snapshot?.config.repoRoot ? { repoRoot: live.snapshot.config.repoRoot } : {})}
        connected={live.connected}
        readouts={[
          { label: 'crew', value: members.length },
          { label: 'running', value: running, tone: 'phos' },
          { label: 'claims', value: leases.length, tone: leases.length > 0 ? 'amber' : undefined },
          { label: 'open work', value: openTasks },
          ...(blocked > 0 ? [{ label: 'blocked', value: blocked, tone: 'coral' as const }] : []),
        ]}
        {...(panel ? { panel } : {})}
        onPanel={setPanel}
      />

      <div className="stage">
        <Canvas
          members={members}
          messages={messages}
          leases={leases}
          live={live}
          workspaceName={name}
          {...(focused ? { focused } : {})}
          onFocus={setFocused}
          onStart={(handle) => void act(() => api.start(handle), `${handle} started`)}
          onStop={(handle) => void act(() => api.stop(handle), `${handle} stopped`)}
        />

        {panel ? (
          <Drawer
            panel={panel}
            messages={messages}
            tasks={tasks}
            leases={leases}
            events={live.events}
            onClose={() => setPanel(undefined)}
            onPickHandle={(handle) => {
              if (members.some((member) => member.handle === handle)) setFocused(handle);
            }}
            onCreateTask={(title) => void act(() => api.createTask({ title }), 'filed on the board')}
            onMoveTask={(id, status) => void act(() => api.moveTask(id, status))}
          />
        ) : null}
      </div>

      <CommandBar
        {...(focused ? { focused } : {})}
        handles={members.map((member) => member.handle)}
        onRun={run}
        {...(notice ? { notice } : {})}
      />
    </div>
  );
}
