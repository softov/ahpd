---
title: The docs, and a daemon nobody configured
status: done
depends:
  - task-03-one-gate-decides-every-command.md
layer: docs
refs:
  - "[code://docs/AHP.md](../../../../docs/AHP.md) - the compatibility table, whose `authenticate` row and error codes move"
  - "[code://docs/LIBRARY.md](../../../../docs/LIBRARY.md) - `createHost` and its ports, where `users` joins"
  - "[code://README.md](../../../../README.md) - the documentation table a new page joins"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - the shape a standalone operator page takes here, most recently written"
  - "[code://.project/plans/host/00-host.md](../../../../.project/plans/host/00-host.md) - the domain reference this plan updates"
---

## Objective

`docs/USERS.md` says how to turn a directory on, what the three deployment shapes are, and what a client is told when it may not do something.
The compatibility and library docs carry the two error codes and the new port, and the suite proves that a daemon with no user file is the daemon that exists today.

## Files

- `CREATE: docs/USERS.md` - the page.
- `UPDATE: docs/AHP.md` - the `authenticate` row says the host now verifies a credential for its own resource and passes every other through; `-32007` and `-32009` gain rows saying when this host emits them.
- `UPDATE: docs/LIBRARY.md` - `users` in the ports list, with the sentence that leaving it out is the off.
- `UPDATE: README.md` - a `docs/USERS.md` row in the documentation table.
- `UPDATE: .project/plans/host/00-host.md` - whatever the domain reference says about access control.
- `UPDATE: test/users-gate.test.ts` - the unconfigured-daemon case, if it is not already carrying it from task 03.

## Steps

1. Write `docs/USERS.md` with five sections:
   - **Two secrets**, the table of the connection token against the credential: where each is presented, what it answers, how each is revoked, and the sentence that removing a user does not close their socket.
   - **Three shapes**: one person with the connection token alone and no directory, which is the default and unchanged; several people with both; and no connection token at all, where the credential is the only secret and the door is the network's job. Say which is which rather than recommending one, because the right answer is the install's.
   - **Turning it on**: the config key, the four `ahpd user` verbs, and a worked example from `user add` to a client signing in.
   - **Roles**: the six capabilities, the two built-ins, and the file format for a custom one, with a read-only `viewer` as the example.
   - **What a client is told**: `-32007` before signing in and what `data.resources` carries, `-32009` after when the role does not cover it and why it carries no `request`, and the warning that a VS Code window shows a read-only role as a `NoPermissions` dialog with nothing to click, which is correct and is why roles are configuration.
2. Say plainly in the page what is readable without signing in: the agent list, the session count, the root config and any open terminal's title. Link decision 3 for why it cannot be hidden. A reader who is surprised by this later is a reader the page failed.
3. Say plainly that `ahpc` and `ahpapp` do not sign in yet, so a directory is usable only from a client that has learned the flow. Do not describe a flow that does not exist.
4. Move the `docs/AHP.md` rows and the `docs/LIBRARY.md` port.
5. Run `pnpm test`, `pnpm typecheck`, `pnpm boundary` and `pnpm build`.

## Validation

- The unconfigured daemon is asserted, not assumed: a host built with no `users` serves every gated method, advertises no extra resource, and every existing suite is green and unmodified.
- By hand, against the real daemon binary: start it with a user file and a connection token; a client that signs in with a good token lists sessions; the same client before signing in gets `-32007` carrying the login record; a `viewer` gets `-32009` with no `request` on a write; `ahpd user rm` stops the next command working while the socket stays open, which is the asymmetry the page describes.
- By hand: the same binary with no user file, doing everything it does today.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- Every relative link in `docs/USERS.md` resolves.

## Resume


Done 2026-09-23, as written. See [implemented.md](implemented.md).
