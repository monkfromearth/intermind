/**
 * Unit tests for the Intermind handlers.
 *
 * These tests exercise the pure handler functions directly — no MCP
 * transport, no SDK wiring. Each test runs against a fresh in-memory
 * SQLite database so cases are fully isolated.
 */

import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";

import { openDatabase } from "../src/db";
import { handlers, type RegisterAgentResult } from "../src/handlers";

/* ------------------------------------------------------------------ */
/* test fixtures                                                       */
/* ------------------------------------------------------------------ */

/** Spin up a private, in-memory database with the schema applied. */
function freshDb(): Database {
  return openDatabase(":memory:");
}

interface TwoAgents {
  db: Database;
  alice: RegisterAgentResult;
  bob: RegisterAgentResult;
}

/** Common setup: one DB and two registered agents (Alice + Bob). */
function withTwoAgents(): TwoAgents {
  const db = freshDb();
  const alice = handlers.register_agent(db, {
    display_name: "Claude",
    role: "implementer",
  });
  const bob = handlers.register_agent(db, {
    display_name: "Codex",
    role: "reviewer",
  });
  return { db, alice, bob };
}

/* ------------------------------------------------------------------ */
/* register_agent + whoami                                             */
/* ------------------------------------------------------------------ */

describe("register_agent + whoami", () => {
  test("returns a prefixed agent_id and session token", () => {
    const db = freshDb();
    const reg = handlers.register_agent(db, {
      display_name: "Claude",
      role: "implementer",
    });

    expect(reg.agent_id).toMatch(/^agt_/);
    expect(reg.token).toMatch(/^tok_/);
    expect(reg.display_name).toBe("Claude");
    expect(reg.role).toBe("implementer");
  });

  test("whoami round-trips a valid token", () => {
    const db = freshDb();
    const reg = handlers.register_agent(db, {
      display_name: "Claude",
      role: "x",
    });

    const me = handlers.whoami(db, { token: reg.token });

    expect(me.agent_id).toBe(reg.agent_id);
    expect(me.display_name).toBe("Claude");
  });

  test("whoami rejects an unknown token", () => {
    const db = freshDb();
    expect(() => handlers.whoami(db, { token: "tok_nope" })).toThrow(
      /invalid session token/,
    );
  });
});

/* ------------------------------------------------------------------ */
/* list_agents                                                         */
/* ------------------------------------------------------------------ */

describe("list_agents", () => {
  test("includes every registered agent", () => {
    const { db, alice, bob } = withTwoAgents();

    const out = handlers.list_agents(db, { token: alice.token });
    // toSorted() returns a new array; sort() mutates in place. Use toSorted()
    // here so the assertion can't accidentally reorder out.agents for later code.
    const ids = out.agents.map((a) => a.id).toSorted();

    expect(ids).toEqual([alice.agent_id, bob.agent_id].toSorted());
  });

  test("never leaks session tokens", () => {
    const { db, alice } = withTwoAgents();

    const out = handlers.list_agents(db, { token: alice.token });

    for (const agent of out.agents) {
      expect(Object.keys(agent)).not.toContain("session_token");
    }
  });
});

/* ------------------------------------------------------------------ */
/* send_message + inbox                                                */
/* ------------------------------------------------------------------ */

describe("send_message + inbox", () => {
  test("a direct message lands in the recipient's inbox", () => {
    const { db, alice, bob } = withTwoAgents();

    const sent = handlers.send_message(db, {
      token: alice.token,
      to: bob.agent_id,
      body: "please review",
    });
    expect(sent.delivered).toEqual([bob.agent_id]);
    expect(sent.message_ids).toHaveLength(1);
    expect(sent.thread_id).toMatch(/^thr_/);

    const inbox = handlers.inbox(db, { token: bob.token });
    expect(inbox.count).toBe(1);
    expect(inbox.messages[0]!.body).toBe("please review");
    expect(inbox.messages[0]!.from_agent).toBe(alice.agent_id);
    expect(inbox.messages[0]!.thread_id).toBe(sent.thread_id);
  });

  test("inbox marks messages read by default", () => {
    const { db, alice, bob } = withTwoAgents();
    handlers.send_message(db, {
      token: alice.token,
      to: bob.agent_id,
      body: "hi",
    });

    const first = handlers.inbox(db, { token: bob.token });
    const second = handlers.inbox(db, { token: bob.token });

    expect(first.count).toBe(1);
    expect(second.count).toBe(0);
  });

  test("inbox(mark_read=false) leaves messages pending", () => {
    const { db, alice, bob } = withTwoAgents();
    handlers.send_message(db, {
      token: alice.token,
      to: bob.agent_id,
      body: "hi",
    });

    handlers.inbox(db, { token: bob.token, mark_read: false });
    const again = handlers.inbox(db, { token: bob.token });

    expect(again.count).toBe(1);
  });

  test("rejects an unknown recipient agent_id", () => {
    const { db, alice } = withTwoAgents();

    expect(() =>
      handlers.send_message(db, {
        token: alice.token,
        to: "agt_nope",
        body: "x",
      }),
    ).toThrow(/unknown recipient/);
  });

  test("preserves an explicit thread_id across replies", () => {
    const { db, alice, bob } = withTwoAgents();

    const m1 = handlers.send_message(db, {
      token: alice.token,
      to: bob.agent_id,
      body: "first",
    });
    const m2 = handlers.send_message(db, {
      token: bob.token,
      to: alice.agent_id,
      thread_id: m1.thread_id,
      body: "reply",
    });

    expect(m2.thread_id).toBe(m1.thread_id);
  });
});

/* ------------------------------------------------------------------ */
/* broadcast                                                           */
/* ------------------------------------------------------------------ */

describe("broadcast (to: '*')", () => {
  test("fans out to every other agent", () => {
    const db = freshDb();
    const a = handlers.register_agent(db, { display_name: "A", role: "x" });
    const b = handlers.register_agent(db, { display_name: "B", role: "x" });
    const c = handlers.register_agent(db, { display_name: "C", role: "x" });

    const sent = handlers.send_message(db, {
      token: a.token,
      to: "*",
      body: "hello room",
    });

    expect(sent.delivered.toSorted()).toEqual([b.agent_id, c.agent_id].toSorted());
    expect(sent.message_ids).toHaveLength(2);

    expect(handlers.inbox(db, { token: b.token }).count).toBe(1);
    expect(handlers.inbox(db, { token: c.token }).count).toBe(1);
    // The sender does not receive their own broadcast.
    expect(handlers.inbox(db, { token: a.token }).count).toBe(0);
  });

  test("with no other agents, returns a warning instead of failing", () => {
    const db = freshDb();
    const a = handlers.register_agent(db, { display_name: "A", role: "x" });

    const sent = handlers.send_message(db, {
      token: a.token,
      to: "*",
      body: "anyone?",
    });

    expect(sent.delivered).toEqual([]);
    expect(sent.warning).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* wait_for_reply (long-poll)                                          */
/* ------------------------------------------------------------------ */

describe("wait_for_reply", () => {
  test("returns immediately when a message is already waiting", async () => {
    const { db, alice, bob } = withTwoAgents();
    const sent = handlers.send_message(db, {
      token: alice.token,
      to: bob.agent_id,
      body: "hi",
    });

    const t0 = Date.now();
    const out = await handlers.wait_for_reply(db, {
      token: bob.token,
      thread_id: sent.thread_id,
      timeout_sec: 5,
      poll_ms: 50,
    });

    expect(Date.now() - t0).toBeLessThan(200);
    expect(out.timeout).toBe(false);
    expect(out.message?.body).toBe("hi");
  });

  test("blocks until a message arrives on the thread", async () => {
    const { db, alice, bob } = withTwoAgents();
    const thread_id = `thr_${crypto.randomUUID()}`;

    const waiter = handlers.wait_for_reply(db, {
      token: bob.token,
      thread_id,
      timeout_sec: 5,
      poll_ms: 50,
    });

    setTimeout(() => {
      handlers.send_message(db, {
        token: alice.token,
        to: bob.agent_id,
        thread_id,
        body: "late",
      });
    }, 150);

    const out = await waiter;
    expect(out.timeout).toBe(false);
    expect(out.message?.body).toBe("late");
  });

  test("times out cleanly when no message arrives", async () => {
    const { db, bob } = withTwoAgents();

    const out = await handlers.wait_for_reply(db, {
      token: bob.token,
      thread_id: "thr_empty",
      timeout_sec: 1,
      poll_ms: 50,
    });

    expect(out.timeout).toBe(true);
    expect(out.message).toBeNull();
  });

  test("only returns messages on the requested thread", async () => {
    const { db, alice, bob } = withTwoAgents();
    handlers.send_message(db, {
      token: alice.token,
      to: bob.agent_id,
      body: "wrong thread",
    });

    const out = await handlers.wait_for_reply(db, {
      token: bob.token,
      thread_id: "thr_other",
      timeout_sec: 1,
      poll_ms: 50,
    });

    expect(out.timeout).toBe(true);
  });

  test("a returned message is marked read so a second waiter doesn't double-read", async () => {
    const { db, alice, bob } = withTwoAgents();
    const sent = handlers.send_message(db, {
      token: alice.token,
      to: bob.agent_id,
      body: "once",
    });

    const first = await handlers.wait_for_reply(db, {
      token: bob.token,
      thread_id: sent.thread_id,
      timeout_sec: 1,
      poll_ms: 50,
    });
    expect(first.message?.body).toBe("once");

    const second = await handlers.wait_for_reply(db, {
      token: bob.token,
      thread_id: sent.thread_id,
      timeout_sec: 1,
      poll_ms: 50,
    });
    expect(second.timeout).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* identity & state                                                    */
/* ------------------------------------------------------------------ */

describe("identity bookkeeping", () => {
  test("authenticate bumps last_seen on every authenticated call", async () => {
    const { db, alice } = withTwoAgents();
    const before = handlers.whoami(db, { token: alice.token });

    // Wait long enough that Date.now() actually moves.
    await Bun.sleep(5);
    handlers.list_agents(db, { token: alice.token });

    const row = db
      .query("SELECT last_seen FROM agents WHERE id = ?")
      .get(alice.agent_id) as { last_seen: number };

    expect(row.last_seen).toBeGreaterThan(before.connected_at);
  });

  test("each register_agent mints a unique session token", () => {
    const { alice, bob } = withTwoAgents();
    expect(alice.token).not.toBe(bob.token);
  });

  test("two agents may share a display_name; agent_id is the identity", () => {
    const db = freshDb();
    const a = handlers.register_agent(db, { display_name: "Claude", role: "x" });
    const b = handlers.register_agent(db, { display_name: "Claude", role: "y" });
    expect(a.agent_id).not.toBe(b.agent_id);
  });
});

/* ------------------------------------------------------------------ */
/* inbox limits & ordering                                             */
/* ------------------------------------------------------------------ */

describe("inbox limits and ordering", () => {
  test("returns messages oldest-first", () => {
    const { db, alice, bob } = withTwoAgents();
    handlers.send_message(db, { token: alice.token, to: bob.agent_id, body: "first" });
    handlers.send_message(db, { token: alice.token, to: bob.agent_id, body: "second" });
    handlers.send_message(db, { token: alice.token, to: bob.agent_id, body: "third" });

    const out = handlers.inbox(db, { token: bob.token });
    expect(out.messages.map((m) => m.body)).toEqual(["first", "second", "third"]);
  });

  test("respects an explicit limit", () => {
    const { db, alice, bob } = withTwoAgents();
    for (let i = 0; i < 5; i++) {
      handlers.send_message(db, {
        token: alice.token,
        to: bob.agent_id,
        body: `msg ${i}`,
      });
    }
    const out = handlers.inbox(db, { token: bob.token, limit: 2 });
    expect(out.count).toBe(2);
    expect(out.messages.map((m) => m.body)).toEqual(["msg 0", "msg 1"]);
  });

  test("clamps an oversized limit to the hard cap", () => {
    const { db, alice, bob } = withTwoAgents();
    handlers.send_message(db, { token: alice.token, to: bob.agent_id, body: "hi" });

    // Caller asks for 9999; we expect the call to succeed (i.e. not throw)
    // and to return whatever rows exist, never more than the cap.
    const out = handlers.inbox(db, { token: bob.token, limit: 9999 });
    expect(out.count).toBeLessThanOrEqual(100);
    expect(out.count).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* broadcast timing                                                    */
/* ------------------------------------------------------------------ */

describe("broadcast timing", () => {
  test("agents registered after the broadcast do not retroactively receive it", () => {
    const db = freshDb();
    const a = handlers.register_agent(db, { display_name: "A", role: "x" });
    const b = handlers.register_agent(db, { display_name: "B", role: "x" });

    handlers.send_message(db, { token: a.token, to: "*", body: "early" });

    const c = handlers.register_agent(db, { display_name: "C", role: "x" });

    expect(handlers.inbox(db, { token: b.token }).count).toBe(1);
    expect(handlers.inbox(db, { token: c.token }).count).toBe(0);
  });
});
