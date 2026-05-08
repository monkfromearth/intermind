<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./logos/Intermind%20-%20Typography%20-%20White.svg">
    <img alt="Intermind" src="./logos/Intermind%20-%20Typography%20-%20Black.svg" width="280">
  </picture>
</p>

# Intermind documentation

Two kinds of docs live here.

**Guides** are for *users* — people who want to install Intermind, wire it into their coding agent, and start running multi-agent conversations. Read these first.

**Knowledge base** is for *contributors* — explainers for people who want to understand the design choices behind Intermind, what MCP is, and why we built things the way we did. Read these if you're considering a PR or you're just curious.

> **Scope reminder.** Intermind 0.0.1 is *just messaging* between coding agents — six tools, a thread model, nothing else. No tasks, no shared key/value store, no first-class diff or review types. If you see those mentioned anywhere in these docs, it's a stale reference and a PR to delete it is welcome.

---

## Guides — how to use Intermind

| Doc | What it answers |
| --- | --- |
| [`guides/tools.md`](./guides/tools.md) | What does each tool do? Parameters, return shapes, errors, examples. The full API reference. |
| [`guides/clients.md`](./guides/clients.md) | How do I wire Intermind into my MCP client? Copy-paste snippets for Claude Code, Claude Desktop, Codex, Cursor, Cline, Windsurf, VS Code, Zed, Continue. |
| [`guides/recipes.md`](./guides/recipes.md) | How do I do the review loop / async coordination / broadcast / hand-off pattern? Copy-paste conversation templates and a system-prompt snippet. |
| [`guides/troubleshooting.md`](./guides/troubleshooting.md) | Why don't I see the tools? Why are my agents in different rooms? `wait_for_reply` is timing out. How do I wipe state? How do I get help? |

---

## Knowledge base — why Intermind looks this way

Read in order, or skip to whichever question is biting you.

1. [`knowledge-base/01-mcp-primer.md`](./knowledge-base/01-mcp-primer.md) — what the Model Context Protocol actually is, in 5 minutes.
2. [`knowledge-base/02-coding-agent-mcp-clients.md`](./knowledge-base/02-coding-agent-mcp-clients.md) — how Claude Code and Codex use MCP (and how they differ).
3. [`knowledge-base/03-transports.md`](./knowledge-base/03-transports.md) — stdio vs Streamable HTTP, and when each one matters.
4. [`knowledge-base/04-why-intermind.md`](./knowledge-base/04-why-intermind.md) — the gap in MCP that Intermind fills, and why a server is the right shape.
5. [`knowledge-base/05-coordination-model.md`](./knowledge-base/05-coordination-model.md) — the mailbox model: identity, threads, broadcasts, long-poll.
6. [`knowledge-base/06-prior-art.md`](./knowledge-base/06-prior-art.md) — Agent-MCP, A2A, and how Intermind relates to them.
7. [`knowledge-base/07-glossary.md`](./knowledge-base/07-glossary.md) — quick reference for the terms used everywhere else.

---

## House rules for these docs

- Each doc should read in under 5 minutes.
- Link to authoritative sources at the bottom rather than paraphrasing them at length.
- If a fact in here changes, fix it the same day. Stale docs are worse than no docs.
- Code blocks are copy-paste-runnable. If a reader has to mentally substitute something, name what to substitute right above the block.
