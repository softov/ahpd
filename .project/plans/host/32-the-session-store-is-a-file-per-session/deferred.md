---
title: The session store is a file per session - deferred
date: 2026-10-02
---

Met during the build and left as they are.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| A restarted daemon prunes only sessions it has listed since it started; one never listed has no known directory and is kept | The safe direction; a directory kept in the row would let a restart prune it too | unplanned |
| `recordPullRequest` can write a baseline for a catalogue row this host is not running, through a create-pr operation | Not a GitHub answer, so outside task 04 | unplanned |
| `fileSessions` takes `dir` where it took `file`, which breaks an embedder outside this repository | No embedder is known | none |
