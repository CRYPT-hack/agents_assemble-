/** Shapes the daemon sends. Kept narrow: the console only reads. */

export interface Member {
  id: string;
  handle: string;
  agentId: string;
  mission: string;
  status: string;
  worktree: string;
  branch: string;
  note?: string;
  running?: boolean;
  unread?: number;
  createdAt: string;
}

export interface Message {
  id: string;
  kind: 'direct' | 'broadcast' | 'channel' | 'system';
  from: string;
  to: string[];
  subject: string;
  body: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  threadId: string;
  replyTo?: string;
  taskId?: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  body: string;
  status: string;
  assignee?: string;
  createdBy: string;
  dependsOn: string[];
  labels: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Lease {
  id: string;
  holder: string;
  paths: string[];
  mode: 'exclusive' | 'shared';
  reason: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface WorkspaceEvent {
  id: string;
  seq: number;
  type: string;
  actor: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Agent {
  id: string;
  name: string;
  command: string;
  speaksMcp: boolean;
}

export interface Snapshot {
  config: { name: string; repoRoot: string; baseBranch: string };
  members: Array<{ handle: string; agentId: string; status: string; mission: string; unread: number }>;
  tasks: Record<string, number>;
  leases: number;
  seq: number;
  running: string[];
}

export type ServerMessage =
  | { type: 'hello'; snapshot: Snapshot; seq: number }
  | { type: 'event'; event: WorkspaceEvent }
  | { type: 'output'; handle: string; chunk: string }
  | { type: 'scrollback'; handle: string; data: string }
  | { type: 'error'; message: string };
