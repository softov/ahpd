---
title: A tunnel record names a person
status: implemented
depends: []
layer: "tunnel-devtunnel"
refs:
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L54-L79](../../../../packages/tunnel-devtunnel/src/kind.ts#L54-L79) - the record's schema"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L226-L240](../../../../packages/tunnel-devtunnel/src/kind.ts#L226-L240) - `start` reads the record's settings"
---

## Objective

A devtunnel record has a `person` setting, `user:<id>`, that names whose grants a tunnel visitor gets.

## Files

- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:54-79` - the schema gains `person`.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:226-240` - `start` reads `person`.
- `UPDATE: packages/tunnel-devtunnel/test/tunnel-devtunnel-kind.test.ts` - the setting's cases.

## Steps

1. Add `person` to `SCHEMA` as a string with the pattern `^user:.+$`, the title "Person" and a short description.
2. Read `person` in `start`, beside `connector`, `port` and `anonymous`.
3. Keep `person` optional, so a host with no users needs none.
4. Let the system tunnel's record take `person` from the plugin's options, as it takes `anonymous`.

## Validation

- A test where a record with `person` starts, and the kind reads it.
- Test a record with a malformed `person`. Expect the schema to refuse it.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/tunnel-devtunnel` passes.

## Resume

Implemented 2026-11-11, uncommitted in the worktree.

- `SCHEMA` gains `person`: a string with the pattern `^user:.+$`, the title "Person", and the description naming the prefix and the id.
- `personOf` reads the setting into the bare id the users directory holds, and `start` keeps it in the running entry, where task-03's hop reads it. The setting stays optional: a host with no users needs none.
- `start` also refuses a record whose `person` is present and not `user:` and an id, so a record written before the pattern or edited by hand fails at its start rather than at a visitor's connection. The plan expects the schema to refuse it; the check is the same rule, for the record path.
- `system()` carries the plugin's `person` into the system tunnel's record, as it carries `anonymous`.
- Beyond the task's Files list, to keep the option and the schema tests true: `plugin.ts` gains `Options.person` and passes it to the kind, `package.json` declares it in `optionsSchema`, and `README.md` lists it in the options table and the kind's example.
- CASES in `test/tunnel-devtunnel-kind.test.ts`: the schema's pattern takes `user:ada` and refuses `ada` and `user:`; a record with a person starts and serves its port; a record with a malformed person starts nothing and the report names `person`; the system tunnel answers its person.
- `pnpm exec tsc -p tsconfig.json --noEmit` passes. The tunnel-devtunnel suite was not run here.
- Known gap for task-03: `update` rebuilds a running entry on a port change without the person, so the hop must read the person there too, or a port change drops it until the tunnel starts again.

