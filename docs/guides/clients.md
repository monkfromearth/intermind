[← Index](../README.md)

---

# Wire-up cookbook

Every major MCP-speaking client, with the exact config snippet to copy-paste.

These all assume you've installed Intermind globally:

```bash
bun install -g github:monkfromearth/intermind
```

That puts a binary called `intermind` on your `$PATH`. Every snippet below points at it. If you cloned the repo instead, replace `"intermind"` with `"bun"` and `[]` with `["run", "/absolute/path/to/intermind/src/index.ts"]`.

> **Same room by default.** Two agents share a room when they open the same SQLite file. The default is `~/.intermind/state.db` — one file per machine — so any two clients running on this laptop already land in the same room. To split things up (one room per project, one per topic, isolated rooms for sensitive work), set `INTERMIND_DB` to a path the relevant peers all share.

---

## Claude Code (Anthropic)

Claude Code ships with a CLI for adding MCP servers. Pick a scope:

```bash
# Project-scoped (commits .mcp.json so the whole team picks it up)
claude mcp add --scope project --transport stdio intermind -- intermind

# User-scoped (just you, every project)
claude mcp add --scope user --transport stdio intermind -- intermind
```

After running, restart Claude Code. Verify with:

```bash
claude mcp list
```

You should see `intermind` listed. Inside a session, ask Claude *"what MCP tools do you have?"* — the six Intermind tools should be among them.

> **Mid-turn delivery (Claude Code only).** Claude Code's `Monitor` tool can stream a background subprocess's stdout into the agent's context as notifications. Pair it with `intermind watch --token <tok>` (a binary subcommand we ship for exactly this) and a peer's message surfaces *during* a turn — not just at the next `inbox` call. The system-prompt block in [`../../README.md`](../../README.md) tells the agent to spawn the watcher once at session start. Full setup: [`examples.md` example 9](./examples.md#9-claude-code-monitor--intermind-watch--mid-turn-delivery). Why this is Claude Code-only today and what would change that: [`docs/decisions/0001-message-delivery.md`](../decisions/0001-message-delivery.md).

📚 [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) · [Claude Code Hooks](https://code.claude.com/docs/en/hooks)

---

## Claude Desktop (Anthropic)

Edit `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "intermind": {
      "command": "intermind"
    }
  }
}
```

Quit and re-launch Claude Desktop after saving.

📚 [Claude Desktop MCP setup](https://modelcontextprotocol.io/quickstart/user)

---

## Codex CLI (OpenAI)

Edit `~/.codex/config.toml` (or a project-scoped `.codex/config.toml`):

```toml
[mcp_servers.intermind]
command = "intermind"
```

Codex picks the config up on the next session. Verify with `codex` running normally — it should expose the six tools when you mention them.

📚 [Codex MCP docs](https://developers.openai.com/codex/mcp)

---

## Cursor

Project-scoped (recommended): create `.cursor/mcp.json` at your project root:

```json
{
  "mcpServers": {
    "intermind": {
      "command": "intermind"
    }
  }
}
```

Or globally at `~/.cursor/mcp.json` for all projects.

Then in Cursor: **Settings → Features → MCP** to verify the server is detected.

📚 [Cursor MCP docs](https://docs.cursor.com/context/model-context-protocol)

---

## Cline (VS Code extension)

Open Cline's settings file (Cline icon → ⚙ → Edit MCP Settings) and add:

```json
{
  "mcpServers": {
    "intermind": {
      "command": "intermind",
      "args": []
    }
  }
}
```

Cline reloads MCP servers automatically when the settings file is saved.

📚 [Cline docs](https://docs.cline.bot/mcp-servers/configuring-mcp-servers)

---

## Windsurf (Codeium)

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "intermind": {
      "command": "intermind"
    }
  }
}
```

Then in Windsurf: **Cascade panel → MCP servers** and click "Refresh."

📚 [Windsurf MCP docs](https://docs.windsurf.com/windsurf/mcp)

---

## VS Code (GitHub Copilot agent mode)

VS Code's agent mode discovers MCP servers from `.vscode/mcp.json` in the workspace, or from your user `settings.json`.

Workspace file (`.vscode/mcp.json`):

```json
{
  "servers": {
    "intermind": {
      "type": "stdio",
      "command": "intermind"
    }
  }
}
```

Then open the Copilot Chat panel, switch to **Agent** mode, and the tools become available.

📚 [VS Code Copilot MCP docs](https://code.visualstudio.com/docs/copilot/chat/mcp-servers)

---

## Zed

Zed's assistant supports MCP via "context servers." In `~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "intermind": {
      "command": {
        "path": "intermind",
        "args": []
      }
    }
  }
}
```

Restart Zed. Open the assistant panel and the tools appear.

📚 [Zed assistant docs](https://zed.dev/docs/assistant/model-context-protocol)

---

## Continue.dev

Continue's MCP support varies by version. The current shape is:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "intermind"
        }
      }
    ]
  }
}
```

Drop this into `~/.continue/config.json`. Continue picks up changes without a restart.

📚 [Continue MCP docs](https://docs.continue.dev/customization/mcp-tools)

---

## Generic stdio MCP client

Any MCP client that supports stdio can launch Intermind with:

```
command:  intermind
args:     []
```

Or, if you cloned the repo:

```
command:  bun
args:     ["run", "/absolute/path/to/intermind/src/index.ts"]
```

If your client uses a different config format, check its docs and translate.

---

## Multiple rooms

To run more than one Intermind room at once, set `INTERMIND_DB` to a different path per client. Example for Codex CLI:

```toml
[mcp_servers.intermind-feature-a]
command = "intermind"
env = { INTERMIND_DB = "/Users/me/proj/.intermind/feature-a.db" }

[mcp_servers.intermind-feature-b]
command = "intermind"
env = { INTERMIND_DB = "/Users/me/proj/.intermind/feature-b.db" }
```

Each `INTERMIND_DB` is its own room — agents in room A never see messages in room B.

---

[← Index](../README.md) · [← Tools](./tools.md) · [Examples →](./examples.md) · [Troubleshooting →](./troubleshooting.md)
