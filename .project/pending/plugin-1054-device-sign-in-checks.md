---
title: Check a devtunnel device sign-in
plans:
  - plans/plugin/20261102-1054-a-connector-signs-in-with-a-device-code/plan.md
---

# Check a devtunnel device sign-in

Plan plugin 1054 signs a `devtunnel` connector in to Dev Tunnels with a device code. Its tests use a fake GitHub and no network. This check needs your daemon, a real GitHub account and the network.
Restart the daemon on main before you start.
Do these checks from a terminal that is not a Claude Code session.

## Steps

1. In ahpw, add a `devtunnel` connector and press the sign-in button.
2. Open the page it shows, type the code, and approve on github.com.
3. Check that the connector row is `ready`, and that the form says who it is signed in as.
4. Check that the vault holds `connector/<id>/token` and `connector/<id>/refresh`.
5. Check that the record holds `account` and two `$secret` references, and no token.
6. Check that the daemon log, the answers and every row show no token, no refresh token and no device handle.
7. Sign in again on the same connector with the same account. Check that the id stays.
8. Sign in again with another GitHub account. Check that the host refuses it.
9. Restart the daemon more than 8 hours after the sign-in. Check that the row is `ready`.
10. Check that an OpenRouter connector still signs in with a pasted code.

## Reply

Write "done" when each step works, or say which step stopped.
