import { Terminal } from '@xterm/headless';

import { fg, pad, reset } from './ansi.js';

/**
 * One agent's screen, emulated.
 *
 * The daemon hands us the raw byte stream an agent writes to its pty. Feeding
 * that straight into a box would be wrong — agents redraw, move the cursor,
 * clear regions and repaint spinners, so the stream is a set of instructions,
 * not a transcript. A headless terminal applies those instructions properly and
 * gives back a grid we can copy into our own layout.
 */
export class Pane {
  private readonly term: Terminal;
  private dirty = true;

  constructor(
    readonly handle: string,
    cols: number,
    rows: number,
  ) {
    this.term = new Terminal({
      cols: Math.max(20, cols),
      rows: Math.max(3, rows),
      scrollback: 2000,
      allowProposedApi: true,
      convertEol: true,
    });
  }

  get cols(): number {
    return this.term.cols;
  }

  get rows(): number {
    return this.term.rows;
  }

  /** True when something has been written since the last read. */
  get changed(): boolean {
    return this.dirty;
  }

  write(data: string): void {
    this.term.write(data);
    this.dirty = true;
  }

  resize(cols: number, rows: number): void {
    const width = Math.max(20, cols);
    const height = Math.max(3, rows);
    if (width === this.term.cols && height === this.term.rows) return;

    this.term.resize(width, height);
    this.dirty = true;
  }

  /**
   * The visible grid, one styled string per row.
   *
   * Colour is carried across by run: consecutive cells sharing a foreground are
   * emitted as one escape, which keeps a full repaint of a dozen panes small
   * enough to stay smooth over ssh.
   */
  lines(): string[] {
    this.dirty = false;

    const buffer = this.term.buffer.active;
    const out: string[] = [];

    for (let row = 0; row < this.term.rows; row += 1) {
      const line = buffer.getLine(buffer.viewportY + row);
      if (!line) {
        out.push('');
        continue;
      }

      let text = '';
      let openColour: number | undefined;

      for (let column = 0; column < this.term.cols; column += 1) {
        const cell = line.getCell(column);
        if (!cell) break;

        const chars = cell.getChars();
        const colour = cell.isFgPalette() ? cell.getFgColor() : undefined;

        if (colour !== openColour) {
          text += colour === undefined ? reset : fg(colour);
          openColour = colour;
        }

        text += chars === '' ? ' ' : chars;
      }

      out.push(openColour === undefined ? text.trimEnd() : `${text.trimEnd()}${reset}`);
    }

    return out;
  }

  /** The grid, fitted to a box: exactly `rows` lines of exactly `cols` columns. */
  render(cols: number, rows: number): string[] {
    this.resize(cols, rows);
    const lines = this.lines();

    const out: string[] = [];
    for (let row = 0; row < rows; row += 1) out.push(pad(lines[row] ?? '', cols));
    return out;
  }

  /** The last non-empty line, for the folded view of a pane. */
  lastLine(): string {
    const lines = this.lines();
    for (let row = lines.length - 1; row >= 0; row -= 1) {
      const line = (lines[row] ?? '').trim();
      if (line !== '') return line;
    }
    return '';
  }

  dispose(): void {
    this.term.dispose();
  }
}
