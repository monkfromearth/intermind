# Plain English

Always write in plain English. This applies to **all** assistant output — chat answers, summaries, plans, status updates, code review verdicts, changelog entries, doc prose, end-of-turn recaps. No exceptions.

## What "plain English" means here

- Lead with the answer in words a non-engineer can follow. Acronyms and jargon come **after** the plain version, never instead of it.
- One concept per sentence. Short sentences. No nested clauses.
- Active voice. Concrete nouns. Real examples with real names.
- If you must use a technical term (`WAL`, `stdio`, `long-poll`, `zod`), explain what it does in the same sentence the first time it appears in a given reply.
- Bullets and tables are fine — but each bullet must still read like a complete plain-English thought, not a label.

## What plain English is NOT

- Not "dumbed down." Keep the precision; lose the jargon.
- Not "shorter at any cost." If a concept needs a sentence of context, give it the sentence.
- Not "no code references." File paths, line numbers, function names are fine — but wrap them with what they mean ("`db.ts` — the file that opens SQLite, turns on WAL mode, and creates the two tables").

## Bad → Good

**Bad:** "Switched `wait_for_reply` to a 200 ms select-loop with deadline; replaces the stub poll."

**Good:** "When an agent calls `wait_for_reply`, we now keep checking the database every 200 ms until either a reply shows up or the agent's deadline runs out. Before, the call returned immediately with nothing, so agents had to poll on their own."

**Bad:** "Enabled `journal_mode=WAL` and `synchronous=NORMAL` on the SQLite handle."

**Good:** "Multiple coding agents need to read and write the same `state.db` file at once. Turning on WAL mode (`journal_mode=WAL`) lets readers and one writer work in parallel without blocking each other, which is the whole reason we don't need a daemon."

**Bad:** "`register_agent` now returns a bearer token; subsequent tools derive identity from the session, not the input `agent_id`."

**Good:** "When an agent registers, we hand it a secret token. From then on, every tool call uses that token to figure out who's calling — clients can no longer claim to be another agent by passing a different `agent_id` in the arguments."

## When the audience is technical

Doc and other engineers can read jargon. The rule is not "avoid technical terms." It's: **say the thing in plain English first, then drop in the technical term as the precise label.** That way the reply works whether the reader skims the first sentence or reads the whole thing.

## Summaries specifically

Every end-of-turn summary, changelog entry, plan, and verdict table must explain **what changed in user/agent terms first**, then optionally point to the file/line for the engineer. "Fixed the hang on second client — two agents can now connect to the same project at once (`db.ts:14`)" beats "Set `journal_mode=WAL` in `db.ts:14`."
