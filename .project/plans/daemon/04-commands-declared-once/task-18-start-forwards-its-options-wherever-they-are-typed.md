---
title: start forwards its options wherever they are typed, and finds the start that is the word
status: done
depends: [task-05-start-forwards-the-words-after-start.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/start.ts#L22-L36](../../../../packages/server/src/commands/start.ts#L22-L36) - `wordAt`, which answers where `start` is the word by wanting `['start']` as the only word up to and including a candidate"
  - "[code://packages/server/src/commands/start.ts#L38-L74](../../../../packages/server/src/commands/start.ts#L38-L74) - `forwardedLine`, which gives the child the typed line without the word and without the parent's globals"
  - "[code://packages/server/test/server-cli.test.ts#L350-L367](../../../../packages/server/test/server-cli.test.ts#L350-L367) - the task 05 case"
---

## Objective

`ahpd --connection-token abc start --port 0` and `ahpd --port 0 start` start a daemon that serves with the options the parent read, so the record, `ahpd status` and `ahpd stop` name the process that is actually serving; and `ahpd --path start start` starts one daemon, not one that orphans.

## Files

- `UPDATE: packages/server/src/commands/start.ts:22-36` - `wordAt`.
- `UPDATE: packages/server/src/commands/start.ts:38-74` - what the child is given.
- `UPDATE: packages/server/test/server-cli.test.ts` - the cases below, beside the task 05 cases.

## Steps

1. The program accepts a command's options before its word, so the child is given every option and value from the whole line except the `start` word itself and the program's own globals (`--remote`, `--token`, `--token-file`, and any other `programGlobals` or `globalOptions` entry that belongs to the process typing it).
2. Build the forwarded line from the tokenized line rather than by slicing argv, so a value spelled like a word or a flag stays a value.
3. `wordAt`: a candidate `start` at `index` is the word only when `tokenize(table, argv.slice(0, index + 1), { permissive: true }).words` is exactly `['start']`; a `start` that is an option's value is then consumed as the value.
4. Rewrite the `wordAt` comment to say what the function answers, without the claim the old one made.

## Validation

- `packages/server/test/server-cli.test.ts`, a case running `['--connection-token', 'abc', 'start', '--port', '0', ...]`: the daemon log does not say `no token: loopback only`, the record's `connectUrl` carries `tkn=abc`, and a WebSocket connect with that token is accepted. Today the daemon runs with no token, so the case fails.
- A case running `['--port', '0', 'start', ...]`: the record's port is not 9187. Today it is.
- A case running `['--path', 'start', 'start', '--port', '0', ...]`: `ahpd status` names the running daemon and `ahpd stop` stops it, and no second daemon remains. Today the child gets `start --port 0 ...` and orphans.
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green.

## Resume

Seen to fail: with `--connection-token abc start --port 0 ...`, the daemon log carried `no token: loopback only` and the record's `connectUrl` carried no `tkn`; with `--port 0 start ...` the record's url was `ws://127.0.0.1:9187`. Both pass after the change, and the token in the record opens a WebSocket.

`--path start start` did not fail as this task's third bullet predicted. Today the parent reads the first ws url written after it started, which the grandchild writes before the intermediate `start` process writes its own record, so the record ends up naming the process that is really serving and `status` and `stop` work; the double spawn is visible only in the log. The case now counts the daemon's own announcement lines (`ahpd on ws://`) and wants one, which is what one daemon writes. Breaking it back to the old `wordAt` made the case fail, and then the fix was put back.

Done: `wordAt` answers where `start` is the word by tokenizing up to and including the candidate and wanting `['start']`; `forwardedLine` walks the typed line with the union table, dropping the word and the parent's globals (`globalOptions` and `programGlobals`) with their values, and keeping every other option and value in the order typed, so a value spelled like a word or an option stays a value. `start` is spawned with that line, so the child runs the foreground daemon with the parent's options.
