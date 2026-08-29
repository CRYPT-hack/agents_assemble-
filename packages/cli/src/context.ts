import { readFileSync } from 'node:fs';

import {
  Workspace,
  attachWorkspace,
  dbPath,
  repoRoot,
  tokenPath,
  type AttachedWorkspace,
} from '@assemble/core';

import { flagNumber, flagString, type Parsed } from './args.js';
import { DaemonClient, DEFAULT_PORT } from './client.js';

/**
 * A client for the daemon, carrying this workspace's token.
 *
 * The token lives in the repository's own `.assemble/` directory, so anything
 * that can already read the workspace can talk to it — and nothing else can.
 */
export async function clientFor(parsed: Parsed): Promise<DaemonClient> {
  const port = flagNumber(parsed.flags, 'port', 'p') ?? DEFAULT_PORT;
  const host = flagString(parsed.flags, 'host') ?? '127.0.0.1';

  let token = '';
  try {
    token = readFileSync(tokenPath(await repoRoot(process.cwd())), 'utf8').trim();
  } catch {
    // No workspace here yet, or no daemon has ever run: the call will say so.
  }

  return DaemonClient.at(port, host, token);
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
