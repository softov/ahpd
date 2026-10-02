---
title: The host serves usage as a scheme, and a person reads their own pools without the grant
status: done
depends: [task-01-the-port-reads-back.md]
layer: "sdk, server"
refs:
  - "[code://packages/computer/src/provider.ts](../../../../packages/computer/src/provider.ts) - the `computer:` provider to mirror, `split`, `absent` and `describe`"
  - "[code://packages/sdk/src/types/resources.ts#L225-L249](../../../../packages/sdk/src/types/resources.ts#L225-L249) - `SchemeDescription` and `ResourceProvider`, the shape this answers"
  - "[code://packages/sdk/src/host.ts#L6766-L6817](../../../../packages/sdk/src/host.ts#L6766-L6817) - `capabilityFor`, which turns the URI's scheme into the grant at `:6814`"
  - "[code://packages/sdk/src/host.ts#L6826-L6855](../../../../packages/sdk/src/host.ts#L6826-L6855) - `admit`, which throws before any provider is reached"
  - "[code://packages/sdk/src/scopes.ts#L100-L113](../../../../packages/sdk/src/scopes.ts#L100-L113) - `namesOf`, which says every scope a person may name"
  - "[code://packages/sdk/src/usage.ts](../../../../packages/sdk/src/usage.ts) - the store the provider is given and the header that has to say both"
  - "[code://packages/sdk/src/meter.ts#L159-L171](../../../../packages/sdk/src/meter.ts#L159-L171) - `poolsOf`, the spelling a record was charged under"
---

## Objective

`usage://` lists the pools a reader may see, `usage://<pool>` reads that pool's day, week and month totals, and `usage://<pool>/records` lists the records charged to it, all through the resource calls and `_meta` advertisement a client already uses.
A signed-in person reads their own, their teams' and their projects' pools without a grant; anything else needs `usage:read`.

## Files

- `UPDATE: packages/sdk/src/usage.ts` - `usageProvider(options)` and `UsageProviderOptions`, a `ResourceProvider` with `list`, `resolve`, `read` and `describe`, beside the store the plan's ref already names; the file's header says what it is for today and has to say both.
- `UPDATE: packages/sdk/src/scopes.ts:100-113` - `poolsFor(principal)`, the pools a person may see, beside `namesOf`.
- `UPDATE: packages/sdk/src/users.ts:40` - `SUBJECTS`, where `usage` joins the four host/36 puts there.
- `UPDATE: packages/sdk/src/index.ts:53-58` - the two new exports.
- `UPDATE: packages/sdk/src/types/resources.ts:234-249` - `ResourceProvider` gains `authorize?(uri, reader)`, and `list`/`read` receive the reader (decision `a-scheme-provider-may-authorize-a-read-itself`).
- `UPDATE: packages/sdk/src/host.ts:6766-6817` - `capabilityFor`, and `admit` at `:6826-6855` with the one gate at `:10522`: a read whose provider's `authorize` answers `true` needs no `<scheme>:read`; `resourceList` and `resourceRead` pass the connection's principal.
- `UPDATE: packages/sdk/src/host.ts:7626-7643` - `resourceList` and `resourceRead`, which hand the provider nothing about who asked.
- `UPDATE: packages/server/src/commands/run.ts:263-384` - the daemon registers the provider beside the store it already builds.
- `CREATE: packages/sdk/test/usage-scheme.test.ts` - the cases below.

## Steps

1. `usageProvider({ usage, timezone, onProblem })` takes the `Usage` port, the zone the periods are cut in, and somewhere to say a day could not be read; `timezone` absent is the system's own zone.
2. `describe()` gives the title and description and no manifest, because nothing under `usage:` is made and there is no create form to draw.
3. `usage://` lists one entry per pool the reader may see, as `Entry` with `type: 'directory'`; `usage://<pool>` lists `day`, `week`, `month` and `records`.
4. A pool name is one path segment, read with `decodeURIComponent` and written with `encodeURIComponent`, because a pool name holds colons: `project:backend:search` is a name rather than an authority, which is the reading the plan's table row settled on.
5. `read` on the pool answers `{ day, week, month }`, each one a `UsageTotal` from `usage.total(pool, from, until)`, as JSON; a measure nothing was charged in is absent rather than zero, because `total` already leaves it out.
6. The three periods are cut in `timezone`, not in the system's zone: a day starts at local midnight, a week at the Monday before it, a month at the first. The zone's offset comes from `Intl.DateTimeFormat` with `timeZone`, and the boundary is the instant that offset puts at that local midnight, since nothing in this repository holds a zoned clock.
7. `read` on `records` answers the records from `usage.records`, and `from` and `until` are read off the query string; no `from` is the first day of the current month, no `until` is now, and at most the newest 200 are answered.
8. `poolsFor(principal)` in `packages/sdk/src/scopes.ts`, beside `namesOf`, is the one answer to "which pools may this person see": `user:<id>`, and for each name `namesOf` gives, `team:<name>` when the name is a bare team and `project:<name>` when it names one. That is the spelling `poolsOf` writes at `packages/sdk/src/meter.ts:167-171`, so a pool a record was charged to is a pool this can list.
9. A reader holding `usage:read` sees every pool `usage.pools()` names; one holding it does not sees `poolsFor`, and is refused `-32009` with `refusalReason(id, 'usage:read')` for any other pool, which is the sentence the host would have said itself.
10. A reader the gate did not check is a root connection or a host with no users directory, because `admit` returns early for both at `packages/sdk/src/host.ts:6827`, so the provider is handed no principal and answers every pool. A reader it did check is handed their `Principal`, and a principal with no `usage:read` may see only `poolsFor`.
11. `capabilityFor` at `packages/sdk/src/host.ts:6814` turns every `usage:` URI into `usage:read` and `admit` throws before the provider is reached, so the own-pool rule of step 9 cannot run until the gate is opened for it and `resourceList` and `resourceRead` at `:7626-7643` hand the provider the reader.
12. `usage` joins `SUBJECTS` at `packages/sdk/src/users.ts:40`, beside the four host/36 puts there, so a role may be written with the subject rather than only with the wildcard that reaches it.
13. The daemon registers the provider in `base` at `packages/server/src/commands/run.ts:263-384`, beside the store it builds at `:357-360`, and only where `base.usage` is set: a host with no `usage` port serves no `usage:` scheme, so the advertisement at `packages/sdk/src/host.ts:5667-5682` leaves the key out rather than answering a store that is not there.
14. Export `usageProvider` and `poolsFor` from `packages/sdk/src/index.ts:53-58`, where `fileUsage` and `namesOf` already are.

## Validation

- `packages/sdk/test/usage-scheme.test.ts`, new: `usage://` lists the reader's own, their teams' and their projects' pools and not another person's; a reader holding `usage:read` lists every pool the store holds; `usage://<pool>` answers `day`, `week` and `month` whose values equal `usage.total` over the same range; the week starts on the Monday in a configured zone, checked on a zone whose week does not start on the system's Monday day; `usage://project%3Abackend%3Asearch` is the pool named `project:backend:search`; `usage://<pool>/records` answers the records newest first; a pool the reader may not see is refused with `<id> may not usage:read here`; a pool nothing was charged to answers an empty total rather than zeroes.
- `packages/sdk/test/users-gate.test.ts`, beside the scheme case at `:219-259`: a `guest` with no `usage:read` reads their own pool and is refused another person's, and a role naming `usage:read` reads every pool.
- `packages/sdk/test/plugin-host.test.ts`, beside the advertisement case at `:290-337`: `_meta['ahpd.resourceProviders'].usage` carries `root: 'usage://'` and the operations the provider implements.
- `pnpm exec vitest run packages/sdk/test/usage-scheme.test.ts packages/sdk/test/users-gate.test.ts packages/sdk/test/usage.test.ts`.
- `pnpm typecheck`, `pnpm test`, `pnpm boundary`.
