/** The one control character in this file, built rather than typed. */
const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;

const useColour = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;

const wrap =
  (code: string) =>
  (text: string): string =>
    useColour ? `${ESC}[${code}m${text}${RESET}` : text;

export const bold = wrap('1');
export const dim = wrap('2');
export const red = wrap('31');
export const green = wrap('32');
export const yellow = wrap('33');
export const blue = wrap('34');
export const magenta = wrap('35');
export const cyan = wrap('36');

/** Status words carry more meaning than colour alone, but colour helps. */
export function paintStatus(status: string): string {
  switch (status) {
    case 'working':
      return green(status);
    case 'blocked':
    case 'failed':
      return red(status);
    case 'waiting':
    case 'review':
      return yellow(status);
    case 'done':
      return cyan(status);
    default:
      return dim(status);
  }
}

export function print(line = ''): void {
  process.stdout.write(`${line}\n`);
}

export function warn(line: string): void {
  process.stderr.write(`${yellow('!')} ${line}\n`);
}

export function fail(line: string): void {
  process.stderr.write(`${red('x')} ${line}\n`);
}

const ANSI = new RegExp(`${ESC}\\[\\d+m`, 'g');

/**
 * Render rows as a plain aligned table. Colour codes are stripped when
 * measuring, so painted cells still line up.
 */
export function table(headers: string[], rows: string[][]): string {
  const visible = (text: string): number => text.replace(ANSI, '').length;
  const widths = headers.map((header, column) =>
    Math.max(visible(header), ...rows.map((row) => visible(row[column] ?? ''))),
  );

  const line = (cells: string[]): string =>
    cells
      .map((cell, column) => cell + ' '.repeat(Math.max(0, (widths[column] ?? 0) - visible(cell))))
      .join('  ')
      .trimEnd();

  return [dim(line(headers)), ...rows.map(line)].join('\n');
}

/** An ISO timestamp as `18:57` when it is today, `Aug 29` when it is not. */
export function shortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
