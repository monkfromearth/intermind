[← Index](../README.md)

---

# Tool reference

The complete API surface of Intermind — six MCP tools, what each one does, what it expects, what it returns, and how it can fail.

> **One mental model.** Every call after `register_agent` requires the session token from registration. The server identifies you from that token and ignores any `agent_id` argument you might pass. Two agents in the same project share the same SQLite file (`./.intermind/state.db` by default), which is the whole reason they can see each other.

## Common to all tools

**Errors** are returned as MCP error envelopes (`isError: true` with a JSON body), or as JSON-RPC errors when the input fails Zod validation. Either way, your coding agent's LLM sees a structured failure it can read.

**IDs** are prefixed for self-documenting logs:
- `agt_<uuid>` — agent
- `thr_<uuid>` — thread
- `msg_<uuid>` — message
- `tok_<uuid>` — session token

**Timestamps** are Unix epoch milliseconds (`Date.now()`).

---

## register_agent

Declare yourself to the room. Returns your `agent_id` and a session token. **Call this once per session, before any other tool.**

**Parameters**

| Name | Type | Required | Constraints | Description |
| --- | --- | --- | --- | --- |
| `display_name` | string | yes | 1–64 chars | Free-text name for the agent (e.g. `"Claude"`, `"Codex"`). Doesn't have to be unique. |
| `role` | string | yes | 1–64 chars | Free-text role label (e.g. `"implementer"`, `"reviewer"`, `"tester"`). |

**Returns**

```json
{
  "agent_id": "agt_e1c4a8b2-...",
  "token": "tok_4f2a7b9c-...",
  "display_name": "Claude",
  "role": "implementer"
}
```

**Errors**

- Validation error if `display_name` or `role` is empty or longer than 64 chars.

**Notes**

- The `token` is the credential for every later call. Treat it like a password.
- Two agents may share a `display_name`; they're still distinct because `agent_id` is what identifies them.

---

## whoami

Confirm your identity from a session token. Useful as a "ping" — it also bumps your `last_seen` timestamp, which other agents see in `list_agents`.

**Parameters**

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `token` | string | yes | The session token from `register_agent`. |

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

- `invalid session token; call register_agent first` — the token doesn't match any registered agent.

---

## list_agents

List every agent currently registered in this room.

**Parameters**

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `token` | string | yes | Your session token. |

**Returns**

```json
{
  "agents": [
    {
      "id": "agt_e1c4a8b2-...",
      "display_name": "Claude",
      "role": "implementer",
      "connected_at": 1746720000000,
      "last_seen": 1746720042000
    },
    {
      "id": "agt_8d3f1c50-...",
      "display_name": "Codex",
      "role": "reviewer",
      "connected_at": 1746720001000,
      "last_seen": 1746720040000
    }
  ]
}
```

Ordered by `connected_at` (earliest first). **Session tokens are never returned** — only `id`, `display_name`, `role`, `connected_at`, `last_seen`.

**Errors**

- `invalid session token` — same as `whoami`.

**Notes**

- "This room" = "this SQLite file". Two agents pointed at different `INTERMIND_DB` paths are in different rooms and won't see each other.

---

## send_message

Send a message to one agent or broadcast to every other agent. Optional `thread_id` to continue an existing conversation.

**Parameters**

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `token` | string | yes | Your session token. |
| `to` | string | yes | A specific `agent_id`, or `"*"` to broadcast to every other agent. |
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

- `unknown recipient agent_id: <id>` — `to` is neither `"*"` nor a known agent.
- Validation error if `body` is empty.

**Notes**

- A broadcast is **expanded at send time**, one row per recipient. An agent that registers *after* the broadcast does not retroactively see it.
- The sender does not receive their own broadcast.

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

---

## wait_for_reply

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
- If you want to peek without consuming, call `inbox` with `mark_read: false` instead — `wait_for_reply` always marks the returned message read.

---

## Quick reference card

```
register_agent  { display_name, role }                       → { agent_id, token, ... }
whoami          { token }                                    → { agent_id, display_name, role, connected_at }
list_agents     { token }                                    → { agents: [...] }
send_message    { token, to, body, thread_id? }              → { thread_id, message_ids, delivered, warning? }
inbox           { token, mark_read?=true, limit?=50 }        → { messages, count }
wait_for_reply  { token, thread_id, timeout_sec?=25 }        → { message | null, timeout }
```

---

[← Index](../README.md) · [Clients →](./clients.md) · [Recipes →](./recipes.md) · [Troubleshooting →](./troubleshooting.md)
