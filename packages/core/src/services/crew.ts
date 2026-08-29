import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { resolveAgent } from '../agents/catalog.js';
import { writeBusConfig, type BusEndpoint } from '../agents/mcpConfig.js';
import { createWorktree, removeWorktree } from '../git/worktrees.js';
import { newId, nowIso } from '../ids.js';
import type { EventStore } from '../store/events.js';
import type { MemberStore } from '../store/members.js';
import type { AgentSpec, Member, MemberStatus, WorkspaceConfig } from '../types.js';
import type { Board } from './board.js';
import type { Bus } from './bus.js';
import type { Leases } from './leases.js';

export interface EnlistOptions {
  /** Catalog id of the agent to run, e.g. `claude`. */
  agentId: string;
  /** What this member is here to do. */
  mission?: string;
  /** Override the generated handle. */
  handle?: string;
  /** Per-member overrides of the catalog entry. */
  spec?: Partial<AgentSpec>;
  /** Cut the branch from something other than the workspace base branch. */
  base?: string;
}

export interface EnlistResult {
  member: Member;
  spec: AgentSpec;
  /** Config file written into the worktree, when the agent speaks MCP. */
  busConfigPath?: string;
}

/** How the MCP server is launched for members that speak it. */
export interface BusLauncher {
  command: string;
  args: string[];
  dbPath: string;
}

/**
 * Enlisting, retiring, and tracking members.
 *
 * Enlisting is the moment a workspace becomes multi-agent: a branch is cut, a
 * worktree is checked out, the bus is wired into the agent's own config, and
 * the crew is told somebody joined.
 */
export class Crew {
  constructor(
    private readonly config: WorkspaceConfig,
    private readonly members: MemberStore,
    private readonly events: EventStore,
    private readonly bus: Bus,
    private readonly leases: Leases,
    private readonly board: Board,
    private readonly launcher: BusLauncher,
  ) {}

  list(): Member[] {
    return this.members.list();
  }

  find(handle: string): Member | undefined {
    return this.members.findByHandle(handle);
  }

  require(handle: string): Member {
    return this.members.requireByHandle(handle);
  }

  /** First free handle of the form `claude`, `claude-2`, `claude-3`, … */
  mintHandle(agentId: string): string {
    if (!this.members.handleTaken(agentId)) return agentId;
    for (let n = 2; n < 1000; n += 1) {
      const candidate = `${agentId}-${n}`;
      if (!this.members.handleTaken(candidate)) return candidate;
    }
    return `${agentId}-${Date.now()}`;
  }

  async enlist(options: EnlistOptions): Promise<EnlistResult> {
    const spec = resolveAgent(options.agentId, options.spec ?? {});
    const handle = options.handle ?? this.mintHandle(spec.id);
    const branch = `${this.config.branchPrefix}${handle}`;
    const worktree = join(this.config.worktreeRoot, handle);

    await createWorktree({
      repoRoot: this.config.repoRoot,
      path: worktree,
      branch,
      base: options.base ?? this.config.baseBranch,
    });

    const member: Member = {
      id: newId('mbr'),
      handle,
      agentId: spec.id,
      mission: options.mission ?? '',
      status: 'created',
      worktree,
      branch,
      createdAt: nowIso(),
    };
    this.members.insert(member);

    const endpoint: BusEndpoint = {
      command: this.launcher.command,
      args: this.launcher.args,
      handle,
      dbPath: this.launcher.dbPath,
    };
    const busConfigPath = spec.speaksMcp ? writeBusConfig(spec, worktree, endpoint) : undefined;

    this.events.append('member.created', handle, {
      memberId: member.id,
      agentId: spec.id,
      branch,
      worktree,
      mission: member.mission,
      speaksMcp: spec.speaksMcp,
    });

    this.bus.announce(
      `${handle} joined`,
      member.mission
        ? `${handle} (${spec.name}) is working on: ${member.mission}\nBranch ${branch}.`
        : `${handle} (${spec.name}) joined on branch ${branch}.`,
    );

    return { member, spec, ...(busConfigPath ? { busConfigPath } : {}) };
  }

  setStatus(handle: string, status: MemberStatus, note?: string): Member {
    const member = this.require(handle);
    const patch: Partial<Member> = { status };
    if (note !== undefined) patch.note = note;
    if (status === 'working' && !member.startedAt) patch.startedAt = nowIso();
    if (status === 'stopped' || status === 'failed' || status === 'done') patch.endedAt = nowIso();

    const updated = this.members.update(member.id, patch);
    this.events.append('member.status', handle, { status, note });
    return updated;
  }

  setPid(handle: string, pid: number | undefined): Member {
    const member = this.require(handle);
    return this.members.update(member.id, { pid });
  }

  /**
   * Take a member off the bus: release its leases, return its claimed tasks to
   * the backlog, and tell everyone. The worktree is left in place so the work
   * can still be reviewed — `discharge` is what removes it.
   */
  standDown(handle: string, reason: string): Member {
    const member = this.setStatus(handle, 'stopped', reason);
    const released = this.leases.releaseAll(handle);
    const returned = this.board.releaseFor(handle);

    this.bus.announce(
      `${handle} stood down`,
      [
        `${handle} is no longer working. ${reason}`.trim(),
        released > 0 ? `Released ${released} file lease(s).` : '',
        returned > 0 ? `Returned ${returned} task(s) to the backlog.` : '',
        `Its branch ${member.branch} is still there.`,
      ]
        .filter(Boolean)
        .join('\n'),
    );

    return member;
  }

  /** Remove a member's worktree, and optionally its branch with it. */
  async discharge(handle: string, options: { deleteBranch?: boolean; force?: boolean } = {}): Promise<void> {
    const member = this.require(handle);
    this.standDown(handle, 'discharged');

    await removeWorktree({
      repoRoot: this.config.repoRoot,
      path: member.worktree,
      force: options.force ?? false,
      ...(options.deleteBranch ? { deleteBranch: member.branch } : {}),
    }).catch(() => {
      // A worktree the user already deleted by hand should not block cleanup.
      rmSync(member.worktree, { recursive: true, force: true });
    });

    this.events.append('member.exited', handle, { memberId: member.id, discharged: true });
  }
}
