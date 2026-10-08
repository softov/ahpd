---
title: An initiator starts a session from outside, and a thread keeps talking to it
created: 2026-10-02
---

Softov, 2026-10-02: "A plugin trigger manager webhook to start a session or a automation or since api is already present. just a new endpoint but consider future cases where it could be another port to be public accessible." And of chat threads and issue triggers: "So the channels is the same. a initiator."

An initiator is anything outside the host that starts a session or an automation and then keeps a conversation with it: a webhook call, an issue event, a chat message.
They share one shape, so they are one idea and one plugin family rather than a webhook plugin, an issue plugin and a chat plugin each with its own plumbing.

## The shape every initiator has

| Step | Webhook | Issue | Chat thread |
| --- | --- | --- | --- |
| Starts | A call to an endpoint with a predefined run's name | An issue assigned to the bot, or a label added | A mention of the bot in a channel |
| Session | An automation's run, or a session from a preset | A session on the issue's repository, in a fresh worktree, the issue as prompt | A session, the message as prompt |
| Next turn | None, or a callback with the result | A review comment that mentions the bot | A reply in the thread |
| Asks a person | Not at all, or fails | A comment that waits for an answer | Buttons, or a yes/no reply |
| Ends | The run's result | A pull request, linked on the issue | A summary in the thread |

So an initiator is a mapping from an outside conversation (a URL, an issue, a thread) to a session, kept so the next event finds the same session.

## What it builds on

- [plugin/20](../plans/plugin/20-a-plugin-is-a-client-of-its-own-host/plan.md), a plugin is a client of its own host: an initiator starts sessions, sends turns and answers input requests as `plugin:<name>`, with the grants the operator gave it.
- [plugin/21](../plans/plugin/21-a-plugin-serves-an-http-route/plan.md), a plugin serves an HTTP route under `/plugins/<name>/` on the daemon's own listener: the first webhook endpoint needs no new port.
- Automations already hold a predefined run (provider, folder, prompt), so a webhook fires one by name and `automation_fire` and run history work unchanged.
- [plugin/33](../plans/plugin/33-a-phone-hears-a-session-needs-a-person/plan.md), a phone hears when a session needs a person: the same "needs a person" event a chat initiator turns into buttons.
- Issue sources follow the repository: [issues follow the repository](issues-follow-the-repository.md) for GitHub and GitLab, and the same mapping for Linear and Jira, which are not tied to a forge.

## A trigger menu built from connectors

Softov, 2026-10-07: an automation's triggers are "more like based on connecttors also."
An "Add trigger" menu starts with a schedule.
The schedule has presets: every hour, every day, weekdays, every week, every month, an interval, and an advanced cron.
After it come Slack message, Git event, Teams message, Linear issue, Sentry alert, PagerDuty incident and Webhook.

ahpd has most of the plumbing for this menu:

- The protocol lists each trigger type a host fires, as an `AutomationTriggerDefinition` with its title, events and `configSchema`.
  A client draws the menu and the form from what the host sends.
- A plugin registers a type with `registerTriggerType` and reports an event with `fireTrigger` ([`code://packages/sdk/src/types/plugin.ts#L420-L434`](../../packages/sdk/src/types/plugin.ts#L420-L434)). Every enabled automation on that event starts a run.
- ahpapp has schedule presets and a cron field. Weekdays, monthly and an interval are more presets on the same cron field.

What is missing:

- No plugin registers a trigger type, so the menu has only the schedule and session events. A webhook on a plugin route is the first one; a Git event is the same from GitHub and GitLab webhooks.
- The run does not see the event. `fireTrigger`'s `data` is kept on the run's origin and nothing reads it. A routine that answers a Slack message needs the message in its instruction.
  A placeholder in the template or a block added to the prompt can carry it.
- Slack, Teams, Linear, Sentry and PagerDuty each need a connected account first. Activepieces pieces ship triggers beside their actions, so [connectors-come-from-activepieces-pieces.md](connectors-come-from-activepieces-pieces.md) could supply these trigger types from one plugin.
- Not checked: whether the ahpapp automation form draws the host's event types today.

## A public port, later

plugin/21 puts routes on the daemon's listener, which a tunnel already carries.
A webhook a forge or a chat platform calls must be reachable from the internet, while the AHP endpoint should not have to be, so a second listener for public routes only (webhooks, platform callbacks, nothing that speaks AHP) is the case to keep open.

## Questions it leaves

- One trigger-manager plugin with sources registered into it, or one plugin per source sharing a small library.
- How a call proves who it is: a shared secret per endpoint, the platform's signature (GitHub, GitLab, Slack each sign), or a token from the vault.
- Who a session started by an issue or a chat message belongs to: the plugin, or the person the platform names, mapped to a user record.
- Where the mapping from thread or issue to session is kept, so it survives a restart.
- Which chat platforms first (Slack, Telegram, Matrix, Discord), and which issue sources (GitHub, GitLab, Linear, Jira).
