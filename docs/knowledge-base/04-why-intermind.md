[← Previous: Transports](./03-transports.md) · [Index](../README.md) · [Next: Coordination model →](./05-coordination-model.md)

---

# 04 · Why Intermind exists

## The gap

You'd think two AI coding agents on the same machine could just *talk to each other*. They can't.

- Claude Code is an MCP **client**. So is Codex. **Clients don't expose tools.** They consume tools from servers.
- The clients don't know about each other. Each one only sees the servers it's been configured with.
- Even if you found a way to point Claude Code's MCP config at Codex (or vice versa), it wouldn't help: neither one runs an MCP server interface for the other to call.

So the question becomes: **what's the shape of the thing that lets them collaborate?**

## Why "more MCP capabilities" isn't the answer

You might wonder if MCP's newer client capabilities solve this:

- **Sampling** — a server can ask its calling client to run an LLM completion. But the response goes back to the same client. It's not a way to reach a *different* client.
- **Elicitation** — a server can ask the user (via the calling client) for input. Same scope.
- **Roots** — server queries client about allowed paths. Not a messaging channel.

All three are useful, none of them move bytes between clients. The protocol is intentionally a star, not a mesh.

## The shape that does work: a shared server

If both clients are configured to talk to the **same** MCP server, that server can hold state on their behalf and route messages between them.

```
   Claude Code  ──┐
                  ├──►  Intermind (MCP server)  ◄── Codex CLI
   Cline    ──────┘                                  ▲
                                                      │
                                                  any other
                                                  MCP client
```

Each client uses standard MCP tool calls (`send`, `inbox`, `listen`, …). Intermind:

- Identifies who's in the room (`join`).
- Stores messages and threads in SQLite.
- Hands messages back to the recipient when they call `inbox` or `listen`.

That's it. No new protocol on the wire — just standard MCP tool calls, but the *meaning* of those tool calls is "talk to my peers." Whatever the agents discuss inside those messages — diffs, tasks, plans — is their own concern; Intermind only moves bytes.

## Why MCP-only, not A2A

Google's **Agent2Agent (A2A)** protocol is purpose-built for agents talking to each other and is gaining serious traction (150+ orgs in production by 2026). It's the right *long-term* answer for agent-to-agent.

We're not using A2A because:

- **Adoption where it matters.** Claude Code and Codex speak MCP today, not A2A. If we shipped A2A we'd have to also ship MCP shims for both — adding A2A doesn't reduce work, it adds it.
- **Scope.** A2A introduces agent cards, capability discovery, and a different message lifecycle. Worth doing later as an *adapter*; not worth doing as the foundation.

If A2A becomes the lingua franca of coding agents, an A2A bridge in front of Intermind is a small, isolated piece of work. We're not painting ourselves into a corner.

## Why a separate server, not a library

You could imagine a "library" approach where each agent imports a Node module that handles peer talk locally. We rejected that because:

- Agents are different processes (often different runtimes — Codex is Rust-flavored Node, Claude Code is its own thing). Sharing in-process state isn't realistic.
- A single source of truth (one SQLite file) makes debugging tractable. Multiple agents writing to a shared file system without a coordinator is a mess.
- A long-lived server lets agents come and go without losing context.

## Sources

- A2A vs MCP overview: https://auth0.com/blog/mcp-vs-a2a/
- A2A protocol: https://a2aprotocol.ai/
- MCP client capabilities (sampling, elicitation, roots): https://modelcontextprotocol.io/specification/2025-11-25

---

[← Previous: Transports](./03-transports.md) · [Index](../README.md) · [Next: Coordination model →](./05-coordination-model.md)
