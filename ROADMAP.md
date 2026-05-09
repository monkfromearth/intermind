# Roadmap

Where Intermind is going, in plain English. This is a living document — open an issue if you disagree with the priority or want to add something.

## Guiding principles

1. **Saying no is half the design.** Every "yes" makes the surface bigger and the docs longer.
2. **The loop matters more than the surface.** Until two real coding agents have held a productive conversation through Intermind on a non-toy project, no new features.
3. **One bag, not many.** The working product ships as a single set of tools; new releases are tweaks, not new "lines."

## Now — shipped in 0.0.3

What's in the box today:

- Six MCP tools — chat-room metaphor, one word each: `join`, `whoami`, `peers`, `send`, `inbox`, `listen`.
- **First-class rooms inside one DB.** `join` takes an optional `room` (default `"main"`); the LLM picks it from the git branch so per-feature BE+FE pairs auto-isolate without editing config files.
- **Imperative tool descriptions** baked into the MCP `description` field so the model sees "call this at the START of every turn" at tool-discovery time.
- **Layered message delivery.** Floor (`listen` + `inbox` + system-prompt rule) on every client; on Claude Code, `Monitor` + the new `intermind watch` subcommand surfaces peer messages **mid-turn**, plus `UserPromptSubmit` and `Stop` hooks cover entry and exit. Full reasoning in [`docs/decisions/0001-message-delivery.md`](./docs/decisions/0001-message-delivery.md).
- **`intermind watch` binary subcommand** that streams one JSON line per new peer message; designed for Claude Code's `Monitor` but works as a tail tool for any host that can read child-process stdout.
- **Claude Code hook examples** that run `inbox` on `UserPromptSubmit` and block `Stop` when the inbox is non-empty, so peers can never start *or* end a turn without seeing pending messages.
- **Worktrees guide** for keeping BE+FE on one feature isolated, now driven by the per-feature `room` argument on `join` (no config-file edits required).
- Stdio transport — every MCP client spawns its own Intermind subprocess.
- **Global default room.** A single SQLite file at `~/.intermind/state.db` (WAL mode) is the meeting point — every Claude Code / Codex / Cursor session on this machine lands in the same room unless `INTERMIND_DB` is set to a different path.
- **Empty-room hint.** `join` reports `room_size` and, when you're alone, a hint pointing at the file path so you can see whether your peer is on the same DB.
- Bearer-token auth, broadcast, thread isolation, defensive input caps.
- 48-test suite (handlers + full client↔server integration).
- **Published on npm** with SLSA v1 provenance. `bunx -y intermind` is the canonical install path; `bun install -g github:...` and prebuilt binaries also work.
- User guides + contributor knowledge base under [`docs/`](./docs/).

## Later — ideas, no schedule

Things that have come up. None are scheduled, most never will be. We add them only when a real workflow asks for it.

- **MCP server-push for peer messages.** Architecturally the right answer — one mechanism, every spec-compliant client, mid-turn for free. Blocked today because no popular client routes arbitrary server-initiated notifications to the agent's context (elicitation is a server→user dialog). The day Claude Code, Codex, Cursor, or others surface custom server notifications to the agent, we drop the `intermind watch` subprocess and push from the server. Tracked in [`docs/decisions/0001-message-delivery.md`](./docs/decisions/0001-message-delivery.md).
- **Streamable HTTP transport.** The default room (`~/.intermind/state.db`) is shared across every project on the same machine, but it stops at the machine boundary. HTTP would let agents on different laptops — or a cloud agent and a local one — join the same room. Bigger lift than it looks: per-agent tokens enforced over the wire, TLS via reverse proxy, rate limits, lifecycle for a real long-running daemon.
- **Resources** (`agents://`, `threads://thr_X`) so agents can browse history without a tool call.
- **Read receipts and presence pings.** Easy to add as message metadata; only worth it if real workflows ask.
- **Per-agent message TTL.** Auto-expire old messages from the inbox.
- **Search across threads.** SQLite FTS5 would be straightforward.
- **An observer TUI/CLI.** The one-liner `sqlite3 ~/.intermind/state.db "..."` covers ~90% of the value today.
- **A2A bridge.** Could run as a separate process in front of Intermind, translating A2A → MCP.

## Explicit non-goals (we will say no)

These are not on the roadmap, period. If you want them, please don't open issues — fork the project.

- **Tasks, todos, kanban, workflow orchestration.** Each agent already has its own task tracking. We are not the meta-task system.
- **A shared key/value or document store.** If agents want shared notes, they post to a thread. Threads are the document.
- **First-class diff / review / PR types.** Diffs are text inside messages.
- **Editing the user's working tree.** Receiving agents apply diffs with their own Edit tool. Intermind only writes to its own SQLite file.
- **A web dashboard or hosted observer.** Not our problem. Ship a CLI inspector at most.
- **Hosting or running the agents themselves.** We are infrastructure, not a runtime.

## How to influence this

1. Check the [issue tracker](https://github.com/monkfromearth/intermind/issues) — your idea may already be there.
2. If it isn't, open an issue with the **use case**, not the feature. "Two agents on different laptops can't share a room" beats "add HTTP transport."
3. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR. Small, focused PRs land fast; big speculative ones do not.
