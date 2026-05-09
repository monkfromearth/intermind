/**
 * Zod schemas for every MCP tool's input. These are the single source
 * of truth at the MCP boundary — the SDK validates incoming tool calls
 * against them before our handlers ever run, so handlers can trust
 * their arguments.
 *
 * Each export is a `ZodRawShape` (a plain object of zod schemas), which
 * is the shape `McpServer.tool()` expects.
 */

import { z } from "zod";

/** Bounded text fields share these limits to keep messages and labels reasonable. */
const NAME = z.string().min(1).max(64);
const TOKEN = z.string().min(1);
const BODY = z.string().min(1);
const THREAD_ID = z.string().min(1);
const AGENT_ID_OR_BROADCAST = z
  .string()
  .min(1)
  .describe("recipient agent_id, or '*' to broadcast to every other agent in your room");
// Room names are short labels, same length cap as display_name/role. The
// LLM is told to derive this from the current git branch (e.g. "main",
// "feature-auth"); the bound keeps a misbehaving caller from inserting
// a 10 KB room name and bloating the schema.
const ROOM = z.string().min(1).max(64);

/** `join` — declare yourself, receive a session token. */
export const joinInput = {
  display_name: NAME,
  role: NAME,
  // Optional room name. Defaults to "main" when omitted, so 0.0.2-style
  // callers that don't know about rooms keep working. Two agents in the
  // same room see each other; agents in different rooms are invisible to
  // one another even on the same DB file.
  room: ROOM.optional(),
} as const;

/** `whoami` — confirm identity from a session token. */
export const whoamiInput = {
  token: TOKEN,
} as const;

/** `peers` — list everyone currently in your room. */
export const peersInput = {
  token: TOKEN,
} as const;

/** `send` — DM another agent or broadcast to the room. */
export const sendInput = {
  token: TOKEN,
  to: AGENT_ID_OR_BROADCAST,
  thread_id: THREAD_ID.optional(),
  body: BODY,
} as const;

/** `inbox` — pull pending messages addressed to you. */
export const inboxInput = {
  token: TOKEN,
  mark_read: z.boolean().optional(),
  limit: z.number().int().positive().max(100).optional(),
} as const;

/** `listen` — long-poll for the next unread message on a thread. */
export const listenInput = {
  token: TOKEN,
  thread_id: THREAD_ID,
  timeout_sec: z.number().int().positive().max(120).optional(),
} as const;
