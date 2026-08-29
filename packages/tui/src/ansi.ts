/**
 * Terminal escape sequences, built rather than typed.
 *
 * Every sequence here starts from `String.fromCharCode(27)` so the source file
 * contains no literal control characters — they survive copy, paste, diff and
 * every editor that would otherwise eat them.
 */
export const ESC = String.fromCharCode(27);
const CSI = `${ESC}[`;

export const enterAltScreen = `${CSI}?1049h`;
export const leaveAltScreen = `${CSI}?1049l`;
export const hideCursor = `${CSI}?25l`;
export const showCursor = `${CSI}?25h`;
export const clearScreen = `${CSI}2J`;
export const clearLine = `${CSI}2K`;
export const clearToEnd = `${CSI}K`;
export const home = `${CSI}H`;
export const reset = `${CSI}0m`;

export const moveTo = (row: number, col: number): string => `${CSI}${row};${col}H`;

/** 256-colour foreground/background, which every modern terminal has. */
export const fg = (code: number): string => `${CSI}38;5;${code}m`;
export const bg = (code: number): string => `${CSI}48;5;${code}m`;

export const bold = `${CSI}1m`;
export const dim = `${CSI}2m`;
export const inverse = `${CSI}7m`;

/**
 * The palette, matched to the web console so the two consoles look like one
 * product: phosphor green, amber, coral, and three greys.
 */
export const PALETTE = {
  phos: fg(84),
  phosDim: fg(35),
  amber: fg(179),
  coral: fg(203),
  violet: fg(141),
  cyan: fg(80),
  text: fg(252),
  dim: fg(245),
  faint: fg(240),
  rule: fg(238),
} as const;

/** Paint `text` in `colour`, then return to normal. */
export const paint = (colour: string, text: string): string => `${colour}${text}${reset}`;

const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g');

/** Width of a string as the terminal will draw it, ignoring escape sequences. */
export function visibleWidth(text: string): number {
  return text.replace(ANSI_PATTERN, '').length;
}

/**
 * Cut a string to `width` visible columns, keeping escape sequences intact.
 *
 * Plain text comes back plain: the grid writes character by character, so a
 * stray reset appended to an unstyled label would eat cells and push whatever
 * follows — a box border, usually — off the end.
 */
export function truncate(text: string, width: number, ellipsis = '…'): string {
  if (visibleWidth(text) <= width) return text;
  if (width <= 1) return ellipsis.slice(0, Math.max(0, width));

  const styled = text.includes(ESC);
  if (!styled) return text.slice(0, Math.max(0, width - 1)) + ellipsis;

  let out = '';
  let shown = 0;

  for (let i = 0; i < text.length; i += 1) {
    const rest = text.slice(i);
    const match = ANSI_PATTERN.exec(rest);
    ANSI_PATTERN.lastIndex = 0;

    if (match && match.index === 0) {
      out += match[0];
      i += match[0].length - 1;
      continue;
    }

    if (shown >= width - 1) break;
    out += text[i];
    shown += 1;
  }

  return `${out}${reset}${ellipsis}`;
}

/** Pad to `width` visible columns. Escape sequences do not count. */
export function pad(text: string, width: number): string {
  const gap = width - visibleWidth(text);
  return gap > 0 ? text + ' '.repeat(gap) : truncate(text, width);
}

/** Centre within `width` columns. */
export function centre(text: string, width: number): string {
  const shown = visibleWidth(text);
  if (shown >= width) return truncate(text, width);

  const left = Math.floor((width - shown) / 2);
  return ' '.repeat(left) + text + ' '.repeat(width - shown - left);
}
