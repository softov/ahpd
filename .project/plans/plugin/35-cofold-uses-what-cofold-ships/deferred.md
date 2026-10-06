---
title: A cofold session uses what published cofold already ships - deferred
date: 2026-10-06
---

This plan takes only what the published cofold packages already have; what needs a cofold release first, or another backend, waits.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| A run answers its own pause: `pauses.ts` and the `runs.ts` workarounds go | needs cofold plan A released | an ahpd plugin plan after that cofold release |
| Tools declare what they touch: `describe`, `toolMetaOf`, `EDITS` and `withoutTaken` replaced by what a tool declares | needs cofold plan B released | the same later plan |
| The permission modes and effort levels read from cofold instead of `agent.ts`'s lists | needs cofold plan C released | the same later plan |
| The providers config shape, `splitModel` and the standard capabilities read from cofold instead of `config.ts` and `capabilities.ts` | needs cofold plan D released | the same later plan |
| The listed `features` passed to `.model()` | a model listed without `tools` would refuse every turn that offers tools; not asked for | unplanned |
| The listed price on an offered row as `SessionModelInfo._meta.pricing` | not asked for; the same gap is open for pi | [a-pi-model-row-carries-no-price](../../../problems/a-pi-model-row-carries-no-price.md) |
| pi drops compaction and branch summaries when it replays a session | another backend | [pi-replay-drops-compaction-and-branch-summaries](../../../problems/pi-replay-drops-compaction-and-branch-summaries.md) |
| Claude's transcript shows no sign of a compaction | another backend | [a-reopened-claude-session-shows-no-compaction](../../../problems/a-reopened-claude-session-shows-no-compaction.md) |
