[← Previous: MCP primer](./01-mcp-primer.md) · [Index](../README.md) · [Next: Transports →](./03-transports.md)

---

# 02 · How Claude Code and Codex use MCP

Both are MCP **clients**. They connect outward to MCP servers; they do not expose servers to anyone else. The configs differ, the underlying protocol does not.

## Claude Code

Configured with the `claude mcp add` command (or by editing the JSON config file directly).

```bash
# stdio (local subprocess)
claude mcp add --transport stdio intermind -- npx -y intermind@latest

# streamable HTTP (remote)
claude mcp add --transport http intermind https://intermind.example.com
```

**Scopes** decide where the server is loaded:

| Scope | Stored in | Visible to |
| --- | --- | --- |
| `user` | `~/.claude.json` | Just you, in every project |
| `project` | `.mcp.json` at the repo root | The whole team, if committed |
| `enterprise` | Managed by IT | Everyone in the org |

**Reconnection:** HTTP servers auto-reconnect with exponential backoff (up to 5 attempts). Stdio servers do **not** — if the subprocess crashes, Claude Code does not restart it. So a stdio server has to be crash-safe.

## Codex CLI

Configured by editing `~/.codex/config.toml` (or `.codex/config.toml` for a project, if the project is "trusted"). There's also a `codex mcp` CLI for managing entries.

```toml
# stdio
[mcp_servers.intermind]
command = "npx"
args = ["-y", "intermind@latest"]
env_vars = ["LOCAL_TOKEN"]

[mcp_servers.intermind.env]
INTERMIND_DB = "/Users/me/projects/foo/.intermind/state.db"

# streamable HTTP
[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
bearer_token_env_var = "FIGMA_OAUTH_TOKEN"
http_headers = { "X-Figma-Region" = "us-east-1" }
```

Useful per-server fields: `startup_timeout_sec`, `tool_timeout_sec`, `enabled_tools`, `disabled_tools`. The CLI and IDE extension share the same config.

## Side-by-side

| Concept | Claude Code | Codex |
| --- | --- | --- |
| Config file | `~/.claude.json` (user) or `.mcp.json` (project) | `~/.codex/config.toml` or `.codex/config.toml` |
| Format | JSON | TOML |
| Add command | `claude mcp add ...` | `codex mcp ...` |
| Stdio server | `command` + arguments after `--` | `command` + `args` array |
| HTTP server | `--transport http <url>` | `url = "..."` |
| Project sharing | `.mcp.json` committed to git | `.codex/config.toml` (only if project is trusted) |

What this means for Intermind: we ship a single `npx intermind` binary that both configs can point at. Same protocol, different wiring instructions in the README.

## Sources

- Claude Code MCP docs: https://code.claude.com/docs/en/mcp
- Codex MCP docs: https://developers.openai.com/codex/mcp

---

[← Previous: MCP primer](./01-mcp-primer.md) · [Index](../README.md) · [Next: Transports →](./03-transports.md)
