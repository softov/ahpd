---
title: A dispatch into a session needs session:write, whatever its scheme
status: implemented
depends: [task-07-a-provider-scheme-session-needs-session-read.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L274-L310](../../../../packages/sdk/src/host.ts#L274-L310) - `dispatchNeeds`, which takes the kind of the channel"
  - "[code://packages/sdk/src/host.ts#L327-L421](../../../../packages/sdk/src/host.ts#L327-L421) - `ACTION_HOMES`, `spaceOf`, `baseOf` and `Claiming`: where each action belongs, the spaces of names and the maps that claim them"
  - "[code://packages/sdk/src/host.ts#L577-L589](../../../../packages/sdk/src/host.ts#L577-L589) - `claims`, every name this host holds"
  - "[code://packages/sdk/src/host.ts#L2057-L2078](../../../../packages/sdk/src/host.ts#L2057-L2078) - `channelKind` and `sessionChannel`, the one answer both gates ask"
  - "[code://packages/sdk/src/host.ts#L6031-L6050](../../../../packages/sdk/src/host.ts#L6031-L6050) - `claimable`, what every new name is checked against"
  - "[code://packages/sdk/src/host.ts#L6437-L6488](../../../../packages/sdk/src/host.ts#L6437-L6488) - `capabilityFor`, the subscribe and completions gate"
  - "[code://packages/sdk/src/host.ts#L6490-L6526](../../../../packages/sdk/src/host.ts#L6490-L6526) - `admit`, the gate every command and every handshake subscription passes"
  - "[code://packages/sdk/src/host.ts#L8615-L8714](../../../../packages/sdk/src/host.ts#L8615-L8714) - `applyDispatch`, the dispatch gate"
  - "[code://packages/sdk/test/users-gate.test.ts#L383-L415](../../../../packages/sdk/test/users-gate.test.ts#L383-L415) - `classifies a dispatch by its channel`, through the host"
---

## Objective

A subscribe to or a dispatch into a session's channel needs `session:read` or `session:write`, whatever scheme the session is held or asked for under, and so does every channel the host cannot place.
A `file:` channel, a resource watch or a relayed watch needs `file:read`; a root, terminal or automation channel is gated as before.
Since task 01 a session created as `ahp-session:/<id>` is held as `<provider>:/<id>`, and `applyDispatch` gates the resolved name, so a `file:read` guest could dispatch into any created session and a member with `session:write` and no `file:read` was refused on their own.

## Files

- `UPDATE: packages/sdk/src/host.ts` - one answer to "this channel is a session's", used by the subscribe gate and by the dispatch gate; `dispatchNeeds` takes it instead of reading the scheme.
- `UPDATE: packages/sdk/test/users-gate.test.ts` - the cases below, and the literal-scheme cases moved to the new shape of `GATE.dispatchNeeds`.

## Steps

1. Tests first, with a `claude` backend: a member with only `session:write` dispatches `session/titleChanged` into `claude:/<id>`, and into the same session under `ahp-session:/<id>` when it was created under that name; a guest with only `file:read` is refused both, and is refused a dispatch into the session's annotations channel.
2. Give the subscribe gate and the dispatch gate one answer, so a session channel is recognised the same way by both.
3. Implement, keeping `ahp-root://`'s per-key reading as it is.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

`channelKind(channel)` in `host.ts` answers what the gate reads a channel as, synchronously: `session`, `terminal` or `other`.
It reads `claims`, the one registry of names, for the channel or the session channel it hangs off (`baseOf`), and otherwise the name's space (`spaceOf`): `ahp-session:` and `ahp-chat:` are `session`, `ahp-terminal:` is `terminal`, `file:` and every other `ahp-` scheme (`ahp-sessionx:` among them) are `other`, and every other channel is `session`, per the decision "an unplaced channel needs a session's grants" (Softov, 2026-09-30).
`claims` is written by the maps that hold each kind (`owners`, `byChat`, `subagents`, `terminals`, `watches`, `relayed`, each a `Claiming` map) and by `createSession` for the name the client asked for; deleting a session from `owners` releases every name claimed as its.
`claimable(name, kind)` refuses with `-32003` a name that is claimed, whose session channel is claimed, that `heldAs` resolves to a session, or that falls in a space kept for another kind; `createSession` (through `unheld`, for the held name and the asked one), `createChat`, `createTerminal` and a relayed `createResourceWatch` ask it.
`sessionChannel(channel)` is `channelKind(channel) === 'session'`.
Both gates take the grants of the channel as the client spelt it and as `meantBy` resolves it, and ask the stricter: `capabilityFor` asks both reads of a `subscribe` (and of `completions`, with `file:read`), and `applyDispatch` finds the first grant of both that the person lacks.
`dispatchNeeds(channel, kind, action?)` asks `session:write` of a session, `terminal:write` of a terminal, and otherwise reads automation and root as before, and `file:read` for what is left.
`heldAs`, and through it `sessionFor` and `meantBy`, resolves a name claimed as a session's to that session and never reads a session's id out of a name claimed as something else or in another space, so `file:///<id>` and a terminal stay what they are.
`ACTION_HOMES` maps each family of client action to the kind of channel it belongs on and the grant it needs: `session`, `chat`, `annotations` and `changeset` a session's (`session:write`), `terminal` a terminal (`terminal:write`), `automation` and `automationRun` an `ahp-automation*` channel (`automation:write`), `root` the root, `resourceWatch` a watch.
`applyDispatch` refuses an action of a family whose channel, spelt or resolved, is of another kind (`homeOf`), with `<channel> is not a session here` (or a terminal, an automation channel, the root, a resource watch), before the users gate and before any handler; the gate then asks the strictest of the channel's grants and the action's; an action of no family (a vendor's) is gated by the channel alone; `snapshotOf` answers a marks or catalogue channel only when the owning channel is a session's; and a relayed watch's owner may dispatch only `resourceWatch/changed` onto it.
`admit(method, params)` is the gate at the command boundary, and `initialize` and `reconnect` ask it as `subscribe` of each channel they subscribe to, so a channel the connection may not read gets no snapshot and is not watched; `reconnect` names it in `missing`.
Under a users directory a client id belongs to the first person who signs in under it (`holders`), per Softov's two answers of 2026-09-30.
An unsigned `reconnect` is accepted under any id this host has seen: what the connection may not read is in `missing`, and only what anyone may read is replayed and watched.
A person signed in resumes only an id that is theirs or nobody's, and is answered `-32008` otherwise.
`claimsId` decides whether a connection answers for its id: `ownerOf`, `ask` and `clients.ids` skip a connection whose id another person holds, so a connection that `initialize`s or `reconnect`s under a held id is routed nothing until the holder signs in on it.
`authenticate` refuses with `-32003` a person signing in under an id another person holds; `InitializeResult` has no client id field, so a fresh id cannot be handed out instead.
Tests, both failing first: `resumes another person's client id with nothing it may not read, and no claim on it until they sign in` (an unsigned reconnect as `pub` gets `claude:/one` in `missing`, is routed no `resourceRead` for `virtual://pub/x`, refuses `g` signing in, and is routed to once `a` signs in; it failed with `-32008` for the reconnect) and `gives a connection no claim on a client id another person holds` (an `initialize` as `pub` is routed nothing and refuses `g`; it failed with the read routed to it).
`resumes a client id for a person signed in only when it is theirs, and only what they may read` now expects the unsigned reconnect to be answered with `missing`.
Channels the host serves, and what the gate asks of each: the root (none to read, `config:write` or none to dispatch); a terminal under any scheme (`terminal:read`/`terminal:write`); `ahp-automations:` (`automation:read`/`automation:write`), and `ahp-automation:` and `ahp-automation-run:` (`file:read` to subscribe, `automation:write` to dispatch); `ahp-otlp://logs`, `/traces` and `/metrics` (`file:read`); `ahp-resource-watch:` and a watch another client relays under a name of its own (`file:read`; a name that is or resolves to a session's is refused when the watch is made); a `file:` URI (`file:read`, and never a session's even when its path is a session's id); and a session, its chats (default, worker and client-named), its annotations and its changesets under any other scheme (session grants).
No plugin contributes a channel: a plugin contributes resource schemes such as `computer://`, which are read through the resource methods and not subscribed to; subscribing to one asks `session:read` and is then answered `No agent for session`.
A terminal, watch or relayed channel that no longer exists is asked session grants; the handler refuses it either way.
Tests in `users-gate.test.ts`: `needs session:write to dispatch into a session held under its provider's scheme, under either name` and `reads and drives a changeset of a session held under its provider's scheme as the session's`, which failed first with `may not file:read`; `reads a channel it cannot place as a session's, and a file as a file` (`x:/1` needs `session:read` and `session:write`, a `file:` URI needs `file:read` both ways), where `x:/1` was read as `file:read` before the decision; `still asks a session's grants for a session that was disposed`; `asks a session's grants for a row a backend keeps on disk, under its name or any other` (a member with session grants subscribes to an on-disk row before anything listed it, and a `file:read` guest's `session/isReadChanged` under another scheme is refused `session:write`), which in the fourth pass replaced a test titled as knowing the row before a listing, which the synchronous gate no longer needs to; and `classifies a dispatch by its channel`, over the kinds `channelKind` answers for each channel.
Seventh pass, each failing first: `keeps every family of action to its own kind of channel` (a `file:read` guest created, rewrote and removed automations through `file:///x` and `ahp-otlp://logs`, and actions of each family on a channel of another kind reached their handlers), `keeps a name in a provider's scheme for a session, before anything has listed it` (a terminal took `claude:/disk`), `binds a client id to the person who reconnects under it first` (a second person could sign in under it), and `routes nothing to a person removed while connected, and binds no id to a connection without one` (a removed person was still routed to); in `session-fixed-key.test.ts`, `claims a new session's names while its machine is made, and lets them go when it fails` and `keeps a session's chat names while the session starts again` (a terminal took the name in each window).
`reads a channel it cannot place as a session's, and a file as a file` and `classifies a dispatch by its channel` now probe a file's grant with an action of no family, since a family's action on a file is refused for what the file is.
Fifth pass, each failing first: `answers no channel a connection may not read in its handshake` (an unsigned `initialize` got `claude:/one`, `ahp-session:/one` and a terminal), `resumes a client id only for the person who held it, and only what they may read` (an unsigned connection resumed `a`'s id), `keeps every name to one kind of thing` (a relay answering `claude:/one` was taken), `relays only a change of files from the client that keeps a watch` (the owner's `session/titleChanged` was relayed), `asks a session's grants for completions in a session` (a `file:read` guest got the session's commands), and `reads a session spelt as a file or as a watch as what it is spelt as`, whose relayed half now expects the watch named `x:/one` to be refused; `keeps a session's marks out of a file named after it` fails with the `snapshotOf` marks guard taken out.
`classifies a dispatch by its channel` now dispatches through a host as a person with no grants and reads the grant the refusal names, so it exercises `channelKind` and `dispatchNeeds` together.
Fourth pass, each failing first: `reads a session spelt as a file or as a watch as what it is spelt as` (a `file:read` guest's `subscribe file:///one` is refused, its `session/titleChanged`, `chat/turnStarted` and `annotations/set` on `file:///one` are refused and reach nobody, and a relayed watch the guest's own publisher named `x:/one` reads as a watch and refuses a session action; it failed with the guest driving the session) and `keeps a session a backend keeps on disk out of reach of its spelling as a file` (the no-agent flags and config paths store nothing for `file:///disk`; it failed with both stored).
The task 07 test also has a chat the client named itself, `peer:/two`, which the gate reads as a session's by the rule rather than by the `ahp-chat:` prefix.
Two passes of the 2026-09-30 review built a catalogue read behind the gate (`onDisk`, `catalogued`, its own freshness window and a timeout) for channels it could not place; the decision above made every channel placeable, and that code, its window and its tests are gone.
That removed window was the gate's; the listing window that remains, `LISTING_FRESH`, is how long a listing answers `past` for a subscribe or a config change to a session nothing is running, and belongs to host/31 task 01.
`meantBy` returns a name claimed as a terminal or a watch unchanged, so a relayed watch `x:/disk/annotations` or a terminal `y:/disk/annotations` made before `claude:/disk` was listed stays itself after the listing; `keeps a watch or a terminal named like a session's marks what it is once the session is listed` failed first with both subscribes answered the session's marks, the owner's `resourceWatch/changed` refused `claude:/disk/annotations is not a resource watch here` and `terminal/input` refused as not a terminal.
The per-connection `waiting` queue stays for the two dispatches that still wait - one into a session being started again, and a config change for a session nothing is running - and is described in task 01 of this plan and in host/31 task 01.
