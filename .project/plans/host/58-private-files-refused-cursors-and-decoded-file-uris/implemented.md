---
title: Policy and automation files are private, a cursor the host did not issue is refused, and a file URI is decoded - implemented
date: 2026-10-06
refs:
  - "[code://packages/sdk/src/policies.ts](../../../../packages/sdk/src/policies.ts)"
  - "[code://packages/sdk/src/scheduled.ts](../../../../packages/sdk/src/scheduled.ts)"
  - "[code://packages/sdk/src/users.ts](../../../../packages/sdk/src/users.ts)"
  - "[code://packages/sdk/src/fileuri.ts](../../../../packages/sdk/src/fileuri.ts)"
  - "[code://packages/sdk/src/automations.ts](../../../../packages/sdk/src/automations.ts)"
  - "[code://packages/sdk/src/host/automations.ts](../../../../packages/sdk/src/host/automations.ts)"
  - "[code://packages/sdk/src/policy.ts](../../../../packages/sdk/src/policy.ts)"
  - "[code://packages/computer/src/provider.ts](../../../../packages/computer/src/provider.ts)"
---

The policy and automation files are written owner-only, the user file's temp name is its writer's own, `fetchAutomationRuns` refuses a cursor this host did not issue with `-32602 Unrecognised cursor`, every `file:` URI the host reads is percent-decoded, and people, policy, usage and computer refuse a URI they cannot split with `-32602`. What a URI is *written* with was not this plan's: `uriOf`'s callers in the sdk and in the four agents were still `` `file://${path}` `` when this was built, and the plan that makes every one of them `uriOf` is host/65 p3.

## What was built

- [`code://packages/sdk/src/policies.ts`](../../../../packages/sdk/src/policies.ts) and [`code://packages/sdk/src/scheduled.ts`](../../../../packages/sdk/src/scheduled.ts) - both temp writes pass `{ mode: 0o600 }`, so the rename leaves `policies.json` and `automations.json` owner-only from the first save, as every other file the daemon keeps already was.
- [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts) - the temp name is `${path}.${pid}.tmp`, the form the daemon's sweeper in `daemon.ts` knows, so a writer's scratch is its own rather than one name every writer shares. The case beside it is what that buys: a directory sits at the old shared name `${path}.tmp` and the write lands anyway.
- [`code://packages/sdk/src/types/automations.ts`](../../../../packages/sdk/src/types/automations.ts), [`code://packages/sdk/src/automations.ts`](../../../../packages/sdk/src/automations.ts) and [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts) - `runs` answers `{ items; nextCursor? } | undefined`, `undefined` for a cursor that is not `/^\d+$/`, is 0, or is at or past the end of the history; an omitted cursor is the newest page as before. `fetchAutomationRuns` turns that `undefined` into `-32602 Unrecognised cursor <cursor>`, mirroring `older` and `fetchTurns`.
- [`code://packages/sdk/src/fileuri.ts`](../../../../packages/sdk/src/fileuri.ts) - new: `localPath(uri)` percent-decodes and never throws, dropping an authority (`file://host/a` is `/a` on this machine), and `uriOf(path)` encodes with `pathToFileURL`.
- [`code://packages/sdk/src/fileuri.ts`](../../../../packages/sdk/src/fileuri.ts) - the authority comes off first and the path then goes through the one reader both shapes share (Softov's review, 2026-10-06), so an encoded slash or a `%00` is never decoded - `%2F` is a slash in a name and not a step up, and a NUL is not a path - and `file://` with nothing after the scheme still names no path rather than the root.
- [`code://packages/sdk/src/resources.ts`](../../../../packages/sdk/src/resources.ts) - `uriOf` now comes from `fileuri.ts`; `pathOf` stays the file store's own, because it throws and is what a `file:` read is refused through.
- The 15 `.replace(/^file:\/\//, '')` strips, the two `.replace(/^file:\/\/[^/]*/, '')` strips and the two by-slice strips are gone, replaced by `localPath`: `host/sessionmethods.ts` (five), `host/chatactions.ts` (three), `host/lifecycle.ts`, `host/tooling.ts`, `host/vscodemethods.ts`, `host/terminals.ts`, `host/changesets.ts`, `host/facts.ts`, `debuglogs.ts` (whose hand-written `asPath` is deleted), `sessiontools.ts` (two, one of which keeps lowercasing for a comparison after decoding) and `automations.ts` (the automation's working directory).
- `host/channels.ts` - the unencoded `uriOf` (`file://${path}`) is deleted; its one caller, the `@` completion's attachment URI, uses the sdk's.
- [`code://packages/sdk/src/terminals.ts`](../../../../packages/sdk/src/terminals.ts) - the OSC 7 handler reads the directory with `localPath` and emits `cwd` as `uriOf(path)`, so a shell's `cwdChanged` carries the encoded URI the rest of the host speaks.
- [`code://packages/sdk/src/policy.ts`](../../../../packages/sdk/src/policy.ts), [`code://packages/sdk/src/people.ts`](../../../../packages/sdk/src/people.ts), [`code://packages/sdk/src/usage.ts`](../../../../packages/sdk/src/usage.ts) and [`code://packages/computer/src/provider.ts`](../../../../packages/computer/src/provider.ts) - a URI a provider cannot split is `-32602`, not `-32609` (which no specification defines) and not `-32009` (which says the caller is not permitted). Every refusal's sentence is unchanged.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm boundary` clean (8 packages, none undeclared), `pnpm test` 217 files and 3076 tests passed, `pnpm build` clean.
- `policies.test.ts`, `scheduled.test.ts`: a saved file's mode is `0o600`. `users.test.ts`: a write lands with a directory at the old shared temp name, and the scratch name carries the pid. Each was seen failing first (the mode read `0o664`, the shared scratch name gave `EISDIR`).
- `automations.test.ts`: `cursor: "x"`, `"-1"` and `"999"` against three runs each answer `-32602 Unrecognised cursor` - seen failing first, when each answered the newest page - and a history of `PAGE + 1` runs pages twice with the issued cursor.
- `fileuri.test.ts` (new, 8 cases): a `%20` decodes, a `%` that is not an escape is kept as text, an authority is dropped, a non-`file:` string is handed back, and `uriOf` encodes.
- `fileuri.test.ts`: `file:///work/..%2F..%2Fetc/passwd` and `file://x/work/..%2F..%2Fetc/passwd` both keep `%2F` with no `..` segment from decoding, and `file:///work/a%00b` and `file://x/work/a%00b` both answer `/work/a%00b`; seen failing first on `/work/../../etc/passwd` and a decoded NUL.
- `host-files.test.ts`: a client's attachment URI for a folder with a space is the encoded one. `pty.test.ts`: an OSC 7 with an encoded path and a host part arrives as the decoded `cwd`, re-emitted encoded. `sessiontools.test.ts`: a session folder named with a space matches its `file://` URI after decoding.
- `people.test.ts`, `policy-scheme.test.ts`, `usage-scheme.test.ts`: the three pinned refusals are `-32602`, seen failing on `-32609` and `-32009` first. `policy-scheme.test.ts` also has a host-level case: a role holding `policy:read`, asking the host for `policy:M1` (no `//`), is answered `-32602` by the provider rather than `-32009` by the gate. `computer.test.ts`: `read`, `list` and `resolve` of `usage://x` answer `-32602`, seen failing on `-32009`.
- `rg -n "32609" packages` finds nothing, `rg -nF "replace(/^file:" packages/sdk/src` finds nothing, and `host/channels.ts` has no `uriOf`.

## Departures from the plan

- The OSC 7 case is in `pty.test.ts`, not `host-terminals.test.ts` as the task wrote it. `terminals.ts` reads OSC marks only when a pseudoterminal is in use - `marked` is wired inside `if (terminal !== undefined)`, because only a real shell prints them - so the pipe-based `host-terminals.test.ts` cannot reach the code. `pty.test.ts` has the `fakePty()` helper and an existing OSC 7 case, and the new one sits there.
- `policy-checks.test.ts` and `users-gate-sessions.test.ts` read `store.runs(resource).items[0]`, which task 03's optional answer made a type error. Both now use `!`, as the run was made a line above; no assertion changed.
- `pnpm install` in this fresh worktree failed on the global pnpm shim (`@pnpm/exe` not found), so every command here ran as `npx --yes pnpm@11.21.0 <script>`. The shim recovered partway through and plain `pnpm` worked for the gates' second run.

## Left for later

- The agents' own `file://${path}` builders (about 20 in `agent-*/src`) still do not encode; Softov's answer was a later plan, after host 59 raises their peer range. Until then a folder whose real name holds `%20` is read back with a space.
- Host 43 p2 rewrites `runs` so a page arrives on `automation/set`; task 03 here is the fix in the meantime and 43 p2 keeps its own refusal.
- `tail` and `older` page turns backwards and are untouched; a shared forward pager for `listSessions` and runs is the survey's item 9 and not this plan.
