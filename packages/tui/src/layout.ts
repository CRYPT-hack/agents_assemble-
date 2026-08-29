export interface Box {
  handle: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  boxes: Box[];
  /** Where the bus sits, when there is room to draw one. */
  bus?: { x: number; y: number; width: number; height: number };
  /** Columns and rows of the pane grid. */
  columns: number;
  rows: number;
}

const MIN_PANE_WIDTH = 30;
const MIN_PANE_HEIGHT = 7;

/**
 * The bus lives in a gutter, so that gutter has to be wide enough to hold it
 * with a wire either side. Gutters on the other axis are only spacing.
 */
const BUS_WIDTH = 11;
const BUS_HEIGHT = 3;

const BUS_GUTTER_X = BUS_WIDTH + 6;
const BUS_GUTTER_Y = BUS_HEIGHT + 2;
const PLAIN_GUTTER_X = 2;
const PLAIN_GUTTER_Y = 1;

type BusAxis = 'x' | 'y' | 'none';

/**
 * Arrange panes in the space between the header and the command line.
 *
 * The grid is as square as the terminal allows, because a row of eight thin
 * strips tells you nothing and a single tall column wastes the width. One
 * gutter is then widened to hold the bus — the vertical one when there are
 * columns to run between, the horizontal one when the panes are stacked — and
 * that is what turns a tiled layout into a diagram.
 *
 * If widening a gutter would squeeze the panes below readable, the bus is
 * dropped and the space goes back to the agents, who are the point.
 */
export function planLayout(cols: number, rows: number, handles: string[]): Layout {
  const count = handles.length;
  if (count === 0) return { boxes: [], columns: 0, rows: 0 };

  const columns = chooseColumns(cols, count);
  const gridRows = Math.ceil(count / columns);

  const wanted: BusAxis = count < 2 ? 'none' : columns > 1 ? 'x' : gridRows > 1 ? 'y' : 'none';
  const attempt = measure(cols, rows, columns, gridRows, wanted);

  const fits = attempt.paneWidth >= MIN_PANE_WIDTH && attempt.paneHeight >= MIN_PANE_HEIGHT;
  const axis: BusAxis = fits ? wanted : 'none';
  const plan = fits ? attempt : measure(cols, rows, columns, gridRows, 'none');

  const boxes: Box[] = handles.map((handle, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    return {
      handle,
      x: plan.offsetX + column * (plan.paneWidth + plan.gutterX),
      y: plan.offsetY + row * (plan.paneHeight + plan.gutterY),
      width: plan.paneWidth,
      height: plan.paneHeight,
    };
  });

  const layout: Layout = { boxes, columns, rows: gridRows };

  if (axis === 'x') {
    const gutter = Math.floor((columns - 1) / 2);
    const gutterX = plan.offsetX + (gutter + 1) * plan.paneWidth + gutter * plan.gutterX;

    layout.bus = {
      x: gutterX + Math.floor((plan.gutterX - BUS_WIDTH) / 2),
      y: plan.offsetY + Math.floor(plan.usedHeight / 2) - Math.floor(BUS_HEIGHT / 2),
      width: BUS_WIDTH,
      height: BUS_HEIGHT,
    };
  } else if (axis === 'y') {
    const gutter = Math.floor((gridRows - 1) / 2);
    const gutterY = plan.offsetY + (gutter + 1) * plan.paneHeight + gutter * plan.gutterY;

    layout.bus = {
      x: plan.offsetX + Math.floor(plan.usedWidth / 2) - Math.floor(BUS_WIDTH / 2),
      y: gutterY + Math.floor((plan.gutterY - BUS_HEIGHT) / 2),
      width: BUS_WIDTH,
      height: BUS_HEIGHT,
    };
  }

  return layout;
}

interface Measured {
  paneWidth: number;
  paneHeight: number;
  gutterX: number;
  gutterY: number;
  offsetX: number;
  offsetY: number;
  usedWidth: number;
  usedHeight: number;
}

function measure(
  cols: number,
  rows: number,
  columns: number,
  gridRows: number,
  axis: BusAxis,
): Measured {
  const gutterX = columns > 1 ? (axis === 'x' ? BUS_GUTTER_X : PLAIN_GUTTER_X) : 0;
  const gutterY = gridRows > 1 ? (axis === 'y' ? BUS_GUTTER_Y : PLAIN_GUTTER_Y) : 0;

  const paneWidth = Math.floor((cols - gutterX * (columns - 1)) / columns);
  const paneHeight = Math.floor((rows - gutterY * (gridRows - 1)) / gridRows);

  const usedWidth = paneWidth * columns + gutterX * (columns - 1);
  const usedHeight = paneHeight * gridRows + gutterY * (gridRows - 1);

  return {
    paneWidth,
    paneHeight,
    gutterX,
    gutterY,
    offsetX: Math.floor((cols - usedWidth) / 2),
    offsetY: Math.floor((rows - usedHeight) / 2),
    usedWidth,
    usedHeight,
  };
}

/** As many columns as fit while keeping every pane readable. */
function chooseColumns(cols: number, count: number): number {
  const ideal = Math.ceil(Math.sqrt(count));

  for (let columns = ideal; columns >= 1; columns -= 1) {
    const width = Math.floor((cols - BUS_GUTTER_X * (columns - 1)) / columns);
    if (width >= MIN_PANE_WIDTH) return columns;
  }
  return 1;
}

/** The centre of a box, used to aim wires at it. */
export function centreOf(box: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
} {
  return { x: box.x + Math.floor(box.width / 2), y: box.y + Math.floor(box.height / 2) };
}
