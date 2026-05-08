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
 * Build a fresh `McpServer` and register all six Intermind tools on it.
 * The returned server is *not* yet connected to a transport — call
 * `server.connect(transport)` to start serving.
 *
 * @param db An open SQLite database (see `openDatabase` in `./db.ts`).
 *           The same handle is shared across all tool invocations.
 */
export function buildServer(db: Database): McpServer {
  // Single source of truth for the server version is package.json;
  // bun:sqlite/Bun let us require() it at build time so the compiled
  // binary reports the real version (0.0.1) instead of a stale string.
  const { version } = require("../package.json") as { version: string };
  const server = new McpServer({ name: "intermind", version });

  server.tool(
    "register_agent",
    "Introduce yourself to the room. Returns your agent_id and a session token; pass the token on every subsequent call.",
    registerAgentInput,
    async (args) => run(() => handlers.register_agent(db, args)),
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
