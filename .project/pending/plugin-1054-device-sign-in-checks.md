---
title: Check a devtunnel device sign-in
plans:
  - plans/plugin/20261102-1054-a-connector-signs-in-with-a-device-code/plan.md
---

# Check a devtunnel device sign-in

plugin/20261102-1054 is on main, and ahpw main has the sign-in button. A `devtunnel` connector signs in to Dev Tunnels with a GitHub device code. This check needs a real GitHub account.

## Set up

Run this from a terminal that is not a Claude Code session. Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

## Steps

1. In ahpw, add a `devtunnel` connector, and press the sign-in button.
2. Open the page it shows, type the code, and approve on github.com.
3. Check that the connector row is `ready`, and that the form says which account it signed in as.
4. Check the record, with the connector's id in place of `<id>`. Expect `account` and two `$secret` references, and no token:

```bash
cat ~/.config/ahpd/connectors/<id>.json
```

5. Check that the daemon's terminal, the answers and every row show no token, no refresh token and no device code.
6. Sign in again on the same connector with the same account. Check that the id stays.
7. Sign in again with another GitHub account. Check that the host refuses it.
8. More than 8 hours after the sign-in, restart the daemon. Check that the row is `ready`.
9. Check that an OpenRouter connector still signs in.

## Reply

Write "pass", or say which step stopped.
