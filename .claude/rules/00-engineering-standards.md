# Engineering standards

Applies everywhere. Kept short on purpose — this file loads in every session.

## Judgement

- Prefer the boring solution. This system has 12 users; cleverness costs more than it saves.
- Make illegal states unrepresentable. A `CHECK` constraint beats a comment beats a code review.
- Fail fast and loudly at boot (bad config, missing migration) rather than at 3pm on a Tuesday.
- When two designs are close, pick the one that is easier to delete.

## Errors

- Never swallow an error. Either handle it or let it propagate to the global filter.
- Domain failures are typed exceptions (`InsufficientStockError`), not strings.
- API errors return `{ code, message, details? }`. `code` is a stable machine-readable enum member.
- User-facing messages never leak SQL, stack traces, or internal IDs.

## Naming

- Database: `snake_case`, plural tables, `<table>_id` foreign keys.
- TypeScript: `camelCase` values, `PascalCase` types, `SCREAMING_SNAKE` for constants.
- Booleans read as assertions: `isActive`, `hasApproved`, `canWithdraw`.
- No abbreviations except the project glossary (`BOM`, `IM`, `BDT`).

## Comments

Comment the *why*, never the *what*. A comment explaining what the line does means the line
needs renaming instead. Exception: any non-obvious business rule cites its spec section,
e.g. `// requirements §4: either rejection kills the whole request`.

## Git

- Conventional commits: `feat(stock): ...`, `fix(approvals): ...`, `chore(deps): ...`
- One logical change per commit. A migration and the code that uses it belong together.
- Never commit `.env`, dumps, or generated PDFs.
