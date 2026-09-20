---
title: The standalone host prints its connection token on stdout while keeping it out of its log file
target: https://github.com/microsoft/vscode
date: 2026-09-19
refs:
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostServerMain.ts#L344-L351 - the two lines that differ, one line per address
---

## Summary

When the agent host is started standalone it prints its connect URLs with the connection token in the query string, one line per local and network address.
Immediately beside each printed line is a `logService.info` call for the same address, and that one deliberately carries no token, so the host's log file holds a URL that cannot be used on its own.

The two lines are three lines apart in the same loop:

```
log(`  Local:   ${url}${connectionQuery}`);
logService.info(`[AgentHostServer] Local:   ${url}`);
```

## Why it is worth a look

The asymmetry is the interesting part.
Somebody decided the log file should not carry the credential, which is the right call for a file that is read, copied into issues and kept.
The same loop then writes the credential to stdout, which is captured at least as often: a terminal scrollback, a CI job log, a support transcript, or a bug report with the console output pasted into it.

So this does not read as a decision that stdout is safe, it reads as a decision that was made for the log file and not carried the last three lines to the terminal.

## Suggested change

Make the printed line match the logged one: a token-free URL on stdout, and the token on a line of its own, or behind an explicit flag for the case where the directly usable URL is what is wanted.
A user who needs one paste keeps it, and a user who is capturing output gets a URL with no credential in it.

## Tradeoff to acknowledge

The behaviour is deliberate enough that it may be intentional, and there is a real cost to changing it: a URL that carries the token is one paste into a client, and a URL plus a separate token is two, or a small assembly step.
If the convenience is worth more than the exposure, then documenting in the README and in the startup output that stdout carries a credential would be enough, and it is cheaper than changing the lines.

## How a sibling project resolved it

The daemon in `softov/ahpd` prints where the secret came from and never the secret, with the reasoning in a comment beside the line that does it (`packages/server/src/main.ts:462-472`), and the cost is that a user assembles the URL by hand.
That is the other side of the same trade, and it is mentioned only to show that both choices are being made in the open rather than one being obviously right.
