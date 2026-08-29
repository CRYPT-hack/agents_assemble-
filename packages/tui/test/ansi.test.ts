import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ESC, Grid, PALETTE, paint, pad, truncate, visibleWidth } from '../dist/index.js';

const strip = (text: string): string =>
  text.replace(new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g'), '');

describe('measuring styled text', () => {
  it('ignores escapes when measuring', () => {
    assert.equal(visibleWidth(paint(PALETTE.phos, 'alice')), 5);
  });

  it('leaves plain text plain when it fits', () => {
    assert.equal(truncate('alice', 10), 'alice');
  });

  /**
   * The grid writes character by character, so an escape appended to an
   * unstyled label would consume cells and push the box border off the end.
   * This caught exactly that, twice.
   */
  it('adds no escapes when cutting plain text', () => {
    const cut = truncate('a very long mission indeed', 10);

    assert.equal(cut.includes(ESC), false);
    assert.equal(cut.length, 10);
    assert.ok(cut.endsWith('…'));
  });

  it('keeps colour when cutting styled text', () => {
    const cut = truncate(paint(PALETTE.phos, 'a very long mission indeed'), 10);

    assert.ok(cut.includes(ESC));
    assert.equal(visibleWidth(cut), 10);
  });

  it('pads to an exact visible width', () => {
    assert.equal(visibleWidth(pad(paint(PALETTE.amber, 'ok'), 8)), 8);
    assert.equal(visibleWidth(pad('over-long text', 6)), 6);
  });
});

describe('the character grid', () => {
  it('writes plain text into cells', () => {
    const grid = new Grid(10, 2);
    grid.text(2, 1, 'hi');

    assert.equal(strip(grid.toLines()[1] ?? ''), '  hi');
  });

  it('reads escapes as style rather than as characters', () => {
    const grid = new Grid(10, 1);
    grid.raw(0, 0, `${paint(PALETTE.phos, 'abc')}de`);

    const line = grid.toLines()[0] ?? '';
    assert.equal(strip(line), 'abcde');
    assert.ok(line.includes(ESC), 'style should survive');
  });

  it('clips at the right edge instead of wrapping', () => {
    const grid = new Grid(4, 1);
    grid.text(2, 0, 'abcdef');

    assert.equal(strip(grid.toLines()[0] ?? ''), '  ab');
  });

  it('ignores writes outside the grid', () => {
    const grid = new Grid(4, 1);
    grid.text(-3, 0, 'xx');
    grid.text(0, 9, 'yy');

    assert.equal(strip(grid.toLines()[0] ?? ''), '');
  });
});
