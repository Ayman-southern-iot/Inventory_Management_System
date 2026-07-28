# No hardcoded values

The project rule with the most ways to violate it. Read this before writing any literal.

## The test

Before typing a literal, ask: *would anyone ever want this to be different — in another
environment, next quarter, or for another customer?* If yes, it is configuration, not code.

## Where values are allowed to live

| Kind of value | Home | Changed by |
|---|---|---|
| Secrets, connection strings, hostnames, ports | env → `config` module | ops, at deploy |
| Business policy (expense threshold, over-budget tolerance, reminder cadence) | `app_settings` table | admin, at runtime |
| Domain constants that are part of the model (status names, role names, movement types) | TS enum + Postgres enum | a migration |
| Layout, colour, spacing | design tokens | designer |
| Copy shown to a user | `apps/web/src/i18n/en.ts` | anyone |

## Concrete bans

```ts
// BANNED                                   // INSTEAD
if (total > 15000)                          if (total > await settings.get('EXPENSE_THRESHOLD_BDT'))
if (user.role === 'approver')               if (user.hasRole(Role.APPROVER))
fetch('http://localhost:3000/api/...')       fetch(`${config.apiBaseUrl}/...`)
const pool = new Pool({ password: 'ims' })  const pool = new Pool(config.db)
setTimeout(fn, 900000)                      setTimeout(fn, config.reminderIntervalMs)
<div style={{ color: '#22c55e' }}>          <div className="text-success">
toast('Requisition submitted')              toast(t.requisition.submitted)
status === 'APPROVED'                       status === RequisitionStatus.APPROVED
```

## The config module

One file, `apps/api/src/config/config.schema.ts`, parses `process.env` through a zod schema and
exports a frozen typed object. Rules:

- `process.env` is referenced in **exactly one file** in the whole backend. Everything else imports
  the typed config. A `process.env` anywhere else is a bug.
- Validation runs at boot. A missing or malformed variable crashes the process with a message
  naming the variable. It never falls back to a default that silently works in dev and breaks in prod.
- Defaults are allowed only for genuinely optional, non-secret values, and the default is written
  in the schema, not scattered at the call sites.

## The settings table

`app_settings (key, value jsonb, updated_by, updated_at)`, read through `SettingsService` with a
short in-memory cache invalidated on write. Seeded from env on first boot so a fresh install works,
then owned by the admin UI. Never read a business value straight from env at the point of use —
that is how the threshold becomes unchangeable without a redeploy, which requirements §11 forbids.

## Exceptions

Genuinely universal constants are fine: `MS_PER_DAY`, `HTTP_STATUS.CREATED`, `BCRYPT_ROUNDS`.
If you take an exception, name the constant and put it in the module's `constants.ts`. An unnamed
literal in the middle of a function is never the exception.

## Enforcement

`.claude/hooks/guard-hardcoding.sh` runs after every edit and flags the common patterns. It catches
maybe 80% of violations. The other 20% is your judgement — the hook is a safety net, not the rule.
