---
title: The probe answers pi's models
status: done
depends: [task-01-agent-pi-loads-without-importing-pi.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/agent.ts#L95-L105](../../../../packages/agent-pi/src/agent.ts#L95-L105) - `probe` and the comment that says a list is not possible"
  - "[code://packages/agent-pi/src/backend.ts#L180-L184](../../../../packages/agent-pi/src/backend.ts#L180-L184) - a session's `models`, from `modelRuntime.getAvailable()`"
  - "[code://packages/agent-pi/src/session.ts#L606-L609](../../../../packages/agent-pi/src/session.ts#L606-L609) - how a session turns pi's models into the offered list, with `idOf`"
  - "[code://packages/agent-pi/README.md#L62](../../../../packages/agent-pi/README.md#L62) - the README bullet this task corrects"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `ModelRuntime.create({ authPath, modelsPath })` and `getAgentDir()`, as `createAgentSessionServices` calls them
---

## Objective

`Agent.probe` answers the models pi's own runtime has for the agent directory, shaped exactly as a session's `models()` offers them, so the host holds pi's models from boot.

## Files

- `UPDATE: packages/agent-pi/src/backend.ts` - a function that builds `ModelRuntime` from `<agentDir>/auth.json` and `<agentDir>/models.json` and answers `getAvailable()`, through the loader from task 01.
- `UPDATE: packages/agent-pi/src/agent.ts` - `probe` answers those models in the same `{ id, name, ... }` shape the session offers; its comment says what it now is.
- `UPDATE: packages/agent-pi/README.md` - the "A model list before a session exists" bullet goes, and the models paragraph says the probe lists them.
- `UPDATE: packages/agent-pi/test/` - the case below.

## Steps

1. Apply decision [pi-models-are-probed-from-pis-model-runtime](../../../decisions/pi-models-are-probed-from-pis-model-runtime.md).
2. Share the model-to-offer shaping between the probe and the session, so both produce the same ids and fields.
3. A probe that fails (no credentials file, unreadable models file) answers no models rather than throwing; the host already keeps an empty list out.
4. The probe is injectable the way `open` is, so a test does not read the real `~/.pi`.

## Validation

- A case: with a fake runtime that has two models, `probe()` answers both with the same ids a session's `models()` gives for them; today it answers `[]`, so it fails first.
- A case: a runtime that throws answers `{ models: [] }`.
- The existing `probe` expectation at `test/agent-pi.test.ts` (answers `{ models: [], ... }`) is updated, not deleted.
- By hand, for Softov: restart the daemon, open a new pi session in VS Code, and the picker lists pi's models before the first message.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

Implemented 2026-09-28.
`runtimeModels` in `backend.ts` builds pi's `ModelRuntime` through the loader from `auth.json` and `models.json` in `getAgentDir()` and answers `getAvailable()`.
`piAgent` takes it as a third parameter, `models`, defaulting to `runtimeModels`, as `piSession` takes `open`.
`listed` in `models.ts` is the `{ id, name }` shape both the probe and a session's `models()` use.
`probe` answers the runtime's models through `listed`, and answers `{ models: [], customizations: [], commands: [] }` when the runtime throws.
The README's models bullet says the probe lists them, and the "A model list before a session exists" bullet is gone.
The existing `probe` case in `test/agent-pi.test.ts` became the two-model case, which compares the probe with a session's `models()` over the same fake.
It was written first and failed: `AssertionError: expected { Object (models, customizations, ...) } to deeply equal { Object (models, customizations, ...) }`, the probe answering no models.
A second case gives a runtime that throws and gets no models.
`agent-pi-truncate.test.ts` passes a runtime that answers none, so the host's boot probe does not read the real agent directory.
By hand, the default probe against this machine's pi answered 396 models.
`pnpm typecheck` and `pnpm boundary` green, and `pnpm test`: 106 files, 1458 tests passed.
