---
title: Check a piece action with a file
plans:
  - plans/plugin/70-a-piece-action-takes-a-file/plan.md
---

# Check a piece action with a file

plugin/70 is on main (#103). A piece action takes a file from the session's attachments or from a URL. Its tests use a fake piece.

## Set up

Run this from a terminal that is not a Claude Code session.

Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

Then bind a connector to a session whose piece has an action with a required `FILE` field. Slack's `uploadFile` (`ap_slack_uploadFile`, field `file`) and Jira Cloud's `upload_attachment` have one.

## Steps

1. In that session, attach a file, and ask the agent to run the action with the attachment's name.
2. Check that the action receives the file.
3. Run the action again with an `https:` URL of a public file.
4. Run it with `https://127.0.0.1/x`, and check that the refusal names only the host.
5. Set `"networkMode": "STRICT"` in the plugin options, and run step 4 again. Check that the refusal names loopback. With the default mode, the refusal comes from the failed read.
6. Run an action that writes a file, and check that the file is in the session's attachments.

## Reply

Write "pass", or say which step stopped.
