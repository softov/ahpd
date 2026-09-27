---
title: The API's tests prove what their tasks' Validation says
status: done
depends: [task-08-served-commands-act-on-the-daemons-own-options.md, task-10-an-unconfigured-daemon-refuses-http.md, task-12-http-host.md, task-13-remote-needs-a-token-and-proves-it-is-remote.md]
layer: "server"
refs:
  - "[code://packages/server/test/server-http.test.ts#L366-L382](../../../../packages/server/test/server-http.test.ts#L366-L382) - the `http.host` case, which checks the bind as well as the announcement"
  - "[code://packages/server/test/server-http.test.ts#L330-L349](../../../../packages/server/test/server-http.test.ts#L330-L349) - the unconfigured-daemon cases; the `--without-connection-token` one asserts the sentence"
  - "[code://packages/server/test/server-http.test.ts#L565-L658](../../../../packages/server/test/server-http.test.ts#L565-L658) - the served-options cases; the hostile plugin list names the daemon's own plugin and neither query name"
  - "[code://packages/server/src/commands/registry.ts#L67-L75](../../../../packages/server/src/commands/registry.ts#L67-L75) - `remoteCache`, which chmods the directory it ensures"
---

## Objective

Each case named here fails when the behaviour its task promised breaks, and the `--remote` cache is owner-only even when the directory was already there.

## Files

- `UPDATE: packages/server/test/server-http.test.ts` - the four cases below.
- `UPDATE: packages/server/test/server-cli.test.ts` - the `--remote` cache case, if it lives there.
- `UPDATE: packages/server/src/commands/registry.ts:67-75` - the cache directory's mode.

## Steps

1. Task 12's case: assert where the API's socket is bound, from the listener's `address()` exposed to the test or by a connect to the non-loopback address of the machine being refused; the announcement alone comes from the same variable as the bind.
2. Task 10's `--without-connection-token` case asserts the sentence on stderr, not only exit 2.
3. Task 13: assert nothing is written under `tmpdir()/ahpd-remote`, beside the check that the cache directory was not created.
4. Task 08's hostile plugin-list case asserts the answer lists the daemon's own plugins and not the ones the query names.
5. `remoteCache`: `chmodSync(at, 0o700)` after `mkdirSync`, and make it only when `--remote` is used, not every time the function is called.

## Validation

- With `listenApi` made to bind `0.0.0.0` in place of `http.host`, task 12's case fails. Revert.
- With the sentence changed, task 10's case fails. Revert.
- With the served `plugin list` made to read the query's `plugins`, task 08's case fails. Revert.
- A case with `XDG_CACHE_HOME/ahpd/remote` created 0755 beforehand finds it 0700 after one `--remote` run.
- `node_modules/.bin/vitest run packages/server/test` green.

## Resume

Seen to fail first: the new "tightens a cache directory that was already there" case found the directory 0755 where it wanted 0700. The rest are mutation checks, each break made and put back: with `listenApi` binding `0.0.0.0` in place of `http.host`, the bind case failed, because an address this machine has answered (403) where the case wants the connection refused; with the refusal sentence changed, the `--without-connection-token` case failed; with the served `plugin list` given the command's fields and reading the request, the query case answered 400 where it wanted 200.

Done: the `http.host` case checks the bind from outside as well, by connecting to an address this machine has and the daemon does not answer on; the `--without-connection-token` case asserts the sentence `http needs a credential: pass --connection-token, --connection-token-file or --users.`; the served `plugin list` case asserts the answer names `plugin-echo` and neither `x` nor `y`; the cache cases check 0700 even when the directory was already there and that nothing appears under the run's own `TMPDIR`, which is a fresh directory rather than this machine's, whose old shared path is a leftover from the code that wrote one; `remoteCache` chmods the directory it ensures.

Step 5's second half was already true: `remoteCache` has one caller, `remoteRegistry`, and `main.ts` reaches that only when `--remote` is given.
