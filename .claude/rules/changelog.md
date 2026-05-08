# Branch Changelog Rule

## When This Applies

On any branch **other than** `main`, `staging`, and `production`.

## What To Do

After making code changes on a feature branch, create or update the changelog file at:

```
docs/changelogs/{branch-name}.md
```

The branch name is determined by `git branch --show-current`.

## When To Update

- After implementing a feature or fix (initial creation)
- After adding or removing tests
- After bug fixes discovered during review
- After any non-trivial change to the scope or behavior of the branch work

Do NOT update for: lint fixes, comment typos, whitespace-only changes.

## What To Include

The changelog is a plain-English record of the work on this branch. It must contain:

1. **What changed** — new models, new endpoints, modified behavior. Be specific: field names, status values, route paths.
2. **Files changed** — table of new files and modified files with one-line description of each change.
3. **New API surface** — new endpoints and updated response shapes (field names only, no code blocks of full schemas).
4. **Design decisions** — why the approach was chosen over alternatives (e.g. synchronous vs async, AND vs spread for WHERE).
5. **Test coverage** — list every test case by name and what it verifies. No code. No response payloads. Just: case name → what it asserts.

## What NOT To Include

- Actual code snippets
- Full test response bodies or JSON examples
- Rationale already obvious from the code
- Future plans or speculative features

## Format

Follow `docs/changelogs/add-import-csv-history.md` as the reference template.

**Header block** (top of file):

```
# Feature Title

**Branch:** `branch-name`
**Scope:** Module — sub-area
**Type:** Additive | Breaking | Fix
```

Then sections: What Changed, New Model (if any), Files Changed, New API Surface, Design Decisions, Test Coverage.

## Example Test Coverage Table

```markdown
| Test | What it verifies |
|---|---|
| returns 201 with non-null import_id | HTTP 201, import_id is a string |
| all rows fail → status=failed | record.status=failed when succeeded=0 |
| unauthenticated list → 401 | PlatformAuthHandlerMiddleware rejects |
```
