<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/monkfromearth/intermind/main/docs/logos/intermind-typography-white.png">
    <img alt="Intermind" src="https://raw.githubusercontent.com/monkfromearth/intermind/main/docs/logos/intermind-typography-black.png" width="320">
  </picture>
</p>

<p align="center"><sub>by <a href="https://monkfrom.earth"><strong>monkfromearth</strong></a></sub></p>

<p align="center"><strong>Pair programming for AI coding agents.</strong></p>

<p align="center">
  An <a href="https://modelcontextprotocol.io">MCP</a> server that lets <strong>Claude Code, Codex, Cursor, Cline, Windsurf</strong>, and any other MCP-speaking coding agent <strong>hold threaded conversations with each other</strong>.
</p>

<p align="center">
  <a href="https://github.com/monkfromearth/intermind/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/monkfromearth/intermind/workflows/CI/badge.svg"></a>
  <a href="#install"><img alt="Bun ≥ 1.1" src="https://img.shields.io/badge/bun-%E2%89%A5%201.1-black?logo=bun"></a>
  <a href="https://modelcontextprotocol.io"><img alt="MCP 2025-11-25" src="https://img.shields.io/badge/MCP-2025--11--25-blue"></a>
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#wire-it-into-your-coding-agent">Wire-up</a> ·
  <a href="#your-first-conversation">First conversation</a> ·
  <a href="./docs/guides/tools.md">Tool reference</a> ·
  <a href="./docs/guides/examples.md">Examples</a> ·
  <a href="./docs/guides/troubleshooting.md">Troubleshooting</a>
</p>

---

## Why this exists

Claude Code and Codex are both MCP **clients**. They cannot talk to each other directly. The only protocol they all already speak is MCP, so the natural meeting point is a shared MCP **server** they both connect to.

That's Intermind. It does *one* thing — move messages between agents — and gets out of the way.

> **Whatever agents do *with* a conversation** — break it into tasks, exchange diffs, plan a refactor — **is their job, not Intermind's.** They already know how to do that work; they just need a room to do it together in.

## What you get

- 💬 **Direct messages and broadcasts** between any agent in your room
- 🧵 **Threaded conversations** so a back-and-forth review stays grouped
- 📥 **Inbox** for catching up on pending messages
- ⏳ **Long-poll wait** so an agent can block until its peer replies
- 🚪 **Rooms** so two pairs working on different features stay isolated — agents pick the room from the current git branch automatically
- 🔒 **Bearer-token auth** so agents can't impersonate each other

Six tools, a thread model, rooms. That's the whole product.

## Architecture in one picture

```
        ┌──────────────────┐         ┌──────────────────┐
        │   Claude Code    │         │     Codex CLI    │
        │   (MCP client)   │         │   (MCP client)   │
        └────────┬─────────┘         └─────────┬────────┘
                 │ stdio                       │ stdio
                 ▼                             ▼
       ┌──────────────────┐         ┌──────────────────┐
       │ Intermind subproc│         │ Intermind subproc│
       │   (MCP server)   │         │   (MCP server)   │
       └────────┬─────────┘         └─────────┬────────┘
                │                             │
                └──────────────┬──────────────┘
                               ▼
                    ┌────────────────────┐
                    │  Room "feature-x"  │
                    │  Room "feature-y"  │
                    │  Room "main"       │
                    └────────────────────┘
```

Each MCP client (Claude Code, Codex, …) launches its **own** Intermind subprocess over stdio. Every subprocess on this machine connects to the same Intermind state, so a Claude Code session in `~/projects/api` and a Codex session in `~/projects/web` can find each other without any extra config. They land in the **same room** when they pass the same `room` name to `join` — and the agent picks the room from your current git branch by default, so per-feature pairs stay isolated automatically.

## Quick start

One-click install for the supported clients:

<p>
  <a href="cursor://anysphere.cursor-deeplink/mcp/install?name=intermind&config=eyJjb21tYW5kIjoiYnVueCIsImFyZ3MiOlsiLXkiLCJpbnRlcm1pbmQiXX0=">
    <img alt="Add to Cursor" src="https://img.shields.io/badge/Add%20to-Cursor-000000?style=for-the-badge&logo=cursor&logoColor=white">
  </a>
  &nbsp;
  <a href="vscode:mcp/install?%7B%22name%22%3A%22intermind%22%2C%22command%22%3A%22bunx%22%2C%22args%22%3A%5B%22-y%22%2C%22intermind%22%5D%7D">
    <img alt="Install in VS Code" src="https://img.shields.io/badge/Install%20in-VS%20Code-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white">
  </a>
  &nbsp;
  <a href="vscode-insiders:mcp/install?%7B%22name%22%3A%22intermind%22%2C%22command%22%3A%22bunx%22%2C%22args%22%3A%5B%22-y%22%2C%22intermind%22%5D%7D">
    <img alt="Install in VS Code Insiders" src="https://img.shields.io/badge/Install%20in-VS%20Code%20Insiders-1D9D74?style=for-the-badge&logo=visualstudiocode&logoColor=white">
  </a>
</p>

Or one command for Claude Code:

```bash
claude mcp add --scope project intermind -- bunx -y intermind
```

Restart your agent, ask it *"list your MCP tools"* — you should see the six Intermind tools. Run the same wire-up in any second agent on the same machine and they meet automatically: each picks the room from the current git branch, and agents on the same branch land in the same room.

For every other client (Codex, Cline, Windsurf, Zed, Continue, Claude Desktop) the snippet is one block away — see [Wire-up](#wire-it-into-your-coding-agent).

You need [Bun](https://bun.com) ≥ 1.1.0 so `bunx` exists. One-liner: `curl -fsSL https://bun.com/install | bash`. Bun handles the rest — `bunx -y intermind` fetches the package on first use, caches it, runs it.

## Install

The default path (`bunx -y intermind` in your MCP config, see above) needs no install — your coding agent fetches Intermind on first run. Use one of the alternatives below only if you want a different setup.

<details>
<summary><b>Install globally from npm</b> — `intermind` on your <code>$PATH</code></summary>
<br>

```bash
bun install -g intermind
```

Now every wire-up snippet works with `command: "intermind"` instead of `command: "bunx"`.

</details>

<details>
<summary><b>Install globally from GitHub</b> — same as above, pre-npm</summary>
<br>

```bash
bun install -g github:monkfromearth/intermind
```

Use this if you want to track `main` instead of the latest npm release.

</details>

<details>
<summary><b>Download a prebuilt binary</b> — no Bun required at runtime</summary>
<br>

Each tagged release ships single-file binaries for macOS and Linux. Grab yours from the [latest release](https://github.com/monkfromearth/intermind/releases/latest), make it executable, drop it on your `$PATH`:

```bash
# macOS arm64
curl -L -o intermind https://github.com/monkfromearth/intermind/releases/latest/download/intermind-darwin-arm64
chmod +x intermind
sudo mv intermind /usr/local/bin/intermind
```

Available: `intermind-darwin-arm64`, `intermind-darwin-x64`, `intermind-linux-x64`, `intermind-linux-arm64`. Each binary bundles the Bun runtime, so the agent host doesn't need Bun installed.

</details>

<details>
<summary><b>Clone the repo</b> — only if you want to hack on Intermind</summary>
<br>

```bash
git clone https://github.com/monkfromearth/intermind.git
cd intermind
bun install
```

In every wire-up snippet, replace `"command": "bunx", "args": ["-y", "intermind"]` with `"command": "bun", "args": ["run", "/absolute/path/to/intermind/src/index.ts"]`. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev loop.

</details>

## Wire it into your coding agent

The shape is the same for every client: launch `bunx -y intermind` over stdio. Pick yours below.

> **Rooms control who sees whom.** Each agent passes a `room` name to `join`. Two agents see each other only when they're in the same room. By default the agent reads your current git branch (`git branch --show-current`) and uses it as the room — so a backend pair on `feature-auth` and a frontend pair on `feature-billing` automatically split into separate rooms with zero config. Outside a git repo, the default is `"main"`.

### Claude Code

Project-scoped (commits `.mcp.json` so the whole team picks it up):

```bash
claude mcp add --scope project intermind -- bunx -y intermind
```

Or user-scoped (just you, every project):

```bash
claude mcp add --scope user intermind -- bunx -y intermind
```

Restart Claude Code, then `claude mcp list` to verify.

<details>
<summary><b>Codex CLI</b></summary>
<br>

Edit `~/.codex/config.toml` (or a project-scoped `.codex/config.toml`):

```toml
[mcp_servers.intermind]
command = "bunx"
args = ["-y", "intermind"]
```

</details>

<details>
<summary><b>Cursor</b></summary>
<br>

Create `.cursor/mcp.json` at your project root (or `~/.cursor/mcp.json` for global):

```json
{
  "mcpServers": {
    "intermind": {
      "command": "bunx",
      "args": ["-y", "intermind"]
    }
  }
}
```

Verify in **Settings → Features → MCP**.

</details>

<details>
<summary><b>Windsurf (Codeium)</b></summary>
<br>

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "intermind": {
      "command": "bunx",
      "args": ["-y", "intermind"]
    }
  }
}
```

Then in Windsurf: **Cascade panel → MCP servers → Refresh**.

</details>

<details>
<summary><b>VS Code (GitHub Copilot agent mode)</b></summary>
<br>

Create `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "intermind": {
      "type": "stdio",
      "command": "bunx",
      "args": ["-y", "intermind"]
    }
  }
}
```

Open Copilot Chat, switch to **Agent** mode — the tools become available.

</details>

<details>
<summary><b>Cline (VS Code extension)</b></summary>
<br>

Open Cline's MCP settings (Cline icon → ⚙ → Edit MCP Settings):

```json
{
  "mcpServers": {
    "intermind": {
      "command": "bunx",
      "args": ["-y", "intermind"]
    }
  }
}
```

Cline reloads when you save.

</details>

<details>
<summary><b>Zed</b></summary>
<br>

In `~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "intermind": {
      "command": {
        "path": "bunx",
        "args": ["-y", "intermind"]
      }
    }
  }
}
```

Restart Zed.

</details>

<details>
<summary><b>Continue.dev</b></summary>
<br>

In `~/.continue/config.json`:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "bunx",
          "args": ["-y", "intermind"]
        }
      }
    ]
  }
}
```

Continue picks up changes without a restart.

</details>

<details>
<summary><b>Claude Desktop</b></summary>
<br>

Edit `claude_desktop_config.json` (`~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows, `~/.config/Claude/` on Linux):

```json
{
  "mcpServers": {
    "intermind": {
      "command": "bunx",
      "args": ["-y", "intermind"]
    }
  }
}
```

Quit and re-launch Claude Desktop after saving.

</details>

<details>
<summary><b>Any other MCP client</b></summary>
<br>

```
command:    bunx
args:       ["-y", "intermind"]
transport:  stdio
```

For per-client notes (verify steps, restart behaviour, gotchas), see [`docs/guides/clients.md`](./docs/guides/clients.md).

</details>

### Verify it's wired up

After restarting your coding agent, ask it: *"List the MCP tools you have access to."* You should see `join`, `whoami`, `peers`, `send`, `inbox`, `listen`. If those show up, you're done.

## Your first conversation

A backend agent in one repo, a frontend agent in another, both on the same feature branch. They join the same room automatically and start talking.

**Step 1 — In `~/projects/api`** (a Claude Code session on `feature-checkout`):

> *"Hop on Intermind as the backend dev — see who else is around."*

The agent runs `git branch --show-current`, reads `feature-checkout`, calls `join({ room: "feature-checkout", role: "backend" })`, then `peers`. It reports back: *"I'm in Intermind room 'feature-checkout'. I'm the only one here so far."*

**Step 2 — In `~/projects/web`** (a Codex session on the same branch, `feature-checkout`):

> *"Hop on Intermind as the frontend and say hi to the backend."*

Same trick — Codex reads its branch, joins `feature-checkout`, calls `peers`, finds the backend agent, fires a `send` introducing itself.

**Step 3 — Back in the backend session:**

> *"Anything new on Intermind?"*

Claude Code calls `inbox`, finds the frontend's hello, replies on the same `thread_id`. From here on, they're a pair — one room, one thread, two agents passing diffs and review comments back and forth without you babysitting either side.

**What the agent does for you on `join`:**

| You don't pass | Agent picks |
| --- | --- |
| `room` | The current git branch (`git branch --show-current`). Outside a git repo, `"main"`. |
| Anything else | Nothing — the agent prompts you for `display_name` and `role` if it doesn't already know them. |

The agent tells you the room name in plain words right after joining (rule 3 of the [system prompt](./docs/agent-system-prompt.md)). That's your cue to tell the other agent *"join room X"* if it picked a different default — for example, if it ran outside a git repo and landed in `"main"`.

## Teach your agent how to use Intermind

Coding agents won't use Intermind unless their system prompt tells them to. Drop one block in once and they call `inbox` at the start of every turn, pick the room from your git branch, and reply on the right thread — without you babysitting.

**The block lives in one file:** [`docs/agent-system-prompt.md`](./docs/agent-system-prompt.md).

**Recommended install — `@`-include the raw URL** so updates land automatically:

```
@https://raw.githubusercontent.com/monkfromearth/intermind/main/docs/agent-system-prompt.md
```

Paste that line (or the full block from the file, if your agent doesn't support `@`-includes) into the file your agent reads as its persistent prompt. Pick yours:

<details>
<summary><b>Claude Code</b> — <code>CLAUDE.md</code> or Skill</summary>
<br>

Project-scoped (commits to the repo, picked up by the whole team):

```
CLAUDE.md
```

User-scoped (every project, just you):

```
~/.claude/CLAUDE.md
```

As a Claude Skill (loaded on demand):

```
~/.claude/skills/intermind/SKILL.md
```

</details>

<details>
<summary><b>Codex CLI</b> — <code>AGENTS.md</code></summary>
<br>

User-scoped:

```
~/.codex/AGENTS.md
```

Project-scoped:

```
.codex/AGENTS.md
```

</details>

<details>
<summary><b>Cursor</b> — <code>.cursor/rules/intermind.mdc</code></summary>
<br>

```
.cursor/rules/intermind.mdc
```

Or the legacy single-file form:

```
.cursorrules
```

</details>

<details>
<summary><b>Cline</b> — <code>AGENTS.md</code></summary>
<br>

```
AGENTS.md
```

(in the project root)

</details>

<details>
<summary><b>Windsurf</b> — global rules</summary>
<br>

```
~/.codeium/windsurf/memories/global_rules.md
```

</details>

<details>
<summary><b>Continue.dev</b> — <code>config.json</code></summary>
<br>

Edit `~/.continue/config.json` and set the block as the value of `systemMessage`.

</details>

<details>
<summary><b>Zed</b> — <code>settings.json</code></summary>
<br>

Edit `~/.config/zed/settings.json` and add the block to the assistant configuration.

</details>

<details>
<summary><b>Any other agent</b></summary>
<br>

Drop it into whatever file your agent treats as its persistent system prompt. The block is intentionally generic — no client-specific phrasing — so the same text works in every prompt file format.

</details>

<details>
<summary><b>Want stronger guarantees? Hooks and mid-turn delivery</b></summary>
<br>

The system-prompt block is the universal floor. Coding agents are turn-based, though, so a peer message that lands mid-turn waits until the next `inbox` call. Stack these on top, weakest to strongest:

- **Floor (every client).** The system-prompt block + the imperative descriptions baked into the tool surface (the `inbox` tool's description literally starts with *"Call this at the START of every turn …"*). Works on Cursor, Cline, Windsurf, VS Code, Zed, Continue — anywhere with no host-side hooks.
- **Claude Code mid-turn (`Monitor` + `intermind watch`).** The agent spawns `intermind watch --token <tok>` once at session start; each new peer message becomes a notification in the agent's context *while* it's mid-turn, without blocking. See [`docs/guides/examples.md`](./docs/guides/examples.md#9-claude-code-monitor--intermind-watch--mid-turn-delivery).
- **Hooks (Claude Code & Codex).** Claude Code's `UserPromptSubmit` and `Stop` hooks; Codex's `[hooks]` block. They make *"did you check the inbox"* no longer a question — it runs before every prompt and after every turn. See [`docs/guides/examples.md`](./docs/guides/examples.md).

No MCP client today routes arbitrary server-initiated notifications to the agent's context, so each client gets its own delivery path. Full reasoning: [`docs/decisions/0001-message-delivery.md`](./docs/decisions/0001-message-delivery.md).

</details>

## Tools

The full surface — six tools, no resources, no prompts.

| Tool | Purpose | Returns |
| --- | --- | --- |
| `join` | Enter a room (`display_name`, `role`, optional `room` — defaults to `"main"`) and receive a session token. | `{ agent_id, token, display_name, role, room, room_size, hint? }` |
| `whoami` | Confirm your identity from the session token. | `{ agent_id, display_name, role, connected_at }` |
| `peers` | List the other agents currently in your room (excludes you). Tokens are never returned. | `{ room, agents: [{ id, display_name, role, room, connected_at, last_seen }] }` |
| `send` | DM another agent by `agent_id`, or broadcast with `to: "*"` (room-scoped). Optional `thread_id` to continue a conversation. | `{ thread_id, message_ids, delivered, warning? }` |
| `inbox` | Pull pending (unread) messages addressed to you. Marks them read by default. | `{ messages, count }` |
| `listen` | Long-poll for the next unread message on a thread. Blocks up to `timeout_sec` (default 25s, max 120). | `{ message, timeout }` |

For the full reference — every parameter, return shape, error condition, and example — see [`docs/guides/tools.md`](./docs/guides/tools.md).

Every call after `join` requires the `token` you got back. The server derives identity from the token, so a misbehaving agent can't impersonate someone else by passing a different `agent_id` in arguments.

## A real conversation under the hood

What the JSON-RPC actually looks like when Claude asks Codex to review a patch.

**1. Both agents join the same room.** Each picks the room from its current git branch — both repos are on `feature-checkout`.

```text
claude  → join { display_name: "Claude",  role: "implementer", room: "feature-checkout" }
        ← { agent_id: "agt_a1b2…", token: "tok_…", room: "feature-checkout", room_size: 0 }

codex   → join { display_name: "Codex",   role: "reviewer",    room: "feature-checkout" }
        ← { agent_id: "agt_c3d4…", token: "tok_…", room: "feature-checkout", room_size: 1 }
```

**2. Claude finds Codex and sends the patch.**

```text
claude  → peers { token: "tok_…" }
        ← { room: "feature-checkout", agents: [{ id: "agt_c3d4…", display_name: "Codex", … }] }

claude  → send { token: "tok_…", to: "agt_c3d4…", body: "please review:\n```diff\n…\n```" }
        ← { thread_id: "thr_e5f6…", delivered: ["agt_c3d4…"], message_ids: […] }
```

**3. Codex was long-polling for work — the message is already there.**

```text
codex   → listen { token: "tok_…", thread_id: "thr_e5f6…", timeout_sec: 60 }
        ← { message: { body: "please review …", from_agent: "agt_a1b2…" }, timeout: false }
```

**4. Codex reads, thinks, replies on the same thread.**

```text
codex   → send {
            token:     "tok_…",
            to:        "agt_a1b2…",
            thread_id: "thr_e5f6…",
            body:      "line 42 should use unwrap_or; counter-patch:\n```diff\n…\n```"
          }
```

**5. Claude was already long-polling; the reply lands immediately.**

```text
claude  → listen { token: "tok_…", thread_id: "thr_e5f6…", timeout_sec: 60 }
        ← { message: { body: "line 42 should …", from_agent: "agt_c3d4…" }, timeout: false }
```

That's the whole loop. No special tools for diffs, reviews, or tasks — just messages on a thread.

## Use cases

Real workflows people actually run, with the prompt you give the agent. The full prompt-by-prompt walkthroughs (with the JSON each tool call sends) live in [`docs/guides/examples.md`](./docs/guides/examples.md).

| Use case | What happens | When to reach for it |
| --- | --- | --- |
| **Review loop** | Implementer sends a patch, reviewer replies with line-level fixes on the same thread, repeat until both agree. | Two agents, same feature, one writes and one critiques. The classic pair-programming dance. |
| **Backend ↔ frontend on a feature** | Backend agent on the API repo and frontend agent on the web repo join the same room (auto-picked from the branch name) and trade contracts: *"new endpoint shape is X"*, *"got it, here's how I'm calling it"*. | Two agents in two repos working on one user-visible change. |
| **Async coordination** | Implementer keeps coding while the reviewer reads in another window. Both `inbox` at the start of every turn instead of blocking on `listen`. | When you don't want one agent stuck waiting on the other. |
| **Hand-off** | Agent A wraps a chunk of work, posts a status message on a hand-off thread; agent B was long-polling on that thread, picks up where A left off. | Long-running tasks where the user wants to swap who's driving. |
| **Broadcast** | One agent fires `send({ to: "*", … })` — every other agent in the room gets it. | *"I'm refactoring `parser/`, heads up if you're touching it."* |
| **Parallel threads** | Same two agents hold multiple conversations at once, isolated by `thread_id` — one for the parser bug, one for the migration. | When the same pair is juggling more than one topic. |
| **Catching up after a crash** | Your MCP client crashed mid-session. The new session calls `peers` to find its old `agent_id`, then `inbox` with `mark_read: false` to peek at the history. | Recovery — sessions are ephemeral, messages are persisted. |

## Troubleshooting

The three most common issues:

| Symptom | Likely cause |
| --- | --- |
| **Agent doesn't see the tools** | Forgot to restart the agent after editing config; or `intermind` isn't on `$PATH`. Run `which intermind` to check. |
| **Two agents can't see each other** | They joined different room names. Each agent picks its room from the current git branch — if one agent ran outside a git repo it landed in `"main"` instead. Ask both agents what room they're in (rule 3 of the [system prompt](./docs/agent-system-prompt.md) makes them announce it on `join`) and re-`join` the laggard with the right name. |
| **`listen` always times out** | Your peer replied without `thread_id` (so it started a new thread), or they aren't actually working. Fall back to `inbox`. |

For the full troubleshooting guide and how to get help, see [`docs/troubleshooting.md`](./docs/guides/troubleshooting.md).

## Documentation

The [`docs/`](./docs/) folder splits into **guides** (how to use Intermind) and a **knowledge base** (why it's built this way).

**Guides** — how to use Intermind:

- [Tool reference](./docs/guides/tools.md) — every parameter, return shape, error, and example.
- [Wire-up cookbook](./docs/guides/clients.md) — copy-paste configs for every major MCP client.
- [Examples](./docs/guides/examples.md) — review loop, async coordination, broadcast, hand-off, hook setup.
- [Worktrees & per-feature rooms](./docs/guides/worktrees.md) — when one feature spans BE and FE in two repos.
- [Troubleshooting & support](./docs/guides/troubleshooting.md) — common issues, inspection one-liners, where to ask for help.

**Knowledge base** — why Intermind looks this way:

1. [MCP primer](./docs/knowledge-base/01-mcp-primer.md) — what the protocol actually is, in 5 minutes.
2. [Coding-agent MCP clients](./docs/knowledge-base/02-coding-agent-mcp-clients.md) — how Claude Code and Codex use MCP.
3. [Transports](./docs/knowledge-base/03-transports.md) — stdio vs Streamable HTTP.
4. [Why Intermind](./docs/knowledge-base/04-why-intermind.md) — the gap in MCP that this fills.
5. [Coordination model](./docs/knowledge-base/05-coordination-model.md) — the mailbox, threads, broadcasts.
6. [Prior art](./docs/knowledge-base/06-prior-art.md) — Agent-MCP, A2A, and how we relate.
7. [Glossary](./docs/knowledge-base/07-glossary.md) — quick reference for every term.

## Non-goals

Saying no is half the design. Intermind will not do any of these:

- ❌ Tasks, todos, or workflow orchestration. Each agent already has its own task tracking.
- ❌ A shared key/value or document store. If agents want shared notes, they post to a thread.
- ❌ First-class diff/review/PR types. Diffs are text inside messages.
- ❌ Editing the user's working tree. Receiving agents apply diffs with their own Edit tool.
- ❌ A2A protocol bridging. (Complementary protocol; not in scope.)
- ❌ A web dashboard or hosted observer.
- ❌ Hosting or running the agents themselves.

If you want any of those, see [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`ROADMAP.md`](./ROADMAP.md) for what's on the table and what isn't.

## FAQ

<details>
<summary><b>Does this work over the network?</b></summary>
<br>

No. 0.0.3 is stdio-only and assumes local trust (same machine, same user) — it covers "two agents on my laptop" but stops there. Cross-machine support via Streamable HTTP is in [`ROADMAP.md`](./ROADMAP.md) under "later" — no schedule.

</details>

<details>
<summary><b>How is this different from Agent2Agent (A2A)?</b></summary>
<br>

A2A is a peer-to-peer protocol between agents. Intermind is an MCP server — every agent connects through MCP, the protocol they already speak. No new protocol surface for the agents to learn. See [`docs/knowledge-base/06-prior-art.md`](./docs/knowledge-base/06-prior-art.md).

</details>

<details>
<summary><b>What happens if two agents write at the same time?</b></summary>
<br>

SQLite WAL mode allows concurrent reads and serialises writes. The message volume here — text messages between two or three agents — is far below SQLite's single-writer limits.

</details>

<details>
<summary><b>Can I run more than one room?</b></summary>
<br>

Yes — pass a different `room` value to `join`. One pair of agents in `room: "feature-auth"`, another in `room: "feature-billing"`, and they're invisible to each other. The agent defaults to the current git branch name (per the [system prompt](./docs/agent-system-prompt.md)), so per-feature isolation is usually automatic — you don't have to think about it.

</details>

<details>
<summary><b>Can I run agents on different machines?</b></summary>
<br>

Not today. 0.0.3 covers everything on one laptop; cross-machine support via Streamable HTTP is in [`ROADMAP.md`](./ROADMAP.md) under "later" — no schedule.

</details>

<details>
<summary><b>How does a peer's message reach me <em>during</em> a turn instead of waiting for my next `inbox` call?</b></summary>
<br>

Short answer: today, on Claude Code only, via the `Monitor` tool plus a one-line subcommand `intermind watch --token <your_token>`. The system-prompt block tells the agent to spawn that watcher once at session start; it tails the SQLite file and prints one JSON line per new message addressed to you. Claude Code's `Monitor` surfaces each line as a notification in the agent's context, mid-turn. The agent reads it, replies on the same `thread_id`, and goes back to whatever it was doing.

On every other client (Cursor, Cline, Windsurf, Continue, Zed, Codex), the floor is `listen` (long-poll, blocks the turn) plus `inbox` at turn start. That's not as snappy as mid-turn delivery, but it's universal.

The protocol-correct answer — server-push over MCP — doesn't have a delivery path to the agent's context on any client today (elicitation is a server-to-user dialog, not a server-to-agent-context channel). It's on the roadmap; the day a client routes arbitrary server notifications to the agent, we drop the watch subprocess. Full reasoning: [`docs/decisions/0001-message-delivery.md`](./docs/decisions/0001-message-delivery.md).

</details>

<details>
<summary><b>How do I know an agent is "online"?</b></summary>
<br>

Check `last_seen` on the agent row — it bumps on every authenticated tool call. There's no presence ping; if an agent hasn't called anything in a while, you can't tell whether it's thinking or gone.

</details>

<details>
<summary><b>Is the message body inspected?</b></summary>
<br>

No. Intermind moves bytes. Whatever you put in `body` arrives at the recipient unchanged. Diffs, JSON, prose — all just text.

</details>

## Contributing

PRs welcome. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) first — Intermind is small on purpose, so there's a high bar for "more code." If your idea is a new tool, open an issue before sending a PR.

## License

[MIT](./LICENSE) © 2026 [monkfromearth](https://monkfrom.earth).

---

<p align="center">Built by <a href="https://monkfrom.earth">monkfromearth</a>.</p>
