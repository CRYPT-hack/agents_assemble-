import { reset } from './ansi.js';

interface Cell {
  char: string;
  /** An ANSI prefix such as `PALETTE.phos`, or empty for default. */
  style: string;
}

/**
 * A character canvas.
 *
 * Everything the terminal console draws — boxes, wires, labels, whole agent
 * screens — is composed onto one grid and emitted once. Drawing order is then
 * just painting order, and a wire can pass behind a box simply by being drawn
 * first, which is the same trick the web canvas plays with SVG.
 */
export class Grid {
  private readonly cells: Cell[][];

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.cells = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ char: ' ', style: '' })),
    );
  }

  set(x: number, y: number, char: string, style = ''): void {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const row = this.cells[y];
    if (!row) return;
    row[x] = { char, style };
  }

  get(x: number, y: number): string {
    return this.cells[y]?.[x]?.char ?? ' ';
  }

  /** Write plain text. Characters past the right edge are dropped. */
  text(x: number, y: number, value: string, style = ''): void {
    for (let i = 0; i < value.length; i += 1) {
      this.set(x + i, y, value[i] as string, style);
    }
  }

  /** Write a pre-styled line, one cell per character, ignoring escapes. */
  raw(x: number, y: number, value: string): void {
    if (y < 0 || y >= this.rows) return;
    const row = this.cells[y];
    if (!row) return;

    let column = x;
    let style = '';
    let index = 0;

    while (index < value.length) {
      if (value.charCodeAt(index) === 27) {
        const end = value.indexOf('m', index);
        if (end === -1) break;

        const sequence = value.slice(index, end + 1);
        style = sequence === reset ? '' : style + sequence;
        index = end + 1;
        continue;
      }

      if (column >= 0 && column < this.cols) {
        row[column] = { char: value[index] as string, style };
      }
      column += 1;
      index += 1;
    }
  }

  fill(x: number, y: number, width: number, height: number, char = ' ', style = ''): void {
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        this.set(x + column, y + row, char, style);
      }
    }
  }

  /** One string per row, with colour runs collapsed into single escapes. */
  toLines(): string[] {
    return this.cells.map((row) => {
      let out = '';
      let open = '';

      for (const cell of row) {
        if (cell.style !== open) {
          out += cell.style === '' ? reset : reset + cell.style;
          open = cell.style;
        }
        out += cell.char;
      }

      return open === '' ? out.replace(/\s+$/, '') : `${out}${reset}`;
    });
  }
}
