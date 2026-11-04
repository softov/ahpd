---
title: The docs say how to turn it on
status: todo
depends: [task-02-the-model-api-is-served-on-its-gate.md]
layer: docs
refs:
  - "[code://docs/server/PROXY.md](../../../../docs/server/PROXY.md) - says the proxy is served while `httpApi` is on"
---

## Objective

The docs show `modelApi`, and the release notes say a 0.14 config must add it.

## Files

- `UPDATE: docs/server/PROXY.md` - `modelApi` turns the model API on, beside or apart from `httpApi`.
- `UPDATE: docs/server/CONFIGURE.md` - `modelApi` in the keys with no flag, and one line beside `httpApi`.
- `UPDATE: docs/updates/v0_15.md` - the change, and `"modelApi": true` for a host that calls models today.
- `UPDATE: .project/plans/proxy/00-proxy.md` - the runtime path names `modelApi`.

## Steps

1. Replace the `httpApi` example in `PROXY.md` with `modelApi`, and show both forms.
2. Add `modelApi` to `CONFIGURE.md`.
3. Add the change to `v0_15.md`, with the line to add.
4. Update the runtime path in `00-proxy.md`.

## Validation

- `node /home/softov/.claude/skills/do-spec/scripts/lint-prose.mjs` passes on the changed `.project` file.
- The docs build passes.

## Resume

- **Done so far:** nothing.
- **Found:** nothing yet.
