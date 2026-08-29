/**
 * Silence one specific Node warning.
 *
 * `node:sqlite` is still marked experimental, so loading it prints a warning in
 * every process that opens a workspace. That is noise in a CLI and, worse,
 * noise on an MCP server's stderr.
 *
 * Node prints warnings from its own default `warning` listener, so patching
 * `process.emitWarning` is not enough — the default listener is replaced with
 * one that prints everything except this single message.
 */
const SUPPRESSED = /SQLite is an experimental feature/;

let installed = false;

export function quietSqliteWarning(): void {
  if (installed) return;
  installed = true;

  process.removeAllListeners('warning');
  process.on('warning', (warning: Error) => {
    if (SUPPRESSED.test(warning.message)) return;

    const name = warning.name || 'Warning';
    const detail = warning.stack ?? `${name}: ${warning.message}`;
    process.stderr.write(`(node:${process.pid}) ${detail}\n`);
  });
}

quietSqliteWarning();
