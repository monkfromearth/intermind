[← Previous: Prior art](./06-prior-art.md) · [Index](../README.md)

---

# 07 · Glossary

Quick reference for the terms used throughout the rest of the docs and the codebase.

### MCP (Model Context Protocol)
Open protocol for connecting AI applications to tools and data. JSON-RPC 2.0 over a transport. See [`01-mcp-primer.md`](./01-mcp-primer.md).

### Host
The user-facing AI application (Claude Code, Codex CLI). Owns the LLM and the user.

### Client
The connection inside a host that talks to one MCP server. A host has many clients.

### Server
A process exposing capabilities (tools, resources, prompts). **Intermind is a server.**

### Tool
A typed action the LLM can invoke through MCP. e.g. `send_message`. Intermind exposes exactly six tools.

### Resource
Read-only addressable data exposed by a server. e.g. `agents://`, `threads://thr_42`.

### Prompt
A pre-written prompt template a server offers, often surfaced as a slash command. Intermind doesn't use these.

### Sampling
A *client* capability: the server can ask the calling client's LLM to produce a completion. Routes back to the same caller — not a peer-messaging mechanism.

### Elicitation
A *client* capability: the server can ask the user (via the calling client) for structured input.

### Roots
A *client* capability: the server can ask the client what filesystem/URL boundaries it's allowed to operate inside.

### Transport
How JSON-RPC bytes move between client and server. Two common ones:

### stdio
Subprocess transport — host launches the server, pipes JSON over stdin/stdout. Local only.

### Streamable HTTP
HTTP-based transport with bidirectional streaming. Replaced HTTP+SSE in the 2025-03-26 spec. For remote/multi-host setups.

### Agent
In Intermind: a registered, identified MCP client (Claude Code, Codex, etc.). Has an `agent_id`, a `display_name`, and a `role`.

### Mailbox
The metaphor for how Intermind delivers messages — agents read pending messages addressed to them via `inbox` or block on `wait_for_reply`. Intermind's *entire* product surface is the mailbox.

### Thread
A grouped sequence of messages on the same topic, identified by `thread_id`. Reviews, hand-offs, and any back-and-forth conversation are threads.

### Long-poll
A way for an agent to wait efficiently for new messages: it calls `wait_for_reply`, the server holds the call open until a message arrives or a timeout hits. Avoids both the latency of short-polling and the complexity of true server-push.

### Scope (Claude Code)
Where an MCP server is registered: `user` (global), `project` (committed to repo as `.mcp.json`), or `enterprise` (managed by IT).

### A2A (Agent2Agent)
Google-led protocol for direct agent-to-agent communication. Complementary to MCP. We're not using it; see [`06-prior-art.md`](./06-prior-art.md).

## Sources

- MCP spec (definitions of tool/resource/prompt/sampling/elicitation/roots/transport): https://modelcontextprotocol.io/specification/2025-11-25
- Claude Code scopes: https://code.claude.com/docs/en/mcp
- A2A protocol: https://a2aprotocol.ai/

---

[← Previous: Prior art](./06-prior-art.md) · [Index](../README.md)
