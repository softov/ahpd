---
title: Measured before and after, on this machine and on dev-01
status: todo
depends: [task-01-a-summary-that-did-not-change-is-not-sent.md, task-02-agents-are-listed-at-once-and-once-per-store.md, task-03-the-catalogue-is-held.md, task-04-opening-a-past-session-reads-the-held-row.md]
layer: "by hand, for Softov"
refs:
  - "[code://packages/sdk/src/host/history.ts#L38-L45](../../../../packages/sdk/src/host/history.ts#L38-L45) - `history`, every opened transcript's turns kept for the life of the process, one suspect for the memory"
---

## Objective

The numbers in the plan's Reconnaissance are measured again after tasks 01-04, by Softov, on this machine and on dev-01, and the memory is explained or handed to a plan of its own.

## Files

- None. The probes are `/github/ahpapp/.scratch/org/probe-dev01.mjs` and `/github/ahpapp/.scratch/org/probe-flood.mjs`, run as they are.

## Steps

1. The before is the plan's Reconnaissance, measured 2026-10-04; a number it lacks is measured on a daemon built from the commit before task 01.
2. After the change, on this machine and on dev-01: `listSessions` time and row count (`probe-dev01.mjs`), `root/sessionSummaryChanged` per second and how many were identical to the one before (`probe-flood.mjs`, 70 s, with one build running).
3. On this machine, with two builds running for 20 minutes: daemon RSS and CPU with the daemon's pid in `$PID` (`ps -o rss,pcpu -p "$PID"` once a minute) and open descriptors (`ls /proc/$PID/fd | wc -l`).
4. If RSS is still above 1.5 GB after 20 minutes of one build, start the daemon under `node --inspect`, take a heap snapshot at 20 minutes, and note the largest retainers (the `history` map, SDK transcript reads, connection queues).
5. Write the before and after numbers in this task's Resume, and if the memory is not explained by them, say so and propose the plan that takes it.

## Validation

- Both columns filled for: `listSessions` seconds on dev-01 and here, events per second, identical events per 225, RSS, CPU, open descriptors.
- A heap snapshot summary, or a line saying RSS stayed under 1.5 GB.

## Resume

Measured 2026-10-09 on this machine's daemon (port 37537), built with tasks 01-04, while one to three build sessions ran.

| Measure | Before (2026-10-04) | After (2026-10-09) |
| --- | --- | --- |
| `listSessions` here | timed out at 30 s | 19 ms for 160 sessions |
| `root/sessionSummaryChanged` here | about 28 a second | 18 in 70 s, about 0.26 a second |
| Identical to the one before | about 210 of 225 | none: each of the 18 changed `activity` |
| RSS over 20 minutes | 3.1 to 3.7 GB | 320 to 600 MB, with no growth |
| CPU | 110 to 118 % | 5.1 to 5.2 % |
| Open descriptors | about 970 | 71 to 72 |

RSS stayed under 1.5 GB, so no heap snapshot was taken.
The dev-01 column (steps 1 and 2 of the review file) is still Softov's to measure.
