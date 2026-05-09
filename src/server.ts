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
 *
 * Tool descriptions are deliberately imperative ("call this", "do this
 * before that") because the model reads them at tool-discovery time and
 * they're the cheapest place to bake in the proactive behaviors that
 * make agent-to-agent coordination feel alive instead of dead.
 */

import type { Database } from "bun:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { handlers } from "./handlers";
import {
  inboxInput,
  joinInput,
  listenInput,
  peersInput,
  sendInput,
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
 * it gets echoed back in the empty-room hint so a freshly-joined agent
 * can tell which file its peers would need to share.
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
  // reports the real version (e.g. 0.0.3) instead of a stale string.
  const { version } = require("../package.json") as { version: string };
  const server = new McpServer({ name: "intermind", version });

  server.tool(
    "join",
    "Join a room. Mints your agent_id and a session token — save the token, you need it for every other call. Call this once per session before any other Intermind tool. Pick a `room` name: if you're inside a git repo, use the current branch (run `git branch --show-current`); otherwise pick a short kebab-case label from project context. Defaults to 'main' if omitted. AFTER joining, immediately tell the user the room name you chose — they need to tell their other agents to join the same room. If room_size comes back 0 you're alone; the `hint` field will tell you what to relay.",
    joinInput,
    async (args) =>
      run(() => {
        const result = handlers.join(db, args);
        // If the new agent is alone, surface a hint with the room name
        // so the LLM can relay it to the user. The user is the only one
        // who can tell the *other* agent which room name to join with.
        // E.g. BE agent in repo A picks room "feature-auth" and is
        // alone — the hint reminds the LLM to say "tell your FE agent
        // to call join with room: 'feature-auth'".
        if (result.room_size === 0) {
          const dbHint = opts.dbPath ? ` (db: ${opts.dbPath})` : "";
          result.hint =
            `You're alone in room '${result.room}'${dbHint}. ` +
            `Tell the user: "I'm in Intermind room '${result.room}' — ` +
            `please ask your other agent(s) to join the same room name." ` +
            `If they're on a different machine, also share INTERMIND_DB ` +
            `(defaults to ~/.intermind/state.db).`;
        }
        return result;
      }),
  );

  server.tool(
    "whoami",
    "Confirm who you are from your session token. Useful as a sanity check or to recover your agent_id if you've lost track.",
    whoamiInput,
    async (args) => run(() => handlers.whoami(db, args)),
  );

  server.tool(
    "peers",
    "List the other agents in your room — their agent_id, display_name, role, and last_seen timestamp. Returns the room name too so you can confirm where you are. Call this at the start of work to know who you can talk to. Agents in other rooms are invisible.",
    peersInput,
    async (args) => run(() => handlers.peers(db, args)),
  );

  server.tool(
    "send",
    "Send a message. Pass a peer's agent_id in `to` for a DM, or '*' to broadcast to every other agent in your room. Omit `thread_id` to start a new conversation; pass an existing thread_id to continue one (always do this on replies — it's how peers keep context across turns). Recipients in other rooms are invisible — you can only message agents who joined the same room you did. The body is free-text; put diffs/code in fenced code blocks.",
    sendInput,
    async (args) => run(() => handlers.send(db, args)),
  );

  server.tool(
    "inbox",
    "Pull every unread message addressed to you. Marks them read by default — pass mark_read:false to peek without consuming. Call this at the START of every turn, before doing other work: a peer's message is equivalent to a user request and should be answered first. Returns oldest-first.",
    inboxInput,
    async (args) => run(() => handlers.inbox(db, args)),
  );

  server.tool(
    "listen",
    "Block until the next unread message arrives on a thread (up to timeout_sec, default 25, max 120). Use this when you've just sent a message and have nothing useful to do until your peer replies — keeps the conversation hot in the same turn instead of yielding control back to the user. Per-thread; for any-incoming-message use `inbox` instead.",
    listenInput,
    async (args) => run(() => handlers.listen(db, args)),
  );

  return server;
}
