import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { AGENT_CATALOG, isRepository, readConfig, repoRoot } from '@assemble/core';
import { ptyAvailable } from '@assemble/daemon';

import { bold, dim, green, print, red, table, yellow } from '../output.js';

/** Windows needs the extension; everywhere else the bare name is the file. */
const EXTENSIONS = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', '.ps1', ''] : [''];

/** Is `command` runnable from this shell? */
export function onPath(command: string): string | undefined {
  const dirs = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean);

  for (const dir of dirs) {
    for (const extension of EXTENSIONS) {
      const candidate = join(dir, command + extension);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * `assemble doctor` — what is installed, and what is missing.
 *
 * The honest answer to "why did my agent not start" is almost always that its
 * CLI is not installed or not authenticated. This prints that before it costs
 * anyone a debugging session.
 */
export async function doctorCommand(): Promise<number> {
  print(bold('environment'));
  print(`  ${dim('node')}  ${process.version}`);
  print(`  ${dim('pty')}   ${(await ptyAvailable()) ? green('yes') : yellow('no — agents run over pipes')}`);
  print();

  print(bold('workspace'));
  let root: string | undefined;
  try {
    root = await repoRoot(process.cwd());
  } catch {
    root = undefined;
  }

  if (!root || !(await isRepository(process.cwd()))) {
    print(`  ${red('not a git repository')} ${dim('— run assemble from inside one')}`);
  } else {
    const config = readConfig(root);
    print(`  ${dim('repository')}  ${root}`);
    print(
      config
        ? `  ${dim('workspace')}   ${green('ready')} ${dim(`base ${config.baseBranch}`)}`
        : `  ${dim('workspace')}   ${yellow('not initialised')} ${dim('— run assemble init')}`,
    );
  }
  print();

  print(bold('agents'));
  const rows = AGENT_CATALOG.map((spec) => {
    const found = onPath(spec.command);
    return [
      bold(spec.id),
      spec.name,
      found ? green('installed') : dim('missing'),
      found ? dim(found) : dim(spec.command),
    ];
  });
  print(table(['ID', 'AGENT', 'STATE', 'COMMAND'], rows));

  const installed = rows.filter((row) => row[2]?.includes('installed')).length;
  print();
  print(
    installed === 0
      ? yellow('No agent CLIs found on PATH. Install at least one before assembling a crew.')
      : dim(`${installed} agent CLI(s) available.`),
  );

  return 0;
}
