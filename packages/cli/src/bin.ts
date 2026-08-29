#!/usr/bin/env node
import { AssembleError, quietSqliteWarning } from '@assemble/core';

import { parseArgs, type Parsed } from './args.js';
import { DaemonError } from './client.js';
import { NeedsDaemon } from './context.js';
import { addCommand, agentsCommand, listCommand, removeCommand, stopCommand } from './commands/crew.js';
import { doctorCommand } from './commands/doctor.js';
import { feedCommand, inboxCommand, leasesCommand, sendCommand } from './commands/talk.js';
import { initCommand } from './commands/init.js';
import { taskCommand, tasksCommand } from './commands/board.js';
import { upCommand } from './commands/up.js';
import { printHelp } from './help.js';
import { dim, fail, print } from './output.js';

quietSqliteWarning();

type Command = (parsed: Parsed) => Promise<number> | number;

const COMMANDS: Record<string, Command> = {
  init: initCommand,
  up: upCommand,
  add: addCommand,
  ls: listCommand,
  list: listCommand,
  agents: () => agentsCommand(),
  stop: stopCommand,
  rm: removeCommand,
  remove: removeCommand,
  send: sendCommand,
  inbox: inboxCommand,
  feed: feedCommand,
  leases: leasesCommand,
  tasks: tasksCommand,
  task: taskCommand,
  doctor: () => doctorCommand(),
};

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;

  if (!name || name === 'help' || name === '--help' || name === '-h') return printHelp();
  if (name === '--version' || name === '-v') {
    print('0.1.0');
    return 0;
  }

  const command = COMMANDS[name];
  if (!command) {
    fail(`Unknown command: ${name}`);
    print(dim('Run `assemble help` to see what there is.'));
    return 2;
  }

  const parsed = parseArgs(rest);
  return command({ positionals: parsed.positionals, flags: parsed.flags });
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof NeedsDaemon || error instanceof DaemonError) {
      fail(error.message);
    } else if (error instanceof AssembleError) {
      fail(error.message);
    } else if (error instanceof Error && error.message.includes('not inside a git repository')) {
      fail('This is not a git repository. Assemble works on one repository at a time.');
    } else if (error instanceof Error && error.message.startsWith('No workspace in')) {
      fail(`${error.message}`);
    } else {
      fail(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  });
