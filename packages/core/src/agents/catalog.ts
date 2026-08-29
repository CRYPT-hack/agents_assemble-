import { AssembleError } from '../errors.js';
import type { AgentSpec } from '../types.js';

/**
 * Launch recipes for the coding agents people already run.
 *
 * These are defaults, not gospel: a workspace can override any field, or
 * register an agent that is not here at all, through `agents` in
 * `.assemble/workspace.json`. Everything below assumes the executable is on
 * PATH and already authenticated — Assemble never handles credentials.
 *
 * `speaksMcp` decides how a member joins the bus. True means the agent loads
 * the Assemble MCP server itself and gets tools. False means it still gets a
 * worktree and a terminal, and the human relays for it.
 */
export const AGENT_CATALOG: readonly AgentSpec[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    promptMode: 'argv',
    promptTemplate: '{{mission}}',
    speaksMcp: true,
    mcpConfig: { file: '.mcp.json', format: 'mcp-json' },
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    args: [],
    promptMode: 'argv',
    promptTemplate: '{{mission}}',
    speaksMcp: true,
    mcpConfig: { file: '.codex/config.toml', format: 'codex-toml' },
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: [],
    promptMode: 'argv',
    promptTemplate: '{{mission}}',
    speaksMcp: true,
    mcpConfig: { file: '.gemini/settings.json', format: 'gemini-settings' },
  },
  {
    id: 'cursor',
    name: 'Cursor Agent',
    command: 'cursor-agent',
    args: [],
    promptMode: 'argv',
    promptTemplate: '{{mission}}',
    speaksMcp: true,
    mcpConfig: { file: '.cursor/mcp.json', format: 'mcp-json' },
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: [],
    promptMode: 'argv',
    promptTemplate: '{{mission}}',
    speaksMcp: true,
    mcpConfig: { file: 'opencode.json', format: 'mcp-json' },
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    command: 'qwen',
    args: [],
    promptMode: 'argv',
    promptTemplate: '{{mission}}',
    speaksMcp: true,
    mcpConfig: { file: '.qwen/settings.json', format: 'gemini-settings' },
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    command: 'copilot',
    args: [],
    promptMode: 'argv',
    promptTemplate: '{{mission}}',
    speaksMcp: true,
    mcpConfig: { file: '.github/copilot/mcp.json', format: 'mcp-json' },
  },
  {
    id: 'aider',
    name: 'Aider',
    command: 'aider',
    args: [],
    promptMode: 'argv',
    promptTemplate: '{{mission}}',
    speaksMcp: false,
  },
  {
    id: 'amp',
    name: 'Amp',
    command: 'amp',
    args: [],
    promptMode: 'stdin',
    promptTemplate: '{{mission}}',
    speaksMcp: false,
  },
  {
    id: 'shell',
    name: 'Plain shell',
    command: process.platform === 'win32' ? 'powershell.exe' : (process.env['SHELL'] ?? 'bash'),
    args: [],
    promptMode: 'none',
    speaksMcp: false,
  },
];

const BY_ID = new Map(AGENT_CATALOG.map((spec) => [spec.id, spec]));

export function findAgent(id: string): AgentSpec | undefined {
  return BY_ID.get(id);
}

export function requireAgent(id: string): AgentSpec {
  const spec = BY_ID.get(id);
  if (!spec) {
    throw new AssembleError('unknown_agent', `No agent named ${id}`, {
      id,
      known: [...BY_ID.keys()],
    });
  }
  return spec;
}

export function agentIds(): string[] {
  return [...BY_ID.keys()];
}

/** Merge user overrides onto a catalog entry, or build a wholly custom spec. */
export function resolveAgent(id: string, overrides: Partial<AgentSpec> = {}): AgentSpec {
  const base = findAgent(id);
  if (!base) {
    if (!overrides.command) {
      throw new AssembleError('unknown_agent', `Agent ${id} is not in the catalog and defines no command`, {
        id,
      });
    }
    return {
      id,
      name: overrides.name ?? id,
      command: overrides.command,
      args: overrides.args ?? [],
      promptMode: overrides.promptMode ?? 'argv',
      speaksMcp: overrides.speaksMcp ?? false,
      ...(overrides.env ? { env: overrides.env } : {}),
      ...(overrides.promptTemplate ? { promptTemplate: overrides.promptTemplate } : {}),
      ...(overrides.mcpConfig ? { mcpConfig: overrides.mcpConfig } : {}),
    };
  }
  return { ...base, ...overrides, id };
}

/** Render an agent's prompt template against a mission. */
export function renderPrompt(spec: AgentSpec, mission: string): string {
  const template = spec.promptTemplate ?? '{{mission}}';
  return template.replaceAll('{{mission}}', mission);
}
