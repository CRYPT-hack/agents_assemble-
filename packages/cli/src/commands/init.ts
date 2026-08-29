import { Workspace, configPath, dbPath } from '@assemble/core';

import { flagString, type Parsed } from '../args.js';
import { bold, dim, green, print } from '../output.js';

/**
 * `assemble init` — prepare the current repository for a crew.
 *
 * Creates `.assemble/` with the workspace config and database, and excludes it
 * from the repository's own history. Safe to run twice.
 */
export async function initCommand(parsed: Parsed): Promise<number> {
  const workspace = await Workspace.open({
    cwd: process.cwd(),
    overrides: {
      ...(flagString(parsed.flags, 'base') ? { baseBranch: flagString(parsed.flags, 'base') as string } : {}),
      ...(flagString(parsed.flags, 'name') ? { name: flagString(parsed.flags, 'name') as string } : {}),
    },
  });

  const { config } = workspace;
  workspace.close();

  print(`${green('ready')} ${bold(config.name)}`);
  print();
  print(`  ${dim('repository')}  ${config.repoRoot}`);
  print(`  ${dim('base branch')} ${config.baseBranch}`);
  print(`  ${dim('worktrees')}   ${config.worktreeRoot}`);
  print(`  ${dim('config')}      ${configPath(config.repoRoot)}`);
  print(`  ${dim('database')}    ${dbPath(config.repoRoot)}`);
  print();
  print(`Next: ${bold('assemble up')} to start the workspace, then ${bold('assemble add claude')}.`);

  return 0;
}
