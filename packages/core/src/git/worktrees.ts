import { mkdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { AssembleError } from '../errors.js';
import { branchExists, hasCommits } from './repo.js';
import { git } from './run.js';

export interface Worktree {
  path: string;
  head: string;
  branch?: string;
  /** True while another checkout holds this worktree open. */
  locked: boolean;
  /** True for the main working copy rather than a linked worktree. */
  primary: boolean;
}

/** Parse `git worktree list --porcelain`, which is record-per-blank-line. */
function parseWorktreeList(stdout: string): Worktree[] {
  const worktrees: Worktree[] = [];
  let current: Partial<Worktree> & { path?: string } = {};

  const flush = (): void => {
    if (current.path) {
      worktrees.push({
        path: current.path,
        head: current.head ?? '',
        locked: current.locked ?? false,
        primary: worktrees.length === 0,
        ...(current.branch ? { branch: current.branch } : {}),
      });
    }
    current = {};
  };

  for (const line of stdout.split('\n')) {
    const text = line.trim();
    if (text === '') {
      flush();
      continue;
    }
    if (text.startsWith('worktree ')) current.path = text.slice('worktree '.length);
    else if (text.startsWith('HEAD ')) current.head = text.slice('HEAD '.length);
    else if (text.startsWith('branch ')) current.branch = text.slice('branch '.length).replace('refs/heads/', '');
    else if (text === 'locked') current.locked = true;
  }
  flush();

  return worktrees;
}

export async function listWorktrees(repoRoot: string): Promise<Worktree[]> {
  const { stdout } = await git(repoRoot, ['worktree', 'list', '--porcelain']);
  return parseWorktreeList(stdout);
}

export interface CreateWorktreeOptions {
  repoRoot: string;
  /** Absolute path the new worktree should live at. */
  path: string;
  /** Branch to create and check out there. */
  branch: string;
  /** Ref the branch is cut from. */
  base: string;
}

/**
 * Give a member its own checkout: a fresh branch off `base`, checked out in a
 * directory of its own. One object store, many working copies — which is what
 * lets several agents edit the same project without fighting over the index.
 */
export async function createWorktree(options: CreateWorktreeOptions): Promise<Worktree> {
  const { repoRoot, base } = options;
  const path = resolve(options.path);

  if (!(await hasCommits(repoRoot))) {
    throw new AssembleError(
      'git_failed',
      'The repository has no commits yet; make an initial commit before assembling a crew.',
      { repoRoot },
    );
  }

  if (await branchExists(repoRoot, options.branch)) {
    throw new AssembleError('conflict', `Branch ${options.branch} already exists`, {
      branch: options.branch,
    });
  }

  mkdirSync(resolve(path, '..'), { recursive: true });
  await git(repoRoot, ['worktree', 'add', '-b', options.branch, path, base]);

  // Compare real paths: Windows hands out short 8.3 names for some directories,
  // and git answers with the long form, so the two spellings rarely match.
  const target = realPath(path);
  const created = (await listWorktrees(repoRoot)).find((worktree) => realPath(worktree.path) === target);
  if (!created) {
    throw new AssembleError('git_failed', `Worktree ${path} was not created`, { path });
  }
  return created;
}

export interface RemoveWorktreeOptions {
  repoRoot: string;
  path: string;
  /** Discard uncommitted work in the worktree instead of refusing to remove it. */
  force?: boolean;
  /** Also delete the branch that was checked out there. */
  deleteBranch?: string;
}

export async function removeWorktree(options: RemoveWorktreeOptions): Promise<void> {
  const args = ['worktree', 'remove'];
  if (options.force) args.push('--force');
  args.push(options.path);

  await git(options.repoRoot, args);

  if (options.deleteBranch) {
    // -D rather than -d: the branch is usually unmerged on purpose.
    await git(options.repoRoot, ['branch', '-D', options.deleteBranch]).catch(() => undefined);
  }
}

/** The canonical spelling of a path, or the path itself if it does not exist. */
function realPath(path: string): string {
  try {
    return realpathSync.native(resolve(path)).toLowerCase();
  } catch {
    return resolve(path).toLowerCase();
  }
}

/** Drop administrative records for worktrees whose directories are gone. */
export async function pruneWorktrees(repoRoot: string): Promise<void> {
  await git(repoRoot, ['worktree', 'prune']);
}
