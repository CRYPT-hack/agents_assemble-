import { useState } from 'react';
import type { JSX } from 'react';

import type { Agent } from '../types';

interface Props {
  agents: Agent[];
  busy: boolean;
  repoRoot?: string;
  baseBranch?: string;
  onEnlist(agentId: string, mission: string): void;
}

/**
 * What you see before there is a crew.
 *
 * Not a marketing panel — a launcher. The drawing is the same shape the canvas
 * will take once agents are running, so the first thing the operator sees is
 * the mental model, and the form under it is how they get there.
 */
export function Hero({ agents, busy, repoRoot, baseBranch, onEnlist }: Props): JSX.Element {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? 'claude');
  const [mission, setMission] = useState('');

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    onEnlist(agentId, mission.trim());
    setMission('');
  };

  return (
    <div className="hero">
      <div className="hero-inner">
        <p className="hero-eyebrow">
          <span className="led live" /> workspace ready
          {baseBranch ? <span className="hero-branch">base {baseBranch}</span> : null}
        </p>

        <h1>
          Put every agent
          <br />
          in one room.
        </h1>

        <p className="hero-sub">
          Each one gets its own worktree, its own branch and its own terminal. The lines between them
          are the messages they send each other while they work — you watch the whole conversation
          from here.
        </p>

        <HeroDiagram />

        <form className="hero-launch" onSubmit={submit}>
          <div className="hero-agents">
            {agents.map((agent) => (
              <button
                type="button"
                key={agent.id}
                className={`chip${agent.id === agentId ? ' on' : ''}`}
                onClick={() => setAgentId(agent.id)}
                title={agent.speaksMcp ? 'Speaks the bus' : 'Runs, but cannot talk to the others'}
              >
                {agent.name}
                {agent.speaksMcp ? null : <span className="mute">no bus</span>}
              </button>
            ))}
          </div>

          <div className="hero-row">
            <input
              value={mission}
              placeholder="what should it work on?"
              onChange={(event) => setMission(event.target.value)}
            />
            <button className="primary" type="submit" disabled={busy}>
              {busy ? 'assembling…' : 'assemble'}
            </button>
          </div>
        </form>

        {repoRoot ? <p className="hero-foot">{repoRoot}</p> : null}
      </div>
    </div>
  );
}

/** The canvas, in miniature: a bus, three terminals, the lines between them. */
function HeroDiagram(): JSX.Element {
  return (
    <svg className="hero-diagram" viewBox="-6 0 626 210" role="img" aria-label="Three terminals linked to a shared bus">
      <defs>
        <marker id="hero-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--phos-dim)" />
        </marker>
      </defs>

      <path d="M 262 105 C 210 105, 200 42, 150 42" className="hero-line" markerEnd="url(#hero-arrow)" />
      <path d="M 262 105 C 220 105, 200 105, 150 105" className="hero-line" markerEnd="url(#hero-arrow)" />
      <path d="M 262 105 C 210 105, 200 168, 150 168" className="hero-line" markerEnd="url(#hero-arrow)" />
      <path d="M 358 105 C 410 105, 420 42, 470 42" className="hero-line" markerEnd="url(#hero-arrow)" />
      <path d="M 358 105 C 400 105, 420 105, 470 105" className="hero-line" markerEnd="url(#hero-arrow)" />

      {/* One agent talking straight to another, around the outside of the bus. */}
      <path
        d="M 40 64 C 6 92, 6 138, 40 146"
        className="hero-line talk"
        markerEnd="url(#hero-arrow)"
      />

      <MiniWindow x={20} y={20} label="claude" />
      <MiniWindow x={20} y={146} label="codex" />
      <MiniWindow x={20} y={83} label="gemini" />
      <MiniWindow x={470} y={20} label="aider" />
      <MiniWindow x={470} y={83} label="cursor" />

      <g transform="translate(262 82)">
        <rect width="96" height="46" rx="10" className="hero-hub" />
        <text x="48" y="21" textAnchor="middle" className="hero-hub-title">
          bus
        </text>
        <text x="48" y="34" textAnchor="middle" className="hero-hub-sub">
          mail · claims
        </text>
      </g>
    </svg>
  );
}

function MiniWindow({ x, y, label }: { x: number; y: number; label: string }): JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="130" height="44" rx="7" className="hero-win" />
      <rect width="130" height="13" rx="7" className="hero-win-bar" />
      <circle cx="9" cy="6.5" r="2.2" fill="#ff5f57" />
      <circle cx="17" cy="6.5" r="2.2" fill="#febc2e" />
      <circle cx="25" cy="6.5" r="2.2" fill="#28c840" />
      <text x="65" y="9.5" textAnchor="middle" className="hero-win-title">
        {label}
      </text>
      <text x="8" y="27" className="hero-win-line">
        $ claim src/**
      </text>
      <text x="8" y="38" className="hero-win-line dim">
        granted
      </text>
    </g>
  );
}
