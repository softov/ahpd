# Terminals

A **terminal** is a shell on the machine the daemon runs on, opened as a channel of its own: under the URI a client chose, or, for one this host opens for a chat, VS Code's retained terminal link `agenthost-terminal://shell/<session id>/<tool call>`, whose JSON query names the storage, the session, the chat and the tool call, and whose chat and tool call find its output once the process is gone. It is a real process with a real filesystem under it, so it is opened only for somebody who signed in and whose role covers `terminal:create` - a terminal is arbitrary code on the machine, and the grant is what decides who gets one. What it opens, and how its output reaches a client, is `packages/sdk/src/machines/terminals.ts` and `packages/sdk/src/host/terminals.ts`.

Terms, one line each:

| Term | |
| --- | --- |
| a terminal | One shell process, as a channel: its own URI, its own state, its own actions |
| the terminal store | The port that spawns shells - `TerminalStore`, pipes unless it was handed a pseudoterminal binding |
| a pseudoterminal | A real terminal device, handed in by the daemon: `node-pty`'s, or Bun's own on Bun; what makes the shell's own marks readable |
| the claim | Who holds the terminal: a connection, or a session and the chat inside it |
| the scrollback | Everything the shell has written, kept so a client subscribing later still sees it |
| the root list | `terminals` on root state: every open terminal's `TerminalInfo` |
| command detection | Whether the shell prints its own command boundaries, which only a pseudoterminal gives |
| a retained terminal | One a tool call names, rebuilt exited from the output this host kept once nothing live answers for it |

## Where it runs

On the daemon's machine, which is the only place it can run: the store spawns a process locally, and there is no scheme for a shell somewhere else - a session in a machine runs its own commands inside that machine (see [COMPUTERS.md](../plugins/COMPUTERS.md)).

A client's terminal starts in the directory it named, decoded from the `file:` URI it sent, and naming none gives the host's own directory. Any directory is accepted, `file:///etc` included: the reference host opens one wherever it is asked, and the connection's token is what decides who gets a shell rather than the path. A directory that is not there is a shell that fails to start, not a refusal - the failure is written into the terminal's own output and the exit code is `127`. Under `node-pty` it is `1`, which `node-pty`'s own child exits with, after writing the failure on Linux and writing nothing on macOS.

What the directory decides is smaller: a command that ran in it may have moved it - a commit, a checkout, anything that wrote a file - so when the process exits this host refreshes the changeset of whichever session directory the terminal was in. A terminal outside every session's directory refreshes nothing.

`ahp-terminal:` is this host's spelling. VS Code names the terminals it opens itself `agenthost-terminal:/<id>`, and the gate treats both as terminals by the channel's kind as well as by its scheme.

## Pipes, or a pseudoterminal

The store runs shells on pipes unless it was handed a pseudoterminal binding, and the state says which the client is reading: `isPty` and `supportsCommandDetection` are both false on pipes, because there is no terminal device and no shell running a prompt of its own to emit anything. Output is then plain text, and anything a client draws with cursor movement will not look right - said in the state rather than discovered. This is what the protocol's `isPty: false` is for. Each pipe is decoded as one UTF-8 stream with the stream's own `setEncoding('utf8')`, as `node-pty` reads its terminal, so a character whose bytes arrive in two reads reaches the client whole.

The daemon hands one in when the machine has it, from `packages/server/src/pty.ts`. With it, shells run under a real terminal, and the shell's own marks become facts.

Under a pseudoterminal the daemon also hands the store a screen, `SpawnScreen`, made from `@xterm/headless` in `packages/server/src/screen.ts`. The store makes one for each terminal it opens that way, feeds it every chunk before it reads the marks in it, and moves and disposes of it with the terminal. `isInAltBuffer()` and `isBracketedPasteMode()` answer from it, so a full-screen program or bracketed paste is a fact rather than a guess from the output, and a program that asks for the cursor position with `ESC[6n` gets the screen's answer written back to its input. A terminal on pipes has none, and a store given no port answers `false` to both and settles `whenAltBuffer()` at once.

On Node and Deno it is `node-pty`'s `spawn`, loaded by name at runtime, because a native binding that does not match its runtime aborts the process rather than throwing and is nothing a `try`/`catch` can hold. So the import is tried in a child of the same runtime first and repeated only once that child has survived it.

On Bun it is Bun's own: `Bun.spawn` with its `terminal` option, as Bun's [Terminal (PTY) support](https://bun.com/docs/runtime/child-process) gives it, wherever Bun makes a terminal. That is Linux and macOS from Bun 1.3.5, which brought `Bun.Terminal`, and Windows, through ConPTY, from Bun 1.3.14. The daemon makes one terminal and closes it at start to see that Bun can. Each member of the port is the one Bun documents: the output is the terminal's `data`, the exit code is what the subprocess's `exited` resolves to, which for a shell a signal ended is `128` plus the signal's number, and `write`, `resize` and `kill` are the terminal's and the subprocess's. The whole output has arrived by the time `exited` resolves, so the exit is said then, and the terminal is closed, as Bun's own example closes it. The terminal's `exit` callback is not used: up to Bun 1.3.13, a terminal that has one makes a start Bun refuses, such as a directory that is not there, crash Bun itself rather than throw. Where Bun leaves a choice open, the binding makes `node-pty`'s, whose terminal is one thing on Unix and another on Windows. On Unix, arguments as one string are refused, and `kill` sends `SIGHUP` when it names no signal. On Windows, `cmd.exe` gets its line as the command line after the file, written as it is, which is how the store hands it the line on pipes too, and `kill` takes no signal and ends the process. On both, input once the terminal has closed is dropped.

Every other Bun runs shells on pipes: a Bun without `Bun.Terminal`, and a Bun that cannot make one, such as Bun 1.3.13 on Windows. `node-pty` is never loaded on Bun: it loads there, so a child survives it, and every shell it starts dies at once.

`TERM` follows the same answer: the daemon's own, or `xterm-256color` when it has none, under a pseudoterminal, and `dumb` without one.

## Who opens one

Three ways in, and the difference between them is the claim and the shell.

A **client** asks with `createTerminal`, naming the channel URI itself so it can subscribe without a round trip in between. It opens in the folder the client names, as a `file:` URI or a path, and in the home folder where the client names none or one that is not a folder on this machine, as [VS Code's terminal manager](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L962-L992) resolves it. The claim is taken as the client sent it, and an absent one is a client's with an empty `clientId`, as VS Code's terminal manager takes it. A URI already in use is refused `Terminal already exists: <uri>`, in VS Code's words. A pseudoterminal is listed on the root, and the request answered, once its shell has printed, exited or ten seconds have passed, as VS Code's terminal manager waits for a prompt; a shell on pipes prints nothing until it is given something to run, so it is listed and answered at once.

A **`!` command** in a turn's text is the host's local command, as VS Code's host has one: the host opens a shell of its own for it, whatever backend the chat has, and no backend is handed the text. The protocol standardises the convention rather than the behaviour, and this host advertises `!` as `terminalCommandPrefix` when it has a store at all. The shell opens in the session's first working directory to sit at its prompt, kept out of the person's history and told nobody is watching it, and its claim names the session, the chat, the turn and the tool call, which is what the finished tool call points at - so the terminal is named after that chat, with the call's id as its key. A pseudoterminal is listed on the root once its shell has printed, exited or ten seconds have passed, and a shell on pipes at once, as a client's is. The command is then typed into the shell, as VS Code's shell command runner types it: a leading space keeps it out of a POSIX shell's history, and its end is read from the shell integration's mark that it finished where the shell writes those, and otherwise from a line the shell echoes after it with its exit code, `<<<COPILOT_SENTINEL_<id>_EXIT_<code>>>>`, which a client reads in the terminal too. The call is a `terminal` call shown as `Terminal`, with the command as its intention, its line and its input, as the reference host's own. Its content names the terminal once it is listed, with `chat/toolCallContentChanged`, so a client watches the output arrive; the completed call names it again, with how the command ended where it has exited, then the text it printed, without escape sequences and cut to its last 80,000 characters. The block says `isPty` as the terminal's state does, so a client knows whether the output holds VT sequences. The call completes in VS Code's words for each of the five ways a command ends: `Ran command`; `Command exited with code <n>`, with `success: false` and no error, since nothing went wrong running it; `Command timed out`, failed, for a command still running after two minutes; `Shell exited unexpectedly`, failed, for a command that ended its shell; `Command is running in the background` once a client claims the terminal for the session with no tool call; and `Command opened an interactive terminal` for one that switches to the alternate screen. One that could not run completes it with `Failed to run command` and the reason as its error. The shell sits on at its prompt until the session goes. The turn completes however the command ended, as the reference host ends a local command's turn. A command runs before the checks that admit a question, as the reference host runs its local commands ahead of its admission, so it runs in a chat that is archived, read-only or whose agent has ended. A command sent as a turn while another turn runs is taken, as any turn is: its start is said at once and takes the running turn's place in every client's state, and the command runs at once while the agent's turn runs on. A command sent as a queued `chat/pendingMessageSet` waits behind the running turn, and runs as the turn the queue drain starts for it once the turn in front of it ends. A session in a machine has its commands run by the host inside, in the machine it works in, since its turns are carried there. A host whose embedder is on its way out ends a command's turn unrun, as it refuses any turn then. A lone `!`, or one followed only by spaces, is not a command - it is somebody typing an exclamation point, and it goes to the agent.

A `!` command's turn is the host's: no agent saw it, so no agent's transcript holds it. When it ends, the host keeps it, as the chat's state holds it, in the session's own folder as a local turn of its chat, anchored to the turn before it by the id the backend's transcript gives that turn - which a backend that names turns its own way says with `onTurnRecorded` ([AGENT.md](AGENT.md)). Every read of a transcript puts the chat's local turns back after the turns they followed, in the order they ran, so after a restart the command is where it was and its terminal opens [rebuilt](#a-terminal-a-tool-result-names) from what it printed. This is the reference host's local turn, kept with its terminal because this host can rebuild the terminal. A local turn whose anchor is no longer in the transcript is dropped, as the reference drops one. A session whose turns are all commands has no transcript, so no backend lists it after a restart: the host keeps it and lists it from its local turns, dated from its first command's start to its last one's end, and it opens with them. It is titled after its first command unless somebody named it, on one line and cut at 200 characters, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionTitleController.ts#L252-L255) seeds a title from a first message. An ACP chat read back after a restart is its server's replay, which names its turns anew on every load, so of its commands only one run before any of its turns comes back.

A **backend** asks through `start.terminals.open`, the factory the host wraps around the store so that a terminal it opens is a channel the host owns rather than one nobody lists. The backend says the directory, the program and its arguments, and the tool call the terminal runs for where it has one; the host mints the URI under the backend's chat and a key of its own, claims it for the session with the chat, the turn running in it and that tool call, as VS Code's shell tool claims an agent's terminal, registers the channel, puts it on the root list and routes its actions. A pseudoterminal goes on the list once its shell has printed, exited or ten seconds have passed, as a client's does. The handle it gets back says whether a pseudoterminal runs it (`isPty`, for a call that names it), reads the output the way a client reads it, waits for the exit, writes, resizes, kills - which leaves the row listed, because a transcript may still point at the channel - and releases, which ends a process that has not already gone and takes the row off the list. A release that only dropped the row would leave a shell nothing lists and nothing can reach. A tool call that names a released terminal still opens it, [rebuilt](#a-terminal-a-tool-result-names) from what the host kept.

Both the `!` command and a backend's terminal run the daemon's own shell: `$SHELL`, then `/bin/sh` - or, on Windows, PowerShell 7, then the Windows PowerShell, then `cmd.exe`, because `SHELL` there is a Git Bash leftover rather than a Windows shell. `defaultShell` is what a client's terminal opens, and neither of these is one - a turn runs the command, and an automation fires with nobody connected at all. Answered that way on purpose: a pushed shell must not be what a turn runs, which is the path where writing a file and naming it in `defaultShell` would make the next tool call run it.

## One command, or a shell to sit in

A terminal given a `command` runs it and exits: the shell is started with `-c`, and its exit is what says the command finished. Whether `args` is given decides how that command reaches the shell, and the two are not the same thing.

With `args` the caller is naming a program, so the argv is quoted word by word and the shell runs exactly that. Without it the caller is handing over a line, and that line is already shell syntax: quoting it would ask the shell for a program named after the whole line, which is a command that never existed.

A terminal with no command is a shell reading from a pipe that stays open, which is what somebody typing into one wants, and what a `!` command is typed into. It ends when it is disposed, when it is released, or when the shell decides to.

A shell opened to sit in under a pseudoterminal starts with VS Code's shell integration, so most shells mark their commands instead of only a person's own prompt doing it. The daemon hands the store a port, `ShellIntegration`, and the store asks it once, for a shell with no command, under a pseudoterminal, whose `machine` is absent: a shell given a command runs it and exits, a terminal on pipes has no prompt to mark, and a shell in a machine has no scripts copied or mounted there. The port answers the arguments the shell should start with instead and the variables to mix into its environment, or nothing, and a port that throws leaves the shell starting as it did. The scripts are `packages/server/shellintegration/`, the seven from VS Code unchanged under its MIT license, and `packages/server/src/shellintegration.ts` is the injection: `bash`, `zsh`, `fish` and `pwsh` get theirs, `zsh` also gets a folder of its own for the four startup files it reads, and a shell with no script - `sh`, `cmd.exe` - is left exactly as it was. The zsh folder is `<tmp>/<user>-ahpd-zsh`, a name another user can make first, so by default a folder there that is a link or another user's starts the shell with no integration; the daemon's `zshFolder` set to `asFound` takes whatever is there, as VS Code does.

Every terminal gets the host's environment, then the caller's variables over it, then its own size and kind over both: a terminal's own `TERM`, `COLUMNS` and `LINES` are not something a command may disagree with. Two flags a caller can open a terminal with are asked last, the way VS Code's agent host sets them: `preventShellHistory` sets `VSCODE_PREVENT_SHELL_HISTORY=1`, which the scripts read to keep what the shell runs out of the person's history, and `nonInteractive` sets `LC_ALL=C.UTF-8`, `PAGER`, `GIT_PAGER` and `GH_PAGER` empty, `GIT_TERMINAL_PROMPT=0` and `DEBIAN_FRONTEND=noninteractive`, so nothing pages or asks a question nobody is there to answer. A zsh opened that way also gets an empty `PROMPT_EOL_MARK`, which is the `%` it would otherwise print after output with no newline.

## What a client sees

The channel's state is `title`, `cwd`, `cols`, `rows`, `content`, `claim`, `isPty`, `supportsCommandDetection` and `lifecycle`. `content` holds the parts a client watching from the start built from the same actions, because this host folds each action it sends through the protocol package's own `terminalReducer`: an `unclassified` part for output no command claims, and a `command` part with its line, output, exit code and duration for each command the shell marks. A shell that marks nothing has one `unclassified` part, and a client subscribing late reads the same parts as one that watched.

The exit code is inside `lifecycle`: `{ status: 'running' }` while the process is there, `{ status: 'exited', exitCode }` once it is gone. That is what 0.9.0 requires and it is not optional there, so a client reading it on an older-shaped terminal would read a process that never exits. This host negotiates down to 0.5.1, so it also sends the flat `exitCode` every version before 0.9.0 reads.

`terminal/exited` is announced when the pipes drain rather than when the process goes. The two are not the same moment, and between them there is output written and not yet read - which is exactly what a terminal opened for one command reads back. On pipes that is `close`; the process's own `exit` is what records the code and the signal, and the announcement waits for the pipes. It goes out once, so a spawn that failed and fired both `error` and `close` does not report a terminal that died, came back, and died again.

A process killed by a signal reports `128`, with the signal named beside it, because a runtime that reports no exit code leaves nothing else to say and reporting nothing reads as still running. The name is what makes it readable: a caller told only `128` cannot tell somebody's SIGINT from a program that chose to exit 128.

The scrollback is everything written so far, capped at 200,000 characters - a terminal left running `tail -f` for a day is a host holding a day of output for a client that may never come back. Past the cap, whole parts go from the front first, and then the oldest characters of the first part that is left, as the reference host trims its own. A client subscribing late is sent it, so a terminal watched from the middle still shows what happened before it arrived. `clear` drops the scrollback and keeps the size, the title and the claim: a client clears a terminal to stop reading what is there, not to give it up. Nothing reaches the process, which has no notion of its own output having been discarded.

Size defaults to 80 columns and 24 rows. `resize` records the new size and tells a pseudoterminal about it, which sends `SIGWINCH` itself; on pipes nothing is signalled and the size is kept because the state reports it and a client draws to it. `^C` is the other half of the same difference: a pseudoterminal has a line discipline that sees the byte and signals the foreground group, so the byte is written through and nothing clever happens. Pipes have none, so the byte would arrive as input and the command would run on - a terminal a runaway command cannot be stopped in. This host turns it into `SIGINT` to the child's own process group, named by the child's pid and only when there is one: to `kill` group `0` would mean every process in this process's group, so a shell that never started would signal the host.

A terminal's title is the caller's `name`, or the shell's own basename. A `!` command's is `Terminal`.

## A terminal a tool result names

A tool call's content may name a terminal, and the protocol says a client can open it for as long as the call's chat lasts - exited, with its output - whether or not a process is still behind it. So a `!` command's terminal and a backend's are named after their chat, and what each printed, its exit code and whether a pseudoterminal wrote it are kept, a `!` command's when the command ends and a backend's when its terminal exits: one JSON file in the session's own folder of the session store, under the chat and the key. The output is the scrollback, capped as it is, and an output over 10 MB is not kept. A backend that has an output no terminal printed - a file its harness saved for a result too large to send - keeps it the same way through `Start.terminalOutputs`, and names the terminal `uri(key)` answers ([AGENT.md](AGENT.md)).

A subscribe that no live terminal answers is answered from that file. The host reads the chat the name carries - its live turns, or its transcript when nothing runs it - finds the newest call whose content names the terminal, and answers an exited state in [VS Code's five fields](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L273-L284): the call's title, the output kept or the call's preview where nothing was, an exited lifecycle with the call's exit code or else the one kept, a claim of the session that holds the chat now, the chat and the call, and whether a pseudoterminal wrote it. A call that says its preview was cut short, with nothing kept to show the rest, is refused as an unknown terminal is, and so is a name whose chat or call is gone. Nothing follows the snapshot. This is how a call keeps its terminal after a client disposed it, after a backend released it, after the session slept and after the daemon started again.

What is kept goes with what it belongs to: with the turns a truncation drops, with a chat a client disposes, and with the session. A chat that moves takes it to the session it moved to. A store that keeps no folders keeps nothing, and a call's preview is then all a rebuilt terminal holds. A client cannot open a shell of its own under one of these names: `createTerminal` refuses it with `-32003`.

## Command boundaries

Only under a pseudoterminal, and only once the shell has marked one: a shell may print no marks at all. From the first mark this host says so twice, with `terminal/commandDetectionAvailable` once and with `supportsCommandDetection` on the state. A client MUST check before relying on the boundaries.

The shell prints the marks itself, mixed into its output, and this host takes them out of it before the output goes to the client, as the protocol requires of a server: a client would otherwise count them as output. OSC 133 gives the boundaries: `A` before the prompt, `C` where a command starts and `D;<code>` when it finished, and OSC 7 gives the directory. From those: `terminal/commandExecuted` with the command line read back off what was typed since the prompt, `terminal/commandFinished` with the shell's own exit code and the duration since `C`, and `terminal/cwdChanged`. Each goes out where its mark stood, after the output printed before it, so the output between a command's `terminal/commandExecuted` and its `terminal/commandFinished` is that command's. A mark that arrives in two reads of the pseudoterminal is held for the second, up to 1,024 characters, and anything still held when the shell exits goes out as output.

The command line can only be read that way because the input is watched as well: a shell echoes what was typed, but the echo arrives as output, so the bytes of `terminal/input` are what a `C` mark is read against.

VS Code's scripts write the same events as OSC 633, and the store reads them too, because a shell started with the integration writes those rather than OSC 133. `A`, `B`, `C` and `D;<code>` mean what their OSC 133 twins mean, `P;Cwd=<path>` is the directory as a path rather than a URI, and `E;<line>;<nonce>` is the command line itself, which is why the line is the one the shell ran rather than one read back off the echo - a `;` in it arrives escaped, as `\x3b`. A line counts only when its nonce is the terminal's own, so a program that prints one cannot pass for the shell; the nonce is generated for each terminal and given to the script through the environment. Once a shell writes OSC 633 its OSC 133 marks are still taken out of the output but no longer read, because a prompt set up for another terminal may write both and a command would otherwise be counted twice.

## Configuration keys

One key changes a terminal, and it is root config rather than the file.

| Key | Values | Default | What changes |
| --- | --- | --- | --- |
| `defaultShell` | an absolute path | the system shell | The shell a host-managed terminal opens |

It is one value for the whole host: the last push from any client sets it, and every client's terminal opens it where this machine can run it and the system shell otherwise, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L949-L960) reads it. VS Code pushes it out of `terminal.integrated.agentHostProfile.<os>` when it connects to a host on its own machine. Pushing it needs `config:change`, because it changes the host for everybody.

It reaches one of the three ways in: a client's terminal uses it, and a `!` command and a backend's terminal do not, for the reason above.

The rest of the root config is [HOST.md](HOST.md#root-config), and the daemon's own keys are [HOST.md](HOST.md#configuration-keys). Nothing in either turns terminals off: a host built without a terminal store answers `Method not found: createTerminal` and advertises no `terminalCommandPrefix`, and a plugin's `registerTerminals` is what puts one there - [BUILD-A-HOST.md](BUILD-A-HOST.md#terminals), [PLUGINS.md](../plugins/PLUGINS.md).

## Commands

There is no `ahpd terminal`. A terminal is driven over the protocol, and the verbs are these.

| Command | What it does |
| --- | --- |
| `createTerminal` | Open a shell, under the URI the client chose, in the folder it names, or the home folder where it names none or one that is not there |
| `disposeTerminal` | End one and take it off the root list. A terminal this host does not hold is closed already, answered `null` as one it closed is, as VS Code's host answers it |
| `subscribe` | The snapshot - state and scrollback - and every action after it |
| a `!command` in a turn | Run one command in a terminal of its own and read it back as the turn's answer |
| `ahp_terminals` | Read-only: the terminals this host has open, for the model of a session - [TOOLS.md](TOOLS.md) |

The root channel is where a terminal is listed and where it says it moved: `terminals` on root state, and `root/terminalsChanged` carrying the whole list when one opens, closes or exits on its own, and after every title and claim. Every client that completes a handshake is shown that list, including each terminal's URI, title and claim, because root state is one state for the whole host and is never filtered per person. Knowing a channel is not being able to drive it: a dispatch into one is refused unless the person signed in and their role covers the operation - decision [A role refuses at the dispatch boundary, and never hides root state](../../.project/decisions/a-role-refuses-at-the-dispatch-boundary.md).

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
