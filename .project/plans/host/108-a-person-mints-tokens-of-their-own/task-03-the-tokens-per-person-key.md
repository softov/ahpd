---
title: The tokensPerPerson key
status: done
depends: [task-01-the-directory-keeps-tokens.md]
layer: server
refs:
  - "[code://packages/server/src/config.ts#L208-L216](../../../../packages/server/src/config.ts#L208-L216) - `trustToken` in `Config`, the sibling key about people"
  - "[code://packages/server/src/commands/options.ts#L516-L519](../../../../packages/server/src/commands/options.ts#L516-L519) - the `trustToken` field, and `clientToolTimeoutMs` below it for an integer"
  - "[code://packages/server/src/commands/options.ts#L1160](../../../../packages/server/src/commands/options.ts#L1160) - where a key gets its default"
  - "[code://packages/server/src/commands/run.ts#L344](../../../../packages/server/src/commands/run.ts#L344) - where the daemon passes `trustToken` to `fileUsers`"
  - "[code://packages/server/src/commands/user.ts#L75-L79](../../../../packages/server/src/commands/user.ts#L75-L79) - the directory the terminal builds from the configuration file"
  - "[code://packages/server/src/main.ts#L288](../../../../packages/server/src/main.ts#L288) - the help line that lists every key"
  - "[code://packages/server/src/rootconfig.ts#L32](../../../../packages/server/src/rootconfig.ts#L32) - `DAEMON_KEYS`, which this key stays out of, as `trustToken` does"
---

## Objective

The host key `tokensPerPerson`, and the flag `--tokens-per-person`, set how many minted tokens one person may hold.
The default is 10, and the daemon and the terminal both give the value to `fileUsers`.

## Files

- `UPDATE: packages/server/src/config.ts:208-216` - add `tokensPerPerson?: number` after `trustToken`.
- `UPDATE: packages/server/src/commands/options.ts:516-519` - add the `tokensPerPerson` field, an integer with `minimum: 0`.
- `UPDATE: packages/server/src/commands/options.ts:70` - add `tokensPerPerson: number` to `Options`.
- `UPDATE: packages/server/src/commands/options.ts:1160` - default the key to 10.
- `UPDATE: packages/server/src/commands/run.ts:344` - pass `tokensPerPerson` to `fileUsers`.
- `UPDATE: packages/server/src/commands/user.ts:75-79` - pass the configuration file's `tokensPerPerson` to the terminal's `fileUsers`.
- `UPDATE: packages/server/src/main.ts:288` - add `tokensPerPerson` to the list of keys after `trustToken`.
- `UPDATE: packages/server/test/config-check.test.ts` - the tests of the key.

## Steps

1. Write the tests first.
2. Add the field with the description "How many tokens one person may mint for themselves. Default 10; 0 lets nobody mint one."
3. Give it `cli: { value: 'N' }`, so the flag is `--tokens-per-person N`.
4. Refuse a value that is not a whole number of 0 or more, as the other integer keys do.
5. Pass the value through `run.ts` and through the terminal's `people` helper.
6. Leave the key out of `DAEMON_KEYS`, because a client cannot change who may mint over root config.
7. Set this task and the plan's Tasks table to `implemented`.

## Validation

- `config-check.test.ts`: the check accepts `"tokensPerPerson": 3`, and refuses `-1` and `2.5`.
- `config-check.test.ts`: `optionsFrom` gives 1 for `--tokens-per-person 1`, and 10 when nothing sets the key.
- `pnpm exec vitest run packages/server/test/config-check.test.ts` passes.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** every step. `Config.tokensPerPerson` is an optional number. `serverFields` declares it as an integer with `minimum: 0`, `cli: { value: 'N' }` and the agreed description, so the flag is `--tokens-per-person N`. `Options.tokensPerPerson` is a required number, defaulted to 10 in `optionsFrom`. `run.ts` passes it to the daemon's `fileUsers`, and the terminal's `people` helper passes the configuration file's value. `main.ts` lists the key after `trustToken`, and `DAEMON_KEYS` is unchanged.
- **Next action:** task 04, the three token commands. Task 05 can follow either order and depends on 02.
- **Open questions:** none.
- **Watch out for:** a negative or fractional value is refused with `tokensPerPerson must be an integer >= 0`; the schema builds that sentence from `minimum: 0` alone.
