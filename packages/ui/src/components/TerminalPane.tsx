import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import type { Live } from '../useLive';

interface Props {
  handle: string;
  live: Live;
}

const THEME = {
  background: '#0d1117',
  foreground: '#d7dce3',
  cursor: '#7ee787',
  selectionBackground: '#264f78',
  black: '#0d1117',
  brightBlack: '#4b5563',
};

/**
 * One member's terminal.
 *
 * The xterm instance is keyed by handle and torn down when the selection
 * changes, so switching members never bleeds one agent's output into another's
 * scrollback.
 */
export function TerminalPane({ handle, live }: Props): JSX.Element {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: false,
      convertEol: true,
      scrollback: 5000,
      theme: THEME,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();

    live.attach(handle);
    live.resize(handle, term.cols, term.rows);

    const offOutput = live.onOutput((who, chunk, replace) => {
      if (who !== handle) return;
      if (replace) term.clear();
      term.write(chunk);
    });

    const offInput = term.onData((data) => live.input(handle, data));

    const observer = new ResizeObserver(() => {
      fit.fit();
      live.resize(handle, term.cols, term.rows);
    });
    observer.observe(host.current);

    return () => {
      observer.disconnect();
      offInput.dispose();
      offOutput();
      live.detach(handle);
      term.dispose();
    };
  }, [handle, live]);

  return <div className="terminal" ref={host} />;
}
