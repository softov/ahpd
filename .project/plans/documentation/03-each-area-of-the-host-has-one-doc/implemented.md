---
title: Each area of the host has one doc - implemented
date: 2026-10-08
refs:
  - "[code://docs/README.md](../../../../docs/README.md)"
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md)"
  - "[code://docs/USERS.md](../../../../docs/USERS.md)"
  - "[code://.project/plans/documentation/00-documentation.md](../00-documentation.md)"
---

Nine areas of the host have a document of their own where DAEMON.md and USERS.md carried everything between them, and `docs/README.md` says what each file in `docs/` covers. DAEMON.md went from 1043 lines to 807 and USERS.md from 683 to 414, and a section that left either one left a heading with one line and a link where it was, so a link into it still lands. Nothing is committed: Softov reads the diff first.

## What was built

- [`code://docs/AUTHENTICATION.md`](../../../../docs/AUTHENTICATION.md) - 285 lines. The door, the connection token in its three shapes, `authenticate`, the issuer and `authorization_servers`, trusted folders, and what a connection may read before signing in.
- [`code://docs/HOST.md`](../../../../docs/HOST.md) - 169 lines. The host and its root channel, what it announces, the nineteen configuration keys with what each option changes, and root config's live-versus-restart split.
- [`code://docs/AUTOMATIONS.md`](../../../../docs/AUTOMATIONS.md) - 231 lines. What an automation is, the three trigger kinds with the cron rules, the five `watch` presets, runs, the overlap modes and the wake placeholders.
- [`code://docs/SESSIONS.md`](../../../../docs/SESSIONS.md) - 136 lines. What a session is, its life from `createSession` to `disposeSession`, the status bitset, the catalogue paging, its keys and its grants.
- [`code://docs/CHATS.md`](../../../../docs/CHATS.md) - 108 lines. One conversation inside a session: turns, senders, endings, forks, compaction, attachments and worker chats.
- [`code://docs/TERMINALS.md`](../../../../docs/TERMINALS.md) - 130 lines. Where a terminal runs, pipes against a pseudoterminal, the three ways in, command boundaries and its grants.
- [`code://docs/TOOLS.md`](../../../../docs/TOOLS.md) - 155 lines. The four sources of a tool, `mcpServers` field by field, advanced permission, and the four things that shape a tool per session.
- [`code://docs/RESOURCES.md`](../../../../docs/RESOURCES.md) - 116 lines. What a resource is, the eleven `resource*` methods and their refusal codes, how a scheme comes to be served, the watch and the grants.
- [`code://docs/USAGE.md`](../../../../docs/USAGE.md) - 93 lines. The two record kinds, the two costs and the split, the pools, the four `usage://` URIs and the `usage.per` and `usage.timezone` keys.
- [`code://docs/README.md`](../../../../docs/README.md) - 28 lines: the index, one row for each of the twenty files in `docs/`.
- [`code://docs/DAEMON.md`](../../../../docs/DAEMON.md) - "Who may connect", "Automations" and the per-key prose of "Configuration" left it, and its `--unowned-automations` and `--sessions` rows and `## Automations` stub now link the area docs.
- [`code://docs/USERS.md`](../../../../docs/USERS.md) - "The door and the authorization", "An issuer, when a client needs one", "Trusted folders" and "What is readable before signing in" left it, and its two resource sections gained one line each linking RESOURCES.md.
- [`code://docs/AHP.md`](../../../../docs/AHP.md) - three links, so its "Behaviour worth knowing" sends a reader to the area doc for what a thing is and keeps its rows as wire rows.
- [`code://.project/plans/documentation/00-documentation.md`](../00-documentation.md) - its opening said "four documents with one job each" and its Contracts named four; both now name every file.
- [`code://README.md`](../../../../README.md) - the Documentation section points at `docs/README.md`.

## Verified

- Every claim in the nine new docs was read against the file it names, by hand, and the ones the code contradicted are under Departures.
- `rg -n "DAEMON.md#|USERS.md#|AHP.md#" .` resolves: every anchor that remains points at a heading that exists, and each heading the new docs link (`USERS.md#roles`, `AHP.md#commands`, `AHP.md#server-to-client-commands`, `AHP.md#authentication`, `AHP.md#root--4-of-4`, `AHP.md#session--28-of-28`, `AHP.md#chat--29-of-30`, `AHP.md#terminal--11-of-11`, `AHP.md#automation--4-of-4`, `HOST.md#configuration-keys`, `HOST.md#root-config`, `PLUGINS.md#what-you-can-register`, `LIBRARY.md#terminals`, `LIBRARY.md#the-tools`) was checked against the heading it names.
- `docs/README.md` has twenty rows and `docs/` holds twenty files; every link in it resolves (`../README.md`, `../REFERENCE.md`, `../.project/decisions/` all exist).
- No em dash appears in any doc written here, and every paragraph is one line.
- Nothing was committed, so there is no `git://` ref: Softov reads the diff first.

## Departures from the plan

- None of the tasks named a code change, and none was made. Where the code and a document disagreed, the document moved to the code.
- The plan's task 05 expected the area's decisions to be found by their `code://` refs. `rg -ln "code://packages/sdk/src/usage.ts|code://packages/sdk/src/host/resourcemethods.ts" .project/decisions/` finds nothing, so RESOURCES.md's two decisions came from the wider sweep over `resources.ts` and the rest of the set from the decisions' own titles.
- Task 06's Files named `README.md` for a link only. Its Documentation shortlist claimed `docs/COMPUTER.md` covers "Docker and KVM", and the code has one runtime, so that row was corrected to "(Docker)" in the same change.
- `docs/AHP.md`'s two rows that contradict the code are left as they are, because no task's Files cover that file's rows, and editing a wire row was not this plan's work.

## Left for later

- `docs/AHP.md`'s `automationRun/cancelRequested` row is ✅ with the note "A request the store answers, because only it knows whether the run has got far enough to be stopped", and `packages/sdk/src/host/actions.ts:484-487` refuses it outright: `no('A run here is a session, and disposing it is how it stops')`.
- `docs/AHP.md`'s `createTerminal` row says "Opens in a directory this host serves", and `createTerminal` takes the path as given; `packages/sdk/test/host-terminals.test.ts:439` opens one in `file:///etc` and expects it to resolve. The comment at `packages/sdk/src/host/terminals.ts:249-257` makes the same claim about a check the function does not make.
- `TitleStrategy` carries `activeAgent`, `utility` and `deferred` (`packages/sdk/src/types/host.ts:491`), and `strategyOf` here returns only the first and the last (`packages/sdk/src/host/tooling.ts:107-108`). TOOLS.md says so; the type is untouched.
- `.project/plans/**` cites USERS.md and DAEMON.md by `#L<n>` anchors in twelve places. None points into a moved section, and every anchor below one now names a different line.
