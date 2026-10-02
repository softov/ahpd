---
title: A client reads what a pool spent, and the records behind it, through a usage scheme - deferred
date: 2026-10-02
---

- **Listing pools over HTTP.** `GET /api/usage` with no pool does not route: `@cofold/remote` matches on segment count and a command carries one `meta.http`, so only `/api/usage/{pool}` is served. The listing is a terminal answer until a command can carry a second route.
- **Resolving one's own pool.** `authorize` is asked only for `resourceRead` and `resourceList`, so `resourceResolve` on a person's own `usage://` URI still needs `usage:read`. Asking it for resolve too is the change, if a client needs it.
