/**
 * End-to-end smoke test for the compiled binary.
 *
 * Spawns two `bin/intermind` subprocesses pointing at the same SQLite
 * file, then runs a complete FE <-> BE conversation through the SDK:
 *   - both join, both list peers
 *   - FE sends a message
 *   - BE receives via listen, replies on the same thread
 *   - FE receives the reply via listen
 *
 * This is the closest thing to "two Claude Code instances talking" we
 * can run without spinning up real LLM clients.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BINARY = join(import.meta.dir, "..", "bin", "intermind");
const ROOM_DIR = mkdtempSync(join(tmpdir(), "intermind-smoke-"));
const DB_PATH = join(ROOM_DIR, "state.db");

// Wraps client.callTool and parses the JSON envelope MCP returns.
// MCP wraps every tool result in `{ content: [{ type: "text", text: "<json>" }] }`,
// so the actual handler return value is the parsed `text` of the first content block.
// Example: `join` returns {agent_id, token} but over MCP arrives as
//   { content: [{ type: "text", text: '{"agent_id":"...","token":"..."}' }] }.
async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  if (res.isError) {
    throw new Error(`tool ${name} returned error: ${JSON.stringify(res.content)}`);
  }
  const block = res.content?.[0];
  if (!block || block.type !== "text" || typeof block.text !== "string") {
    throw new Error(`tool ${name} returned unexpected envelope: ${JSON.stringify(res)}`);
  }
  return JSON.parse(block.text) as T;
}

// Spawn the compiled binary as a stdio MCP server, connect a fresh Client
// to it, and return a tear-down hook. Each call here = one subprocess.
// Two calls = two subprocesses sharing the same DB file via WAL — exactly
// how two Claude Code instances would talk in real use.
async function spawnAgent(label: string): Promise<{ client: Client; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command: BINARY,
    env: { INTERMIND_DB: DB_PATH, PATH: process.env.PATH ?? "" },
  });
  const client = new Client({ name: `smoke-${label}`, version: "0.0.1" });
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await client.close();
      await transport.close();
    },
  };
}

async function main(): Promise<void> {
  console.log(`[smoke] room: ${ROOM_DIR}`);

  const fe = await spawnAgent("fe");
  const be = await spawnAgent("be");
  console.log("[smoke] both clients connected");

  // Step 1 - both agents join. Each returns a fresh agent_id + bearer
  // token that must be passed on every subsequent call.
  const feReg = await call<{ agent_id: string; token: string }>(
    fe.client,
    "join",
    { display_name: "FE", role: "frontend" },
  );
  const beReg = await call<{ agent_id: string; token: string }>(
    be.client,
    "join",
    { display_name: "BE", role: "backend" },
  );
  console.log(`[smoke] FE joined: ${feReg.agent_id}`);
  console.log(`[smoke] BE joined: ${beReg.agent_id}`);

  // Step 2 - FE lists peers. Should see only BE (peers excludes the
  // caller) through the shared SQLite file (WAL lets the second
  // subprocess read writes from the first immediately).
  const fePeers = await call<{ room: string; agents: Array<{ id: string; display_name: string; role: string }> }>(
    fe.client,
    "peers",
    { token: feReg.token },
  );
  if (fePeers.agents.length !== 1) {
    throw new Error(`expected 1 peer (BE), got ${fePeers.agents.length}`);
  }
  if (fePeers.room !== "main") {
    throw new Error(`expected default room 'main', got '${fePeers.room}'`);
  }
  console.log(`[smoke] FE in room '${fePeers.room}', sees peer: ${fePeers.agents.map((a) => `${a.display_name}(${a.role})`).join(", ")}`);

  // Step 3 - FE sends an opening message. No thread_id given, so the
  // server creates one and returns it; we'll reuse it for the BE reply.
  const feSend = await call<{ thread_id: string; message_ids: string[]; delivered: string[] }>(
    fe.client,
    "send",
    {
      token: feReg.token,
      to: beReg.agent_id,
      body: "ready to talk about the user creation API. what shape does the form post?",
    },
  );
  console.log(`[smoke] FE sent on thread ${feSend.thread_id}, delivered to ${feSend.delivered.length} peer(s)`);

  // Step 4 - BE long-polls for the message. timeout_sec=5 is plenty since
  // the row is already in the DB before this call returns from FE's send.
  const beReceived = await call<{ message: { id: string; thread_id: string; from_agent: string; body: string } | null; timeout: boolean }>(
    be.client,
    "listen",
    { token: beReg.token, thread_id: feSend.thread_id, timeout_sec: 5 },
  );
  if (!beReceived.message) throw new Error("BE timed out waiting for FE message");
  if (beReceived.message.from_agent !== feReg.agent_id) {
    throw new Error(`BE saw from_agent=${beReceived.message.from_agent}, expected ${feReg.agent_id}`);
  }
  console.log(`[smoke] BE received: "${beReceived.message.body.slice(0, 60)}..."`);

  // Step 5 - BE replies on the same thread. Verifying thread_id round-trips
  // catches a class of bug where the server silently starts a new thread.
  const beReply = await call<{ thread_id: string; delivered: string[] }>(
    be.client,
    "send",
    {
      token: beReg.token,
      to: feReg.agent_id,
      thread_id: feSend.thread_id,
      body: "POST /users with { email, password, name }. all required.",
    },
  );
  if (beReply.thread_id !== feSend.thread_id) {
    throw new Error(`BE reply thread mismatch: ${beReply.thread_id} vs ${feSend.thread_id}`);
  }
  console.log(`[smoke] BE replied on same thread`);

  // Step 6 - FE picks up BE's reply via listen.
  const feReceived = await call<{ message: { id: string; thread_id: string; from_agent: string; body: string } | null; timeout: boolean }>(
    fe.client,
    "listen",
    { token: feReg.token, thread_id: feSend.thread_id, timeout_sec: 5 },
  );
  if (!feReceived.message) throw new Error("FE timed out waiting for BE reply");
  if (feReceived.message.from_agent !== beReg.agent_id) {
    throw new Error(`FE saw from_agent=${feReceived.message.from_agent}, expected ${beReg.agent_id}`);
  }
  console.log(`[smoke] FE received reply: "${feReceived.message.body.slice(0, 60)}..."`);

  // Step 7 - both inboxes empty (`listen` marks-read on consume,
  // so a follow-up inbox() with default mark_read=true should drain to 0).
  const feInbox = await call<{ messages: unknown[]; count: number }>(
    fe.client,
    "inbox",
    { token: feReg.token },
  );
  const beInbox = await call<{ messages: unknown[]; count: number }>(
    be.client,
    "inbox",
    { token: beReg.token },
  );
  if (feInbox.count !== 0 || beInbox.count !== 0) {
    throw new Error(`expected both inboxes empty, got FE=${feInbox.count} BE=${beInbox.count}`);
  }
  console.log(`[smoke] both inboxes drained`);

  await fe.close();
  await be.close();
  console.log(`[smoke] OK - full FE<->BE round-trip through compiled binary`);
}

main()
  .catch((err: unknown) => {
    console.error("[smoke] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(ROOM_DIR, { recursive: true, force: true });
  });
