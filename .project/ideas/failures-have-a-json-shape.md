---
title: A failure has a JSON shape under --json
created: 2026-09-26
---

Softov, 2026-09-26, asked how `ahpd plugin` with no sub-command should fail: "one... and another latter".
The first is daemon/04 task 20, a plain `ahpd: <sentence>` line; this is the later one, kept until a plan starts from it.

Today no ahpd failure has a JSON shape: `@cofold/terminal`'s `runEntry` writes `ahpd: <sentence>` on stderr in every output mode, so a script running `ahpd --json ...` reads prose when a command fails.

The idea: `@cofold/terminal` gives every failure a JSON shape under `--json` (the sentence, the kind and the exit code), and ahpd's failures, the group hint included, take it with no change of their own.
It is a cofold release, published by Softov, then a bump in ahpd.
