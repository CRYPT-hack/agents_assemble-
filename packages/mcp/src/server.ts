import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { attachWorkspace, type AttachedWorkspace } from '@assemble/core';

import type { Identity } from './identity.js';
import { registerTools } from './tools.js';

export interface AssembleMcpServer {
  server: McpServer;
  workspace: AttachedWorkspace;
  close(): void;
}

/**
 * Build the MCP server one member speaks through.
 *
 * Every tool call is attributed to the handle this process was launched with,
 * so the workspace log is a record of who actually said what.
 */
export function createServer(identity: Identity): AssembleMcpServer {
  const workspace = attachWorkspace({ dbPath: identity.dbPath });

  const server = new McpServer(
    { name: 'assemble', version: '0.1.0' },
    {
      instructions: [
        `You are "${identity.handle}", one of several coding agents working this repository at the same time.`,
        '',
        'Each of you has a separate worktree, so you cannot see the others\' edits until they land.',
        'The tools on this server are how you stay out of each other\'s way:',
        '',
        '- Call whos_here once at the start so you know who else is working.',
        '- Call claim_files before editing, and release_files when done.',
        '- Call check_inbox between steps; other members may be waiting on you.',
        '- Take work with claim_task rather than assuming it is yours.',
        '- Say so with set_my_status and send_message when you are blocked.',
      ].join('\n'),
    },
  );

  registerTools(server, workspace, identity);

  return {
    server,
    workspace,
    close: () => {
      workspace.close();
    },
  };
}
