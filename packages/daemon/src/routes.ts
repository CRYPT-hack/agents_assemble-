import {
  AGENT_CATALOG,
  AssembleError,
  changedFiles,
  status as gitStatus,
  type MessagePriority,
  type TaskStatus,
  type Workspace,
} from '@assemble/core';

import { Router, sendJson } from './http.js';
import type { Runtime } from './runtime.js';
import { ptyAvailable } from './terminal.js';

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function strArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

function required(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AssembleError('invalid', `${key} is required`);
  }
  return value;
}

/**
 * The daemon's HTTP surface.
 *
 * Everything the console does — and everything a script could want to automate —
 * goes through these routes. Agents do not use them; agents use the MCP server.
 */
export function buildRouter(workspace: Workspace, runtime: Runtime): Router {
  const router = new Router();

  router.get('/api/health', async (_request, response) => {
    sendJson(response, 200, {
      ok: true,
      workspace: workspace.config.name,
      pty: await ptyAvailable(),
      running: runtime.handles(),
    });
  });

  router.get('/api/workspace', (_request, response) => {
    sendJson(response, 200, { ...workspace.snapshot(), running: runtime.handles() });
  });

  router.get('/api/agents', (_request, response) => {
    sendJson(response, 200, {
      agents: AGENT_CATALOG.map((spec) => ({
        id: spec.id,
        name: spec.name,
        command: spec.command,
        speaksMcp: spec.speaksMcp,
      })),
    });
  });

  // -- members -------------------------------------------------------------

  router.get('/api/members', (_request, response) => {
    const members = workspace.crew.list().map((member) => ({
      ...member,
      running: runtime.isRunning(member.handle),
      unread: workspace.bus.unreadCount(member.handle),
    }));
    sendJson(response, 200, { members });
  });

  router.post('/api/members', async (_request, response, { body }) => {
    const result = await workspace.crew.enlist({
      agentId: required(body, 'agentId'),
      mission: str(body['mission']),
      ...(typeof body['handle'] === 'string' ? { handle: body['handle'] } : {}),
      ...(typeof body['base'] === 'string' ? { base: body['base'] } : {}),
    });

    const start = body['start'] !== false;
    if (start) await runtime.start(result.member.handle);

    sendJson(response, 201, {
      member: workspace.crew.require(result.member.handle),
      agent: result.spec.id,
      busConfig: result.busConfigPath ?? null,
      started: start,
    });
  });

  router.post('/api/members/:handle/start', async (_request, response, { params, body }) => {
    const member = await runtime.start(params['handle'] as string, {
      ...(typeof body['mission'] === 'string' ? { mission: body['mission'] } : {}),
      ...(strArray(body['args']) ? { args: strArray(body['args']) as string[] } : {}),
    });
    sendJson(response, 200, { member });
  });

  router.post('/api/members/:handle/stop', (_request, response, { params }) => {
    runtime.stop(params['handle'] as string);
    sendJson(response, 200, { member: workspace.crew.require(params['handle'] as string) });
  });

  router.post('/api/members/:handle/input', (_request, response, { params, body }) => {
    runtime.write(params['handle'] as string, required(body, 'data'));
    sendJson(response, 202, { ok: true });
  });

  router.get('/api/members/:handle/scrollback', (_request, response, { params }) => {
    sendJson(response, 200, { scrollback: runtime.scrollback(params['handle'] as string) });
  });

  router.get('/api/members/:handle/diff', async (_request, response, { params }) => {
    const member = workspace.crew.require(params['handle'] as string);
    const [state, files] = await Promise.all([
      gitStatus(member.worktree),
      changedFiles(member.worktree, workspace.config.baseBranch).catch(() => [] as string[]),
    ]);
    sendJson(response, 200, { branch: member.branch, status: state, changed: files });
  });

  router.delete('/api/members/:handle', async (_request, response, { params, query }) => {
    await workspace.crew.discharge(params['handle'] as string, {
      deleteBranch: query.get('deleteBranch') === 'true',
      force: query.get('force') === 'true',
    });
    sendJson(response, 200, { ok: true });
  });

  // -- messages ------------------------------------------------------------

  router.get('/api/messages', (_request, response, { query }) => {
    const limit = Number(query.get('limit') ?? 100);
    sendJson(response, 200, { messages: workspace.bus.recent(Number.isFinite(limit) ? limit : 100) });
  });

  router.post('/api/messages', (_request, response, { body }) => {
    const message = workspace.bus.send({
      from: str(body['from'], 'workspace'),
      subject: required(body, 'subject'),
      body: str(body['body']),
      ...(strArray(body['to']) ? { to: strArray(body['to']) as string[] } : {}),
      ...(typeof body['channel'] === 'string' ? { channel: body['channel'] } : {}),
      ...(typeof body['priority'] === 'string'
        ? { priority: body['priority'] as MessagePriority }
        : {}),
    });
    sendJson(response, 201, { message });
  });

  router.get('/api/threads/:threadId', (_request, response, { params }) => {
    sendJson(response, 200, { messages: workspace.bus.thread(params['threadId'] as string) });
  });

  // -- board ---------------------------------------------------------------

  router.get('/api/tasks', (_request, response, { query }) => {
    const status = query.get('status');
    sendJson(response, 200, {
      tasks: workspace.board.list({ ...(status ? { status: status as TaskStatus } : {}) }),
      counts: workspace.board.counts(),
    });
  });

  router.post('/api/tasks', (_request, response, { body }) => {
    const task = workspace.board.create({
      title: required(body, 'title'),
      body: str(body['body']),
      createdBy: str(body['createdBy'], 'workspace'),
      ...(typeof body['assignee'] === 'string' ? { assignee: body['assignee'] } : {}),
      ...(strArray(body['dependsOn']) ? { dependsOn: strArray(body['dependsOn']) as string[] } : {}),
      ...(strArray(body['labels']) ? { labels: strArray(body['labels']) as string[] } : {}),
    });
    sendJson(response, 201, { task });
  });

  router.patch('/api/tasks/:id', (_request, response, { params, body }) => {
    const id = params['id'] as string;
    const actor = str(body['actor'], 'workspace');

    if (typeof body['assignee'] === 'string' || body['assignee'] === null) {
      const assignee = typeof body['assignee'] === 'string' ? body['assignee'] : undefined;
      sendJson(response, 200, { task: workspace.board.reassign(id, actor, assignee) });
      return;
    }

    const task = workspace.board.transition(
      id,
      actor,
      required(body, 'status') as TaskStatus,
      typeof body['note'] === 'string' ? body['note'] : undefined,
    );
    sendJson(response, 200, { task });
  });

  // -- leases and events ---------------------------------------------------

  router.get('/api/leases', (_request, response) => {
    sendJson(response, 200, { leases: workspace.leases.active() });
  });

  router.get('/api/events', (_request, response, { query }) => {
    const since = Number(query.get('since') ?? 0);
    sendJson(response, 200, {
      events: workspace.events.since(Number.isFinite(since) ? since : 0, 500),
      seq: workspace.events.latestSeq(),
    });
  });

  return router;
}
