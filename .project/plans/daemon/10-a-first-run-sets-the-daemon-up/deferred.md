---
title: ahpd configure sets the daemon up - deferred
date: 2026-10-02
---

Met during the build and not in its scope.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| A backend loaded from a local path (`./packages/agent-claude/src/index.ts`) is not recognised as Claude, so configure would install `@ahpd/agent-claude` beside it | Backends are matched by package name; a development setup names a file | unplanned |
| The manual run of `ahpd configure` at a real terminal against npm, and the trust question in a real folder | Covered over a faked terminal and installer only | before a release |
