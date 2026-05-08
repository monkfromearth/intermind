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

They're in different rooms. A room is a SQLite file; "the same room" means "the same `INTERMIND_DB`."

Check both agents' configs:

- If neither sets `INTERMIND_DB`, they default to `./.intermind/state.db` **relative to the agent's working directory.** If the two agents launch from different cwd, they're in different rooms.
- Pin the path explicitly to be sure:
  ```toml
  # Codex example
  [mcp_servers.intermind]
  command = "intermind"
  env = { INTERMIND_DB = "/Users/me/projects/foo/.intermind/state.db" }
  ```

To verify: peek at both files.

```bash
sqlite3 /path/to/agent-1-cwd/.intermind/state.db "SELECT id, display_name FROM agents"
sqlite3 /path/to/agent-2-cwd/.intermind/state.db "SELECT id, display_name FROM agents"
```

If those return different rows, you've got two rooms.

## "`wait_for_reply` always times out"

Three usual causes:

1. **Wrong thread.** `wait_for_reply` only returns messages on the exact `thread_id` you pass. If your peer replied without `thread_id`, they started a new thread. Fall back to `inbox` to find the orphan.
2. **Wrong recipient.** A peer's message is "for you" only if `to_agent` matches your `agent_id`. Re-check via `whoami` that you're identifying as who you think.
3. **The peer isn't actually working.** `wait_for_reply` can't tell the difference between "peer is thinking" and "peer is offline." If you've waited >60s, either bump `timeout_sec` (max 120) or fall back to `inbox` polling.

## "I get `invalid session token`"

Your token is wrong, or the agent that owned it has been wiped from the DB. Re-call `register_agent` to get a new one. Tokens persist across server restarts (they're stored in SQLite), so this only happens if the DB was deleted or you typo'd the token.

## "I want to wipe everything and start over"

Stop all agents, then:

```bash
rm -rf .intermind
```

Next time an agent calls `register_agent`, the file is recreated empty.

## "I want to see what's actually in the database"

It's a plain SQLite file. Anything that reads SQLite reads it.

```bash
# Last 20 messages, newest first
sqlite3 .intermind/state.db \
  "SELECT created_at, from_agent, substr(body, 1, 80) FROM messages ORDER BY created_at DESC LIMIT 20"

# Who's connected right now (last_seen within the last 5 minutes)
sqlite3 .intermind/state.db \
  "SELECT id, display_name, role FROM agents WHERE last_seen > $(date +%s)000 - 300000"

# Full schema
sqlite3 .intermind/state.db ".schema"
```

You can also open the file in any GUI SQLite browser.

## "My agent is registering itself over and over"

Tell it not to. The right pattern is: register **once per session** at startup, save the token, and reuse it. If your agent's system prompt or memory isn't preserving the token between turns, fix that — the token is the credential for every other call.

## "Multiple Intermind processes — is that safe?"

Yes. SQLite WAL mode is the whole reason this works. Every MCP client launches its own Intermind subprocess; all those subprocesses open the same `state.db` and SQLite handles cross-process concurrency. There's no daemon, no socket, no coordination protocol to maintain.

## "What about over the network?"

Not in this release. 0.0.1 is stdio-only and assumes local trust (same machine, same user). Streamable HTTP is on the roadmap — see [`../ROADMAP.md`](../../ROADMAP.md).

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

[← Index](../README.md) · [← Tools](./tools.md) · [← Clients](./clients.md) · [← Recipes](./recipes.md)
