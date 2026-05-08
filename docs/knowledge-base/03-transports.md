[← Previous: Coding-agent MCP clients](./02-coding-agent-mcp-clients.md) · [Index](../README.md) · [Next: Why Intermind →](./04-why-intermind.md)

---

# 03 · Transports — stdio vs Streamable HTTP

MCP is transport-agnostic. The protocol (JSON-RPC 2.0 messages) is the same; the transport just decides how the bytes flow.

## stdio

The host launches the server as a subprocess and pipes JSON-RPC messages over stdin/stdout.

- **Lifecycle:** server is born when the host starts it, dies when the host exits.
- **Auth:** none. Same machine, same user — local trust.
- **Reach:** local only. The server cannot serve anyone but its parent host.
- **Reconnect:** if a stdio server crashes, hosts generally do not auto-restart it (Claude Code explicitly does not).
- **Best for:** developer-laptop pair-programming. The default for Intermind.

## Streamable HTTP

A long-lived HTTP endpoint that supports both request/response and server-initiated streaming. Replaced HTTP+SSE in the 2025-03-26 spec — **don't ship SSE-only code**.

- **Lifecycle:** independent of any single host. The server is a process you run somewhere.
- **Auth:** bearer tokens, OAuth, etc. Required.
- **Reach:** any host that can reach the URL can connect, and many can connect at once.
- **Reconnect:** clients (e.g. Claude Code) auto-reconnect with backoff.
- **Best for:** multi-host setups (Claude Code on your laptop, Codex Cloud running remotely), Docker, CI agents, teammates collaborating through a shared instance.

## Picking one

For Intermind:

- **stdio is the default.** It's what most users will hit first: one machine, two coding CLIs, one project.
- **Streamable HTTP is opt-in via `--http`.** Same binary, same code paths up to the transport layer.

The choice is per-deployment, not per-feature. Both transports must support the full tool surface; we don't fork features by transport.

## A note on latency

Both transports are plenty fast for our use case. AI agents already spend tens of seconds per turn thinking; an extra 50ms to round-trip a message is invisible. Don't optimise the transport before the loop works.

## Sources

- MCP spec, transports section: https://modelcontextprotocol.io/specification/2025-11-25
- Streamable HTTP example impls: https://github.com/invariantlabs-ai/mcp-streamable-http

---

[← Previous: Coding-agent MCP clients](./02-coding-agent-mcp-clients.md) · [Index](../README.md) · [Next: Why Intermind →](./04-why-intermind.md)
