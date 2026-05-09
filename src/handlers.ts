/**
 * The six pure handler functions. Each takes a database and validated
 * arguments, and returns a plain object. They are deliberately
 * decoupled from the MCP transport layer so tests can call them
 * directly without spinning up the SDK.
 *
 * Authentication: every handler except `join` calls `authenticate()`
 * first, which both verifies the session token and bumps the agent's
 * `last_seen` timestamp. Handlers never trust an `agent_id` passed in
 * arguments — they always derive identity from the token.
 */

import { Database } from "bun:sqlite";
import type { AgentRow, MessageRow } from "./db";

/* ------------------------------------------------------------------ */
/* identifiers                                                         */
/* ------------------------------------------------------------------ */

/** Identifier prefixes — make ids self-documenting in logs and traces. */
const ID_PREFIX = {
  agent: "agt",
  message: "msg",
  thread: "thr",
  token: "tok",
} as const;

type IdKind = keyof typeof ID_PREFIX;

/** Generate a prefixed UUID. `newId('agent')` → `"agt_<uuid>"`. */
const newId = (kind: IdKind): string =>
  `${ID_PREFIX[kind]}_${crypto.randomUUID()}`;

/* ------------------------------------------------------------------ */
/* defaults & limits                                                   */
/* ------------------------------------------------------------------ */

const DEFAULT_INBOX_LIMIT = 50;
/** Hard cap so a runaway caller can't ask for the entire mailbox at once. */
const MAX_INBOX_LIMIT = 100;
const DEFAULT_WAIT_TIMEOUT_SEC = 25;
/**
 * Poll interval inside `listen`. Trades latency for SQLite churn.
 * Not exposed over MCP — it's a handler-internal knob the test suite
 * uses to keep tests fast.
 */
const DEFAULT_POLL_MS = 200;

/* ------------------------------------------------------------------ */
/* authentication                                                      */
/* ------------------------------------------------------------------ */

/**
 * Resolve the agent that owns `token`, and bump its `last_seen`.
 *
 * @throws {Error} if the token doesn't match any registered agent.
 */
function authenticate(db: Database, token: string): AgentRow {
  const row = db
    .query("SELECT * FROM agents WHERE session_token = ?")
    .get(token) as AgentRow | null;

  if (!row) {
    throw new Error("invalid session token; call join first");
  }

  db.run("UPDATE agents SET last_seen = ? WHERE id = ?", [Date.now(), row.id]);
  return row;
}

/* ------------------------------------------------------------------ */
/* handler argument & return types                                     */
/* ------------------------------------------------------------------ */

export interface JoinArgs {
  display_name: string;
  role: string;
  /**
   * Optional room name. Defaults to `"main"` when omitted. Two agents
   * see each other only when they joined the same room. Picked by the
   * calling LLM (typically from the current git branch — `"main"`,
   * `"feature-auth"`) so peers in the same worktree converge without
   * coordinating through the user.
   */
  room?: string;
}

export interface JoinResult {
  agent_id: string;
  /** The session token. The caller must keep this private. */
  token: string;
  display_name: string;
  role: string;
  /** Room the agent landed in. Echoes back the input or the default. */
  room: string;
  /**
   * Number of *other* agents in this room at registration time. 0 means
   * the caller is alone — useful so the server layer can decide whether
   * to attach an "are you sure your peer is on the same room?" hint.
   */
  room_size: number;
  /**
   * Optional onboarding hint (e.g. "you're alone in this room — tell
   * your peer to call join with room: '<name>'"). Set by the server
   * layer because the handler doesn't know the configured db path.
   */
  hint?: string;
}

export interface AuthedArgs {
  token: string;
}

export interface WhoamiResult {
  agent_id: string;
  display_name: string;
  role: string;
  connected_at: number;
}

export type AgentSummary = Omit<AgentRow, "session_token">;

export interface PeersResult {
  /** The room the caller is in (so the LLM can confirm and tell the user). */
  room: string;
  /** Other agents in the same room. The caller is excluded from this list. */
  agents: AgentSummary[];
}

export interface SendArgs extends AuthedArgs {
  /** Recipient `agent_id`, or `'*'` to broadcast to every other agent. */
  to: string;
  /** Optional thread id; omit to start a new thread. */
  thread_id?: string;
  body: string;
}

export interface SendResult {
  thread_id: string;
  message_ids: string[];
  delivered: string[];
  /** Set when a broadcast had no recipients. */
  warning?: string;
}

export interface InboxArgs extends AuthedArgs {
  /** Mark the returned messages as read. Default: `true`. */
  mark_read?: boolean;
  /** Cap on rows returned. Default: 50, max: 100. */
  limit?: number;
}

export interface InboxResult {
  messages: MessageRow[];
  count: number;
}

export interface ListenArgs extends AuthedArgs {
  thread_id: string;
  /** Maximum seconds to block. Default: 25. */
  timeout_sec?: number;
  /** Internal knob — poll interval. Tests use a short value. */
  poll_ms?: number;
}

export interface ListenResult {
  message: MessageRow | null;
  timeout: boolean;
}

/* ------------------------------------------------------------------ */
/* handlers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Join the room: register a new agent and mint a session token.
 *
 * The returned `token` is the credential for every later call. The
 * server uses it to identify the caller; agents cannot impersonate each
 * other by passing a different `agent_id` in arguments.
 */
function join(db: Database, args: JoinArgs): JoinResult {
  const id = newId("agent");
  const token = newId("token");
  const now = Date.now();
  // Default room "main" preserves 0.0.2 behaviour exactly — callers
  // that don't pass `room` all land together in the same shared room.
  const room = args.room ?? "main";

  db.run(
    "INSERT INTO agents (id, display_name, role, room, session_token, connected_at, last_seen) VALUES (?,?,?,?,?,?,?)",
    [id, args.display_name, args.role, room, token, now, now],
  );

  // Count peers in the *same room* (excluding us). Agents in other
  // rooms on the same DB file are invisible. Example: BE joined room
  // "feature-auth" and FE joined room "main" — both see room_size: 0
  // and the empty-room hint tells them to converge on one room name.
  const peer_count = db
    .query("SELECT COUNT(*) AS n FROM agents WHERE id != ? AND room = ?")
    .get(id, room) as { n: number };

  return {
    agent_id: id,
    token,
    display_name: args.display_name,
    role: args.role,
    room,
    room_size: peer_count.n,
  };
}

/** Confirm identity from a session token. Throws if the token is unknown. */
function whoami(db: Database, args: AuthedArgs): WhoamiResult {
  const me = authenticate(db, args.token);
  return {
    agent_id: me.id,
    display_name: me.display_name,
    role: me.role,
    connected_at: me.connected_at,
  };
}

/**
 * List peers — every agent currently in the caller's room, except the
 * caller themselves. Ordered by `connected_at`; session tokens are
 * never included. Agents in other rooms on the same DB file are
 * invisible by design.
 */
function peers(db: Database, args: AuthedArgs): PeersResult {
  const me = authenticate(db, args.token);

  // Filter by room *and* exclude self, so the returned list is exactly
  // "who can I talk to right now." Excluding self is what makes the
  // result directly usable as candidate `to:` values for `send`.
  const rows = db
    .query(
      "SELECT id, display_name, role, room, connected_at, last_seen FROM agents WHERE room = ? AND id != ? ORDER BY connected_at",
    )
    .all(me.room, me.id) as AgentSummary[];

  return { room: me.room, agents: rows };
}

/**
 * Send a message to another agent, or broadcast to every other agent
 * by passing `to: '*'`.
 *
 * - If `thread_id` is omitted, a fresh thread id is minted and returned.
 *   Reply with the same `thread_id` to stay in the conversation.
 * - A broadcast expands to one row per other-agent at send time. If
 *   nobody else is registered, the call is a no-op and returns a
 *   `warning` field.
 *
 * @throws {Error} if `to` is neither `'*'` nor a known `agent_id`.
 */
function send(db: Database, args: SendArgs): SendResult {
  const me = authenticate(db, args.token);
  const thread_id = args.thread_id ?? newId("thread");
  const created_at = Date.now();

  const recipients = resolveRecipients(db, me.id, me.room, args.to);

  if (recipients.length === 0) {
    return {
      thread_id,
      message_ids: [],
      delivered: [],
      warning:
        "no other agents are registered; broadcast had nowhere to go",
    };
  }

  // db.query caches the prepared statement by SQL string; re-calls reuse it.
  // db.prepare would build a fresh statement every call. Same correctness, less churn.
  const insert = db.query(
    "INSERT INTO messages (id, thread_id, from_agent, to_agent, body, created_at) VALUES (?,?,?,?,?,?)",
  );

  const message_ids: string[] = [];
  const tx = db.transaction(() => {
    for (const to_agent of recipients) {
      const id = newId("message");
      insert.run(id, thread_id, me.id, to_agent, args.body, created_at);
      message_ids.push(id);
    }
  });
  tx();

  return { thread_id, message_ids, delivered: recipients };
}

/**
 * Resolve a `to` value into the concrete list of recipient agent_ids,
 * scoped to the sender's room.
 *
 * - `'*'` → every agent in the same room as the sender, except the sender.
 * - any other string → that exact `agent_id`, but only if it's in the
 *   sender's room. Cross-room sends throw — agents in other rooms are
 *   invisible by design.
 */
function resolveRecipients(
  db: Database,
  fromAgent: string,
  fromRoom: string,
  to: string,
): string[] {
  if (to === "*") {
    const rows = db
      .query("SELECT id FROM agents WHERE id != ? AND room = ?")
      .all(fromAgent, fromRoom) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  // Only resolve agents that share the caller's room. An agent_id that
  // exists in a different room behaves the same as a non-existent id —
  // the sender shouldn't be able to confirm presence across rooms.
  const target = db
    .query("SELECT id FROM agents WHERE id = ? AND room = ?")
    .get(to, fromRoom) as { id: string } | null;

  if (!target) {
    throw new Error(`unknown recipient agent_id: ${to}`);
  }

  return [target.id];
}

/**
 * Pull pending (unread) messages addressed to the caller.
 *
 * Marks the returned messages read in the same transaction unless the
 * caller passed `mark_read: false`. Limit defaults to 50 and is hard-
 * capped at 100 by the schema validator before this handler runs.
 */
function inbox(db: Database, args: InboxArgs): InboxResult {
  const me = authenticate(db, args.token);
  const requested = args.limit ?? DEFAULT_INBOX_LIMIT;
  // The MCP zod schema also caps this, but we re-clamp here so handlers
  // are safe to call directly (e.g. from tests or future transports).
  const limit = Math.min(Math.max(1, requested), MAX_INBOX_LIMIT);
  const mark_read = args.mark_read ?? true;

  const rows = db
    .query(
      "SELECT * FROM messages WHERE to_agent = ? AND read_at IS NULL ORDER BY created_at LIMIT ?",
    )
    .all(me.id, limit) as MessageRow[];

  if (mark_read && rows.length > 0) {
    markRead(db, rows.map((r) => r.id));
  }

  return { messages: rows, count: rows.length };
}

/** Mark a batch of messages read, all in one transaction. */
function markRead(db: Database, messageIds: string[]): void {
  const now = Date.now();
  const update = db.query("UPDATE messages SET read_at = ? WHERE id = ?");
  const tx = db.transaction(() => {
    for (const id of messageIds) update.run(now, id);
  });
  tx();
}

/**
 * Listen on a thread: long-poll for the next unread message. Returns
 * immediately if a message is already waiting; otherwise blocks up to
 * `timeout_sec` (default 25), polling SQLite every `poll_ms` (default
 * 200ms) until something arrives.
 *
 * Returning a message also marks it read.
 */
async function listen(
  db: Database,
  args: ListenArgs,
): Promise<ListenResult> {
  const me = authenticate(db, args.token);
  const timeout_ms = (args.timeout_sec ?? DEFAULT_WAIT_TIMEOUT_SEC) * 1000;
  const poll_ms = args.poll_ms ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + timeout_ms;

  const peek = db.query(
    "SELECT * FROM messages WHERE thread_id = ? AND to_agent = ? AND read_at IS NULL ORDER BY created_at LIMIT 1",
  );
  const update = db.query("UPDATE messages SET read_at = ? WHERE id = ?");

  while (true) {
    const row = peek.get(args.thread_id, me.id) as MessageRow | null;
    if (row) {
      update.run(Date.now(), row.id);
      return { message: row, timeout: false };
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return { message: null, timeout: true };
    }

    await Bun.sleep(Math.min(poll_ms, remaining));
  }
}

/* ------------------------------------------------------------------ */
/* exports                                                             */
/* ------------------------------------------------------------------ */

/**
 * The full set of pure handlers, indexed by tool name. Importing this
 * object gives tests a transport-free way to exercise every tool.
 */
export const handlers = {
  join,
  whoami,
  peers,
  send,
  inbox,
  listen,
} as const;
