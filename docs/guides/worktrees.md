[← Index](../README.md)

---

# Worktrees & per-feature rooms

When one feature spans backend and frontend, and you have a coding agent in each repo, the global default room works fine — both agents land in `~/.intermind/state.db` and in the room name `"main"` automatically. But two situations break that:

1. **Multiple features in flight.** BE+FE on `feature-a` and BE+FE on `feature-b`, all running at once on the same laptop. If everybody joins the default room `"main"`, every broadcast goes to everybody, threads get tangled.
2. **Git worktrees on the same repo.** You're using `git worktree add` to keep `feature-a` and `feature-b` checked out side-by-side, with one Claude Code session per worktree. The default room mixes their conversations.

The fix is a per-feature room. **You don't need to edit any config files** — the LLM picks the room at runtime.

## The pattern — one room per branch

Each agent's `join` call accepts an optional `room` argument. The system prompt block (see [`examples.md`](./examples.md#7-system-prompt-block--make-agents-proactive)) tells the LLM:

> Pick a `room` name. If you're inside a git repo, use the current branch (`git branch --show-current`); otherwise pick a short kebab-case label from project context. Defaults to `"main"` if omitted.

So when you start a Claude Code session inside the `feature-a` worktree and say *"Hop on Intermind as the BE dev,"* it runs:

```
join { display_name: "Claude", role: "backend", room: "feature-a" }
```

Then it tells you, in its reply: *"I'm in Intermind room 'feature-a'."*

That announcement is the whole coordination protocol. Tell the FE agent (in the matching `feature-a` worktree) *"join Intermind as the FE dev in room 'feature-a'"* and they're paired. Two BE+FE pairs working on `feature-a` and `feature-b` see each other only within their own room.

## Why this works without any per-worktree config

- **One DB file does the whole machine.** Every Intermind subprocess on the laptop opens `~/.intermind/state.db` by default. WAL mode handles cross-process concurrency.
- **The `room` column on `agents` partitions that file.** `peers`, `send`, broadcast, and `inbox` all filter by the caller's room. Agents in other rooms are invisible — same DB, different conversations.
- **The branch name is a good Schelling point.** Both worktrees on `feature-a` agree on the string `"feature-a"` without coordinating, so the LLM in each session picks the same room without you typing it twice.

## Verifying

After both agents join, ask one of them to call `peers`. The response includes a `room` field plus the other agents in that room:

```json
{
  "room": "feature-a",
  "agents": [{ "id": "agt_…", "display_name": "Codex", "role": "frontend", … }]
}
```

If `agents` is empty and you expected company, check the `room` field on each side — they probably picked different names. Tell them the canonical one and have them re-`join`.

You can also inspect SQLite directly:

```bash
sqlite3 ~/.intermind/state.db "SELECT id, display_name, role, room FROM agents ORDER BY connected_at"
```

## When to use `INTERMIND_DB` instead

Per-room isolation handles almost every case. Reach for `INTERMIND_DB` (a separate file) only when you want hard isolation that survives a misbehaving agent — e.g. you genuinely don't want feature B's agents to be able to discover feature A's agents at all, even if someone passes the wrong `room` string. Different file, different SQLite, different world.

```bash
# In one worktree's shell, before launching the agent:
export INTERMIND_DB=/path/to/private/room.db
```

This is heavier — every agent that should join needs the same env var — and it's rarely worth it once first-class rooms exist. The default (one file, many rooms) is what you want 95% of the time.

## Cleaning up

When the feature is merged and the worktrees are gone, the agent rows for that room linger in `~/.intermind/state.db` until you remove them:

```bash
sqlite3 ~/.intermind/state.db "DELETE FROM messages WHERE from_agent IN (SELECT id FROM agents WHERE room = 'feature-a')"
sqlite3 ~/.intermind/state.db "DELETE FROM agents WHERE room = 'feature-a'"
```

Or, simpler, wipe the whole DB and start fresh:

```bash
rm ~/.intermind/state.db
```

The next time any agent joins, the schema is recreated.

## Why not auto-detect the worktree?

Two reasons. First, "worktree" is a git concept; baking it into the Intermind server would couple it to git. Second, you don't always *want* per-worktree isolation — sometimes BE in repo A and FE in repo B should share one room without either being a worktree of the other. **Putting the choice in the LLM's hands** (with a sensible default of `"main"` and a clear instruction to use the branch name when one exists) is the lowest-friction knob that covers every case without making Intermind itself smarter about your filesystem.

---

[← Index](../README.md) · [← Tools](./tools.md) · [← Examples](./examples.md) · [Troubleshooting →](./troubleshooting.md)
