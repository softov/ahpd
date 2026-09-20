---
title: The ready connect URL lives in the daemon record, never on stdout
status: accepted
date: 2026-09-19
refs:
  - code://packages/server/src/main.ts#L462-L472 - the startup lines, and the comment that says why the secret is not among them
  - code://packages/server/src/daemon.ts#L133-L144 - the 0600 record the detached daemon writes about itself
  - src/vs/platform/agentHost/node/agentHostServerMain.ts#L342-L348 - the reference host, which prints its URLs with the token in them, inside the clone
---

## Context

The reference host prints its connect URLs with the token in the query, so a person can copy one and connect.
This daemon does the opposite on purpose: stdout carries where the secret came from and never the secret, because stdout is a log and a log is where credentials should not end up, and that rule is stated in a comment beside the line that keeps it.
The cost is that connecting means assembling the URL by hand from a printed origin and a token the user has to find.

Asked on 2026-09-19 whether to match the reference, the answer was: "Keep stdout token-free; put the ready URL in the 0600 daemon record."

## Decision

stdout stays token-free, and the detached daemon's record carries a ready `ws://<host>:<port>/?tkn=<token>` URL beside the fields it already holds, in the same 0600 file.

## Consequences

Connecting becomes copying a line out of the record rather than assembling one, and the record has to be rewritten when the token changes, which it already is whenever the daemon writes itself.
The rule now has two ends instead of one: the startup line may not print the token, and anything that prints the record has to keep not printing it, which is a thing to check in `ahpd status` rather than assume.
A record copied or synced to another machine hands over the host with it, which is why the file mode matters more than it did.

## Options

Printing the token on stdout like the reference was rejected: it is one command to connect, and it puts a credential into log files and terminal scrollback that outlive the connection.
Keeping both the log and the record token-free was rejected: it is the safest of the three and it leaves every connection to be assembled by hand, which is the annoyance that made the reference print its URL in the first place.
