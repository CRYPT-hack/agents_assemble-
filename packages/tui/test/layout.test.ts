import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planLayout } from '../dist/index.js';

const handles = (count: number): string[] =>
  Array.from({ length: count }, (_unused, index) => `agent-${index + 1}`);

describe('pane layout', () => {
  it('gives a lone agent the whole area, and nothing to wire to', () => {
    const layout = planLayout(120, 30, handles(1));

    assert.equal(layout.boxes.length, 1);
    assert.equal(layout.bus, undefined);
    assert.equal(layout.boxes[0]?.width, 120);
  });

  it('puts two agents side by side with the bus between them', () => {
    const layout = planLayout(150, 36, handles(2));

    assert.equal(layout.columns, 2);
    assert.ok(layout.bus, 'two agents should be wired to a bus');

    const [left, right] = layout.boxes as [{ x: number; width: number }, { x: number }];
    assert.ok(layout.bus.x > left.x + left.width, 'the bus sits after the left pane');
    assert.ok(layout.bus.x + layout.bus.width < right.x, 'and before the right one');
  });

  it('keeps the bus inside its gutter with an odd number of columns', () => {
    const layout = planLayout(220, 40, handles(3));
    assert.ok(layout.bus);

    for (const box of layout.boxes) {
      const overlaps =
        layout.bus.x < box.x + box.width && layout.bus.x + layout.bus.width > box.x &&
        layout.bus.y < box.y + box.height && layout.bus.y + layout.bus.height > box.y;
      assert.equal(overlaps, false, `the bus overlapped ${box.handle}`);
    }
  });

  it('stacks agents when the terminal is narrow', () => {
    const layout = planLayout(70, 44, handles(3));

    assert.equal(layout.columns, 1);
    assert.equal(layout.boxes.length, 3);

    const ys = layout.boxes.map((box) => box.y);
    assert.deepEqual([...ys].sort((a, b) => a - b), ys, 'panes should read top to bottom');
  });

  it('drops the bus rather than squeezing panes below readable', () => {
    const layout = planLayout(70, 30, handles(4));

    assert.equal(layout.bus, undefined);
    for (const box of layout.boxes) {
      assert.ok(box.height >= 4, 'a pane should still be worth looking at');
    }
  });

  it('never lets panes overlap each other', () => {
    for (const count of [2, 3, 4, 5, 6, 9]) {
      const layout = planLayout(200, 60, handles(count));

      for (const a of layout.boxes) {
        for (const b of layout.boxes) {
          if (a === b) continue;
          const overlaps =
            a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
          assert.equal(overlaps, false, `${a.handle} overlapped ${b.handle} with ${count} agents`);
        }
      }
    }
  });

  it('stays inside the area it was given', () => {
    for (const [cols, rows, count] of [
      [80, 24, 2],
      [120, 30, 4],
      [200, 60, 6],
      [60, 20, 3],
    ] as Array<[number, number, number]>) {
      const layout = planLayout(cols, rows, handles(count));

      for (const box of layout.boxes) {
        assert.ok(box.x >= 0 && box.y >= 0, 'a pane started off-screen');
        assert.ok(box.x + box.width <= cols, `a pane ran past ${cols} columns`);
        assert.ok(box.y + box.height <= rows, `a pane ran past ${rows} rows`);
      }
    }
  });
});
