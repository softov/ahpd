---
title: Check that the pt catalogs read right
plans:
  - plans/host/20261030-1037-host-text-in-the-clients-language/plan.md
---

# Check that the pt catalogs read right

The plan host/20261030-1037 ships Portuguese and Spanish text for the new session form and the plugins screen. An agent wrote the text. Softov reads each `pt.json` and says which entries to change. Each catalog is keyed by field path, so an entry is `session.<key>.title`, `options.<key>.description`, `meta.title`, `views.<id>.text`, `messages.<key>` and so on.

## The host

- [packages/sdk/src/i18n/pt.json](../../packages/sdk/src/i18n/pt.json): the host's own keys in the new session form, such as isolation, branch and the worktree keys.

## The agents

- [packages/agent-claude/i18n/pt.json](../../packages/agent-claude/i18n/pt.json)
- [packages/agent-cofold/i18n/pt.json](../../packages/agent-cofold/i18n/pt.json)
- [packages/agent-pi/i18n/pt.json](../../packages/agent-pi/i18n/pt.json)
- [packages/agent-acp/i18n/pt.json](../../packages/agent-acp/i18n/pt.json)

## The other plugins

- [packages/activepieces/i18n/pt.json](../../packages/activepieces/i18n/pt.json)
- [packages/bot/i18n/pt.json](../../packages/bot/i18n/pt.json)
- [packages/computer/i18n/pt.json](../../packages/computer/i18n/pt.json)
- [packages/push/i18n/pt.json](../../packages/push/i18n/pt.json)
- [packages/tasks/i18n/pt.json](../../packages/tasks/i18n/pt.json)
- [packages/tunnel-devtunnel/i18n/pt.json](../../packages/tunnel-devtunnel/i18n/pt.json)
- [packages/webhook/i18n/pt.json](../../packages/webhook/i18n/pt.json)

## In a client

```bash
source <(git -C /github/ahpd fetch -q origin && git -C /github/ahpd show origin/main:.project/pending/test-daemon.sh) agent-claude agent-cofold agent-pi agent-acp bot computer push tasks tunnel-devtunnel webhook activepieces
ahpd plugin install @ahpd/web@next && ahpd restart
```

1. Open http://127.0.0.1:39200/plugins/web/, sign in with `check-token`, and set ahpw to Portuguese.
2. Open the new session form, and read the host's keys and the agent's keys.
3. Open the plugins screen, and read each first-party plugin's title, description and options.
4. Stop the test daemon with `ahpd stop`.

## Reply

For each catalog, write "pass", or the path and the text you want instead. A pass on all of them ticks the last line in the plan.
