# Bots

A **bot** is a record a person keeps on the host, with a folder of its own and a session to talk to it in. `@ahpd/bot` serves it as the `bot:` scheme, so a bot is made, read, listed, edited and deleted through the same `resource*` methods every other resource uses - [RESOURCES.md](RESOURCES.md).

A bot is not a backend. It runs on whichever harness the host already has, named by its `preset`, or by its `harness` and `model`, and this is what lets a bot be tried today rather than once a bot harness exists.

## The record

| Field | What it is |
| --- | --- |
| `id` | The slug. Read but never obeyed: it is the URI path, and a body naming another one is refused |
| `name` | What a person called it. The only field a make must carry |
| `labels` | Words a client groups bots by. Two bots may share one |
| `description` | One line about it, for a list of bots |
| `body` | Which body it is drawn with, from the fifteen below |
| `color` | Which colour it is drawn in, from the eleven below |
| `instructions` | What it was asked to be, in its own words. The session's first turn |
| `harness` | The backend a session of it runs on, where a bot chooses one |
| `model` | The model it asks for |
| `preset` | The session preset it starts from. Where one is set it wins over `harness` and `model` |
| `workspace` | The folder it works in, under `root`. Its own, and never moved |
| `computer` | The machine it runs in, where it names one |
| `session` | The session it is linked to |
| `owner` | Whose it is: `user:<id>`, `team:<team>`, `project:<team>:<project>` or `root:<host>`. A make may name the maker, or a team or project the maker belongs to; a body naming anybody else is refused `-32009`, and an edit may not move it |
| `createdAt`, `updatedAt` | The times. Read but never obeyed: what they hold is the host's |

A body that names a key a bot does not have is refused `-32602`, and so is a `body` or a `color` outside the two lists below.

## The slug

A bot's address is `bot://<slug>`, and the slug is the URI path, the record's `id` and the name of its folder - one thing written once. It is lowercase letters, digits and dashes, one to forty of them, starting with a letter; anything else is refused `-32602`, because the slug is a folder name and a URI path at once.

A slug is fixed when the bot is made and an edit cannot move it. A deleted slug is never made again: the host keeps a tombstone, and a make on one is refused `-32010`. A client held that address, and a different bot answering to it would be a lie about what that client has.

## The folder

A bot works in a folder of its own, `<root>/<slug>` unless the body named one, where `root` is the plugin's option and starts at `~/.bots`. No two bots share a folder and an edit never moves one: two bots in one tree would be two sessions working over each other, so a body naming a folder another bot has is refused `-32602`. The folder is made when the bot is made - before its session starts, since that is where the session works.

## Bodies and colours

The bodies are `robot`, `humanoid`, `alien`, `gumbo`, `circle`, `semicircle`, `smash`, `square`, `triangle`, `pentagon`, `hexagon`, `drop`, `bean`, `cloud` and `ghost`. The colours are `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `brown`, `grey` and `black`.

A make that names neither gets a body at random and the first colour.

## The session

A bot is talked to in its session, and there are two ways it gets one.

A body may **link** a session its owner already has, by naming it in `session`. The link is kept only where the host has that session and it belongs to the bot's owner: a URI the host has no session for is refused `-32602`, and one that belongs to somebody else is refused `-32009`. A link to somebody else's conversation would be this bot's work in a room its writer has no business in.

A bot made with **no** `session` is given one. The host starts it as the bot's owner, which is the same session that person could have made themselves: the owner's own `session:create` is asked first, and a refusal reads exactly as it does at the door. The session runs the bot's `preset`, or its `harness` and `model`, or the host's own default harness and model, in the bot's `workspace` - on this host, or in the `computer` the record names. Its first turn is the bot's `instructions`, and a bot with none asks for a session that opens silent. Its title is the bot's `name`.

A start the owner may not make leaves no record at all: the host is asked before the bot is saved, so a make that failed is one that did not happen rather than one claiming a session it has not got.

An edit that sets `session` to `null` takes the link away. An edit that says nothing about `session` leaves the link as it was, so changing a bot's name does not unlink it.

## Who may do what

| Who | What they may do |
| --- | --- |
| The owner | Read, edit, delete |
| A member of the owning team or project | Read, edit, delete |
| `bot:get` | Read any bot |
| `bot:list` | List every bot |
| `bot:put` | Make a bot in the scheme, edit their own |
| `*:*` | Any of it, on any bot |
| A root connection | Any of it, on any bot |

A listing shows what a read would allow: a list that showed a bot the reader cannot open would be a list of names they cannot use.

Making a bot also needs the maker's `session:create` where a session has to be started for it, because the session is theirs - [USERS.md](USERS.md#roles).

## An example

A make from a name alone, which is the whole of what is required:

```json
{ "name": "Motion" }
```

A bot that runs on a harness of its own, with something to be:

```json
{
  "name": "Motion",
  "labels": ["review", "ci"],
  "description": "Reads pull requests and says what would break.",
  "body": "robot",
  "color": "teal",
  "instructions": "You review pull requests. Say what would break, in one paragraph.",
  "harness": "claude",
  "model": "claude-sonnet-5"
}
```

An edit that links a session the owner already has, and one that takes a link away:

```json
{ "session": "claude:/6f1c0b6e-2a5a-4a1e-9a4a-0f0e0b1c0d0e" }
```

```json
{ "session": null }
```

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `root` | `~/.bots` | The folder a bot's workspace is under, as `<root>/<slug>` |

```json
{ "plugins": [{ "name": "@ahpd/bot", "options": { "root": "/srv/bots" } }] }
```

The records are kept beside the daemon's own configuration, in `<configDir>/bots/`, and the tombstones in `<configDir>/bots-gone/`.

## See also

| | |
| --- | --- |
| [RESOURCES.md](RESOURCES.md) | What a scheme is, and the grants each resource method asks for |
| [SESSIONS.md](SESSIONS.md) | What a session is and who it is charged to |
| [COMPUTER.md](COMPUTER.md) | Making a machine, and running a session inside it |
| [PLUGINS.md](PLUGINS.md) | Writing a plugin, and starting a session as an owner |
