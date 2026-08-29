/**
 * Do two path patterns describe files that could be the same file?
 *
 * Leases are advisory, so this errs toward saying yes. A false conflict costs
 * one agent a short wait; a missed conflict costs two agents the same file.
 */

/** Forward slashes, no `./`, no trailing slash, no duplicate separators. */
export function normalisePattern(pattern: string): string {
  return pattern
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '');
}

const SPECIAL = /[.+^${}()|[\]\\]/g;

/** Compile a glob into an anchored regular expression. Supports `**`, `*`, `?`. */
export function globToRegExp(pattern: string): RegExp {
  const glob = normalisePattern(pattern);
  let source = '';

  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i] as string;

    if (char === '*') {
      const isDouble = glob[i + 1] === '*';
      if (isDouble) {
        // `**/` swallows any number of directories, including none.
        if (glob[i + 2] === '/') {
          source += '(?:[^/]*\\/)*';
          i += 2;
        } else {
          source += '.*';
          i += 1;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      continue;
    }

    source += char.replace(SPECIAL, '\\$&');
  }

  return new RegExp(`^${source}$`);
}

export function matchesGlob(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(normalisePattern(path));
}

const WILDCARD = /[*?]/;

export function hasWildcard(pattern: string): boolean {
  return WILDCARD.test(pattern);
}

/** The literal directory prefix of a pattern, before its first wildcard. */
export function literalPrefix(pattern: string): string {
  const glob = normalisePattern(pattern);
  const index = glob.search(WILDCARD);
  if (index === -1) return glob;
  const cut = glob.lastIndexOf('/', index);
  return cut === -1 ? '' : glob.slice(0, cut);
}

/** True when `parent` is `child` or one of its ancestor directories. */
function coversDirectory(parent: string, child: string): boolean {
  if (parent === '') return true;
  return child === parent || child.startsWith(`${parent}/`);
}

/**
 * Whether two patterns can select a common file.
 *
 * Literal against literal is exact comparison, plus directory containment so a
 * lease on `src` covers `src/app.ts`. Wildcard against literal is a match test.
 * Wildcard against wildcard compares literal prefixes, which over-approximates
 * deliberately.
 */
export function patternsOverlap(a: string, b: string): boolean {
  const left = normalisePattern(a);
  const right = normalisePattern(b);
  if (left === right) return true;

  const leftGlob = hasWildcard(left);
  const rightGlob = hasWildcard(right);

  if (!leftGlob && !rightGlob) {
    return coversDirectory(left, right) || coversDirectory(right, left);
  }

  if (leftGlob && !rightGlob) {
    return matchesGlob(left, right) || coversDirectory(literalPrefix(left), right);
  }

  if (!leftGlob && rightGlob) {
    return matchesGlob(right, left) || coversDirectory(literalPrefix(right), left);
  }

  const leftPrefix = literalPrefix(left);
  const rightPrefix = literalPrefix(right);
  return coversDirectory(leftPrefix, rightPrefix) || coversDirectory(rightPrefix, leftPrefix);
}

/** Every pair of patterns from the two sets that could collide. */
export function overlappingPairs(a: string[], b: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const left of a) {
    for (const right of b) {
      if (patternsOverlap(left, right)) pairs.push([left, right]);
    }
  }
  return pairs;
}
