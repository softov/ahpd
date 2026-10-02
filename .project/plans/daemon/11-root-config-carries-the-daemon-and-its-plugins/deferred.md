---
title: Root config carries the daemon's settings and each plugin's options - deferred
date: 2026-10-02
---

These were met during the build and are not in the plan's scope.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| A client with `config:write` can point `wire` at any file the daemon can write, and the capture empties it first | `wire` is a live key by the plan's decision; limiting where it may write is a choice not yet made | unplanned |
| A `writeOnly` under `anyOf`, `oneOf`, `allOf` or `$ref` is not walked | No plugin of ours marks one there | unplanned |
| The manual check in ahpapp as admin and member | Not run during the build | before ahpapp's config form ships |
