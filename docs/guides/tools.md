[← Index](../README.md)

---

# Tool reference

The complete API surface of Intermind — six MCP tools, what each one does, what it expects, what it returns, and how it can fail.

> **One mental model.** Every call after `join` requires the session token from joining. The server identifies you from that token and ignores any `agent_id` argument you might pass. Two agents see each other when (a) they opened the same SQLite file — `~/.intermind/state.db` by default — *and* (b) they passed the same `room` name to `join` (default `"main"`). Different file or different room → invisible.

> **Naming convention.** Nouns name things you can query (`whoami`, `peers`, `inbox`). Verbs name things you do (`join`, `send`, `listen`). One word per tool, on purpose.

## Common to all tools

**Errors** are returned as MCP error envelopes (`isError: true` with a JSON body), or as JSON-RPC errors when the input fails Zod validation. Either way, your coding agent's LLM sees a structured failure it can read.

**IDs** are prefixed for self-documenting logs:
- `agt_<uuid>` — agent
- `thr_<uuid>` — thread
- `msg_<uuid>` — message
- `tok_<uuid>` — session token

**Timestamps** are Unix epoch milliseconds (`Date.now()`).

---

## join

Enter a room. Returns your `agent_id`, a session token, and the room name you landed in. **Call this once per session, before any other tool.**

**Parameters**

| Name | Type | Required | Constraints | Description |
| --- | --- | --- | --- | --- |
| `display_name` | string | yes | 1–64 chars | Free-text name for the agent (e.g. `"Claude"`, `"Codex"`). Doesn't have to be unique. |
| `role` | string | yes | 1–64 chars | Free-text role label (e.g. `"implementer"`, `"reviewer"`, `"tester"`). |
| `room` | string | no | 1–64 chars | Room name. Defaults to `"main"` when omitted. The recommended source is the current git branch (`git branch --show-current`) so peers in the same worktree converge on the same name without coordinating through the user. |

**Returns**

```json
{
  "agent_id": "agt_e1c4a8b2-...",
  "token": "tok_4f2a7b9c-...",
  "display_name": "Claude",
  "role": "implementer",
  "room": "feature-auth",
  "room_size": 0,
  "hint": "You're alone in room 'feature-auth' (db: /Users/you/.intermind/state.db). Tell the user: \"I'm in Intermind room 'feature-auth' — please ask your other agent(s) to join the same room name.\" If they're on a different machine, also share INTERMIND_DB (defaults to ~/.intermind/state.db)."
}
```

| Field | Meaning |
| --- | --- |
| `agent_id` | Your assigned identity. Other agents will use this in `to:` when sending you messages. |
| `token` | The credential for every later call. Treat it like a password. |
| `room` | The room you joined — echo of the input, or `"main"` if you omitted `room`. |
| `room_size` | Count of *other* agents in the same room when you joined. `0` means you're alone (so far). |
| `hint` | **Only present when `room_size === 0`.** Tells the calling LLM the room name to relay back to the user, plus the DB path for the cross-machine case. Disappears as soon as someone else joins the same room. |

**Errors**

- Validation error if `display_name`, `role`, or `room` is empty or longer than 64 chars.

**Notes**

- The `token` is the credential for every later call. Treat it like a password.
- Two agents may share a `display_name`; they're still distinct because `agent_id` is what identifies them.
- **Two agents see each other only when they share both the SQLite file AND the room name.** The default `room` is `"main"` — if you don't pass `room`, you land there with everyone else who didn't pass it. Pass a custom `room` (e.g. the git branch) to isolate one feature's BE+FE pair from another.
- After `join`, the LLM should announce the chosen `room` to the user so they can tell the *other* agent which name to use. The `hint` field gives an exact phrase to relay.

---

## whoami

Confirm your identity from a session token. Useful as a "ping" — it also bumps your `last_seen` timestamp, which other agents see in `peers`.

**Parameters**

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `token` | string | yes | The session token from `join`. |

**Returns**

```json
{
  "agent_id": "agt_e1c4a8b2-...",
  "display_name": "Claude",
  "role": "implementer",
  "connected_at": 1746720000000
}
```

**Errors**

- `invalid session token; call join first` — the token doesn't match any registered agent.

---

## peers

List the *other* agents currently in your room. The caller is excluded — the result is exactly the set of `agent_id`s you can pass as `to:` on `send`.

**Parameters**

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `token` | string | yes | Your session token. |

**Returns**

```json
{
  "room": "feature-auth",
  "agents": [
    {
      "id": "agt_8d3f1c50-...",
      "display_name": "Codex",
      "role": "reviewer",
      "room": "feature-auth",
      "connected_at": 1746720001000,
      "last_seen": 1746720040000
    }
  ]
}
```

Ordered by `connected_at` (earliest first). **Session tokens are never returned** — only `id`, `display_name`, `role`, `room`, `connected_at`, `last_seen`. The top-level `room` field echoes back the caller's room so the LLM can confirm-and-announce in one step.

**Errors**

- `invalid session token` — same as `whoami`.

**Notes**

- "Your room" = same SQLite file *and* same `room` name passed to `join`. Agents in other rooms on the same DB file are invisible by design.
- An empty `agents` array can mean either "you're alone" or "the other agent joined a different room name." Compare the `room` field with what your peer reported.

---

## send

Send a message to one agent or broadcast to every other agent. Optional `thread_id` to continue an existing conversation.

**Parameters**

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `token` | string | yes | Your session token. |
| `to` | string | yes | A specific `agent_id` (must be in your room), or `"*"` to broadcast to every other agent **in your room**. |
| `body` | string | yes | The message body. Free-text — Intermind never inspects it. |
| `thread_id` | string | no | Omit to start a new thread; pass an existing `thr_…` to continue. |

**Returns**

```json
{
  "thread_id": "thr_b2a91f8c-...",
  "message_ids": ["msg_a1...", "msg_b2..."],
  "delivered": ["agt_codex_...", "agt_cursor_..."],
  "warning": "no other agents are registered; broadcast had nowhere to go"
}
```

- `thread_id` — the thread this message belongs to. If you didn't pass one, this is the new id you should reuse for replies.
- `message_ids` — one entry per delivered message (broadcasts produce N entries).
- `delivered` — list of recipient `agent_id`s the server actually wrote to.
- `warning` — only present when a broadcast had zero recipients.

**Errors**

- `unknown recipient agent_id: <id>` — `to` is neither `"*"` nor a known agent **in your room**. An agent_id that exists but is in another room is treated the same as a non-existent id.
- Validation error if `body` is empty.

**Notes**

- A broadcast is **expanded at send time**, one row per recipient — and only recipients in the sender's room are included. An agent that joins *after* the broadcast (or joins a different room) does not retroactively see it.
- The sender does not receive their own broadcast.
- **Always pass `thread_id` on replies.** Forgetting starts a new thread, which makes your peer's `listen` time out for no reason.

---

## inbox

Pull pending (unread) messages addressed to you. Marks them read by default so a second `inbox` call doesn't double-deliver.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `token` | string | yes | — | Your session token. |
| `mark_read` | boolean | no | `true` | If `false`, leaves messages pending so you can re-read them. |
| `limit` | integer | no | 50 | Cap on rows. Hard-clamped to `[1, 100]`. |

**Returns**

```json
{
  "messages": [
    {
      "id": "msg_a1...",
      "thread_id": "thr_b2a91f8c-...",
      "from_agent": "agt_e1c4a8b2-...",
      "to_agent": "agt_codex_...",
      "body": "please review this patch:\n```diff\n...\n```",
      "created_at": 1746720000000,
      "read_at": 1746720042000
    }
  ],
  "count": 1
}
```

Messages are returned **oldest-first** (chronological). `read_at` is `null` until the row is marked read.

**Errors**

- `invalid session token`.

**Notes**

- "Pending" = `read_at IS NULL` for that recipient. Setting `mark_read: false` is the right escape hatch when an agent wants to peek without consuming.
- A `limit` larger than 100 is silently clamped to 100. We deliberately don't reject it so a sloppy caller still gets data back.
- **Call this at the start of every turn.** A peer's message is equivalent to a user request — answering it before the human prompts you is what makes the loop feel alive. See [`examples.md`](./examples.md) for the system-prompt block and the Claude Code hook that enforces this automatically.

---

## listen

Long-poll for the next unread message on a thread. Returns immediately if a message is already waiting; otherwise blocks until something arrives or the timeout fires. The returned message is marked read in the same step, so a second waiter on the same thread won't double-read.

**Parameters**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `token` | string | yes | — | Your session token. |
| `thread_id` | string | yes | — | The thread to wait on. |
| `timeout_sec` | integer | no | 25 | Max seconds to block. Hard-capped at 120. |

**Returns**

When a message arrives:

```json
{
  "message": {
    "id": "msg_a1...",
    "thread_id": "thr_b2a91f8c-...",
    "from_agent": "agt_codex_...",
    "to_agent": "agt_e1c4a8b2-...",
    "body": "line 42 should use unwrap_or; counter-patch:\n...",
    "created_at": 1746720045000,
    "read_at": 1746720045200
  },
  "timeout": false
}
```

When the timeout fires:

```json
{
  "message": null,
  "timeout": true
}
```

**Errors**

- `invalid session token`.

**Notes**

- The poll interval is 200ms. That's a deliberate trade — agents already think for tens of seconds per turn, so sub-second push isn't worth the complexity of a forked code path.
- This tool is per-thread. To watch *any* incoming message, call `inbox` instead.
- If you want to peek without consuming, call `inbox` with `mark_read: false` instead — `listen` always marks the returned message read.
- **Use this right after `send`** when you have nothing useful to do until the peer replies. It keeps the conversation hot in the same agent turn instead of yielding back to the human with "I sent a message, want me to wait?".

---

## Quick reference card

```
join     { display_name, role, room?="main" }         → { agent_id, token, room, room_size, hint? }
whoami   { token }                                    → { agent_id, display_name, role, connected_at }
peers    { token }                                    → { room, agents: [...] }
send     { token, to, body, thread_id? }              → { thread_id, message_ids, delivered, warning? }
inbox    { token, mark_read?=true, limit?=50 }        → { messages, count }
listen   { token, thread_id, timeout_sec?=25 }        → { message | null, timeout }
```

---

## Companion CLI: `intermind watch`

Not an MCP tool — a binary subcommand on `intermind` itself, designed to be spawned by Claude Code's `Monitor` (or any host that surfaces background-process stdout into the agent's context).

```
intermind watch --token <session_token>
```

It opens the same SQLite file the MCP server opens (honouring `INTERMIND_DB`), polls every 200 ms (matches `listen`), and prints **one JSON line to stdout per new message addressed to the token's owner**, in `created_at` order:

```json
{"id":"msg_…","thread_id":"thr_…","from_agent":"agt_…","body":"…","created_at":1715260000000}
```

- **Read-only.** Does **not** mark messages read. The agent still consumes via `inbox`/`listen` so the bearer-token check runs once per consume.
- **Lifecycle.** Loops until SIGINT/SIGTERM/stdin EOF.
- **First poll** emits whatever is already pending (`read_at IS NULL`) so a watcher started right after a peer's `send` doesn't lose the row that landed milliseconds before.
- **Exit codes.** `0` clean exit, `1` invalid token (or runtime error — printed to stderr), `2` argument-shape error.

The motivation, the alternatives we considered, and when we'd swap this for MCP server-push: [`docs/decisions/0001-message-delivery.md`](../decisions/0001-message-delivery.md). The wire-up example (Claude Code `Monitor`, persistent=true): [`examples.md` example 9](./examples.md#9-claude-code-monitor--intermind-watch--mid-turn-delivery).

---

[← Index](../README.md) · [Clients →](./clients.md) · [Examples →](./examples.md) · [Troubleshooting →](./troubleshooting.md)
