import { useEffect, useRef } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import type { Member } from '../types';
import type { Live } from '../useLive';

export interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  member: Member;
  frame: WindowFrame;
  live: Live;
  focused: boolean;
  collapsed: boolean;
  onFocus(): void;
  onDragStart(event: ReactPointerEvent): void;
  onResizeStart(event: ReactPointerEvent): void;
  onCollapse(): void;
  onStart(): void;
  onStop(): void;
}

const THEME = {
  background: '#05070a',
  foreground: '#cfe3d6',
  cursor: '#5ef2a0',
  cursorAccent: '#05070a',
  selectionBackground: 'rgba(94, 242, 160, 0.22)',
  black: '#05070a',
  red: '#ff6b5e',
  green: '#5ef2a0',
  yellow: '#f2c15e',
  blue: '#56cfe1',
  magenta: '#a78bfa',
  cyan: '#56cfe1',
  white: '#dfe5ee',
  brightBlack: '#5d6b80',
};

function statusClass(status: string): string {
  if (status === 'working') return 'live';
  if (status === 'blocked' || status === 'failed') return 'bad';
  if (status === 'waiting' || status === 'review') return 'warn';
  return 'idle';
}

/**
 * One agent, in a window that looks like the terminal it actually is.
 *
 * The chrome is deliberate: traffic lights and a `handle — agent — 80×24` title
 * mean you read this as a terminal you can type into, not as a log panel. The
 * xterm instance mounts only while the window is open, so a canvas of a dozen
 * agents does not run a dozen renderers at once.
 */
export function TerminalWindow(props: Props): JSX.Element {
  const { member, frame, live, focused, collapsed } = props;
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sizeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (collapsed || !host.current) return;

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 11,
      lineHeight: 1.25,
      cursorBlink: focused,
      convertEol: true,
      scrollback: 4000,
      allowTransparency: true,
      theme: THEME,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    live.attach(member.handle);
    live.resize(member.handle, term.cols, term.rows);

    const offOutput = live.onOutput((who, chunk, replace) => {
      if (who !== member.handle) return;
      if (replace) term.clear();
      term.write(chunk);
    });

    const offInput = term.onData((data) => live.input(member.handle, data));

    const observer = new ResizeObserver(() => {
      fit.fit();
      live.resize(member.handle, term.cols, term.rows);
      if (sizeRef.current) sizeRef.current.textContent = `${term.cols}×${term.rows}`;
    });
    observer.observe(host.current);

    if (sizeRef.current) sizeRef.current.textContent = `${term.cols}×${term.rows}`;

    return () => {
      observer.disconnect();
      offInput.dispose();
      offOutput();
      live.detach(member.handle);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [member.handle, live, collapsed, focused]);

  /** Focus follows click, so the command bar knows where to send what you type. */
  useEffect(() => {
    if (focused) termRef.current?.focus();
  }, [focused]);

  const running = member.running === true;

  return (
    <section
      className={`win${focused ? ' focused' : ''}${collapsed ? ' collapsed' : ''}`}
      style={{
        transform: `translate(${frame.x}px, ${frame.y}px)`,
        width: frame.width,
        height: collapsed ? undefined : frame.height,
      }}
      onPointerDown={props.onFocus}
    >
      <header className="chrome" onPointerDown={props.onDragStart} onDoubleClick={props.onCollapse}>
        <span className="lights" aria-hidden="true">
          <i className="close" />
          <i className="min" />
          <i className="max" />
        </span>

        <span className="title">
          <b>{member.handle}</b>
          <span className="sep">—</span>
          {member.agentId}
          <span className="sep">—</span>
          <span ref={sizeRef}>80×24</span>
        </span>

        <span className="chrome-right">
          {member.unread ? <span className="unread">{member.unread}</span> : null}
          <span className={`led ${statusClass(member.status)}`} title={member.status} />
        </span>
      </header>

      {collapsed ? (
        <div className="win-folded">
          <span className="mission">{member.mission || 'no mission set'}</span>
          <button className="ghost" onClick={props.onCollapse}>
            open
          </button>
        </div>
      ) : (
        <>
          <div className="screen" ref={host} />

          <footer className="win-foot">
            <span className="on-it" title={member.mission || 'no mission set'}>
              {member.mission || 'no mission set'}
            </span>
            <span className="spacer" />
            <code title={member.branch}>{member.branch}</code>
            {running ? (
              <button
                className="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onStop();
                }}
              >
                stop
              </button>
            ) : (
              <button
                className="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onStart();
                }}
              >
                start
              </button>
            )}
          </footer>

          <span className="grip" onPointerDown={props.onResizeStart} aria-hidden="true" />
        </>
      )}
    </section>
  );
}
