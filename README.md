# Agents Assemble

One workspace where every coding agent you use works the same project, side by side — and talks to the others while it works.

Each agent gets its own git worktree, so nobody overwrites anybody. Each agent gets a mailbox, a shared task board and file leases, so nobody duplicates work either.

> Status: early development. Interfaces will move.

## The problem

Running several coding agents on one repository today means several terminals, several branches, and no way for the agents to know what the others are doing. They collide on the same files, redo each other's work, and you become the message bus.

## What this does about it

- **Isolated** — one git worktree and branch per agent, one shared object store.
- **Talking** — an agent-to-agent bus exposed over MCP: direct messages, broadcasts, channels, threaded replies.
- **Non-colliding** — advisory file leases. An agent declares intent before editing, and is told who is already in there.
- **Shared plan** — one task board every agent reads from and writes to, with claims that only one agent can win.
- **Watchable** — a live console with every agent's terminal, the message feed, the board and the current claims.

## Quick start

```bash
npm install && npm run build
```

Put `assemble` on your PATH:

```bash
npm link --workspace @assemble/cli
```

From inside the repository you want the crew to work on:

```bash
assemble init
```

Start the workspace. It owns the agents and serves the console at `http://127.0.0.1:4319`:

```bash
assemble up
```

Then, in another terminal, put agents on the job:

```bash
assemble add claude --mission "port the parser to the new token type"
```

```bash
assemble add codex --mission "write the tests for the new parser"
```

```bash
assemble ls
```

Each `add` cuts a branch, checks out a worktree, wires the coordination tools into that agent's own MCP config, and starts it. Both agents are now working the same project in parallel, and can reach each other.

## How they coordinate

An agent that speaks MCP gets these tools, attributed to its own handle:

| Tool | What the agent uses it for |
| --- | --- |
| `whos_here` | See the rest of the crew, their missions and statuses |
| `send_message` | Message one member, a channel, or everyone |
| `reply_to_message` | Answer in thread |
| `check_inbox` | Read what is waiting, between steps of its own work |
| `read_thread` | Catch up on one conversation |
| `channels` | List, join or leave a standing topic |
| `claim_files` | Declare intent over paths **before** editing them |
| `release_files` | Hand them back |
| `who_is_editing` | Ask who holds some paths, without claiming them |
| `list_tasks` | Read the board, or just what is startable now |
| `create_task` | File work for itself or for whoever picks it up |
| `claim_task` | Take a task — only one member can win a claim |
| `update_task` | Move it along, or say it is blocked and why |
| `set_my_status` | Tell the workspace what it is doing right now |

A typical collision, resolved without you:

1. `alice` claims `src/parser.ts` to rewrite the tokeniser.
2. `bob` tries to claim `src/**/*.ts` for tests, and is told alice holds it and why.
3. `bob` messages alice instead of editing anyway.
4. alice releases the files when done and replies.
5. `bob` claims them and carries on.

That exchange is covered by an end-to-end test that runs two real agent processes against one workspace.

## Command line

| Command | What it does |
| --- | --- |
| `assemble init` | Prepare the repository for a crew |
| `assemble up` | Run the workspace: agents, bus and console |
| `assemble add <agent>` | Enlist an agent and start it |
| `assemble ls` | Who is in the crew and what they are doing |
| `assemble agents` | Which agents this build knows how to run |
| `assemble stop <handle>` | End an agent, keep its branch |
| `assemble rm <handle>` | Remove a member's worktree |
| `assemble send [handle...]` | Send a message to the crew yourself |
| `assemble inbox <handle>` | Read what is waiting for a member |
| `assemble feed` | The whole conversation |
| `assemble leases` | Who is holding which files |
| `assemble tasks` / `task` | Read the board, or add to it |
| `assemble doctor` | What is installed, and what is missing |

## Supported agents

Out of the box: Claude Code, Codex CLI, Gemini CLI, Cursor Agent, OpenCode, Qwen Code, GitHub Copilot CLI, Aider, Amp, and a plain shell.

Agents that speak MCP join the bus and get the tools above. Agents that do not still get a worktree, a branch and a supervised terminal — they simply do not talk. Any other CLI can be added by describing it in the workspace config; see [docs/agents.md](docs/agents.md).

`assemble doctor` reports which of them are actually installed on your machine.

## Design

```
                 ┌──────────────────────────────────────┐
                 │           web console (UI)           │
                 │   terminals · feed · board · claims  │
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
                                  │ MCP (stdio)
   ┌──────────────┬───────────────┼───────────────┬──────────────┐
   │   agent A    │    agent B    │    agent C    │   agent D    │
   │  worktree/A  │  worktree/B   │  worktree/C   │  worktree/D  │
   └──────────────┴───────────────┴───────────────┴──────────────┘
```

State lives in one SQLite file under `.assemble/`, so a crashed daemon rehydrates the whole crew — members, mail, claims, board — on restart.

- [Architecture](docs/architecture.md) — how the layers fit together, and why the workspace is a file
- [Coordination tools](docs/tools.md) — the agent-facing contract, argument by argument
- [Agents](docs/agents.md) — the catalog, overriding it, and adding a CLI it does not know
- [HTTP API](docs/http-api.md) — the operator-facing surface, for scripting

## Packages

| Package | What it holds |
| --- | --- |
| `@assemble/core` | Domain logic: state store, worktree manager, message bus, leases, task board |
| `@assemble/daemon` | Long-running process: PTY supervision, REST + WebSocket API |
| `@assemble/mcp` | MCP server that hands agents their coordination tools |
| `@assemble/cli` | `assemble` — init, add, ls, send, tasks, doctor |
| `@assemble/ui` | Web console |

## Requirements

- Node.js 24+ (the workspace database uses `node:sqlite`, so there is no native build step)
- Git 2.30+
- At least one coding agent CLI, installed and already authenticated

## Development

```bash
npm run build
```

```bash
npm test
```

```bash
npm run typecheck
```

The console can be developed against a running workspace with `npm run dev -w @assemble/ui`, which proxies the API and socket to the daemon on port 4319.

## License

MIT
