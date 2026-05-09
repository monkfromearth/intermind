[← Docs home](../README.md)

---

# Architecture decisions

Short, dated records of decisions that shaped Intermind. **Why we picked X over Y**, what we considered, and when to revisit.

These are *not* user guides ([`guides/`](../guides/)) and *not* general explainers ([`knowledge-base/`](../knowledge-base/)). They're for contributors asking *"why is it this way and not the obvious way?"* — usually because the obvious way doesn't work, or because the right way doesn't exist yet on the clients we ship to.

## How to read

Each file starts with a one-line thesis. If you only have 30 seconds, that's the answer. Then a TL;DR, the problem, the mechanisms surveyed, the verdict, and triggers for revisiting.

The numbering is sequential and append-only — `0001-…`, `0002-…`. A decision is never deleted; if it's wrong or superseded, write a new one and link back.

## Index

| # | Title | Status |
|---|---|---|
| [0001](./0001-message-delivery.md) | Message delivery: how peers learn about new messages | Accepted, 2026-05-09 |

## How to add a new decision

1. Pick the next number.
2. Copy the structure of [`0001-message-delivery.md`](./0001-message-delivery.md): one-line thesis, TL;DR, the problem, mechanisms considered (table), verdict, what we corrected mid-investigation (if anything), when to revisit, "So what?", sources.
3. Add a row to the index above.
4. Plain English throughout. Lead with the punchline. Tables beat prose for comparisons. No code blocks unless they clarify a decision boundary.

The format is loose ADR — closer to TechCrunch than IETF. Read in under 5 minutes, or trim until it does.
