---
title: Checked in VS Code, and written down
status: done
depends: [task-01-the-view-per-connection.md]
layer: "docs"
refs:
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - the page that says what each connection is told"
  - "[code://.project/working/HANDOFF.md](../../../../.project/working/HANDOFF.md) - check 3, the sign-in prompt"
---

## Objective

VS Code on the deployment's token creates a session on a host with `users` set, and the docs say why that works.

## Files

- `UPDATE: docs/USERS.md` - one paragraph: a root or signed-in connection is told the sign-in is not required.
- `UPDATE: .project/working/HANDOFF.md` - close check 3's sign-in half.
- `CREATE: .project/plans/host/16-an-authorized-connection-is-not-asked-to-sign-in/implemented.md`.

## Steps

1. Run a daemon from the checkout with `users` and an `issuer` that is not running, and the deployment token in the URL.
2. In VS Code, remove and re-add the host, then create a session. Expect no sign-in prompt.
3. Connect with a personal token instead. Expect the prompt, as before.
4. Write the docs paragraph and `implemented.md`, move the plan to `built`, update the index row.

## Validation

- Steps 2 and 3 by hand, with the result written in `implemented.md`.

## Resume

`docs/USERS.md` has the paragraph and `HANDOFF.md` has check 3's sign-in half, as of 2026-09-26.
`implemented.md` and `status: built` are deliberately not written: the plan's tasks are `implemented` and wait on the verifier, per the instruction that asked for that state.
Steps 2 and 3 were not run, because the VS Code client is not on this machine: they are what the verifier still has to do, and the two `required` values they look for are covered by `test/users-host.test.ts` through a real host instead.

