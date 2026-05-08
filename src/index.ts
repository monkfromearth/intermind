#!/usr/bin/env bun
/**
 * Intermind stdio entrypoint.
 *
 * The host (Claude Code, Codex, …) launches this script as a
 * subprocess and speaks JSON-RPC over its standard streams. The
 * database path comes from the `INTERMIND_DB` environment variable,
 * defaulting to `~/.intermind/state.db` (per-user, global across all
 * projects). To run a project-private room, set INTERMIND_DB to a
 * path inside that project (e.g. `./.intermind/state.db`).
 *
 * Multiple instances of this script can run concurrently against the
 * same database file: SQLite WAL mode handles cross-process
 * concurrency, so each MCP client (Claude Code, Codex) just spawns its
 * own subprocess and they all see the same conversations.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { homedir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "./db";
import { buildServer } from "./server";

// Global default — every Claude Code / Codex / Cursor session on this
// machine lands in the same room unless INTERMIND_DB overrides it.
// Example: BE agent in ~/projects/api and FE agent in ~/projects/web
// share `~/.intermind/state.db` and can talk to each other out of the
// box. Per-project rooms are an explicit opt-in via the env var.
const DEFAULT_DB_PATH = join(homedir(), ".intermind", "state.db");

async function main(): Promise<void> {
  const dbPath = process.env.INTERMIND_DB ?? DEFAULT_DB_PATH;
  const db = openDatabase(dbPath);
  const server = buildServer(db, { dbPath });

  // Best-effort cleanup on signals. SQLite WAL is crash-safe, so this
  // is a courtesy rather than a correctness requirement.
  const shutdown = () => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(new StdioServerTransport());
}

await main();
