---
title: Check a webhook against real senders
plans:
  - plans/plugin/54-a-webhook-takes-what-real-senders-send/plan.md
---

# Check a webhook against real senders

plugin/54 is on main (PR 67). These checks need a GitHub repository and a Slack app that reach your daemon. `docs/plugins/WEBHOOKS.md` gives each connector's fields.

## Set up

The stored `hook-test` connector is already in the new form: its config holds `bot`, `reply` and `secret`.

1. Make the daemon's webhook port reachable from GitHub and Slack, as "A public port" in `docs/plugins/WEBHOOKS.md` says.
2. Give the webhook plugin's entry in `config-dev.json` its grants: `"grants": ["session:read", "session:create", "session:write", "chat:create"]`. A bot call opens its own session and chat, and without these grants it answers 409 (`docs/plugins/WEBHOOKS.md`).
3. Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

## GitHub

1. Make a connector with the `github` scheme, a secret, and an automation as its target.
2. Add a webhook to the GitHub repository with the same secret and the connector's URL.
3. Push a commit, and check that the automation runs.
4. Change the secret in GitHub, push again, and check that the delivery answers 401 in GitHub's delivery list.
5. Set the connector's `match` to `headers.x-github-event: push`.
6. Open a pull request, and check that the delivery is skipped and nothing runs.

## Slack

1. Make a connector with the `slack` scheme and its signing secret.
2. Set the connector's URL as the Slack app's request URL.
3. Check that Slack accepts the URL, and that no automation runs.

## A form body

1. Make an automation whose prompt reads `{{event.body.<field>}}`.
2. Send a form-encoded call: `curl -X POST <connector URL> -d '<field>=hello'` with the connector's token.
3. Check that the run reads `hello`.

## Owners

1. As `user:alice`, make a connector.
2. As `user:bob`, save an automation that names that connector.
3. Check that the save is refused.

## A bot connector

1. Make a connector with only `bot` and `secret`.
2. Send `{"thread": "t1", "text": "hello"}` to it, with that secret as `Authorization: Bearer`.
3. Check that it answers 202 with `queuedMessageId`, and a `status` of `sent` or `queued`.

## Reply

Write "pass" for each section, or what you saw.
