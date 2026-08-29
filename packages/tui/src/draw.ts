import { PALETTE, centre, pad, truncate } from './ansi.js';
import type { Grid } from './grid.js';
import { centreOf, type Box } from './layout.js';

const LINE = {
  h: '─',
  v: '│',
  tl: '╭',
  tr: '╮',
  bl: '╰',
  br: '╯',
  cross: '┼',
} as const;

const ARROW = { left: '◀', right: '▶', up: '▲', down: '▼' } as const;

export interface BoxStyle {
  border: string;
  title: string;
  focused: boolean;
}

/**
 * A window, drawn the way the terminal on your desk draws one: rounded corners,
 * three lights in the top left, the title centred, and a status line beneath.
 */
export function drawWindow(
  grid: Grid,
  box: Box,
  options: {
    title: string;
    subtitle: string;
    right: string;
    style: BoxStyle;
    body: string[];
  },
): void {
  const { x, y, width, height } = box;
  const { border } = options.style;

  grid.fill(x, y, width, height, ' ');

  grid.set(x, y, LINE.tl, border);
  grid.set(x + width - 1, y, LINE.tr, border);
  grid.set(x, y + height - 1, LINE.bl, border);
  grid.set(x + width - 1, y + height - 1, LINE.br, border);

  for (let column = 1; column < width - 1; column += 1) {
    grid.set(x + column, y, LINE.h, border);
    grid.set(x + column, y + height - 1, LINE.h, border);
  }
  for (let row = 1; row < height - 1; row += 1) {
    grid.set(x, y + row, LINE.v, border);
    grid.set(x + width - 1, y + row, LINE.v, border);
  }

  // Traffic lights, dimmed when the window is not the focused one.
  const lights = options.style.focused
    ? [PALETTE.coral, PALETTE.amber, PALETTE.phos]
    : [PALETTE.faint, PALETTE.faint, PALETTE.faint];
  lights.forEach((colour, index) => grid.set(x + 2 + index * 2, y, '●', colour));

  const titleRoom = width - 12 - options.right.length;
  if (titleRoom > 6) {
    const title = truncate(options.title, titleRoom);
    grid.text(x + 8, y, ` ${title} `, options.style.title);
  }
  if (options.right) {
    grid.text(x + width - options.right.length - 2, y, options.right, PALETTE.dim);
  }

  // Body: the agent's own screen, already fitted to the inner box.
  const innerWidth = width - 2;
  const innerHeight = height - 3;
  for (let row = 0; row < innerHeight; row += 1) {
    grid.raw(x + 1, y + 1 + row, options.body[row] ?? '');
  }

  // Status line above the bottom border.
  const status = truncate(options.subtitle, innerWidth);
  grid.text(x + 1, y + height - 2, pad(status, innerWidth), PALETTE.faint);
}

/** The bus, drawn small because it is plumbing rather than a participant. */
export function drawBus(
  grid: Grid,
  bus: { x: number; y: number; width: number; height: number },
  label: string,
  busy: boolean,
): void {
  const colour = busy ? PALETTE.phos : PALETTE.rule;

  grid.fill(bus.x, bus.y, bus.width, bus.height, ' ');
  grid.set(bus.x, bus.y, LINE.tl, colour);
  grid.set(bus.x + bus.width - 1, bus.y, LINE.tr, colour);
  grid.set(bus.x, bus.y + bus.height - 1, LINE.bl, colour);
  grid.set(bus.x + bus.width - 1, bus.y + bus.height - 1, LINE.br, colour);

  for (let column = 1; column < bus.width - 1; column += 1) {
    grid.set(bus.x + column, bus.y, LINE.h, colour);
    grid.set(bus.x + column, bus.y + bus.height - 1, LINE.h, colour);
  }
  for (let row = 1; row < bus.height - 1; row += 1) {
    grid.set(bus.x, bus.y + row, LINE.v, colour);
    grid.set(bus.x + bus.width - 1, bus.y + row, LINE.v, colour);
  }

  grid.text(
    bus.x + 1,
    bus.y + 1,
    centre(truncate(label, bus.width - 2), bus.width - 2),
    busy ? PALETTE.phos : PALETTE.dim,
  );
}

export type WireTone = 'spine' | 'live' | 'clash';

const TONE: Record<WireTone, string> = {
  spine: PALETTE.rule,
  live: PALETTE.phos,
  clash: PALETTE.coral,
};

/**
 * A wire from the bus to one pane, routed the way a schematic would: out
 * horizontally, one elbow, then in. Straight lines and a single corner stay
 * readable at terminal resolution where a curve would just be noise.
 *
 * `phase` moves a dot along the wire, so a live conversation is visibly moving
 * rather than merely coloured.
 */
export function drawWire(
  grid: Grid,
  bus: { x: number; y: number; width: number; height: number },
  box: Box,
  tone: WireTone,
  phase?: number,
): void {
  const style = TONE[tone];
  const busCentre = centreOf(bus);
  const boxCentre = centreOf(box);

  const goingLeft = boxCentre.x < busCentre.x;
  const goingUp = boxCentre.y < busCentre.y;

  const startX = goingLeft ? bus.x - 1 : bus.x + bus.width;
  const endX = goingLeft ? box.x + box.width : box.x - 1;
  const elbowX = goingLeft ? endX + Math.max(2, Math.floor((startX - endX) / 2)) : endX - Math.max(2, Math.floor((endX - startX) / 2));

  const path: Array<{ x: number; y: number; char: string }> = [];

  // Out of the bus, along its own row.
  const step = goingLeft ? -1 : 1;
  for (let x = startX; x !== elbowX; x += step) {
    path.push({ x, y: busCentre.y, char: LINE.h });
  }

  // The elbow, turning toward the pane's row.
  const sameRow = boxCentre.y === busCentre.y;
  if (!sameRow) {
    path.push({
      x: elbowX,
      y: busCentre.y,
      char: goingLeft ? (goingUp ? LINE.br : LINE.tr) : goingUp ? LINE.bl : LINE.tl,
    });

    const vertical = goingUp ? -1 : 1;
    for (let y = busCentre.y + vertical; y !== boxCentre.y; y += vertical) {
      path.push({ x: elbowX, y, char: LINE.v });
    }

    path.push({
      x: elbowX,
      y: boxCentre.y,
      char: goingLeft ? (goingUp ? LINE.tl : LINE.bl) : goingUp ? LINE.tr : LINE.br,
    });
  } else {
    path.push({ x: elbowX, y: busCentre.y, char: LINE.h });
  }

  // Into the pane.
  for (let x = elbowX + step; x !== endX + step; x += step) {
    path.push({ x, y: boxCentre.y, char: LINE.h });
  }

  for (const point of path) {
    const existing = grid.get(point.x, point.y);
    const char = existing !== ' ' && existing !== point.char && isWire(existing) ? LINE.cross : point.char;
    grid.set(point.x, point.y, char, style);
  }

  // Arrowhead where the wire meets the pane.
  grid.set(endX, boxCentre.y, goingLeft ? ARROW.left : ARROW.right, style);

  if (phase !== undefined && path.length > 2) {
    const at = path[Math.floor(phase * (path.length - 1))];
    if (at) grid.set(at.x, at.y, '•', PALETTE.phos);
  }
}

function isWire(char: string): boolean {
  return char === LINE.h || char === LINE.v || char === LINE.cross;
}

/** A short label parked on a wire, e.g. the subject of the last message. */
export function drawWireLabel(grid: Grid, x: number, y: number, text: string, tone: WireTone): void {
  const label = truncate(text, 22);
  grid.text(x, y, ` ${label} `, TONE[tone]);
}
