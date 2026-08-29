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
 * The gutters are not spacing — they are where the wiring lives. The vertical
 * one has to hold the bus with room for a wire either side of it; the
 * horizontal one holds the bus plus a row for a label.
 */
const BUS_WIDTH = 11;
const BUS_HEIGHT = 3;

const GUTTER_X = BUS_WIDTH + 6;
const GUTTER_Y = BUS_HEIGHT + 2;

/**
 * Arrange panes in the space between the header and the command line.
 *
 * The grid is as square as the terminal allows, because a row of eight thin
 * strips tells you nothing and a single tall column wastes the width. When the
 * grid has both a vertical and a horizontal gutter, the crossing point is where
 * the bus goes — which is what turns a tiled layout into a diagram.
 */
export function planLayout(cols: number, rows: number, handles: string[]): Layout {
  const count = handles.length;
  if (count === 0) return { boxes: [], columns: 0, rows: 0 };

  const columns = chooseColumns(cols, count);
  const gridRows = Math.ceil(count / columns);

  const paneWidth = Math.floor((cols - GUTTER_X * (columns - 1)) / columns);
  const paneHeight = Math.floor((rows - GUTTER_Y * (gridRows - 1)) / gridRows);

  const usedWidth = paneWidth * columns + GUTTER_X * (columns - 1);
  const usedHeight = paneHeight * gridRows + GUTTER_Y * (gridRows - 1);
  const offsetX = Math.floor((cols - usedWidth) / 2);
  const offsetY = Math.floor((rows - usedHeight) / 2);

  const boxes: Box[] = handles.map((handle, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    return {
      handle,
      x: offsetX + column * (paneWidth + GUTTER_X),
      y: offsetY + row * (paneHeight + GUTTER_Y),
      width: paneWidth,
      height: paneHeight,
    };
  });

  const layout: Layout = { boxes, columns, rows: gridRows };

  // The bus needs a crossing to sit in: at least two columns and two rows.
  if (columns > 1 && gridRows > 1 && paneWidth >= MIN_PANE_WIDTH && paneHeight >= MIN_PANE_HEIGHT) {
    layout.bus = {
      x: offsetX + Math.floor(usedWidth / 2) - Math.floor(BUS_WIDTH / 2),
      y: offsetY + Math.floor(usedHeight / 2) - Math.floor(BUS_HEIGHT / 2),
      width: BUS_WIDTH,
      height: BUS_HEIGHT,
    };
  }

  return layout;
}

/** As many columns as fit while keeping every pane readable. */
function chooseColumns(cols: number, count: number): number {
  const ideal = Math.ceil(Math.sqrt(count));

  for (let columns = ideal; columns >= 1; columns -= 1) {
    const width = Math.floor((cols - GUTTER_X * (columns - 1)) / columns);
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
