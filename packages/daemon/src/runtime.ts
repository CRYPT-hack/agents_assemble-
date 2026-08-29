import { EventEmitter } from 'node:events';

import {
  AssembleError,
  renderPrompt,
  requireAgent,
  type Member,
  type Workspace,
  type WorkspaceEvent,
} from '@assemble/core';

import { openTerminal, type Terminal } from './terminal.js';

/** How much of each member's output the daemon keeps for late joiners. */
const SCROLLBACK_BYTES = 256 * 1024;

export interface RuntimeOptions {
  /** Command members run to reach the bus, written into their MCP config. */
  mcpCommand: string;
  mcpArgs: string[];
  dbPath: string;
  /** Extra PATH entries, so a workspace-local `assemble-mcp` resolves. */
  pathPrefix?: string[];
}

export interface StartOptions {
  /** Extra arguments appended after the agent's own. */
  args?: string[];
  /** Override the member's stored mission for this run. */
  mission?: string;
  cols?: number;
  rows?: number;
}

interface Running {
  handle: string;
  terminal: Terminal;
  scrollback: string[];
  scrollbackBytes: number;
  startedAt: number;
}

export interface RuntimeEvents {
  output: [{ handle: string; chunk: string }];
  exit: [{ handle: string; code: number; signal?: number }];
  event: [WorkspaceEvent];
}

/**
 * Supervises the agent processes.
 *
 * The workspace knows who the members are; the runtime is what actually runs
 * them — one child process per member, in that member's own worktree, with the
 * bus wired into its environment. Output is kept in a small ring buffer so a
 * console that connects late still sees what happened.
 */
export class Runtime extends EventEmitter<RuntimeEvents> {
  private readonly running = new Map<string, Running>();

  constructor(
    private readonly workspace: Workspace,
    private readonly options: RuntimeOptions,
  ) {
    super();
  }

  isRunning(handle: string): boolean {
    return this.running.has(handle);
  }

  handles(): string[] {
    return [...this.running.keys()];
  }

  scrollback(handle: string): string {
    return this.running.get(handle)?.scrollback.join('') ?? '';
  }

  async start(handle: string, options: StartOptions = {}): Promise<Member> {
    if (this.running.has(handle)) {
      throw new AssembleError('conflict', `${handle} is already running`, { handle });
    }

    const member = this.workspace.crew.require(handle);
    const spec = requireAgent(member.agentId);
    const mission = options.mission ?? member.mission;

    const args = [...spec.args, ...(options.args ?? [])];
    if (spec.promptMode === 'argv' && mission) args.push(renderPrompt(spec, mission));

    const terminal = await openTerminal({
      command: spec.command,
      args,
      cwd: member.worktree,
      env: this.envFor(handle),
      ...(options.cols ? { cols: options.cols } : {}),
      ...(options.rows ? { rows: options.rows } : {}),
    }).catch((cause: unknown) => {
      this.workspace.crew.setStatus(handle, 'failed', `could not start ${spec.command}`);
      throw new AssembleError('spawn_failed', `Could not start ${spec.command} for ${handle}`, {
        handle,
        command: spec.command,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    });

    const state: Running = { handle, terminal, scrollback: [], scrollbackBytes: 0, startedAt: Date.now() };
    this.running.set(handle, state);

    terminal.onData((chunk) => {
      this.remember(state, chunk);
      this.emit('output', { handle, chunk });
    });

    terminal.onExit((code, signal) => {
      this.running.delete(handle);
      this.workspace.crew.setPid(handle, undefined);
      this.workspace.crew.setStatus(handle, code === 0 ? 'done' : 'failed', `exited with code ${code}`);
      this.workspace.events.append('member.exited', handle, { code, signal });
      this.workspace.leases.releaseAll(handle);
      this.emit('exit', { handle, code, ...(signal !== undefined ? { signal } : {}) });
    });

    this.workspace.crew.setPid(handle, terminal.pid);
    this.workspace.crew.setStatus(handle, 'working', mission || undefined);

    if (spec.promptMode === 'stdin' && mission) {
      // Give the agent a moment to draw its prompt before typing at it.
      setTimeout(() => terminal.write(`${renderPrompt(spec, mission)}\n`), 750);
    }

    return this.workspace.crew.require(handle);
  }

  write(handle: string, data: string): void {
    const state = this.running.get(handle);
    if (!state) throw new AssembleError('not_running', `${handle} is not running`, { handle });
    state.terminal.write(data);
  }

  resize(handle: string, cols: number, rows: number): void {
    this.running.get(handle)?.terminal.resize(cols, rows);
  }

  stop(handle: string, signal: NodeJS.Signals = 'SIGTERM'): void {
    const state = this.running.get(handle);
    if (!state) throw new AssembleError('not_running', `${handle} is not running`, { handle });
    state.terminal.kill(signal);
    this.workspace.crew.standDown(handle, 'stopped by the operator');
  }

  /** Stop everything — what the daemon does on the way down. */
  stopAll(signal: NodeJS.Signals = 'SIGTERM'): void {
    for (const state of this.running.values()) state.terminal.kill(signal);
    this.running.clear();
  }

  private envFor(handle: string): NodeJS.ProcessEnv {
    const delimiter = process.platform === 'win32' ? ';' : ':';
    const prefix = this.options.pathPrefix ?? [];
    const path = [...prefix, process.env['PATH'] ?? ''].filter(Boolean).join(delimiter);

    return {
      ...process.env,
      PATH: path,
      Path: path,
      ASSEMBLE_HANDLE: handle,
      ASSEMBLE_DB: this.options.dbPath,
      ASSEMBLE_WORKSPACE: this.workspace.config.name,
    };
  }

  /** Keep the tail of a member's output, bounded by bytes rather than lines. */
  private remember(state: Running, chunk: string): void {
    state.scrollback.push(chunk);
    state.scrollbackBytes += chunk.length;

    while (state.scrollbackBytes > SCROLLBACK_BYTES && state.scrollback.length > 1) {
      const dropped = state.scrollback.shift();
      state.scrollbackBytes -= dropped?.length ?? 0;
    }
  }
}
