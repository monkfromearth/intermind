# Code Review Workflow

## When to Use

Apply this workflow whenever:
- User pastes review output (CodeRabbit, AI reviewer, human PR comment, linter output)
- Running `cr review` and acting on results
- Processing any batch of code review feedback

## Stay On The Feature Branch

**NEVER create a new branch for follow-up fixes when you are already on the feature branch that owns the work.**

A feature branch stays alive until it is merged to `main`. Merging it to `staging` is a deploy snapshot, not a close. Review feedback, bug fixes discovered post-merge-to-staging, comment updates — all belong as additional commits on the SAME feature branch.

**Before committing a follow-up fix, check:**
1. `git branch --show-current` — am I on the original feature branch? If yes, commit here. Do NOT `git checkout -b claude/fix-followup-XYZ`.
2. Has the feature branch been merged to `main`? If no, the branch is still the authoritative home for any changes in its scope.
3. Is the fix scope-adjacent to the feature (same module, same review thread, same bug discovered via the feature's testing)? If yes, it belongs on this branch.

**Only create a new branch when:**
- The original branch has been merged to `main` AND deleted.
- The fix is genuinely unrelated scope (different module, different bug class).
- The user explicitly asks for a separate branch/PR.

**Why this matters:** Splitting one feature's work across multiple branches creates redundant PRs, duplicate review cycles, and forces manual consolidation later (cherry-picks). One feature = one branch = one PR to `main`. Staging merges are intermediate; they don't reset the branch ownership model.

## The Workflow

### Step 1: Parse into Exhaustive List

Extract EVERY item — no collapsing, no skipping. Number them sequentially.

Format each item:
```
N. [FILE:LINE or SECTION] — [Issue summary in one line]
```

If the review has sections (nitpick / major / minor), preserve that grouping but still number globally.

### Step 2: Judge Each Item

For each numbered item, assign one of three verdicts:

| Verdict     | Meaning                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| **ACT**     | Clearly correct, matches our patterns, adds value — implement it                                           |
| **SKIP**    | Doesn't apply to our codebase, contradicts existing patterns, or is purely stylistic noise                 |
| **DISCUSS** | Ambiguous, architectural implication, or conflicts with existing code — needs user input before proceeding |

**Verdict format:**
```
N. ACT   — [one-line reason]
N. SKIP  — [one-line reason: why it doesn't apply]
N. DISCUSS — [one-line question or conflict to resolve]
```

### Step 3: Present the Full Verdict Table

Show the complete numbered list with verdicts BEFORE making any changes.
Do NOT silently skip items. If an item is borderline, surface it as DISCUSS.

Example output:
```
## Review Items — Judgment

1. ACT   — handlers.ts:42 — Missing null check on `agent` before reading `agent.role`
2. SKIP  — "Add a separate read replica for `messages`" — WAL mode already gives us read concurrency, no replica needed
3. ACT   — `wait_for_reply` swallows DB errors instead of surfacing them as MCP errors
4. DISCUSS — Suggests extracting zod shapes into per-tool files — only six tools total, YAGNI applies?
5. SKIP  — Suggests using `async/await` over `.then()` — both are valid here, not a real issue
6. ACT   — Variable name `data` is too generic — rename to `message_row`
```

### Step 3.5: Provide Context for DISCUSS Items

For each DISCUSS item, include enough context for the user to answer without going back to the code:

1. **What the old behavior was** vs **what the new behavior is** — concrete diff, not prose
2. **What failure mode you're guarding against** — be specific (e.g. "client disconnect mid-stream means `GeneratorExit` is thrown, not `Exception`, so the counter leaks")
3. **What question needs answering** — yes/no or a specific choice, not an open-ended "thoughts?"
4. **A verification path** — how the user can confirm without your help (e.g. "open `state.db` with `sqlite3` and run `PRAGMA journal_mode;`")

Example DISCUSS block:
```
5. DISCUSS — `wait_for_reply` poll interval: 200 ms vs 50 ms
   Old: setInterval-style 200 ms select loop until deadline
   New: reviewer suggests dropping to 50 ms for "snappier" replies
   Risk: At 50 ms, every idle agent burns 20 SELECTs/sec against state.db.
         With N agents long-polling, that's 20N writes-blocked-by-readers per second.
         WAL helps, but on cheap laptop SSDs we have measured contention above ~10 agents.
   Verification: bun test test/server.test.ts -t "concurrent" with N=20 agents
   Question: Are we optimizing for latency (drop to 50 ms) or for scaling to many idle agents (keep 200 ms)?
```

### Step 3.7: Leave SKIP Comments for the Reviewer

When the reviewer's AI agent suggests fixes and we choose to SKIP, add a brief inline comment at the referenced location explaining WHY the item was skipped. This serves two purposes: (1) the reviewer understands the reasoning without re-analyzing, (2) future reviewers don't re-flag the same item.

Not every SKIP needs a comment — only add them when:
- The reviewer describes a plausible bug that doesn't exist in current code (already fixed, or misread)
- The reviewer suggests a change that contradicts an intentional design decision
- The item references code/files that don't exist (stale reference)

Comment format: `// REVIEW-SKIP: [one-line reason]`

Example:
```ts
// REVIEW-SKIP: token check already happens in server.ts before this handler runs —
// see the trust-boundary note in CLAUDE.md. Adding it here would double-validate.
export function send_message(db: Database, agent_id: string, args: SendMessageInput) {
  const row = db.prepare("INSERT INTO messages ...").get(...);
  return { message_id: row.id };
}
```

Do NOT litter the codebase with REVIEW-SKIP comments for every item — use judgment. If the code is already well-commented and the skip reason is obvious from reading it, no additional comment is needed.

### Step 4: Confirm Then Execute

- If there are DISCUSS items: wait for user to resolve them before proceeding
- If all items are ACT/SKIP: present the list, then proceed to implement ACT items
- If user says "go ahead" or "proceed": implement all ACT items

### Step 5: Report Resolutions

After implementing, report per-item:
```
1. DONE  — Added null check on `agent` before reading `agent.role` (handlers.ts:42)
3. DONE  — `wait_for_reply` now throws an MCP error on DB failure instead of returning empty
6. DONE  — Renamed `data` → `message_row` in handlers.ts:42
```

---

## Judgment Heuristics

**SKIP when:**
- Suggestion contradicts a locked decision in CLAUDE.md (e.g. "add an HTTP transport now" — v1 is stdio-only by design)
- Suggestion adds a daemon, socket, or coordination layer that WAL-mode SQLite already obviates
- Suggestion swaps the stack (e.g. "use better-sqlite3 / Drizzle / Prisma") — we're locked on Bun + `bun:sqlite` + raw SQL on purpose
- Generic advice that doesn't account for Bun's built-ins (test runner, SQLite, bundler) or the MCP SDK's serialization
- The reviewer flagged a pattern that is intentionally different here for a documented reason
- It's a style nitpick with no correctness/maintainability implication
- It duplicates what the MCP SDK or `bun:sqlite` already handles

**ACT when:**
- Null/undefined access without a guard
- Naming that fails the 5-second clarity rule
- Actual security issue with a clear exploit path (e.g. trusting a client-supplied `agent_id` instead of deriving identity from the bearer token)
- **Improvements that reduce future risk** — consistency fixes (e.g. one tool throws an `McpError` and another throws a plain `Error`), defense-in-depth at the trust boundary (zod check before SQL even though SQL would reject it too), documentation of known gaps with a TODO. If the fix is small (1–5 lines) and reduces ambiguity or prevents a future class of bug, ACT — don't defer it
- **Two sources of truth that can drift** — the zod shape in `schemas.ts` and the SQL column list in `db.ts` both describe the same `messages` row. If they drift, requests look valid at the boundary but blow up at the SQL layer. Make one authoritative or add a comment linking the two — at minimum
- **Crash-safety gaps** — anything where the server could ack a `send_message` before the row is durable on disk. CLAUDE.md is explicit: persist before acknowledging

**DISCUSS when:**
- Architectural change (new file, new abstraction, extraction)
- Contradicts this rule set but the reviewer makes a compelling case
- Touches the SQLite schema (the two tables in `db.ts`) or any pragma
- Affects the MCP tool surface — adding, renaming, or changing the shape of any of the six tools
- **Product/design questions** — e.g. "should `wait_for_reply` block the calling agent's turn or return immediately with a future-style handle?" is a UX decision, not a code bug. Present the trade-off and let the user decide

**Bias toward action.** When in doubt between SKIP and ACT, prefer ACT if the fix is small and the item improves consistency, defense-in-depth, or documentation of known gaps. A 1-line consistency fix or a TODO comment costs nothing; a deferred improvement may never happen. The bar is: "Would a future developer be confused or bitten by this?" If yes, fix it now.

---

## Key Safeguards

**Never blindly apply.** Reviewer suggestions — especially from automated tools — must clear these checks first:

- Verify the suggestion matches existing patterns (grep first)
- If you can't explain WHY the existing code is wrong, don't change it
- "Race condition" and other theoretical issues require a concrete failure scenario in OUR code
- A suggestion that makes code MORE complex is a red flag
