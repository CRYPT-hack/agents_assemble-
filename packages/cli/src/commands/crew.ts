import { AGENT_CATALOG, type Member } from '@assemble/core';

import { flagBool, flagString, type Parsed } from '../args.js';
import { attachHere, clientFor, NeedsDaemon, openHere } from '../context.js';
import { bold, dim, green, paintStatus, print, table, warn } from '../output.js';

interface MemberRow extends Member {
  running?: boolean;
  unread?: number;
}

/** `assemble add <agent>` — enlist an agent and, by default, start it. */
export async function addCommand(parsed: Parsed): Promise<number> {
  const agentId = parsed.positionals[0];
  if (!agentId) {
    warn(`Which agent? One of: ${AGENT_CATALOG.map((spec) => spec.id).join(', ')}`);
    return 2;
  }

  const start = flagBool(parsed.flags, 'start', true);
  const body = {
    agentId,
    mission: flagString(parsed.flags, 'mission', 'm') ?? '',
    ...(flagString(parsed.flags, 'handle') ? { handle: flagString(parsed.flags, 'handle') } : {}),
    ...(flagString(parsed.flags, 'base') ? { base: flagString(parsed.flags, 'base') } : {}),
    start,
  };

  const client = clientFor(parsed);

  if (await client.alive()) {
    const result = await client.post<{ member: Member; busConfig: string | null; started: boolean }>(
      '/api/members',
      body,
    );
    report(result.member, result.busConfig, result.started);
    return 0;
  }

  if (start) throw new NeedsDaemon('Starting an agent');

  // Without a daemon we can still cut the branch and prepare the worktree.
  const workspace = await openHere();
  try {
    const result = await workspace.crew.enlist({
      agentId,
      mission: body.mission,
      ...(body.handle ? { handle: body.handle } : {}),
      ...(body.base ? { base: body.base } : {}),
    });
    report(result.member, result.busConfigPath ?? null, false);
    return 0;
  } finally {
    workspace.close();
  }
}

function report(member: Member, busConfig: string | null, started: boolean): void {
  print(`${green('enlisted')} ${bold(member.handle)} ${dim(`(${member.agentId})`)}`);
  print(`  ${dim('branch')}    ${member.branch}`);
  print(`  ${dim('worktree')}  ${member.worktree}`);
  if (member.mission) print(`  ${dim('mission')}   ${member.mission}`);
  print(`  ${dim('bus')}       ${busConfig ?? 'not wired — this agent does not speak MCP'}`);
  if (!started) print(`  ${dim('state')}     created, not started`);
}

/** `assemble ls` — who is in the crew, and what are they doing. */
export async function listCommand(parsed: Parsed): Promise<number> {
  const client = clientFor(parsed);

  let members: MemberRow[];
  if (await client.alive()) {
    members = (await client.get<{ members: MemberRow[] }>('/api/members')).members;
  } else {
    const workspace = await attachHere();
    try {
      members = workspace.members.list().map((member) => ({
        ...member,
        unread: workspace.bus.unreadCount(member.handle),
      }));
    } finally {
      workspace.close();
    }
  }

  if (members.length === 0) {
    print(dim('Nobody enlisted yet. Try `assemble add claude --mission "..."`.'));
    return 0;
  }

  print(
    table(
      ['HANDLE', 'AGENT', 'STATUS', 'RUN', 'UNREAD', 'BRANCH', 'MISSION'],
      members.map((member) => [
        bold(member.handle),
        member.agentId,
        paintStatus(member.status),
        member.running === undefined ? dim('?') : member.running ? green('yes') : dim('no'),
        member.unread ? String(member.unread) : dim('0'),
        member.branch,
        member.mission || dim('—'),
      ]),
    ),
  );
  return 0;
}

/** `assemble stop <handle>` — end an agent's process, keep its branch. */
export async function stopCommand(parsed: Parsed): Promise<number> {
  const handle = parsed.positionals[0];
  if (!handle) {
    warn('Which member? `assemble stop claude`');
    return 2;
  }

  const client = clientFor(parsed);
  if (!(await client.alive())) throw new NeedsDaemon('Stopping an agent');

  await client.post(`/api/members/${encodeURIComponent(handle)}/stop`);
  print(`${green('stopped')} ${bold(handle)} ${dim('— its branch is still there')}`);
  return 0;
}

/** `assemble rm <handle>` — remove a member's worktree, and maybe its branch. */
export async function removeCommand(parsed: Parsed): Promise<number> {
  const handle = parsed.positionals[0];
  if (!handle) {
    warn('Which member? `assemble rm claude`');
    return 2;
  }

  const deleteBranch = flagBool(parsed.flags, 'delete-branch', false);
  const force = flagBool(parsed.flags, 'force', false);
  const query = `?deleteBranch=${deleteBranch}&force=${force}`;

  const client = clientFor(parsed);
  if (await client.alive()) {
    await client.del(`/api/members/${encodeURIComponent(handle)}${query}`);
  } else {
    const workspace = await openHere();
    try {
      await workspace.crew.discharge(handle, { deleteBranch, force });
    } finally {
      workspace.close();
    }
  }

  print(`${green('removed')} ${bold(handle)}${deleteBranch ? dim(' and its branch') : ''}`);
  return 0;
}

/** `assemble agents` — what can be enlisted. */
export function agentsCommand(): number {
  print(
    table(
      ['ID', 'AGENT', 'COMMAND', 'BUS'],
      AGENT_CATALOG.map((spec) => [
        bold(spec.id),
        spec.name,
        spec.command,
        spec.speaksMcp ? green('yes') : dim('no'),
      ]),
    ),
  );
  print();
  print(dim('Bus: whether the agent can use the coordination tools itself.'));
  return 0;
}
