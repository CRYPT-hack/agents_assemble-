import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface TerminalOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}

export interface Terminal {
  readonly pid: number;
  /** True when the child is attached to a real pty rather than pipes. */
  readonly isPty: boolean;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: NodeJS.Signals): void;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: (code: number, signal?: number) => void): void;
}

type PtyModule = {
  spawn(
    file: string,
    args: string[],
    options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
  ): {
    pid: number;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
    onData(listener: (data: string) => void): void;
    onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
  };
};

let ptyModule: PtyModule | null | undefined;

/**
 * node-pty is an optional dependency: with it, agents get a real terminal and
 * their full interactive UI; without it, they still run over pipes. Installing
 * must never fail because a native module would not build on someone's machine.
 */
async function loadPty(): Promise<PtyModule | null> {
  if (ptyModule !== undefined) return ptyModule;
  try {
    ptyModule = (await import('@homebridge/node-pty-prebuilt-multiarch')) as unknown as PtyModule;
  } catch {
    ptyModule = null;
  }
  return ptyModule;
}

class PtyTerminal implements Terminal {
  readonly isPty = true;

  constructor(private readonly pty: ReturnType<PtyModule['spawn']>) {}

  get pid(): number {
    return this.pty.pid;
  }

  write(data: string): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    try {
      this.pty.resize(Math.max(cols, 1), Math.max(rows, 1));
    } catch {
      // A pty that has already exited rejects resizes; nothing to do about it.
    }
  }

  kill(signal?: NodeJS.Signals): void {
    try {
      this.pty.kill(signal);
    } catch {
      // Already gone.
    }
  }

  onData(listener: (chunk: string) => void): void {
    this.pty.onData(listener);
  }

  onExit(listener: (code: number, signal?: number) => void): void {
    this.pty.onExit((event) => listener(event.exitCode, event.signal));
  }
}

class PipeTerminal implements Terminal {
  readonly isPty = false;
  private readonly listeners: Array<(chunk: string) => void> = [];

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    const forward = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      for (const listener of this.listeners) listener(text);
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
  }

  get pid(): number {
    return this.child.pid ?? -1;
  }

  write(data: string): void {
    if (this.child.stdin.writable) this.child.stdin.write(data);
  }

  resize(): void {
    // No terminal, no geometry.
  }

  kill(signal?: NodeJS.Signals): void {
    this.child.kill(signal ?? 'SIGTERM');
  }

  onData(listener: (chunk: string) => void): void {
    this.listeners.push(listener);
  }

  onExit(listener: (code: number, signal?: number) => void): void {
    this.child.on('exit', (code, signal) => listener(code ?? 0, signal ? 1 : undefined));
  }
}

/** Start a process for a member, on a pty when one is available. */
export async function openTerminal(options: TerminalOptions): Promise<Terminal> {
  const pty = await loadPty();

  if (pty) {
    const session = pty.spawn(options.command, options.args, {
      name: 'xterm-256color',
      cols: options.cols ?? 120,
      rows: options.rows ?? 32,
      cwd: options.cwd,
      env: options.env,
    });
    return new PtyTerminal(session);
  }

  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  }) as ChildProcessWithoutNullStreams;

  return new PipeTerminal(child);
}

/** Whether this machine can give agents a real terminal. */
export async function ptyAvailable(): Promise<boolean> {
  return (await loadPty()) !== null;
}
