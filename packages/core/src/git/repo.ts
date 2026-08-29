import { AssembleError } from '../errors.js';
import { git, gitLine, gitOk } from './run.js';

/** Absolute path of the repository root that contains `cwd`. */
export async function repoRoot(cwd: string): Promise<string> {
  const root = await gitLine(cwd, ['rev-parse', '--show-toplevel']);
  if (!root) throw new AssembleError('git_failed', `${cwd} is not inside a git repository`, { cwd });
  return root;
}

export async function isRepository(cwd: string): Promise<boolean> {
  return gitOk(cwd, ['rev-parse', '--git-dir']);
}

/** Branch currently checked out, or `undefined` on a detached HEAD. */
export async function currentBranch(cwd: string): Promise<string | undefined> {
  const name = await gitLine(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return name === 'HEAD' ? undefined : name;
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  return gitOk(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
}

export async function hasCommits(cwd: string): Promise<boolean> {
  return gitOk(cwd, ['rev-parse', '--verify', 'HEAD']);
}

/**
 * Best guess at the branch members should be cut from: whatever is checked out,
 * else the remote default, else the first of the usual names that exists.
 */
export async function defaultBaseBranch(cwd: string): Promise<string> {
  const current = await currentBranch(cwd);
  if (current) return current;

  const head = await gitLine(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(
    () => '',
  );
  if (head) return head.replace(/^origin\//, '');

  for (const candidate of ['main', 'master', 'develop']) {
    if (await branchExists(cwd, candidate)) return candidate;
  }
  return 'main';
}

export interface RepoStatus {
  branch: string | undefined;
  /** Paths with staged, unstaged or untracked changes. */
  dirty: string[];
  ahead: number;
  behind: number;
}

/** Porcelain v2 status, parsed down to what the console actually shows. */
export async function status(cwd: string): Promise<RepoStatus> {
  const { stdout } = await git(cwd, ['status', '--porcelain=v2', '--branch', '--untracked-files=all']);

  let branch: string | undefined;
  let ahead = 0;
  let behind = 0;
  const dirty: string[] = [];

  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const value = line.slice('# branch.head '.length).trim();
      branch = value === '(detached)' ? undefined : value;
    } else if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(line);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // Ordinary and renamed entries: path is the last space-separated field.
      const path = line.split(' ').slice(8).join(' ');
      if (path) dirty.push(path.split('\t')[0] ?? path);
    } else if (line.startsWith('? ') || line.startsWith('u ')) {
      dirty.push(line.slice(2));
    }
  }

  return { branch, dirty, ahead, behind };
}

/** Files changed on `branch` relative to `base`, as repo-relative paths. */
export async function changedFiles(cwd: string, base: string, branch = 'HEAD'): Promise<string[]> {
  const { stdout } = await git(cwd, ['diff', '--name-only', `${base}...${branch}`]);
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}
