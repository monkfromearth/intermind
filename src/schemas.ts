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
  .describe("recipient agent_id, or '*' to broadcast to every other agent");

/** `register_agent` — declare yourself, receive a session token. */
export const registerAgentInput = {
  display_name: NAME,
  role: NAME,
} as const;

/** `whoami` — confirm identity from a session token. */
export const whoamiInput = {
  token: TOKEN,
} as const;

/** `list_agents` — list everyone currently registered. */
export const listAgentsInput = {
  token: TOKEN,
} as const;

/** `send_message` — DM another agent or broadcast to the room. */
export const sendMessageInput = {
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

/** `wait_for_reply` — long-poll for the next unread message on a thread. */
export const waitForReplyInput = {
  token: TOKEN,
  thread_id: THREAD_ID,
  timeout_sec: z.number().int().positive().max(120).optional(),
} as const;
