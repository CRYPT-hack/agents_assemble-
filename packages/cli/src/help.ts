import { bold, dim, print } from './output.js';

const COMMANDS: Array<[string, string]> = [
  ['init', 'Prepare this repository for a crew'],
  ['up', 'Run the workspace: agents, bus and console'],
  ['add <agent>', 'Enlist an agent and start it'],
  ['ls', 'Who is in the crew and what they are doing'],
  ['agents', 'Which agents this build knows how to run'],
  ['stop <handle>', 'End an agent, keep its branch'],
  ['rm <handle>', 'Remove a member worktree'],
  ['send [handle...]', 'Send a message to the crew'],
  ['inbox <handle>', 'Read what is waiting for a member'],
  ['feed', 'The whole conversation, newest last'],
  ['leases', 'Who is holding which files'],
  ['tasks', 'The shared board'],
  ['task <title>', 'Put work on the board'],
  ['doctor', 'What is installed, and what is missing'],
];

const EXAMPLES: Array<[string, string]> = [
  ['assemble init', 'set the repository up'],
  ['assemble up', 'start the workspace and open the console'],
  ['assemble add claude --mission "port the parser"', 'enlist an agent on a job'],
  ['assemble add codex --mission "write the tests for it"', 'and another, alongside'],
  ['assemble ls', 'see them both working'],
  ['assemble send codex -s "heads up" -b "lexer moved"', 'talk to one of them'],
];

export function printHelp(): number {
  print(`${bold('assemble')} ${dim('— run your coding agents side by side on one project')}`);
  print();
  print(bold('commands'));
  for (const [name, description] of COMMANDS) {
    print(`  ${name.padEnd(20)} ${dim(description)}`);
  }
  print();
  print(bold('common flags'));
  print(`  ${'--port <n>'.padEnd(20)} ${dim('daemon port (default 4319)')}`);
  print(`  ${'--mission "..."'.padEnd(20)} ${dim('what an agent is being enlisted to do')}`);
  print(`  ${'--handle <name>'.padEnd(20)} ${dim('name a member yourself')}`);
  print(`  ${'--no-start'.padEnd(20)} ${dim('prepare a member without launching it')}`);
  print();
  print(bold('a first run'));
  for (const [command, description] of EXAMPLES) {
    print(`  ${command}`);
    print(`    ${dim(description)}`);
  }
  return 0;
}
