---
title: Telling somebody the version is old
domain: daemon
status: planned
priority: medium
created: 2026-09-18
revalidated: 2026-09-18
requires: []
changes: []
creates: []
decisions:
  - decisions/update-check-reads-dist-tags.md
  - decisions/update-check-is-a-file-refreshed-in-the-background.md
  - decisions/update-check-compares-versions-by-hand.md
  - decisions/update-check-fails-silently.md
  - decisions/ahpd-and-ahpc-share-no-package.md
refs:
  - git://165020b - ROADMAP.md "Telling somebody the version is old" as written on 2026-09-06, the prose this plan starts from
  - code://.project/ideas/deliberate-duplication.md - the idea that makes `update.ts` a second copy
  - code://packages/server/src/config.ts#L8-L35 - `Config`, which gains `updateCheck?: boolean`
  - code://packages/server/src/config.ts#L55-L90 - `daemonPath()`, `automationsPath()`, `sessionsPath()`, the pattern for a machine-written file beside the configuration
  - code://packages/server/src/config.ts#L44-L45 - `configHome()`, which reads `XDG_CONFIG_HOME` first; tests point it at a temporary directory
  - code://packages/server/src/version.ts#L20-L34 - `version()`, the current version, `unknown` when there is no manifest
  - code://packages/server/src/daemon.ts#L8-L18 - `Running`, the record `status` reads; the notice is not stored in it
  - code://packages/server/src/daemon.ts#L41-L54 - `running()`, the file-read-and-say pattern the `status` verb follows
  - code://packages/server/src/main.ts#L142-L168 - the flag switch, where `--no-update-check` goes
  - code://packages/server/src/main.ts#L265-L293 - the `start` and `status` verbs, which print and leave
  - code://packages/server/src/main.ts#L310-L313 - `--version`, which prints and leaves and must never fetch
  - code://packages/server/src/main.ts#L451-L460 - the daemon's startup lines, where the notice is one more line
  - code://packages/sdk/src/github.ts#L41 - a `fetch` in this repository, for the shape of a request
  - code://packages/agent-claude/src/mcp.ts#L69 - a `fetch` with `AbortSignal.timeout`, the pattern for a bounded request
  - code://docs/DAEMON.md - the CLI, the configuration keys and the runtimes; gains the flag, the key and the environment variables
  - https://registry.npmjs.org/-/package/@ahpd/server/dist-tags - the endpoint; `{"latest":"0.5.0"}` on 2026-09-18
---

## Goal

A person running an old `@ahpd/server` finds out from the daemon itself, on its startup line and from `ahpd status`, without the daemon ever waiting on the network to start.
The check is off with a flag, an environment variable or a configuration key, honours a registry mirror, and says nothing at all when it cannot answer.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "dist-tags|update-check|updateCheck|NO_UPDATE_NOTIFIER" packages/` - nothing; the check does not exist in any form.
- `rg -n "fetch\(" packages/*/src` - four calls, none in `packages/server`; `agent-claude/src/mcp.ts#L69` is the one with a timeout.
- `rg -n "process.env\." packages/server/src` - only `XDG_CONFIG_HOME`; no environment gate exists to copy.
- `rg -n "unref\(" packages/*/src` - no timer in the daemon is unref'ed today; the listener is what holds the process open.
- `rg -n "daemonPath|sessionsPath|automationsPath" packages/server/src` - three machine-written files beside `config.json`, each with a comment saying why it is not inside it.

### Runtime path

```
ahpd (foreground) -> gates: --no-update-check | NO_UPDATE_NOTIFIER | CI | updateCheck:false
  -> readUpdate() from ~/.config/ahpd/update.json -> newer(latest, version())?
  -> one more startup line: `update: @ahpd/server 0.6.0 is on npm, this is 0.5.0`
  -> if the file is missing or older than 6h: refresh now; then every 6h, unref'ed
  -> refresh: GET <registry>/-/package/@ahpd/server/dist-tags, 5s timeout
     -> 200 with { latest: string }: write update.json; anything else: nothing
ahpd start  -> readUpdate() -> the same line after the daemon's, no fetch
ahpd status -> readUpdate() -> the same line after `sessions in ...`, no fetch
ahpd --version -> untouched
```

### Gaps

- No `update.ts`: the fetch, the file, the comparison and the gates are all new.
- No `updateCheck` key in `Config`, no `--no-update-check` flag, no environment variable read for it.
- No test starts the daemon as a process, so the startup line is checked by hand; the module is tested directly.
- `Not found: a fixture shared with ahpc for the version comparison - searched "fixtures" in test/; only resource-write.json exists.` The comparison table is written in both repositories' test files instead, in the same order, until a divergence makes a fixture worth its CI step.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [The update check reads npm's dist-tags endpoint and nothing larger](../../../decisions/update-check-reads-dist-tags.md) | Softov, ROADMAP.md, 2026-09-06 |
| 2 | [The answer is read from a file, and only the long-lived process refreshes it](../../../decisions/update-check-is-a-file-refreshed-in-the-background.md) | Softov, ROADMAP.md, 2026-09-06 |
| 3 | [Versions are compared by a function written here, not by a semver package](../../../decisions/update-check-compares-versions-by-hand.md) | Softov, ROADMAP.md, 2026-09-06 |
| 4 | [Every failure of the update check is nothing to report](../../../decisions/update-check-fails-silently.md) | Softov, ROADMAP.md, 2026-09-06 |
| 5 | [ahpd and ahpc share no package, and carry deliberate copies instead](../../../decisions/ahpd-and-ahpc-share-no-package.md) | Softov, ROADMAP.md "Deliberate duplication", 2026-09-06 |

| What | Source | Task |
| --- | --- | --- |
| Off with `--no-update-check`, or `NO_UPDATE_NOTIFIER` or `CI` set to anything, or `updateCheck: false` in `config.json` | ROADMAP.md at 165020b | 01, 02 |
| `npm_config_registry` is the registry when set, trailing slash removed; `https://registry.npmjs.org` otherwise | ROADMAP.md at 165020b | 01 |
| The file is `update.json` in the configuration directory, `{ name, latest, checkedAt }` | ROADMAP.md at 165020b; the shape Softov, 2026-09-18 | 01 |
| Six hours between refreshes, measured from `checkedAt` | ROADMAP.md at 165020b | 02 |
| The request times out after five seconds | Softov, 2026-09-18 | 01 |
| The line reads `update: @ahpd/server <latest> is on npm, this is <current>`; the package name so `npm i -g` can be typed from it, no advice | Softov, 2026-09-18 | 02 |
| Only the daemon fetches; `start`, `status` and `--version` read the file or nothing | ROADMAP.md at 165020b | 02 |
| The line appears only when something is newer; nothing is said when the version is current or unknown | Softov, 2026-09-18 | 02 |
| The daemon writes no log line when it refreshes `update.json`; `checkedAt` is the record | Softov, 2026-09-18 | 02 |

## Proposed architecture

- **Data flow** - `update.ts` owns three things: `newer(latest, current)`, `readUpdate()` from the file, and `refreshUpdate({ name, registry, at })` which fetches and writes. `main.ts` decides whether the check is on and calls them; nothing else imports `update.ts`.
- **Event flow** - the daemon calls `refreshUpdate` once at start when stale and on a six-hour `setInterval` that is `unref()`ed. Nothing awaits it. Nothing is emitted; the next reader of the file sees the result.
- **State flow** - `update.json` is the only state, written whole on each successful fetch. There is no in-memory copy: the startup line reads the file once, before the first refresh, so a fresh install says nothing on its first run.
- **Layer responsibilities** - `packages/server/src/update.ts`: the check · `packages/server/src/config.ts`: `updatePath()` and the `updateCheck` key · `packages/server/src/main.ts`: the gates, the flag, the lines · `docs/DAEMON.md`: what a person reads.
- **Source-of-truth files** - `code://packages/server/src/update.ts`, `code://packages/server/src/config.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The update module](task-01-update-module.md) | todo | - |
| [02 - The daemon checks, the verbs read](task-02-daemon-and-verbs.md) | todo | 01 |
| [03 - Docs and the roadmap](task-03-docs.md) | todo | 02 |

## Risks and tradeoffs

- A test that fetches from a real registry is a test that fails offline. The test serves `dist-tags` from a `node:http` server on `127.0.0.1` and points `npm_config_registry` at it.
- `fetch` on Node 22 is global and needs no import; on Bun and Deno it is the same global, so `update.ts` imports nothing for it. The timer's `unref()` exists on all three.
- The `start` verb reads the daemon's announced lines with regular expressions (`daemon.ts#L132`); the new line is its own line and matches neither.
- A registry that answers `200` with HTML (a captive portal) fails JSON parsing and is silence, which is right.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-update-module.md](task-01-update-module.md).
- **Open questions:** none.
- **Watch out for:** `version()` answers `unknown` from a bundled build; `newer()` must treat it as not newer rather than throw. Do not await the refresh anywhere on the start path.

## Final verification checklist

- [ ] `pnpm test` green, with `test/update.test.ts` in it.
- [ ] `pnpm boundary` and `pnpm typecheck` green.
- [ ] By hand: a daemon started with `npm_config_registry` at a fake server that answers `9.9.9` prints the line on its second start and `ahpd status` repeats it.
- [ ] By hand: `CI=1 ahpd` prints no line and writes no file.
- [ ] `docs/DAEMON.md` names the flag, the key and both environment variables.
- [ ] `plans/index.md` updated.
