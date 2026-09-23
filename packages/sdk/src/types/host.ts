/** The protocol server: channels, subscriptions and requests. */

import type { ToolDefinition } from '@microsoft/agent-host-protocol';
import type { Agent, ToolEffects } from './agent.js';
import type { HostHandlers } from './events.js';
import type { ResourceProvider, ResourceStore } from './resources.js';
import type { Principal, Users } from './users.js';
import type { TerminalStore } from './terminals.js';
import type { ChangesetSource } from './changes.js';
import type { Worktrees } from './worktrees.js';
import type { PullRequests } from './github.js';
import type { AutomationStore } from './automations.js';
import type { SessionStore } from './sessions.js';
import type { Peer, Request } from './rpc.js';
import type { Summary } from './catalog.js';
import type { Bag } from './common.js';

/**
 * What a host can say about a directory beyond its path.
 *
 * Injected rather than built in. The interesting answers come from outside the
 * protocol - a branch is a `git` subprocess, and `git` is a binary that may
 * not be installed - and a host embedded in something that already knows them
 * should not have them read a second time. A host given none says only what a
 * path alone can tell it, which is the project's name.
 */
export interface DirectoryFacts {
  /**
   * What is known about a directory now, as the session's `_meta`.
   *
   * Synchronous and cheap, because it is asked for every description of every
   * session - a catalogue of a hundred rows asks a hundred times. Anything
   * that has to be fetched is fetched by `refresh` and cached here.
   *
   * The keys are the protocol's: `git` is the well-known one, and anything of
   * an implementation's own belongs under a namespace.
   */
  meta(dir: string): Record<string, unknown> | undefined;
  /**
   * Look again, answering whether anything actually moved.
   *
   * Asked once per served directory at startup and again whenever a turn
   * ends. Only a true answer reaches a client, so a directory that has not
   * changed costs nothing but the look.
   */
  refresh?(dir: string): Promise<boolean>;
}

/*
 * `ResourceStore` and `TerminalStore` are declared in the concept files that
 * describe what they are - `resources.ts` and `terminals.ts` - rather than
 * here, because a backend is handed both through `Start` and a type that lives
 * beside `HostOptions` made `types/agent.ts` import from this file and back.
 * They are re-exported because `HostOptions` names them and callers have
 * always reached them here.
 */
export type { ResourceProvider, ResourceStore } from './resources.js';
export type { TerminalStore } from './terminals.js';

/** How to construct a host. */
export interface HostOptions {
  /**
   * The directory whose sessions this host serves, on the machine it runs on.
   *
   * Also the catalogue's scope: sessions outside it are neither listed nor
   * openable.
   */
  path: string;
  /**
   * The backends this host serves.
   *
   * At least one, and each with a `provider` no other has. The first is what
   * a client gets when it names none - which is the ordinary case, since a
   * client that has read the root channel names one and one that has not
   * cannot.
   *
   * Nothing in the host knows what any of them are. `claude()` is one that
   * ships with it; anything satisfying `Agent` is another.
   */
  agents: Agent[];
  /**
   * The files a client may read, and complete an `@` into.
   *
   * Left out, no `resource*` command is served. `fileResources()` is the one
   * that ships with this package, and the daemon uses it.
   */
  resources?: ResourceStore;
  /**
   * Other URI schemes this host serves itself, by scheme.
   *
   * `file:` is `resources` above and everything else is here: a `computer:`
   * whose bytes come from somewhere that is not a filesystem, or any scheme a
   * plugin owns. A resource command is routed by the scheme in the URI, so a
   * provider is reached only for URIs that name it.
   *
   * The order of authority, for a URI that several things could claim: a URI a
   * connected client published is relayed to that client before any of this is
   * consulted, then a registered scheme goes to its provider, then `file:` goes
   * to `resources`, and a scheme nobody serves answers with what
   * `fileResources()` says about a foreign scheme.
   */
  resourceProviders?: Record<string, ResourceProvider>;
  /**
   * How to open a shell.
   *
   * Left out, no terminal can be created. `shellTerminals()` is the one that
   * ships with this package, and the daemon uses it.
   */
  terminals?: TerminalStore;
  /**
   * Where the file changes a session made come from.
   *
   * Left out, no session advertises a changeset and the changes screen is
   * honestly empty rather than emptily wrong. `gitChanges()` is the one that
   * ships with this package, and the daemon uses it.
   */
  changes?: ChangesetSource;
  /**
   * What this host can say about the directories it serves.
   *
   * Left out, sessions carry their project and nothing more. `gitBranches()`
   * is the one that ships with this package, and the daemon uses it.
   */
  directories?: DirectoryFacts;
  /**
   * Whether a session can be given a working tree of its own.
   *
   * Left out, every session runs in the folder it was pointed at and this host
   * advertises no `isolation` - so a client draws no control for it, which is
   * the honest form of "not offered". `gitWorktrees()` is the one that ships
   * with this package, and the daemon uses it.
   *
   * The reason to wire it in: two agents in one repository is the ordinary
   * case for a sessions server, and without this they share a working tree.
   * The second turn's changeset then contains the first turn's edits, and
   * discarding a file discards somebody else's work.
   */
  worktrees?: Worktrees;
  /**
   * What GitHub knows about the branch a session is on.
   *
   * Left out, no session carries `_meta.github` and no backend advertises a
   * GitHub resource, so a client draws no pull request beside a branch and
   * asks nobody to sign in for one. `githubPullRequests()` is the one that
   * ships with this package, and the daemon uses it.
   */
  github?: PullRequests;
  /**
   * The people who may use this host, when there are any.
   *
   * Left out, there are none: the host advertises no sign-in resource, every
   * gate it has is inert, and the connection token is the whole of who may be
   * here - which is what every install that has not configured a directory
   * gets. `fileUsers()` is the one that ships, and the daemon uses it when the
   * configuration names a file.
   */
  users?: Users;
  /**
   * The automations this host offers.
   *
   * Left out, no `ahp-automations://` channel is advertised and all three
   * automation commands answer `-32601` - which is the right answer for a
   * daemon that runs the sessions somebody asks for and schedules nothing.
   * `memoryAutomations()` is the one that ships with this package: it holds
   * definitions, runs them when asked, and holds no clock.
   */
  automations?: AutomationStore;
  /**
   * Where the flags and configuration this host adds on top of a backend go.
   *
   * `memorySessions()` is the default and forgets them when the process ends,
   * which is right for a host embedded in something that outlives no restart
   * of its own. A daemon wants `fileSessions()`, or a restart silently
   * un-archives every session and marks every read one unread for everybody.
   */
  sessions?: SessionStore;
  /**
   * Tools this host contributes to every session it runs.
   *
   * The protocol's `serverTools`: tools that are the *host's* rather than a
   * backend's or a client's, reported on `SessionState.serverTools` and given
   * to the backend to offer the model. What they are is the host's to decide
   * - `hostTools()` is the set that ships with this package - and a host that
   * passes none contributes none, which is what an absent `serverTools` says.
   */
  tools?: HostTool[];
  /**
   * What this host says about itself when a window asks.
   *
   * The reference window has requests of its own for the host's version, its
   * logs, its network and its shutdown, and this is where a host answers
   * them from. All optional: a host embedded in something else has its own
   * answers to most of these, and the daemon fills in its own.
   */
  diagnostics?: Diagnostics;
  /** Called with one line per notable event, for a log. */
  onEvent?(message: string): void;
  /**
   * What plugins subscribed to, by event, in registration order.
   *
   * Each handler is called with the event and the read-only context its plugin
   * was handed, awaited in turn, and a handler that throws is reported against
   * its plugin and does not stop the next one or the action being observed.
   * `onEvent` above stays the embedder's one-line writer; `log` is also an
   * event, and the two are raised from the same place.
   */
  events?: HostHandlers;
}

/** What a host knows about itself, for the window's diagnostics. */
export interface Diagnostics {
  /** The version `serverInfo` and the network diagnostics report. */
  version?: string;
  /**
   * The host's own log files, for a "collect logs" request to pack up.
   *
   * Paths, read when asked rather than once: a log that rotates is a
   * different file tomorrow. A path that is not there is skipped, not an
   * error.
   */
  logs?(): string[];
  /** What the window's `shutdown` request runs, once it has been answered. */
  shutdown?(): void | Promise<void>;
}

/**
 * How a session names its chats, resolved once when it opens.
 *
 * `activeAgent` is the agent naming its own chats through `rename_chat`;
 * `utility` is the host naming them and the tool withheld; `deferred` is the
 * host naming them and the tool offered only for an explicit rename.
 */
export type TitleStrategy = 'activeAgent' | 'utility' | 'deferred';

/**
 * One tool the host contributes, and what running it does.
 *
 * `definition` is what a client draws and what the model is offered;
 * `run` is called when the model calls it, with the arguments it passed and
 * the chat it called from. Returning a string is the answer; throwing is a
 * tool that failed, and the message reaches the model.
 */
export interface HostTool {
  /** What the model is offered. `name` is the id it calls. */
  definition: ToolDefinition;
  /** What running it does. */
  run(input: Record<string, unknown>, at: ToolCall): Promise<string> | string;
  /**
   * What running this tool does to the world.
   *
   * The host's own claim, not a guarantee, and nothing when the tool does not
   * say. A backend that runs it reads this to decide what to ask a person
   * about: `destructive` is what a policy asks on, and the rest is there for a
   * changeset or a network policy that wants it.
   */
  effects?: ToolEffects;
  /**
   * What to tell the model about when to call it, beyond the description.
   *
   * Added to the agent's instructions while the tool is offered, the way the
   * reference host adds its artifact instruction to a session's first turn:
   * a description says what a tool does, and this says when a tool that
   * nothing asks for is worth calling on the model's own initiative.
   */
  instruction?: string;
  /**
   * The wording a client's root key selects for this tool.
   *
   * `definition` is merged over `definition` above and `instruction`
   * replaces `instruction` above. It is words only: whether the tool is
   * offered, where it sits in the list and how many there are do not move.
   */
  compact?: { definition?: Partial<ToolDefinition>; instruction?: string };
  /**
   * The shape one session's title strategy asks for.
   *
   * `undefined` leaves the tool as it is, `{ offered: false }` takes it out
   * of the list for that session, and `definition` is merged over the tool's
   * own. It is how a strategy that does not rename chats withholds the tool
   * rather than offering one it would refuse.
   */
  forSession?: (session: { titleStrategy: TitleStrategy }) => { offered: boolean; definition?: Partial<ToolDefinition> } | undefined;
  /**
   * A host-side hint that the harness may hide this tool behind tool search.
   *
   * The host sets it and the published `ToolDefinition` never carries it: a
   * backend reads it to decide whether the model must be offered the tool up
   * front, while a client drawing the tool's row has no interest in it.
   * Undefined leaves the harness's own default in force.
   */
  deferLoading?: boolean;
}

/**
 * Where a host tool was called from, and what the host knows.
 *
 * The reason a tool is the host's rather than the backend's: an agent inside
 * a session cannot see the sessions beside it or the terminals a person is
 * watching, and the host can. A tool that wants none of it ignores it.
 *
 * The session half is what VS Code's host gives its agents under the same
 * names (`serverToolNames.ts`): a catalogue with the same rows a client
 * lists, a chat's turns, a message into another chat, a session or chat made
 * from here, a title, a deletion, a move. Each is the same operation a
 * client's command or dispatch performs, reached from inside a turn.
 */
export interface ToolCall {
  /** The session channel URI the call was made in. */
  session: string;
  /** The chat channel URI it was made from. */
  chat: string;
  /** The turn the call is running in, when the chat has one running. */
  turn(): string | undefined;
  /**
   * Every session this host knows, running or on disk, the calling one included.
   *
   * The catalogue's own rows, as `listSessions` answers them, so a tool says
   * about a session exactly what a client sees of it: status bits, activity,
   * directories, project, changes, and the `git` and `github` facts in `_meta`.
   */
  sessions(): Promise<Summary[]>;
  /** The chats of a running session, the default first. Empty for one that is not running. */
  chats(session: string): { resource: string; title: string }[];
  /** Models any session here can run on, each with the provider it belongs to. */
  models(): { id: string; name: string; provider: string }[];
  /**
   * A chat's conversation, as its channel snapshot carries it.
   *
   * The newest page of turns, the running one, and whether older ones exist
   * behind the page. Nothing for a session that is not running: a transcript
   * on disk is opened by resuming, and a tool reading one would start an agent
   * to answer a question about the past.
   */
  context(session: string, chatId?: string): Promise<{ turns: Bag[]; activeTurn?: Bag; hasMoreHistory: boolean } | undefined>;
  /**
   * A message into another chat, as a turn of its own.
   *
   * Started at once when nothing is running there, queued behind the running
   * turn when something is - the queue a client sees and can reorder. `from`
   * says who sent it (`origin.kind: agent`) and where from (`_meta`), and
   * rides on the message so a client can draw it as delegated rather than
   * typed. Answers which of the two happened.
   */
  send(session: string, chatId: string | undefined, text: string, from: Bag): Promise<'sent' | 'queued'>;
  /**
   * A new session, started with its first message.
   *
   * `isolation` decides a worktree the way a client's `config.isolation`
   * does; absent, the host's default for the directory. `model` names the
   * provider as well as the model. Answers the session's URI and its default
   * chat's.
   */
  create(options: {
    workingDirectory: string;
    provider?: string;
    model?: string;
    isolation?: 'worktree' | 'folder';
    title: string;
    prompt: string;
    from: Bag;
  }): Promise<{ session: string; chat: string }>;
  /** A second chat in a running session, started with its first message. */
  createChat(session: string, options: { title?: string; model?: string; prompt: string; from: Bag }): Promise<{ chat: string }>;
  /** A chat's title. On the default chat it is the session's title too. */
  rename(session: string, chat: string, title: string): void;
  /** A session gone, with its chats, terminals and a clean worktree. */
  remove(session: string): Promise<void>;
  /**
   * Move the calling session to a directory once the running turn ends.
   *
   * `isolation` asks for a worktree made from the directory rather than the
   * directory itself. Held until the turn is over, because the agent is
   * restarted in the new place and a restart mid-turn would lose the turn;
   * the host then continues the conversation there with a notice turn.
   */
  setWorkspace(directory: string, isolation: boolean): void;
  /**
   * What the calling session recorded as worth coming back to.
   *
   * The reference host's artifacts and references, held on the session and
   * published on its `_meta` under `agentHost/sessionArtifacts`; the store
   * keeps them across a restart. Whole and in the order recorded.
   */
  artifacts(): Bag[];
  /** Replace them, and tell every client watching the session. */
  setArtifacts(list: Bag[]): void;
  /** Every terminal this host has open. */
  terminals(): { uri: string; title: string; cwd: string; running: boolean }[];
  /**
   * Read a resource this host serves, as text.
   *
   * Including one it does not have: a URI a connected client published is
   * fetched from that client, which is the only way an agent reaches a
   * plugin's virtual files or an editor's unsaved buffers. Rejects when
   * nothing serves it, in the words of whatever refused.
   */
  read(uri: string): Promise<string>;
}

/**
 * A token a client pushed, and how long it is good for.
 *
 * `expiresAt` is a wall-clock millisecond, from the `expiresIn` the client
 * sent with it; absent when the client sent none, which the protocol allows
 * when the authorization server named no expiry. A token past it is not spent
 * on a new session, and the client that pushed it is told `auth/required`
 * with `reason: 'expired'` rather than left to find out from a session that
 * failed to start.
 */
export interface Credential {
  token: string;
  expiresAt?: number;
}

/** One connected client and what it is watching. */
export interface Connection {
  /** Where to write messages for this client. */
  peer: Peer;
  /** The identifier the client gave at `initialize`. */
  clientId: string;
  /**
   * Channel URIs this client subscribed to.
   *
   * Per connection: two clients can watch one channel, and dropping one must
   * not stop the other's stream.
   */
  watching: Set<string>;
  /**
   * The person this connection signed in as, when it did.
   *
   * Per connection for the same reason `tokens` is: the specification says
   * authentication status is per connection, so one person's sign-in is not
   * another's, and it dies with the socket. Absent is not "nobody may do
   * anything" - a host with no user directory has no principal anywhere and
   * refuses nothing.
   */
  principal?: Principal;
  /**
   * Whether this socket arrived on the deployment's own connection token.
   *
   * That token is the host's key, so a socket that presented it is the host:
   * every capability, including a scheme no role names, and it stays the host
   * when somebody signs in or out on it. It is a property of the connection and
   * not a person, so there is no record for it and `authenticate` cannot
   * replace it.
   */
  root?: boolean;
  /**
   * When their credential runs out, if they said.
   *
   * The credential itself is never kept: it is verified once and what is left
   * is who it was, so this is the only thing the expiry path needs beside it.
   */
  principalUntil?: number;
  /**
   * The preferences this client pushed that are its own, not the host's.
   *
   * `root/configChanged` carries two kinds of key. Some describe the host and
   * are one setting for everybody, like whether artifact prompts are compact.
   * `defaultShell` is not one of those: the host's own note calls these "the
   * preferences a *client* holds about how the host should behave for it", and
   * VS Code pushes the shell out of a per-person setting the moment it
   * connects. Kept in one shared record, the last client to connect decided
   * everybody's shell - so the person's half is kept here instead, and each
   * connection reads its own back in root state.
   */
  config?: Record<string, unknown>;
  /**
   * Tokens this client pushed, by protected resource identifier.
   *
   * Per connection for the same reason `watching` is, and the specification says
   * so outright: authentication status is per connection, each client
   * authenticating independently. A token one client offered is theirs, spent
   * only on sessions they ask for, and gone when they hang up.
   *
   * Which is also why an automation that fires with nobody connected has
   * none: it is the host's own work rather than any client's, and it runs on
   * the credentials the daemon was started with.
   */
  tokens: Map<string, Credential>;
  /**
   * Channels this client named in a shape of its own, by the channel they mean.
   *
   * A client may address a chat by a URI this host did not mint - see
   * `chatFor` - and it then expects to be answered about *that* URI: its
   * subscription is keyed by the string it sent, and an action arriving under
   * any other name belongs to a channel it is not watching. So the spelling is
   * remembered per connection and every notification is addressed back the way
   * it was asked for.
   */
  aliases: Map<string, string>;
}

/**
 * The clients connected to this host, as places a resource can come from.
 *
 * The protocol is symmetrical about `resource*`: the ten methods a client
 * calls on a host are the ten a host may call on a client, with the same
 * params and the same results, and the receiver decides whether to allow the
 * operation whichever way round it went. What that is *for* is a client that
 * publishes something the host has no way to reach - a plugin's virtual
 * files, an editor's unsaved buffers, a filesystem provider - and addresses
 * it as `<scheme>://<clientId>/…`.
 *
 * So this is not a port handed in: it is built out of the connections a host
 * already has, and a URI naming one of them is answered by that client rather
 * than by the host's own filesystem.
 */
export interface Clients {
  /** Every client currently connected, by the id it gave at `initialize`. */
  ids(): string[];
  /**
   * The client a URI belongs to, if a connected one publishes it.
   *
   * `<scheme>://<clientId>/…`, which is how the reference host addresses one.
   * `file:` is never a client's, and neither is any `ahp-` channel scheme -
   * those are this protocol's own and their authority is not a client id.
   */
  owner(uri: string): string | undefined;

  /** Read a file the client serves. */
  read(client: string, uri: string, encoding?: string): Promise<unknown>;
  /** List a directory the client serves. */
  list(client: string, uri: string): Promise<unknown>;
  /** Ask the client what a URI actually is. */
  resolve(client: string, uri: string): Promise<unknown>;
  /** Write a file the client serves. */
  write(client: string, uri: string, content: { data: string; encoding?: string; create?: boolean; overwrite?: boolean }): Promise<unknown>;
  /** Remove one. */
  remove(client: string, uri: string, recursive?: boolean): Promise<unknown>;
  /** Move one. Both URIs must be the same client's. */
  move(client: string, source: string, destination: string, failIfExists?: boolean): Promise<unknown>;
  /** Copy one. Both URIs must be the same client's. */
  copy(client: string, source: string, destination: string, failIfExists?: boolean): Promise<unknown>;
  /** Make a directory. */
  mkdir(client: string, uri: string): Promise<unknown>;
  /** Ask to watch one, and get back the channel the client will report on. */
  watch(client: string, uri: string, options?: Record<string, unknown>): Promise<unknown>;
  /** Ask the client for access to one of its resources. */
  request(client: string, uri: string, access: { read?: boolean; write?: boolean }): Promise<unknown>;
}

/** A protocol server. One host serves many connections. */
export interface Host {
  /**
   * Take a new client and return what answers it.
   *
   * The result's `handle` answers requests; its `close` must be called when
   * the connection drops, or the client's subscriptions leak.
   *
   * The person is the one the socket resolved to, when it resolved to
   * somebody: a caller that admitted the connection on a personal connection
   * token passes what it found, so the first command is served as them
   * without an `authenticate`. Absent is a connection that is nobody, which is
   * what the deployment's own token has always produced.
   */
  accept(peer: Peer, principal?: Principal, root?: boolean): {
    /** Answer one request from this client. */
    handle(request: Request): Promise<unknown>;
    /** Drop this client's subscriptions and state. */
    close(): void;
  };
  /** How many clients are currently connected. */
  connections(): number;
  /**
   * The connected clients, as places a resource can come from.
   *
   * Used by this host to answer a `resource*` command naming a URI a client
   * published, and exposed so an embedder can read one directly.
   */
  clients: Clients;
  /**
   * Replace the tools this host contributes.
   *
   * Full replacement, which is what `session/serverToolsChanged` means, and
   * every running session is told. Sessions started after this get the new
   * set; the ones already running get it on their next turn, because a
   * backend is offered its tools when its process starts.
   */
  setTools(tools: HostTool[]): void;
}
