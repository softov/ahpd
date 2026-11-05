# Sessions

A **session** is one agent working in one place. It is what owns the work: the settings it runs on, the directories it may touch, whose it is and what it is charged to. The conversation happens in a **chat** inside it, and one session may hold several - [CHATS.md](CHATS.md).

Terms, one line each:

| Term | |
| --- | --- |
| a session | One backend, one place to work, one set of settings, and the chats inside it |
| the backend | The agent runtime that runs it, named by `provider` - `claude` here, or a plugin's |
| the owner | Whose work it is, as `user:<id>` or `root:<host>` |
| the scope | The team and project the work is charged to |
| isolation | Whether it works in the folder itself or in a git worktree of its own |
| the catalogue | What `listSessions` answers from: the sessions running now, and the rows the backend has written down |

## The life of a session

A client chooses a session's URI and sends it as `channel`, and the session is held under that URI: `ahp-session:/<id>` with the id the client chose, `<provider>:/<id>` with that provider, or a scheme of the client's own. That is what makes a session addressable before this host has answered. The client subscribes to a URI it invented and the snapshot is what comes back. A session this host makes itself is `ahp-session:/<id>`, and a session that already exists keeps the name it has - decision [A new session is held as `ahp-session:/<id>`, and an existing session keeps its `<provider>:/<id>` name](../../.project/decisions/a-new-session-is-held-under-the-protocols-uri.md). The one exception is a session an agent's tool makes during a turn an older VS Code window sent, which is `<provider>:/<id>` so that window can address it. A session is answered under its one URI for every client, and the id inside it is read only from that URI - [Session URIs](AHP.md#session-uris), and what an older VS Code window is shown in [An older VS Code window](AHP.md#an-older-vs-code-window).

`createSession` does its work in an order, and every step before the last can leave no session behind. The config is settled, then the policy store is asked about the harness and the machine, then a `disposable:` profile is made into a machine, and only then is the backend started with the credentials the connection pushed. A refusal at any of those is a session that never existed. A worktree session runs in the folder the client picked until its first send, which makes the tree from the config the session holds by then and starts the session again in it before the turn runs, as VS Code's host resolves a session's worktree on the first send; a folder that cannot hold one fails that send.

A session made fresh is provisional until its first message, as VS Code's host keeps one: its state is there for the client that made it, `lifecycle: 'creating'`, and nothing announces it or lists it until its first turn handed to its backend says `root/sessionAdded` and then `session/ready`. A first message that ends in an error before then, a worktree its folder cannot hold or a backend that would not start, fails the creation: `session/creationFailed` after the turn's error, then `root/sessionAdded`, and the session is held with its start owed, so a message sent again tries again. One removed before it is announced goes without a `root/sessionRemoved`. A session an automation could not start fails that run, and one a client asked for fails inside its own `createSession` call.

The session is stored under the id the client named and the backend is told that name, so its transcript is written where this host can find it again. Left to itself the backend invents an id, and a host that did not pass the client's own down answers to two names while it runs and loses the client's the moment it restarts - `No agent for session`, about a session that is still there.

`disposeSession` checks first, then tears the running half down, then asks the backend for its own copy, then drops the row and tells every client with `root/sessionRemoved`. A session this host only lists has nothing to tear down and goes straight to the same delete.

Nothing about a session outlives the process except what a store was given. The sessions themselves come back either way, because they are read from the backend's own transcripts; what is this host's own is the read and archived bits, the settings chosen and the owner, and where those go is `--sessions`. `file`, the default, writes one file per session and reads them once at startup. `memory` forgets them, which a daemon started for one run wants and a daemon that restarts does not: a restart there returns every archived session to the catalogue and marks every read one unread.

## Sleep and wake

A live session holds an agent, its process or its memory, between turns. After `sleepAfterMinutes` of quiet, 30 by default, the host lets the agent go and the session **sleeps**: it leaves the live sessions and stays in the catalogue as a row, the same as a session after a restart. The state the host holds of it stays, so a client that comes back is replayed what it missed.

The host keeps at most `sessionResidencyLimit` sessions resident, 10 by default, as VS Code's agent host does. A session is resident while it runs or while the host holds its state, and one with nothing said in it yet is not counted. Over that count the least recently used session goes first, its agent and its state together; a session is used when it starts, when a client subscribes to it, and when a turn starts in it. An archived session goes at once. None goes while a client watches it or while it has work in hand. The host checks as sessions start, as clients subscribe and leave, as turns start and end, and once a minute, and `0` turns off either limit - [HOST.md](HOST.md#configuration-keys).

Quiet means no action moved in the session for that time and nothing is in hand. A session does not sleep while any of its chats has a turn running or a message pending, queued or steering, a tool call waiting for approval or a question waiting for an answer, or background work its backend reports through `Session.busy()`: a claude background task or a timer the CLI set, or an ACP terminal still running. It does not sleep while a client is subscribed to it or to one of its chats, and a session whose backend cannot resume it never sleeps, because closing it would lose the conversation.

A sleep closes each chat's agent and keeps the backend's conversation. It keeps the chats, the terminals, the rule state, the automations and any wake the agent asked for. A session sleeps with nothing running, so a sleep and a wake leave the root's `activeSessions` as it was: that number counts the sessions running a turn.

A sleeping session **wakes** when something needs it, resumed in place with its earlier conversation and under the same URI. A prompt to one of its chats wakes it. So do a chat a client makes in it, a fork among them, any other client action the host takes on a live session, a `send_message` from another session, a run of a pinned automation, a child session's `childFinished`, and a wake its agent asked for with `schedule_wakeup` ([TOOLS.md](TOOLS.md#the-hosts-own-tools)). A config change and a draft are kept without a wake, as for a session after a restart. A session does not sleep while it is waking, or before the turn it was woken for has begun. Wakers that arrive together share one resume. A resume that fails fails what asked for it with the backend's error, so a prompt is refused and an automation run fails, and the session stays asleep for the next waker to try again.

## Whose it is, and what it is charged to

An owner is a typed reference: `user:<id>` for a person who signed in, `root:<host>` for a connection that is this host itself, and nothing at all on a host with no users directory, which has nobody to name. It is written when the session opens and travels with the run, so a turn sent later by somebody else does not change whose work the session is.

Two things are asked of the owner. Deleting a session is the owner's or an administrator's: `disposeSession` refuses anybody else with `-32009` and `Only the session's owner can delete it.`, because ending somebody's conversation is not the same as writing in it, and a host with no users directory refuses nobody. And a run acts as its owner for the machine it asked for.

The scope is the team and the project the work is charged to, taken from the `scope` key or from the person's primary membership when the session names none. A principal whose memberships would not resolve to one place has nothing to charge, and says so. A host with no users directory, a root connection and an automation are all work nobody owns, and the session records no scope rather than being charged to whoever sends its next turn.

## The state a session reports

A session's `status` is a bitset, and the low bits are what it is doing now:

| Bit | Value | What it says |
| --- | --- | --- |
| `Idle` | 1 | Nothing is running |
| `Error` | 2 | The last turn ended badly |
| `InProgress` | 8 | A turn is running |
| `InputNeeded` | 24 | Waiting on somebody - and this value *carries* `InProgress`, so anything testing activity has to test it first |
| `IsRead` | 32 | This host's own, shared by every client, and the reason a row marked read comes back read |
| `IsArchived` | 64 | The same, and what gives a row with no agent running a status to report |

A session of several chats reads as VS Code's host aggregates one: `InputNeeded` while any chat waits on somebody, else `InProgress` while any chat runs, a worker's chat included, else the default chat's bits. A chat that failed says so on its own row in the session's list of chats, and the session's `activity` is the activity of the chat that decided its status. The session's row and its state both carry the aggregate, with the session's own read and archived bits.

`createdAt` is when the session was first started and never moves; a resumed session takes the catalogue's value rather than the moment it was resumed. `modifiedAt` is the last change, and `activity` is what the session is doing in one line, absent when it is idle.

`workingDirectories` are the directories the agent has tool access to. The first is the process root: the protocol says a client MUST NOT remove it, and moving it is `workingDirectoryReplaced` rather than a removal and an addition, which would be a client briefly holding a session with no directory at all. The rest are peers of the first, and a backend that cannot take them is told none. A summary leaves out a `file:` folder that is not a directory on this host.

A row also carries `changes`, the diff stat a client draws beside it: how many files this session's own work has touched, and the lines it added and removed. What it counts depends on where the session works. A session in a worktree of its own is counted by its **Branch Changes** - everything on its branch since the base the tree was cut from, committed or not - because that tree is nobody else's, and the counts are the whole of what is in it. A session in the folder it was given is counted by its **Session Changes**: the difference between the tree the session started from and the tree its last turn ended with, which is the session's own work and nobody else's, and which a commit in that folder does not take to zero - a session that committed everything it did still shows what it did. The counts are read when a turn ends and kept per session, so a row in the catalogue says them after a restart, with nothing running. A session this host has not read for is the one case that reports its directory's uncommitted changes instead: that is all that is known about a row read from a backend's own record. A folder that is not a git repository has no trees to diff, so a session in one falls back to counting the files its own tools were seen to write, as the reference host's `auto` strategy does.

## Finding one

`listSessions` answers from two halves at once: the sessions running now, read out of memory and never stale, and the rows the last pass over the machine's transcripts found. Neither waits for the other, so a client is answered in the time it takes to sort however long that pass takes, and a refresh runs behind the answer and tells every client what moved.

Paging is by `limit` and `cursor`. A `limit` is capped at 500 however many were asked for. No `limit` means the host chooses, and the size this host chooses is the whole catalogue, up to a thousand rows: neither client that connects here reads `nextCursor`, so a smaller default would be a catalogue silently cut down to it. A catalogue past a thousand is written to the log, because that is the one case a client cannot see for itself. A cursor is the last row served, encoded, and is opaque by contract; one this host did not issue is refused with `-32602` rather than guessed at, since a cursor whose row has been disposed would otherwise resume from the top and the client would page for ever.

A caller that wants only its own sessions sends `_meta: {'ahpd.owner': 'me'}`. The rows are kept to those whose owner is that connection's principal, as `user:<id>` or `plugin:<name>`. That happens before the cursor and the limit apply, so a page is a page of the caller's own. A connection with no principal owns nothing, and the filter answers no rows. Any other value is refused with `-32602`, the way a wrong param is.

## Configuration keys

A session's config is the backend's schema, plus what this host answers, plus what a plugin contributed. The values are read back on the session, so a client draws its controls from the session and not from its own memory of what it sent.

The properties come in the order VS Code's agent host composes them, which is the order a client draws them in: a computer plugin's `computer` and `isolation` first, then the backend's keys and the other plugins', then the rest of the table below in its order. A running session reports the same order.

| Key | Values | Default | What changes |
| --- | --- | --- | --- |
| `isolation` | `folder` or `worktree` | `folder` | Whether the agent works in the folder itself or in a worktree of its own. Offered only when the directory is a git repository |
| `branch` | one of the repository's branches | the most recently committed one | The base a worktree starts from. A picker while the worktree is being made, a value you cannot open otherwise: a folder session works on the branch already checked out |
| `worktreeBranchPrefix` | a string | empty | Prepended to the branch the worktree creates |
| `worktreeIncludeFiles` | a list of patterns, in `.gitignore` syntax | none | Git-ignored files to copy into a worktree, such as `.env`. A comma-separated string is read as the list it spells |
| `worktreeSymlinkFolders` | the same | none | Git-ignored folders to link into a worktree, such as `node_modules` |
| `worktreeCreateNewBranch` | `true` or `false` | `true` | Make a branch for the worktree, or check out the chosen one as it is |
| `worktreeBranchTrack` | `true` or `false` | `false` | Whether the branch it creates tracks the upstream of the one it started from |
| `scope` | one of the person's memberships | their primary | Which team and project the session charges its work to. Offered only when there is a person to ask |

Every key in the table is `sessionMutable: false`: it is decided once, when the session is made, and a session that changed isolation halfway would be an agent whose files moved out from under a conversation. A client hides such a control once the session has started, and this host refuses the change.

The backend's own keys are the rest, and a key that says neither `sessionMutable` nor `scope` gets the safe answers: mutable, and the session's. A key whose property says `scope: chat` reaches one chat and the others all reach the session, because a voice set on one chat is a session whose two conversations answer differently.

A key a plugin contributed is a control a client draws beside the backend's own, and it exists only while its plugin is loaded. Where both declare one the backend's wins, because a plugin may not quietly move a setting a backend owns. A contributed key with a picker of its own is marked `enumDynamic` and answers through `sessionConfigCompletions`.

A value a session was stored with and its backend no longer offers is left out so the default applies, and said once in the log; the store only holds keys the backend took, and a backend takes some it does not declare. A stored string for `worktreeIncludeFiles` is read as the list it spells rather than refused.

## Isolation and worktrees

A worktree is a second checkout of one repository, so two sessions in it do not edit under each other. A tree carries what git checked out and nothing else, which is the whole of why `worktreeIncludeFiles` and `worktreeSymlinkFolders` exist: an ordinary project arrives without its `.env` and without `node_modules`, and the isolation would work while the agent inside it could not build. The copy is best effort pattern by pattern, and the links are made before the copy so a folder that is linked is not also copied. A link is one directory reached from two places, so a write into it from inside the worktree is a write into the checkout, which is why only git-ignored folders are eligible.

A tree is made at `<repo>.worktrees/<name>`, beside its repository, which is where the reference host puts one, or as `<dir>/<repo>/<name>` under `--worktrees-root <dir>`. A tree made under a root is not where the reference host looks, so a tree either makes is found by the other only at the default.

Every session's turns are written down as commits of their own, under `refs/agents/<sid>/checkpoints/turn/<N>` - `turn/0` is the tree the session started from, and each later one is the tree a turn ended with, which is what a row's Session Changes are diffed between. They are this host's own refs rather than the repository's history: nothing is checked out from them, no branch moves, and they are removed with the session they belong to, on `disposeSession`. A tree of a worktree session has them too, and they are what its own Session Changes would be, though a row counts its branch.

A session that moves to another folder keeps the tree it worked in. The tree stays on disk as the session's, beside the folder it moves to, and is archived, put back and removed with the session by the same rules as the tree it runs in, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts#L1504-L1551) retains a moved session's worktree among its additional worktrees.

The window has five requests of its own for trees it manages, made when `initialize` says `_meta['vscode.detachedWorktrees']`: create, claim, archive, unarchive and reconcile. They are served over the same trees, so the window's "new session in a worktree" flow runs against this host unchanged. Archiving takes a clean tree off the disk once its session is gone and keeps the branch; a tree with somebody's work in it, or a session still running in it, stays.

A worktree the host made is trusted when the repository it came from is.

## Commands

There is no `ahpd session` and no `ahpd chat`: a session is driven over the protocol. The verbs are these, and the actions they carry are [AHP.md](AHP.md#session--28-of-28).

| Command | What it does |
| --- | --- |
| `listSessions` | The catalogue, in pages when a client asks for one |
| `createSession` | Start one, under the URI the client chose |
| `disposeSession` | End one, and delete the backend's copy of it |
| `resolveSessionConfig` | The schema and defaults a session would have, before one exists |
| `sessionConfigCompletions` | The values behind a key whose list is too long to send, which here is `branch`, `scope` and a plugin's own |
| `createChat` | A second conversation in the session |
| `disposeChat` | End one chat; the session's default chat is kept |
| `fetchTurns` | Older turns, arriving as `chat/turnsLoaded` on the channel so every watcher gets the page |
| `subscribe` | The snapshot, and everything that happened while it was taken |

## Grants

Everything a session does is one of its operations, and read and write are the groups those fall into - [USERS.md](USERS.md#roles).

| What | Grant |
| --- | --- |
| See the catalogue and read a session's state | `session:list`, `session:state` |
| Start and end a session | `session:create`, `session:dispose` |
| Rename one, change its settings, add or remove a folder, mark it read or archived | `session:rename`, `session:configure`, `session:folders`, `session:mark` |
| Its worktrees and its artifacts | `session:worktree`, `session:artifacts` |
| Read a chat and its turns | `chat:turns` |
| Open or close a chat | `chat:create`, `chat:dispose` |
| Send, cancel, answer a tool or a question, write a draft | `chat:send`, `chat:cancel`, `chat:answer`, `chat:tool`, `chat:draft` |
| Rewind one | `chat:truncate` |

A chat lives in a session, so a session's group is the chat's: holding `session:write` holds every chat operation in the write group, and `session:read` holds `chat:turns` beside `session:list` and `session:state`. `member` holds both session groups, so it has every chat operation without a `chat:` grant of its own. `guest` holds `session:read`: it sees the sessions and the turns in them, and may do nothing to either.

## See also

| | |
| --- | --- |
| [CHATS.md](CHATS.md) | The conversation inside a session |
| [AHP.md](AHP.md#session--28-of-28) | The session channel's actions, and the chat channel's |
| [USERS.md](USERS.md#roles) | What the grants are |
| [POLICY.md](POLICY.md) | The store asked before a session runs |
| [COMPUTERS.md](../plugins/COMPUTERS.md) | A session in a machine instead of on this host |
| [TERMINALS.md](TERMINALS.md) | A shell a session opens for a `!` command |
