---
title: A disposable machine is made for a session and goes after it - deferred
date: 2026-10-03
---

- A new session that reuses a disposed session's id, from the same owner on the same daemon, still reaches that session's old alone machine. `SessionStore` keeps no creation time and `Machine.created` is Docker's display string, so closing it needs a per-session nonce on the machine's label, a change to the store.
