---
title: Check the agent terminal tool and ask_user on macOS
plans:
  - plans/host/20261103-1620-a-shell-runs-vscodes-shell-integration/plan.md
  - plans/host/20261103-1620-an-agent-asks-the-person/plan.md
  - plans/host/20261103-1620-the-agent-terminal-tool/plan.md
---

# Check the agent terminal tool and ask_user on macOS

The plans of #209, #210 and #211 passed on Linux on 2026-11-04, with the async commands of #213.
On Windows, #209 and #210 passed on 2026-11-12 (Softov). #211 does not apply there, as *The agent terminal tool (#211)* says.
Left: the three sections once on a Mac.

## Set up

On that machine, start a daemon built from main, as [macos-checks.md](macos-checks.md) and [windows-machine-paths-checks.md](windows-machine-paths-checks.md) do. In the commands below, put that daemon's address, its token file and its checkout in place of `ws://127.0.0.1:37537`, the Linux token path and `/github/ahpd`.

## Shell integration (#209)

Passed on Windows on 2026-11-12.

1. In ahpw, open any session on the test daemon, and press **New terminal** in the session's header. Run `ls`, then `false`.
2. Check that each command is its own part, with exit code 0 for `ls` and 1 for `false`. On Windows, run them in PowerShell, with `Get-ChildItem` in place of `ls`.
3. Run `vim`, and check that the client draws it full screen. Quit with `:q`.

## ask_user (#210)

Passed on Windows on 2026-11-12.

1. Open a pi session, and send: `Ask me which colour I like, with the options red and blue, then say my answer.`
2. Check that the question shows in the client with its two options.
3. Pick one, and check that the model says the colour you picked.

## The agent terminal tool (#211)

Not on Windows: the host never offers the tool there, whatever `enableCustomTerminalTool` says, as VS Code leaves the agent its own shell on Windows ([`code://packages/sdk/src/host/tooling.ts#L523-L526`](../../packages/sdk/src/host/tooling.ts#L523-L526)). Run it on the Mac only.

1. In a second terminal, turn the tool on in the root config:

```bash
cd /github/ahpd && AHPD_URL=ws://127.0.0.1:37537 AHPD_TOKEN_FILE=/home/softov/.vscode/cli/agent-host-token node .project/pending/rpc.mjs dispatchAction '{"channel":"ahp-root://","action":{"type":"root/configChanged","config":{"enableCustomTerminalTool":true}}}'
```

2. Open a new Claude session, and send: `Run pwd, then echo hello, with your shell tool.`
3. Check that the call shows a terminal while it runs, and keeps it when it ends.
4. Check that the answer has `Shell ID:` and the output, with no prompt line and no sentinel line before it.
5. Type into that terminal from the client, and check that the shell takes it.

## After the checks

Turn the tool off again, with the command of step 1 of *The agent terminal tool* and `false` in place of `true`.

## Reply

Say which machine you ran it on.
