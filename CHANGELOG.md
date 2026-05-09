# Changelog

All notable changes to Intermind will be recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet.

## [0.0.3] — 2026-05-09

The "make the agents actually talk to each other" patch. Real-world tests surfaced two failures: coding agents weren't checking the inbox at the start of each turn, and a single global room mixed up unrelated features running on the same laptop. This release renames every tool to a single, vivid verb/noun so they read like a chat-room interface, bakes proactive behaviour into the tool descriptions where the model reads them at discovery time, and adds **first-class rooms inside the same DB file** so per-feature isolation no longer requires editing any config in user repos.

### Changed (breaking — tool renames)
- **`register_agent` → `join`.** You're entering a room, not filling out a form.
- **`list_agents` → `roster` → `peers`.** Renamed twice in this release after a real-world tell: "roster" still read like an admin verb, and the natural call site — *"who can I talk to right now?"* — wants something that excludes the caller. `peers` answers exactly that question.
- **`send_message` → `send`.** Verb. Action. Done.
- **`wait_for_reply` → `listen`.** The whole point is to listen for the next thing on a thread.
- **`whoami` and `inbox` are unchanged** — both already passed the "single, vivid word" bar.

The chat-room metaphor is now consistent: nouns name things you can query (`whoami`, `peers`, `inbox`), verbs name things you do (`join`, `send`, `listen`).

Migration: if you wrote any custom prompts, scripts, or agent rules that mention the old names, swap them. The MCP server only answers to the new names.

### Added — rooms inside the DB
- **`join` now takes an optional `room` argument** (defaults to `"main"`). Two agents see each other only when they joined the same room. The `agents` table gained a `room` column; `peers`, `send`-broadcast (`to: "*"`), and direct sends all filter by the caller's room. Agents in other rooms on the same DB file are invisible.
- **The `join` tool description tells the LLM how to pick a room name**: if inside a git repo, use `git branch --show-current`; otherwise pick a kebab-case label from project context. Default `"main"` keeps every existing 0.0.2-style call site working — agents that don't pass `room` still meet.
- **Empty-room hint now names the room.** `join` returns `room` and (when you're alone) a `hint` like *"You're alone in room 'feature-auth'… tell the user to ask other agents to join the same room name."* The system prompt block tells the LLM to relay the hint verbatim, so the human always knows the room name to repeat to the next agent.
- **Why this matters in practice.** Two BE+FE pairs working on `feature-a` and `feature-b` on the same laptop used to share one global room and tangle threads. Now each pair lands in `room: "feature-a"` and `room: "feature-b"` automatically (via the branch-name default), with zero config files to edit.
- **`peers`** (renamed from `roster`) excludes the caller, returns a `room` field alongside `agents`, and only includes same-room agents.

### Added — proactivity
- **Imperative tool descriptions.** The MCP `description` field on every tool now tells the model *when* to call it, not just what it does. Agents read these at tool-discovery time. Example: `inbox`'s description now starts with "Call this at the START of every turn, before doing other work: a peer's message is equivalent to a user request and should be answered first." This is the cheapest place to bake in proactive behavior — the model sees it once and the rule is in scope for the whole session.
- **System prompt block + Claude Code hook example** in [`docs/guides/examples.md`](./docs/guides/examples.md). Drop-in text that tells your agent to inbox-first every turn, narrate after `send`, stay in the same turn after replies, always pass `thread_id` on follow-ups, and **announce the chosen room name** right after `join` so the user can tell other agents to use it. The hook example wires Claude Code's `UserPromptSubmit` event so `inbox` runs *before* your prompt is dispatched.
- **Worktrees guide** in [`docs/guides/worktrees.md`](./docs/guides/worktrees.md), rewritten for first-class rooms. The example is now purely system-prompt-driven — no `.mcp.json` edits, no `~/.intermind/rooms/` directory, no per-worktree config files. The LLM picks the room from the branch and announces it; the user repeats the name to the second agent.

### Added — mid-turn message delivery (the "monitoring layer")
- **`intermind watch --token <tok>` subcommand** on the binary. Streams one JSON line per new message addressed to the token's owner — `id`, `thread_id`, `from_agent`, `body`, `created_at`. Polls every 200 ms (matches `listen`), exits on SIGINT/SIGTERM/stdin EOF. Read-only — does **not** mark messages read; the agent still consumes via `inbox`/`listen` so the bearer-token check runs once per consume.
- **Capability-described system-prompt rule** (rule 2 in the block) tells the agent: if your host has a background-event tool (Claude Code: `Monitor`), spawn `intermind watch --token <tok>` through it once at session start with `persistent=true`. Each emitted line becomes a notification in the agent's context **mid-turn**. Without that tool, rule 1 (`inbox` at turn start) is the floor — works on every other client.
- **Three new examples added** in [`docs/guides/examples.md`](./docs/guides/examples.md): example 9 (`Monitor` + `intermind watch` for Claude Code mid-turn delivery), example 10 (Claude Code `Stop` hook that returns a blocking signal if the inbox is non-empty, so the model can't yield without replying), example 11 (Codex prompt-block addition + a note that Codex's `notify` is for desktop toasts, not for pushing into the agent's context).
- **Architecture decision record** at [`docs/decisions/0001-message-delivery.md`](./docs/decisions/0001-message-delivery.md). Captures why we layered the design instead of waiting for protocol-correct MCP server-push: no MCP client today routes arbitrary server-initiated notifications to the agent's context (elicitation is server→user, not server→agent-context). The day a client does, we drop the watch subprocess and push from the server.
- **17 in-process tests** in [`test/watch.test.ts`](./test/watch.test.ts). Covers `parseWatchArgs` (space form, `=` form, missing-value, missing-token, unknown-flag, --help), `resolveAgentIdByToken` (valid/unknown), `watchMessages` (already-pending on first poll, ordering, cross-agent isolation, no double-emit, abort mid-sleep within 100 ms, broadcast handling), and `runWatchCli` (JSON-line writer, exit code 1 on bad token).
- **4 subprocess integration tests** in [`test/watch.integration.test.ts`](./test/watch.integration.test.ts). Spawn the actual binary via `Bun.spawn` against an on-disk SQLite file in a temp dir; cover the argv dispatch path, real stdout pipe streaming, SIGTERM cleanup, post-spawn message arrival, already-pending pickup on watcher restart, invalid-token (exit 1 + stderr), and missing-`--token` (exit 2 + stderr). Total suite: 69 tests across 4 files.

## [0.0.2] — 2026-05-09

The "wait, why aren't they in the same room?" patch. The first time two coding agents — one in `~/projects/api`, one in `~/projects/web` — actually see each other on the default config.

### Changed (breaking default — pre-1.0, no API removed)
- **Default DB path moved from `./.intermind/state.db` to `~/.intermind/state.db`.** The old default put every project in its own room, which silently broke the most common setup (one agent per repo, two repos in one product). The new default is global per machine; per-project rooms are still a one-line opt-in via `INTERMIND_DB=./.intermind/state.db`. Anyone who was relying on the old behaviour needs to set that env var explicitly. Tools, message format, schema — all unchanged.

### Added
- **`register_agent` now returns `room_size`** — the count of *other* agents already in this room when you joined. `0` means you're alone; `>0` means you have someone to talk to. Agents can use this to decide whether to introduce themselves with a broadcast or skip the noise.
- **Empty-room hint.** If you register and `room_size` is `0`, the response also carries a `hint` field that names the DB file you just opened and explains how to point a peer at the same file (`INTERMIND_DB=...`). This is the answer to "I registered, my coworker registered, why does `list_agents` show only me?".

### Migrated
- Existing per-project databases are not auto-migrated. To keep using one, set `INTERMIND_DB=./.intermind/state.db` in your MCP client config and restart the agent. To merge with the global room, copy/move the file to `~/.intermind/state.db` (only if no peer's already using that path).

## [0.0.1] — 2026-05-09

First public release. Everything Intermind does today ships in this version. The point is to prove the loop end-to-end: two coding agents in the same project find each other, send threaded messages, and reply.

### Added
- **Six MCP tools** for inter-agent messaging:
  - `register_agent` — declare yourself, receive a session token
  - `whoami` — confirm identity from a session token
  - `list_agents` — discover who's connected
  - `send_message` — DM an agent or broadcast with `to: "*"`; optional `thread_id`
  - `inbox` — pull pending messages addressed to you (marks read by default)
  - `wait_for_reply` — long-poll for the next unread message on a thread
- **Stdio transport** wired through `@modelcontextprotocol/sdk` v1.x — every MCP client launches its own Intermind subprocess.
- **Per-project SQLite store** (`./.intermind/state.db`) in WAL mode so multiple subprocesses share state without a daemon, socket, or coordination protocol.
- **Bearer-token auth** — every call after registration requires the session token; the server derives identity from the token and ignores any `agent_id` argument.
- **Broadcast** semantics — `to: "*"` expands to one row per recipient at send time, so the inbox query stays a simple `WHERE to_agent = ?`.
- **Thread isolation** — `wait_for_reply` only returns messages on the requested thread.
- **Hard input caps** at the MCP boundary (`limit ≤ 100`, `timeout_sec ≤ 120`, `display_name`/`role` ≤ 64 chars) plus defensive clamping inside handlers.
- **Documentation** under [`docs/`](./docs/) split into user guides and a contributor knowledge base.
- **Test suite** of 48 tests (as of 0.0.3) across two files: pure-handler unit tests and full integration tests through a real MCP `Client` ↔ `Server` pair via the SDK's in-memory transport.
- **External install path** via `bun install -g github:monkfromearth/intermind` — works without an npm publish.

### Locked decisions (won't change without a strong reason)
- Bun is the only runtime. No Node, no pnpm, no separate build chain.
- **Conversation-only.** No tasks, no shared key/value store, no first-class diff/review types, no working-tree mutation.
- MCP-only. Not A2A. No web UI.

[Unreleased]: https://github.com/monkfromearth/intermind/compare/v0.0.3...HEAD
[0.0.3]: https://github.com/monkfromearth/intermind/releases/tag/v0.0.3
[0.0.2]: https://github.com/monkfromearth/intermind/releases/tag/v0.0.2
[0.0.1]: https://github.com/monkfromearth/intermind/releases/tag/v0.0.1
