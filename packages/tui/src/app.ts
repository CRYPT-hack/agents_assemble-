import { parseCommand, COMMAND_HELP, type Command, type Lease, type Member, type Message } from '@assemble/core';
import type { Daemon } from '@assemble/daemon';

import { PALETTE, centre, pad, paint, truncate } from './ansi.js';
import { drawBus, drawWindow, drawWire, drawWireLabel, type WireTone } from './draw.js';
import { Grid } from './grid.js';
import { parseKeys, type Key } from './keys.js';
import { planLayout, type Box } from './layout.js';
import { Pane } from './pane.js';
import { Screen } from './screen.js';

const FRAME_MS = 90;
const RECENT_MS = 12_000;
const DETACH = String.fromCharCode(29); // ctrl-]

type Mode = 'command' | 'attach';

export interface TuiOptions {
  daemon: Daemon;
  screen?: Screen;
}

/**
 * The workspace, in the terminal you already have open.
 *
 * Every agent gets a pane; the panes are wired to a bus in the middle; one
 * command line at the bottom drives all of them. It is the same model as the
 * web console, drawn in characters, and it is the reason you never have to
 * leave the terminal to run a crew.
 */
export class Tui {
  private readonly screen: Screen;
  private readonly panes = new Map<string, Pane>();

  private members: Member[] = [];
  private messages: Message[] = [];
  private leases: Lease[] = [];

  private focus = 0;
  private mode: Mode = 'command';
  private input = '';
  private history: string[] = [];
  private historyAt = -1;
  private notice = '';
  private showHelp = false;
  private quitting = false;

  constructor(private readonly options: TuiOptions) {
    this.screen = options.screen ?? new Screen();
  }

  private get daemon(): Daemon {
    return this.options.daemon;
  }

  /** Runs until the operator quits. */
  async start(): Promise<void> {
    const { runtime } = this.daemon;

    this.screen.enter();
    this.refresh();
    this.notice = 'ctrl-a attaches your keyboard to a pane · /help for the grammar · /quit to leave';

    const offOutput = (chunk: { handle: string; chunk: string }): void => {
      this.paneFor(chunk.handle)?.write(chunk.chunk);
    };
    runtime.on('output', offOutput);

    const offKeys = this.screen.onKey((data) => {
      for (const key of parseKeys(data)) this.handleKey(key);
    });
    const offResize = this.screen.onResize(() => this.render());

    const ticker = setInterval(() => {
      this.refresh();
      this.render();
    }, FRAME_MS);

    await new Promise<void>((resolve) => {
      const finish = (): void => {
        if (!this.quitting) return;
        clearInterval(ticker);
        resolve();
      };

      this.onQuit = finish;
    });

    clearInterval(ticker);
    offKeys();
    offResize();
    runtime.off('output', offOutput);

    for (const pane of this.panes.values()) pane.dispose();
    this.panes.clear();
    this.screen.leave();
  }

  private onQuit: () => void = () => undefined;

  // -- state ---------------------------------------------------------------

  private refresh(): void {
    const { workspace, runtime } = this.daemon;

    this.members = workspace.crew.list().map((member) => ({
      ...member,
      // The list is what the panes render from, so carry liveness with it.
      ...(runtime.isRunning(member.handle) ? { pid: member.pid ?? 0 } : {}),
    }));

    this.messages = workspace.bus.recent(60);
    this.leases = workspace.leases.active();

    if (this.focus >= this.members.length) this.focus = Math.max(0, this.members.length - 1);

    // Panes follow the crew: new members get one, discharged members lose theirs.
    const handles = new Set(this.members.map((member) => member.handle));
    for (const [handle, pane] of this.panes) {
      if (!handles.has(handle)) {
        pane.dispose();
        this.panes.delete(handle);
      }
    }
  }

  private paneFor(handle: string): Pane | undefined {
    if (this.panes.has(handle)) return this.panes.get(handle);
    if (!this.members.some((member) => member.handle === handle)) return undefined;

    const pane = new Pane(handle, 80, 24);
    // Seed with whatever the daemon already buffered, so a pane opened late is
    // not blank while the agent sits at a prompt waiting for input.
    pane.write(this.daemon.runtime.scrollback(handle));
    this.panes.set(handle, pane);
    return pane;
  }

  private get focused(): Member | undefined {
    return this.members[this.focus];
  }

  // -- input ---------------------------------------------------------------

  private handleKey(key: Key): void {
    if (this.mode === 'attach') {
      if (key.raw === DETACH) {
        this.mode = 'command';
        this.notice = 'detached — your keyboard is back on the command line';
        return;
      }

      const handle = this.focused?.handle;
      if (handle && this.daemon.runtime.isRunning(handle)) {
        try {
          this.daemon.runtime.write(handle, key.raw);
        } catch {
          this.notice = `${handle} is not running`;
        }
      }
      return;
    }

    if (key.ctrl) {
      switch (key.name) {
        case 'a':
          this.attach();
          return;
        case 'n':
          this.moveFocus(1);
          return;
        case 'p':
          this.moveFocus(-1);
          return;
        case 'c':
        case 'q':
          this.quit();
          return;
        default:
          return;
      }
    }

    switch (key.name) {
      case 'enter':
        this.submit();
        return;
      case 'backspace':
        this.input = this.input.slice(0, -1);
        return;
      case 'tab':
        this.complete();
        return;
      case 'up':
        this.recall(1);
        return;
      case 'down':
        this.recall(-1);
        return;
      case 'escape':
        this.input = '';
        this.showHelp = false;
        return;
      default:
        if (key.raw.length === 1 && key.raw >= ' ') this.input += key.raw;
    }
  }

  private moveFocus(delta: number): void {
    if (this.members.length === 0) return;
    this.focus = (this.focus + delta + this.members.length) % this.members.length;
  }

  private attach(): void {
    const member = this.focused;
    if (!member) {
      this.notice = 'nobody to attach to yet';
      return;
    }
    if (!this.daemon.runtime.isRunning(member.handle)) {
      this.notice = `${member.handle} is not running — /start ${member.handle}`;
      return;
    }

    this.mode = 'attach';
    this.notice = `attached to ${member.handle} — ctrl-] to come back`;
  }

  private complete(): void {
    if (!this.input.startsWith('@') || this.input.includes(' ')) {
      this.moveFocus(1);
      return;
    }

    const prefix = this.input.slice(1);
    const match = this.members.find((member) => member.handle.startsWith(prefix));
    if (match) this.input = `@${match.handle} `;
  }

  private recall(delta: number): void {
    if (this.history.length === 0) return;

    this.historyAt = Math.min(this.history.length - 1, Math.max(-1, this.historyAt + delta));
    this.input = this.historyAt < 0 ? '' : (this.history[this.historyAt] ?? '');
  }

  private submit(): void {
    const text = this.input.trim();
    if (text === '') return;

    this.history.unshift(text);
    this.history = this.history.slice(0, 80);
    this.historyAt = -1;
    this.input = '';

    void this.run(text);
  }

  // -- commands ------------------------------------------------------------

  private async run(text: string): Promise<void> {
    const lower = text.toLowerCase();

    // Commands that only make sense when the console is the terminal itself.
    if (lower === '/quit' || lower === '/q' || lower === '/exit') {
      this.quit();
      return;
    }
    if (lower === '/attach' || lower === '/a') {
      this.attach();
      return;
    }
    if (lower.startsWith('/focus ')) {
      const handle = text.slice(7).trim();
      const index = this.members.findIndex((member) => member.handle === handle);
      if (index === -1) this.notice = `no member called ${handle}`;
      else this.focus = index;
      return;
    }

    const command = parseCommand(text, this.focused?.handle);
    const { workspace, runtime } = this.daemon;

    try {
      switch (command.kind) {
        case 'type':
          runtime.write(command.handle, `${command.text}\r`);
          this.notice = '';
          return;

        case 'message':
          workspace.bus.send({
            from: 'workspace',
            to: command.to,
            subject: command.subject,
            body: command.body,
          });
          this.notice = `sent to ${command.to.join(', ')}`;
          return;

        case 'broadcast':
          workspace.bus.send({ from: 'workspace', subject: command.subject, body: command.body });
          this.notice = 'broadcast to everyone working';
          return;

        case 'task':
          workspace.board.create({ title: command.title, createdBy: 'workspace' });
          this.notice = 'filed on the board';
          return;

        case 'enlist': {
          this.notice = `enlisting ${command.agentId}…`;
          const result = await workspace.crew.enlist({
            agentId: command.agentId,
            mission: command.mission,
          });
          await runtime.start(result.member.handle);
          this.refresh();
          this.focus = this.members.findIndex((member) => member.handle === result.member.handle);
          this.notice = `${result.member.handle} joined on ${result.member.branch}`;
          return;
        }

        case 'start':
          await runtime.start(command.handle);
          this.notice = `${command.handle} started`;
          return;

        case 'stop':
          runtime.stop(command.handle);
          this.notice = `${command.handle} stopped`;
          return;

        case 'help':
          this.showHelp = !this.showHelp;
          this.notice = '';
          return;

        case 'error':
          this.notice = command.message;
      }
    } catch (cause) {
      this.notice = cause instanceof Error ? cause.message : String(cause);
    }
  }

  private quit(): void {
    this.quitting = true;
    this.onQuit();
  }

  // -- rendering -----------------------------------------------------------

  private render(): void {
    const { cols, rows } = this.screen.size();
    const grid = new Grid(cols, rows);

    const headerRows = 2;
    const footerRows = this.showHelp ? 3 + COMMAND_HELP.length : 3;
    const bodyTop = headerRows;
    const bodyHeight = Math.max(4, rows - headerRows - footerRows);

    this.drawHeader(grid, cols);

    const layout = planLayout(cols - 2, bodyHeight, this.members.map((member) => member.handle));
    const boxes = layout.boxes.map((box) => ({ ...box, x: box.x + 1, y: box.y + bodyTop }));

    if (this.members.length === 0) {
      this.drawEmpty(grid, cols, bodyTop, bodyHeight);
    } else {
      const bus = layout.bus ? { ...layout.bus, x: layout.bus.x + 1, y: layout.bus.y + bodyTop } : undefined;
      this.drawWires(grid, boxes, bus);
      this.drawPanes(grid, boxes);
    }

    this.drawFooter(grid, cols, rows, footerRows);
    this.screen.render(grid.toLines());
  }

  private drawHeader(grid: Grid, cols: number): void {
    const { workspace, runtime } = this.daemon;
    const running = this.members.filter((member) => runtime.isRunning(member.handle)).length;
    const openTasks = workspace.board.list({ status: ['backlog', 'claimed', 'in_progress', 'review'] }).length;

    grid.text(1, 0, '●', PALETTE.coral);
    grid.text(3, 0, '●', PALETTE.amber);
    grid.text(5, 0, '●', PALETTE.phos);
    grid.text(8, 0, workspace.config.name, PALETTE.text);

    const stats = [
      `${this.members.length} crew`,
      `${running} running`,
      `${this.leases.length} claims`,
      `${openTasks} open`,
    ].join('   ');

    grid.text(Math.max(0, cols - stats.length - 12), 0, stats, PALETTE.dim);
    grid.text(cols - 10, 0, this.mode === 'attach' ? 'ATTACHED' : 'COMMAND', this.mode === 'attach' ? PALETTE.phos : PALETTE.faint);

    grid.text(0, 1, '─'.repeat(cols), PALETTE.rule);
  }

  private drawEmpty(grid: Grid, cols: number, top: number, height: number): void {
    const lines = [
      paint(PALETTE.text, 'No crew yet.'),
      '',
      paint(PALETTE.dim, 'Put an agent on the job:'),
      paint(PALETTE.phos, '/add claude port the parser to the new token type'),
      '',
      paint(PALETTE.faint, '/help lists the grammar · /quit gives the terminal back'),
    ];

    const start = top + Math.max(0, Math.floor((height - lines.length) / 2));
    lines.forEach((line, index) => grid.raw(Math.floor((cols - 52) / 2), start + index, line));
  }

  private drawPanes(grid: Grid, boxes: Box[]): void {
    const { runtime } = this.daemon;

    boxes.forEach((box, index) => {
      const member = this.members[index];
      if (!member) return;

      const pane = this.paneFor(member.handle);
      const innerWidth = box.width - 2;
      const innerHeight = box.height - 3;

      // The agent draws for the size we give it, so tell its pty the truth.
      if (pane && runtime.isRunning(member.handle)) {
        runtime.resize(member.handle, innerWidth, innerHeight);
      }

      const body = pane ? pane.render(innerWidth, innerHeight) : [];
      const focused = index === this.focus;
      const attached = focused && this.mode === 'attach';

      const border = attached ? PALETTE.phos : focused ? PALETTE.phosDim : PALETTE.rule;
      const unread = this.daemon.workspace.bus.unreadCount(member.handle);

      drawWindow(grid, box, {
        title: `${member.handle} — ${member.agentId} — ${innerWidth}×${innerHeight}`,
        subtitle: `${member.mission || 'no mission set'}`,
        right: `${unread > 0 ? `✉${unread} ` : ''}${statusMark(member.status)}`,
        style: { border, title: focused ? PALETTE.text : PALETTE.dim, focused },
        body,
      });
    });
  }

  private drawWires(
    grid: Grid,
    boxes: Box[],
    bus?: { x: number; y: number; width: number; height: number },
  ): void {
    if (!bus) return;

    const now = Date.now();
    const tones = new Map<string, WireTone>();
    let label: { text: string; tone: WireTone } | undefined;

    for (const message of this.messages) {
      if (now - Date.parse(message.createdAt) > RECENT_MS) continue;

      for (const handle of [message.from, ...message.to]) {
        if (handle === 'workspace') continue;
        tones.set(handle, 'live');
      }
      label ??= { text: message.subject, tone: 'live' };
    }

    // Two members on the same files: both wires go red, and that is the label.
    for (const lease of this.leases) {
      for (const other of this.leases) {
        if (lease.holder >= other.holder) continue;
        if (!overlaps(lease, other)) continue;

        tones.set(lease.holder, 'clash');
        tones.set(other.holder, 'clash');
        label = { text: `${lease.holder} ↔ ${other.holder} same files`, tone: 'clash' };
      }
    }

    const phase = (now % 1600) / 1600;

    boxes.forEach((box, index) => {
      const member = this.members[index];
      if (!member) return;

      const tone = tones.get(member.handle) ?? 'spine';
      drawWire(grid, bus, box, tone, tone === 'live' ? phase : undefined);
    });

    drawBus(
      grid,
      bus,
      this.daemon.workspace.config.name,
      [...tones.values()].some((tone) => tone === 'live'),
    );

    if (label) {
      drawWireLabel(grid, bus.x - 12, bus.y - 1, label.text, label.tone);
    }
  }

  private drawFooter(grid: Grid, cols: number, rows: number, footerRows: number): void {
    const top = rows - footerRows;
    grid.text(0, top, '─'.repeat(cols), PALETTE.rule);

    if (this.showHelp) {
      COMMAND_HELP.forEach(([syntax, meaning], index) => {
        grid.text(2, top + 1 + index, pad(syntax, 26), PALETTE.phos);
        grid.text(28, top + 1 + index, meaning, PALETTE.dim);
      });
      grid.text(2, top + 1 + COMMAND_HELP.length, pad('/attach  (ctrl-a)', 26), PALETTE.phos);
      grid.text(28, top + 1 + COMMAND_HELP.length, 'send your keystrokes to the focused pane', PALETTE.dim);
    }

    const noticeRow = rows - 2;
    if (this.notice) grid.text(2, noticeRow, truncate(this.notice, cols - 4), PALETTE.amber);

    const target =
      this.mode === 'attach'
        ? `${this.focused?.handle ?? ''} ⇥`
        : this.input.startsWith('@')
          ? 'message'
          : this.input.startsWith('/')
            ? 'command'
            : (this.focused?.handle ?? 'nowhere');

    const prompt = ` ${target} `;
    grid.text(1, rows - 1, prompt, this.mode === 'attach' ? PALETTE.phos : PALETTE.phosDim);

    if (this.mode === 'attach') {
      grid.text(prompt.length + 2, rows - 1, 'your keys are going to this pane — ctrl-] to detach', PALETTE.faint);
      return;
    }

    const room = cols - prompt.length - 4;
    const shown = this.input.length > room ? this.input.slice(this.input.length - room) : this.input;

    grid.text(prompt.length + 2, rows - 1, shown, PALETTE.text);
    grid.text(prompt.length + 2 + shown.length, rows - 1, '▁', PALETTE.phos);

    if (this.input === '') {
      grid.text(
        prompt.length + 4,
        rows - 1,
        truncate('type for the focused pane · @handle to message · / for commands', room - 2),
        PALETTE.faint,
      );
    }
  }
}

function statusMark(status: string): string {
  if (status === 'working') return paint(PALETTE.phos, '●');
  if (status === 'blocked' || status === 'failed') return paint(PALETTE.coral, '●');
  if (status === 'waiting' || status === 'review') return paint(PALETTE.amber, '●');
  return paint(PALETTE.faint, '○');
}

function overlaps(a: Lease, b: Lease): boolean {
  return a.paths.some((left) =>
    b.paths.some((right) => {
      const l = root(left);
      const r = root(right);
      return l === r || l.startsWith(`${r}/`) || r.startsWith(`${l}/`);
    }),
  );
}

function root(pattern: string): string {
  const index = pattern.search(/[*?]/);
  const head = index === -1 ? pattern : pattern.slice(0, index);
  return head.replace(/\/+$/, '');
}

/** Convenience for the CLI: take over the terminal until the operator quits. */
export async function runTui(daemon: Daemon): Promise<void> {
  await new Tui({ daemon }).start();
}
