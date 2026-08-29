# Architecture

Four layers, each with one job.

```
console  →  daemon  →  core  ←  mcp  ←  agents
```

The console and the agents never touch each other. Both go through the workspace, and the workspace is a file.

## The workspace is a SQLite file

Everything lives in `.assemble/` at the root of the repository being worked on:

```
.assemble/
  workspace.json     configuration
  workspace.db       members, messages, deliveries, leases, tasks, events
  worktrees/         one checkout per member
```

`.assemble/` is added to `.git/info/exclude`, which is local to the clone, so the workspace never appears in the user's own `.gitignore` or in a commit.

One file, several processes: the daemon writes, each agent's MCP server writes, the CLI reads. WAL mode and a busy timeout cover the overlap. That choice is what makes the rest simple — there is no broker to run, no port to agree on, and a crashed daemon rehydrates the entire crew on restart because nothing important was ever only in memory.

`node:sqlite` is used rather than a native driver, so installing never depends on a compiler being present.

## Layer by layer

### `@assemble/core` — the domain

No servers, no processes. Stores wrap tables; services wrap policy.

| Piece | Responsibility |
| --- | --- |
| `store/` | One class per table, hydrating rows into domain types |
| `git/` | Running git, reading repository state, creating and removing worktrees |
| `services/Bus` | Messages, delivery, inboxes, threads, channels |
| `services/Leases` | Advisory claims over path patterns, and conflict detection |
| `services/Board` | The shared task list, with claims that only one member can win |
| `services/Crew` | Enlisting a member: branch, worktree, bus config, announcement |
| `Workspace` | Opens the database and wires the above together |

Two entry points, deliberately different:

- `Workspace.open({ cwd })` discovers the repository from a path. The daemon and the CLI use it.
- `attachWorkspace({ dbPath })` skips discovery entirely. The MCP server uses it, because it runs *inside a member's worktree* — where `git rev-parse` would answer with the worktree, not the project.

### `@assemble/daemon` — the runtime

Owns the agent processes and the network surface.

- `Runtime` starts one child process per member, in that member's worktree, with `ASSEMBLE_HANDLE` and `ASSEMBLE_DB` in its environment. Output goes to a bounded ring buffer so a console that connects late still sees context.
- `terminal.ts` uses node-pty when it is available and falls back to pipes when it is not. node-pty is an optional dependency: a machine that cannot build it still runs agents, just without a real TTY.
- `routes.ts` is the REST API. `sockets.ts` is the WebSocket: workspace events plus raw terminal streams.

Events reaching the console are **read back out of the database**, not taken from the runtime. Most of them were not written by the daemon at all — they were written by the agents' own MCP processes. Polling the event log is what lets the console watch agents talk to each other.

### `@assemble/mcp` — the agents' end

One server process per member, launched by the daemon, speaking stdio.

Identity arrives with the process, not in a tool call: `ASSEMBLE_HANDLE` is written into the agent's own MCP config when it is enlisted. An agent cannot claim to be another member by asking, and every entry in the event log names who actually did it.

Tool replies are JSON, so an agent branches on a result instead of parsing prose. A refused claim comes back with the holder, their reason, and which patterns collided.

### `@assemble/ui` — the console

React, one WebSocket. Workspace events drive React state; terminal output does not — it is pushed straight to the xterm instance that is listening, because re-rendering on every chunk of agent output would make the page crawl.

## Isolation model

Each member gets `git worktree add -b <prefix><handle> <path> <base>`: a new branch, a separate working directory, the same object store. Two agents editing the same file in their own worktrees cannot corrupt each other's index, and merging is an ordinary git problem you already know how to solve.

What worktrees do *not* solve is duplicated effort — two agents rewriting the same module in parallel, both correct, both wasted. That is what leases and the board are for.

## Leases are advisory on purpose

A lease is a declaration, not a lock. Nothing prevents an agent from editing a file it did not claim; the filesystem is untouched. What the workspace guarantees is an answer to "who else is in here", which is the question that actually prevents the collision.

Conflict detection over glob patterns errs toward saying yes. A false conflict costs one agent a short wait. A missed conflict costs two agents the same file.

## Failure

- A member's process exits → its leases are released, its claimed tasks return to the backlog, the crew is told, and its branch is left alone for review.
- The daemon exits → agents stop with it; nothing is lost, because state was in the database all along.
- An agent stops calling `check_inbox` → its mail waits. Delivery is per recipient, so one silent member does not block anyone else.
