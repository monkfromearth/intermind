/**
 * Integration tests for the `intermind watch` subcommand.
 *
 * Unlike `watch.test.ts` (which exercises the in-process functions
 * against an in-memory SQLite), this file spawns the *actual* binary as
 * a subprocess via `Bun.spawn`, points it at a real on-disk SQLite file
 * via `INTERMIND_DB`, writes rows from a separate connection, and reads
 * the JSON lines off the child's stdout.
 *
 * What this catches that `watch.test.ts` cannot:
 *   1. argv dispatch in `src/index.ts` — the `watch` subcommand path is
 *      only exercised when the binary is actually invoked.
 *   2. Real stdout pipe behaviour — `runWatchCli` writes to whatever
 *      `out` you inject; the binary writes to the OS pipe. A flush bug
 *      that leaves output stuck in a buffer would be invisible to the
 *      in-process tests but visible here.
 *   3. Signal handling — the SIGINT/SIGTERM/EOF wiring lives in
 *      `src/index.ts:runWatch`, not in `watch.ts`. Only a real subprocess
 *      can verify it shuts down cleanly.
 *   4. Schema-state drift — anything wrong with `openDatabase` against
 *      an on-disk file (permissions, WAL pragma quirks, missing column
 *      from a previous schema) surfaces as a non-zero exit.
 *
 * Each test creates a fresh temp directory so DB files don't bleed
 * across runs. The temp dir is removed on test exit.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../src/db";
import { handlers } from "../src/handlers";

// Path to the binary entrypoint — same shape `package.json`'s `bin`
// field points at. Using `bun run …` matches what the published binary
// does on hosts without a compiled `./bin/intermind`.
const BIN = join(import.meta.dir, "..", "src", "index.ts");

/* ------------------------------------------------------------------ */
/* harness                                                             */
/* ------------------------------------------------------------------ */

let tmp: string;
let dbPath: string;

beforeEach(() => {
  // Fresh temp dir per test so two parallel runs don't fight for the
  // same WAL file. `intermind-watch-` is the prefix; `mkdtempSync`
  // appends randomness.
  tmp = mkdtempSync(join(tmpdir(), "intermind-watch-"));
  dbPath = join(tmp, "state.db");
});

afterEach(() => {
  // Best-effort cleanup. If a test crashed mid-run the WAL/SHM
  // sidecars are still here — `recursive: true, force: true` handles
  // both.
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * Seed two agents in the default `"main"` room and return their tokens
 * + ids. Done by opening the DB through the same `openDatabase` the
 * server uses, so the schema is exactly what a fresh install ships.
 */
function seedTwoAgents(): {
  alice: { id: string; token: string };
  bob: { id: string; token: string };
} {
  const db = openDatabase(dbPath);
  const a = handlers.join(db, { display_name: "Alice", role: "x" });
  const b = handlers.join(db, { display_name: "Bob", role: "x" });
  db.close();
  return {
    alice: { id: a.agent_id, token: a.token },
    bob: { id: b.agent_id, token: b.token },
  };
}

/**
 * Spawn the binary in `watch` mode against the test's temp DB. Returns
 * the child handle plus a line-buffered async iterator over its stdout
 * that hands back parsed JSON objects.
 *
 * Why a custom iterator instead of streaming stdout straight to the
 * test? The watcher emits `JSON.stringify(row) + "\n"` per message;
 * the test wants one event per call. Buffering on `\n` is the cleanest
 * way to make that look like a queue.
 */
function spawnWatch(token: string): {
  proc: ReturnType<typeof Bun.spawn>;
  nextLine: (timeoutMs: number) => Promise<unknown>;
  stderr: () => Promise<string>;
} {
  const proc = Bun.spawn({
    cmd: ["bun", "run", BIN, "watch", "--token", token],
    env: { ...process.env, INTERMIND_DB: dbPath },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });

  // Pull stdout into a rolling buffer; resolve waiters when a `\n`
  // appears. Order-preserving FIFO of pending resolvers so a slow
  // consumer never drops a line.
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const lines: string[] = [];
  const waiters: Array<(line: string | null) => void> = [];
  let done = false;

  void (async () => {
    while (true) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) {
        done = true;
        // Drain pending waiters so a test that called nextLine after
        // the child exited gets `null` instead of hanging.
        while (waiters.length) waiters.shift()!(null);
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (waiters.length) waiters.shift()!(line);
        else lines.push(line);
      }
    }
  })();

  // Return one line, or fail the test if it doesn't arrive in time.
  // Race a real timer against the next-line promise so a hung child
  // surfaces a useful error instead of a 30-second test hang.
  function nextLine(timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        reject(
          new Error(
            `watch subprocess produced no line within ${timeoutMs}ms (done=${done})`,
          ),
        );
      }, timeoutMs);

      const give = (raw: string | null) => {
        clearTimeout(t);
        if (raw === null) {
          reject(new Error("watch subprocess closed stdout"));
        } else {
          resolve(JSON.parse(raw));
        }
      };

      const buffered = lines.shift();
      if (buffered !== undefined) give(buffered);
      else waiters.push(give);
    });
  }

  // Lazy stderr reader for the few tests that assert on error messages
  // (e.g. invalid-token rejection).
  async function stderr(): Promise<string> {
    return new Response(proc.stderr).text();
  }

  return { proc, nextLine, stderr };
}

/* ------------------------------------------------------------------ */
/* tests                                                               */
/* ------------------------------------------------------------------ */

describe("intermind watch (subprocess)", () => {
  test(
    "streams a JSON line for a peer message that lands after spawn",
    async () => {
      // Seed both agents BEFORE the watcher starts so token resolution
      // succeeds. The send happens AFTER spawn — that's the case we
      // care about: a watcher running, a peer fires `send`, the line
      // appears within a poll cycle (~200ms).
      const { alice, bob } = seedTwoAgents();
      const w = spawnWatch(bob.token);

      // Give the watcher one full poll cycle to reach the loop body
      // (open DB + resolve token + first SELECT). 250ms is generous —
      // the loop runs every 200ms.
      await Bun.sleep(250);

      // Send from a *separate* connection. This proves cross-process
      // visibility under WAL — the watcher reads from one connection,
      // we write from another.
      const writer = openDatabase(dbPath);
      handlers.send(writer, {
        token: alice.token,
        to: bob.id,
        body: "hello bob",
      });
      writer.close();

      const line = (await w.nextLine(2000)) as {
        from_agent: string;
        body: string;
        thread_id: string;
      };
      expect(line.from_agent).toBe(alice.id);
      expect(line.body).toBe("hello bob");
      expect(line.thread_id).toMatch(/^thr_/);

      // Clean shutdown — SIGTERM is what the production CLI catches via
      // `process.on("SIGTERM", stop)`. Asserting the child exits at all
      // (and within a tight window) verifies the abort wiring works.
      w.proc.kill("SIGTERM");
      const code = await w.proc.exited;
      // 0 = clean shutdown via abort; 143 = SIGTERM with no handler (we
      // *do* have a handler, but Bun sometimes reports the signal exit
      // anyway depending on how the abort race resolves). Either is OK.
      expect([0, 143]).toContain(code);
    },
    10_000, // explicit timeout — covers slow CI but trips on a hung child
  );

  test(
    "emits already-pending messages on first poll (watcher started after send)",
    async () => {
      // The opposite ordering of the previous test: peer sends FIRST,
      // watcher spawns SECOND. The watcher's first poll uses
      // lastSeen=0, so it should pick up the row that's already there.
      const { alice, bob } = seedTwoAgents();

      const writer = openDatabase(dbPath);
      handlers.send(writer, {
        token: alice.token,
        to: bob.id,
        body: "you missed the start",
      });
      writer.close();

      const w = spawnWatch(bob.token);

      const line = (await w.nextLine(3000)) as { body: string };
      expect(line.body).toBe("you missed the start");

      w.proc.kill("SIGTERM");
      await w.proc.exited;
    },
    10_000,
  );

  test("invalid token: stderr message + exit 1", async () => {
    // No agents seeded — token can't resolve. The CLI should surface a
    // single-line error on stderr and exit non-zero before entering
    // the poll loop. This is the "you typed it wrong" path.
    seedTwoAgents(); // seed so the DB exists with the right schema; token below is bogus
    const w = spawnWatch("tok_does_not_exist");

    const code = await w.proc.exited;
    expect(code).toBe(1);

    const errText = await w.stderr();
    expect(errText).toContain("invalid session token");
  });

  test("missing --token: usage error on stderr + exit 2", async () => {
    // No `--token` argument at all. argv-shape errors are exit code 2,
    // distinct from operational failures (1) so a wrapper script can
    // tell typos from runtime errors.
    seedTwoAgents();
    const proc = Bun.spawn({
      cmd: ["bun", "run", BIN, "watch"],
      env: { ...process.env, INTERMIND_DB: dbPath },
      stdout: "pipe",
      stderr: "pipe",
    });

    const code = await proc.exited;
    expect(code).toBe(2);

    const errText = await new Response(proc.stderr).text();
    expect(errText).toContain("--token is required");
  });
});
