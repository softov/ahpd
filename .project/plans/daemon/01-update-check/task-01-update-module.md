---
title: The update module compares, reads and refreshes, and is tested without a network
status: done
depends: []
layer: server
refs:
  - code://packages/server/src/config.ts#L55-L90 - the three `*Path()` helpers and their comments; `updatePath()` is a fourth
  - code://packages/server/src/version.ts#L20-L34 - `version()`, whose `unknown` the comparison must survive
  - code://packages/agent-claude/src/mcp.ts#L69 - `fetch(at, { signal: AbortSignal.timeout(ms) })`, the bounded request
  - code://test/sessions.test.ts - a test that points `XDG_CONFIG_HOME` at a temporary directory, the pattern for the file tests
---

## Objective

`packages/server/src/update.ts` exists with `newer`, `readUpdate` and `refreshUpdate`, each doing one thing, and `test/update.test.ts` proves all three against a local HTTP server and a temporary configuration directory.

## Files

- `CREATE: packages/server/src/update.ts` - the comparison, the file read, the fetch-and-write, and the `registry()` helper; a comment at the top names the copy in `ahpc` (decision 5).
- `UPDATE: packages/server/src/config.ts:90` - add `updatePath()` after `sessionsPath()`, with the same kind of comment: written by the daemon, not by hand, so it is not in `config.json`.
- `CREATE: test/update.test.ts` - the table, the file round trip, the server cases.

## Steps

1. `updatePath()` in `config.ts`: `join(configDir(), 'update.json')`.
2. `export interface Update { name: string; latest: string; checkedAt: string }` in `update.ts`.
3. `export const newer = (latest: string, current: string): boolean` per decision 3: parse `^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$`; either side failing to parse is `false`; compare the three numbers; equal numbers are `true` only when `current` has a prerelease and `latest` does not.
4. `export const registry = (env = process.env): string`: `env.npm_config_registry` with a trailing `/` removed, else `https://registry.npmjs.org`.
5. `export function readUpdate(): Update | undefined`: `JSON.parse(readFileSync(updatePath()))`; anything wrong, including a shape with no string `latest`, is `undefined` (decision 4).
6. `export async function refreshUpdate(options: { name: string; registry?: string; timeoutMs?: number }): Promise<void>`: GET `${registry}/-/package/${name}/dist-tags` with `AbortSignal.timeout(timeoutMs ?? 5000)` and `Accept: application/json`; on `ok` and a body that parses to `{ latest: string }`, `ensureConfigDir()` and write `{ name, latest, checkedAt: new Date().toISOString() }`; every other outcome returns without throwing and without writing (decision 4).
7. `export const stale = (found: Update | undefined, now = Date.now(), maxAgeMs = 6 * 60 * 60 * 1000): boolean`: `true` when there is no file, when `checkedAt` does not parse, or when it is older than `maxAgeMs`.

## Validation

- `test/update.test.ts`:
  - `newer` table: `0.5.0 < 0.6.0`, `0.9.0 < 0.10.0`, `0.5.0 = 0.5.0`, `0.6.0 > 0.5.0` (local ahead, false), `0.5.0-beta.1 < 0.5.0`, `0.5.0 vs 0.5.0-beta.1` (false), `unknown`, `""`, `1.2` (false both ways).
  - `readUpdate` with `XDG_CONFIG_HOME` in a temporary directory: absent file, broken JSON, wrong shape, good file.
  - `refreshUpdate` against `node:http` on `127.0.0.1`: `200 {"latest":"9.9.9"}` writes the file; `404`, `200 <html>`, a socket that never answers with `timeoutMs: 200`, and a closed port each leave the directory as it was.
  - `registry()`: unset, set, set with a trailing slash.
  - `stale`: absent, fresh, seven hours old, unparseable `checkedAt`.
- `pnpm test` green; `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done 2026-09-18. `packages/server/src/update.ts` with `newer`, `registry`, `readUpdate`, `stale`, `refreshUpdate` and `MAX_AGE_MS`; `updatePath()` in `config.ts`; `test/update.test.ts` with 28 cases at this point (36 after task 02). The comparison table has thirteen rows, two more than the task listed (`1.0.0 > 0.99.99`, two prereleases of one version), to be copied to ahpc as is.

