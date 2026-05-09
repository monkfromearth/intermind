/**
 * Intermind database — schema, types, and a single open helper.
 *
 * v1 has exactly two tables (`agents` and `messages`) plus the indexes
 * those queries need. The schema is intentionally tiny because the
 * product is conversation-only: anything an agent wants to *do* with a
 * conversation is the agent's own concern, not Intermind's.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * A row in the `agents` table. Created when an agent calls `join`;
 * persists for the lifetime of the SQLite file.
 *
 * `session_token` is the credential used to authenticate every later
 * tool call. Treat it like a password — never hand it back to anyone
 * other than the agent that registered.
 */
export interface AgentRow {
  /** Stable identifier, prefixed `agt_`. */
  id: string;
  /** Free-text name the agent picked at registration (e.g. "Claude"). */
  display_name: string;
  /** Free-text role label (e.g. "implementer", "reviewer"). */
  role: string;
  /**
   * Room name. Two agents see each other only when they joined the same
   * room. Defaults to `"main"` when the caller of `join` omits it. Picked
   * by the calling LLM, typically from the current git branch (e.g.
   * `"main"`, `"feature-auth"`) so peers in the same worktree converge
   * on the same name without coordinating through the user.
   */
  room: string;
  /** Bearer token used to authenticate this agent on every later call. */
  session_token: string;
  /** Unix epoch ms when the agent registered. */
  connected_at: number;
  /** Unix epoch ms updated on every authenticated call. */
  last_seen: number;
}

/**
 * A row in the `messages` table.
 *
 * Each row has exactly one recipient. A broadcast (`to: '*'` in `send`)
 * is expanded at send time into one row per recipient, so the inbox
 * query stays a simple `WHERE to_agent = ?`.
 *
 * `read_at IS NULL` means the message is still pending in the
 * recipient's inbox.
 */
export interface MessageRow {
  /** Stable identifier, prefixed `msg_`. */
  id: string;
  /** Conversation grouping, prefixed `thr_`. Same id across a back-and-forth. */
  thread_id: string;
  from_agent: string;
  to_agent: string;
  body: string;
  created_at: number;
  /** Unix epoch ms when the recipient first pulled the message; `null` while still in the inbox. */
  read_at: number | null;
}

/**
 * SQL DDL for the v1 schema. One statement per array entry so we can
 * apply them with `db.run()` (multi-statement scripts require `db.exec`,
 * which we avoid).
 */
const SCHEMA_STATEMENTS: readonly string[] = [
  // The `room` column gates everything: peers, inbox, listen, send-broadcast
  // all filter by the caller's room. Default `'main'` keeps callers that
  // omit the new optional `room` arg working — they all land in the same
  // shared room, which matches 0.0.2 behaviour exactly.
  `CREATE TABLE IF NOT EXISTS agents (
     id              TEXT PRIMARY KEY,
     display_name    TEXT NOT NULL,
     role            TEXT NOT NULL,
     room            TEXT NOT NULL DEFAULT 'main',
     session_token   TEXT NOT NULL UNIQUE,
     connected_at    INTEGER NOT NULL,
     last_seen       INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS messages (
     id              TEXT PRIMARY KEY,
     thread_id       TEXT NOT NULL,
     from_agent      TEXT NOT NULL,
     to_agent        TEXT NOT NULL,
     body            TEXT NOT NULL,
     created_at      INTEGER NOT NULL,
     read_at         INTEGER,
     FOREIGN KEY (from_agent) REFERENCES agents(id),
     FOREIGN KEY (to_agent)   REFERENCES agents(id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_inbox  ON messages(to_agent, read_at, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agents_room     ON agents(room)`,
];

/**
 * Open (or create) the Intermind SQLite database and apply the schema.
 *
 * Uses **WAL journal mode** so multiple processes can share the same
 * database file safely. This is the foundation that lets every MCP
 * client (Claude Code, Codex, …) spawn its own Intermind subprocess
 * pointed at the same `.intermind/state.db` — SQLite's WAL handles
 * cross-process concurrency, so Intermind itself needs no daemon, no
 * socket, and no inter-process protocol.
 *
 * @param path Filesystem path to the SQLite file, or `":memory:"` for a
 *             private in-memory DB (used by tests).
 * @returns An open `Database` handle with the schema applied.
 */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  for (const stmt of SCHEMA_STATEMENTS) {
    db.run(stmt);
  }

  return db;
}
