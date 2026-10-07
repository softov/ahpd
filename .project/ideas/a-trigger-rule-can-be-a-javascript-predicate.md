---
title: A trigger rule can be a JavaScript predicate
created: 2026-10-07
---

A rule in host/71 has a fixed shape: one event, a count, a follow-up and a state check.
A pattern of three or more steps, or one that compares two sessions, does not fit that shape.

The idea is a fourth kind of rule: a JavaScript function.
It reads each session event and a small state object, and answers whether the rule matches.

What it needs before it is a plan:

- A sandbox: the function runs with no file, network or process access, and with a time limit for each event.
- Who may write one: a grant of its own, since a predicate is code the daemon runs.
- How a client shows it: a code field, not a form.

Source: Softov, 2026-10-07, chose "fixed shape, and as a future idea a js predicate".
