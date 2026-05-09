# CLAUDE.md

Operating notes for AI agents (and humans) working inside this repo. Read this before writing code. The user-facing pitch is in [`README.md`](./README.md); this file is the contributor-facing source of truth.

## Project

**Intermind** — an MCP server that lets multiple coding agents collaborate on a shared project. Tagline: *"Pair programming for AI agents."* See README for the user-facing pitch and architecture diagram.

## Locked decisions (v1)

These are decided. Don't relitigate without a strong reason; if you do, update this section in the same change.

| Area               | Decision                                                                                                          | Rationale                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language / runtime | **Bun** (TypeScript runtime, package manager, bundler, test runner, built-in SQLite — all in one)                 | One tool, no extra build chain. Bun runs TS directly via `bun run`; `bun test` is the test runner; `bun:sqlite` is the database.                              |
| MCP SDK            | `@modelcontextprotocol/sdk` v1.x (the production line; v2 is pre-alpha)                                           | Canonical TypeScript implementation.                                                                                                                          |
| Transports         | stdio in v1; Streamable HTTP later if needed                                                                      | Global default DB + WAL means each MCP-client-spawned subprocess on the same machine shares `~/.intermind/state.db`. No HTTP needed for v1 within one machine. |
| Persistence        | SQLite (WAL mode), single file at `~/.intermind/state.db` (global default); per-project rooms via `INTERMIND_DB`. | Two coding-agent sessions in different repos is the **common** case (BE in `~/projects/api`, FE in `~/projects/web`). Defaulting to a per-project file silently routed them into separate rooms. Global default is the principle of least surprise; per-project is now an explicit opt-in. |
| Coordination model | Threaded mailbox, mediated through the server                                                                     | Clients can't peer-to-peer. Sampling/elicitation are *not* substitutes for inter-client messaging.                                                            |
| Identity           | Self-declared `display_name` + `role` at `register_agent`; bearer token returned and required on subsequent calls | Simple, works for both transports.                                                                                                                            |
| Concurrency        | SQLite WAL mode (read concurrency, single writer)                                                                 | Adequate for v1 message volume.                                                                                                                               |
| Security (stdio)   | Local trust assumed                                                                                               | Same machine, same user.                                                                                                                                      |
| Security (HTTP)    | Per-agent bearer token; TLS via reverse proxy; per-agent rate limits                                              | Standard remote-server posture.                                                                                                                               |
| **v1 scope**       | **Conversation only — six tools, no tasks, no shared KV, no diff/review types**                                   | Agents already manage their own tasks and know how to format diffs. Intermind only moves messages.                                                            |
| Scope (broad)      | MCP-only. Not A2A. No web UI.                                                                                     | Ship the smallest thing that proves the loop.                                                                                                                 |

## Resolved questions (kept here for the record)

1. **Polling vs. push for `inbox`.** ✅ **Long-poll on both transports.** `wait_for_reply` runs a SQL select in a 200 ms loop with a deadline. One code path. Sub-second push isn't worth a forked implementation since agents already think for tens of seconds per turn.
2. **Where does the room live by default?** ✅ **Globally, at `~/.intermind/state.db`.** Originally per-project (`./.intermind/state.db`), flipped in 0.0.2 after the obvious failure mode showed up: BE agent in `~/projects/api` and FE agent in `~/projects/web` both started, both saw an empty `list_agents`, and never met. Two agents in two repos is the common case, not the exception. SQLite WAL still does the heavy lifting; only the default path moved. Per-project rooms are still supported via `INTERMIND_DB=./.intermind/state.db` when a team genuinely wants project isolation.
3. **Observer CLI.** ✅ **Don't ship one in v1.** A one-liner — `sqlite3 ~/.intermind/state.db "SELECT created_at, from_agent, body FROM messages ORDER BY created_at DESC LIMIT 20"` — gets you 90% of the value. Add a CLI in v2 only if the one-liner stops being enough.

## Repo layout (actual)

```
src/
  index.ts                 # stdio entrypoint — opens the DB, builds the server, connects the transport
  server.ts                # buildServer(db): registers all six tools on a fresh McpServer
  handlers.ts              # the six pure handlers; tests call these directly, no MCP transport
  schemas.ts               # zod input shapes shared by handlers and MCP tool registrations
  db.ts                    # SQLite open + WAL pragmas + schema (two tables, two indexes)
test/
  handlers.test.ts         # unit tests for the pure handlers (in-memory SQLite)
  server.test.ts           # integration tests through a real MCP Client/Server pair
package.json               # one runtime dep (@modelcontextprotocol/sdk), one (zod), Bun's @types/bun for dev
tsconfig.json              # Bun's default (strict, ESNext, moduleResolution=bundler)
.gitignore
docs/                      # knowledge base for new contributors
README.md                  # user-facing pitch and wiring instructions
CLAUDE.md                  # this file
```

The trust boundary is `server.ts`: it validates every input with the zod shapes in `schemas.ts`, then calls into `handlers.ts`. Handlers take a `Database` plus already-validated args and return plain objects, so tests exercise them directly without the MCP transport in the loop.

Tooling: just **Bun** plus `zod` for schema validation at the MCP boundary. No pnpm, no tsx, no vitest, no tsup.

## Conventions

- **Tool boundary is the trust boundary.** Validate every tool input with `zod`. Never trust client-supplied `agent_id` after registration — derive identity from the session token.
- **No mutation of the user's working tree.** Intermind reads and writes its own SQLite file. Diffs are *exchanged*, not *applied*.
- **Errors are MCP errors.** Throw typed errors that the SDK serializes to JSON-RPC error objects. No silent swallowing.
- **Tests run against an in-memory SQLite.** Each test gets its own DB; no fixtures shared between tests.
- **Comments only when the *why* is non-obvious.** Type names and function names should carry the *what*.

## Build / run / test

```bash
bun install              # installs the MCP SDK + zod
bun run start            # runs src/index.ts (stdio; default DB at ~/.intermind/state.db)
bun test                 # runs the test suite against an in-memory SQLite
bun run typecheck        # tsc --noEmit
```

To wire the actual server into a coding agent during development:

```bash
# Claude Code, project-scoped:
claude mcp add --scope project --transport stdio intermind -- bun run /abs/path/to/intermind/src/index.ts
```

```toml
# Codex (~/.codex/config.toml):
[mcp_servers.intermind]
command = "bun"
args = ["run", "/abs/path/to/intermind/src/index.ts"]
```

## Reference material

Authoritative sources used to lock the decisions above:

- MCP spec (current, 2025-11-25): https://modelcontextprotocol.io/specification/2025-11-25
- 2026 MCP roadmap: https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/
- Codex MCP support & config: https://developers.openai.com/codex/mcp
- Claude Code MCP setup: https://code.claude.com/docs/en/mcp
- TypeScript MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Prior art — Agent-MCP (Python, useful inspiration; we deliberately diverge on language, scope, and locking): https://github.com/rinadelph/Agent-MCP

## Gotchas worth knowing now

- **Sampling routes back to the *calling* client only.** It is not a peer-messaging mechanism. Don't try to use it as one.
- **stdio servers don't auto-reconnect in Claude Code.** A crash means the user has to restart the client. Crash safely; persist before acknowledging.
- **Codex's `[mcp_servers.X]` block uses `command` + `args`.** It is not the same shape as Claude Desktop's JSON config. The README shows both formats — keep them in sync if either changes.
- **Streamable HTTP replaced HTTP+SSE in the 2025-03-26 spec.** Don't ship SSE-only code paths.



## Rules

All guidelines are organized in `.claude/rules/`:

- @.claude/rules/persona.md - Conversation style, behavior, concision
- @.claude/rules/plain-english.md - Plain English everywhere: chat, summaries, plans, changelogs, code review verdicts
- @.claude/rules/writing-style.md - TechCrunch format for research & documentation
- @.claude/rules/code-review-workflow.md - Handling AI/human review feedback: exhaustive list → judge → act
- @.claude/rules/comments-with-examples.md - Every code change must have inline comments with concrete examples
- @.claude/rules/changelog.md - Branch changelog: create/update docs/changelogs/{branch}.md after every non-trivial change on feature branches