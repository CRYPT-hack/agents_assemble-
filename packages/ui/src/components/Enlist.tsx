import { useState } from 'react';
import type { JSX } from 'react';

import type { Agent } from '../types';

interface Props {
  agents: Agent[];
  busy: boolean;
  onEnlist(agentId: string, mission: string, start: boolean): void;
}

/** Add another agent to the same project, without leaving the console. */
export function Enlist({ agents, busy, onEnlist }: Props): JSX.Element {
  const [agentId, setAgentId] = useState('claude');
  const [mission, setMission] = useState('');
  const [start, setStart] = useState(true);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    onEnlist(agentId, mission.trim(), start);
    setMission('');
  };

  return (
    <form className="enlist" onSubmit={submit}>
      <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
            {agent.speaksMcp ? '' : ' (no bus)'}
          </option>
        ))}
      </select>

      <input
        placeholder="what should it work on?"
        value={mission}
        onChange={(event) => setMission(event.target.value)}
      />

      <label className="start">
        <input type="checkbox" checked={start} onChange={(event) => setStart(event.target.checked)} />
        start it
      </label>

      <button type="submit" disabled={busy}>
        {busy ? 'enlisting…' : 'enlist'}
      </button>
    </form>
  );
}
