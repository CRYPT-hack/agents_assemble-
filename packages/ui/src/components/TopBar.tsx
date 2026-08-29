import type { JSX } from 'react';

export type Panel = 'feed' | 'board' | 'claims' | 'events';

interface Props {
  name: string;
  repoRoot?: string;
  connected: boolean;
  readouts: Array<{ label: string; value: number; tone?: 'phos' | 'amber' | 'coral' }>;
  panel?: Panel;
  onPanel(panel: Panel | undefined): void;
}

const PANELS: Panel[] = ['feed', 'board', 'claims', 'events'];

/**
 * The strip across the top: who this workspace is, and the four numbers that
 * say whether anything is wrong. Everything else lives on the canvas.
 */
export function TopBar({ name, repoRoot, connected, readouts, panel, onPanel }: Props): JSX.Element {
  return (
    <header className="topbar">
      <div className="identity">
        <span className="mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div>
          <h1>{name}</h1>
          {repoRoot ? <p title={repoRoot}>{repoRoot}</p> : null}
        </div>
      </div>

      <div className="readouts">
        {readouts.map((readout) => (
          <div key={readout.label} className={`readout${readout.tone ? ` ${readout.tone}` : ''}`}>
            <b>{readout.value}</b>
            <span className="label">{readout.label}</span>
          </div>
        ))}
      </div>

      <div className="topbar-right">
        <span className={`conn${connected ? ' on' : ''}`}>
          <span className={`led ${connected ? 'live' : 'warn'}`} />
          {connected ? 'live' : 'reconnecting'}
        </span>

        <nav className="panel-tabs">
          {PANELS.map((name_) => (
            <button
              key={name_}
              className={`ghost${panel === name_ ? ' on' : ''}`}
              onClick={() => onPanel(panel === name_ ? undefined : name_)}
            >
              {name_}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
