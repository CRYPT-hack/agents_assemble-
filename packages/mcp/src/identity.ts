import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Who is talking, and which workspace they are talking in.
 *
 * The daemon writes `ASSEMBLE_HANDLE` and `ASSEMBLE_DB` into the agent's own
 * MCP config when it enlists a member, so an agent cannot claim to be another
 * member by asking — its identity arrives with its process, not in a tool call.
 */
export interface Identity {
  handle: string;
  dbPath: string;
}

export class IdentityError extends Error {}

export function resolveIdentity(env: NodeJS.ProcessEnv = process.env): Identity {
  const handle = env['ASSEMBLE_HANDLE']?.trim();
  const dbPath = env['ASSEMBLE_DB']?.trim();

  if (!handle) {
    throw new IdentityError(
      'ASSEMBLE_HANDLE is not set. This server is launched by the Agents Assemble daemon, ' +
        'which supplies the handle of the member it belongs to.',
    );
  }
  if (!dbPath) {
    throw new IdentityError('ASSEMBLE_DB is not set. It must point at the workspace database.');
  }

  const absolute = resolve(dbPath);
  if (!existsSync(absolute)) {
    throw new IdentityError(`No workspace database at ${absolute}. Has \`assemble init\` run?`);
  }

  return { handle, dbPath: absolute };
}
