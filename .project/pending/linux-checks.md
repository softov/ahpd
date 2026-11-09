---
title: Check that ahpw signs in under its slug
plans:
  - plans/plugin/51-a-plugin-id-is-a-slug/plan.md
---

# Check that ahpw signs in under its slug

plugin/51 is on main. The other checks passed: the webhook, the scope and the page under `/plugins/web/` on 2026-10-20, and the old owner on 2026-11-03. The sign-in is left.

## Set up

```bash
source <(git -C /github/ahpd fetch -q origin && git -C /github/ahpd show origin/main:.project/pending/test-daemon.sh) agent-claude
ahpd plugin install @ahpd/web@next && ahpd restart
```

## Steps

1. Open http://127.0.0.1:39200/plugins/web/ in a browser.
2. Sign in with the token `check-token`.
3. Check that the page lists the sessions.
4. Stop the test daemon with `ahpd stop`.

## Reply

Write "pass", or what you saw.
