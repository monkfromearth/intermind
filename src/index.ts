#!/usr/bin/env bun
/**
 * Intermind binary entrypoint.
 *
 * Two modes — chosen by argv:
 *
 *   `intermind` (no args)   → start the stdio MCP server. This is the
 *                             default and what every MCP client calls.
 *   `intermind watch …`     → run the streaming message watcher. Used by
 *                             Claude Code's `Monitor` tool to surface
 *                             peer messages mid-turn (see watch.ts and
 *                             docs/decisions/0001-message-delivery.md).
 *
 * Both modes share the same database resolution: `INTERMIND_DB` if set,
 * otherwise `~/.intermind/state.db`. Multiple instances of either mode
 * can run concurrently against the same file — SQLite WAL handles the
 * cross-process concurrency, so a Claude Code session running an MCP
 * subprocess and a parallel `intermind watch` subprocess from the same
 * agent both observe the same writes immediately.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { homedir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "./db";
import { buildServer } from "./server";
import { parseWatchArgs, runWatchCli } from "./watch";

// Global default — every Claude Code / Codex / Cursor session on this
// machine lands in the same room unless INTERMIND_DB overrides it.
// Example: BE agent in ~/projects/api and FE agent in ~/projects/web
// share `~/.intermind/state.db` and can talk to each other out of the
// box. Per-project rooms are an explicit opt-in via the env var.
const DEFAULT_DB_PATH = join(homedir(), ".intermind", "state.db");

/**
 * Resolve the SQLite path the same way for both modes. Centralised so a
 * future change (e.g. picking up a config file) only happens once.
 */
function dbPathFromEnv(): string {
  return process.env.INTERMIND_DB ?? DEFAULT_DB_PATH;
}

/**
 * Run the MCP server over stdio. Default mode — what `bunx -y intermind`
 * does when an MCP client launches it as a subprocess.
 */
async function runServer(): Promise<void> {
  const dbPath = dbPathFromEnv();
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

/**
 * Run the watcher. Spawned by Claude Code's `Monitor` tool (or any other
 * background-event mechanism). Streams one JSON line per new message to
 * stdout until SIGINT/SIGTERM/EOF.
 *
 * `watchArgv` is everything *after* the `watch` subcommand — i.e.
 * `process.argv.slice(3)` when invoked as `intermind watch --token X`.
 */
async function runWatch(watchArgv: string[]): Promise<number> {
  const parsed = parseWatchArgs(watchArgv);
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    // Exit code 2 = argument-shape error (BSD/GNU convention). Distinct
    // from 1 (operational failure) so a wrapper script can tell the
    // difference between "you typed it wrong" and "the DB blew up".
    return 2;
  }

  const dbPath = dbPathFromEnv();
  const db = openDatabase(dbPath);

  // Wire SIGINT/SIGTERM and stdin EOF (the Monitor host closes stdin
  // when it cancels) to one AbortController. The watcher loop checks
  // signal.aborted between every emit and during sleeps.
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // `pause()` so we don't actually consume bytes — we only care about
  // the close event so the watcher can exit when the host closes stdin.
  process.stdin.pause();
  process.stdin.on("end", stop);
  process.stdin.on("close", stop);

  try {
    return await runWatchCli({
      db,
      token: parsed.token,
      signal: controller.signal,
    });
  } finally {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
}

async function main(): Promise<void> {
  // argv[0] = "bun", argv[1] = path to this script, argv[2] = subcommand.
  // Anything else past argv[2] is the subcommand's own argv. Default
  // (no argv[2]) is the MCP server, which is what 99% of callers want.
  const subcommand = process.argv[2];

  if (subcommand === "watch") {
    const code = await runWatch(process.argv.slice(3));
    process.exit(code);
  }

  if (subcommand === "--help" || subcommand === "-h") {
    process.stdout.write(
      "usage:\n" +
        "  intermind                  start the MCP server on stdio (default)\n" +
        "  intermind watch --token T  stream new messages for the agent owning T\n" +
        "\n" +
        "Database path comes from $INTERMIND_DB, defaults to ~/.intermind/state.db.\n",
    );
    process.exit(0);
  }

  if (subcommand && subcommand.startsWith("-")) {
    process.stderr.write(
      `unknown flag: ${subcommand} (try \`intermind --help\`)\n`,
    );
    process.exit(2);
  }

  if (subcommand && !subcommand.startsWith("-")) {
    process.stderr.write(
      `unknown subcommand: ${subcommand} (try \`intermind --help\`)\n`,
    );
    process.exit(2);
  }

  await runServer();
}

await main();
