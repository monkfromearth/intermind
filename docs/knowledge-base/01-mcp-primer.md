[Index](../README.md) · [Next: Coding-agent MCP clients →](./02-coding-agent-mcp-clients.md)

---

# 01 · MCP primer

The **Model Context Protocol (MCP)** is an open protocol — backed by Anthropic, OpenAI, Google, Microsoft, AWS, and ~150 other organizations under the Linux Foundation's Agentic AI Foundation as of 2026 — that lets an AI application talk to external tools, data, and systems through a single, standard interface.

Think of it as the "USB-C for LLMs": one cable, many devices.

## The three roles

- **Host** — the application a user runs (e.g. Claude Code, Codex, Cursor). It owns the LLM and the user.
- **Client** — a connection inside the host, one per MCP server it talks to. Hosts can have many clients.
- **Server** — a process exposing capabilities. Tools, files, prompts, etc. **Intermind is a server.**

> Coding CLIs (Claude Code, Codex) are hosts/clients. They *consume* MCP servers. They are not themselves MCP servers, and they don't expose anything to other clients. This single fact drives Intermind's whole design.

## How they talk

JSON-RPC 2.0 messages over a transport (stdio or Streamable HTTP — see [`03-transports.md`](./03-transports.md)). The first thing client and server do is **capability negotiation**: each side declares what it supports, and they only use features both ends agreed to.

## What a server can offer (server primitives)

- **Tools** — actions the LLM can invoke, with typed inputs and outputs. e.g. `send_message`, `inbox`. Intermind's entire surface is tools (six of them) plus a couple of resources.
- **Resources** — addressable read-only data, like files. e.g. `agents://`, `threads://`. The host can list and read them without a tool call.
- **Prompts** — pre-written prompt templates the host can show the user as slash commands. Optional; Intermind doesn't ship any.

## What a client can offer (client capabilities)

These are things the *server* can ask the *client* to do mid-operation:

- **Sampling** — server asks the client's LLM to produce a completion. Useful when the server needs reasoning but doesn't want to hold its own API key.
- **Elicitation** — server pauses and asks the user (via the client) for structured input. e.g. "which file should I patch?"
- **Roots** — server asks the client what filesystem/URL boundaries it's allowed to operate within.

> **Critical point for Intermind:** sampling, elicitation, and roots all route back to the *same client that invoked the server*. None of them deliver anything to a *different* client. So they cannot, by themselves, move messages from Claude Code to Codex. That's why Intermind needs its own mailbox — see [`04-why-intermind.md`](./04-why-intermind.md).

## Sources

- Spec (current, 2025-11-25): https://modelcontextprotocol.io/specification/2025-11-25
- 2026 roadmap: https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/
- TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk

---

[Index](../README.md) · [Next: Coding-agent MCP clients →](./02-coding-agent-mcp-clients.md)
