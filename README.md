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
- **Watchable** — your own terminal becomes the workspace: a pane per agent, wired to the others by the messages actually passing between them. A browser console shows the same thing if you prefer one.

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

Then hand the terminal over:

```bash
assemble up
```

The screen becomes the workspace. Put agents on the job from the line at the bottom:

```
/add claude port the parser to the new token type
/add codex write the tests for the new parser
```

Each `/add` cuts a branch, checks out a worktree, wires the coordination tools into that agent's own MCP config, and starts it in its own pane. Both agents are now working the same project in parallel, and can reach each other. `/quit` stops them and gives the terminal back.

Everything is available as a plain command too, for scripts and for a second terminal: `assemble add claude --mission "..."`, `assemble ls`, `assemble feed`.

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

## The console

`assemble up` takes over the terminal you ran it in. Every agent becomes a pane, the panes are wired to a bus in the middle, and one line at the bottom drives all of them.

```
 ● ● ●  demo-repo                             4 crew   4 running   2 claims   1 open   COMMAND
──────────────────────────────────────────────────────────────────────────────────────────────
 ╭─●─●─●─ claude — claude — 63×13 ───────✉5 ●─╮           ╭─●─●─●─ codex — codex — 63×13 ──●─╮
 │ $ claim src/parser/**                      │           │ $ npm test                       │
 │ granted until 20:14                        │◀─       ─▶│   14 passing                     │
 │ rewriting the tokeniser…                   │ │       │ │                                  │
 │ port the parser to the new token type      │ │       │ │ write the tests for the parser   │
 ╰────────────────────────────────────────────╯ │       │ ╰──────────────────────────────────╯
                                                │ ╭─────╮│
                                                ┼─│ bus │┼
                                                │ ╰─────╯│
                                        parse(input): Token[] is settled
 ╭─●─●─●─ gemini — gemini — 63×13 ───────✉2 ●─╮ │       │ ╭─●─●─●─ aider — aider — 63×13 ──●─╮
```

Each pane is a real terminal — the agent's own output, cursor moves, colour and redraws, emulated and copied into the box. The wires are drawn from what the workspace actually knows: grey when quiet, phosphor with a travelling dot while two members are talking, red and dashed when two of them hold overlapping claims on the same files.

| You type | What happens |
| --- | --- |
| `npm test` | runs in the focused pane |
| `@codex lexer moved` | messages that agent |
| `@codex lexer moved -- see src/lexer.ts` | subject and body |
| `/all standup in five` | messages everyone working |
| `/task port the parser` | files work on the shared board |
| `/add claude write the tests` | enlists another agent, running |
| `/start <handle>`, `/stop <handle>` | control a member |
| `/quit` | stops the crew and gives the terminal back |

| Key | What it does |
| --- | --- |
| `ctrl-a` | attach your keyboard straight to the focused pane, for agents with their own UI |
| `ctrl-]` | detach again |
| `ctrl-n` / `ctrl-p` | next / previous pane |
| `tab` | complete a handle after `@`, or move focus |
| `↑` / `↓` | walk the command history |

It runs on the alternate screen, so quitting leaves your scrollback exactly as it was.

### In a browser instead

The same workspace is served at `http://127.0.0.1:4319` the whole time — a canvas of draggable terminal windows with the same wires, plus panels for the feed, the board, the claims and the event log. `assemble up --web` skips the terminal takeover and serves only that, which is what you want under a process manager.

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
| `@assemble/tui` | The terminal console: panes, wiring, command line |
| `@assemble/cli` | `assemble` — init, up, add, ls, send, tasks, doctor |
| `@assemble/ui` | Web console |

## What it will not do

A workspace runs programs and types into shells, so a few things are refused on principle:

- **Only the operator drives it.** The daemon answers loopback only, rejects requests carrying another site's `Origin` or a non-loopback `Host`, and requires the token from `.assemble/token`. A page you happen to have open cannot enlist an agent or type into one.
- **Names stay names.** A handle becomes a directory and a branch, so it is checked before either exists — `../` never leaves the worktree root, and a branch or base that starts with a dash is refused rather than handed to git as an option.
- **The log is not forgeable.** A message has to come from a real member or from the workspace itself; agents are identified by the process they were launched in, not by a field they can set.
- **A clone does not choose what runs.** If `.assemble/workspace.json` is committed to the repository, its agent definitions are ignored and the crew is told why — cloning a repository should never decide which binaries execute on your machine.

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
