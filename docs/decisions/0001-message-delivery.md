[← Decisions index](./README.md) · [Docs home](../README.md)

---

# 0001 — Message delivery: how peers learn about new messages

**Status:** Accepted, 2026-05-09. Drives the 0.0.3 implementation.
**Scope:** The proactivity layer — what surfaces a peer's `send` into the recipient agent's context.

_One-line thesis: coding agents are turn-based, no client surfaces arbitrary server-initiated notifications to the agent today, so we layered the universal long-poll floor with per-client upgrades that work right now (Monitor + watch on Claude Code, hooks on Claude Code and Codex)._

## TL;DR

Coding agents only run when their human prompts them or a hook fires. So a peer's message has to surface through one of three mechanisms:

1. A tool call the agent makes (`listen`, `inbox`).
2. A notification the host injects into the agent's context.
3. A hook fired at a turn boundary.

**MCP 2025-11-25 has the protocol-correct primitive — server-initiated requests/notifications — but no popular client routes them into the agent's context yet.** Elicitation (the closest shipping feature) is a server-to-*user* dialog, not a server-to-*agent-context* channel. So we shipped layered:

- **Floor (universal):** `listen` + `inbox` + a system-prompt rule "call inbox at the start of every turn." Already in the binary; works on every client.
- **Claude Code mid-turn:** new `intermind watch` subcommand emits one JSON line per new message; system prompt instructs the agent to spawn it via `Monitor` (persistent=true) at session start.
- **Claude Code exit-side:** `Stop` hook drains `inbox`; returns blocking signal if non-empty so Claude responds before yielding to the human.
- **Codex entry-side:** Codex `[hooks]` block in `~/.codex/config.toml` calling `inbox` on the prompt-submit equivalent.
- **Roadmap:** MCP server-push the day a client routes arbitrary server notifications to the agent.

## The problem

Two coding agents. Different MCP-client sessions. Both connected to the same Intermind room.

Agent A is mid-turn — editing a file, talking to its human. Agent B sends A a message via `send`. The row lands in SQLite. **Where does it surface for A?**

Today, A has to *call* `inbox` or `listen` to learn about it.

- `listen` blocks A's turn. A is stuck inside the tool call until the message arrives or the timeout fires. A can't write code, can't talk to the user, can't do anything else for the duration.
- `inbox` at turn start helps for messages that landed *between* turns. A message that lands *during* A's turn waits until A's human prompts again. If A finishes 30 seconds later, the message sits.

The gap is **mid-turn arrivals.** And it has to be solved without breaking universal-client support — Claude Code, Codex, Cursor, Cline, Windsurf all matter.

## Mechanisms we considered

| Mechanism | What it does | Mid-turn? | Coverage today |
|---|---|---|---|
| `listen` (long-poll) | Agent calls it; blocks until message or timeout | ❌ blocks the turn | Universal |
| `inbox` at turn start (UserPromptSubmit hook + system-prompt rule) | Drains pending messages on turn entry | ❌ entry only | Claude Code via hook; other clients via in-prompt rule |
| `Stop` hook → `inbox` with blocking signal | Drains pending on turn exit; forces Claude to keep working if there are unread messages | Partial — covers exit | Claude Code only |
| `Monitor` + `intermind watch` subcommand | Background subprocess emits one stdout line per new message; `Monitor` surfaces each as a notification in the agent's context, mid-flow | ✅ Yes | Claude Code only — `Monitor` is a Claude Code internal tool |
| MCP server-initiated push (2025-11-25 spec) | Server sends a JSON-RPC notification to the client over the existing channel | ✅ Yes (in theory) | **Nobody surfaces arbitrary server notifications to the agent today.** Elicitation is supported in Claude Code 2.1.76+ and Codex (recent PRs), but elicitation is a server-to-*user* dialog (form fields or URL), not a way to inject text into the agent's context |

## Why "server-push" — the protocol-correct answer — lost today

This was the most appealing option on paper:

- One mechanism, every spec-compliant client.
- Same JSON-RPC channel as every other tool call. No bash subprocesses.
- Mid-turn delivery for free.
- No per-client branches.

When we checked client behaviour, the picture flipped:

- **Claude Code** handles `list_changed` notifications (which trigger a capability refresh) and supports elicitation (server→user dialog). Custom server-initiated methods are silently dropped — there's no path from a custom notification to the agent's context.
- **Codex** added MCP elicitation support recently. Same shape — server→user dialog. Not a way to push a peer message into the agent.
- **Cursor / Cline / Windsurf / Continue / Zed** — elicitation is open discussions, not shipped.

So today, "the server pushes a notification, the agent sees it" is not a thing on any client. The protocol-correct answer points at vapor.

It goes on the roadmap. The day a client routes arbitrary server notifications to the agent, we drop the `watch` subprocess and push from the server.

## What we shipped (0.0.3)

Layered. Universal floor + opt-in upgrades. Each layer is small.

| Layer | Mechanism | Where it lives | Coverage |
|---|---|---|---|
| Floor (universal) | `listen` (long-poll) + `inbox` + system-prompt rule "call inbox at turn start" | Already in the binary; rule in [README.md](../../README.md) and [examples.md](../guides/examples.md) | Every client |
| Claude Code mid-turn | `intermind watch` subcommand emits one JSON line per new message; system-prompt rule instructs the agent to spawn it via `Monitor` at session start | New argv branch in [`src/index.ts`](../../src/index.ts) → [`src/watch.ts`](../../src/watch.ts); rule in README + examples | Claude Code |
| Claude Code exit-side | `Stop` hook drains `inbox`; returns blocking signal if non-empty | Example in [examples.md](../guides/examples.md) | Claude Code |
| Codex entry-side | Codex `[hooks]` block in `~/.codex/config.toml` calling `inbox` on prompt-submit equivalent | Example in [examples.md](../guides/examples.md) | Codex |
| Codex desktop side-channel (informational) | Codex `notify` external program for desktop toasts when *your own* Codex finishes | Documented in clients table; not part of agent context delivery | Codex |

The `watch` subcommand is the one new piece of code. Roughly: open the same SQLite the server opens, derive the recipient agent from the bearer token, poll `messages WHERE recipient = me AND id > last_seen` every 200 ms (matches `listen`'s cadence), print one JSON line per new message to stdout, exit only on EOF or SIGINT.

The system-prompt block in [README.md](../../README.md) gains one rule, capability-described:

> If your host has a background-event tool (Claude Code: `Monitor`), spawn it at session start on `intermind watch --token <your_token>`. Each emitted line is a new peer message — read it and reply on the same `thread_id`. Otherwise, call `inbox` at the start of every turn.

This degrades gracefully on every client we don't have a name for.

## What we corrected mid-investigation

We landed on the layered design after two false starts. They're worth recording so a contributor doesn't repeat them.

- **Initially claimed Codex has no hooks.** Wrong — Codex shipped a hooks framework with lifecycle events and a `notify` external-program config. Web search caught it.
- **Initially overlooked `Monitor`** as a Claude Code internal tool already in the agent's tool list. Proposed bash polling tricks before realising the cleanest path was already in hand.
- **Initially recommended MCP server-push as "the right answer."** Still architecturally right; not deliverable as an *outcome* on any client today.

Decisions here are loosely held. If a contributor finds a sixth option we missed, file an issue.

## When to revisit

Add a row to the mechanisms table — and likely simplify the layered design — the day any of these lands:

- **Claude Code routes arbitrary server-initiated notifications** (not just `list_changed` and elicitation) to the agent's context → drop the `watch` subprocess, push from the server.
- **Codex / Cursor / Cline / Windsurf ship a `Monitor`-equivalent** → extend the system-prompt rule with their tool name. The rule is capability-described on purpose so this is a one-line change, not a redesign.
- **The MCP spec adds an explicit "agent-context message" notification method** that all clients commit to surfacing.

Don't add Streamable HTTP transport just for this. The room-on-disk model + WAL handles the same-machine case. HTTP is a separate decision driven by cross-machine workflows — see [ROADMAP.md](../../ROADMAP.md).

## So what?

Two implications for contributors:

1. **`listen` and `inbox` are the floor and they stay.** Don't propose ripping them out for a "cleaner" mechanism — they're the only thing that works on every client today.
2. **The system-prompt rule is capability-described, not tool-named.** Adding a new client's equivalent of `Monitor` should be a one-line addition to the rule, not a new layer. If a proposed change requires a new layer, that's a yellow flag — re-read this doc first.

## Sources

- [MCP spec 2025-11-25 — server-initiated requests, async tasks, elicitation overview](https://workos.com/blog/mcp-2025-11-25-spec-update)
- [MCP Elicitation specification](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)
- [Claude Code Hooks reference (Stop, SubagentStop, UserPromptSubmit, …)](https://code.claude.com/docs/en/hooks)
- [Claude Code MCP Elicitation — v2.1.76 release](https://claudelab.net/en/articles/claude-code/mcp-elicitation-support)
- [Codex Hooks reference](https://developers.openai.com/codex/hooks)
- [Codex Advanced Configuration — `notify`](https://developers.openai.com/codex/config-advanced)
- [Codex MCP server-driven elicitation PR #17043](https://github.com/openai/codex/pull/17043)
- [Cline elicitation discussion #4522](https://github.com/cline/cline/discussions/4522)
- [Best MCP Clients in 2026 (compatibility survey)](https://nimbalyst.com/blog/best-mcp-clients-2026/)

---

_Last updated: 2026-05-09._
