export interface Parsed {
  /** Everything that was not a flag, in order. */
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Argument parsing, hand-rolled and deliberately dull.
 *
 * `--flag value`, `--flag=value`, `--no-flag`, and short `-p 4319`. Anything
 * after a bare `--` is passed through untouched, which is how extra arguments
 * reach the agent being launched.
 */
export function parseArgs(argv: string[]): Parsed & { rest: string[] } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];

  let passthrough = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;

    if (passthrough) {
      rest.push(arg);
      continue;
    }
    if (arg === '--') {
      passthrough = true;
      continue;
    }

    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const equals = body.indexOf('=');

      if (equals !== -1) {
        flags[body.slice(0, equals)] = body.slice(equals + 1);
        continue;
      }
      if (body.startsWith('no-')) {
        flags[body.slice(3)] = false;
        continue;
      }

      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[body] = next;
        i += 1;
      } else {
        flags[body] = true;
      }
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      const name = arg.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[name] = next;
        i += 1;
      } else {
        flags[name] = true;
      }
      continue;
    }

    positionals.push(arg);
  }

  return { positionals, flags, rest };
}

export function flagString(flags: Parsed['flags'], ...names: string[]): string | undefined {
  for (const name of names) {
    const value = flags[name];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

export function flagBool(flags: Parsed['flags'], name: string, fallback = false): boolean {
  const value = flags[name];
  return typeof value === 'boolean' ? value : value === undefined ? fallback : value !== 'false';
}

export function flagNumber(flags: Parsed['flags'], ...names: string[]): number | undefined {
  const value = flagString(flags, ...names);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
