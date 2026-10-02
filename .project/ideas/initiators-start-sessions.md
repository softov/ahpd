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

## A public port, later

plugin/21 puts routes on the daemon's listener, which a tunnel already carries.
A webhook a forge or a chat platform calls must be reachable from the internet, while the AHP endpoint should not have to be, so a second listener for public routes only (webhooks, platform callbacks, nothing that speaks AHP) is the case to keep open.

## Questions it leaves

- One trigger-manager plugin with sources registered into it, or one plugin per source sharing a small library.
- How a call proves who it is: a shared secret per endpoint, the platform's signature (GitHub, GitLab, Slack each sign), or a token from the vault.
- Who a session started by an issue or a chat message belongs to: the plugin, or the person the platform names, mapped to a user record.
- Where the mapping from thread or issue to session is kept, so it survives a restart.
- Which chat platforms first (Slack, Telegram, Matrix, Discord), and which issue sources (GitHub, GitLab, Linear, Jira).
