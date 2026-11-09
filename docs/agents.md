# Agents

## What Assemble needs from an agent

Two things, both optional in different ways:

1. **A command line.** If the agent can be launched from a shell, it can be supervised: it gets a branch, a worktree and a terminal in the console.
2. **MCP support.** If the agent can load an MCP server, it joins the bus and gets the coordination tools. If it cannot, it still works — it just cannot talk to the others.

Assemble never handles credentials. Install and authenticate each agent the way its own documentation says, then let Assemble launch it.

## Built-in catalog

| Id | Agent | Command | Bus | Config written into the worktree |
| --- | --- | --- | --- | --- |
| `claude` | Claude Code | `claude` | yes | `.mcp.json` |
| `codex` | Codex CLI | `codex` | yes | `.codex/config.toml` |
| `gemini` | Gemini CLI | `gemini` | yes | `.gemini/settings.json` |
| `cursor` | Cursor Agent | `cursor-agent` | yes | `.cursor/mcp.json` |
| `opencode` | OpenCode | `opencode` | yes | `opencode.json` |
| `goose` | Goose | `goose` | yes | `.goose/config.yaml` |
| `crush` | Crush | `crush` | yes | `crush.json` |
| `qwen` | Qwen Code | `qwen` | yes | `.qwen/settings.json` |
| `copilot` | GitHub Copilot CLI | `copilot` | yes | `.github/copilot/mcp.json` |
| `aider` | Aider | `aider` | no | — |
| `amp` | Amp | `amp` | no | — |
| `shell` | Plain shell | your shell | no | — |

Run `assemble doctor` to see which of these are on your PATH.

These entries are defaults, and CLIs change. If an agent's launch flags or config path have moved, override them per workspace rather than waiting for a release — see below.

## How a member is wired up

`assemble add claude --mission "port the parser"` does five things:

1. Cuts `assemble/claude` from the workspace base branch.
2. Checks it out at `.assemble/worktrees/claude`.
3. Writes the Assemble MCP server into that worktree's own agent config, carrying `ASSEMBLE_HANDLE=claude` and the path to the workspace database.
4. Records the member and announces it to the crew.
5. Starts the agent in that worktree, passing the mission as its prompt.

Because the config is written *inside the worktree*, nothing about your global agent settings changes, and two members of the same agent never see each other's identity.

## Overriding an agent

Edit `.assemble/workspace.json` in the repository being worked on:

```json
{
  "name": "my-project",
  "baseBranch": "main",
  "branchPrefix": "assemble/",
  "leaseTtlSeconds": 1800,
  "agents": {
    "claude": {
      "args": ["--permission-mode", "acceptEdits"]
    }
  }
}
```

Anything in an `AgentSpec` can be overridden: `command`, `args`, `env`, `promptMode`, `promptTemplate`, `speaksMcp`, `mcpConfig`.

## Adding an agent that is not in the catalog

Give it an id and, at minimum, a command:

```json
{
  "agents": {
    "myagent": {
      "name": "My Agent",
      "command": "myagent",
      "args": ["--yes"],
      "promptMode": "argv",
      "speaksMcp": true,
      "mcpConfig": { "file": ".mcp.json", "format": "mcp-json" }
    }
  }
}
```

`promptMode` decides how the mission reaches the agent:

- `argv` — appended as a final argument.
- `stdin` — typed into the terminal once the agent has drawn its prompt.
- `none` — not delivered at all; you or the bus tell it what to do.

`mcpConfig.format` is one of `mcp-json` (a `mcpServers` object), `gemini-settings` (the same key inside a larger settings file), `codex-toml`, `opencode-json` (servers under `mcp`, command and args in one array), `crush-json` (servers under `mcp`, command and args apart) or `goose-yaml` (an `extensions` map in YAML).

## First-run prompts

Some agents stop the first time they open a directory and ask whether it is
trusted. In a fresh worktree that happens on every launch, and because nothing
is typed, the member looks like it hung. Claude Code is the common case: it
shows a "Quick safety check" and waits.

A `ready` rule answers one such question, once:

```json
{
  "agents": {
    "claude": {
      "ready": {
        "pattern": "safety check[\\s\\S]*trust",
        "input": "\u001b[B\r"
      }
    }
  }
}
```

`pattern` is a regular expression matched case-insensitively against the
member's output, over a sliding window so a prompt split across reads still
matches. `input` is written to the pty the first time it matches, and never
again. `"ready": false` turns a rule off.

The input above is **down-arrow then Enter**, not Enter alone. Claude's prompt
opens with `No, exit` selected, so a bare carriage return quits the agent — a
failure that looks like the agent crashing rather than declining. Check which
option a prompt defaults to before writing a rule for it.

Patterns are matched against normalised text, not the raw stream. A full-screen
agent positions the cursor between words instead of emitting spaces, so the
escape sequences are the spacing; they are converted back to spaces and runs of
whitespace collapsed before matching. That is why a pattern can be written with
plain spaces even though the terminal never sends them.

This is **off by default and deliberately so**. The prompt exists to stop an
agent running in a directory you have not vetted. Turn it on for agents working
worktrees of your own repository, not for a clone you have not read — and note
that `assemble add` cuts worktrees from your base branch, so the code is yours,
but the directory is new.

## Telling agents to actually use the tools

Having the tools is not the same as using them. The MCP server ships instructions asking the agent to check in, claim files before editing, and read its inbox between steps — but a mission that says so is worth more:

> Port the parser to the new token type. Before editing anything under `src/`, claim it with `claim_files`. Check your inbox between steps — codex is writing tests against your output and will need the signature.

Missions like that are the difference between agents that coexist and agents that cooperate.
