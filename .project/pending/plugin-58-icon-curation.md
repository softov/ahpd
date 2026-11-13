---
title: Curate the icon of each plugin in this repository
plans:
  - plans/plugin/58-plugins-and-adapters-carry-icons/plan.md
  - plans/plugin/61-a-plugin-icon-has-a-dark-variant/plan.md
  - plans/plugin/69-a-plugin-names-a-host-mark/plan.md
---

# Curate the icon of each plugin in this repository

Plan 58 task 05 gives each plugin in this repository one SVG icon.
Plan 61 task 01 gives each Lucide icon a second file for a dark background.
Seven candidates come from Lucide, which publishes its icons under the ISC licence, and each of those files keeps its licence comment.
The ACP, Activepieces, Claude and pi candidates are the vendors' own marks, after the first Lucide choices looked wrong.
Every file is under 32 KB, and none carries a script or an event attribute.
The webhook adapter names the same two files as its plugin.

`currentColor` has no value inside an image, so each Lucide file now strokes in a fixed colour.
`icon.svg` strokes in `#1F2328`, for a light background.
`icon-dark.svg` strokes in `#E6EDF3`, for a dark background.
The Activepieces, Claude and pi marks keep one icon, because their colours read on both backgrounds.

Each candidate is in place already, so a plugin shows it at the next start.
Replace a candidate that you reject with the SVG you want, at the same path.
Nothing else changes, because the manifest of each package names the file, not the drawing in it.

| Plugin | File | Candidate | Dark file | Source | Licence |
| --- | --- | --- | --- | --- | --- |
| Activepieces | `packages/activepieces/icon.svg` | the Activepieces mark, in `#8142E3` | none | https://github.com/activepieces/activepieces/blob/main/docs/favicon.svg | vendor mark, licence not stated |
| ACP | `packages/agent-acp/icon.svg` | the ACP logo, in black | `packages/agent-acp/icon-dark.svg`, in white | https://github.com/agentclientprotocol/agent-client-protocol/tree/main/docs/logo | Apache 2.0 |
| Claude | `packages/agent-claude/icon.svg` | the Claude starburst, in `#D97757` | none | https://cdn.simpleicons.org/claude | CC0 1.0, from Simple Icons |
| Cofold | `packages/agent-cofold/icon.svg` | `layers` | `packages/agent-cofold/icon-dark.svg` | https://lucide.dev/icons/layers | ISC |
| pi | `packages/agent-pi/icon.svg` | the pi.dev mark | none | https://pi.dev/logo-auto.svg | vendor mark, licence not stated |
| Bot | `packages/bot/icon.svg` | `bot` | `packages/bot/icon-dark.svg` | https://lucide.dev/icons/bot | ISC |
| Computer | `packages/computer/icon.svg` | `container` | `packages/computer/icon-dark.svg` | https://lucide.dev/icons/container | ISC |
| Push | `packages/push/icon.svg` | `bell-ring` | `packages/push/icon-dark.svg` | https://lucide.dev/icons/bell-ring | ISC |
| Tasks | `packages/tasks/icon.svg` | `list-checks` | `packages/tasks/icon-dark.svg` | https://lucide.dev/icons/list-checks | ISC |
| Dev Tunnel | `packages/tunnel-devtunnel/icon.svg` | `waypoints` | `packages/tunnel-devtunnel/icon-dark.svg` | https://lucide.dev/icons/waypoints | ISC |
| Webhook | `packages/webhook/icon.svg` | `webhook` | `packages/webhook/icon-dark.svg` | https://lucide.dev/icons/webhook | ISC |
| Jira | `packages/server/icons/jira.svg` | the Jira mark, in `#0052CC` | none | https://cdn.simpleicons.org/jira | CC0 1.0, from Simple Icons |
| Linear | `packages/server/icons/linear.svg` | the Linear mark, in `#5E6AD2` | none | https://cdn.simpleicons.org/linear | CC0 1.0, from Simple Icons |
| Resend | `packages/server/icons/resend.svg` | the Resend mark, in black | `packages/server/icons/resend-dark.svg`, in `#E6EDF3` | https://cdn.simpleicons.org/resend | CC0 1.0, from Simple Icons |
| GitHub | `packages/server/icons/github.svg` | the GitHub mark, in `#181717` | `packages/server/icons/github-dark.svg`, in `#E6EDF3` | https://cdn.simpleicons.org/github | CC0 1.0, from Simple Icons |
| WhatsApp | `packages/server/icons/whatsapp.svg` | the WhatsApp mark, in `#25D366` | none | https://cdn.simpleicons.org/whatsapp | CC0 1.0, from Simple Icons |
| Postgres | `packages/server/icons/postgres.svg` | the PostgreSQL elephant, in `#4169E1` | none | https://cdn.simpleicons.org/postgresql | CC0 1.0, from Simple Icons |
| Gemini | `packages/server/icons/gemini.svg` | the Google Gemini mark, in `#8E75B2` | none | https://cdn.simpleicons.org/googlegemini | CC0 1.0, from Simple Icons |
| Copilot | `packages/server/icons/copilot.svg` | the GitHub Copilot mark, in black | `packages/server/icons/copilot-dark.svg`, in `#E6EDF3` | https://cdn.simpleicons.org/githubcopilot | CC0 1.0, from Simple Icons |
| OpenCode | `packages/server/icons/opencode.svg` | the OpenCode mark, in black | `packages/server/icons/opencode-dark.svg`, in `#E6EDF3` | https://cdn.simpleicons.org/opencode | CC0 1.0, from Simple Icons |
| Cursor | `packages/server/icons/cursor.svg` | the Cursor mark, in black | `packages/server/icons/cursor-dark.svg`, in `#E6EDF3` | https://cdn.simpleicons.org/cursor | CC0 1.0, from Simple Icons |
| Qwen | `packages/server/icons/qwen.svg` | the Qwen mark, in `#6950EF` | none | https://cdn.simpleicons.org/qwen | CC0 1.0, from Simple Icons |
| Cline | `packages/server/icons/cline.svg` | the Cline mark, in `#18181B` | `packages/server/icons/cline-dark.svg`, in `#E6EDF3` | https://cdn.simpleicons.org/cline | CC0 1.0, from Simple Icons |
| dsh | `packages/server/icons/dsh.svg` | none yet: tell me the mark you want | none | please name the vendor's page | to be stated |

The first eleven rows are plugin icons under their package, and the rest are the marks the host ships in `packages/server/icons/`.
The GitHub, Jira Cloud, Linear, Postgres, Resend and WhatsApp pieces show their host mark, not their CDN logo (Softov, 2026-11-13, plan plugin/20261113-0534). The Postgres mark is new: say whether it stays.
A plugin, an adapter or an ACP template names a mark as `{ "src": "mark:<name>" }`, and the host resolves it.
Codex reuses `openai.svg`, which the host ships already.
The Resend and GitHub marks are black, so each has a dark file in `#E6EDF3`, as Copilot and Cursor have.
Kilo, Goose, pi, Devin, Amp and omp show the engine's icon, because no mark was found with a clear source and a licence.
dsh needs a mark from you before its row can name one.

Lucide has no `tunnel` icon, so the Dev Tunnel candidate is `waypoints`, which draws a path between points.
Cofold keeps a Lucide drawing until you give a vendor mark.
The Activepieces mark, the Claude starburst and the pi mark are the vendors' trademarks, and a package ships them under the vendor's terms.

## Reply

Write "keep" or "replace" for each row, or what you want instead.
