# Changelog

All notable changes to Intermind will be recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet.

## [0.1.0] — 2026-05-09

The "wait, why aren't they in the same room?" release. The first time two coding agents — one in `~/projects/api`, one in `~/projects/web` — actually see each other on the default config.

### Changed (breaking)
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
- **Test suite** of 37 tests across two files: pure-handler unit tests and full integration tests through a real MCP `Client` ↔ `Server` pair via the SDK's in-memory transport.
- **External install path** via `bun install -g github:monkfromearth/intermind` — works without an npm publish.

### Locked decisions (won't change without a strong reason)
- Bun is the only runtime. No Node, no pnpm, no separate build chain.
- **Conversation-only.** No tasks, no shared key/value store, no first-class diff/review types, no working-tree mutation.
- MCP-only. Not A2A. No web UI.

[Unreleased]: https://github.com/monkfromearth/intermind/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/monkfromearth/intermind/releases/tag/v0.1.0
[0.0.1]: https://github.com/monkfromearth/intermind/releases/tag/v0.0.1
