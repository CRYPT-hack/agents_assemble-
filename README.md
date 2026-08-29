# Agents Assemble

One workspace where every coding agent you use works the same project, side by side — and talks to the others while it works.

Each agent gets its own git worktree, so nobody overwrites anybody. Each agent gets a mailbox, a shared task board, and file leases, so nobody duplicates work either.

> Status: early development. Interfaces will move.

## Why

Running several coding agents on one repo today means several terminals, several branches, and no way for the agents to know what the others are doing. They collide on the same files, redo each other's work, and you become the message bus.

Agents Assemble makes the workspace the coordination layer:

- **Isolated** — one git worktree and branch per agent, one shared object store.
- **Talking** — an agent-to-agent bus exposed over MCP: direct messages, broadcasts, replies.
- **Non-colliding** — advisory file leases; an agent declares intent before editing.
- **Shared plan** — one task board every agent reads from and writes to.
- **Watchable** — a live console with every agent's terminal, the message feed, and the board.

## Design

```
                 ┌──────────────────────────────────────┐
                 │           web console (UI)           │
                 │   terminals · feed · board · diffs   │
                 └────────────────┬─────────────────────┘
                                  │ HTTP + WebSocket
                 ┌────────────────┴─────────────────────┐
                 │               daemon                 │
                 │  sessions · PTY · events · REST/WS   │
                 └────────────────┬─────────────────────┘
                                  │
          ┌───────────────────────┴───────────────────────┐
          │                    core                       │
          │  store · worktrees · bus · leases · board     │
          └───────────────────────┬───────────────────────┘
                                  │ MCP (stdio / HTTP)
   ┌──────────────┬───────────────┼───────────────┬──────────────┐
   │   agent A    │    agent B    │    agent C    │   agent D    │
   │  worktree/A  │  worktree/B   │  worktree/C   │  worktree/D  │
   └──────────────┴───────────────┴───────────────┴──────────────┘
```

Any agent that speaks MCP joins the bus. Any agent with a command line can be supervised.

## Packages

| Package | What it holds |
| --- | --- |
| `@assemble/core` | Domain logic: state store, worktree manager, message bus, leases, task board |
| `@assemble/daemon` | Long-running process: PTY supervision, REST + WebSocket API |
| `@assemble/mcp` | MCP server that hands agents their coordination tools |
| `@assemble/cli` | `assemble` — init, spawn, attach, status |
| `@assemble/ui` | Web console |

## Requirements

- Node.js 24+
- Git 2.30+

## License

MIT
