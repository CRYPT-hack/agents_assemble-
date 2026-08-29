import { rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { resolveAgent } from '../agents/catalog.js';
import { writeBusConfig, type BusEndpoint } from '../agents/mcpConfig.js';
import { createWorktree, removeWorktree } from '../git/worktrees.js';
import { newId, nowIso } from '../ids.js';
import { assertHandle, assertRef, toHandle } from '../names.js';
import { invalid } from '../errors.js';
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

/** Statuses that imply a live process behind the member. */
const LIVE_STATUSES: ReadonlySet<MemberStatus> = new Set<MemberStatus>([
  'starting',
  'working',
  'waiting',
  'blocked',
  'review',
]);

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
    const stem = toHandle(agentId);
    if (!this.members.handleTaken(stem)) return stem;

    for (let n = 2; n < 1000; n += 1) {
      const candidate = `${stem}-${n}`;
      if (!this.members.handleTaken(candidate)) return candidate;
    }
    return `${stem}-${Date.now()}`;
  }

  async enlist(options: EnlistOptions): Promise<EnlistResult> {
    const spec = resolveAgent(options.agentId, {
      ...(this.config.agents?.[options.agentId] ?? {}),
      ...(options.spec ?? {}),
    });
    // A handle is not a label: it becomes a directory under the worktree root
    // and a branch under the prefix. Check it before either one is created.
    const handle = options.handle ? assertHandle(options.handle) : this.mintHandle(spec.id);
    const branch = assertRef(`${this.config.branchPrefix}${handle}`, 'branch');
    const base = assertRef(options.base ?? this.config.baseBranch, 'base branch');

    const root = resolve(this.config.worktreeRoot);
    const worktree = resolve(join(root, handle));

    // Belt and braces: even a handle that passed the pattern must land inside.
    const inside = relative(root, worktree);
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
      throw invalid(`A worktree for ${handle} would land outside the workspace`, { handle });
    }

    await createWorktree({ repoRoot: this.config.repoRoot, path: worktree, branch, base });

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

    let busConfigPath: string | undefined;

    try {
      // Two enlists racing for the same handle both cut a branch, but only one
      // can own it: the unique handle throws for the loser. Whatever went wrong
      // after the checkout, the checkout has to go back.
      this.members.insert(member);

      const endpoint: BusEndpoint = {
        command: this.launcher.command,
        args: this.launcher.args,
        handle,
        dbPath: this.launcher.dbPath,
      };
      busConfigPath = spec.speaksMcp ? writeBusConfig(spec, worktree, endpoint) : undefined;
    } catch (cause) {
      await removeWorktree({
        repoRoot: this.config.repoRoot,
        path: worktree,
        force: true,
        deleteBranch: branch,
      }).catch(() => rmSync(worktree, { recursive: true, force: true }));

      throw cause;
    }

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

  /**
   * Bring stored state back in line with reality after a restart.
   *
   * A workspace that was killed leaves members marked `working` whose processes
   * died with it, holding claims nobody will ever release and tasks nobody is
   * doing. Anything not actually running is stood down, its claims are freed and
   * its work returns to the backlog — reported once rather than per member, so
   * a restart does not flood the feed.
   */
  reconcile(runningHandles: string[] = []): Member[] {
    const running = new Set(runningHandles);
    const stale = this.members
      .list()
      .filter((member) => LIVE_STATUSES.has(member.status) && !running.has(member.handle));

    if (stale.length === 0) return [];

    let releasedLeases = 0;
    let returnedTasks = 0;

    for (const member of stale) {
      this.members.update(member.id, {
        status: 'stopped',
        note: 'workspace restarted without it',
        endedAt: nowIso(),
      });
      this.events.append('member.status', member.handle, {
        status: 'stopped',
        note: 'workspace restarted without it',
      });

      releasedLeases += this.leases.releaseAll(member.handle);
      returnedTasks += this.board.releaseFor(member.handle);
    }

    this.bus.announce(
      'workspace restarted',
      [
        `${stale.map((member) => member.handle).join(', ')} ${stale.length === 1 ? 'was' : 'were'} not running any more.`,
        releasedLeases > 0 ? `Freed ${releasedLeases} file claim(s).` : '',
        returnedTasks > 0 ? `Returned ${returnedTasks} task(s) to the backlog.` : '',
        'Their branches are untouched; start them again when you want them back.',
      ]
        .filter(Boolean)
        .join('\n'),
    );

    return stale;
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
