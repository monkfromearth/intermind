/**
 * MCP wiring: turns the pure handlers in `./handlers.ts` into MCP
 * tools and registers them on a fresh `McpServer` instance.
 *
 * Every tool follows the same pattern:
 *   1. Validate input via the zod schema in `./schemas.ts` (the SDK
 *      does this for us before invoking the handler).
 *   2. Call the matching handler from `./handlers.ts`.
 *   3. Wrap the return value in MCP's `{ content: [{ type, text }] }`
 *      envelope, or convert a thrown error into an `isError: true`
 *      response so the calling agent's LLM can read the failure.
 */

import type { Database } from "bun:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { handlers } from "./handlers";
import {
  inboxInput,
  listAgentsInput,
  registerAgentInput,
  sendMessageInput,
  waitForReplyInput,
  whoamiInput,
} from "./schemas";

/* ------------------------------------------------------------------ */
/* MCP response envelopes                                              */
/* ------------------------------------------------------------------ */

/** Wrap a successful handler return in an MCP text-content response. */
const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

/** Wrap a thrown error in an MCP `isError` response. */
const fail = (message: string) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
  isError: true,
});

/**
 * Run a handler and convert its result (or thrown error) into the MCP
 * response shape. Used by every tool registration below to keep them
 * one line each.
 */
function run<T>(fn: () => T | Promise<T>) {
  return Promise.resolve()
    .then(fn)
    .then(ok)
    .catch((e: unknown) =>
      fail(e instanceof Error ? e.message : String(e)),
    );
}

/* ------------------------------------------------------------------ */
/* server factory                                                      */
/* ------------------------------------------------------------------ */

/**
 * Optional knobs for `buildServer`. Only `dbPath` is meaningful today —
 * it gets echoed back in the empty-room hint so a freshly registered
 * agent can tell which file its peers would need to share.
 */
export interface BuildServerOptions {
  /** Filesystem path of the SQLite file that backs `db`. */
  dbPath?: string;
}

/**
 * Build a fresh `McpServer` and register all six Intermind tools on it.
 * The returned server is *not* yet connected to a transport — call
 * `server.connect(transport)` to start serving.
 *
 * @param db   An open SQLite database (see `openDatabase` in `./db.ts`).
 *             The same handle is shared across all tool invocations.
 * @param opts See `BuildServerOptions`.
 */
export function buildServer(
  db: Database,
  opts: BuildServerOptions = {},
): McpServer {
  // Single source of truth for the server version is package.json;
  // Bun lets us require() it at build time so the compiled binary
  // reports the real version (e.g. 0.0.2) instead of a stale string.
  const { version } = require("../package.json") as { version: string };
  const server = new McpServer({ name: "intermind", version });

  server.tool(
    "register_agent",
    "Introduce yourself to the room. Returns your agent_id and a session token; pass the token on every subsequent call.",
    registerAgentInput,
    async (args) =>
      run(() => {
        const result = handlers.register_agent(db, args);
        // If the new agent is alone, surface a hint pointing at the DB
        // path so they can tell whether their peer is on the same file.
        // E.g. BE agent in repo A and FE agent in repo B both starting
        // with the default config will both see room_size: 0 — the hint
        // is what tells them they're in different rooms instead of just
        // "nobody else has joined yet".
        if (result.room_size === 0 && opts.dbPath) {
          result.hint =
            `You're alone in this room (db: ${opts.dbPath}). ` +
            "If another agent should be here, make sure their INTERMIND_DB " +
            "points at the same file (defaults to ~/.intermind/state.db, " +
            "shared across every project on this machine).";
        }
        return result;
      }),
  );

  server.tool(
    "whoami",
    "Confirm your identity from a session token.",
    whoamiInput,
    async (args) => run(() => handlers.whoami(db, args)),
  );

  server.tool(
    "list_agents",
    "List every agent currently registered in this room.",
    listAgentsInput,
    async (args) => run(() => handlers.list_agents(db, args)),
  );

  server.tool(
    "send_message",
    "Send a message to another agent (use '*' as `to` to broadcast). Omit thread_id to start a new thread.",
    sendMessageInput,
    async (args) => run(() => handlers.send_message(db, args)),
  );

  server.tool(
    "inbox",
    "Pull pending (unread) messages addressed to you. Marks them read by default.",
    inboxInput,
    async (args) => run(() => handlers.inbox(db, args)),
  );

  server.tool(
    "wait_for_reply",
    "Long-poll for the next unread message on a thread. Blocks up to timeout_sec (default 25). Returns immediately if a message is already waiting.",
    waitForReplyInput,
    async (args) => run(() => handlers.wait_for_reply(db, args)),
  );

  return server;
}
