import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { startDaemon } from '@assemble/daemon';

import { flagNumber, flagString, type Parsed } from '../args.js';
import { DEFAULT_PORT } from '../client.js';
import { bold, dim, green, print, warn } from '../output.js';

/**
 * Where `assemble-mcp` lives for this installation.
 *
 * Members launch it by absolute path rather than by name, so the bus works
 * whether Assemble was installed globally, locally, or run straight from a
 * checkout — none of which guarantee anything useful about their PATH.
 */
function resolveMcpLauncher(): { command: string; args: string[] } {
  try {
    const require = createRequire(import.meta.url);
    const packageJson = require.resolve('@assemble/mcp/package.json');
    return { command: process.execPath, args: [join(dirname(packageJson), 'dist', 'bin.js')] };
  } catch {
    return { command: 'assemble-mcp', args: [] };
  }
}

/**
 * `assemble up` — run the workspace daemon in the foreground.
 *
 * This is the process that owns the agents. Closing it stops them, which is why
 * it stays in the foreground and says so.
 */
export async function upCommand(parsed: Parsed): Promise<number> {
  const launcher = resolveMcpLauncher();

  const daemon = await startDaemon({
    cwd: process.cwd(),
    port: flagNumber(parsed.flags, 'port', 'p') ?? DEFAULT_PORT,
    ...(flagString(parsed.flags, 'host') ? { host: flagString(parsed.flags, 'host') as string } : {}),
    ...(flagString(parsed.flags, 'ui') ? { uiRoot: flagString(parsed.flags, 'ui') as string } : {}),
    mcpCommand: launcher.command,
    mcpArgs: launcher.args,
  });

  const members = daemon.workspace.crew.list();

  print(`${green('up')} ${bold(daemon.workspace.config.name)} ${dim(daemon.url)}`);
  print(`  ${dim('crew')}  ${members.length === 0 ? 'nobody yet' : members.map((m) => m.handle).join(', ')}`);
  print(`  ${dim('add')}   assemble add claude --mission "..."`);
  print();
  print(dim('Ctrl-C stops the workspace and every agent in it.'));

  if (launcher.command === 'assemble-mcp') {
    warn('Could not locate @assemble/mcp; agents will look for `assemble-mcp` on PATH.');
  }

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      print();
      print(dim('stopping the crew…'));
      void daemon.close().then(resolve);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

  return 0;
}
