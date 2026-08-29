/**
 * Domain vocabulary for a workspace.
 *
 * A workspace is one git repository plus the crew of agents working it. Every
 * agent runs in its own worktree, so the words below draw a hard line between
 * the *definition* of an agent (`AgentSpec`, static) and a *running instance*
 * of one (`Member`, live).
 */

export type Iso8601 = string;

/** Stable identifier, prefixed by kind: `mbr_`, `msg_`, `tsk_`, `lse_`, `evt_`. */
export type Id = string;

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/** How to launch one kind of coding agent CLI. */
export interface AgentSpec {
  /** Catalog key, e.g. `claude`, `codex`, `gemini`, `aider`. */
  id: string;
  /** Human label for the console. */
  name: string;
  /** Executable to spawn. Resolved against PATH. */
  command: string;
  /** Base arguments, before any per-member mission arguments. */
  args: string[];
  /** Extra environment for the child process. */
  env?: Record<string, string>;
  /**
   * How the agent receives its assignment. `argv` appends the prompt as a final
   * argument, `stdin` writes it to the pty once ready, `none` leaves it to the
   * human or to the bus.
   */
  promptMode: 'argv' | 'stdin' | 'none';
  /** Applied before the prompt reaches the agent. `{{mission}}` is substituted. */
  promptTemplate?: string;
  /** True when the agent can speak MCP and therefore join the bus directly. */
  speaksMcp: boolean;
  /** Where to write MCP server config so the agent picks the bus up on launch. */
  mcpConfig?: McpConfigTarget;
}

/** Recipe for wiring the Assemble MCP server into an agent's own config file. */
export interface McpConfigTarget {
  /** Path relative to the member worktree, e.g. `.mcp.json`. */
  file: string;
  /** Shape of that file, so the writer knows where the server list lives. */
  format: 'mcp-json' | 'codex-toml' | 'gemini-settings';
}

// ---------------------------------------------------------------------------
// Members: a running agent instance
// ---------------------------------------------------------------------------

export type MemberStatus =
  | 'created'
  | 'starting'
  | 'working'
  | 'waiting'
  | 'blocked'
  | 'review'
  | 'done'
  | 'stopped'
  | 'failed';

/** One agent, running, with its own worktree and branch. */
export interface Member {
  id: Id;
  /** Short address used on the bus, unique per workspace, e.g. `claude-1`. */
  handle: string;
  /** `AgentSpec.id` this member was launched from. */
  agentId: string;
  /** One-line description of what this member is meant to do. */
  mission: string;
  status: MemberStatus;
  /** Absolute path of the member worktree. */
  worktree: string;
  /** Branch checked out in that worktree. */
  branch: string;
  /** OS process id while running. */
  pid?: number;
  createdAt: Iso8601;
  startedAt?: Iso8601;
  endedAt?: Iso8601;
  /** Last line of reasoning the member published about itself. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Messages: the agent-to-agent bus
// ---------------------------------------------------------------------------

export type MessageKind =
  /** Addressed to specific members. */
  | 'direct'
  /** Addressed to everyone in the workspace. */
  | 'broadcast'
  /** Addressed to a named channel members can subscribe to. */
  | 'channel'
  /** Emitted by the workspace itself, not by a member. */
  | 'system';

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Message {
  id: Id;
  kind: MessageKind;
  /** Member handle, or `workspace` for system messages. */
  from: string;
  /** Member handles for `direct`, channel name for `channel`, empty otherwise. */
  to: string[];
  subject: string;
  body: string;
  priority: MessagePriority;
  /** Groups a message with its replies. Root messages thread on their own id. */
  threadId: Id;
  /** Message this one answers, when it answers one. */
  replyTo?: Id;
  /** Task this message concerns, when it concerns one. */
  taskId?: Id;
  createdAt: Iso8601;
}

/** Per-recipient delivery state, so an inbox can be read and drained. */
export interface Delivery {
  messageId: Id;
  /** Recipient handle. */
  recipient: string;
  readAt?: Iso8601;
  ackedAt?: Iso8601;
}

// ---------------------------------------------------------------------------
// Leases: advisory locks over paths
// ---------------------------------------------------------------------------

export type LeaseMode = 'exclusive' | 'shared';

/**
 * A declaration of intent over some files. Advisory by design: the workspace
 * reports conflicts, it does not enforce them at the filesystem level.
 */
export interface Lease {
  id: Id;
  /** Handle of the member holding it. */
  holder: string;
  /** Glob patterns, relative to the repository root. */
  paths: string[];
  mode: LeaseMode;
  reason: string;
  acquiredAt: Iso8601;
  expiresAt: Iso8601;
  releasedAt?: Iso8601;
}

// ---------------------------------------------------------------------------
// Task board
// ---------------------------------------------------------------------------

export type TaskStatus =
  | 'backlog'
  | 'claimed'
  | 'in_progress'
  | 'review'
  | 'blocked'
  | 'done'
  | 'cancelled';

export interface Task {
  id: Id;
  title: string;
  body: string;
  status: TaskStatus;
  /** Handle of the member who owns it, when claimed. */
  assignee?: string;
  /** Handle of whoever filed it, or `workspace`. */
  createdBy: string;
  /** Task ids that must reach `done` before this one may start. */
  dependsOn: Id[];
  /** Free-form labels for filtering the board. */
  labels: string[];
  createdAt: Iso8601;
  updatedAt: Iso8601;
}

// ---------------------------------------------------------------------------
// Events: the append-only stream the console tails
// ---------------------------------------------------------------------------

export type EventType =
  | 'workspace.opened'
  | 'member.created'
  | 'member.status'
  | 'member.output'
  | 'member.exited'
  | 'message.sent'
  | 'message.read'
  | 'lease.acquired'
  | 'lease.released'
  | 'lease.conflict'
  | 'task.created'
  | 'task.updated';

export interface WorkspaceEvent<T = unknown> {
  id: Id;
  type: EventType;
  /** Member handle when the event has an author, `workspace` otherwise. */
  actor: string;
  payload: T;
  createdAt: Iso8601;
  /** Monotonic sequence number, so a client can resume a stream. */
  seq: number;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export interface WorkspaceConfig {
  /** Display name, defaults to the repository directory name. */
  name: string;
  /** Absolute path of the git repository being worked on. */
  repoRoot: string;
  /** Where worktrees are created. Defaults to `<repoRoot>/.assemble/worktrees`. */
  worktreeRoot: string;
  /** Branch new member branches are cut from. */
  baseBranch: string;
  /** Prefix for member branch names, e.g. `assemble/` gives `assemble/claude-1`. */
  branchPrefix: string;
  /** Default lease duration in seconds. */
  leaseTtlSeconds: number;
}
