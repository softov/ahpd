---
title: web_fetch refuses loopback, private and link-local addresses, on every hop
status: accepted
date: 2026-09-26
refs:
  - "file:///github/cofold/packages/tools/src/web.ts - `fetchTool`, which fetches with `redirect: 'follow'` and checks only the scheme"
  - "file:///github/cofold/packages/agents/src/policy/rules.ts - `DEFAULT_DECIDE`, which lets a network tool run in `auto`"
---

## Context

`web_fetch` accepts any `http` or `https` URL and follows redirects, so it reaches the daemon's own machine and its network.
Under `auto` and `bypassPermissions` a model fetches `http://127.0.0.1:<port>/` or `http://169.254.169.254/` without a prompt, and a public page can redirect it there.

## Decision

`web_fetch` in `@cofold/tools` refuses a URL whose host is, or resolves to, a loopback, private or link-local address, and checks every redirect hop the same way.
Source: Softov, 2026-09-26, asked "Should `web_fetch` refuse loopback, private and link-local addresses? (a) Yes, in `@cofold/tools`. (b) Yes, through a `fetch` wrapper that ahpd passes to `web({fetch})`. (c) No.": "yes, in `@cofold/tools`, check redirects too".

## Consequences

The tool follows redirects itself (`redirect: 'manual'`), so each `Location` is checked before it is fetched.
A hostname is resolved before the request; a name that resolves to a public address at the check and an internal one at the connection (DNS rebinding) is not caught by a check made before the request, which the task records rather than solving with a dependency.
The change is made in `/github/cofold` and reaches ahpd with a new `@cofold/tools` release.

## Options

- **A wrapper in ahpd.** Every other `@cofold/tools` user, papo included, would stay open.
- **No check.** The model reaches the daemon's own services whenever the mode does not ask for the network.
