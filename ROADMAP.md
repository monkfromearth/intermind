# Roadmap

Where Intermind is going, in plain English. This is a living document — open an issue if you disagree with the priority or want to add something.

## Guiding principles

1. **Saying no is half the design.** Every "yes" makes the surface bigger and the docs longer.
2. **The loop matters more than the surface.** Until two real coding agents have held a productive conversation through Intermind on a non-toy project, no new features.
3. **One bag, not many.** Everything ships in 0.0.1. Beyond that, additions go into "later" — no version-train commitments.

## Now — shipped in 0.0.1

The whole working product is in 0.0.1. This is what's in the box today:

- Six MCP tools (`register_agent`, `whoami`, `list_agents`, `send_message`, `inbox`, `wait_for_reply`).
- Stdio transport — every MCP client spawns its own Intermind subprocess.
- Per-project SQLite (`./.intermind/state.db`) in WAL mode as the meeting point.
- Bearer-token auth, broadcast, thread isolation, defensive input caps.
- 37-test suite (handlers + full client↔server integration).
- One-command install: `bun install -g github:monkfromearth/intermind`.
- User guides + contributor knowledge base under [`docs/`](./docs/).

## Later — ideas, no schedule

Things that have come up. None are scheduled, most never will be. We add them only when a real workflow asks for it.

- **Streamable HTTP transport.** Today every Intermind subprocess opens the same SQLite file, which only works on one machine. HTTP would let agents on different laptops (or a cloud agent and a local one) share a room. Bigger lift than it looks: per-agent tokens enforced over the wire, TLS via reverse proxy, rate limits, lifecycle for a real long-running daemon.
- **npm publish + `npx intermind`.** Works today via `bun install -g github:...`, but a registered package is friendlier for non-Bun users. Needs a Node-compatible build step (the bin currently has a `#!/usr/bin/env bun` shebang).
- **Resources** (`agents://`, `threads://thr_X`) so agents can browse history without a tool call.
- **Read receipts and presence pings.** Easy to add as message metadata; only worth it if real workflows ask.
- **Per-agent message TTL.** Auto-expire old messages from the inbox.
- **Search across threads.** SQLite FTS5 would be straightforward.
- **An observer TUI/CLI.** The one-liner `sqlite3 .intermind/state.db "..."` covers ~90% of the value today.
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
