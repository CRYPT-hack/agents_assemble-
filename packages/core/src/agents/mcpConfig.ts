import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { AgentSpec } from '../types.js';

/** How a member reaches the bus: a command to spawn, plus its identity. */
export interface BusEndpoint {
  /** Executable the agent should run to get the Assemble MCP server. */
  command: string;
  args: string[];
  /** Handle the server should authenticate this member as. */
  handle: string;
  /** Absolute path of the workspace database the server talks to. */
  dbPath: string;
}

const SERVER_KEY = 'assemble';

function envFor(endpoint: BusEndpoint): Record<string, string> {
  return {
    ASSEMBLE_HANDLE: endpoint.handle,
    ASSEMBLE_DB: endpoint.dbPath,
  };
}

/** `.mcp.json`-style: `{ "mcpServers": { name: { command, args, env } } }`. */
function renderMcpJson(existing: string | undefined, endpoint: BusEndpoint): string {
  const doc = parseJson(existing);
  const servers = (doc['mcpServers'] as Record<string, unknown> | undefined) ?? {};
  servers[SERVER_KEY] = {
    command: endpoint.command,
    args: endpoint.args,
    env: envFor(endpoint),
  };
  doc['mcpServers'] = servers;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Gemini-style settings files use the same key, nested in a larger document. */
function renderGeminiSettings(existing: string | undefined, endpoint: BusEndpoint): string {
  return renderMcpJson(existing, endpoint);
}

/**
 * Codex reads TOML. The block is appended rather than merged: a hand-written
 * config keeps whatever else it holds, and re-running replaces only our table.
 */
function renderCodexToml(existing: string | undefined, endpoint: BusEndpoint): string {
  const marker = `[mcp_servers.${SERVER_KEY}]`;
  const env = Object.entries(envFor(endpoint))
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .join(', ');

  const block = [
    marker,
    `command = ${JSON.stringify(endpoint.command)}`,
    `args = ${JSON.stringify(endpoint.args)}`,
    `env = { ${env} }`,
    '',
  ].join('\n');

  if (!existing) return `${block}`;

  const start = existing.indexOf(marker);
  if (start === -1) return `${existing.trimEnd()}\n\n${block}`;

  // Replace from our table header up to the next table header.
  const rest = existing.slice(start + marker.length);
  const nextTable = rest.search(/\n\[/);
  const end = nextTable === -1 ? existing.length : start + marker.length + nextTable + 1;
  return `${existing.slice(0, start)}${block}${existing.slice(end)}`;
}

function parseJson(text: string | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Write the bus into an agent's own config inside its worktree, so the agent
 * picks the coordination tools up on launch without anyone editing global
 * settings. Returns the file written, or `undefined` when the agent has no
 * config target — plenty of agents simply do not speak MCP.
 */
export function writeBusConfig(spec: AgentSpec, worktree: string, endpoint: BusEndpoint): string | undefined {
  if (!spec.mcpConfig) return undefined;

  const target = join(worktree, spec.mcpConfig.file);
  mkdirSync(dirname(target), { recursive: true });

  let existing: string | undefined;
  try {
    existing = readFileSync(target, 'utf8');
  } catch {
    existing = undefined;
  }

  const contents =
    spec.mcpConfig.format === 'codex-toml'
      ? renderCodexToml(existing, endpoint)
      : spec.mcpConfig.format === 'gemini-settings'
        ? renderGeminiSettings(existing, endpoint)
        : renderMcpJson(existing, endpoint);

  writeFileSync(target, contents, 'utf8');
  return target;
}
