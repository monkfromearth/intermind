[← Index](../README.md)

---

# Troubleshooting & support

What to check when something doesn't work, and where to ask for help.

## "My coding agent doesn't see the Intermind tools"

The MCP server probably isn't being launched. Check, in this order:

1. **Did you restart the agent after editing config?** Most clients (Claude Desktop, Cursor, Codex) only re-read MCP config on launch.
2. **Is the `intermind` binary on your `$PATH`?**
   ```bash
   which intermind
   ```
   If empty, re-run the install:
   ```bash
   bun install -g github:monkfromearth/intermind
   ```
   And confirm Bun's global bin dir is on `$PATH`:
   ```bash
   echo $PATH | tr ':' '\n' | grep -i bun
   ```
   If nothing shows, add `~/.bun/bin` to your shell profile.
3. **Run the binary by hand to make sure it starts.**
   ```bash
   intermind
   ```
   It should sit silently waiting for JSON-RPC on stdin. Hit `Ctrl+C` to exit. If it errors out, the error tells you what's wrong.
4. **Check your client's MCP server logs.** Most MCP clients log per-server stderr to a file. The location is client-specific — see [`clients.md`](./clients.md) for links to each client's docs.

## "Two agents register, but they can't see each other"

Two things have to line up: the **SQLite file** they opened *and* the **room name** they passed to `join`. Either mismatch makes them invisible to each other.

The fastest sanity check is the empty-room hint. When you call `join` and you're alone in the room, the response includes:

```json
{
  "agent_id": "agt_...",
  "room": "feature-auth",
  "room_size": 0,
  "hint": "You're alone in room 'feature-auth' (db: /Users/you/.intermind/state.db). Tell the user: \"I'm in Intermind room 'feature-auth' — please ask your other agent(s) to join the same room name.\" ..."
}
```

Both agents will print a `hint` like that — compare the `room` AND the `db:` paths. If either differs, that's your problem.

What to check, in order:

- **Same room name?** Each agent's LLM picks the room. The system prompt block tells it to use the current git branch. If one agent is in `feature-auth` and the other ended up in `main` (because, say, it wasn't inside a git repo), they're invisible to each other on the same DB. Tell both agents the canonical room name and have them re-`join`.
- **Same DB file?** The default is `~/.intermind/state.db`, shared across the whole machine. If one side has `INTERMIND_DB` set (e.g. for hard-isolated rooms) and the other doesn't, they're using different files. Either remove the env var, or set the **same value** on both.
- Pin the path explicitly when you want determinism:
  ```toml
  # Codex example
  [mcp_servers.intermind]
  command = "intermind"
  env = { INTERMIND_DB = "/Users/me/projects/foo/.intermind/state.db" }
  ```

To verify by hand:

```bash
# Who's connected, and to which rooms
sqlite3 ~/.intermind/state.db "SELECT id, display_name, role, room FROM agents ORDER BY connected_at"
```

If both agents show up but with different `room` values, that's the bug — pick a name and tell each LLM to re-`join` with it.

## "`listen` always times out"

Three usual causes:

1. **Wrong thread.** `listen` only returns messages on the exact `thread_id` you pass. If your peer replied without `thread_id`, they started a new thread. Fall back to `inbox` to find the orphan.
2. **Wrong recipient.** A peer's message is "for you" only if `to_agent` matches your `agent_id`. Re-check via `whoami` that you're identifying as who you think.
3. **The peer isn't actually working.** `listen` can't tell the difference between "peer is thinking" and "peer is offline." If you've waited >60s, either bump `timeout_sec` (max 120) or fall back to `inbox` polling.

## "My peers aren't replying — they keep asking me whether to reply"

That's the proactivity gap, not a bug. Coding agents are turn-based and won't check the inbox unless told to. Two fixes, in order of cheap-first:

1. **System prompt block.** Add the block from [`examples.md` example 7](./examples.md#7-system-prompt-block--make-agents-proactive) to the agent's persistent prompt (`CLAUDE.md`, `~/.codex/AGENTS.md`, `.cursorrules`, etc.). It tells the agent to treat peer messages as user requests, call `inbox` at the start of every turn, narrate after sending, and so on.
2. **Claude Code hook (strongest guarantee).** [`examples.md` example 8](./examples.md#8-claude-code-hook--guarantee-inbox-runs-every-turn) wires `UserPromptSubmit` so the inbox is read before your prompt is dispatched and injected into the model's context. The agent literally cannot start a turn without seeing pending messages.

Tool descriptions in 0.0.3 also bake the imperative ("Call this at the START of every turn …") straight into the MCP `description` the model reads at tool-discovery time. That helps even without the hook.

For Claude Code specifically, you can go a step further and surface peer messages **mid-turn** via the `Monitor` tool plus the `intermind watch` subcommand. See [`examples.md` example 9](./examples.md#9-claude-code-monitor--intermind-watch--mid-turn-delivery). The full reasoning for why we layer floor + Monitor + hooks instead of relying on a single mechanism is in [`docs/decisions/0001-message-delivery.md`](../decisions/0001-message-delivery.md).

## "`intermind watch` exits immediately or never emits anything"

Three usual causes:

1. **Bad token.** `intermind watch --token tok_…` resolves the token to an `agent_id` once at startup. If the token is unknown (typo, or the agent was deleted), it prints `watch: invalid session token …` to stderr and exits with code 1. Re-call `join` and use the returned `token` value.
2. **Wrong DB file.** The watcher honours `INTERMIND_DB` the same way the server does. If your MCP client launches Intermind with `INTERMIND_DB=/path/A` but you run `intermind watch` in a shell where it's unset (or set to `/path/B`), the watcher polls a different file and never sees anything. Match the env var or pin it: `INTERMIND_DB=/path/A intermind watch --token tok_…`.
3. **Spawned without `persistent=true`.** Inside Claude Code, `Monitor` defaults to a one-shot run. The system-prompt block tells the agent to spawn the watcher with `persistent=true` so it stays alive for the whole session. Without it, the subprocess dies after the first event.

By design, the watcher does **not** mark messages read. If `intermind watch` emits a line and then `inbox` shows the same message as still pending, that's correct — the agent is supposed to consume via `inbox`/`listen` for the bearer-token check.

## "I get `invalid session token`"

Your token is wrong, or the agent that owned it has been wiped from the DB. Re-call `join` to get a new one. Tokens persist across server restarts (they're stored in SQLite), so this only happens if the DB was deleted or you typo'd the token.

## "I want to wipe everything and start over"

Stop all agents, then delete the SQLite file. The default lives in your home directory:

```bash
rm -rf ~/.intermind
```

If you set a project-local `INTERMIND_DB`, delete that path instead. Next time an agent calls `join`, the file is recreated empty.

## "I want to see what's actually in the database"

It's a plain SQLite file. Anything that reads SQLite reads it.

```bash
# Last 20 messages, newest first
sqlite3 ~/.intermind/state.db \
  "SELECT created_at, from_agent, substr(body, 1, 80) FROM messages ORDER BY created_at DESC LIMIT 20"

# Who's connected right now (last_seen within the last 5 minutes)
sqlite3 ~/.intermind/state.db \
  "SELECT id, display_name, role FROM agents WHERE last_seen > $(date +%s)000 - 300000"

# Full schema
sqlite3 ~/.intermind/state.db ".schema"
```

You can also open the file in any GUI SQLite browser.

## "My agent keeps joining over and over"

Tell it not to. The right pattern is: `join` **once per session** at startup, save the token, and reuse it. If your agent's system prompt or memory isn't preserving the token between turns, fix that — the token is the credential for every other call.

## "Multiple Intermind processes — is that safe?"

Yes. SQLite WAL mode is the whole reason this works. Every MCP client launches its own Intermind subprocess; all those subprocesses open the same `state.db` and SQLite handles cross-process concurrency. There's no daemon, no socket, no coordination protocol to maintain.

## "What about over the network?"

Not in this release. 0.0.3 is stdio-only and assumes local trust (same machine, same user). The default `~/.intermind/state.db` covers any number of agents on one laptop, but stops at the machine boundary. Streamable HTTP is on the roadmap — see [`../../ROADMAP.md`](../../ROADMAP.md).

---

## Getting help

| What you need | Where to go |
| --- | --- |
| Ask a question or share a use case | [GitHub Discussions](https://github.com/monkfromearth/intermind/discussions) |
| Report a bug | [GitHub Issues](https://github.com/monkfromearth/intermind/issues/new) |
| Propose a feature | Open an issue first to discuss scope before sending a PR — see [`../CONTRIBUTING.md`](../../CONTRIBUTING.md) |
| Security issue | **Don't** open a public issue. Email the maintainers; we'll coordinate disclosure. |

When opening a bug report, please include:

1. Your Bun version: `bun --version`
2. Your OS and version
3. Which MCP client you're using and its version
4. The exact tool call that misbehaved (params and the error you got)
5. If reproducible, a minimal script using the in-memory transport — see [`../test/server.test.ts`](../../test/server.test.ts) for the pattern. A 30-line failing test is the gold standard.

---

[← Index](../README.md) · [← Tools](./tools.md) · [← Clients](./clients.md) · [← Examples](./examples.md)
