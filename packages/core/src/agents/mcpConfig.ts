import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { AgentSpec, McpConfigTarget } from '../types.js';

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

function parseJson(text: string | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
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
 * OpenCode keeps servers under `mcp`, not `mcpServers`, and wants the command
 * and its arguments in one array. Writing the `mcpServers` shape into
 * `opencode.json` parses fine and is silently ignored, which is why this needs
 * its own writer rather than reusing `mcp-json`.
 */
function renderOpencodeJson(existing: string | undefined, endpoint: BusEndpoint): string {
  const doc = parseJson(existing);
  const servers = (doc['mcp'] as Record<string, unknown> | undefined) ?? {};
  servers[SERVER_KEY] = {
    type: 'local',
    command: [endpoint.command, ...endpoint.args],
    enabled: true,
    environment: envFor(endpoint),
  };
  doc['mcp'] = servers;
  doc['$schema'] ??= 'https://opencode.ai/config.json';
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Crush keeps servers under `mcp`, with the executable and args kept apart. */
function renderCrushJson(existing: string | undefined, endpoint: BusEndpoint): string {
  const doc = parseJson(existing);
  const servers = (doc['mcp'] as Record<string, unknown> | undefined) ?? {};
  servers[SERVER_KEY] = {
    type: 'stdio',
    command: endpoint.command,
    args: endpoint.args,
    env: envFor(endpoint),
  };
  doc['mcp'] = servers;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Double-quoted scalars are valid YAML and need no escaping rules of their own. */
function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

/**
 * Goose reads YAML, and extensions are MCP servers. There is no YAML parser in
 * the dependency tree, so the block is spliced by indentation instead: the
 * `assemble` key is replaced under a top-level `extensions:` map and anything
 * else in the file is left untouched.
 */
function renderGooseYaml(existing: string | undefined, endpoint: BusEndpoint): string {
  const block = gooseBlock(endpoint);
  const lines = (existing ?? '').split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();

  const extensions = lines.findIndex((line) => /^extensions:\s*$/.test(line));

  if (extensions === -1) {
    const prefix = lines.length > 0 ? [...lines, ''] : [];
    return [...prefix, 'extensions:', ...block, ''].join('\n');
  }

  let start = -1;
  for (let i = extensions + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\S/.test(line)) break;
    if (/^ {2}assemble:\s*$/.test(line)) {
      start = i;
      break;
    }
  }

  if (start === -1) {
    const head = lines.slice(0, extensions + 1);
    const tail = lines.slice(extensions + 1);
    return [...head, ...block, ...tail, ''].join('\n');
  }

  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] ?? '';
    if (line.trim() === '') {
      end++;
      continue;
    }
    if (line.length - line.trimStart().length <= 2) break;
    end++;
  }

  return [...lines.slice(0, start), ...block, ...lines.slice(end), ''].join('\n');
}

function gooseBlock(endpoint: BusEndpoint): string[] {
  const block = [
    '  assemble:',
    '    enabled: true',
    '    type: stdio',
    '    name: assemble',
    `    cmd: ${yamlScalar(endpoint.command)}`,
  ];

  if (endpoint.args.length === 0) {
    block.push('    args: []');
  } else {
    block.push('    args:');
    for (const arg of endpoint.args) block.push(`      - ${yamlScalar(arg)}`);
  }

  block.push('    envs:');
  for (const [key, value] of Object.entries(envFor(endpoint))) {
    block.push(`      ${key}: ${yamlScalar(value)}`);
  }
  block.push('    timeout: 300');

  return block;
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

function renderFor(
  format: McpConfigTarget['format'],
  existing: string | undefined,
  endpoint: BusEndpoint,
): string {
  switch (format) {
    case 'codex-toml':
      return renderCodexToml(existing, endpoint);
    case 'gemini-settings':
      return renderGeminiSettings(existing, endpoint);
    case 'opencode-json':
      return renderOpencodeJson(existing, endpoint);
    case 'crush-json':
      return renderCrushJson(existing, endpoint);
    case 'goose-yaml':
      return renderGooseYaml(existing, endpoint);
    case 'mcp-json':
      return renderMcpJson(existing, endpoint);
  }
}

/**
 * Write the bus into an agent's own config inside its worktree, so the agent
 * picks the coordination tools up on launch without anyone editing global
 * settings. Returns the file written, or `undefined` when the agent has no
 * config target — plenty of agents simply do not speak MCP.
 */
export function writeBusConfig(
  spec: AgentSpec,
  worktree: string,
  endpoint: BusEndpoint,
): string | undefined {
  if (!spec.mcpConfig) return undefined;

  const target = join(worktree, spec.mcpConfig.file);
  mkdirSync(dirname(target), { recursive: true });

  let existing: string | undefined;
  try {
    existing = readFileSync(target, 'utf8');
  } catch {
    existing = undefined;
  }

  writeFileSync(target, renderFor(spec.mcpConfig.format, existing, endpoint), 'utf8');
  return target;
}
