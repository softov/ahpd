---
title: The policy form reads its choices from the manifest
domain: policy
status: planned
priority: medium
created: 2026-10-04
revalidated: 2026-10-04
requires:
  - plans/policy/01-a-policy-says-who-may-use-what/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/policies.ts#L22-L44](../../../../packages/sdk/src/policies.ts#L22-L44) - `MEASURES` and `MATCHES` by kind, `PERIODS`, `KINDS`, `EFFECTS`, `LIMIT_POOLS`: the values `checkPolicy` accepts"
  - "[code://packages/sdk/src/policy.ts#L64-L110](../../../../packages/sdk/src/policy.ts#L64-L110) - the manifest today, where those values are written again as prose in each field's description"
  - "[code://packages/sdk/test/policy-scheme.test.ts#L175-L186](../../../../packages/sdk/test/policy-scheme.test.ts#L175-L186) - the manifest test this extends"
  - "[code://docs/POLICY.md](../../../../docs/POLICY.md) - the row, its match types and measures by kind, for a person"
  - npm://ajv@^8.20.0 - already a dev dependency; validates a body against the manifest in the test
  - file:///github/ahpapp/.project/plans/policy/01-a-host-shows-its-policies/plan.md - the client that draws pickers from this
---

## Goal

A client drawing the policy form reads every choice from the `policy:` manifest: the kinds, the effects, the periods, the limit pools, and which measures and which match types each kind takes.
Today those values are only in the descriptions' prose and in `docs/POLICY.md`, so a client either offers free text or writes the values into itself, and the second goes stale the day the host adds one.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "enum" packages/sdk/src/policy.ts packages/sdk/src/people.ts` - no manifest field in either carries an `enum`.
- `rg -n "MEASURES|MATCHES|PERIODS|KINDS|EFFECTS|LIMIT_POOLS" packages/sdk/src` - module constants in `policies.ts`, not exported, read only by `checkPolicy`.

### Runtime path

```
policies.ts tables -> checkPolicy (refuses a body)
policy.ts manifest -> describe() -> initialize _meta['ahpd.resourceProviders'].policy.manifest -> a client's form
```

### Gaps

- `kind`, `effect`, `limits[].measure`, `limits[].period` and `limits[].pool` are `type: string` with no `enum`.
- Which measures a kind takes, and which match types, are in `MEASURES` and `MATCHES` and nowhere in the manifest.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The manifest carries `enum` for `kind`, `effect`, `limits[].measure`, `limits[].period` and `limits[].pool`, and says which measures and which match types each kind takes, as data | Softov, 2026-10-04, asked "The policy manifest has no enum for kind, effect, measure, period or pool. How should the form get its choices?": "ahpd adds enums" | 01 |
| The manifest's values are built from the tables `checkPolicy` uses, so the two cannot disagree | (defaulted: one source; a second list is the drift this plan exists to remove) | 01 |
| A kind's measures and match types are said with JSON Schema `allOf` of `if` `kind` is a value `then` the narrower `enum` and `propertyNames`, standard schema a validator such as ajv reads | (defaulted: standard JSON Schema rather than an ahpd key of its own; Softov may prefer a flat map) | 01 |
| The descriptions keep their sentences and drop the value lists they repeat | (defaulted: a value list in prose is the copy that went stale) | 01 |
| `docs/POLICY.md` says the manifest is where a client reads the choices | follows row 1 | 02 |

## Proposed architecture

- **Data flow** - `policies.ts` exports its tables; `policy.ts` builds the manifest from them once, at module load.
- **Event flow** - none; the manifest already reaches clients through `ahpd.resourceProviders`.
- **State flow** - none.
- **Layer responsibilities** - sdk: the tables, the manifest and its test · docs: `POLICY.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/policies.ts`](../../../../packages/sdk/src/policies.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The manifest says its choices](task-01-the-manifest-says-its-choices.md) | todo | - |
| [02 - The docs say where a client reads them](task-02-the-docs-say-where-a-client-reads-them.md) | todo | 01 |

## Risks and tradeoffs

- A client that only reads `properties` sees no change, because `enum` and `allOf` sit beside what it already reads.
- `if`/`then` asks more of a client than a flat map - the test validates real bodies with ajv, so the schema is checked as a validator reads it, not only by eye.

## Resume state

- **Done so far:** planned 2026-10-04.
- **Next action:** [task-01-the-manifest-says-its-choices.md](task-01-the-manifest-says-its-choices.md).
- **Open questions:**
  1. `allOf` with `if`/`then`, or a flat map such as `kinds: { model: { measures, matches } }` beside the schema - proposed: `if`/`then`, standard schema.
- **Watch out for:** `MATCHES.agent` names `model`, so an agent row may match a model; keep the per-kind lists exactly as `checkPolicy` has them.

## Final verification checklist

- [ ] The manifest's `kind`, `effect`, `measure`, `period` and limit `pool` carry `enum`, equal to the tables.
- [ ] ajv, compiling the manifest, accepts each kind's valid body and refuses a measure or match type that kind does not take.
- [ ] `docs/POLICY.md` names the manifest as where the choices are.
- [ ] `plans/index.md` updated.
