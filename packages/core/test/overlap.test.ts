import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { literalPrefix, matchesGlob, patternsOverlap } from '../dist/leases/overlap.js';

describe('matchesGlob', () => {
  it('matches a single segment with *', () => {
    assert.equal(matchesGlob('src/*.ts', 'src/app.ts'), true);
    assert.equal(matchesGlob('src/*.ts', 'src/deep/app.ts'), false);
  });

  it('crosses directories with **', () => {
    assert.equal(matchesGlob('src/**/*.ts', 'src/app.ts'), true);
    assert.equal(matchesGlob('src/**/*.ts', 'src/a/b/app.ts'), true);
    assert.equal(matchesGlob('src/**/*.ts', 'test/app.ts'), false);
  });

  it('treats ? as one character', () => {
    assert.equal(matchesGlob('src/a?.ts', 'src/ab.ts'), true);
    assert.equal(matchesGlob('src/a?.ts', 'src/abc.ts'), false);
  });

  it('normalises windows separators', () => {
    assert.equal(matchesGlob('src\\**\\*.ts', 'src/a/app.ts'), true);
  });
});

describe('literalPrefix', () => {
  it('stops at the first wildcard segment', () => {
    assert.equal(literalPrefix('src/**/*.ts'), 'src');
    assert.equal(literalPrefix('packages/core/src/*.ts'), 'packages/core/src');
    assert.equal(literalPrefix('*.md'), '');
    assert.equal(literalPrefix('README.md'), 'README.md');
  });
});

describe('patternsOverlap', () => {
  it('sees identical patterns', () => {
    assert.equal(patternsOverlap('src/app.ts', 'src/app.ts'), true);
  });

  it('sees a directory covering a file inside it', () => {
    assert.equal(patternsOverlap('src', 'src/app.ts'), true);
    assert.equal(patternsOverlap('src/app.ts', 'src'), true);
  });

  it('separates sibling files', () => {
    assert.equal(patternsOverlap('src/app.ts', 'src/other.ts'), false);
  });

  it('separates sibling directories', () => {
    assert.equal(patternsOverlap('packages/core', 'packages/ui'), false);
  });

  it('matches a glob against a literal it selects', () => {
    assert.equal(patternsOverlap('src/**/*.ts', 'src/a/b.ts'), true);
    assert.equal(patternsOverlap('src/**/*.ts', 'docs/readme.md'), false);
  });

  it('overlaps two globs that share a root', () => {
    assert.equal(patternsOverlap('src/**/*.ts', 'src/*.tsx'), true);
  });

  it('keeps two globs in different roots apart', () => {
    assert.equal(patternsOverlap('src/**/*.ts', 'docs/**/*.md'), false);
  });

  it('treats a bare wildcard as covering everything', () => {
    assert.equal(patternsOverlap('**/*', 'src/app.ts'), true);
  });
});
