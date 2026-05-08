[← Index](../README.md)

---

# Recipes

Common multi-agent patterns, with the exact tool calls.

These are written as if you (the human) are prompting a coding agent — the agent does the actual MCP calls. The square-bracketed bits show the JSON the agent passes.

> **The shortest mental model.** A thread is a folder. `send_message` puts a note in it; `inbox` and `wait_for_reply` take notes out. That's the whole product.

## 1. The review loop

Two agents — one implementer, one reviewer — iterate on a patch.

**Setup:**
1. In the implementer's agent (e.g. Claude Code) you say: *"Hop on Intermind as Claude, the implementer."* Under the hood:
   ```
   register_agent { display_name: "Claude", role: "implementer" }
   ```
2. In the reviewer's agent (e.g. Codex) you say: *"Get on Intermind as Codex, the reviewer, and wait for review requests."* Under the hood:
   ```
   register_agent { display_name: "Codex", role: "reviewer" }
   list_agents { token }
   ```

**The loop:**
3. Implementer sends a patch:
   ```
   send_message {
     to:   "agt_codex_...",
     body: "please review this patch:\n```diff\n...\n```"
   }
   → returns thread_id "thr_..."
   ```
4. Reviewer is long-polling on the inbox or a thread:
   ```
   wait_for_reply { thread_id: "thr_...", timeout_sec: 60 }
   ```
   The patch arrives. The reviewer's LLM reads the diff and replies on the same thread:
   ```
   send_message { to: "agt_claude_...", thread_id: "thr_...", body: "fix line 42; counter-patch:\n..." }
   ```
5. Implementer's agent (which was also waiting) now receives the reply and applies the fix locally.
6. Repeat 3–5 until both agents agree.

**Why threads matter here.** Without `thread_id`, every reply would start a fresh conversation and the agents would lose context across rounds. Always pass the same `thread_id` while you're inside one logical exchange.

---

## 2. Async coordination — work in parallel, don't block

You want the implementer to keep working while the reviewer reviews.

**Implementer's flow:**
```
send_message { to: "agt_codex_...", body: "draft 1 of parser fix:\n..." }
→ thread_id "thr_A"

# Don't call wait_for_reply here. Just keep working.
# Periodically:
inbox { mark_read: false }
# Look for messages on thr_A. If there's one, address it. If not, keep going.
```

**Reviewer's flow:**
```
inbox { }                 # at start of each turn
# If anything's in the inbox, reply. Otherwise nothing to do.
```

**Why `mark_read: false` here.** The implementer wants to peek without consuming, because they're not committing to handle the reply right now — they're just deciding whether to interrupt their current work.

---

## 3. Broadcast — announce to everyone in the room

Use `to: "*"` when the message isn't addressed to a specific peer.

```
send_message { to: "*", body: "starting refactor of parser/ — heads up if you're touching it" }
```

The server expands the broadcast to every other registered agent. The sender does **not** receive their own broadcast.

**Edge case.** If you broadcast and you're the only agent registered, the call returns:

```json
{ "delivered": [], "warning": "no other agents are registered; broadcast had nowhere to go" }
```

That's a no-op, not an error. Useful when you can't predict whether anyone else has joined yet.

---

## 4. Parallel threads — multiple conversations at once

Threads are independent. An agent can be in any number of them simultaneously, and `wait_for_reply` only ever returns messages on the thread you specify.

```
# Thread A — discussing the parser bug
send_message { to: "agt_codex_...", body: "...", thread_id: "thr_parser" }

# Thread B — discussing the database migration, unrelated
send_message { to: "agt_codex_...", body: "...", thread_id: "thr_migration" }
```

`wait_for_reply { thread_id: "thr_parser" }` only resolves when something arrives on `thr_parser`, even if `thr_migration` has unread messages. Use `inbox` (no thread filter) to drain whatever's pending across all threads.

---

## 5. Catching up after a reconnect

An MCP client crash means the agent's session token is gone. When it restarts, it has to re-register — but the *messages* are still in SQLite, addressed to the old `agent_id`. There are two options:

**Option A — read history before re-registering** (preferred for short outages):

```
list_agents { token }       # find your old agent_id by display_name
inbox { token, mark_read: false, limit: 100 }    # peek at history
```

This works because tokens belong to the agent, not the session — the row in `agents` persists across crashes.

**Option B — register a fresh identity.** Pick this if the previous session was abandoned and you want a clean slate. You'll lose access to the old inbox, but new conversations work normally.

There's no "delete an agent" tool. If you want to wipe state entirely, delete `~/.intermind/state.db` (or whatever `INTERMIND_DB` points to).

---

## 6. Hand-off — agent A finishes a task, agent B picks it up

```
# Agent A signals done:
send_message {
  to:        "agt_b_...",
  thread_id: "thr_handoff",
  body:      "draft is on `feature/parser-fix`. ready for you to take over."
}

# Agent B was waiting:
wait_for_reply { thread_id: "thr_handoff", timeout_sec: 300 }
# Receives the message, then proceeds.
```

Keep the thread open across the hand-off so context (earlier discussion of the approach, etc.) stays grouped.

---

## 7. System prompt addition for your agent

Drop this into your agent's system prompt or initial message so its LLM knows how and when to use Intermind. **Copy-paste:**

```
You have access to Intermind, an MCP server for talking to other coding agents
working on this same project. Use it to coordinate handoffs, request reviews,
and broadcast announcements. The tools are:

- register_agent(display_name, role): call ONCE per session before any other
  Intermind tool. Save the returned `token` for every later call.
- list_agents(token): see who else is connected. Run this when you start work
  to know who to talk to.
- send_message(token, to, body, thread_id?): DM another agent (use their
  agent_id) or broadcast (`to: "*"`). Pass `thread_id` to continue a previous
  conversation; omit it to start a new one.
- inbox(token, mark_read?, limit?): pull pending messages addressed to you.
  Returns oldest-first. Marks them read by default.
- wait_for_reply(token, thread_id, timeout_sec?): block until the next
  message on a thread arrives. Use this when you've asked a peer for input
  and have nothing useful to do until they reply.
- whoami(token): confirm your identity. Useful for sanity checks.

Conventions:
- Always register before doing anything else.
- Always pass `thread_id` when replying to keep conversations grouped.
- Free-form text in `body`. Diffs go in fenced code blocks. Intermind never
  inspects the body — it just moves bytes.
- If `wait_for_reply` times out, the peer hasn't replied yet. Decide whether
  to wait again, fall back to working alone, or message someone else.
```

Adjust the role and tone for your specific agent.

---

[← Index](../README.md) · [← Tools](./tools.md) · [← Clients](./clients.md) · [Troubleshooting →](./troubleshooting.md)
