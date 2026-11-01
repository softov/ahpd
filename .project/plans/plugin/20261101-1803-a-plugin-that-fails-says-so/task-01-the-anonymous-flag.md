---
title: The anonymous flag
status: implemented
depends: []
layer: "tunnel-devtunnel"
refs:
  - "[code://packages/tunnel-devtunnel/src/devtunnel.ts#L220](../../../../packages/tunnel-devtunnel/src/devtunnel.ts#L220) - `access create` with `--port`"
  - "[code://packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts#L131](../../../../packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts#L131) - the test that expects `--port`"
---

## Objective

With anonymous access on, `prepare` runs `devtunnel access create <id> --anonymous -p 31546`, which the Dev Tunnels CLI 1.0.2094 accepts.

## Files

- `UPDATE: packages/tunnel-devtunnel/src/devtunnel.ts:220` - `--port` becomes `-p`, as on the `port create` line.
- `UPDATE: packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts:131` - the test expects `-p`.

## Steps

1. Replace `'--port'` with `'-p'` in the `access create` call of `prepare`.
2. Change the expected call in the test "opens it to the signed-out only when asked" to `-p`.
3. Run `devtunnel access create --help` and record the flag it lists in *Resume*.

## Validation

- `pnpm --filter @ahpd/tunnel-devtunnel test` passes.
- By hand: with anonymous on, start the daemon; the log has no `access create failed` line, and the tunnel URL opens.

## Resume

`prepare` passes `-p` to `access create`, and the test expects it. `devtunnel access create --help` in CLI 1.0.2094 lists `-p, --port-number`.
