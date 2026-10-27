# Terminals

A **terminal** is a shell on the machine the daemon runs on, opened as a channel of its own: under the URI a client chose, or, for one this host opens for a chat, `ahp-terminal://shell/<base64url(chat)>/<key>`. It is a real process with a real filesystem under it, so it is opened only for somebody who signed in and whose role covers `terminal:create` - a terminal is arbitrary code on the machine, and the grant is what decides who gets one. What it opens, and how its output reaches a client, is `packages/sdk/src/machines/terminals.ts` and `packages/sdk/src/host/terminals.ts`.

Terms, one line each:

| Term | |
| --- | --- |
| a terminal | One shell process, as a channel: its own URI, its own state, its own actions |
| the terminal store | The port that spawns shells - `TerminalStore`, pipes unless it was handed a pseudoterminal binding |
| a pseudoterminal | A real terminal device, handed in as native code; what makes the shell's own marks readable |
| the claim | Who holds the terminal: a connection, or a session and the chat inside it |
| the scrollback | Everything the shell has written, kept so a client subscribing later still sees it |
| the root list | `terminals` on root state: every open terminal's `TerminalInfo` |
| command detection | Whether the shell prints its own command boundaries, which only a pseudoterminal gives |
| a retained terminal | One a tool call names, rebuilt exited from the output this host kept once nothing live answers for it |

## Where it runs

On the daemon's machine, which is the only place it can run: the store spawns a process locally, and there is no scheme for a shell somewhere else - a session in a machine runs its own commands inside that machine (see [COMPUTERS.md](../plugins/COMPUTERS.md)).

A client's terminal starts in the directory it named, decoded from the `file:` URI it sent, and naming none gives the host's own directory. Any directory is accepted, `file:///etc` included: the reference host opens one wherever it is asked, and the connection's token is what decides who gets a shell rather than the path. A directory that is not there is a shell that fails to start, not a refusal - the failure is written into the terminal's own output and the exit code is `127`.

What the directory decides is smaller: a command that ran in it may have moved it - a commit, a checkout, anything that wrote a file - so when the process exits this host refreshes the changeset of whichever session directory the terminal was in. A terminal outside every session's directory refreshes nothing.

`ahp-terminal:` is this host's spelling. VS Code names the terminals it opens itself `agenthost-terminal:/<id>`, and the gate treats both as terminals by the channel's kind as well as by its scheme.

## Pipes, or a pseudoterminal

The store runs shells on pipes unless it was handed a pseudoterminal binding, and the state says which the client is reading: `isPty` and `supportsCommandDetection` are both false on pipes, because there is no terminal device and no shell running a prompt of its own to emit anything. Output is then plain text, and anything a client draws with cursor movement will not look right - said in the state rather than discovered. This is what the protocol's `isPty: false` is for.

The daemon hands one in when the machine has it: `node-pty`'s `spawn`, loaded by name at runtime, because a native binding that does not match its runtime aborts the process rather than throwing and is nothing a `try`/`catch` can hold. So the import is tried in a child of the same runtime first and repeated here only once that child has survived it - `packages/server/src/pty.ts`. With it, shells run under a real terminal, and the shell's own marks become facts.

`TERM` follows the same answer: the daemon's own, or `xterm-256color` when it has none, under a pseudoterminal, and `dumb` without one.

## Who opens one

Three ways in, and the difference between them is the claim and the shell.

A **client** asks with `createTerminal`, naming the channel URI itself so it can subscribe without a round trip in between. The claim is absent for "this connection", and any other claim is parsed rather than taken: a claim that is not one of the two kinds is refused with `-32602`, because a client that meant to name a session and got it wrong should hear about it rather than quietly become the owner. A URI already in use is `-32003`.

A **`!` command** in a turn's text runs in a terminal of its own, opened by the host. The protocol standardises the convention rather than the behaviour, and this host advertises `!` as `terminalCommandPrefix` when it has a store at all. The command runs in the session's first working directory, and its claim names the session, the chat, the turn and the tool call, which is what the finished tool call points at - so the terminal is named after that chat, with the call's id as its key. A lone `!`, or one followed only by spaces, is not a command - it is somebody typing an exclamation point, and it goes to the agent. A backend that implements no `ran` is told `"<provider> cannot run a command in a turn; use a terminal instead"` rather than being sent one as a question.

A **backend** asks through `start.terminals.open`, the factory the host wraps around the store so that a terminal it opens is a channel the host owns rather than one nobody lists. The backend says the directory, the program and its arguments, and nothing else; the host mints the URI under the backend's chat and a key of its own, registers the channel, puts it on the root list and routes its actions. The handle it gets back reads the output the way a client reads it, waits for the exit, writes, resizes, kills - which leaves the row listed, because a transcript may still point at the channel - and releases, which ends a process that has not already gone and takes the row off the list. A release that only dropped the row would leave a shell nothing lists and nothing can reach. A tool call that names a released terminal still opens it, [rebuilt](#a-terminal-a-tool-result-names) from what the host kept.

Both the `!` command and a backend's terminal run the daemon's own shell: `$SHELL`, then `/bin/sh` - or, on Windows, PowerShell 7, then the Windows PowerShell, then `cmd.exe`, because `SHELL` there is a Git Bash leftover rather than a Windows shell. `defaultShell` is a connection's preference and neither of these has a connection - a backend has a session, and an automation fires with nobody connected at all - so there is nobody here whose choice it could be. Answered that way on purpose: a person's shell must not be what a turn runs, which is also the path where writing a file and naming it in `defaultShell` would make the next tool call run it.

## One command, or a shell to sit in

A terminal given a `command` runs it and exits: the shell is started with `-c`, which is the only completion signal there is on pipes. Whether `args` is given decides how that command reaches the shell, and the two are not the same thing.

With `args` the caller is naming a program, so the argv is quoted word by word and the shell runs exactly that. Without it the caller is handing over a line - a `!` command typed by a person is one - and that line is already shell syntax: quoting it would ask the shell for a program named after the whole line, which is a command that never existed.

A terminal with no command is a shell reading from a pipe that stays open, which is what somebody typing into one wants. It ends when it is disposed, when it is released, or when the shell decides to.

Every terminal gets the host's environment, then the caller's variables over it, then its own size and kind over both: a terminal's own `TERM`, `COLUMNS` and `LINES` are not something a command may disagree with.

## What a client sees

The channel's state is `title`, `cwd`, `cols`, `rows`, `content`, `claim`, `isPty`, `supportsCommandDetection` and `lifecycle`. `content` is one `unclassified` part, because without command detection there are no boundaries to divide the output at - and it is the protocol's shape rather than a flat string.

The exit code is inside `lifecycle`: `{ status: 'running' }` while the process is there, `{ status: 'exited', exitCode }` once it is gone. That is what 0.9.0 requires and it is not optional there, so a client reading it on an older-shaped terminal would read a process that never exits. This host negotiates down to 0.5.1, so it also sends the flat `exitCode` every version before 0.9.0 reads.

`terminal/exited` is announced when the pipes drain rather than when the process goes. The two are not the same moment, and between them there is output written and not yet read - which is exactly what a `!` command in a composer reads back. On pipes that is `close`; the process's own `exit` is what records the code and the signal, and the announcement waits for the pipes. It goes out once, so a spawn that failed and fired both `error` and `close` does not report a terminal that died, came back, and died again.

A process killed by a signal reports `128`, with the signal named beside it, because a runtime that reports no exit code leaves nothing else to say and reporting nothing reads as still running. The name is what makes it readable: a caller told only `128` cannot tell somebody's SIGINT from a program that chose to exit 128.

The scrollback is everything written so far, capped at 200,000 characters - a terminal left running `tail -f` for a day is a host holding a day of output for a client that may never come back. A client subscribing late is sent it, so a terminal watched from the middle still shows what happened before it arrived. `clear` drops the scrollback and keeps the size, the title and the claim: a client clears a terminal to stop reading what is there, not to give it up. Nothing reaches the process, which has no notion of its own output having been discarded.

Size defaults to 80 columns and 24 rows. `resize` records the new size and tells a pseudoterminal about it, which sends `SIGWINCH` itself; on pipes nothing is signalled and the size is kept because the state reports it and a client draws to it. `^C` is the other half of the same difference: a pseudoterminal has a line discipline that sees the byte and signals the foreground group, so the byte is written through and nothing clever happens. Pipes have none, so the byte would arrive as input and the command would run on - a terminal a runaway command cannot be stopped in. This host turns it into `SIGINT` to the child's own process group, named by the child's pid and only when there is one: to `kill` group `0` would mean every process in this process's group, so a shell that never started would signal the host.

A terminal's title is the caller's `name`, or the shell's own basename. A `!` command's is `Terminal`.

## A terminal a tool result names

A tool call's content may name a terminal, and the protocol says a client can open it for as long as the call's chat lasts - exited, with its output - whether or not a process is still behind it. So a `!` command's terminal and a backend's are named after their chat, and when one exits its output, its exit code and whether a pseudoterminal wrote it are kept: one JSON file in the session's own folder of the session store, under the chat and the key. The output is the scrollback, capped as it is, and an output over 10 MB is not kept. A backend that has an output no terminal printed - a file its harness saved for a result too large to send - keeps it the same way through `Start.terminalOutputs`, and names the terminal `uri(key)` answers ([AGENT.md](AGENT.md)).

A subscribe that no live terminal answers is answered from that file. The host reads the chat the name carries - its live turns, or its transcript when nothing runs it - finds the newest call whose content names the terminal, and answers an exited state: the output kept, or the call's preview where nothing was, the call's exit code or else the one kept, the call's title, and a claim of the session that holds the chat now, the chat and the call. A call that says its preview was cut short, with nothing kept to show the rest, is refused as an unknown terminal is, and so is a name whose chat or call is gone. Nothing follows the snapshot. This is how a call keeps its terminal after a client disposed it, after a backend released it, after the session slept and after the daemon started again.

What is kept goes with what it belongs to: with the turns a truncation drops, with a chat a client disposes, and with the session. A chat that moves takes it to the session it moved to. A store that keeps no folders keeps nothing, and a call's preview is then all a rebuilt terminal holds. A client cannot open a shell of its own under one of these names: `createTerminal` refuses it with `-32003`.

## Command boundaries

Only under a pseudoterminal, and this host says so twice: `terminal/commandDetectionAvailable` once at the start, and `supportsCommandDetection` on the state. A client MUST check before relying on the boundaries.

The shell prints them itself, mixed into its output, and this host reads them out and leaves the rest alone - the bytes still reach the client whole, because this is a reader and not a filter. OSC 133 gives the boundaries: `A` before the prompt, `C` where a command starts and `D;<code>` when it finished, and OSC 7 gives the directory. From those: `terminal/commandExecuted` with the command line read back off what was typed since the prompt, `terminal/commandFinished` with the shell's own exit code and the duration since `C`, and `terminal/cwdChanged`.

The command line can only be read that way because the input is watched as well: a shell echoes what was typed, but the echo arrives as output, so the bytes of `terminal/input` are what a `C` mark is read against.

## Configuration keys

One key changes a terminal, and it is root config rather than the file.

| Key | Values | Default | What changes |
| --- | --- | --- | --- |
| `defaultShell` | an absolute path | the system shell | The shell a host-managed terminal opens |

It is **per connection**: it is kept on the connection that pushed it and read back by that connection, so two people on one daemon each get theirs and neither can name the binary the other's terminal opens. VS Code pushes it out of `terminal.integrated.agentHostProfile.<os>` when it connects, which is why it is a preference of a person rather than a key of the deployment. Pushing it needs no grant and only a sign-in, because it changes nothing anybody else reads.

It reaches two of the three ways in: a client's terminal uses it, and a `!` command and a backend's terminal do not, for the reason above.

The rest of the root config is [HOST.md](HOST.md#root-config), and the daemon's own keys are [HOST.md](HOST.md#configuration-keys). Nothing in either turns terminals off: a host built without a terminal store answers `This host does not serve createTerminal yet` and advertises no `terminalCommandPrefix`, and a plugin's `registerTerminals` is what puts one there - [BUILD-A-HOST.md](BUILD-A-HOST.md#terminals), [PLUGINS.md](../plugins/PLUGINS.md).

## Commands

There is no `ahpd terminal`. A terminal is driven over the protocol, and the verbs are these.

| Command | What it does |
| --- | --- |
| `createTerminal` | Open a shell, under the URI the client chose, in the directory it names - any of them, or the host's own when it names none |
| `disposeTerminal` | End one and take it off the root list. `-32008 No terminal at <uri>` when there is none |
| `subscribe` | The snapshot - state and scrollback - and every action after it |
| a `!command` in a turn | Run one command in a terminal of its own and read it back as the turn's answer |
| `ahp_terminals` | Read-only: the terminals this host has open, for the model of a session - [TOOLS.md](TOOLS.md) |

The root channel is where a terminal is listed and where it says it moved: `terminals` on root state, and `root/terminalsChanged` carrying the whole list when one opens, closes or exits on its own. Every client that completes a handshake is shown that list, including each terminal's URI, title and claim, because root state is one state for the whole host and is never filtered per person. Knowing a channel is not being able to drive it: a dispatch into one is refused unless the person signed in and their role covers the operation - decision [A role refuses at the dispatch boundary, and never hides root state](../../.project/decisions/a-role-refuses-at-the-dispatch-boundary.md).

## Grants

Everything a terminal does is one of its operations, and read and write are the groups those fall into - [USERS.md](USERS.md#roles).

| What | Grant |
| --- | --- |
| Open and close one | `terminal:create`, `terminal:dispose` |
| Read it | `terminal:output`, asked of the channel rather than the method |
| Type into it, resize it | `terminal:input`, `terminal:resize` |
| Take it, rename it, clear it | `terminal:claim`, `terminal:rename`, `terminal:clear` |

`member` holds `terminal:read` and `terminal:write`, so it holds every row above. `guest` holds neither: it can neither open a shell nor read one. A `!` command asks for no grant of its own, because it is part of a turn - the grant is `chat:send`.

## See also

| | |
| --- | --- |
| [AHP.md](AHP.md#terminal--11-of-11-) | The terminal channel's eleven actions, one line each |
| [TOOLS.md](TOOLS.md) | `ahp_terminals`, and the rest of what a session's model is offered |
| [USERS.md](USERS.md#roles) | What the grants are, and what each built-in role holds |
| [BUILD-A-HOST.md](BUILD-A-HOST.md#terminals) | The `terminals` port, for a host built from the SDK |
| [COMPUTERS.md](../plugins/COMPUTERS.md) | A session in a machine, where its commands run |
