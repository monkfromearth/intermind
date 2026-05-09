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
import { handlers, type JoinResult } from "../src/handlers";

/* ------------------------------------------------------------------ */
/* test fixtures                                                       */
/* ------------------------------------------------------------------ */

/** Spin up a private, in-memory database with the schema applied. */
function freshDb(): Database {
  return openDatabase(":memory:");
}

interface TwoAgents {
  db: Database;
  alice: JoinResult;
  bob: JoinResult;
}

/** Common setup: one DB and two joined agents (Alice + Bob). */
function withTwoAgents(): TwoAgents {
  const db = freshDb();
  const alice = handlers.join(db, {
    display_name: "Claude",
    role: "implementer",
  });
  const bob = handlers.join(db, {
    display_name: "Codex",
    role: "reviewer",
  });
  return { db, alice, bob };
}

/* ------------------------------------------------------------------ */
/* join + whoami                                                       */
/* ------------------------------------------------------------------ */

describe("join + whoami", () => {
  test("returns a prefixed agent_id and session token", () => {
    const db = freshDb();
    const reg = handlers.join(db, {
      display_name: "Claude",
      role: "implementer",
    });

    expect(reg.agent_id).toMatch(/^agt_/);
    expect(reg.token).toMatch(/^tok_/);
    expect(reg.display_name).toBe("Claude");
    expect(reg.role).toBe("implementer");
  });

  test("room_size reflects how many other agents are already here", () => {
    const db = freshDb();

    // First agent in: nobody else, so room_size: 0. This is the "you're
    // alone" signal the server uses to attach an empty-room hint.
    const first = handlers.join(db, {
      display_name: "Claude",
      role: "implementer",
    });
    expect(first.room_size).toBe(0);

    // Second agent: one peer (the first), so room_size: 1.
    const second = handlers.join(db, {
      display_name: "Codex",
      role: "reviewer",
    });
    expect(second.room_size).toBe(1);

    // Third agent: two peers.
    const third = handlers.join(db, {
      display_name: "Cursor",
      role: "tester",
    });
    expect(third.room_size).toBe(2);
  });

  test("room_size never includes the caller themselves", () => {
    const db = freshDb();
    const reg = handlers.join(db, {
      display_name: "Solo",
      role: "x",
    });
    // Even though the agents table has a row for `reg`, room_size is 0
    // because we count peers (id != self), not total rows.
    expect(reg.room_size).toBe(0);
  });

  test("whoami round-trips a valid token", () => {
    const db = freshDb();
    const reg = handlers.join(db, {
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
/* peers                                                               */
/* ------------------------------------------------------------------ */

describe("peers", () => {
  test("returns every other agent in the same room (excludes the caller)", () => {
    const { db, alice, bob } = withTwoAgents();

    const out = handlers.peers(db, { token: alice.token });
    // peers excludes the caller themselves — Alice asking should see only Bob.
    // This is what makes the result directly usable as `to:` candidates for send.
    expect(out.agents.map((a) => a.id)).toEqual([bob.agent_id]);
    // The room name comes back too so the LLM can confirm which room it's in.
    expect(out.room).toBe("main");
  });

  test("never leaks session tokens", () => {
    const { db, alice } = withTwoAgents();

    const out = handlers.peers(db, { token: alice.token });

    for (const agent of out.agents) {
      expect(Object.keys(agent)).not.toContain("session_token");
    }
  });
});

/* ------------------------------------------------------------------ */
/* send + inbox                                                        */
/* ------------------------------------------------------------------ */

describe("send + inbox", () => {
  test("a direct message lands in the recipient's inbox", () => {
    const { db, alice, bob } = withTwoAgents();

    const sent = handlers.send(db, {
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
    handlers.send(db, {
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
    handlers.send(db, {
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
      handlers.send(db, {
        token: alice.token,
        to: "agt_nope",
        body: "x",
      }),
    ).toThrow(/unknown recipient/);
  });

  test("preserves an explicit thread_id across replies", () => {
    const { db, alice, bob } = withTwoAgents();

    const m1 = handlers.send(db, {
      token: alice.token,
      to: bob.agent_id,
      body: "first",
    });
    const m2 = handlers.send(db, {
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
    const a = handlers.join(db, { display_name: "A", role: "x" });
    const b = handlers.join(db, { display_name: "B", role: "x" });
    const c = handlers.join(db, { display_name: "C", role: "x" });

    const sent = handlers.send(db, {
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
    const a = handlers.join(db, { display_name: "A", role: "x" });

    const sent = handlers.send(db, {
      token: a.token,
      to: "*",
      body: "anyone?",
    });

    expect(sent.delivered).toEqual([]);
    expect(sent.warning).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* listen (long-poll)                                                  */
/* ------------------------------------------------------------------ */

describe("listen", () => {
  test("returns immediately when a message is already waiting", async () => {
    const { db, alice, bob } = withTwoAgents();
    const sent = handlers.send(db, {
      token: alice.token,
      to: bob.agent_id,
      body: "hi",
    });

    const t0 = Date.now();
    const out = await handlers.listen(db, {
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

    const waiter = handlers.listen(db, {
      token: bob.token,
      thread_id,
      timeout_sec: 5,
      poll_ms: 50,
    });

    setTimeout(() => {
      handlers.send(db, {
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

    const out = await handlers.listen(db, {
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
    handlers.send(db, {
      token: alice.token,
      to: bob.agent_id,
      body: "wrong thread",
    });

    const out = await handlers.listen(db, {
      token: bob.token,
      thread_id: "thr_other",
      timeout_sec: 1,
      poll_ms: 50,
    });

    expect(out.timeout).toBe(true);
  });

  test("a returned message is marked read so a second listener doesn't double-read", async () => {
    const { db, alice, bob } = withTwoAgents();
    const sent = handlers.send(db, {
      token: alice.token,
      to: bob.agent_id,
      body: "once",
    });

    const first = await handlers.listen(db, {
      token: bob.token,
      thread_id: sent.thread_id,
      timeout_sec: 1,
      poll_ms: 50,
    });
    expect(first.message?.body).toBe("once");

    const second = await handlers.listen(db, {
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
    handlers.peers(db, { token: alice.token });

    const row = db
      .query("SELECT last_seen FROM agents WHERE id = ?")
      .get(alice.agent_id) as { last_seen: number };

    expect(row.last_seen).toBeGreaterThan(before.connected_at);
  });

  test("each join mints a unique session token", () => {
    const { alice, bob } = withTwoAgents();
    expect(alice.token).not.toBe(bob.token);
  });

  test("two agents may share a display_name; agent_id is the identity", () => {
    const db = freshDb();
    const a = handlers.join(db, { display_name: "Claude", role: "x" });
    const b = handlers.join(db, { display_name: "Claude", role: "y" });
    expect(a.agent_id).not.toBe(b.agent_id);
  });
});

/* ------------------------------------------------------------------ */
/* inbox limits & ordering                                             */
/* ------------------------------------------------------------------ */

describe("inbox limits and ordering", () => {
  test("returns messages oldest-first", () => {
    const { db, alice, bob } = withTwoAgents();
    handlers.send(db, { token: alice.token, to: bob.agent_id, body: "first" });
    handlers.send(db, { token: alice.token, to: bob.agent_id, body: "second" });
    handlers.send(db, { token: alice.token, to: bob.agent_id, body: "third" });

    const out = handlers.inbox(db, { token: bob.token });
    expect(out.messages.map((m) => m.body)).toEqual(["first", "second", "third"]);
  });

  test("respects an explicit limit", () => {
    const { db, alice, bob } = withTwoAgents();
    for (let i = 0; i < 5; i++) {
      handlers.send(db, {
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
    handlers.send(db, { token: alice.token, to: bob.agent_id, body: "hi" });

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
  test("agents who join after the broadcast do not retroactively receive it", () => {
    const db = freshDb();
    const a = handlers.join(db, { display_name: "A", role: "x" });
    const b = handlers.join(db, { display_name: "B", role: "x" });

    handlers.send(db, { token: a.token, to: "*", body: "early" });

    const c = handlers.join(db, { display_name: "C", role: "x" });

    expect(handlers.inbox(db, { token: b.token }).count).toBe(1);
    expect(handlers.inbox(db, { token: c.token }).count).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* rooms                                                               */
/* ------------------------------------------------------------------ */

describe("rooms", () => {
  test("join defaults to room 'main' when room is omitted", () => {
    const db = freshDb();
    // 0.0.2-style call site: no `room` arg. The default keeps the
    // single-room behaviour Intermind shipped with before 0.0.3.
    const reg = handlers.join(db, { display_name: "Solo", role: "x" });
    expect(reg.room).toBe("main");
  });

  test("agents in different rooms are invisible to each other", () => {
    const db = freshDb();
    // Two BE+FE pairs working on different feature branches share the
    // same DB (~/.intermind/state.db default) but want isolation. Each
    // pair joins under their branch name as the room.
    const featA = handlers.join(db, {
      display_name: "BE-A",
      role: "backend",
      room: "feature-auth",
    });
    handlers.join(db, {
      display_name: "FE-B",
      role: "frontend",
      room: "feature-billing",
    });

    // BE-A's peers list should be empty: the only other agent is in a
    // different room, so it's invisible.
    const out = handlers.peers(db, { token: featA.token });
    expect(out.room).toBe("feature-auth");
    expect(out.agents).toEqual([]);
  });

  test("room_size counts only same-room agents", () => {
    const db = freshDb();
    handlers.join(db, { display_name: "A", role: "x", room: "alpha" });
    handlers.join(db, { display_name: "B", role: "x", room: "alpha" });
    // Different room → should not contribute to room_size for "alpha" joiners.
    handlers.join(db, { display_name: "C", role: "x", room: "beta" });

    const third = handlers.join(db, {
      display_name: "D",
      role: "x",
      room: "alpha",
    });
    // Only A and B share room "alpha"; C is in beta and is not counted.
    expect(third.room).toBe("alpha");
    expect(third.room_size).toBe(2);
  });

  test("send to '*' fans out only within the sender's room", () => {
    const db = freshDb();
    const a = handlers.join(db, { display_name: "A", role: "x", room: "alpha" });
    const b = handlers.join(db, { display_name: "B", role: "x", room: "alpha" });
    const c = handlers.join(db, { display_name: "C", role: "x", room: "beta" });

    const sent = handlers.send(db, {
      token: a.token,
      to: "*",
      body: "alpha-only",
    });
    // Broadcast should reach B (same room) but not C (different room).
    expect(sent.delivered).toEqual([b.agent_id]);
    expect(handlers.inbox(db, { token: b.token }).count).toBe(1);
    expect(handlers.inbox(db, { token: c.token }).count).toBe(0);
  });

  test("DM to an agent in a different room is rejected as unknown recipient", () => {
    const db = freshDb();
    const a = handlers.join(db, { display_name: "A", role: "x", room: "alpha" });
    const c = handlers.join(db, { display_name: "C", role: "x", room: "beta" });

    // Even though c.agent_id is a real id, the sender shouldn't be able
    // to reach across rooms — same error as a totally unknown id.
    expect(() =>
      handlers.send(db, {
        token: a.token,
        to: c.agent_id,
        body: "hi",
      }),
    ).toThrow(/unknown recipient/);
  });

  test("broadcast in a solo room returns the empty-room warning", () => {
    const db = freshDb();
    const a = handlers.join(db, {
      display_name: "Solo",
      role: "x",
      room: "lonely",
    });
    // Even if other agents exist on the DB, a solo room should still
    // hit the "no recipients" warning path — proves the broadcast
    // doesn't leak across rooms when the room is empty.
    handlers.join(db, { display_name: "Other", role: "x", room: "elsewhere" });

    const sent = handlers.send(db, {
      token: a.token,
      to: "*",
      body: "anyone here?",
    });
    expect(sent.delivered).toEqual([]);
    expect(sent.warning).toBeDefined();
  });
});
