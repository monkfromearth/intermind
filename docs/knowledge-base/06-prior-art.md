[← Previous: Coordination model](./05-coordination-model.md) · [Index](../README.md) · [Next: Glossary →](./07-glossary.md)

---

# 06 · Prior art and how Intermind relates

Intermind is not the first attempt at multi-agent collaboration. Here's the landscape and where we sit in it.

## Agent-MCP (rinadelph/Agent-MCP)

Closest existing project. Python, uses MCP, has explicit `send_agent_message` / `broadcast_message` tools, plus a RAG-backed shared knowledge graph and file-level locking.

**What we borrow:**
- The basic shape: register agents, message them, share context.
- The lesson that asynchronous coordination via shared memory beats chatty synchronous calls.

**Where we deliberately diverge:**
- **Language:** TypeScript on Bun, matching the runtime Codex/Claude Code users already have around. Single-file install, no Python toolchain.
- **Locking:** Agent-MCP gates file writes through advisory locks held by the server. We don't — Intermind never writes to the working tree, so there's nothing for it to lock. Coordination of "who edits what" is entirely the agents' job, conveyed through ordinary messages.
- **Capacity model:** Agent-MCP hard-caps at 10 active agents and aggressively reaps idle ones. We don't impose a cap; agents register and stay until they disconnect.
- **Knowledge:** Agent-MCP ships a RAG layer day one. We ship messaging only — if agents want shared notes, they post to a thread. Retrieval/knowledge is out of scope for now.

Link: https://github.com/rinadelph/Agent-MCP

## A2A (Agent2Agent) protocol

Google-led, designed specifically for agent-to-agent communication, governed by the Agentic AI Foundation alongside MCP. By 2026 it has 150+ orgs running A2A in production, mostly in enterprise multi-agent stacks.

Why we're not building on A2A right now: see [`04-why-intermind.md`](./04-why-intermind.md). Short version: today's coding CLIs speak MCP, not A2A. We can add an A2A adapter later as a separate process in front of Intermind without rewriting anything.

Link: https://a2aprotocol.ai/

## mcp-agent (lastmile-ai/mcp-agent)

A library for *building* agents using MCP and simple workflow patterns. Different layer from us — they help you write an agent; we help two agents that already exist talk to each other. Complementary, not overlapping.

Link: https://github.com/lastmile-ai/mcp-agent

## Codex-as-MCP-server wrappers

Several projects (`tuannvm/codex-mcp-server`, `cexll/codex-mcp-server`) wrap the Codex CLI so other clients can call Codex as a tool. Useful in single-direction scenarios ("Claude, ask Codex to do X"), but they're not multi-agent — they're a one-way bridge. Intermind is bidirectional and N-way.

## Where Intermind sits

| | Multi-agent | Coding-agent ergonomics | MCP-native | Lightweight |
| --- | --- | --- | --- | --- |
| Agent-MCP | ✔ | partial | ✔ | python deps |
| A2A protocols | ✔ | ✘ (general agents) | separate stack | heavy |
| mcp-agent | ✘ (single-agent lib) | n/a | ✔ | ✔ |
| Codex wrappers | ✘ (one-way) | ✔ | ✔ | ✔ |
| **Intermind** | **✔** | **✔** | **✔** | **✔** |

That's the bet: a small TypeScript MCP server, focused on *coding* agents, that does the messaging loop and nothing else.

## Sources

- Agent-MCP (Python prior art): https://github.com/rinadelph/Agent-MCP
- A2A protocol: https://a2aprotocol.ai/
- mcp-agent (lastmile-ai): https://github.com/lastmile-ai/mcp-agent
- Codex MCP wrapper (one example): https://github.com/tuannvm/codex-mcp-server

---

[← Previous: Coordination model](./05-coordination-model.md) · [Index](../README.md) · [Next: Glossary →](./07-glossary.md)
