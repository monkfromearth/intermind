/**
 * Tests for the `intermind watch` streaming watcher (src/watch.ts).
 *
 * These cover the public surface:
 *   1. `parseWatchArgs` — argv parsing for the `watch` subcommand.
 *   2. `resolveAgentIdByToken` — token-to-agent lookup.
 *   3. `watchMessages` — the async generator that yields new messages.
 *   4. `runWatchCli` — the stdout/stderr-writing wrapper used by the CLI.
 *
 * Everything runs against in-memory SQLite. No subprocesses, no network.
 * Async generator tests use a tiny `pollMs` (10) so timing assertions
 * stay well under a second.
 */

import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";

import { openDatabase } from "../src/db";
import { handlers } from "../src/handlers";
import {
  parseWatchArgs,
  resolveAgentIdByToken,
  runWatchCli,
  watchMessages,
} from "../src/watch";

/* ------------------------------------------------------------------ */
/* tiny harness                                                        */
/* ------------------------------------------------------------------ */

interface PairHarness {
  db: Database;
  alice: { agent_id: string; token: string };
  bob: { agent_id: string; token: string };
}

/** Two agents in the default room — the watcher's typical scenario. */
function pair(): PairHarness {
  const db = openDatabase(":memory:");
  const alice = handlers.join(db, { display_name: "A", role: "x" });
  const bob = handlers.join(db, { display_name: "B", role: "x" });
  return { db, alice, bob };
}

/**
 * Collect up to `n` messages from a watcher (or until timeout), then
 * abort the generator. Used by every streaming test below so we never
 * leak a watcher that runs forever.
 */
async function collect(
  gen: AsyncGenerator<{ body: string }, void, void>,
  n: number,
  controller: AbortController,
  timeoutMs = 1000,
): Promise<string[]> {
  const out: string[] = [];
  const deadline = Date.now() + timeoutMs;

  // Race each generator step against the deadline so a stuck test
  // surfaces as a clean timeout error instead of hanging the suite.
  const step = async (): Promise<IteratorResult<{ body: string }, void>> => {
    const remaining = Math.max(0, deadline - Date.now());
    return Promise.race([
      gen.next(),
      new Promise<IteratorResult<{ body: string }, void>>((_, reject) =>
        setTimeout(
          () => reject(new Error("collect: timed out waiting for next event")),
          remaining,
        ),
      ),
    ]);
  };

  while (out.length < n) {
    const next = await step();
    if (next.done) break;
    out.push(next.value.body);
  }

  controller.abort();
  // Drain so the generator can run its `finally` cleanly. We ignore
  // anything yielded after the abort.
  await gen.return(undefined);
  return out;
}

/* ------------------------------------------------------------------ */
/* parseWatchArgs                                                      */
/* ------------------------------------------------------------------ */

describe("parseWatchArgs", () => {
  test("accepts `--token tok_abc` (space form)", () => {
    const out = parseWatchArgs(["--token", "tok_abc"]);
    // Space-separated form: `intermind watch --token tok_abc`. The most
    // common form an LLM will produce because it's the conventional
    // POSIX shape ("--flag value").
    expect(out).toEqual({ token: "tok_abc" });
  });

  test("accepts `--token=tok_abc` (equals form)", () => {
    const out = parseWatchArgs(["--token=tok_abc"]);
    // Equals form is friendlier for shells that don't preserve quoting
    // (some Monitor-style spawners pass argv as one string).
    expect(out).toEqual({ token: "tok_abc" });
  });

  test("rejects a missing --token entirely", () => {
    const out = parseWatchArgs([]);
    // No token = unusable. The CLI maps this to exit code 2 so wrapper
    // scripts can distinguish "you typed it wrong" from "the DB broke".
    expect("error" in out && out.error).toMatch(/--token is required/);
  });

  test("rejects --token with no value", () => {
    const out = parseWatchArgs(["--token"]);
    // `--token` alone with nothing after it. Different error message
    // from the empty-argv case so a user can tell which mistake.
    expect("error" in out && out.error).toMatch(/requires a value/);
  });

  test("rejects --token followed by another flag (treated as missing value)", () => {
    const out = parseWatchArgs(["--token", "--help"]);
    // `--token --help` looks like the user forgot to put the token.
    // We detect this by checking `next.startsWith("--")` to give a
    // clearer error than silently using "--help" as the token.
    expect("error" in out && out.error).toMatch(/requires a value/);
  });

  test("rejects unknown flags", () => {
    const out = parseWatchArgs(["--token", "tok_abc", "--bogus"]);
    // Strict: any unrecognised flag exits non-zero. Keeps the surface
    // tight so we don't accidentally accept typos that look like
    // they're working.
    expect("error" in out && out.error).toMatch(/unknown argument/);
  });

  test("--help produces a usage message in the error channel", () => {
    const out = parseWatchArgs(["--help"]);
    // --help intentionally goes through the `error` field so the CLI
    // writes it to stderr and exits with a recognisable code. The text
    // must mention `--token` so the message is self-contained.
    expect("error" in out && out.error).toMatch(/usage: intermind watch/);
    expect("error" in out && out.error).toMatch(/--token/);
  });
});

/* ------------------------------------------------------------------ */
/* resolveAgentIdByToken                                               */
/* ------------------------------------------------------------------ */

describe("resolveAgentIdByToken", () => {
  test("returns the agent id for a valid token", () => {
    const { db, alice } = pair();
    expect(resolveAgentIdByToken(db, alice.token)).toBe(alice.agent_id);
  });

  test("returns null for an unknown token", () => {
    const { db } = pair();
    // No throw — the watcher uses the null to surface a friendly stderr
    // message and exit 1, instead of a stack trace from the SQL layer.
    expect(resolveAgentIdByToken(db, "tok_does_not_exist")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* watchMessages — the async generator                                 */
/* ------------------------------------------------------------------ */

describe("watchMessages", () => {
  test("emits messages already pending when the watcher starts", async () => {
    const { db, alice, bob } = pair();
    // A peer's `send` lands milliseconds before Monitor spawns the
    // watcher. The watcher MUST emit those rows on its first poll —
    // otherwise the system has a silent dropped-messages window.
    handlers.send(db, { token: alice.token, to: bob.agent_id, body: "early" });

    const controller = new AbortController();
    const gen = watchMessages(db, bob.agent_id, {
      pollMs: 10,
      signal: controller.signal,
    });

    const got = await collect(gen, 1, controller);
    expect(got).toEqual(["early"]);
  });

  test("emits new messages that arrive after start, in order", async () => {
    const { db, alice, bob } = pair();
    const controller = new AbortController();
    const gen = watchMessages(db, bob.agent_id, {
      pollMs: 10,
      signal: controller.signal,
    });

    // Schedule three sends after the watcher is running. Each `send`
    // bumps `created_at = Date.now()`, so the order is deterministic
    // as long as we space them apart by more than 1 ms.
    setTimeout(() => {
      handlers.send(db, { token: alice.token, to: bob.agent_id, body: "one" });
    }, 20);
    setTimeout(() => {
      handlers.send(db, { token: alice.token, to: bob.agent_id, body: "two" });
    }, 40);
    setTimeout(() => {
      handlers.send(db, { token: alice.token, to: bob.agent_id, body: "three" });
    }, 60);

    const got = await collect(gen, 3, controller);
    // Order matters here: the watcher contract is "in `created_at` order".
    // A bug that emits out-of-order would tangle threads on the receiving end.
    expect(got).toEqual(["one", "two", "three"]);
  });

  test("does not emit messages addressed to other agents", async () => {
    // Three agents in one room. The watcher follows Bob; Alice messages
    // Carol. The watcher must not see Carol's mail.
    const db = openDatabase(":memory:");
    const alice = handlers.join(db, { display_name: "A", role: "x" });
    const bob = handlers.join(db, { display_name: "B", role: "x" });
    const carol = handlers.join(db, { display_name: "C", role: "x" });

    // First message is for Carol, not Bob.
    handlers.send(db, { token: alice.token, to: carol.agent_id, body: "for-carol" });
    // Second is for Bob — the watcher should emit only this one.
    handlers.send(db, { token: alice.token, to: bob.agent_id, body: "for-bob" });

    const controller = new AbortController();
    const gen = watchMessages(db, bob.agent_id, {
      pollMs: 10,
      signal: controller.signal,
    });

    const got = await collect(gen, 1, controller);
    expect(got).toEqual(["for-bob"]);
  });

  test("does not re-emit messages it has already yielded", async () => {
    const { db, alice, bob } = pair();
    const controller = new AbortController();
    const gen = watchMessages(db, bob.agent_id, {
      pollMs: 10,
      signal: controller.signal,
    });

    // First message is consumed by collect(). Then we send a second.
    // If the watcher re-emitted "first" on a later poll, collect(2)
    // would resolve with ["first", "first"] instead of ["first", "second"].
    handlers.send(db, { token: alice.token, to: bob.agent_id, body: "first" });
    setTimeout(() => {
      handlers.send(db, {
        token: alice.token,
        to: bob.agent_id,
        body: "second",
      });
    }, 30);

    const got = await collect(gen, 2, controller);
    expect(got).toEqual(["first", "second"]);
  });

  test("aborts cleanly mid-sleep when the AbortSignal fires", async () => {
    const { db, bob } = pair();
    const controller = new AbortController();

    // No messages exist, so the watcher will sit in its sleep loop.
    // We abort after a short delay and assert the generator returns
    // promptly (within 100 ms — well under the 200 ms default poll).
    const gen = watchMessages(db, bob.agent_id, {
      pollMs: 200,
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 30);

    const t0 = Date.now();
    const result = await gen.next();
    const elapsed = Date.now() - t0;

    // `done: true` because the generator returned (no value yielded).
    expect(result.done).toBe(true);
    // If raceAbort weren't wired up, this would wait the full 200 ms.
    // 100 ms gives generous slack for slow CI without hiding regressions.
    expect(elapsed).toBeLessThan(100);
  });

  test("yields broadcast messages addressed to the watched agent", async () => {
    // Broadcast (`to: '*'`) expands at send time into one row per
    // recipient. The watcher should see its own row just like a DM —
    // there's nothing special about broadcasts at the inbox layer.
    const { db, alice, bob } = pair();
    handlers.send(db, { token: alice.token, to: "*", body: "everyone" });

    const controller = new AbortController();
    const gen = watchMessages(db, bob.agent_id, {
      pollMs: 10,
      signal: controller.signal,
    });

    const got = await collect(gen, 1, controller);
    expect(got).toEqual(["everyone"]);
  });
});

/* ------------------------------------------------------------------ */
/* runWatchCli — the stdout/stderr-writing wrapper                     */
/* ------------------------------------------------------------------ */

describe("runWatchCli", () => {
  test("writes one JSON line per message to the supplied `out` writer", async () => {
    const { db, alice, bob } = pair();
    handlers.send(db, { token: alice.token, to: bob.agent_id, body: "ping" });

    // Inject a tiny in-memory writer instead of touching process.stdout.
    // Tests the same code path the CLI uses without spawning a subprocess.
    const lines: string[] = [];
    const out = { write: (s: string) => lines.push(s) };
    const err = { write: () => undefined };

    const controller = new AbortController();
    const cliPromise = runWatchCli({
      db,
      token: bob.token,
      out,
      err,
      signal: controller.signal,
    });

    // Wait until the line shows up, then stop. 200 ms is well over the
    // default 200 ms poll for the first emit (which goes through
    // immediately because there's already a row).
    await waitFor(() => lines.length > 0, 500);
    controller.abort();

    const code = await cliPromise;
    expect(code).toBe(0);

    // One line, JSON, terminated by \n. Body must round-trip intact.
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(lines[0]!.trim()) as {
      body: string;
      from_agent: string;
      thread_id: string;
    };
    expect(parsed.body).toBe("ping");
    expect(parsed.from_agent).toBe(alice.agent_id);
    expect(parsed.thread_id).toMatch(/^thr_/);
  });

  test("returns exit code 1 and writes a friendly error for an invalid token", async () => {
    const { db } = pair();
    const lines: string[] = [];
    const errs: string[] = [];

    const code = await runWatchCli({
      db,
      token: "tok_garbage",
      out: { write: (s: string) => lines.push(s) },
      err: { write: (s: string) => errs.push(s) },
      signal: new AbortController().signal,
    });

    // Exit 1 = operational failure (vs 2 = arg-shape error). Lets a
    // wrapper script tell `you typed it wrong` apart from `your token
    // doesn't match an agent`.
    expect(code).toBe(1);
    expect(lines).toEqual([]);
    expect(errs.join("")).toMatch(/invalid session token/);
  });
});

/* ------------------------------------------------------------------ */
/* small util                                                          */
/* ------------------------------------------------------------------ */

/**
 * Poll `predicate` until it returns true or `timeoutMs` elapses.
 * Used in the runWatchCli test where we don't have a clean signal that
 * the first line has been emitted (the generator is async and the CLI
 * keeps running).
 */
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(10);
  }
  throw new Error(`waitFor: predicate did not become true within ${timeoutMs}ms`);
}
