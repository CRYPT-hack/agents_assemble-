export * from './types.js';
export * from './errors.js';
export { newId, nowIso, hasPrefix, type IdPrefix } from './ids.js';

export { AGENT_CATALOG, agentIds, findAgent, requireAgent, resolveAgent, renderPrompt } from './agents/catalog.js';
export { writeBusConfig, type BusEndpoint } from './agents/mcpConfig.js';

export { git, gitLine, gitOk, type GitResult } from './git/run.js';
export {
  branchExists,
  changedFiles,
  currentBranch,
  defaultBaseBranch,
  hasCommits,
  isRepository,
  repoRoot,
  status,
  type RepoStatus,
} from './git/repo.js';
export {
  createWorktree,
  listWorktrees,
  pruneWorktrees,
  removeWorktree,
  type CreateWorktreeOptions,
  type RemoveWorktreeOptions,
  type Worktree,
} from './git/worktrees.js';

export {
  globToRegExp,
  hasWildcard,
  literalPrefix,
  matchesGlob,
  normalisePattern,
  overlappingPairs,
  patternsOverlap,
} from './leases/overlap.js';

export { openDatabase, migrate, transact, type Db } from './store/db.js';
export { EventStore } from './store/events.js';
export { LeaseStore } from './store/leases.js';
export { MemberStore } from './store/members.js';
export { MessageStore, type InboxItem } from './store/messages.js';
export { TaskStore, type TaskFilter } from './store/tasks.js';

export {
  attachWorkspace,
  type AttachOptions,
  type AttachedWorkspace,
} from './services/attach.js';
export { Board, type CreateTaskOptions } from './services/board.js';
export { Bus, WORKSPACE_SENDER, type SendOptions } from './services/bus.js';
export { Crew, type BusLauncher, type EnlistOptions, type EnlistResult } from './services/crew.js';
export {
  Leases,
  type AcquireOptions,
  type AcquireResult,
  type LeaseConflict,
} from './services/leases.js';

export {
  CONFIG_FILE,
  DB_FILE,
  STATE_DIR,
  Workspace,
  configPath,
  dbPath,
  defaultConfig,
  readConfig,
  stateDir,
  writeConfig,
  type OpenOptions,
} from './workspace.js';
