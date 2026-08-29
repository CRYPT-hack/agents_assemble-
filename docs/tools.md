# Coordination tools

The tools an agent gets when it joins the bus. Every call is attributed to the handle its process was launched with, and every reply is JSON.

## Identity

The daemon writes two variables into the agent's own MCP config when the member is enlisted:

| Variable | Meaning |
| --- | --- |
| `ASSEMBLE_HANDLE` | Which member this process is |
| `ASSEMBLE_DB` | Which workspace database to join |

An agent cannot claim to be someone else by passing a different handle in a tool call — there is no such parameter.

## Knowing who is here

### `whos_here`

No arguments. Returns the caller's own handle and the whole crew:

```json
{
  "me": "alice",
  "members": [
    { "handle": "alice", "agentId": "claude", "status": "working", "mission": "port the parser", "unread": 0 },
    { "handle": "bob", "agentId": "codex", "status": "blocked", "mission": "write the tests", "unread": 2 }
  ]
}
```

### `set_my_status`

| Argument | Type | Notes |
| --- | --- | --- |
| `status` | `working` \| `waiting` \| `blocked` \| `review` \| `done` | |
| `note` | string | One line: what it is on right now |

## Talking

### `send_message`

| Argument | Type | Notes |
| --- | --- | --- |
| `subject` | string | Required |
| `body` | string | |
| `to` | string[] | Handles, for a direct message |
| `channel` | string | Channel name, without the `#` |
| `priority` | `low` \| `normal` \| `high` \| `urgent` | |
| `taskId` | string | When the message is about a task |

Give `to` for a direct message, `channel` for a channel post, or neither to broadcast to everyone currently working. Sending to a handle nobody answers to is an error rather than a silent dead letter.

### `reply_to_message`

| Argument | Type | Notes |
| --- | --- | --- |
| `messageId` | string | The message being answered |
| `body` | string | |
| `subject` | string | Defaults to `re: <original>` |

The reply inherits the original's thread.

### `check_inbox`

| Argument | Type | Default |
| --- | --- | --- |
| `limit` | number | 20 |
| `peek` | boolean | false — pass `true` to read without marking read |

Returns the messages taken, plus how many remain unread. Urgent and high-priority mail comes first.

### `read_thread`

| Argument | Type |
| --- | --- |
| `threadId` | string |

### `channels`

| Argument | Type | Notes |
| --- | --- | --- |
| `action` | `list` \| `join` \| `leave` | Defaults to `list` |
| `channel` | string | Required for join and leave |

## Staying out of each other's files

### `claim_files`

| Argument | Type | Notes |
| --- | --- | --- |
| `paths` | string[] | Repository-relative paths or globs |
| `reason` | string | What is about to happen to them |
| `mode` | `exclusive` \| `shared` | `shared` for reading |
| `ttlSeconds` | number | How long the claim is needed |

Granted:

```json
{ "granted": true, "lease": { "id": "lse_…", "paths": ["src/parser.ts"], "expiresAt": "…" } }
```

Refused, with everything needed to act:

```json
{
  "granted": false,
  "blockedBy": [
    {
      "holder": "alice",
      "paths": ["src/parser.ts"],
      "reason": "writing the tokeniser",
      "since": "…",
      "expires": "…",
      "collisions": [["src/**/*.ts", "src/parser.ts"]]
    }
  ],
  "advice": "Message the holder, work on something else, or wait for the claim to expire."
}
```

### `release_files`

| Argument | Type | Notes |
| --- | --- | --- |
| `leaseId` | string | Omit to release everything the caller holds |

### `who_is_editing`

| Argument | Type |
| --- | --- |
| `paths` | string[] |

Answers who claims those paths, and what the caller currently holds, without claiming anything.

## Sharing the work

### `list_tasks`

| Argument | Type | Notes |
| --- | --- | --- |
| `available` | boolean | Unclaimed tasks whose dependencies are done |
| `status` | task status | |
| `assignee` | string | |
| `mine` | boolean | Shorthand for the caller's own tasks |

### `create_task`

| Argument | Type | Notes |
| --- | --- | --- |
| `title` | string | Required |
| `body` | string | |
| `assignee` | string | Omit to leave it in the backlog |
| `dependsOn` | string[] | Task ids that must finish first |
| `labels` | string[] | |

### `claim_task`

| Argument | Type |
| --- | --- |
| `taskId` | string |

Exactly one member wins a claim. The loser is told who holds it:

```json
{ "claimed": false, "heldBy": "alice", "status": "claimed" }
```

That is a normal outcome, not an error — pick another task.

### `update_task`

| Argument | Type | Notes |
| --- | --- | --- |
| `taskId` | string | |
| `status` | task status | |
| `note` | string | Appended to the task, visible to everyone |

Only the task's owner may move it.

## Errors

A tool that cannot do what was asked returns `isError: true` with a JSON body:

```json
{ "error": "Unknown recipients: ghost", "details": null }
```

The message is written to be acted on, not just logged.
