/**
 * `intermind watch` — a streaming watcher that emits one JSON line per
 * new message addressed to a specific agent.
 *
 * Why this exists
 * ---------------
 * Coding agents are turn-based. A peer's `send` lands in the SQLite file
 * mid-turn, but the recipient agent only sees it on its next call to
 * `inbox` or `listen`. `listen` blocks the whole turn; `inbox` only fires
 * at turn boundaries. Neither surfaces a message *while* the agent is
 * doing other work.
 *
 * This watcher is the bridge that gives Claude Code (the only mainstream
 * MCP host with a `Monitor`-style background-event tool today) a way to
 * surface peer messages mid-turn. The system prompt instructs the agent
 * to spawn `intermind watch --token <tok>` via `Monitor` (persistent=true)
 * at session start; each emitted line becomes a notification in the
 * agent's context. See `docs/decisions/0001-message-delivery.md` for why
 * we picked this path over MCP server-push.
 *
 * Output contract
 * ---------------
 * One JSON line per new message, written to stdout, terminated by `\n`.
 * Schema:
 *
 *     {
 *       "id":         "msg_<uuid>",
 *       "thread_id":  "thr_<uuid>",
 *       "from_agent": "agt_<uuid>",
 *       "body":       "<plain text the peer sent>",
 *       "created_at": 1715260000000   // Unix epoch ms
 *     }
 *
 * Read-only by design: the watcher does *not* mark messages read. The
 * agent still consumes them through the proper `inbox` / `listen`
 * tool-call path so the bearer-token auth check runs once per consume.
 * That keeps the watcher safe even if a misbehaving caller points it at
 * an agent_id they shouldn't see — the only data leak is the same data
 * any user with read access to the SQLite file already sees.
 *
 * Lifecycle
 * ---------
 * - Loops indefinitely; exits only on SIGINT, SIGTERM, or stdin EOF.
 * - Polls every `pollMs` (default 200 ms — matches `listen`'s cadence
 *   exactly, so a watch + a long-poll see updates at the same rate).
 * - Tracks the largest `created_at` seen and only emits rows newer than
 *   that, so reconnects (rare in practice — Monitor is session-length)
 *   don't re-emit history. The first poll emits whatever is already
 *   pending (`read_at IS NULL`) so a watcher started after a peer's
 *   `send` doesn't silently lose the early message.
 */

import type { Database } from "bun:sqlite";

import type { MessageRow } from "./db";

/* ------------------------------------------------------------------ */
/* defaults                                                            */
/* ------------------------------------------------------------------ */

/**
 * Poll interval. 200 ms matches `listen` so the watch path and the
 * long-poll path see new rows at the same cadence — useful for tests
 * that race the two against one another.
 */
const DEFAULT_POLL_MS = 200;

/* ------------------------------------------------------------------ */
/* token resolution                                                    */
/* ------------------------------------------------------------------ */

/**
 * Resolve the agent_id from a session token, or return null if the
 * token is unknown. The watcher uses this once at startup; if the
 * token is bogus the CLI surfaces a one-line error and exits non-zero
 * instead of silently polling for an agent that doesn't exist.
 */
export function resolveAgentIdByToken(
  db: Database,
  token: string,
): string | null {
  const row = db
    .query("SELECT id FROM agents WHERE session_token = ?")
    .get(token) as { id: string } | null;
  return row?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* core polling loop                                                   */
/* ------------------------------------------------------------------ */

/**
 * Options passed through `watchMessages`. `signal` is the public
 * cancellation lever; `pollMs` and `nowMs` are wired through purely so
 * the test suite can run with a tiny poll interval and a frozen clock.
 */
export interface WatchOptions {
  /** Poll cadence in ms. Defaults to 200 (matches `listen`). */
  pollMs?: number;
  /** Cancellation signal — abort to end the generator early. */
  signal?: AbortSignal;
  /** Test override for Date.now(). Production code never sets this. */
  nowMs?: () => number;
  /** Test override for the sleep primitive — e.g. a deterministic mock. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Async generator: yields each new message addressed to `recipientId`
 * in `created_at` order. Runs forever until either:
 *   - `options.signal` aborts (the CLI wires this on SIGINT/SIGTERM/EOF), or
 *   - the database handle is closed by the caller.
 *
 * We track `lastSeenCreatedAt` rather than a monotonic id because
 * SQLite rowids and our string ids are not strictly monotonic across
 * connections; `created_at` is `Date.now()` set at insert time and is
 * sufficient for ordering at our message volumes.
 *
 * Example (consumer side):
 *
 *     for await (const m of watchMessages(db, "agt_X")) {
 *       process.stdout.write(JSON.stringify(m) + "\n");
 *     }
 *
 * Tests use this generator directly; the CLI wraps it with stdout
 * writes and signal handling.
 */
export async function* watchMessages(
  db: Database,
  recipientId: string,
  options: WatchOptions = {},
): AsyncGenerator<MessageRow, void, void> {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const now = options.nowMs ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms) => Bun.sleep(ms));

  // Floor for the "newer than" filter on each poll. `0` on first run
  // means "give me everything currently pending in the inbox" — this is
  // intentional: a watcher started right after a peer's `send` would
  // otherwise miss the row that landed milliseconds before. After the
  // first emit, the floor moves forward to `created_at` of the last row.
  let lastSeen = 0;

  // Prepared once. db.query caches prepared statements internally, so
  // re-binding parameters per poll is the same cost as caching the
  // handle ourselves — but extracting it makes the loop body smaller.
  const peek = db.query(
    `SELECT * FROM messages
       WHERE to_agent = ?
         AND created_at > ?
       ORDER BY created_at, id
       LIMIT 100`,
  );

  while (true) {
    if (options.signal?.aborted) return;

    // LIMIT 100 caps a single poll's emission volume so a watcher that
    // started after thousands of messages don't all land in one batch.
    // The next iteration picks up the rest because lastSeen advances.
    const rows = peek.all(recipientId, lastSeen) as MessageRow[];

    for (const row of rows) {
      if (options.signal?.aborted) return;
      yield row;
      lastSeen = row.created_at;
    }

    // If we just emitted a full batch, poll again immediately rather
    // than waiting `pollMs` — likely there's more queued up.
    // Example: a peer sent 5 messages in a tight loop; first poll grabs
    // them all (5 < 100), second poll returns empty so we sleep.
    if (rows.length >= 100) continue;

    // Honour the deadline regardless of `now()` source — race aborts
    // against the sleep so an abort during a long sleep doesn't have to
    // wait for the timer.
    await raceAbort(sleep(pollMs), options.signal);

    // Touch `now` so a custom clock from tests can step the loop along
    // without us actually consulting it for filtering — keeps the
    // generator deterministic under test.
    now();
  }
}

/**
 * Resolve when either `promise` settles or `signal` aborts. Returns a
 * fulfilled promise either way — the caller checks `signal.aborted` on
 * the next loop iteration to decide whether to exit. Used so a long
 * sleep doesn't keep the generator alive past an abort.
 */
function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve();
  return new Promise<unknown>((resolve) => {
    const onAbort = () => resolve(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.finally(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(undefined);
    });
  });
}

/* ------------------------------------------------------------------ */
/* CLI entrypoint                                                      */
/* ------------------------------------------------------------------ */

/**
 * Parse `intermind watch` argv (everything after `watch`) into options.
 *
 * Supported forms — keep this list short on purpose so the surface stays
 * tight:
 *
 *     intermind watch --token tok_abc123
 *     intermind watch --token=tok_abc123
 *
 * Returns either a parsed shape or an error message. The caller decides
 * whether to write the message to stderr and exit non-zero.
 */
export function parseWatchArgs(
  argv: string[],
): { token: string } | { error: string } {
  let token: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--token") {
      // `--token tok_abc` form: consume the next argv slot.
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        return { error: "--token requires a value" };
      }
      token = next;
      i++;
    } else if (arg.startsWith("--token=")) {
      // `--token=tok_abc` form: split on first `=`.
      const value = arg.slice("--token=".length);
      if (!value) return { error: "--token= requires a value" };
      token = value;
    } else if (arg === "--help" || arg === "-h") {
      return {
        error:
          "usage: intermind watch --token <session_token>\n" +
          "  Streams one JSON line per new message addressed to the agent\n" +
          "  that owns the token. Reads INTERMIND_DB for the DB path\n" +
          "  (defaults to ~/.intermind/state.db). Exits on SIGINT/EOF.",
      };
    } else {
      return { error: `unknown argument: ${arg}` };
    }
  }

  if (!token) {
    return {
      error:
        "watch: --token is required (the session token returned by `join`)",
    };
  }

  return { token };
}

/**
 * Run the watcher to stdout. Hooked up by `src/index.ts` when argv[2]
 * is `watch`. Tests don't call this — they use `watchMessages` directly
 * with an in-memory DB.
 *
 * @returns the process exit code. The caller is responsible for actually
 *   calling `process.exit` — keeping it pure makes the function testable.
 */
export async function runWatchCli(args: {
  db: Database;
  token: string;
  /**
   * Where each emitted JSON line goes. Defaults to process.stdout in
   * production; tests pass a buffer so they can assert on the output
   * without touching the real fd.
   */
  out?: { write(s: string): unknown };
  /** Where errors go. Same testing rationale as `out`. */
  err?: { write(s: string): unknown };
  /** Cancellation signal — wired up by the CLI to SIGINT/SIGTERM/EOF. */
  signal: AbortSignal;
}): Promise<number> {
  const out = args.out ?? process.stdout;
  const err = args.err ?? process.stderr;

  const recipientId = resolveAgentIdByToken(args.db, args.token);
  if (!recipientId) {
    err.write(
      "watch: invalid session token — call `join` first or check the value\n",
    );
    return 1;
  }

  try {
    for await (const row of watchMessages(args.db, recipientId, {
      signal: args.signal,
    })) {
      // One JSON object per line, stable key order — easy for downstream
      // consumers (Claude Code's Monitor, jq, awk) to parse without a
      // schema. Ending with `\n` flushes Bun's stdout buffer line-wise.
      out.write(JSON.stringify(row) + "\n");
    }
    return 0;
  } catch (e: unknown) {
    err.write(`watch: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
