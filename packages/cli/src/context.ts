import { Workspace, attachWorkspace, dbPath, repoRoot, type AttachedWorkspace } from '@assemble/core';

import { flagNumber, flagString, type Parsed } from './args.js';
import { DaemonClient, DEFAULT_PORT } from './client.js';

export function clientFor(parsed: Parsed): DaemonClient {
  const port = flagNumber(parsed.flags, 'port', 'p') ?? DEFAULT_PORT;
  const host = flagString(parsed.flags, 'host') ?? '127.0.0.1';
  return DaemonClient.at(port, host);
}

/**
 * Read-only access to the workspace without the daemon.
 *
 * `assemble ls` and friends should work whether or not anything is running, so
 * they attach to the database directly when nobody answers on the port.
 */
export async function attachHere(): Promise<AttachedWorkspace> {
  const root = await repoRoot(process.cwd());
  return attachWorkspace({ dbPath: dbPath(root) });
}

/** Full workspace access, for the commands that create or remove worktrees. */
export async function openHere(): Promise<Workspace> {
  return Workspace.open({ cwd: process.cwd(), create: false });
}

export class NeedsDaemon extends Error {
  constructor(what: string) {
    super(`${what} needs a running workspace. Start one with \`assemble up\`.`);
    this.name = 'NeedsDaemon';
  }
}
