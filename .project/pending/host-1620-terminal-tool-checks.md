---
title: Check the agent terminal tool, ask_user and async commands
plans:
  - plans/host/20261103-1620-a-shell-runs-vscodes-shell-integration/plan.md
  - plans/host/20261103-1620-an-agent-asks-the-person/plan.md
  - plans/host/20261103-1620-the-agent-terminal-tool/plan.md
  - plans/host/20261103-1620-an-async-command-is-a-background-row/plan.md
---

# Check the agent terminal tool, ask_user and async commands

Four plans merged on 2026-11-03 and 2026-11-04: #209, #210, #211 and #213.
Each plan has one check that no gate covers: a run on a live daemon.

## Set up

Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

## Shell integration (#209)

1. Open a terminal in ahpw or ahpc, and run `ls`, then `false`.
2. Check that each command is its own part, with exit code 0 for `ls` and 1 for `false`.
3. Run `vim`, and check that the client draws it full screen. Quit with `:q`.

## ask_user (#210)

1. Open a pi session, and send: `Ask me which colour I like, with the options red and blue, then say my answer.`
2. Check that the question shows in the client with its two options.
3. Pick one, and check that the model says the colour you picked.

## The agent terminal tool (#211)

1. In a second terminal, turn the tool on in the root config:

```bash
cd /github/ahpd && AHPD_URL=ws://127.0.0.1:37537 AHPD_TOKEN_FILE=/home/softov/.vscode/cli/agent-host-token node .project/pending/rpc.mjs dispatchAction '{"channel":"ahp-root://","action":{"type":"root/configChanged","config":{"enableCustomTerminalTool":true}}}'
```

2. Open a new Claude session, and send: `Run pwd, then echo hello, with your shell tool.`
3. Check that the call shows a terminal while it runs, and keeps it when it ends.
4. Check that the answer has `Shell ID:` and the output.
5. Type into that terminal from the client, and check that the shell takes it.

## Async commands (#213)

1. With the tool still on, send: `Run "sleep 5; echo done" with mode=async.`
2. Check that the call answers at once, and that a background row shows with the command and a stop.
3. Check that the row goes after about five seconds, and that a new turn starts with `done` in it.
4. Send: `Run "sleep 60" with mode=async.` Press the row's stop, and check that the row goes.

## After the checks

Turn the tool off again, with the command of step 1 of *The agent terminal tool* and `false` in place of `true`.

## Reply
