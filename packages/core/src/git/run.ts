import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { AssembleError } from '../errors.js';

const execFileAsync = promisify(execFile);

export interface GitResult {
  stdout: string;
  stderr: string;
}

/**
 * Run one git command in `cwd`.
 *
 * Arguments are passed as an array, never interpolated into a shell string —
 * branch names and paths reach git untouched, and a repository path containing
 * a space stays one argument.
 */
export async function git(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (cause) {
    const error = cause as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
    const stderr = error.stderr?.toString().trim() ?? error.message ?? 'git failed';
    throw new AssembleError('git_failed', `git ${args.join(' ')}: ${stderr}`, { cwd, args, stderr });
  }
}

/** Same as `git`, but trimmed to a single line — the common case for queries. */
export async function gitLine(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await git(cwd, args);
  return stdout.trim();
}

/** Run a command that is allowed to fail, e.g. probing whether a ref exists. */
export async function gitOk(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
}
