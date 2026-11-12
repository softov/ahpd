---
title: A tunnel record names a person
status: todo
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

