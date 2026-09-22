---
title: A transcript read that failed is not kept as an empty session
status: proposed
date: 2026-09-23
refs:
  - code://packages/agent-claude/src/transcript.ts#L38-L51 - the catch that answers `[]` for any failure, and the comment that argues for it
  - code://packages/sdk/src/host.ts#L3772 - `history`, the cache that lives as long as the host process
  - code://packages/sdk/src/host.ts#L3790-L3825 - `past`, which keeps whatever the port hands it
  - code://packages/sdk/src/host.ts#L3899 - the annotations existence probe, where `undefined` means "no such session"
  - code://packages/sdk/src/host.ts#L6366-L6428 - the turn and draft seeds, where a non-`undefined` answer is what says a session is known
  - code://test/host.test.ts#L32-L85 - the SDK mock, with `sdk.reads` counting the reads
  - code://test/host.test.ts#L6140-L6161 - the one-read-per-open case the cache exists for
---

## Context

A VS Code window connected to this host opened the newest sessions and drew nothing, while others drew their turns; restarting the window loaded them.
The transcripts were never the problem: the four newest files each read as a user frame and its answer through the same SDK call the host makes, so what was stuck was on this side and transient.
What the code does is make one failure permanent. `turnsOf` answers `[]` for any failure - its own comment says "a transcript that will not parse is an empty session, not a refusal" - and `past` keeps whatever it is handed in `history`, a map that lives as long as the host process.
An empty array is truthy, so one failed or mid-write read becomes "this session has no turns" for every later subscribe, with nothing said and nothing tried again.
Only a restart that cycles the daemon clears it, which is what the report describes.

## Decision

A read that answered nothing is not remembered: `past` puts a transcript in `history` only when it has turns, and answers the empty result either way.
`turnsOf` tries a failed read once more before answering empty, so a transient failure is not drawn as an empty session at all.
The rule that a transcript this host cannot parse is still served as an empty session stands, because a row the catalogue vouches for has to open; what changes is that the empty answer is not kept for the process and is not the first thing a failure produces.

Source: the user, 2026-09-23, reporting the symptom and answering "do the plan" to the fix direction.

## Consequences

A session that answered empty once is read again on the next subscribe, so reopening one after a transient failure shows its turns without restarting anything.
A genuinely empty session is read on every open rather than once, which is the cost: the file is small, and it is still one read per open because concurrent callers share the read in `reading`.
Nothing about the answer's shape changes, so the annotations probe at `:3899` and the seeds at `:6366` and `:6424`, which treat a non-`undefined` answer as "this session is known", keep working.
The cache still does the job it was built for: a transcript with turns is read once, which is the 35MB read the memory note above `past` is about.

## Options

- **Answer `undefined` for a failed read, and probe existence from the catalogue rather than from `past`.** Rejected: `past`'s `undefined` already means "no such session" at four call sites, and one of them is the annotations channel, whose refusal the comment at `:3888` says is a failed open that draws nothing at all - the same symptom, made deliberate.
- **Keep nothing in `history` at all.** Rejected: every subscribe would re-read the transcript, including the large one, which is exactly the cost the cache and the concurrent-read fold were added to avoid.
- **Throw from `turnsOf` so the asking client hears about it.** Rejected: it refuses a row the catalogue says exists, which the backend's own comment argues against, and it turns a readable list into a list with a broken row in it.
