---
title: The daemon answers the door and hands a person their URL
status: done
depends:
  - task-02-a-connection-token-that-resolves-to-a-person.md
layer: packages/server
refs:
  - "[code://packages/server/src/main.ts#L548-L560](../../../../packages/server/src/main.ts#L548-L560) - where `fileUsers` is built inline inside `base`, and where it has to be built once instead so the door can ask it too"
  - "[code://packages/server/src/main.ts#L663-L666](../../../../packages/server/src/main.ts#L663-L666) - the `listen` call, which gains `identify`"
  - "[code://packages/server/src/main.ts#L388-L454](../../../../packages/server/src/main.ts#L388-L454) - the `user` verbs, which gain the URL form"
  - "[code://packages/server/src/main.ts#L680-L686](../../../../packages/server/src/main.ts#L680-L686) - the startup line, which names where the token came from and never the token"
  - "[code://packages/server/src/config.ts#L16-L21](../../../../packages/server/src/config.ts#L16-L21) - the connection-token keys the personal URL is composed from"
---

## Objective

The daemon builds its directory once, hands it to the host and to the listener, so a personal token is answered at the socket exactly as it is at `authenticate`, and `ahpd user token` can print the URL a person pastes into a client instead of a bare secret they have to assemble one from.

## Files

- `UPDATE: packages/server/src/main.ts:548-560` - build `users` once before `base` and use it there, rather than constructing it inline.
- `UPDATE: packages/server/src/main.ts:663-666` - pass `identify: (token) => users?.verify(token)` when a directory is configured.
- `UPDATE: packages/server/src/main.ts:388-454` - `ahpd user token <id> --url` prints `ws://<host>:<port>?tkn=<secret>`; without the flag it prints the secret alone, exactly as it does now.
- `UPDATE: test/daemon.test.ts` - the URL form and the wiring.
- `UPDATE: docs/DAEMON.md` - the `resource` key, and that a personal token is answered at the door.

## Steps

1. Hoist the `fileUsers` construction out of `base` into a `const users` above it, keeping the absent case absent, so both the host and the listener can be handed the same port.
2. Add `identify` to the `listen` options only when `users` exists, so a daemon with no directory passes nothing and behaves as before.
3. In the `user` verb, accept `--url` on `token` and print the composed URL, with the host and port taken from the same resolved options the daemon listens on, and the secret read from the mint rather than from the file.
4. Keep the existing rule that the secret alone goes to stdout and the warning to stderr; with `--url` the warning names the URL form as the one a client pastes.
5. Add a test in `test/daemon.test.ts` that a `user token --url` line parses back into the host, the port and the secret, and that the URL's `tkn` is the secret `authenticate` accepts.

## Validation

- `test/daemon.test.ts` - the URL case in step 5.
- By hand: a daemon with a user file, and a WebSocket client opened at the printed URL that lists sessions with no `authenticate`.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done 2026-09-23.
The daemon builds the directory once and hands the same port to `createHost` and, as `identify`, to `listen`.
`ahpd user token <id> --url` prints `ws://<host>:<port>/?tkn=<secret>`, composed by `personalUrl` in `config.ts` from the configuration's address or from `--host`/`--port` passed to the verb, since the daemon may have been started with either.
Found: the verb runs before the file's later constants, so the composition is a pure exported function rather than a local one, which is what makes it testable without a daemon.
Verified by `test/daemon.test.ts` and by hand end to end: two people connected at their own URLs and only the roles decided what they could do.

