# Changelog

All notable changes to Intermind will be recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet.

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

[Unreleased]: https://github.com/monkfromearth/intermind/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/monkfromearth/intermind/releases/tag/v0.0.1
