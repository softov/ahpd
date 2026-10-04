---
title: Captures are taken and read with ahpc, and ahpd keeps no proxy or capture check
domain: documentation
status: planned
priority: medium
created: 2026-10-04
revalidated: 2026-10-04
requires:
  - plans/host/43-the-wire-is-the-protocols-p1-the-wire-test-checks-every-frame/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://scripts/tee.mjs](../../../../scripts/tee.mjs) - the recording proxy being removed"
  - "[code://tools/validate.mjs](../../../../tools/validate.mjs) - the capture check being removed; `tools/wire.mjs`, the test census, stays"
  - "[code://package.json#L28](../../../../package.json#L28) - `\"wire\": \"node tools/validate.mjs\"`"
  - "[code://DEVELOPER.md#L39-L53](../../../../DEVELOPER.md#L39-L53) - the recording paragraph and the `pnpm wire` row; the paragraph still names ahpc's old `{ at, from, peer, frame }` shape"
  - "[code://docs/AHP.md#L871](../../../../docs/AHP.md#L871) - `pnpm wire` and `scripts/tee.mjs`"
  - "[code://docs/DAEMON.md#L279](../../../../docs/DAEMON.md#L279) - `--wire`, which ends with `pnpm wire -- <file>`"
  - "[code://README.md#L443](../../../../README.md#L443) - `pnpm wire` over the fixture"
  - "file:///github/ahpc/.project/decisions/the-recording-proxy-is-ahpcs.md - the decision, Softov's answer"
  - "file:///github/ahpc/.project/plans/cli/02-the-wire-is-proxied-and-analysed/plan.md - `ahpc wire proxy`, `check`, `stats`, `channel`, `diff`"
---

## Goal

ahpd's docs send a person to `ahpc wire proxy` to record a client and to `ahpc wire check` to validate a capture, and ahpd's own `scripts/tee.mjs`, `tools/validate.mjs` and `pnpm wire` are gone.

## Reconnaissance

### Searches performed

- `rg -ln "validate.mjs|tee.mjs"` outside `.project/`: `tools/wire.mjs` (a comment), `DEVELOPER.md`, `docs/AHP.md`, `package.json`, `UPSTREAM.md`.
- host/43 p1 task 02 changes `tools/validate.mjs` to pair a request with its answer; ahpc cli/02 task 03 ports the checker after that lands.

## Decisions locked in

| Decision | Task |
| --- | --- |
| - none here; the decision is ahpc's (refs) | - |

| What | Source | Task |
| --- | --- | --- |
| `scripts/tee.mjs` and the capture check go; the docs point at ahpc | Softov, 2026-10-04, asked "Where should the recording proxy live?": "ahpc wire proxy, retire tee.mjs" | 01 |
| `tools/wire.mjs`, `tools/schema.mjs` and `tools/ahp.strict.schema.json` stay: the test suite checks every frame it makes without ahpc | ahpc decision `ahpc-and-ahpd-share-no-package` | 01 |
| Built after host/43 p1 and after ahpc cli/02 is released | (defaulted: the checker ahpc ports is the one host/43 p1 finishes, and the docs name a command that has to exist) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The proxy and the capture check are ahpc's](task-01-the-proxy-and-check-are-ahpcs.md) | todo | - |

## Risks and tradeoffs

- A capture can no longer be checked from an ahpd checkout alone; `npx @softov/ahpc wire check <file>` does it without installing.

## Resume state

- **Next:** waits for host/43 p1 and ahpc cli/02.

## Final verification checklist

- [ ] `rg -n "tee.mjs|validate.mjs|pnpm wire" --glob '!.project/**'` finds nothing.
- [ ] `pnpm test` passes.
- [ ] `plans/index.md` updated.
