---
title: A session file the store cannot read is overwritten by the next write for that id
status: open
refs:
  - "[code://packages/sdk/src/sessions.ts#L255-L311](../../packages/sdk/src/sessions.ts#L255-L311) - a file that fails to parse or has an unknown `version` is logged and skipped, and the next write for its id replaces it"
---

A session file that does not parse, or carries a `version` this build does not know (a newer ahpd's, after a downgrade), is logged and skipped on load, and left on disk.
The next write of any field for that id writes what is in memory over it, and its contents are gone.
Writes are atomic, so this is not corruption from a crash; it is a skipped record being replaced.
Found in the 2026-10-06 review of host/31; it predates host/31.
