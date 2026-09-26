---
title: "@cofold/tools checks real paths and refuses internal addresses"
status: done
depends: []
layer: "cofold tools (/github/cofold)"
refs:
  - "file:///github/cofold/packages/tools/src/paths.ts - `resolveWithin` (lines 5-11), a string comparison that follows no symlink"
  - "file:///github/cofold/packages/tools/src/web.ts - `fetchTool` (line 45 onward) with `redirect: 'follow'` at line 47, and `parseUrl` (line 93), which checks only the scheme"
  - "file:///github/cofold/packages/tools/src/types/web.ts - `WebOptions.fetch` (line 21), the injection the tests use"
  - "file:///github/cofold/packages/tools/src/files.test.ts - `resolveWithin` tests at line 105"
  - "file:///github/cofold/packages/tools/src/web.test.ts - the fake `fetch` at line 20, which answers from a table and never resolves a name"
---

## Objective

In `/github/cofold`, `resolveWithin` judges inside or outside on real paths, per [decision: the boundary follows symlinks](../../../decisions/the-workspace-boundary-follows-symlinks.md), and `web_fetch` refuses a loopback, private or link-local address on the first request and on every redirect, per [decision: web_fetch refuses internal addresses](../../../decisions/web-fetch-refuses-internal-addresses.md).

## Files

- `UPDATE: /github/cofold/packages/tools/src/paths.ts:5-11` - `inside` is computed from `realpath` of the workspace and of the target's nearest existing ancestor.
- `UPDATE: /github/cofold/packages/tools/src/web.ts:45-60` - `redirect: 'manual'`, a loop over hops with a limit, and an address check before each fetch.
- `UPDATE: /github/cofold/packages/tools/src/types/web.ts` - `WebOptions.lookup`, the resolver the check uses, `node:dns/promises` `lookup` with `all: true` by default.
- `UPDATE: /github/cofold/packages/tools/src/files.test.ts`, `web.test.ts` - the new cases and the fakes below.
- `UPDATE: /github/cofold/packages/tools/package.json` - version `0.0.1` becomes `0.1.0`, and the peer requirement of exactly `0.1.0` on `@cofold/agents` becomes `^0.1`.

## Steps

1. In `resolveWithin`, keep `absolute` as the lexical path the tools write to and display; compute `inside` by comparing `realpathSync.native` of the workspace with the real path of the target's nearest existing ancestor joined with the part that does not exist yet.
2. In `fetchTool`, refuse before fetching when the host is an IP literal, or resolves (every address `lookup` returns) to 127.0.0.0/8, ::1, 0.0.0.0, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7, 169.254.0.0/16, fe80::/10, or an IPv4-mapped IPv6 form of any of these; the error names the URL and says it is an internal address.
3. Follow redirects by hand: on a 3xx with `Location`, resolve it against the current URL, run `parseUrl` and the address check on it, and stop after a fixed number of hops with an error.
4. Record in *Resume* that a name resolving differently between the check and the connection (DNS rebinding) is not caught, as the decision says.
5. The tools' description or rules text says internal addresses are refused, so the model does not retry them.
6. Set `@cofold/tools`' version to `0.1.0` and its peer range on `@cofold/agents` to `^0.1`, per [decision: tools is released as 0.1.x](../../../decisions/cofold-tools-is-released-as-0-1.md).
7. Follow cofold's release process; publishing is Softov's call, and task 08 takes the release into ahpd.

## Validation

- `files.test.ts`: with `ws/link` a symlink to a folder outside `ws`, `resolveWithin(ws, 'link/new.txt').inside` is false and `resolveWithin(ws, 'sub/new.txt').inside` is true for a `sub` that does not exist; the first fails today; the existing cases at line 105 still hold.
- `web.test.ts`: `web_fetch` of `http://127.0.0.1/`, `http://169.254.169.254/` and `http://[::1]/` is refused and the fake `fetch` records no call; a host the injected `lookup` resolves to `10.0.0.5` is refused; all fail today.
- The redirect case needs the fake to change: today it answers every URL with a final page, so a redirect is never seen; the fake must honour `redirect: 'manual'` and return a `302` with `Location: http://169.254.169.254/` for one entry; `web_fetch` of that entry is refused and the fake records only the first request.
- The existing fetch cases pass a `lookup` stub that answers a public address, so they never reach real DNS.
- `/github/cofold/packages/tools/package.json` says `0.1.0` with `"@cofold/agents": "^0.1"` under `peerDependencies`.
- cofold's `pnpm test` and typecheck green.

## Resume

Done. Released 2026-09-26 from `/github/cofold` by its `release.yml` as `@cofold/tools@0.1.0`; task 08 takes it into ahpd.

- `src/paths.ts:12` `resolveWithin` keeps `absolute` lexical and computes `inside` from `realPath` (`src/paths.ts:24`) of the workspace and of the target: `realpathSync.native` when the path exists, the target of a dangling symlink (followed by hand, at most 40 links), otherwise the real path of the nearest existing ancestor with the rest appended. A dangling symlink pointing out of the workspace is outside too, which the plan did not name.
- `src/web.ts:49-63` follows redirects by hand (`redirect: 'manual'`, at most 10, `MAX_REDIRECTS` at line 11); `refuseInternal` (line 118) runs before every request: an IP-literal host is checked as is, a name through `lookup`, every address it returns. `isInternal` (line 128) covers 127/8, 0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, `::`, `::1`, fc00::/7, fe80::/10 and the IPv4-mapped form of the IPv4 ranges. A lookup failure reads `cannot fetch <url>: <code>`. The page header is the last URL fetched.
- `src/types/web.ts:23,27` `WebOptions.lookup` and the `Lookup` type; the default is `node:dns/promises` `lookup` with `all: true` (`src/web.ts:26`).
- `RULES` (`src/web.ts:14`) and the `web_fetch` description say internal addresses are refused, redirects included, and not to retry them. `README.md` says the same and documents `lookup` and the real-path check.
- DNS rebinding is not caught: a name that resolves to a public address at the check and an internal one at the connection gets through, as the decision says. NAT64 (64:ff9b::/96) and other embeddings of IPv4 in IPv6 besides `::ffff:` are not checked.
- `package.json`: version `0.1.0`, peer `"@cofold/agents": "^0.1"`. The peer was `workspace:*`, which pnpm publishes as the exact `0.1.0`. `pnpm-lock.yaml` records no peer specifiers for the importer, so it needs no change; `pnpm install` was not run.
- Tests, each failing before the fix: `src/files.test.ts:118` (symlink out, dangling symlink, missing `sub`, workspace through a symlink); `src/web.test.ts:78` (127.0.0.1, 169.254.169.254, [::1], mapped, 0.0.0.0, `2130706433`, fd00::1, fe80::1, 172.20.0.1, a name resolving to 10.0.0.5, no fetch recorded; 172.32.0.1 passes); `src/web.test.ts:91` (302 to 169.254.169.254 refused with one fetch recorded, a relative 301 followed, a redirect loop stopped). The fake `fetch` follows a 3xx itself unless `redirect` is `'manual'`, and the existing fetch case passes a `lookup` stub answering a public address.
- Verified: `node_modules/.bin/vitest run packages/tools` 4 files, 27 tests passed, no type errors; `node_modules/.bin/tsc -p packages/tools/tsconfig.test.json --noEmit` and `-p packages/tools/tsconfig.json --noEmit` clean. The repo-wide `pnpm test` and `pnpm typecheck` were not run: both build every package. papo's tests resolve `@cofold/tools` through `dist`, which was not rebuilt.
- The search-provider order claim in the decision `search-providers-are-tried-in-configured-order.md` holds: `searchTool` tries `providers` with a `for...of` in array order, returns on the first that answers, and its description lists the ids in that order.
