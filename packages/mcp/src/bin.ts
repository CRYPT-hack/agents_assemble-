#!/usr/bin/env node
import { quietSqliteWarning } from '@assemble/core';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { IdentityError, resolveIdentity } from './identity.js';
import { createServer } from './server.js';

/**
 * Entry point the agents themselves run. Nothing may be written to stdout that
 * is not MCP protocol traffic — diagnostics go to stderr.
 */
quietSqliteWarning();

async function main(): Promise<void> {
  const identity = resolveIdentity();
  const { server, close } = createServer(identity);

  const shutdown = (): void => {
    close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(new StdioServerTransport());
  process.stderr.write(`assemble: ${identity.handle} joined the bus\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`assemble-mcp: ${message}\n`);
  process.exit(error instanceof IdentityError ? 2 : 1);
});
