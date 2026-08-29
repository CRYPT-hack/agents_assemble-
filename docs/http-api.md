# HTTP API

The daemon's surface, used by the console and available to any script. It listens on `127.0.0.1:4319` by default; `assemble up --port <n>` moves it.

Agents do not use this API — they use the [coordination tools](tools.md). This is the operator's side.

## Workspace

| Method | Path | Returns |
| --- | --- | --- |
| `GET` | `/api/health` | `{ ok, workspace, pty, running }` — `pty` says whether agents get a real terminal |
| `GET` | `/api/workspace` | Config, roster, task counts, active claim count, event sequence |
| `GET` | `/api/agents` | The agent catalog this build knows |

## Members

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/members` | | Every member, with `running` and `unread` |
| `POST` | `/api/members` | `{ agentId, mission?, handle?, base?, start? }` | The enlisted member, the config file written, whether it started |
| `POST` | `/api/members/:handle/start` | `{ mission?, args? }` | The member, now running |
| `POST` | `/api/members/:handle/stop` | | The member, stood down; its branch is untouched |
| `POST` | `/api/members/:handle/input` | `{ data }` | Types into that member's terminal |
| `GET` | `/api/members/:handle/scrollback` | | What the daemon has buffered of its output |
| `GET` | `/api/members/:handle/diff` | | Branch, working-tree status, files changed against the base branch |
| `DELETE` | `/api/members/:handle` | `?deleteBranch=true&force=true` | Removes the worktree |

`start` defaults to `true` on `POST /api/members`. Pass `false` to prepare a branch and worktree without launching anything.

## Messages

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/messages` | `?limit=100` | Recent traffic, newest first |
| `POST` | `/api/messages` | `{ from?, to?, channel?, subject, body?, priority? }` | The message. `from` defaults to `workspace`, and must name a real member or the workspace itself |
| `GET` | `/api/threads/:threadId` | | One conversation, oldest first |

## Board

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/tasks` | `?status=` | Tasks and counts by status |
| `POST` | `/api/tasks` | `{ title, body?, createdBy?, assignee?, dependsOn?, labels? }` | The task |
| `PATCH` | `/api/tasks/:id` | `{ actor?, status, note? }` or `{ actor?, assignee }` | The task |

## Claims and events

| Method | Path | Query | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/leases` | | Every live claim |
| `GET` | `/api/events` | `?since=<seq>` | Events after that sequence number, plus the latest |

`since=0` replays from the beginning, which is how a console that dropped off catches up without re-reading the world.

## WebSocket

Connect to `/ws`. The daemon opens with a snapshot and then streams.

Down the socket:

| Message | Meaning |
| --- | --- |
| `{ type: 'hello', snapshot, seq }` | Sent on connect |
| `{ type: 'event', event }` | Something happened in the workspace |
| `{ type: 'output', handle, chunk }` | Terminal output, for attached members only |
| `{ type: 'scrollback', handle, data }` | Buffered output, sent when you attach |
| `{ type: 'error', message }` | A client message could not be handled |

Up the socket:

| Message | Meaning |
| --- | --- |
| `{ type: 'attach', handle }` | Start receiving that member's terminal |
| `{ type: 'detach', handle }` | Stop |
| `{ type: 'input', handle, data }` | Type into it |
| `{ type: 'resize', handle, cols, rows }` | Resize its terminal |

Events reaching the socket are read from the workspace database rather than from the daemon's own memory, because most of them are written by the agents' MCP processes rather than by the daemon.

## Errors

Every failure is JSON:

```json
{ "error": { "code": "not_running", "message": "claude is not running", "details": { "handle": "claude" } } }
```

| Code | Status |
| --- | --- |
| `invalid` | 400 |
| `not_found`, `unknown_agent`, `unknown_member` | 404 |
| `conflict`, `lease_conflict`, `not_running` | 409 |
| `git_failed`, `spawn_failed` | 500 |

## Getting in

The daemon can start processes, type into running shells and read the repository, so reaching it takes more than knowing the port. Every request — REST and WebSocket alike — passes three checks:

| Check | Why |
| --- | --- |
| `Host` names loopback | A DNS rebinding attack points a hostile domain at 127.0.0.1, but the browser still sends that domain here |
| `Origin`, when sent, is this daemon | Browsers always send it cross-origin, which makes this the CSRF check |
| A valid workspace token | So that a local program cannot drive your agents just by finding the port |

The token lives at `.assemble/token` inside the repository, owner-readable, created on first start.

- **The console** is served with the token baked into its page. A hostile site cannot read a cross-origin response, so it cannot steal it that way.
- **The CLI** reads the file, which is why `assemble ls` needs no configuration.
- **Anything else** sends it as `x-assemble-token`, or as `?token=` where headers are not available — a browser WebSocket, for instance.

```bash
curl -H "x-assemble-token: $(cat .assemble/token)" http://127.0.0.1:4319/api/members
```

Failures are explicit: `401` for a missing or wrong token, `403` for a request from another origin or addressed to a name that is not loopback.

The daemon still binds to loopback only. None of this makes it safe to expose publicly, and it is not meant to be.
