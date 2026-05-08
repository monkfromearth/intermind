<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/logos/Intermind%20-%20Typography%20-%20White.svg">
    <img alt="Intermind" src="./docs/logos/Intermind%20-%20Typography%20-%20Black.svg" width="320">
  </picture>
</p>

<p align="center"><strong>Pair programming for AI coding agents.</strong></p>

<p align="center">
  An <a href="https://modelcontextprotocol.io">MCP</a> server that lets <strong>Claude Code, Codex, Cursor, Cline, Windsurf</strong>, and any other MCP-speaking coding agent <strong>hold threaded conversations with each other</strong>.
</p>

<p align="center">
  <a href="https://github.com/monkfromearth/intermind/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/monkfromearth/intermind/actions/workflows/ci.yml/badge.svg"></a>
  <a href="#install"><img alt="Bun ≥ 1.1" src="https://img.shields.io/badge/bun-%E2%89%A5%201.1-black?logo=bun"></a>
  <a href="https://modelcontextprotocol.io"><img alt="MCP 2025-11-25" src="https://img.shields.io/badge/MCP-2025--11--25-blue"></a>
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#wire-it-into-your-coding-agent">Wire-up</a> ·
  <a href="#your-first-conversation">First conversation</a> ·
  <a href="./docs/guides/tools.md">Tool reference</a> ·
  <a href="./docs/guides/recipes.md">Recipes</a> ·
  <a href="./docs/guides/troubleshooting.md">Troubleshooting</a>
</p>

---

## Why this exists

Claude Code and Codex are both MCP **clients**. They cannot talk to each other directly. The only protocol they all already speak is MCP, so the natural meeting point is a shared MCP **server** they both connect to.

That's Intermind. It does *one* thing — move messages between agents — and gets out of the way.

> **Whatever agents do *with* a conversation** — break it into tasks, exchange diffs, plan a refactor — **is their job, not Intermind's.** They already know how to do that work; they just need a room to do it together in.

## What you get

- 💬 **Direct messages and broadcasts** between any registered agents
- 🧵 **Threaded conversations** so a back-and-forth review stays grouped
- 📥 **Inbox** for catching up on pending messages
- ⏳ **Long-poll wait** so an agent can block until its peer replies
- 💾 **Per-project SQLite file** — no daemon, no socket, no extra services
- 🔒 **Bearer-token auth** so agents can't impersonate each other

Six tools, a thread model, an SQLite file. That's the whole product.

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
                  ┌────────────────────────┐
                  │  ./.intermind/state.db │
                  │   (SQLite, WAL mode)   │
                  └────────────────────────┘
```

Each MCP client (Claude Code, Codex, …) launches its **own** Intermind subprocess over stdio. All those subprocesses open the **same** SQLite file. SQLite's [WAL mode](https://www.sqlite.org/wal.html) handles cross-process concurrency, so there's no daemon, no socket, and no inter-process protocol to maintain.

## Quick start

One command per agent. No install step.

```bash
# Claude Code (project-scoped — commits .mcp.json so teammates pick it up)
claude mcp add --scope project intermind -- bunx -y intermind
```

Restart Claude Code, ask it *"list your MCP tools"*, you should see the six Intermind tools. Run the same wire-up in your second agent in the **same project directory** — they're now in the same room and can talk. See [Wire-up](#wire-it-into-your-coding-agent) for Codex / Cursor / Windsurf / VS Code / Zed / Cline / Continue.

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

> **Same room.** Two agents share a room only if they share the same SQLite file. The default `INTERMIND_DB` is `./.intermind/state.db` relative to the **agent's working directory**, so as long as both agents launch in the same project folder, they're in the same room.

### Claude Code

```bash
# Project-scoped (commits .mcp.json so the whole team picks it up)
claude mcp add --scope project intermind -- bunx -y intermind

# Or user-scoped (just you, every project)
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

After restarting your coding agent, ask it: *"List the MCP tools you have access to."* You should see `register_agent`, `whoami`, `list_agents`, `send_message`, `inbox`, `wait_for_reply`. If those show up, you're done.

## Your first conversation

The fastest way to feel the shape of Intermind: launch two agents in the same project and have them say hello.

**Step 1 — In agent A** (e.g. Claude Code), paste:

> *"Register yourself with Intermind as `display_name: "Claude"`, `role: "implementer"`. Save the token. Then list other agents and tell me what you see."*

The agent will call `register_agent`, then `list_agents`. At first, it'll only see itself.

**Step 2 — In agent B** (e.g. Codex, Cursor, Windsurf — anything from the wire-up table), paste:

> *"Register yourself with Intermind as `display_name: "Codex"`, `role: "reviewer"`. Save the token. Then send a message to Claude saying 'hello, Claude'."*

The agent calls `register_agent`, then `send_message` with `to: "<Claude's agent_id>"` (which it can find via `list_agents`).

**Step 3 — Back in agent A**, paste:

> *"Check your Intermind inbox."*

Agent A calls `inbox` and reads back Codex's message. Reply with:

> *"Reply to Codex on the same thread saying 'hi back'."*

Agent A calls `send_message` with the original `thread_id`.

**Step 4 — Back in agent B**, paste:

> *"Check your inbox."*

Done. You've now run a full round-trip multi-agent conversation.

## Teach your agent how to use Intermind

Drop this into your agent's system prompt or initial message so its LLM uses Intermind well without you spelling out every call. **Copy-paste:**

```
You have access to Intermind, an MCP server for talking to other coding agents
working on this same project. Use it to coordinate handoffs, request reviews,
and broadcast announcements. The tools are:

- register_agent(display_name, role): call ONCE per session before any other
  Intermind tool. Save the returned `token` for every later call.
- list_agents(token): see who else is connected. Run this when you start work
  to know who to talk to.
- send_message(token, to, body, thread_id?): DM another agent (use their
  agent_id) or broadcast (`to: "*"`). Pass `thread_id` to continue a previous
  conversation; omit it to start a new one.
- inbox(token, mark_read?, limit?): pull pending messages addressed to you.
  Returns oldest-first. Marks them read by default.
- wait_for_reply(token, thread_id, timeout_sec?): block until the next
  message on a thread arrives. Use this when you've asked a peer for input
  and have nothing useful to do until they reply.
- whoami(token): confirm your identity.

Conventions:
- Always register before doing anything else.
- Always pass `thread_id` when replying to keep conversations grouped.
- Free-form text in `body`. Diffs go in fenced code blocks. Intermind never
  inspects the body — it just moves bytes.
- If `wait_for_reply` times out, the peer hasn't replied yet. Decide whether
  to wait again, fall back to working alone, or message someone else.
```

## Tools

The full surface — six tools, no resources, no prompts.

| Tool | Purpose | Returns |
| --- | --- | --- |
| `register_agent` | Declare yourself (`display_name`, `role`) and receive a session token. | `{ agent_id, token, display_name, role }` |
| `whoami` | Confirm your identity from the session token. | `{ agent_id, display_name, role, connected_at }` |
| `list_agents` | Discover every agent currently registered. Tokens are never returned. | `{ agents: [{ id, display_name, role, connected_at, last_seen }] }` |
| `send_message` | DM another agent by `agent_id`, or broadcast with `to: "*"`. Optional `thread_id` to continue a conversation. | `{ thread_id, message_ids, delivered, warning? }` |
| `inbox` | Pull pending (unread) messages addressed to you. Marks them read by default. | `{ messages, count }` |
| `wait_for_reply` | Long-poll for the next unread message on a thread. Blocks up to `timeout_sec` (default 25s, max 120). | `{ message, timeout }` |

For the full reference — every parameter, return shape, error condition, and example — see [`docs/tools.md`](./docs/guides/tools.md).

Every call after `register_agent` requires the `token` you got back. The server derives identity from the token, so a misbehaving agent can't impersonate someone else by passing a different `agent_id` in arguments.

## A real conversation under the hood

What the JSON-RPC actually looks like when Claude asks Codex to review a patch:

```jsonc
// 1. Both agents register on first connect
claude  → register_agent { display_name: "Claude",  role: "implementer" }
        ← { agent_id: "agt_a1b2…", token: "tok_…" }
codex   → register_agent { display_name: "Codex",   role: "reviewer" }
        ← { agent_id: "agt_c3d4…", token: "tok_…" }

// 2. Claude finds Codex and sends the patch
claude  → list_agents { token: "tok_…" }
        ← { agents: [{ id: "agt_c3d4…", display_name: "Codex", … }] }
claude  → send_message {
            token:  "tok_…",
            to:     "agt_c3d4…",
            body:   "please review this patch:\n```diff\n…\n```"
          }
        ← { thread_id: "thr_e5f6…", delivered: ["agt_c3d4…"], message_ids: […] }

// 3. Codex blocks waiting for work; the message is already there
codex   → wait_for_reply {
            token:     "tok_…",
            thread_id: "thr_e5f6…",
            timeout_sec: 60
          }
        ← { message: { body: "please review …", from_agent: "agt_a1b2…" }, timeout: false }

// 4. Codex reads, thinks, replies on the same thread
codex   → send_message {
            token:     "tok_…",
            to:        "agt_a1b2…",
            thread_id: "thr_e5f6…",
            body:      "line 42 should use unwrap_or; counter-patch:\n```diff\n…\n```"
          }

// 5. Claude was already long-polling; reply lands immediately
claude  → wait_for_reply { token: "tok_…", thread_id: "thr_e5f6…", timeout_sec: 60 }
        ← { message: { body: "line 42 should …", from_agent: "agt_c3d4…" }, timeout: false }
```

That's the whole loop. No special tools for diffs, reviews, or tasks — just messages on a thread.

## Recipes

Common patterns documented in full:

- **Review loop** — implementer ↔ reviewer iterating on a patch over a single thread.
- **Async coordination** — work in parallel without blocking on a peer.
- **Broadcast** — announce to the whole room with `to: "*"`.
- **Parallel threads** — run multiple conversations simultaneously, isolated by `thread_id`.
- **Hand-off** — agent A finishes, agent B picks up, both keep the thread.
- **Catching up after a reconnect** — find your old `agent_id` and read history.

See [`docs/recipes.md`](./docs/guides/recipes.md).

## Configuration

| Env var | Default | What it does |
| --- | --- | --- |
| `INTERMIND_DB` | `./.intermind/state.db` | Path to the SQLite file. All Intermind subprocesses must point at the same file to share state. Set to a different path per client to run separate "rooms." |

> **Memory footprint.** Each MCP client launches its own Intermind subprocess, and each subprocess takes ~50 MB of RAM (almost all of it the Bun runtime). Three agents in a room ≈ 150 MB total. Plenty of headroom on any laptop.

## Inspecting state

Intermind is a SQLite file. Use any SQLite tool to inspect it. The two tables you care about are `agents` and `messages`:

```bash
# Last 20 messages, newest first
sqlite3 .intermind/state.db \
  "SELECT created_at, from_agent, to_agent, substr(body, 1, 80) FROM messages ORDER BY created_at DESC LIMIT 20"

# Who's connected
sqlite3 .intermind/state.db "SELECT id, display_name, role, last_seen FROM agents"

# Full schema
sqlite3 .intermind/state.db ".schema"
```

A dedicated observer CLI is intentionally not part of this release — the one-liners above cover ~90% of the value.

## Troubleshooting

The three most common issues:

| Symptom | Likely cause |
| --- | --- |
| **Agent doesn't see the tools** | Forgot to restart the agent after editing config; or `intermind` isn't on `$PATH`. Run `which intermind` to check. |
| **Two agents can't see each other** | They're in different rooms. Both need the same `INTERMIND_DB`. Default is relative to cwd, so cwd has to match. |
| **`wait_for_reply` always times out** | Your peer replied without `thread_id` (so it started a new thread), or they aren't actually working. Fall back to `inbox`. |

For the full troubleshooting guide and how to get help, see [`docs/troubleshooting.md`](./docs/guides/troubleshooting.md).

## Repo layout

```
src/
  index.ts        # stdio entrypoint — opens the DB, builds the server, connects the transport
  server.ts       # buildServer(db): registers all six tools on a fresh McpServer
  handlers.ts     # the six pure handlers; tests call these directly, no MCP transport
  schemas.ts      # zod input shapes shared by handlers and MCP tool registrations
  db.ts           # SQLite open + WAL pragmas + schema (two tables, two indexes)
test/
  handlers.test.ts  # unit tests for the pure handlers (in-memory SQLite)
  server.test.ts    # integration tests through a real MCP Client/Server pair
docs/             # user guides + contributor explainers
.github/
  workflows/      # CI: bun install + typecheck + bun test on Ubuntu and macOS
CLAUDE.md         # operating notes for AI agents working in this repo
```

The trust boundary is `server.ts`: it validates every input with the Zod shapes in `schemas.ts`, then calls into `handlers.ts`. Handlers take a `Database` plus already-validated args and return plain objects, so tests exercise them directly without the MCP transport in the loop.

## Development

```bash
bun install         # install deps
bun test            # 37 tests, ~5s, all in-memory
bun run typecheck   # tsc --noEmit
bun run start       # run the stdio server (default DB at ./.intermind/state.db)
```

There are two test files:

- **`test/handlers.test.ts`** — fast unit tests for the pure handler functions.
- **`test/server.test.ts`** — full integration tests through a real MCP `Client` ↔ `Server` pair, using the SDK's in-memory transport. This is the closest thing to "what Claude Code actually sees" without launching a subprocess.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR. Release history lives in [`CHANGELOG.md`](./CHANGELOG.md); upcoming work in [`ROADMAP.md`](./ROADMAP.md).

## Documentation

The [`docs/`](./docs/) folder splits into **guides** (how to use Intermind) and a **knowledge base** (why it's built this way).

**Guides** — how to use Intermind:

- [Tool reference](./docs/guides/tools.md) — every parameter, return shape, error, and example.
- [Wire-up cookbook](./docs/guides/clients.md) — copy-paste configs for every major MCP client.
- [Recipes](./docs/guides/recipes.md) — review loop, async coordination, broadcast, hand-off patterns.
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

No. 0.0.1 is stdio-only and assumes local trust (same machine, same user). Cross-machine support via Streamable HTTP is in [`ROADMAP.md`](./ROADMAP.md) under "later" — no schedule.

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
<summary><b>Where does state go when I'm done?</b></summary>
<br>

Wherever `INTERMIND_DB` points (default `./.intermind/state.db`). Delete the file to wipe the room. We already gitignore `.intermind`.

</details>

<details>
<summary><b>Can I run more than one room?</b></summary>
<br>

Yes — start each agent with a different `INTERMIND_DB`. Different file, different room.

</details>

<details>
<summary><b>Can I run agents on different machines?</b></summary>
<br>

Not today. Cross-machine support is in [`ROADMAP.md`](./ROADMAP.md) under "later" — no schedule. For now, run all agents on the same machine, same project directory.

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
