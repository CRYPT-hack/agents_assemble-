import { useCallback, useEffect, useRef, useState } from 'react';

import type { ServerMessage, Snapshot, WorkspaceEvent } from './types';

type OutputListener = (handle: string, chunk: string, replace: boolean) => void;

export interface Live {
  connected: boolean;
  snapshot?: Snapshot;
  /** Latest events, newest first, capped so the console stays light. */
  events: WorkspaceEvent[];
  attach(handle: string): void;
  detach(handle: string): void;
  input(handle: string, data: string): void;
  resize(handle: string, cols: number, rows: number): void;
  onOutput(listener: OutputListener): () => void;
}

const EVENT_LIMIT = 300;

/**
 * One socket for the whole console.
 *
 * Workspace events drive React state; terminal output does not — it is pushed
 * straight to whichever xterm instance is listening, because re-rendering on
 * every chunk of agent output would make the page crawl.
 */
export function useLive(): Live {
  const socketRef = useRef<WebSocket | null>(null);
  const listeners = useRef(new Set<OutputListener>());
  const attached = useRef(new Set<string>());

  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [events, setEvents] = useState<WorkspaceEvent[]>([]);

  useEffect(() => {
    let closed = false;
    let retry: number | undefined;

    const connect = (): void => {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${protocol}://${location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        // Re-attach anything the console was already watching.
        for (const handle of attached.current) {
          socket.send(JSON.stringify({ type: 'attach', handle }));
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = window.setTimeout(connect, 1000);
      };

      socket.onmessage = (raw) => {
        const message = JSON.parse(raw.data as string) as ServerMessage;

        if (message.type === 'hello') {
          setSnapshot(message.snapshot);
        } else if (message.type === 'event') {
          setSnapshot((current) => (current ? { ...current, seq: message.event.seq } : current));
          setEvents((current) => [message.event, ...current].slice(0, EVENT_LIMIT));
        } else if (message.type === 'output') {
          for (const listener of listeners.current) listener(message.handle, message.chunk, false);
        } else if (message.type === 'scrollback') {
          for (const listener of listeners.current) listener(message.handle, message.data, true);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      socketRef.current?.close();
    };
  }, []);

  const send = useCallback((payload: unknown): void => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }, []);

  return {
    connected,
    snapshot,
    events,
    attach: useCallback(
      (handle) => {
        attached.current.add(handle);
        send({ type: 'attach', handle });
      },
      [send],
    ),
    detach: useCallback(
      (handle) => {
        attached.current.delete(handle);
        send({ type: 'detach', handle });
      },
      [send],
    ),
    input: useCallback((handle, data) => send({ type: 'input', handle, data }), [send]),
    resize: useCallback((handle, cols, rows) => send({ type: 'resize', handle, cols, rows }), [send]),
    onOutput: useCallback((listener: OutputListener) => {
      listeners.current.add(listener);
      return () => listeners.current.delete(listener);
    }, []),
  };
}
