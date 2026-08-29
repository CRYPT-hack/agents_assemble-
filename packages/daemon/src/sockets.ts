import type { Server } from 'node:http';

import type { Workspace, WorkspaceEvent } from '@assemble/core';
import { WebSocketServer, type WebSocket } from 'ws';

import type { Runtime } from './runtime.js';

/** Messages a console sends up the socket. */
type ClientMessage =
  | { type: 'attach'; handle: string }
  | { type: 'detach'; handle: string }
  | { type: 'input'; handle: string; data: string }
  | { type: 'resize'; handle: string; cols: number; rows: number };

/** Messages the daemon sends down. */
type ServerMessage =
  | { type: 'hello'; snapshot: unknown; seq: number }
  | { type: 'event'; event: WorkspaceEvent }
  | { type: 'output'; handle: string; chunk: string }
  | { type: 'scrollback'; handle: string; data: string }
  | { type: 'error'; message: string };

interface Connection {
  socket: WebSocket;
  /** Handles this console is watching terminals for. */
  attached: Set<string>;
}

/**
 * How the console watches the workspace.
 *
 * Two streams share one socket: workspace events (who joined, who messaged
 * whom, which files are claimed) and raw terminal output for whichever members
 * the console is currently showing.
 *
 * Events are read back out of the database rather than taken straight from the
 * runtime, because most of them are not written by the daemon at all — they are
 * written by the agents' own MCP processes. Polling the log is what lets the
 * console see agents talking to each other.
 */
export class SocketHub {
  private readonly connections = new Set<Connection>();
  private readonly wss: WebSocketServer;
  private pump?: NodeJS.Timeout;
  private cursor: number;

  constructor(
    server: Server,
    private readonly workspace: Workspace,
    private readonly runtime: Runtime,
    private readonly pollMs = 400,
  ) {
    this.cursor = workspace.events.latestSeq();
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (socket) => this.accept(socket));

    runtime.on('output', ({ handle, chunk }) => {
      this.broadcast({ type: 'output', handle, chunk }, (connection) => connection.attached.has(handle));
    });
  }

  /** Begin forwarding newly logged events to every connected console. */
  start(): void {
    if (this.pump) return;
    this.pump = setInterval(() => this.drain(), this.pollMs);
    this.pump.unref();
  }

  stop(): void {
    if (this.pump) clearInterval(this.pump);
    this.pump = undefined;
    for (const connection of this.connections) connection.socket.close();
    this.connections.clear();
    this.wss.close();
  }

  private accept(socket: WebSocket): void {
    const connection: Connection = { socket, attached: new Set() };
    this.connections.add(connection);

    this.send(connection, {
      type: 'hello',
      snapshot: { ...this.workspace.snapshot(), running: this.runtime.handles() },
      seq: this.workspace.events.latestSeq(),
    });

    socket.on('message', (raw) => this.receive(connection, raw.toString()));
    socket.on('close', () => this.connections.delete(connection));
    socket.on('error', () => this.connections.delete(connection));
  }

  private receive(connection: Connection, raw: string): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(connection, { type: 'error', message: 'Malformed message' });
      return;
    }

    try {
      switch (message.type) {
        case 'attach': {
          connection.attached.add(message.handle);
          this.send(connection, {
            type: 'scrollback',
            handle: message.handle,
            data: this.runtime.scrollback(message.handle),
          });
          break;
        }
        case 'detach':
          connection.attached.delete(message.handle);
          break;
        case 'input':
          this.runtime.write(message.handle, message.data);
          break;
        case 'resize':
          this.runtime.resize(message.handle, message.cols, message.rows);
          break;
        default:
          this.send(connection, { type: 'error', message: 'Unknown message type' });
      }
    } catch (error) {
      this.send(connection, {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Ship every event logged since the last pass. */
  private drain(): void {
    if (this.connections.size === 0) {
      this.cursor = this.workspace.events.latestSeq();
      return;
    }

    const events = this.workspace.events.since(this.cursor, 200);
    for (const event of events) {
      this.cursor = Math.max(this.cursor, event.seq);
      this.broadcast({ type: 'event', event });
    }
  }

  private broadcast(message: ServerMessage, filter?: (connection: Connection) => boolean): void {
    for (const connection of this.connections) {
      if (filter && !filter(connection)) continue;
      this.send(connection, message);
    }
  }

  private send(connection: Connection, message: ServerMessage): void {
    if (connection.socket.readyState !== connection.socket.OPEN) return;
    connection.socket.send(JSON.stringify(message));
  }
}
