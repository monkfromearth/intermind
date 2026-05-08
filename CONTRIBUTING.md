# Contributing to Intermind

Thanks for taking a look. Intermind is small on purpose, so there's a high bar for "more code." Read this before opening a PR.

## What is in this release, and what is not't

Intermind 0.0.1 is **just messaging between coding agents**. Six tools, a thread model, an SQLite file. Nothing else.

We will say no to:

- Tasks, todos, kanban, or workflow orchestration. Each agent already has its own task tracking.
- A shared key/value or document store. If agents want shared notes, they post to a thread.
- First-class diff/review/PR types. Diffs are text inside messages.
- Editing the user's working tree. Receiving agents apply diffs with their own Edit tool.
- A2A protocol bridging.
- A web dashboard.

If your idea fits in any of those buckets, please open an issue first to talk about whether it belongs in Intermind at all.

## Local development

You need [Bun](https://bun.com) ≥ 1.1.0. That is the only prerequisite — Bun ships the TypeScript runtime, the test runner, and SQLite.

```bash
git clone https://github.com/monkfromearth/intermind.git
cd intermind
bun install

bun test           # runs all unit + integration tests against an in-memory SQLite
bun run typecheck  # tsc --noEmit, no emit
bun run start      # starts the stdio server (default DB at ./.intermind/state.db)
```

## Testing

There are two test files, mirroring the source layout:

| File | What it covers |
| --- | --- |
| `test/handlers.test.ts` | Pure handler functions. No MCP transport — calls handlers directly. |
| `test/server.test.ts` | Real MCP `Client` ↔ `Server` over the SDK's in-memory transport. Covers tool discovery, JSON-RPC envelopes, error paths, and end-to-end conversations. |

When you add a feature, you almost always want a test in **both** files: a fast handler test for the logic, and one server test that proves the tool is wired up correctly.

Every test uses an in-memory SQLite (`openDatabase(":memory:")`) so cases are fully isolated.

## Code conventions

- **Validate at the MCP boundary.** Every tool input has a Zod schema in `src/schemas.ts`. Handlers trust their arguments.
- **Never trust a client-supplied `agent_id`.** Identity is always derived from the session token.
- **No mutation of the user's working tree.** Intermind reads and writes its own SQLite file. Diffs are *exchanged*, not *applied*.
- **Errors are MCP errors.** Throw a typed `Error` and let the SDK serialize it to a JSON-RPC error envelope.
- **Comments only when the *why* is non-obvious.** Type names and function names should carry the *what*.

## Pull requests

1. One change per PR. If you find yourself writing "and also" in the PR body, split it.
2. Add or update tests. CI runs `bun test` and `bun run typecheck`; both must pass.
3. If you change the tool surface, update the table in [`README.md`](./README.md#tools) and the example in `docs/`.
4. Keep the diff small. Big PRs get long review cycles.

## Reporting bugs

When opening an issue, please include:

1. Your Bun version (`bun --version`).
2. Which MCP client you're using (Claude Code, Codex, etc.) and its version.
3. The exact tool call that misbehaved, plus what you expected vs. what happened.
4. If reproducible, a minimal script using the in-memory transport (see `test/server.test.ts` for the pattern).

## Security

Intermind assumes local trust over stdio (same machine, same user). If you find a security issue that affects that assumption — or any future remote-transport code path — please **do not** open a public issue. Email [hi@monkfrom.earth](mailto:hi@monkfrom.earth) and we'll coordinate disclosure.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).

## Maintainer

Maintained by [monkfromearth](https://monkfrom.earth). Open an issue or a PR — both are welcome.
