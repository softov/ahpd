---
title: ahpd takes the cofold releases, and its tests pin reads and addresses
status: todo
depends: [task-05-cofold-asks-for-a-read-outside.md, task-06-cofold-tools-check-real-paths-and-addresses.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/package.json#L61-L66](../../../../packages/agent-cofold/package.json#L61-L66) - `@cofold/agents` and `@cofold/tools` ranges"
  - "[code://test/agent-cofold-tools.test.ts#L116-L123](../../../../test/agent-cofold-tools.test.ts#L116-L123) - the `globalThis.fetch` stub"
  - "[code://test/agent-cofold-tools.test.ts#L328-L354](../../../../test/agent-cofold-tools.test.ts#L328-L354) - `ROWS`"
---

## Objective

`@ahpd/agent-cofold` depends on the `@cofold/agents` and `@cofold/tools` releases that carry tasks 05 and 06, and its mode table proves an outside read asks and an internal address is refused.

## Files

- `UPDATE: packages/agent-cofold/package.json:61-66` - `@cofold/tools` from `^0.0.1` to `^0.1`.
- `UPDATE: pnpm-lock.yaml` - the new versions.
- `UPDATE: test/agent-cofold-tools.test.ts` - the rows and cases below.

## Steps

1. Wait for Softov to publish both releases; do not point the manifest at a local path.
2. `@cofold/tools` becomes `^0.1`, per [decision: tools is released as 0.1.x](../../../decisions/cofold-tools-is-released-as-0-1.md), and `@cofold/agents` stays `^0.1.0` with the lockfile moved to the release that carries task 05.
3. `pnpm install --no-frozen-lockfile` once, then check `pnpm install --frozen-lockfile` is clean.
4. The `web_fetch` cases in the test use an IP-literal public URL (`https://203.0.113.10/`) so the address check needs no DNS; the `globalThis.fetch` stub stays.

## Validation

- `test/agent-cofold-tools.test.ts`: a row "a read outside the workspace" (`read_file` on `away/secret`) expects `default: 'ask'`, `acceptEdits: 'ask'`, `plan: 'ask'`, `auto: 'run'`, `bypassPermissions: 'run'`, `dontAsk: 'deny'`; it runs under `default` today.
- A case where `web_fetch` of `http://127.0.0.1:1/` under `bypassPermissions` completes with `success: false` and the stubbed `fetch` is never called; today the stub is called.
- `pnpm install --frozen-lockfile` is clean with no peer-dependency warning for `@cofold/tools`.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.

## Resume
