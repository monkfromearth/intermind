/**
 * End-to-end tests for the Intermind MCP server.
 *
 * These tests stand up a real `McpServer` (built by `buildServer(db)`),
 * connect a real MCP `Client` to it via the SDK's in-memory transport
 * pair, and exercise every tool over JSON-RPC. They are the closest
 * thing to "what Claude Code actually sees" without launching an MCP
 * client subprocess.
 *
 * Anything tested here that the per-handler tests in `handlers.test.ts`
 * do NOT cover lives at the MCP boundary: tool discovery, JSON envelope
 * shape, `isError` propagation, and zod-level input validation that
 * the SDK enforces before our handlers ever run.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Database } from "bun:sqlite";

import { openDatabase } from "../src/db";
import { buildServer } from "../src/server";

/* ------------------------------------------------------------------ */
/* test harness                                                        */
/* ------------------------------------------------------------------ */

interface E2EHarness {
  client: Client;
  db: Database;
  /** Tear down both transports so tests don't leak handles. */
  close: () => Promise<void>;
}

interface HarnessOptions {
  /** Optional dbPath to thread through buildServer (for hint tests). */
  dbPath?: string;
}

/**
 * Build a fresh in-memory Intermind server, connect a real MCP client
 * to it, and return both. Every test gets its own isolated DB.
 */
async function makeHarness(opts: HarnessOptions = {}): Promise<E2EHarness> {
  const db = openDatabase(":memory:");
  const server = buildServer(db, { dbPath: opts.dbPath });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const client = new Client(
    { name: "intermind-e2e-test", version: "0.0.0" },
    { capabilities: {} },
  );

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const close = async () => {
    await client.close();
    await server.close();
    db.close();
  };

  return { client, db, close };
}

/**
 * Call an MCP tool and parse the JSON payload back into a typed object.
 * Throws if the tool returned `isError: true` (use `callRaw` if you
 * want to inspect the error envelope yourself).
 */
async function call<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    throw new Error(`tool ${name} returned error: ${text}`);
  }
  const text = (result.content as Array<{ text: string }>)[0]!.text;
  return JSON.parse(text) as T;
}

/** Like `call`, but returns the raw envelope so error paths can be asserted. */
async function callRaw(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) {
  return client.callTool({ name, arguments: args });
}

/* ------------------------------------------------------------------ */
/* per-test setup                                                      */
/* ------------------------------------------------------------------ */

let harness: E2EHarness;

beforeEach(async () => {
  harness = await makeHarness();
});

afterEach(async () => {
  await harness.close();
});

/* ------------------------------------------------------------------ */
/* tool discovery                                                      */
/* ------------------------------------------------------------------ */

describe("MCP tool discovery", () => {
  test("server advertises exactly the six v1 tools", async () => {
    const tools = await harness.client.listTools();
    // toSorted() returns a new array; sort() mutates. Doesn't matter for the
    // literal below, but consistent style and lint-clean.
    const names = tools.tools.map((t) => t.name).toSorted();

    expect(names).toEqual(
      ["join", "whoami", "peers", "send", "inbox", "listen"].toSorted(),
    );
  });

  test("every tool advertises a non-empty description", async () => {
    const tools = await harness.client.listTools();
    for (const tool of tools.tools) {
      expect(tool.description?.length).toBeGreaterThan(0);
    }
  });

  test("tools advertise an inputSchema", async () => {
    const tools = await harness.client.listTools();
    for (const tool of tools.tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

/* ------------------------------------------------------------------ */
/* happy path through the real transport                               */
/* ------------------------------------------------------------------ */

describe("end-to-end conversation", () => {
  test("two agents exchange a threaded message via the MCP boundary", async () => {
    const { client } = harness;

    const alice = await call<{ agent_id: string; token: string }>(
      client,
      "join",
      { display_name: "Alice", role: "implementer" },
    );
    const bob = await call<{ agent_id: string; token: string }>(
      client,
      "join",
      { display_name: "Bob", role: "reviewer" },
    );

    const sent = await call<{
      thread_id: string;
      delivered: string[];
      message_ids: string[];
    }>(client, "send", {
      token: alice.token,
      to: bob.agent_id,
      body: "please review",
    });
    expect(sent.delivered).toEqual([bob.agent_id]);
    expect(sent.thread_id).toMatch(/^thr_/);

    const inbox = await call<{
      count: number;
      messages: Array<{ body: string; from_agent: string; thread_id: string }>;
    }>(client, "inbox", { token: bob.token });

    expect(inbox.count).toBe(1);
    expect(inbox.messages[0]!.body).toBe("please review");
    expect(inbox.messages[0]!.from_agent).toBe(alice.agent_id);
    expect(inbox.messages[0]!.thread_id).toBe(sent.thread_id);
  });

  test("peers over MCP returns the other agents in the caller's room", async () => {
    const { client } = harness;
    const a = await call<{ token: string; agent_id: string }>(client, "join", {
      display_name: "Ann",
      role: "x",
    });
    const b = await call<{ token: string; agent_id: string }>(client, "join", {
      display_name: "Bea",
      role: "y",
    });

    // peers excludes the caller, so Ann asking should see only Bea.
    // The room field echoes back the room — handy for the LLM to
    // confirm-and-announce in one step.
    const list = await call<{ room: string; agents: Array<{ id: string }> }>(
      client,
      "peers",
      { token: a.token },
    );
    expect(list.room).toBe("main");
    expect(list.agents.map((x) => x.id)).toEqual([b.agent_id]);
  });

  test("whoami over MCP round-trips the caller's identity", async () => {
    const { client } = harness;
    const a = await call<{ token: string; agent_id: string }>(client, "join", {
      display_name: "Ann",
      role: "x",
    });

    const me = await call<{ agent_id: string; display_name: string }>(
      client,
      "whoami",
      { token: a.token },
    );
    expect(me.agent_id).toBe(a.agent_id);
    expect(me.display_name).toBe("Ann");
  });
});

/* ------------------------------------------------------------------ */
/* broadcast over the wire                                             */
/* ------------------------------------------------------------------ */

describe("broadcast end-to-end", () => {
  test("'*' fans out to every other agent's inbox", async () => {
    const { client } = harness;
    const a = await call<{ token: string; agent_id: string }>(client, "join", {
      display_name: "A",
      role: "x",
    });
    const b = await call<{ token: string; agent_id: string }>(client, "join", {
      display_name: "B",
      role: "x",
    });
    const c = await call<{ token: string; agent_id: string }>(client, "join", {
      display_name: "C",
      role: "x",
    });

    const sent = await call<{ delivered: string[] }>(client, "send", {
      token: a.token,
      to: "*",
      body: "hello room",
    });
    expect(sent.delivered.toSorted()).toEqual([b.agent_id, c.agent_id].toSorted());

    const bIn = await call<{ count: number }>(client, "inbox", { token: b.token });
    const cIn = await call<{ count: number }>(client, "inbox", { token: c.token });
    expect(bIn.count).toBe(1);
    expect(cIn.count).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* long-poll over the wire                                             */
/* ------------------------------------------------------------------ */

describe("listen end-to-end", () => {
  test("blocks until a message arrives on the thread", async () => {
    const { client } = harness;
    const a = await call<{ token: string; agent_id: string }>(client, "join", {
      display_name: "A",
      role: "x",
    });
    const b = await call<{ token: string; agent_id: string }>(client, "join", {
      display_name: "B",
      role: "x",
    });

    // listen does NOT take poll_ms over MCP, so this exercises the
    // production 200ms poll. We start the wait, then send 250ms later,
    // and assert the wait resolved with the message.
    const thread_id = `thr_${crypto.randomUUID()}`;
    const waiter = call<{ message: { body: string } | null; timeout: boolean }>(
      client,
      "listen",
      { token: b.token, thread_id, timeout_sec: 5 },
    );

    setTimeout(() => {
      void call(client, "send", {
        token: a.token,
        to: b.agent_id,
        thread_id,
        body: "late",
      });
    }, 250);

    const out = await waiter;
    expect(out.timeout).toBe(false);
    expect(out.message?.body).toBe("late");
  });

  test("times out cleanly when no message arrives", async () => {
    const { client } = harness;
    const b = await call<{ token: string; agent_id: string }>(client, "join", {
      display_name: "B",
      role: "x",
    });

    const out = await call<{ message: null; timeout: boolean }>(
      client,
      "listen",
      { token: b.token, thread_id: "thr_empty", timeout_sec: 1 },
    );
    expect(out.timeout).toBe(true);
    expect(out.message).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* empty-room hint                                                     */
/* ------------------------------------------------------------------ */

describe("empty-room hint on join", () => {
  test("first agent gets a hint with the room name and dbPath", async () => {
    // Custom harness so we can pass an explicit dbPath. The hint embeds
    // both the room name (so the LLM can tell the user what to relay)
    // and the dbPath (so the user knows which file a peer would share).
    const local = await makeHarness({ dbPath: "/tmp/test-intermind.db" });
    try {
      const reg = await call<{
        room: string;
        room_size: number;
        hint?: string;
      }>(local.client, "join", {
        display_name: "Solo",
        role: "x",
        room: "feature-auth",
      });

      // Alone in the room → room_size: 0 and the hint must include the
      // room name (so the LLM can repeat it back to the user) plus the
      // INTERMIND_DB lever for the cross-machine case.
      expect(reg.room).toBe("feature-auth");
      expect(reg.room_size).toBe(0);
      expect(reg.hint).toBeDefined();
      expect(reg.hint).toContain("feature-auth");
      expect(reg.hint).toContain("/tmp/test-intermind.db");
      expect(reg.hint).toContain("INTERMIND_DB");
    } finally {
      await local.close();
    }
  });

  test("second agent in the same room gets no hint", async () => {
    const local = await makeHarness({ dbPath: "/tmp/test-intermind.db" });
    try {
      await call(local.client, "join", {
        display_name: "First",
        role: "x",
      });
      const second = await call<{ room_size: number; hint?: string }>(
        local.client,
        "join",
        { display_name: "Second", role: "x" },
      );

      expect(second.room_size).toBe(1);
      expect(second.hint).toBeUndefined();
    } finally {
      await local.close();
    }
  });

  test("hint without a configured dbPath omits the path but keeps the room name", async () => {
    // Default harness — no dbPath passed. Hint should still mention the
    // room name (the actionable part: "tell your peer to use this room")
    // even when the path is unknown.
    const reg = await call<{ room: string; room_size: number; hint?: string }>(
      harness.client,
      "join",
      { display_name: "Solo", role: "x", room: "alpha" },
    );
    expect(reg.room_size).toBe(0);
    expect(reg.hint).toBeDefined();
    expect(reg.hint).toContain("alpha");
  });
});

/* ------------------------------------------------------------------ */
/* error envelopes                                                     */
/* ------------------------------------------------------------------ */

describe("error envelope at the MCP boundary", () => {
  test("an unknown session token surfaces as isError, not a transport crash", async () => {
    const result = await callRaw(harness.client, "whoami", {
      token: "tok_does_not_exist",
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("invalid session token");
  });

  test("an unknown recipient on send surfaces as isError", async () => {
    const a = await call<{ token: string; agent_id: string }>(
      harness.client,
      "join",
      { display_name: "A", role: "x" },
    );
    const result = await callRaw(harness.client, "send", {
      token: a.token,
      to: "agt_nope",
      body: "x",
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("unknown recipient");
  });

  test("zod rejects an empty message body before the handler runs", async () => {
    const a = await call<{ token: string; agent_id: string }>(
      harness.client,
      "join",
      { display_name: "A", role: "x" },
    );
    const b = await call<{ token: string; agent_id: string }>(
      harness.client,
      "join",
      { display_name: "B", role: "x" },
    );

    // Validation failures may surface either as a thrown JSON-RPC error
    // OR as an `isError: true` envelope, depending on SDK version. Both
    // are acceptable; what matters is that the call did NOT succeed and
    // no message was created in the recipient's inbox.
    await expectRejection(
      harness.client.callTool({
        name: "send",
        arguments: { token: a.token, to: b.agent_id, body: "" },
      }),
      /body|invalid|validation|string|empty/i,
    );

    const inbox = await call<{ count: number }>(harness.client, "inbox", {
      token: b.token,
    });
    expect(inbox.count).toBe(0);
  });

  test("zod rejects a missing required field on join", async () => {
    await expectRejection(
      harness.client.callTool({
        name: "join",
        // Intentionally missing `role` — exercises Zod validation path.
        arguments: { display_name: "A" } as Record<string, unknown>,
      }),
      /role|invalid|required/i,
    );
  });
});

/**
 * Assert that an MCP tool call did not succeed. Accepts either:
 *   1. a rejected promise (the SDK threw a JSON-RPC protocol error), or
 *   2. a fulfilled promise carrying `isError: true` (the server
 *      surfaced the failure as an in-band tool error envelope).
 *
 * Different SDK versions handle validation failures differently; both
 * are valid as long as the call doesn't succeed silently.
 */
async function expectRejection(
  promise: Promise<unknown>,
  matcher: RegExp,
): Promise<void> {
  try {
    const result = (await promise) as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toMatch(matcher);
  } catch (err) {
    expect(String(err)).toMatch(matcher);
  }
}
