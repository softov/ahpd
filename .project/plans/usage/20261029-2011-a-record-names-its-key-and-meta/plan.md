---
title: A record names its key and its meta
domain: usage
status: built
priority: medium
created: 2026-10-29
revalidated: 2026-10-29
refs:
  - git://817615bc:.project/briefs/a-proxy-key-names-what-it-charges.md - the brief this plan covers, parts 4 and 5
  - git://2d21e7bd - the commit of `main` the facts were checked at
  - "[code://packages/sdk/src/types/usage.ts#L36-L63](../../../../packages/sdk/src/types/usage.ts#L36-L63) - `UsageBase`, which gets `token` and `meta`"
  - "[code://packages/sdk/src/types/users.ts#L290-L337](../../../../packages/sdk/src/types/users.ts#L290-L337) - `TokenRecord`, which gets `meta`"
  - "[code://packages/sdk/src/access/users.ts#L1566-L1651](../../../../packages/sdk/src/access/users.ts#L1566-L1651) - `mintToken`, which writes `meta`"
  - "[code://packages/sdk/src/access/tokens.ts#L130-L162](../../../../packages/sdk/src/access/tokens.ts#L130-L162) - `x-ahpd/tokens/mint`, which takes `meta`"
  - "[code://packages/server/src/commands/token.ts#L180-L277](../../../../packages/server/src/commands/token.ts#L180-L277) - `ahpd token mint` and `token list`"
  - "[code://packages/server/src/proxy/caller.ts#L86-L112](../../../../packages/server/src/proxy/caller.ts#L86-L112) - `callerOf`, which reads `X-AHP-Scope` the way it will read `X-AHP-Meta`"
  - "[code://packages/server/src/proxy/listener.ts#L472-L493](../../../../packages/server/src/proxy/listener.ts#L472-L493) - `chargedAs`, what a record is charged as"
  - "[code://packages/server/src/proxy/listener.ts#L1114-L1152](../../../../packages/server/src/proxy/listener.ts#L1114-L1152) - `record`, which writes the proxy's `ModelUse`"
  - "[code://packages/server/src/proxy/listener.ts#L150-L156](../../../../packages/server/src/proxy/listener.ts#L150-L156) - every `x-ahp-*` header stays on the host and is not sent upstream"
---

## Goal

A proxy record says which key made the call, and carries the meta the key and the call name.
Meta is a map of `key=value` strings, such as `env=prod` or `client=pi`.
A key holds its own meta, and a call adds to it with the `X-AHP-Meta` header.
Reports grouped by a meta key are a later step, in the idea `usage-grouped-by-meta`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "SCOPE_HEADER" packages/server/src` - the one header the proxy reads from a person's call today.
- `rg -n "source: 'proxy'" packages/server/src` - `record` in the listener is the one place a proxy record is written.
- `rg -n "principal.token|\.token !== undefined" packages/sdk/src packages/server/src` - a principal signed in with a key carries the key's id as `token`.

### Runtime path

```
ahpd token mint --meta env=prod -> mintToken: checkMeta -> tokens file
pi -> /v1 with the key, X-AHP-Meta: client=pi -> callerOf: metaOf(header) -> caller.meta
   -> chargedAs -> record: { token, meta: { env: prod, client: pi } }
```

### Gaps

- A usage record does not say which key made it.
- A token record holds no meta, and the proxy reads no meta header.

## Answers

| What | Source | Task |
| --- | --- | --- |
| One form: meta, a map of string keys to string values. No separate tags | Softov, 2026-10-29: "I know for instance that meta solve tags" | 02 |
| A key holds meta, and a call adds meta with a header | Softov, 2026-10-29: "meta on key - meta on headers" | 02, 03 |
| The header is `X-AHP-Meta: k=v,k=v` | (defaulted: the `X-AHP-` prefix the scope header uses) | 03 |
| A meta key is 1 to 64 characters of `[A-Za-z0-9_.-]` | (defaulted: Softov, 2026-10-29, on the bounds: "dont know") | 02 |
| A meta value is 0 to 256 characters, with no comma and no line break | (defaulted: Softov, 2026-10-29, on the bounds: "dont know") | 02 |
| A key and a call each hold at most 32 entries | (defaulted: Softov, 2026-10-29, on the bounds: "dont know") | 02 |
| When the key and the header name the same meta key, the key wins | (defaulted: what an operator set on the key is not changed by a client) | 03 |
| A malformed header is refused with 400, and not dropped | (defaulted: a dropped header loses a charge the caller asked for) | 03 |
| Only proxy records carry `token` and `meta` | (defaulted: the proxy is the one door a key with meta is for) | 01, 03 |

## Proposed architecture

- **Data flow** - the mint writes `meta` on the token record. `callerOf` reads the header and the key's meta, and the caller carries both. `record` writes `token` and `meta`.
- **Event flow** - none.
- **State flow** - the tokens file holds the key's meta. The usage store holds what each record carried.
- **Layer responsibilities** - sdk: the types, `checkMeta` and the mint · server: the header, the record, the flags and the docs.
- **Source-of-truth files** - [`code://packages/sdk/src/types/usage.ts`](../../../../packages/sdk/src/types/usage.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A proxy record names its key](task-01-a-proxy-record-names-its-key.md) | done | - |
| [02 - A key is minted with meta](task-02-a-key-is-minted-with-meta.md) | done | - |
| [03 - A call adds meta with a header](task-03-a-call-adds-meta-with-a-header.md) | done | 01, 02 |

## Risks and tradeoffs

- Meta grows each record. The bounds keep it to at most 32 short entries.
- A key's meta is read at each call from the token record, so a change to the tokens file reaches the next call.

## Resume state

- **Done so far:** all three tasks are implemented: a proxy record names the key that made the call in `token` and carries the key's `meta` and the call's `X-AHP-Meta` entries, and a key is minted with `meta`.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** the plan `proxy/20261029-2010-a-key-carries-its-scope` also changes `TokenRecord`, `mintToken` and `ahpd token mint`. Rebase on it when it merges first.

## Final verification checklist

- [x] `pnpm exec tsc -p tsconfig.json --noEmit` passes.
- [x] The whole suite passes.
- [ ] A key minted with `--meta env=prod` makes a call with `X-AHP-Meta: client=pi`, and the record holds `token` and both entries.
- [ ] A call with `X-AHP-Meta: bad` is refused with 400.
