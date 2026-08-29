import { PALETTE, centre, pad, truncate, visibleWidth } from './ansi.js';
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

  // `right` arrives already coloured, so it goes through raw(): text() would
  // write the escape bytes as visible cells and push the corner off the box.
  const rightWidth = visibleWidth(options.right);
  const titleRoom = width - 12 - rightWidth;

  if (titleRoom > 6) {
    const title = truncate(options.title, titleRoom);
    grid.text(x + 8, y, ` ${title} `, options.style.title);
  }
  if (rightWidth > 0) {
    grid.raw(x + width - rightWidth - 2, y, options.right);
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

  // Leave by the face that points at the pane. A bus sitting in a vertical
  // gutter is reached sideways; one in a horizontal gutter is reached from
  // above or below, which is the single-column case.
  const sideways = Math.abs(boxCentre.x - busCentre.x) >= Math.abs(boxCentre.y - busCentre.y);
  const path: Array<{ x: number; y: number; char: string }> = [];

  let arrow: { x: number; y: number; char: string };

  if (sideways) {
    const startX = goingLeft ? bus.x - 1 : bus.x + bus.width;
    const endX = goingLeft ? box.x + box.width : box.x - 1;

    // The turn happens halfway along, but never outside the run itself — a pane
    // tucked against the bus leaves almost no room, and an elbow placed beyond
    // either end would be a corner the wire never reaches.
    const elbowX = clamp(Math.round((startX + endX) / 2), Math.min(startX, endX), Math.max(startX, endX));

    for (const x of between(startX, elbowX, false)) {
      path.push({ x, y: busCentre.y, char: LINE.h });
    }

    if (boxCentre.y === busCentre.y) {
      path.push({ x: elbowX, y: busCentre.y, char: LINE.h });
    } else {
      path.push({
        x: elbowX,
        y: busCentre.y,
        char: goingLeft ? (goingUp ? LINE.br : LINE.tr) : goingUp ? LINE.bl : LINE.tl,
      });

      for (const y of between(busCentre.y, boxCentre.y, false)) {
        path.push({ x: elbowX, y, char: LINE.v });
      }

      path.push({
        x: elbowX,
        y: boxCentre.y,
        char: goingLeft ? (goingUp ? LINE.tl : LINE.bl) : goingUp ? LINE.tr : LINE.br,
      });
    }

    for (const x of between(elbowX, endX, true)) {
      path.push({ x, y: boxCentre.y, char: LINE.h });
    }

    arrow = { x: endX, y: boxCentre.y, char: goingLeft ? ARROW.left : ARROW.right };
  } else {
    const startY = goingUp ? bus.y - 1 : bus.y + bus.height;
    const endY = goingUp ? box.y + box.height : box.y - 1;
    const elbowY = clamp(Math.round((startY + endY) / 2), Math.min(startY, endY), Math.max(startY, endY));

    for (const y of between(startY, elbowY, false)) {
      path.push({ x: busCentre.x, y, char: LINE.v });
    }

    if (boxCentre.x === busCentre.x) {
      path.push({ x: busCentre.x, y: elbowY, char: LINE.v });
    } else {
      path.push({
        x: busCentre.x,
        y: elbowY,
        char: goingUp ? (goingLeft ? LINE.br : LINE.bl) : goingLeft ? LINE.tr : LINE.tl,
      });

      for (const x of between(busCentre.x, boxCentre.x, false)) {
        path.push({ x, y: elbowY, char: LINE.h });
      }

      path.push({
        x: boxCentre.x,
        y: elbowY,
        char: goingUp ? (goingLeft ? LINE.tl : LINE.tr) : goingLeft ? LINE.bl : LINE.br,
      });
    }

    for (const y of between(elbowY, endY, true)) {
      path.push({ x: boxCentre.x, y, char: LINE.v });
    }

    arrow = { x: boxCentre.x, y: endY, char: goingUp ? ARROW.up : ARROW.down };
  }

  for (const point of path) {
    const existing = grid.get(point.x, point.y);
    const char = existing !== ' ' && existing !== point.char && isWire(existing) ? LINE.cross : point.char;
    grid.set(point.x, point.y, char, style);
  }

  // Arrowhead where the wire meets the pane.
  grid.set(arrow.x, arrow.y, arrow.char, style);

  if (phase !== undefined && path.length > 2) {
    const at = path[Math.floor(phase * (path.length - 1))];
    if (at) grid.set(at.x, at.y, '•', PALETTE.phos);
  }
}

function isWire(char: string): boolean {
  return char === LINE.h || char === LINE.v || char === LINE.cross;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/**
 * The cells strictly between `from` and `to`, in travel order.
 *
 * Direction is derived rather than assumed, so a segment of length zero yields
 * nothing instead of running away — which is exactly what a pane sitting flush
 * against the bus produces. `includeEnd` adds the far cell, for the last leg
 * that has to reach the pane.
 */
function between(from: number, to: number, includeEnd: boolean): number[] {
  const step = to >= from ? 1 : -1;
  const cells: number[] = [];

  for (let at = from; at !== to; at += step) cells.push(at);
  if (includeEnd) cells.push(to);

  return cells;
}

/** A short label parked on a wire, e.g. the subject of the last message. */
export function drawWireLabel(grid: Grid, x: number, y: number, text: string, tone: WireTone): void {
  const label = truncate(text, 44);
  grid.text(x, y, ` ${label} `, TONE[tone]);
}
