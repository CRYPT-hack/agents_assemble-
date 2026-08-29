import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

import { defaultBaseBranch, repoRoot as findRepoRoot } from './git/repo.js';
import { gitOk } from './git/run.js';
import { openDatabase, type Db } from './store/db.js';
import { EventStore } from './store/events.js';
import { LeaseStore } from './store/leases.js';
import { MemberStore } from './store/members.js';
import { MessageStore } from './store/messages.js';
import { TaskStore } from './store/tasks.js';
import { Board } from './services/board.js';
import { Bus } from './services/bus.js';
import { Crew, type BusLauncher } from './services/crew.js';
import { Leases } from './services/leases.js';
import type { WorkspaceConfig } from './types.js';

/** Everything Assemble writes lives under this directory inside the repo. */
export const STATE_DIR = '.assemble';
export const CONFIG_FILE = 'workspace.json';
export const DB_FILE = 'workspace.db';
export const TOKEN_FILE = 'token';

export const stateDir = (repoRoot: string): string => join(repoRoot, STATE_DIR);
export const configPath = (repoRoot: string): string => join(stateDir(repoRoot), CONFIG_FILE);
export const dbPath = (repoRoot: string): string => join(stateDir(repoRoot), DB_FILE);
export const tokenPath = (repoRoot: string): string => join(stateDir(repoRoot), TOKEN_FILE);

export function defaultConfig(repoRoot: string, baseBranch: string): WorkspaceConfig {
  return {
    name: basename(repoRoot),
    repoRoot,
    worktreeRoot: join(stateDir(repoRoot), 'worktrees'),
    baseBranch,
    branchPrefix: 'assemble/',
    leaseTtlSeconds: 1800,
  };
}

/**
 * Keep workspace state out of the user's commits without editing their
 * `.gitignore` — `.git/info/exclude` is local to the clone and ours to manage.
 */
function excludeStateDir(repoRoot: string): void {
  const exclude = join(repoRoot, '.git', 'info', 'exclude');
  try {
    const existing = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    if (existing.includes(`${STATE_DIR}/`)) return;
    appendFileSync(exclude, `${existing.endsWith('\n') || existing === '' ? '' : '\n'}${STATE_DIR}/\n`);
  } catch {
    // A read-only or unusual git dir is not worth failing a workspace over.
  }
}

export function readConfig(repoRoot: string): WorkspaceConfig | undefined {
  const file = configPath(repoRoot);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as WorkspaceConfig;
  } catch {
    return undefined;
  }
}

/**
 * Is the workspace config something this clone brought with it?
 *
 * `.assemble/` is local state and normally excluded, but nothing stops a
 * repository from committing a `workspace.json` of its own — and that file can
 * say which binary each agent runs. Cloning a repository should never decide
 * what runs on your machine, so a tracked config is treated as untrusted.
 */
export async function configIsTracked(repoRoot: string): Promise<boolean> {
  return gitOk(repoRoot, ['ls-files', '--error-unmatch', `${STATE_DIR}/${CONFIG_FILE}`]);
}

export function writeConfig(config: WorkspaceConfig): void {
  mkdirSync(stateDir(config.repoRoot), { recursive: true });
  writeFileSync(configPath(config.repoRoot), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export interface OpenOptions {
  /** Any path inside the repository. Defaults to the process working directory. */
  cwd?: string;
  /** Create the workspace if it does not exist yet. */
  create?: boolean;
  /** Overrides applied on top of the stored config. */
  overrides?: Partial<WorkspaceConfig>;
  /** How members launch the MCP server. Defaults to `assemble-mcp` on PATH. */
  launcher?: Partial<BusLauncher>;
}

/**
 * One open workspace: the database, the stores, and the four services that make
 * up the coordination layer. Construct it with `Workspace.open`.
 */
export class Workspace {
  readonly config: WorkspaceConfig;
  readonly db: Db;
  readonly events: EventStore;
  readonly bus: Bus;
  readonly leases: Leases;
  readonly board: Board;
  readonly crew: Crew;

  private constructor(config: WorkspaceConfig, db: Db, launcher: BusLauncher) {
    this.config = config;
    this.db = db;

    const members = new MemberStore(db);
    const messages = new MessageStore(db);
    const tasks = new TaskStore(db);
    const leaseStore = new LeaseStore(db);

    this.events = new EventStore(db);
    this.bus = new Bus(messages, members, this.events);
    this.leases = new Leases(leaseStore, this.events, config.leaseTtlSeconds);
    this.board = new Board(tasks, this.events);
    this.crew = new Crew(config, members, this.events, this.bus, this.leases, this.board, launcher);
  }

  static async open(options: OpenOptions = {}): Promise<Workspace> {
    const cwd = resolve(options.cwd ?? process.cwd());
    const root = await findRepoRoot(cwd);

    let config = readConfig(root);
    if (!config) {
      if (options.create === false) {
        throw new Error(`No workspace in ${root}. Run \`assemble init\` first.`);
      }
      config = defaultConfig(root, await defaultBaseBranch(root));
      writeConfig(config);
    }

    config = { ...config, ...options.overrides, repoRoot: root };

    // A config that arrived with the repository does not get to choose which
    // programs run as agents. Everything else in it is harmless; this is not.
    let disownedAgents: string[] = [];
    if (config.agents && Object.keys(config.agents).length > 0 && (await configIsTracked(root))) {
      disownedAgents = Object.keys(config.agents);
      const { agents: _ignored, ...rest } = config;
      config = rest;
    }

    // The stored worktree root is an absolute path, and a config can be wrong
    // about it — a repository that moved, or one that shipped a config pointing
    // somewhere else entirely. Worktrees belong inside the repository we opened.
    const inside = relative(root, resolve(config.worktreeRoot));
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
      config = { ...config, worktreeRoot: join(stateDir(root), 'worktrees') };
    }

    mkdirSync(config.worktreeRoot, { recursive: true });
    excludeStateDir(root);

    const db = openDatabase(dbPath(root));
    const launcher: BusLauncher = {
      command: options.launcher?.command ?? 'assemble-mcp',
      args: options.launcher?.args ?? [],
      dbPath: options.launcher?.dbPath ?? dbPath(root),
    };

    const workspace = new Workspace(config, db, launcher);
    workspace.events.append('workspace.opened', 'workspace', {
      name: config.name,
      repoRoot: root,
      baseBranch: config.baseBranch,
      disownedAgents,
    });

    if (disownedAgents.length > 0) {
      workspace.bus.announce(
        'ignored agent definitions from a committed config',
        [
          `${configPath(root)} is committed to this repository, and it defines: ${disownedAgents.join(', ')}.`,
          'Agent definitions say which programs to run, so ones that arrive with a clone are ignored.',
          'If they are yours, move them into a config that is not tracked by git.',
        ].join('\n'),
        'high',
      );
    }

    return workspace;
  }

  /** A single object describing the whole workspace — what the console loads. */
  snapshot(): {
    config: WorkspaceConfig;
    members: ReturnType<Bus['roster']>;
    tasks: Record<string, number>;
    leases: number;
    seq: number;
  } {
    return {
      config: this.config,
      members: this.bus.roster(),
      tasks: this.board.counts(),
      leases: this.leases.active().length,
      seq: this.events.latestSeq(),
    };
  }

  close(): void {
    this.db.close();
  }
}
