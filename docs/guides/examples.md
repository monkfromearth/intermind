[← Index](../README.md)

---

# Examples

Common multi-agent patterns, with the exact tool calls.

These are written as if you (the human) are prompting a coding agent — the agent does the actual MCP calls. The square-bracketed bits show the JSON the agent passes.

> **The shortest mental model.** A thread is a folder. `send` puts a note in it; `inbox` and `listen` take notes out. That's the whole product.

## 1. The review loop

Two agents — one implementer, one reviewer — iterate on a patch.

**Setup:**
1. In the implementer's agent (e.g. Claude Code) you say: *"Hop on Intermind as Claude, the implementer."* Under the hood (it picks `room` from the current git branch, e.g. `feature-parser-fix`):
   ```
   join { display_name: "Claude", role: "implementer", room: "feature-parser-fix" }
   ```
   Then it tells you: *"I'm in Intermind room 'feature-parser-fix'."* — that's your cue to tell the reviewer's agent to use the same name.
2. In the reviewer's agent (e.g. Codex) you say: *"Get on Intermind as Codex, the reviewer, in room 'feature-parser-fix', and wait for review requests."* Under the hood:
   ```
   join { display_name: "Codex", role: "reviewer", room: "feature-parser-fix" }
   peers { token }
   ```

**The loop:**
3. Implementer sends a patch:
   ```
   send {
     to:   "agt_codex_...",
     body: "please review this patch:\n```diff\n...\n```"
   }
   → returns thread_id "thr_..."
   ```
4. Reviewer is long-polling on the inbox or a thread:
   ```
   listen { thread_id: "thr_...", timeout_sec: 60 }
   ```
   The patch arrives. The reviewer's LLM reads the diff and replies on the same thread:
   ```
   send { to: "agt_claude_...", thread_id: "thr_...", body: "fix line 42; counter-patch:\n..." }
   ```
5. Implementer's agent (which was also waiting) now receives the reply and applies the fix locally.
6. Repeat 3–5 until both agents agree.

**Why threads matter here.** Without `thread_id`, every reply would start a fresh conversation and the agents would lose context across rounds. Always pass the same `thread_id` while you're inside one logical exchange.

---

## 2. Async coordination — work in parallel, don't block

You want the implementer to keep working while the reviewer reviews.

**Implementer's flow:**
```
send { to: "agt_codex_...", body: "draft 1 of parser fix:\n..." }
→ thread_id "thr_A"

# Don't call listen here. Just keep working.
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
send { to: "*", body: "starting refactor of parser/ — heads up if you're touching it" }
```

The server expands the broadcast to every other agent **in your room**. The sender does **not** receive their own broadcast, and agents in other rooms (different `room` name on `join`) are invisible — they don't see it.

**Edge case.** If you broadcast and you're the only agent in the room, the call returns:

```json
{ "delivered": [], "warning": "no other agents are registered; broadcast had nowhere to go" }
```

That's a no-op, not an error. Useful when you can't predict whether anyone else has joined yet.

---

## 4. Parallel threads — multiple conversations at once

Threads are independent. An agent can be in any number of them simultaneously, and `listen` only ever returns messages on the thread you specify.

```
# Thread A — discussing the parser bug
send { to: "agt_codex_...", body: "...", thread_id: "thr_parser" }

# Thread B — discussing the database migration, unrelated
send { to: "agt_codex_...", body: "...", thread_id: "thr_migration" }
```

`listen { thread_id: "thr_parser" }` only resolves when something arrives on `thr_parser`, even if `thr_migration` has unread messages. Use `inbox` (no thread filter) to drain whatever's pending across all threads.

---

## 5. Catching up after a reconnect

An MCP client crash means the agent's session token is gone. When it restarts, it has to re-`join` — but the *messages* are still in SQLite, addressed to the old `agent_id`. There are two options:

**Option A — read history before rejoining** (preferred for short outages):

```
peers { token }       # find your old agent_id by display_name
inbox { token, mark_read: false, limit: 100 }    # peek at history
```

This works because tokens belong to the agent, not the session — the row in `agents` persists across crashes.

**Option B — join with a fresh identity.** Pick this if the previous session was abandoned and you want a clean slate. You'll lose access to the old inbox, but new conversations work normally.

There's no "delete an agent" tool. If you want to wipe state entirely, delete `~/.intermind/state.db` (or whatever `INTERMIND_DB` points to).

---

## 6. Hand-off — agent A finishes a task, agent B picks it up

```
# Agent A signals done:
send {
  to:        "agt_b_...",
  thread_id: "thr_handoff",
  body:      "draft is on `feature/parser-fix`. ready for you to take over."
}

# Agent B was waiting:
listen { thread_id: "thr_handoff", timeout_sec: 300 }
# Receives the message, then proceeds.
```

Keep the thread open across the hand-off so context (earlier discussion of the approach, etc.) stays grouped.

---

## 7. System prompt block — make agents proactive

Coding agents are turn-based. Without an explicit instruction, they'll happily ignore Intermind for the whole session and ask *"should I check messages?"* every turn. Drop this block into your agent's persistent prompt — Claude Code's `CLAUDE.md`, Codex's `~/.codex/AGENTS.md`, Cursor's `.cursorrules`, etc. **Copy-paste:**

```
You have access to Intermind, an MCP server for talking to OTHER coding
agents working on this project. A peer's message is equivalent to a user
request — answer it as promptly and seriously as you'd answer me.

TOOLS:
- join(display_name, role, room?): once per session, before any other
  Intermind tool. Pick a `room` name. If you're inside a git repo, use
  the current branch (run `git branch --show-current`); otherwise pick
  a short kebab-case label from project context. Defaults to "main"
  if omitted. Save the returned `token` — every later call needs it.
- whoami(token): sanity check your identity.
- peers(token): list the OTHER agents in your room (excludes you).
- send(token, to, body, thread_id?): DM a peer (their agent_id) or
  broadcast (`to: "*"` — fans out only inside your room). Pass
  `thread_id` on replies to stay in the same conversation; omit it
  to start a new one.
- inbox(token, mark_read?, limit?): pull pending messages addressed to
  you. Marks read by default.
- listen(token, thread_id, timeout_sec?): block until the next message
  on a thread arrives. Use when you've sent something and have nothing
  useful to do until your peer replies.

PROACTIVE BEHAVIOR (this is what makes the loop work):
1. AT THE START OF EVERY TURN, before doing anything else, call `inbox`.
   If there's a peer message, treat it like a user request and answer it
   first — don't ask me whether to reply.
2. IF YOUR HOST EXPOSES A BACKGROUND-EVENT TOOL (Claude Code: `Monitor`),
   spawn `intermind watch --token <your_token>` through it ONCE, right
   after `join`, with persistent=true. Each emitted line is JSON for a
   new peer message — when one arrives mid-turn, treat it like a user
   request, reply on the same `thread_id`, and resume what you were
   doing. Do NOT spawn a second watcher per turn. Without a background
   tool, rule 1 (inbox at turn start) is the floor.
3. RIGHT AFTER `join`, tell me the room name you picked, in plain words:
   "I'm in Intermind room 'feature-auth'." I need this so I can tell
   the OTHER agent(s) on this feature to join the same room — they
   can't see you otherwise. If `join` returns a `hint` (room_size 0),
   surface the hint verbatim too.
4. After `send`, do NOT yield back to me with "I sent the message, want
   me to wait?". Either keep working on something useful, or call
   `listen` on the same thread to keep the conversation hot in this turn.
5. After answering a peer message, narrate what they said and what you
   replied — I want to follow the conversation without reading SQLite.
6. ALWAYS pass `thread_id` on replies. Starting a new thread for a reply
   makes the peer's `listen` time out for no reason.
7. When `listen` times out, fall back to one more `inbox` (in case they
   started a new thread), then either work alone or message someone else.

CONVENTIONS:
- Free-form text in `body`. Diffs in fenced code blocks. Intermind never
  inspects the body — it just moves bytes.
- Agents in different rooms are invisible. If `peers` is empty, either
  you're alone in this room or your peer joined a different room name.
```

Adjust the role and tone for your specific agent. Then see example 8 for the *guaranteed* version of rule 1.

---

## 8. Claude Code hook — guarantee `inbox` runs every turn

Rule 1 of the system prompt above ("call `inbox` at the start of every turn") is a soft instruction the model can forget. Claude Code's [`UserPromptSubmit` hook](https://code.claude.com/docs/en/hooks) lets you run a shell command *before* the prompt is dispatched to the model, with the result injected into the model's context. That makes "did you check the inbox" no longer a question — the inbox is already in the context.

Add this to `.claude/settings.json` (project-scoped) or `~/.claude/settings.json` (user-scoped):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "sqlite3 \"${INTERMIND_DB:-$HOME/.intermind/state.db}\" \"SELECT 'INTERMIND PENDING (treat each as a user request, reply on the same thread_id): ' || group_concat(printf('[%s from=%s thread=%s] %s', datetime(created_at/1000, 'unixepoch'), from_agent, thread_id, substr(body, 1, 200)), char(10)) FROM messages WHERE read_at IS NULL\" 2>/dev/null"
          }
        ]
      }
    ]
  }
}
```

What it does, plain English: every time you (the human) send a prompt to Claude Code, the hook reads the SQLite file directly and prepends a one-line summary of every unread message to the model's context. The model literally cannot start a turn without seeing pending peer messages. The summary is read-only — it does *not* mark messages read, so the agent still calls `inbox` (or `listen`) to consume them properly via the bearer-token path.

Why query SQLite directly instead of calling the `inbox` MCP tool from the hook? Two reasons. First, hooks run before tool calls, so there's no MCP session yet. Second, the hook has no session token; reading the table directly is the only option, and it's safe because Claude Code is the local user and the file is in their home directory.

**Codex / Cursor / others:** they don't expose a pre-prompt hook today. Rely on the system prompt block in example 7. The model is significantly more reliable about rule 1 once the imperative tool descriptions in `0.0.3` are in scope ("Call this at the START of every turn …" is baked into the `inbox` tool's MCP description).

---

## 9. Claude Code `Monitor` + `intermind watch` — mid-turn delivery

The hook in example 8 fires only at turn boundaries. A peer's message that lands *during* a turn still has to wait for either the agent's next `listen`/`inbox` call or the next `UserPromptSubmit`. Claude Code's [`Monitor` tool](https://code.claude.com/docs/en/) closes the gap: it streams stdout from a background subprocess into the agent's context as notifications, mid-flow.

Intermind ships a binary subcommand designed for exactly this:

```
intermind watch --token <your_session_token>
```

It opens the same SQLite file the MCP server opens (honouring `INTERMIND_DB`), polls every 200 ms (matches `listen`), and prints **one JSON line per new message addressed to the token's owner**:

```json
{"id":"msg_…","thread_id":"thr_…","from_agent":"agt_…","body":"…","created_at":1715260000000}
```

Read-only by design — the watcher does **not** mark messages read. The agent still consumes through `inbox`/`listen` so the bearer-token auth check runs once per consume.

**Wire-up.** No config files to edit. The system-prompt block (example 7, rule 2) tells the agent: right after `join`, spawn `intermind watch --token <token>` via `Monitor` with `persistent=true`. Claude Code keeps the subprocess alive for the whole session; each emitted line becomes a notification visible mid-turn.

**Manual smoke test** (run in two terminals):

```bash
# Terminal 1 — pretend to be Agent A waiting for messages
intermind watch --token tok_aaa
# (sits there, prints one JSON line per arriving message)

# Terminal 2 — pretend to be Agent B sending one
# (or use any MCP client wired to the same INTERMIND_DB)
```

You should see Terminal 1 print a JSON line within 200 ms of the send. `Ctrl+C` exits cleanly.

**Why a subprocess instead of an MCP server-push?** MCP 2025-11-25 has the protocol-correct primitive (server-initiated requests/notifications), but no popular client routes arbitrary server notifications into the agent's context today. Elicitation is server-to-*user*, not server-to-*agent-context*. The watch subprocess is the only mechanism that surfaces a peer message into Claude Code's agent context mid-turn today. The day a client routes server notifications, we drop the subprocess. Full reasoning: [`docs/decisions/0001-message-delivery.md`](../decisions/0001-message-delivery.md).

**Other clients:** `Monitor` is Claude Code-specific. Cursor, Cline, Windsurf, Continue, Zed, and Codex don't expose an equivalent today, so they fall back to the floor — `inbox` at turn start (example 7, rule 1) plus `listen` for blocking waits.

---

## 10. Claude Code `Stop` hook — guarantee `inbox` runs at turn exit too

The `UserPromptSubmit` hook from example 8 covers the *entry* side of every turn. The matching exit-side hook is [`Stop`](https://code.claude.com/docs/en/hooks): it fires when Claude is about to yield control back to you, and it can return a blocking signal that tells Claude *"keep working — don't stop yet."* That makes "did the agent reply to the message that landed mid-turn" no longer a question — if the inbox has anything, the model is forced to handle it before the turn ends.

Add to `.claude/settings.json` or `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "test -n \"$(sqlite3 \"${INTERMIND_DB:-$HOME/.intermind/state.db}\" 'SELECT id FROM messages WHERE read_at IS NULL LIMIT 1' 2>/dev/null)\" && printf '%s' '{\"decision\":\"block\",\"reason\":\"Intermind has unread peer messages — call inbox and reply on the same thread_id before yielding.\"}' || true"
          }
        ]
      }
    ]
  }
}
```

Plain English: the hook checks SQLite for any unread message. If there's at least one, it returns a JSON object with `"decision":"block"` and a reason — Claude Code feeds the reason back into the model's context and resumes the turn. If the inbox is empty, the hook outputs nothing and the turn ends normally.

Pair this with the `UserPromptSubmit` hook (example 8) and the `Monitor` watcher (example 9) and you have all three timing windows covered: turn entry, mid-turn, turn exit.

---

## 11. Codex `notify` — drain inbox on session events

Codex doesn't have a `Monitor`-equivalent tool today. What it does have is a `notify` field in `~/.codex/config.toml` that runs an external program on session events (turn complete, error, approval request, etc.). It runs *outside* the agent's context — useful for desktop toasts when *your own* Codex finishes — but not the same primitive as Claude Code's `Stop` hook.

For Codex, lean on the system prompt block (example 7) plus a one-line addition to `~/.codex/AGENTS.md`:

```
INTERMIND IS PROACTIVE. Treat a peer's message exactly like a user
request. Call `inbox(token)` first thing every turn. After answering
a peer, narrate the exchange in chat so I can follow.
```

The imperative tool descriptions in 0.0.3 (`inbox` literally starts with *"Call this at the START of every turn …"*) carry the rest of the weight at tool-discovery time.

**A note on the `notify` field.** It's documented in [Codex's advanced config](https://developers.openai.com/codex/config-advanced) — useful for "ping me when Codex finishes a long task," not for "tell Codex to check the inbox." The Codex agent itself doesn't see `notify` output.

---

## 12. Worktrees & per-feature rooms

When BE and FE are working on the same feature in two git worktrees (or two repos), the global default room (`~/.intermind/state.db`) mixes that conversation with everything else on the machine. The fix is a per-feature room: set `INTERMIND_DB` to a feature-specific path that both worktrees agree on.

See [`worktrees.md`](./worktrees.md) for the full pattern (Claude Code `.mcp.json` + Codex `config.toml` snippets).

---

[← Index](../README.md) · [← Tools](./tools.md) · [← Clients](./clients.md) · [Worktrees →](./worktrees.md) · [Troubleshooting →](./troubleshooting.md)
