---
title: Every entry read from a parts file other than the shipped one is reported against the shipped one
status: open
refs:
  - "[code://packages/computer/src/parts.ts#L86](../../../../packages/computer/src/parts.ts#L86) - `said`, which writes `versionsPath()` into every message it throws"
  - "[code://packages/computer/src/parts.ts#L163-L184](../../../../packages/computer/src/parts.ts#L163-L184) - `readParts`, which takes the path to read and whose own messages name it"
---

`readParts(path)` reads the file it is given, and four of its own messages name that path.
Every message an entry produces comes from `entryOf` through `said`, which writes `versionsPath()` - the shipped `packages/computer/images/versions.json` - whatever path was read.
So a parts file read from anywhere else reports its problems against a file that was never opened: a bump run over a copy, or a test over a fixture, is told the shipped file has the version `latest`.
Found while writing `packages/computer/test/parts-bump.test.ts`, which reads a parts file it wrote itself; the message named the repository's.
The fix is to thread the path into `entryOf` and `said`, or to catch and re-prefix in `readParts`.
