import {
  clearScreen,
  clearToEnd,
  enterAltScreen,
  hideCursor,
  home,
  leaveAltScreen,
  moveTo,
  reset,
  showCursor,
} from './ansi.js';

export interface Size {
  cols: number;
  rows: number;
}

/**
 * The terminal, taken over and given back.
 *
 * Uses the alternate screen buffer, so when the workspace exits the operator's
 * scrollback is exactly as they left it — no wall of agent output pasted into
 * their session. Frames are diffed line by line: repainting only what changed
 * keeps a busy canvas from flickering, and keeps a remote session usable.
 */
export class Screen {
  private previous: string[] = [];
  private entered = false;
  private readonly onResizeHandlers = new Set<(size: Size) => void>();

  constructor(
    private readonly out: NodeJS.WriteStream = process.stdout,
    private readonly input: NodeJS.ReadStream = process.stdin,
  ) {}

  size(): Size {
    return {
      cols: Math.max(40, this.out.columns ?? 80),
      rows: Math.max(12, this.out.rows ?? 24),
    };
  }

  enter(): void {
    if (this.entered) return;
    this.entered = true;

    this.out.write(enterAltScreen + hideCursor + clearScreen + home);

    if (this.input.isTTY) {
      this.input.setRawMode(true);
      this.input.resume();
      this.input.setEncoding('utf8');
    }

    this.out.on('resize', this.handleResize);
  }

  leave(): void {
    if (!this.entered) return;
    this.entered = false;

    this.out.off('resize', this.handleResize);
    this.out.write(reset + showCursor + leaveAltScreen);

    if (this.input.isTTY) {
      this.input.setRawMode(false);
      this.input.pause();
    }
  }

  onResize(handler: (size: Size) => void): () => void {
    this.onResizeHandlers.add(handler);
    return () => this.onResizeHandlers.delete(handler);
  }

  onKey(handler: (chunk: string) => void): () => void {
    const listener = (chunk: string): void => handler(chunk);
    this.input.on('data', listener);
    return () => this.input.off('data', listener);
  }

  /** Paint a frame. `lines` is one string per terminal row, already styled. */
  render(lines: string[]): void {
    const { rows } = this.size();
    const frame = lines.slice(0, rows);

    let out = '';
    for (let row = 0; row < frame.length; row += 1) {
      const line = frame[row] ?? '';
      if (this.previous[row] === line) continue;
      out += moveTo(row + 1, 1) + line + clearToEnd;
    }

    // Wipe rows the new frame no longer uses, e.g. after the window shrank.
    for (let row = frame.length; row < this.previous.length; row += 1) {
      out += moveTo(row + 1, 1) + clearToEnd;
    }

    if (out !== '') this.out.write(out + reset);
    this.previous = frame;
  }

  /** Force the next render to repaint everything, e.g. after a resize. */
  invalidate(): void {
    this.previous = [];
    this.out.write(clearScreen);
  }

  private readonly handleResize = (): void => {
    this.invalidate();
    for (const handler of this.onResizeHandlers) handler(this.size());
  };
}
