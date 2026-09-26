---
title: "@cofold/remote 0.3.1 is cut by Softov, from a tagged commit, once serve() is fixed"
status: accepted
date: 2026-09-26
refs:
  - "file:///github/cofold/packages/remote/src/serve.ts - `serve()`, uncommitted in the cofold repository"
  - "npm://@cofold/remote@0.3.0 - the release published from that uncommitted tree"
---

## Context

`@cofold/remote@0.3.0` was published from a working tree with `serve.ts` uncommitted, so no commit or tag in the cofold repository produces it.
That release crashes the process on a malformed `Host` header or a malformed percent-escape in a path.

## Decision

The `serve()` fixes are prepared in `/github/cofold`, and 0.3.1 is cut later from a tagged commit.
Softov commits, tags and publishes; a task prepares the fix and says the release is his.

Source: Softov, 2026-09-26, asked "Was publishing `@cofold/remote@0.3.0` from an uncommitted tree approved? Should 0.3.1 be cut from a tagged commit once these are fixed?": "cut 0.3.1 later, from a tagged commit, once the serve.ts crash fix is in. Softov publishes; a task only prepares the fix and says the release is his".

## Consequences

ahpd's dependency moves to `^0.3.1` only after that release exists, and until then ahpd's own handler guards the request before `serve()` sees it.
No agent publishes a cofold package.

## Options

- **Republish now from the working tree.** Another release no commit describes.
