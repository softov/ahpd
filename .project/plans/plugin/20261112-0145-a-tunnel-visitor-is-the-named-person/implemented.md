---
title: A tunnel visitor is the person the tunnel names - implemented
date: 2026-11-11
refs:
  - "[code://packages/sdk/src/plugins/plugins.ts](../../../../packages/sdk/src/plugins/plugins.ts)"
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts)"
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts)"
  - "[code://packages/tunnel-devtunnel/src/forward.ts](../../../../packages/tunnel-devtunnel/src/forward.ts)"
  - "[code://packages/tunnel-devtunnel/src/service.ts](../../../../packages/tunnel-devtunnel/src/service.ts)"
  - "[code://packages/tunnel-devtunnel/src/kind.ts](../../../../packages/tunnel-devtunnel/src/kind.ts)"
---

A tunnel visitor who presents the tunnel's derived token is now the person the record names.
No process listens on 31546 for the tunnel: the relay hands each connection to the daemon's process, which rewrites the request and carries it to the daemon over a loopback dial.
A host with users and a tunnel that names nobody refuses that token and says so on the tunnel's row, and a tunnel naming a person who requires the issuer is not started.
All five tasks are implemented, uncommitted, in the worktree.

## What was built

- Task-01, `packages/sdk/src/plugins/plugins.ts`, `packages/sdk/src/types/plugin.ts`, `packages/sdk/src/types/users.ts`, `packages/sdk/src/access/users.ts`, `packages/server/src/plugins.ts`, `packages/server/src/commands/run.ts`: `PluginHost.personKey(person)` answers a key made with `randomBytes(32)` from a map kept in memory per plugin, or nothing on a host with no users or for a person whose record requires the issuer. The daemon's `identify` reads a held key before the directory and answers the person's `Principal`; a plugin's keys go when it unloads. `packages/server/test/plugin-person-key.test.ts` and its fixture cover it, comparing keys by reference only.
- Task-02, `packages/tunnel-devtunnel/src/kind.ts`, `src/plugin.ts`, `package.json`, `README.md`: the kind's schema gains `person` as `^user:.+$`, `start` reads it into the running entry, the system tunnel takes it from the plugin's options, and a malformed one is refused at the start.
- Task-03, `packages/tunnel-devtunnel/src/service.ts`, `src/forward.ts`, `src/kind.ts`, `src/plugin.ts`, `src/index.ts`: the relay host runs with `forwardConnectionsToLocalPorts` off and hands each `forwardedPortConnecting` stream to the kind. `carry` reads the stream's first request, answers 401 for the derived token on a host with users and no person (with the alert), sets the person's key or the daemon's token on the loopback dial for the ones the record admits, and `pipeTo` carries every other port unchanged. The listener and the `Forward` type are gone.
- Task-03 tests, `packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts`: seven stream cases over a stand-in `Duplex`, and `carry` added to every fake `Service` in the two other test files.
- Task-04, `packages/tunnel-devtunnel/README.md` and `docs/updates/v0_15.md`: the settings, the visitor cases, the end of the hop's port text, and one line in the release notes. The docs page `docs/plugins/tunnel-devtunnel.md` is an include of the README from its line 2 on, so it renders the change as it is.
- Task-05, `packages/tunnel-devtunnel/src/kind.ts`, `src/plugin.ts`, `package.json`, `README.md`: a record's `requireToken` (off by default) makes the hop answer `keep` for every request before the derived-token check, so nothing is swapped on any host and a visitor brings a token the daemon accepts. The system tunnel takes the option, a saved change applies on the next request without moving the port, and the README has the setting and the fourth visitor case. `packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` has five cases and `packages/server/test/plugin-load.test.ts` expects the seventh option key.

## Verified

- `pnpm exec tsc -p tsconfig.json --noEmit` at the repository root passes at the end of each task, and once more over the final tree.
- `pnpm exec vitest run packages/tunnel-devtunnel`: 5 files, 75 tests pass.
- `pnpm exec vitest run packages/server`: 95 files, 1878 tests pass and 3 are skipped.
- The docs were read against task-03's behaviour case by case.
- In review, `pnpm typecheck` passes, `packages/sdk` passes 4753 tests (5 skipped) in 237 files, `packages/tunnel-devtunnel` 75 tests in 5 files, and `packages/server` 1878 tests (3 skipped) in 95 files.
- In review, the README no longer says the derived token is safe because only signed-in people reach the tunnel; an anonymous tunnel lets anyone reach it.
- Not checked: `ss -ltnp` on a running system tunnel, since no daemon was started and no tunnel was opened.

## The review's four failures

- `packages/server/test/plugin-load.test.ts` - the first-party options list for `tunnel-devtunnel` was missing `person`, which `package.json` now declares. The test's list gained it; the plugin is right.
- `packages/tunnel-devtunnel/test/tunnel-devtunnel-view.test.ts` - "starts no poll when the tunnel stops during its first read" advanced the fake clock once and assumed the first read had begun. `start` now digests the tunnel id to store the derived token, which is a turn of the event loop, so the test waits for the read instead of assuming it. The code is right.
- `packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` - "carries a visitor with the derived token" expected the answer to be the bare body. A carried stream is bytes both ways, so the visitor receives the daemon's status line and headers too, as the old hop's HTTP forwarder also gave them. The test now reads the body after the blank line; the check that the daemon was asked with the person's key is unchanged. The code is right.
- `packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` - "leaves a port other than the well-known one to the service" created its first record and the system tunnel with the same id, so the kind's "this record is already up" answer left the second start with nothing to do. The first record now has an id of its own. The code is right.

## A person who requires the issuer

Softov settled this on 2026-11-12, and the Answers table carries it: a person whose record requires the issuer cannot be a tunnel's person.

- `packages/server/src/plugins.ts`: `mintPersonKey` looks the person up in `users.list()` and answers nothing when the record's `trusted` is false, which is what a record that requires the issuer reports. An id the directory does not have is still refused by name.
- `packages/tunnel-devtunnel/src/kind.ts`: `hopFor` refuses a person on a host with users when `personKey` answers nothing, before a handler is registered or the port is added, so the tunnel does not start and no visitor is ever refused by it. The error reads "This tunnel names `user:<id>`, who must sign in through the issuer, so a key cannot stand in for that sign-in. The tunnel needs another person." A `start` reports it as the record's error and the system tunnel's row raises it as an alert. The person-only `update` path does the same, so a saved change to such a person does not leave the tunnel admitting on the old key.
- Tests: `packages/server/test/plugin-person-key.test.ts` gains a case with a `requireIssuer` record, and the fixture loads with no key left behind. `packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` gains a case where the start reports the error, the alert carries the same text, no handler is registered and the daemon is never reached.
- The SDK's `personKey` doc says the same thing, and the tunnel plugin's README says a person requiring the issuer cannot be named.

## One tunnel, on 31546

Softov settled the docs on 2026-11-12, and the Answers table carries the row: the guide teaches one tunnel, on 31546, with `person` or `requireToken`.

- `packages/tunnel-devtunnel/README.md`: the Options example is one tunnel naming a person, and "The tunnel kind" opens with the system tunnel on 31546 and the three ways in. `person` set, VS Code connects and every visitor who presents the derived token gets that person's grants; `requireToken` on, a visitor brings `?tkn=<token>` and VS Code cannot connect; a host with users and neither set refuses the derived token and only a person's own token gets in.
- The four visitor cases moved out of "The connection token", which keeps the token mechanics and points at the kind section.
- One paragraph says a tunnel on another port forwards it as it is, with no token mapping, and that an anonymous tunnel to a port with no sign-in of its own is open to anyone with the URL. It is said once.
- The record example with the daemon's own port is gone, so the page does not invite a second tunnel.

## Departures from the plan

- Task-01: `Users.principalOf?(id)` is new in the SDK, beyond the task's Files list, so `identify` can answer a `Principal` from the users directory rather than from `list()`.
- Task-02: a record whose `person` is present and malformed is refused at its start as well as by the schema.
- Task-03: the hop exists whatever port the daemon is on, including 31546, so a derived token is always mapped rather than passed through. The line saying the tunnel token now depends on the daemon being guarded and the plugin not having been handed its token, not on the hop being absent.
- Task-03: an update that changes only a running tunnel's person mints the new key and applies it live, and fails closed when no key can be minted. The plan did not specify this.
- Task-03: only a stream's first request is decided. A second request on the same keep-alive stream is carried as it came, and the daemon decides its token; the clients that present the derived token are WebSocket upgrades, one request per stream.
- Task-04: the page is an include, so its text lives in the package's README and the page file itself did not change.
- Task-05: `src/plugin.ts`, `package.json` and `packages/server/test/plugin-load.test.ts` are beyond the task's Files list. The system tunnel cannot take the option without the first two, and the third lists the options the package declares.
- Task-05: a tunnel that requires a token and also names a person whose record requires the issuer still does not start. The issuer row of the Answers table is unconditional, and the key is minted before the setting is read.

## Left for later

- The sdk suite, and the final verification checklist's boxes, for the reviewer.
- A by-hand check of `ss -ltnp` with the system tunnel up and the daemon on another port.
