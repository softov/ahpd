/**
 * What a plugin is, and what it may contribute.
 *
 * A plugin is not a separate kind of thing: it is an installed package whose
 * named `apply` is handed the same option object the daemon already builds,
 * and whose registrations are folded into that object before `createHost` sees
 * it. So a backend, a port or a server tool is an install and a configuration
 * line rather than a source edit and a rebuild.
 *
 * Nothing here imports a runtime value. The contract is the SDK's own types
 * named back, and `foldHostOptions` in `../plugins.js` is the one function that
 * composes several contributions into one option object.
 */

import type { AutomationTriggerDefinition, CanvasState, ChatOrigin, ChatSummary, Icon } from '@microsoft/agent-host-protocol';

import type { Agent } from './agent.js';
import type { Engine, AgentOwner, ServedEngine } from './agents.js';
import type { StartSession } from './automations.js';
import type { SessionConfigAnswerer } from './completions.js';
import type { Adapter, ConnectorOwner, ServedAdapter } from './connectors.js';
import type { EventHandler, EventName, HostHandlers } from './events.js';
import type { Host, HostOptions, HostTool, NodeRegistry } from './host.js';
import type { MachineNeed } from './machine.js';
import type { CollectionOptions, RecordCollection } from './records.js';
import type { ResourceProvider } from './resources.js';
import type { Owner, UsageEntry } from './usage.js';
import type { Grant, Principal } from './users.js';
import type { SecretWork } from './vault.js';
import type { Catalogs } from '../i18n.js';

/**
 * A kind of trigger a plugin offers, in the protocol's own words.
 *
 * The very object a client draws the automation form from, so a plugin writes
 * the listing rather than something this host translates into it: `type` is the
 * name a saved trigger carries, `events` are what may be picked, and
 * `configSchema` is the form below them. A host that lists a type is a host that
 * will fire it, which is why the two are one registration.
 */
export type TriggerTypeDefinition = AutomationTriggerDefinition;

/**
 * One plugin's trigger types, and the way its fires reach the host.
 *
 * Built by the plugin host, and replaced by the fold with the host's own entry:
 * one holding a frozen copy of every definition this plugin may still fire and
 * the `deliver` the host sets once it exists. A plugin's `fireTrigger` reads the
 * entry on its contribution rather than the object it was handed, so a plugin
 * fires into the host's record and never into a record of its own that the host
 * would have to trust.
 */
export interface PluginTriggers {
  /** The plugin that registered them. */
  by: string;
  /** The types, keyed by the name a saved trigger names them with. */
  types: Record<string, TriggerTypeDefinition>;
  /**
   * Where a fire goes, set by the host once it exists.
   *
   * Absent until then, which is a host nobody has built over these types yet: a
   * plugin firing from its own unit test, or one firing while `apply` runs.
   * Nothing is kept for later, because a fire is about what is happening now.
   */
  deliver?: (type: string, event: string, data: Record<string, unknown>, owner?: ConnectorOwner) => void;
  /**
   * Where a run of one named automation goes, set by the host once it exists.
   *
   * Beside `deliver`, and for the same reason: a plugin that wants one
   * automation rather than every watcher of a type asks its host, and the host
   * is the only thing that knows which definitions it holds. Absent until then,
   * and a request made too early reaches nothing.
   */
  run?: (automation: string, data: Record<string, unknown>, owner?: ConnectorOwner) => void;
}

/**
 * What a plugin asks the host for when it starts a session for somebody.
 *
 * The subset of `StartSession` a plugin has any business naming. What is left
 * out is left out on purpose: an `origin` is an automation's run, and a session
 * a plugin starts is not one. What a plugin knows is whose the work is, what it
 * is for, and the first thing to say - which is `prompt` and not `text`,
 * because a plugin is asking for a conversation to begin rather than recording
 * a run.
 *
 * The model and the name are the plugin's to name where its own record holds
 * one, and the backend's own default where it does not: a bot made with a model
 * runs its first turn on that model, and a bot called Motion opens a session
 * called Motion rather than one a catalogue names after its first turn.
 */
export interface SessionRequest {
  /**
   * Whose the session is, and who the host starts it as.
   *
   * Required: the whole point of this door is starting work *for* somebody, and
   * a plugin that wants work of the host's own says `root:<hostName>` rather
   * than leaving it to be guessed. The owner's own grants and policies are what
   * the session is started under.
   */
  owner: Owner;
  /** The backend it runs on, or the host's own default. */
  provider?: string;
  /** Where it works, or wherever a session with nothing said usually works. */
  workingDirectory?: string;
  /**
   * Whether the session's own folder is trusted, so its project files are read.
   *
   * Trusts only the `workingDirectory` this request names - the folder itself,
   * never one under it - and is kept with the session, so a session started
   * again after a restart is still trusted in that one folder. Honoured only
   * where the plugin's configuration entry holds `session:trust`; a request
   * that asks for it without that grant is refused, and the refusal names it.
   * A plugin that asks for trust and names no folder trusts nothing.
   */
  trusted?: boolean;
  /**
   * Whether the session loads the settings of the person who runs the daemon.
   *
   * `true` is what every session has always done, and what an absent flag
   * means. `false` is for work the plugin does as somebody else - a bot's back
   * session, which belongs to the person who chatted with it but must not be
   * shaped by what that person put in `~/.claude`: no user settings, no
   * memory, no `~/.claude/CLAUDE.md`. What the folder carries still loads where
   * the request also has it trusted, so a bot's own `CLAUDE.md` reaches it.
   *
   * Kept with the session, so a session started again after a restart loads
   * the same settings without the request being repeated.
   */
  userSettings?: boolean;
  /** Config values for the new session, as a client's `createSession` gives. */
  config?: Record<string, unknown>;
  /** The model it asks for, as the protocol's `ModelSelection`, or the backend's own. */
  model?: unknown;
  /** What it is called, where the plugin already has a name for it. */
  title?: string;
  /**
   * What the host tells the model beside its own prompt.
   *
   * The plugin's half of `Start.instructions`, added after the instructions the
   * host's tools carry. A backend that takes no system prompt gets them in the
   * first message, which is the only place a session can be told anything
   * before it starts working.
   */
  instructions?: string[];
  /**
   * The opt-in host tools this session asks for, by name.
   *
   * A tool the host marks `optIn` is offered to no session unless its request
   * names it here, and the names are kept with the session so a restart offers
   * the same tools. Naming a tool the host does not offer is not a refusal;
   * the session simply never sees it.
   */
  tools?: string[];
  /**
   * The first thing said in it, where the plugin has something to say.
   *
   * Absent is a session that opens with nobody speaking, which is what a bot
   * with no instructions asks for. Present and blank is a mistake rather than
   * a quiet session, the same way a name written as spaces is not a name.
   */
  prompt?: string;
}

/**
 * What a plugin asks the host for when it starts a chat in a session.
 *
 * A chat is not a session: it is another conversation inside one, and the
 * session stays what it is - its owner, its provider, its tree. What the plugin
 * names is the backend that serves this one chat, where that is not the
 * session's own, and the first thing to say in it.
 */
export interface ChatRequest {
  /**
   * The backend that serves the chat, or the session's own where absent.
   *
   * A chat of another backend runs on that one and keeps its own transcript,
   * while the session goes on being served by its own provider. The name is
   * the provider a plugin registered, which is what a session's own request
   * names too.
   */
  provider?: string;
  /** The model the first turn runs on, within that backend, or the backend's own. */
  model?: string;
  /**
   * Config values for the chat, checked against the backend's schema.
   *
   * The keys the session owns and no backend does - its `computer` and what a
   * plugin contributed - are added from the session whatever is named here.
   */
  config?: Record<string, unknown>;
  /** What the chat is called, where the plugin already has a name for it. */
  title?: string;
  /**
   * The first message; absent is a chat that opens with nobody speaking.
   *
   * Present and blank is a mistake rather than a quiet chat, the same way an
   * empty session prompt is.
   */
  prompt?: string;
}

/**
 * One plugin's way of starting a session, and what reaches the host.
 *
 * Built by the plugin host and carried through the fold rather than copied, for
 * the same reason `PluginTriggers` is: a plugin starts a session from a route or
 * a timer long after `apply` returned, so the object its closure holds has to be
 * the object the host fills in. `start` is that place, and `opens` is the other
 * half of it - whether the session a plugin holds is one this host still has.
 */
export interface PluginStarts {
  /** The plugin that asked. */
  by: string;
  /**
   * What this plugin's configuration entry grants it, set by its host.
   *
   * The same question its own connection is gated against, asked here because
   * a session request does not arrive on that connection. Absent until the
   * host fills it in, and absent on a host built by hand with no grants: a
   * plugin that holds nothing may make no request that needs a grant.
   */
  can?: (grant: Grant) => boolean;
  /**
   * Where the ask goes, set by the host once it exists.
   *
   * Absent until then, which is a plugin asking while `apply` runs or from its
   * own unit test with no host built over it. Unlike a fire, which is about
   * what is happening now, this is a call that owes an answer - so a plugin
   * that asks too early is told rather than dropped.
   *
   * `named` is called with the session's URI before the session is made, so a
   * plugin that answers for that URI - a bot's connector reader - names it at
   * the first tool list the backend is spawned with.
   */
  start?: (wanted: StartSession, named?: (uri: string) => void) => Promise<string>;
  /**
   * Where a chat inside a running session is asked for, set by the host once
   * it exists.
   *
   * Beside `start`, and absent until then for the same reason: a bot starts a
   * chat from a wake hook long after `apply` returned. The session is named by
   * its URI, and what comes back is the new chat's.
   */
  startChat?: (session: string, wanted: ChatRequest) => Promise<string>;
  /**
   * Whether this host can open a session: running now, or in its catalogue.
   *
   * Set by the host once it exists, beside `start`, and absent until then. The
   * store keeps what was recorded about a session - its owner, its chats - and
   * a row outlives the session itself: a process that ran no turn leaves
   * nothing on a backend's disk, so a restart has nothing to open and the row
   * is what is left. This is the question that tells the two apart, and it is
   * the same pair a subscribe is answered from.
   */
  opens?: (uri: string) => Promise<boolean>;
}

/**
 * One plugin's end of the connection to its own host.
 *
 * The host's end is a `Peer` handed to `Host.accept`, and this is what the
 * plugin holds on the other side of the same in-memory pair: `request` and
 * `notify` are the `Peer`'s, `onMessage` is where what the host says arrives,
 * and `close` ends the connection from this side. There is no typed client and
 * no second layer over the protocol, so what a plugin writes here is AHP,
 * spelled with the protocol's own types. A plugin that wants to watch a running
 * host is a client of it, which is what
 * says and what this end is for.
 */
export interface PluginPeer {
  /** Send a complete JSON-RPC message. Dropped if the connection has closed. */
  send(message: Record<string, unknown>): void;
  /** Send the host a notification: one that carries no id and gets no reply. */
  notify(method: string, params: unknown): void;
  /**
   * Ask the host something, and wait for what it says.
   *
   * Rejects with an `RpcError` the host sent, an `RpcTimeout` when nothing came
   * back inside `timeoutMs`, or an `RpcClosed` when the connection went away
   * with the question still in flight.
   */
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
  /**
   * Take what the host says of its own accord: its notifications, and its own
   * questions to this client.
   *
   * The answers to this connection's `request`s are not here - they settle the
   * promise that asked - and the difference is the one JSON-RPC draws: a frame
   * with a `method` is the host speaking, and one without is a reply to
   * something this side asked. A question carries its `id`, and `send` is how
   * it is answered.
   *
   * The handler is called for every frame from the moment it is set, and the
   * last one set is the one that is called. A frame that arrives before there
   * is one is dropped, which is a connection nothing is reading yet.
   */
  onMessage(handle: (message: Record<string, unknown>) => void): void;
  /** Close the connection, rejecting every question still unanswered. */
  close(): void;
}

/**
 * A channel a plugin serves, under an `x-` scheme of its own.
 *
 * A client subscribes to any URI on the scheme and is answered with
 * `snapshot`; what changes after that is sent with `ChannelHandle.publish`. A
 * client may not dispatch to it: the plugin is the only writer.
 */
export interface PluginChannel {
  /** What a reader needs to subscribe, unless `authorize` lets them in. */
  grant: Grant;
  /**
   * What the channel holds for this reader, as the subscribe's `state`.
   *
   * `reader` is nobody on a host with no users directory. `client` is the id
   * the connection gave at `initialize` or `reconnect`, which a later
   * `publish` may name with `to`.
   */
  snapshot(uri: string, reader: Principal | undefined, client: string): unknown;
  /**
   * Whether a reader without `grant` may subscribe to this URI all the same.
   *
   * Asked only of a subscriber the grant refuses, so it widens who may read
   * and never narrows it.
   */
  authorize?(uri: string, reader: Principal): Promise<boolean>;
  /** A client stopped watching every URI on the scheme: it unsubscribed or disconnected. */
  left?(client: string): void;
  /** What a client shows for the channel, read when the host advertises it. */
  describe?(): { title: string; description?: string };
}

/**
 * Who of a channel's subscribers is sent one action.
 *
 * Kept with the action, so the same test decides at the send and at each
 * replay - decision `a-plugin-channel-filters-each-action-per-subscriber`.
 */
export interface PublishOptions {
  /**
   * Whether this subscriber sees the action, asked at each send and each
   * replay with the subscriber's current principal and client id.
   */
  visible?(reader: Principal | undefined, client: string): boolean;
  /** The one client id the action goes to. Absent, it goes to every subscriber `visible` lets see it. */
  to?: string;
}

/** One subscriber of a plugin channel, as `ChannelHandle.subscribers` answers it. */
export interface ChannelSubscriber {
  /** The id the client gave at `initialize` or `reconnect`. */
  client: string;
  /** Who the connection is now, or nobody on a host with no users directory. */
  reader: Principal | undefined;
}

/** What `registerChannel` answers: the plugin's way to send on its channel. */
export interface ChannelHandle {
  /**
   * Send one action on a URI of the channel.
   *
   * The action's `type` starts with the scheme and a `/`, such as
   * `x-ahpd-bots/added`. Refused until a host is built over the plugin.
   */
  publish(uri: string, action: { type: string } & Record<string, unknown>, options?: PublishOptions): void;
  /**
   * Each client subscribed to the URI now, once for each person on it: two
   * people who share a client id are two entries. Empty until a host is built
   * over the plugin.
   */
  subscribers(uri: string): ChannelSubscriber[];
  /**
   * The last locale a client sent, or `undefined` when it sent none or no
   * host is built over the plugin yet. What a channel translates one reader's
   * records into.
   */
  localeOf?(client: string): string | undefined;
}

/**
 * One plugin channel, and where its sends reach the host.
 *
 * Built by the plugin host and carried through the fold rather than copied,
 * for the same reason `PluginStarts` is: the handle a plugin holds is a closure
 * over this object, and the host sets `publish` and `subscribers` on it once
 * it exists.
 */
export interface ServedChannel {
  /** The plugin that registered it. */
  by: string;
  /** The scheme, in lowercase, without `:`. */
  scheme: string;
  /** What the plugin registered. */
  channel: PluginChannel;
  /** Where a publish goes, set by the host once it exists. */
  publish?: (uri: string, action: Record<string, unknown>, options: PublishOptions) => void;
  /** Who is subscribed, set by the host once it exists. */
  subscribers?: (uri: string) => ChannelSubscriber[];
  /** The last locale a client sent, set by the host once it exists. */
  localeOf?: (client: string) => string | undefined;
}

/**
 * What a plugin's Plan call says for a session.
 *
 * One line per step, checked where the step is done and unchecked otherwise, in
 * the order the plugin wants them shown. The host asks for the lines each time
 * the plugin says the list moved, so a list rewritten mid-turn is redrawn
 * rather than appended to, and a change still being drawn when the turn ends
 * delays that ending until the row is on the session.
 */
export type PlanReader = (uri: string) => Promise<string[]>;

/**
 * One plugin's Plan call, and where its changes reach the host.
 *
 * Built by the plugin host and carried through the fold rather than copied, for
 * the same reason `ServedChannel` is: the plugin holds this object, and the
 * host sets `changed` on it once it exists.
 */
export interface ServedPlan {
  /** The plugin that registered it. */
  by: string;
  /** The lines of the call for one session, read when asked. */
  read: PlanReader;
  /** Where a change is announced, set by the host once it exists. */
  changed?: (uri: string) => Promise<void>;
}

/**
 * What a plugin's key in a session's `_meta` says for one session.
 *
 * Read inside `metaOf`, which composes a session's `_meta` for a snapshot, a
 * replay and `session/metaChanged` alike, and which is synchronous - so the
 * reader answers with what it already holds rather than with a promise. A
 * reader with nothing to say answers `undefined`, and the key is left out.
 */
export type SessionMetaReader = (uri: string) => unknown;

/** One key a plugin adds to a session's `_meta`. */
export interface SessionMetaKey {
  /** The key in `_meta`, such as `ahpd.tasks`. */
  key: string;
  /** The value for one session. */
  read: SessionMetaReader;
}

/**
 * One plugin's keys in a session's `_meta`, and where their changes reach the
 * host.
 *
 * Built by the plugin host and carried through the fold rather than copied, for
 * the same reason `ServedChannel` is: the plugin holds this object, and the
 * host sets `changed` on it once it exists.
 */
export interface ServedSessionMeta {
  /** The plugin that registered them. */
  by: string;
  /** The keys, in the order `registerSessionMeta` was called. */
  keys: SessionMetaKey[];
  /** Where a change is announced, set by the host once it exists. */
  changed?: (uri: string) => void;
}

/**
 * One plugin's canvases, and where its calls reach the host.
 *
 * Built by the plugin host and carried through the fold rather than copied, for
 * the same reason `ServedChannel` is: the plugin holds this object, and the
 * host sets `open`, `update` and `close` on it once it exists. All three are
 * absent until then, so a call made while `apply` runs is told rather than
 * dropped.
 *
 * `by` is the plugin the canvases are opened as, which is the one that may
 * change or close each of them.
 */
export interface ServedCanvases {
  /** The plugin that opened them. */
  by: string;
  /** Where an open goes, set by the host once it exists. */
  open?: (chat: string, state: CanvasState) => string;
  /** Where an update goes, set by the host once it exists. */
  update?: (resource: string, state: CanvasState) => void;
  /** Where a close goes, set by the host once it exists. */
  close?: (resource: string) => void;
  /**
   * Where the unload of the plugin closes what it still has open.
   *
   * Not the plugin's call: the host's own road, taken when the daemon unloads
   * a plugin while it runs, so a canvas does not outlive the process that drew
   * it. Absent until a host is built, and then a closer nothing refuses.
   */
  closeAll?: () => void;
}

/**
 * The connectors a session may use, by alias, as a plugin answers them.
 *
 * Read when the host builds a session's tool list and when it runs a call, and
 * synchronous for that reason: `forSession` is synchronous and the sdk does
 * not read a bot record. A reader with nothing to say answers `undefined`, and
 * a map of aliases to `connectors://<adapter>/<id>` where it has something.
 */
export type BindingsReader = (uri: string) => Record<string, string> | undefined;

/** One plugin's bindings for a session. */
export interface ServedBindings {
  /** The plugin that registered them. */
  by: string;
  /** The map for one session, read when asked. */
  read: BindingsReader;
}

/**
 * A command a plugin or the daemon serves, under an `x-` name of its own.
 *
 * A client sends it as any other request, and what `handle` answers is the
 * result. This host names its own
 * `x-ahpd/<domain>/<verb>`.
 */
export interface PluginMethod {
  /** What a caller needs to send the command, unless `authorize` lets them in. */
  grant: Grant;
  /**
   * Whether a caller without `grant` may send the command with these params
   * all the same.
   *
   * Asked only of a caller the grant refuses, so it widens who may call and
   * never narrows it.
   */
  authorize?(params: Record<string, unknown>, reader: Principal): Promise<boolean>;
  /**
   * The answer to one request, as its `result`.
   *
   * `params` are the request's own. `reader` is nobody on a host with no users
   * directory. `client` is the id the connection gave at `initialize` or
   * `reconnect`. `owner` is whose work the request is, as a resource write
   * records it: `user:<id>` or `plugin:<name>` for a signed-in caller,
   * `root:<host>` for the root connection, and nobody on a host with no users
   * directory. An `RpcError` thrown here is what the caller is told.
   */
  handle(params: Record<string, unknown>, reader: Principal | undefined, client: string, owner?: Owner): unknown;
  /** What a client shows for the command, read when the host advertises it. */
  describe?(): { title: string; description?: string };
}

/** One served command, and who serves it. */
export interface ServedMethod {
  /** The plugin that registered it, or the daemon's own name for its own. */
  by: string;
  /** The command's name, such as `x-ahpd/usage/totals`. */
  name: string;
  /** What was registered. */
  method: PluginMethod;
}

/**
 * One plugin's connections to its own host, and where they come from.
 *
 * Built by the plugin host and carried through the fold rather than copied, for
 * the same reason `PluginStarts` is: a plugin connects from a route or a timer
 * long after `apply` returned, so the object its closure holds has to be the
 * one the daemon fills in. `host` is that place and `close` is what the daemon
 * calls when it stops.
 */
export interface PluginConnects {
  /** The plugin that connects. */
  by: string;
  /**
   * The host a connection is accepted by, set by the daemon once it exists.
   *
   * Absent until then, which is a plugin asking while `apply` runs or from its
   * own unit test with no host built over it. Unlike a fire, which is about
   * what is happening now, this is a call that owes an answer - so a plugin
   * that asks too early is told rather than dropped.
   */
  host?: Host;
  /**
   * Close every connection this plugin has open.
   *
   * Called when the daemon raises `stopping`: a plugin that never closed its
   * own connection would otherwise outlive the listeners, and a connection
   * still subscribed to a session is one the host keeps telling.
   */
  close(): void;
}

/**
 * The `HostOptions` keys that hold one value, one plugin at a time.
 *
 * The closed set of `set` keys, and deliberately not every key: `agents` and
 * `tools` are appended rather than set, so they are not here and no key can be
 * reached by two operations. A kind added later either joins this union or
 * gets its own one-line registration method.
 */
export type PortKey =
  | 'resources'
  | 'terminals'
  | 'changes'
  | 'directories'
  | 'worktrees'
  | 'github'
  | 'automations'
  | 'sessions'
  | 'diagnostics'
  | 'computers'
  | 'containers'
  | 'usage'
  | 'policies'
  | 'vault'
  | 'records'
  | 'commandParser';

/**
 * What one port key holds.
 *
 * `NonNullable` because the option is optional and the registration is not:
 * `registerResources` demands a `ResourceStore`, not a bag that happens to
 * compile. Each method names its own port, so the method is the spelling an
 * author reads rather than a key they have to know.
 */
export type PortOf<K extends PortKey> = NonNullable<HostOptions[K]>;

/**
 * One plugin's HTTP route, as the host's own listener serves it.
 *
 * A `Request` in and a `Response` out: the shape `Bun.serve` and `Deno.serve`
 * take and the one `toNodeListener` wraps for Node, so a route is the same
 * handler on every runtime. The request reaches it
 * whole, so a plugin reads `new URL(request.url).pathname` and finds its own
 * prefix on the path rather than being handed a remainder it has to trust.
 */
export type Route = (request: globalThis.Request) => Promise<globalThis.Response>;

/**
 * What the object form of a spec adds to the module it names.
 *
 * Only the person naming the plugin knows these: the options `apply` receives,
 * whether it is switched on at all - which is what lets one configuration keep
 * a plugin installed and turned off - and what it may do when it acts on this
 * host as a client of its own.
 *
 * The manifest fields are here because a plugin with no package.json has no
 * other place to declare itself: an entry with an `id` is that plugin's
 * manifest, and it takes the same keys a `plugin.json` does.
 */
export interface PluginSpecEntry extends PluginManifest {
  /** Passed to `apply` as its second argument. */
  options?: Record<string, unknown>;
  /** `false` drops the spec before it is resolved. Absent means on. */
  enabled?: boolean;
  /**
   * What this plugin's own connection may do, as `<subject>:<operation>`.
   *
   * None by default, which is a plugin that may read nothing and change
   * nothing on this host: every gated command its connection sends is refused.
   * A plugin that never connects is unaffected by the list either way, so this
   * is the one line an operator writes to let a plugin act - and on a host with
   * no user directory nothing is gated, exactly as for every other connection.
   *
   * A string rather than a `Grant` because it is read off a file, which holds
   * whatever was typed: the loader checks each one and drops what is not a
   * grant, rather than the type promising something nothing verified.
   */
  grants?: string[];
}

/**
 * One plugin, as configuration or the command line names it.
 *
 * A bare string is the module specifier and carries no options. The object form
 * names its module with `source`; `name` is what a listing prints instead of
 * the id. An entry written before `source` named its module with `name`, and
 * that form still loads: the daemon writes `source` the next time it changes
 * the entry.
 */
export type PluginSpec = string | (PluginSpecEntry & (
  | {
    /** The module specifier, or a path to a directory or a file. */
    source: string;
    /** What a listing prints instead of the id. */
    name?: string;
  }
  | {
    /** The old form has no `source`, and reads `name` as the module. */
    source?: undefined;
    /** The module specifier, as an entry written before `source` named it. */
    name: string;
  }
));

/**
 * What a plugin may read, and the one thing it may write.
 *
 * Read-only: a plugin is told where it is running and may write a line to the
 * log or to what the daemon announces, and every method that contributes a
 * value is named `register*` so a registration is told apart at the call site
 * from what a plugin only reads.
 */
export interface PluginContext {
  /** The directory whose sessions the host serves, and the catalogue's scope. */
  readonly path: string;
  /** Every directory the host serves; the first is the default one. */
  readonly paths: string[];
  /** The version of `@ahpd/sdk` actually in use, which is what a peer range is checked against. */
  readonly version: string;
  /**
   * What this host is called, for the work nobody started as themselves.
   *
   * The same name `root:<hostName>` records against, which is what a plugin
   * charges work it cannot name an owner for to. A daemon that named none
   * leaves it `host`, exactly as the host itself does.
   */
  readonly hostName: string;
  /**
   * Where the daemon keeps its own configuration.
   *
   * The folder its other stores are in, and where a plugin that has to keep a
   * record of its own puts it: a file here belongs to this daemon and travels
   * nowhere else - decision `a-dev-container-owner-is-kept-beside-the-config`.
   */
  readonly configDir: string;
  /**
   * What this daemon is, as one id that is the same across its restarts.
   *
   * A random value made once and kept beside the configuration, read after -
   * not a process id, because what a plugin labels a machine with has to
   * outlive the run that made it, or a daemon restarting could not tell a
   * leftover of its own from one a daemon that has been and gone left
   * behind.
   *
   * Optional because the loader is what knows the configuration folder: a
   * loader that names none leaves it absent, and a plugin then labels nothing
   * with it, which matches every daemon that also labels nothing.
   */
  readonly hostId?: string;
  /**
   * Whether this host verifies people, which is what makes it a host more than
   * one person uses.
   *
   * Absent is "nobody signs in here", which is the install that never
   * configured people and a loader in a test that named none. Read from the
   * base's `users` port, so a plugin cannot be told one thing about the host it
   * is being folded into and handed another - decision
   * `dev-containers-need-allowed-folders-on-a-host-with-users`.
   */
  readonly hasUsers?: boolean;
  /** One line to the daemon's log. */
  log(message: string): void;
  /**
   * One line in what the daemon announces about itself.
   *
   * The log is stderr and a person reads it; the announcement is stdout and
   * `ahpd status` parses it, which is where somebody looks for the URL to
   * paste into a client. A plugin that made the host reachable somewhere new
   * has to be able to say so there, or the address it created is one only its
   * own log knows.
   *
   * One line, without a newline, added after the daemon's own and in plugin
   * order. Said at any point up to the announcement - which is written once
   * `listening` has been handled - and ignored after it.
   */
  say(line: string): void;
  /**
   * A YAML text as data, with the subset the host reads its own files with.
   *
   * The host's, so a plugin that reads a frontmatter or a skill file needs no
   * YAML dependency of its own.
   * Throws with the line that is wrong.
   */
  parseYaml(text: string): unknown;
  /** A value as YAML text that `parseYaml` reads back as the same value. */
  stringifyYaml(value: unknown): string;
}

/**
 * What a loader hands `pluginHost`: a `PluginContext` that may leave out the
 * YAML functions.
 *
 * The daemon gives them, and a loader in a test may not; the host then gives
 * the plugin two that throw.
 */
export type LoaderContext = Omit<PluginContext, 'parseYaml' | 'stringifyYaml'> & Partial<Pick<PluginContext, 'parseYaml' | 'stringifyYaml'>>;

/**
 * One thing a plugin wants a person to read, beside the plugin's row.
 *
 * An alert is the plugin's own answer to "what is wrong here", where `log` is a
 * line for whoever keeps the daemon's log: a client draws it on the plugin's
 * page, so the person who saves an option sees what the plugin made of it.
 *
 * `level` says how bad it is, and `text` names it in one sentence. `ref` names
 * what the alert is about as `<kind>:<id>`, such as `adapter:ap-postgres`: an
 * alert with the same `ref` replaces the one before it, and clearing a `ref`
 * takes it away. An alert with no `ref` is a line of its own and is never
 * replaced.
 */
export interface Alert {
  /** How bad it is: `notice` and `info` are news, `warning` and `error` are trouble. */
  level: 'notice' | 'info' | 'warning' | 'error';
  /** What it says, in one sentence. */
  text: string;
  /** What it is about, as `<kind>:<id>`, which two alerts share to replace one another. */
  ref?: string;
}

/**
 * One surface a plugin sends a view to.
 *
 * A surface is a place in a client where a plugin draws. `main` is the
 * plugin's own page, and it is the only one this host knows: a view sent to a
 * name no client draws would be lost without a word, so another name is
 * refused.
 */
export type ViewSurface = 'main';

/**
 * One component of a view, in the shape the renderer reads.
 *
 * `id` names the component, and it is also the key the component is held under
 * in `PluginView.components`. `component` is the kind: `Text`, `Link`,
 * `Button`, `Card`, `Row`, `Column`, `List`, `Divider` or `Icon`. The rest are
 * the kind's own properties, and each is a literal value.
 *
 * `child` names one component below this one, `children` names a list of them,
 * and `action` is what a Button calls when a person clicks it.
 */
export interface ViewComponent {
  /** The name a parent uses, and the key this component is held under. */
  id: string;
  /** The kind this component is drawn as. */
  component: string;
  /** The one component below this one. */
  child?: string;
  /** The components below this one, in the order they are drawn. */
  children?: string[];
  /**
   * What a Button calls, as `{ event: { name, context? } }`.
   *
   * `name` is an `x-` method this plugin registered, and `context` is the
   * params a client sends with the request.
   */
  action?: { event: { name: string; context?: Record<string, unknown> } };
  /** The component's own properties, such as a Text's `text`. */
  [prop: string]: unknown;
}

/**
 * What a plugin draws on a surface: an A2UI v0.10 surface of components.
 *
 * The shape is scena's `A2uiCreateSurface` without `dataModel`: `root` names
 * the component drawn first, and `components` holds each one by its `id`. A
 * view is sent whole on each change, so a client draws the one it last read
 * and keeps nothing between them.
 *
 * A view is at most 200 components, of at most 64 KiB of JSON. A Link takes an
 * absolute http(s) URL, and a Button calls a method this plugin registered.
 */
export interface PluginView {
  /** The `id` of the component drawn first. */
  root: string;
  /** Every component of the view, by its own `id`. */
  components: Record<string, ViewComponent>;
}

/**
 * What one install answered: the version it left, or why npm could not install
 * the package.
 *
 * `version` is read from the installed package's own `package.json`, so it is
 * the version npm chose rather than the one that was written. `error` is one
 * line of npm's own error, without a newline.
 */
export type InstallAnswer = { version: string } | { error: string };

/**
 * The contribution surface, which is `HostOptions` named back.
 *
 * Every method that contributes a value is named `register*` (), and the set of kinds is closed, one
 * method each (). Every registration is
 * checked against the contract it satisfies before it is recorded, so a value
 * the daemon did not write is refused at this boundary; the check and the
 * implementation of this interface are the loader's, not this file's.
 *
 * Not here yet, and named in the domain reference so an author is not left
 * looking for a method that should not exist: `registerCustomization`,
 * `registerMcpServer` and `registerConfig`.
 */
export interface PluginHost extends PluginContext {
  /**
   * One thing this plugin wants a person to read, on the plugin's own row.
   *
   * This is the way a plugin says what it found: a piece that did not load, an
   * install that ended, a record it could not read. The alert is kept by the
   * daemon and served on the plugin's row, so a client shows it on the plugin's
   * page. An alert with a `ref` replaces the one before it with the same `ref`,
   * which is how a plugin keeps one line about one item.
   *
   * Said at any time: while `apply` runs, or long after it returned. A daemon
   * holds at most fifty alerts for one plugin, and drops the oldest first.
   */
  alert(alert: Alert): void;
  /**
   * Take away the alert whose `ref` is this one, if the plugin raised it.
   *
   * Nothing happens when no alert has that `ref`, so a plugin may clear one in
   * a closing path without asking first.
   */
  clearAlert(ref: string): void;
  /**
   * What this plugin wants a client to draw on one of its surfaces.
   *
   * A view is a small A2UI surface of components - Text, Link, Button and a
   * few layout kinds - which a client draws on the plugin's page. It is how a
   * plugin says what it is doing when one sentence is not enough: the state of
   * a tunnel, the items it found, the things a person may do next.
   *
   * The view is checked before it is kept. A view on `main` replaces the one
   * before it, and a plugin sends the whole view rather than a change to it.
   * `surface` is `main` by default, and it is the only surface this host
   * knows.
   */
  showView(view: PluginView, surface?: ViewSurface): void;
  /**
   * Take the view off one surface, if this plugin set one.
   *
   * Nothing happens when the surface carries no view of this plugin's, so a
   * plugin may clear one in a closing path without asking first. `surface` is
   * `main` by default.
   */
  clearView(surface?: ViewSurface): void;
  /**
   * One item of this plugin's own was skipped, and why.
   *
   * This raises a `warning` alert with no `ref`, which is the plugin's row and
   * nothing else: where `log` is a line for a person reading the daemon's log,
   * this is what a client shows on the plugin's page, because it is a thing the
   * daemon started without rather than a thing that went wrong in it: the
   * preset a plugin dropped, the variant it could not read, the machine profile
   * nothing holds.
   *
   * It costs the item and not the plugin - saying one is never a failure, and
   * a plugin that said one keeps everything else it registered. One line,
   * without a newline, naming the item.
   */
  problem(line: string): void;
  /**
   * Where a package this plugin installs is kept: the absolute path of
   * `installed/` inside the plugin's own folder.
   *
   * This is the folder `install` writes into, and the second place a plugin
   * looks for a package it installs. It is nothing for a plugin with no folder
   * of its own, such as one loaded from a `data:` or `https:` URL; `install`
   * answers an error there.
   */
  installed?: string;
  /**
   * Install one npm package into this plugin's own `installed/` folder.
   *
   * `spec` is what npm takes: a package name, with `@<version>` after it when
   * one version is asked for, such as `@activepieces/piece-postgres@0.5.1`.
   * The version is read back from the package npm left, so the answer is what
   * was installed rather than what was written.
   *
   * The install runs with `--ignore-scripts`, `--no-audit` and `--no-fund`, so
   * a package's own install scripts never run. One install runs at a time for
   * one plugin, and a second waits for the first: two npm runs in one folder
   * would race on its `package.json`.
   *
   * Answers `{ version }` when npm installed the package, and `{ error }` with
   * one line of npm's own error when it did not. A plugin with no folder of its
   * own answers an error, because there is nowhere to install into.
   */
  install(spec: string): Promise<InstallAnswer>;
  /**
   * One agent's machine needs, read when called rather than at load.
   *
   * The plugin that makes machines is the one that asks: a machine whose
   * profile lists `agents` is made at create time, and the plugin that
   * registers an agent may load before or after this one, so nothing can be
   * read while `apply` runs. The host is the one thing that knows every agent,
   * and it answers the agent's `machine()` here.
   *
   * `undefined` when no agent has that provider, which is a profile naming an
   * agent this host does not have. An agent that declares nothing answers an
   * empty record, which is a machine with nothing added to it.
   */
  machineNeeds(provider: string): Record<string, MachineNeed> | undefined;
  /**
   * Whose each stored agent is, read when called rather than at load.
   *
   * The agents channel's map: an id a record holds answers its owner, and an id
   * no record holds is absent - the daemon's own agent or one a plugin
   * registered. Read live for the reason `machineNeeds` is: the records are
   * folded while the daemon runs, and a plugin that keeps a record naming an
   * agent - a bot's `preset` - has to ask at each use rather than once.
   *
   * Empty on a host with no agents channel, where every agent is the daemon's.
   */
  agentOwners(): ReadonlyMap<string, AgentOwner | undefined>;
  /**
   * The hosts that joined this one, and the socket a session in one runs on.
   *
   * The daemon's own registry, read-only: which nodes exist is `ahpd node`'s
   * to say, since a token is shown once and a name is not a plugin's to choose.
   * A plugin that serves machines lists a connected node as one and starts a
   * session in it through `connect`; it never adds or removes a node.
   *
   * Absent on a host no node joined, which is every host but a daemon started
   * with a users file.
   */
  nodes?: NodeRegistry;
  /**
   * Keep one usage record, in the host's `usage` port.
   *
   * The way a plugin says what it cost: a computer records the time it spent
   * up, and a backend that meters itself records what its turns used. The record is
   * `UsageEntry`, either kind, and the store is the host's own rather than a
   * plugin's, so every record a daemon keeps lands in one place.
   *
   * Resolved when it is called rather than at load, because the store belongs
   * to the host and not to this: the plugin that registers one may load after
   * this one, and the port may not exist at all. A host with no `usage` port
   * records nothing and does not fail - there is nowhere to write, which is a
   * host nobody has asked to keep usage rather than a plugin that got it wrong.
   */
  recordUsage(entry: UsageEntry): Promise<void>;
  /**
   * The value of one secret, under the scope rule of its name.
   *
   * `host:<name>` is read for anything, `team:<team>/<name>` only for work
   * charged to that team and `user:<id>/<name>` only for that person's own work. The value is
   * read when it is asked for rather than at load, and a host with no `vault`
   * port refuses the name rather than answering it with nothing.
   */
  secret(name: string, work?: SecretWork): Promise<string>;
  /**
   * Whether this daemon keeps one session, read when called.
   *
   * The computer plugin asks at startup about a disposable machine it found,
   * to know whether that leftover is one of its own to adopt. The
   * store is the host's own and the plugin that made the machine may have
   * loaded before the session was ever kept, so it is read when it is asked
   * for.
   *
   * A promise, because the store is named by the fold that runs after every
   * plugin has applied and a plugin asks while the later ones are still
   * loading: an answer of "no" until the fold has run would make a slow plugin
   * decide which leftovers this daemon adopts. A host that keeps no sessions
   * answers `false` for all of them, and adopts nothing.
   */
  sessionKept(uri: string): Promise<boolean>;
  /**
   * Whose a session this host has is, or nothing where it has none.
   *
   * A plugin that adopts a session somebody else started - a bot linking one
   * its owner already has - has to know whose it is before it can say the link
   * is theirs to make, and the store that knows is the host's own. A URI this
   * host has never opened answers nothing, which is a different answer from a
   * session of the host's own that nobody owns.
   *
   * A row is not a session. What the store keeps about one outlives the
   * process that ran it, and a session that ran no turn leaves nothing on a
   * backend's disk for a restart to read back - so its owner is answered only
   * where this host can still open it, running now or in its catalogue. A
   * plugin that reuses a session is told nothing for the one that is gone and
   * starts a new one, rather than sending to a session `No agent for session`
   * answers.
   *
   * Read the way `sessionKept` is, and for the same reason: the store is named
   * by the fold that runs after every plugin has applied, so a plugin asking
   * while the later ones are still loading waits rather than being told there
   * is nobody. A host that keeps no sessions answers nothing for all of them.
   */
  sessionOwner(uri: string): Promise<Owner | undefined>;
  /**
   * One collection of this plugin's records, in the host's `records` port.
   *
   * The name is a slug, and a name that another plugin opened is refused, so
   * two plugins never share one collection. Each call on the collection waits
   * until the fold names the port, so a plugin opens one while `apply` runs and
   * a plugin that registers a store may load after this one. A host with no
   * `records` port refuses each call.
   */
  records(name: string, options?: CollectionOptions): RecordCollection;
  /**
   * Start a session for somebody, and answer its URI.
   *
   * A plugin that needs a session of its own - a bot, a machine that has to be
   * talked to - has nobody at the keyboard to be, and this is how it gets one
   * without inventing a second road into the host. What it takes is every step
   * a client's `createSession` takes: the tree is isolated, the owner's grants
   * and policies are asked about, the machine the config names is made, and the
   * prompt is the first turn - so a session started here is one the owner could
   * have started themselves, and is theirs in the catalogue afterwards.
   *
   * The owner's own `session:create` is asked first, and a refusal reads
   * exactly as it does at the door. A plugin may not start work the person it
   * names could not have started. A host with no users directory gates nothing,
   * here as anywhere else.
   *
   * Resolved when it is called rather than at load: the host this reaches does
   * not exist while `apply` runs, so asking before one is built over this
   * plugin throws rather than being kept for later.
   *
   * `named` is called once, with the URI the session will have, before the tree
   * is isolated or the backend spawns. A plugin that answers for that URI can
   * therefore answer from the start - a bot's connectors are in the first tool
   * list rather than only the one built after the start answers. A `named`
   * that throws is logged against the host and the start goes on.
   */
  startSession(wanted: SessionRequest, named?: (uri: string) => void): Promise<string>;
  /**
   * Start a chat inside a running session, on the backend it names.
   *
   * A bot that wakes to answer somebody says what it has to say in a chat of
   * the session it already has, rather than in a session of its own - and that
   * chat may run a harness the session's other chats do not. What it takes is
   * every step a client's `createChat` takes, plus the backend: the chat is
   * spawned on that backend with `config` checked against its schema, is
   * announced on the session's channel, and is recorded so a restart starts it
   * there again.
   *
   * The session owner's own `chat:create` is asked first, and a refusal reads
   * exactly as it does at the door - a plugin may not add a chat the person
   * the session belongs to could not have added. A host with no users
   * directory gates nothing, here as anywhere else.
   *
   * Answers the new chat's URI. Resolved when it is called rather than at
   * load, for the same reason `startSession` is.
   */
  startChat(session: string, wanted: ChatRequest): Promise<string>;
  /**
   * This plugin's own connection to its host: one AHP client, in process.
   *
   * A plugin that has to act rather than contribute - start a session, send a
   * turn, answer what a session asks, read what a client does - is a client of
   * this host, and this is its socket. What comes back is the raw peer:
   * `request`, `notify` and `onMessage`, with AHP written in the protocol's own
   * types. There is no typed client here and a plugin that wants one builds it
   * on this.
   *
   * One connection per call, and it is the plugin's to close. Every one still
   * open when the daemon raises `stopping` is closed for it.
   *
   * Available from `listening` on, which is once a host has been built over
   * this plugin. A plugin that asks while `apply` runs is told rather than
   * dropped, because there is nothing yet to accept the connection - the same
   * answer `startSession` gives for the same reason.
   */
  connect(): PluginPeer;
  /** Add one backend to `HostOptions.agents`. */
  registerAgent(agent: Agent): void;
  /** Add one tool to `HostOptions.tools`. */
  registerTool(tool: HostTool): void;
  /**
   * Contribute a setting a client draws on a session, beside the backend's own.
   *
   * The key appears in the session schema only while this plugin is loaded,
   * which is what "if plugin is loaded" means, and its value reaches the
   * backend in `Start.settings`. A key the backend's own schema already
   * declares is a collision and is reported rather than merged, the way a
   * duplicate scheme is.
   *
   * The schema is one property of a JSON Schema object: `type`, `title`,
   * `description`, `default` and whatever a client draws from.
   */
  registerSessionConfig(
    key: string,
    schema: Record<string, unknown>,
    completions?: SessionConfigAnswerer,
  ): void;
  /** Set `HostOptions.resources`, or take the daemon's over with `'replace'`. */
  registerResources(store: PortOf<'resources'>, when?: 'replace'): void;
  /**
   * Serve one URI scheme this host owns, beside the `file:` store.
   *
   * The scheme is the plugin's to name and is kept as given: `computer` here
   * is `computer:` in a URI. `file` and anything on `ahp-` are refused,
   * because those are the host's own, and two plugins cannot serve one scheme.
   * What a provider may leave out, and what a client hears for it, is
   * `ResourceProvider`'s business.
   */
  registerResourceProvider(scheme: string, provider: ResourceProvider): void;
  /**
   * Serve every URI on one `x-` scheme as a channel a client subscribes to.
   *
   * The scheme is kept without `:`, so `x-ahpd-bots` serves
   * `x-ahpd-bots://`. A scheme without `x-`, or one another plugin took, is
   * refused. The handle is how the plugin sends on it.
   */
  registerChannel(scheme: string, channel: PluginChannel): ChannelHandle;
  /**
   * Serve one command a client sends by name.
   *
   * The name starts with `x-`, such as `x-demo/echo`. A name without it, or
   * one the daemon or another plugin serves, is refused.
   */
  registerMethod(name: string, method: PluginMethod): void;
  /**
   * Give text to each chat a person or a tool opens.
   *
   * The host asks every preamble before it opens the chat, and puts the
   * answers, joined with a blank line in plugin order, in the hidden `context`
   * of the chat's first turn. A worker chat and a changeset chat are not asked.
   */
  registerChatPreamble(preamble: ChatPreamble): void;
  /**
   * Draw the session's Plan call from this plugin.
   *
   * A turn holds one Plan call, so one plugin draws it: a second registration
   * is a collision the fold reports, and the first keeps the call. The host
   * reads the lines each time `planChanged` names the session, and draws them
   * in place of the backend's own list - a backend that is told `Start.plan`
   * keeps its own list to itself. A read still running when the turn ends holds
   * that ending back until the row is drawn, or for two seconds.
   */
  registerPlan(read: PlanReader): void;
  /**
   * The plugin's lines for a session moved.
   *
   * The host reads them again and redraws the Plan call of any turn open in the
   * session's chats. The promise settles once the rows are drawn, so a plugin
   * whose write must reach the session before the turn ends can wait on it.
   * Refused until a host is built over the plugin, because there is nothing to
   * redraw before then.
   */
  planChanged(uri: string): Promise<void>;
  /**
   * Add one key to the `_meta` of every session.
   *
   * The reader is asked each time the host composes a session's `_meta`, so it
   * answers with the value the session has now or with `undefined` while it has
   * none. A key is registered once by one plugin: a second registration of the
   * same key is a collision the fold reports. `sessionMetaChanged` says a
   * value moved.
   */
  registerSessionMeta(key: string, read: SessionMetaReader): void;
  /**
   * Answer the connectors a session may use, by alias.
   *
   * The reader is asked each time the host builds a session's tool list and
   * each time a tool runs, so a binding a plugin changes reaches a session it
   * already started. It is synchronous, for the same reason
   * `registerSessionMeta`'s is: `forSession` is. A plugin registers one
   * reader, and a second registration is refused.
   */
  registerBindings(read: BindingsReader): void;
  /**
   * The plugin's value for a session moved.
   *
   * The host composes the session's `_meta` again, with every producer's part,
   * and sends it as `session/metaChanged`. Refused until a host is built over
   * the plugin, because there is nothing to send before then.
   */
  sessionMetaChanged(uri: string): void;
  /**
   * Show a canvas on a live chat, and answer the channel it is served on.
   *
   * `state` is the whole `CanvasState`, with this plugin's own `instanceId` and
   * `extensionId`. Its `url` is an absolute http(s) URL that the plugin itself
   * answers, and the host never writes it to a log. A canvas already open on
   * the chat under the same `instanceId` is drawn again and keeps its channel,
   * and one this plugin opened is its own to change or close.
   *
   * Refused until a host is built over the plugin, and while this host has
   * canvases turned off, which is `canvasesEnabled`'s default.
   */
  openCanvas(chat: string, state: CanvasState): string;
  /**
   * Replace the state of a canvas this plugin opened, whole.
   *
   * A canvas another plugin opened is refused, and a resource that is gone
   * does nothing: a call that raced a close has nothing left to draw.
   */
  updateCanvas(resource: string, state: CanvasState): void;
  /**
   * Take a canvas off its chat.
   *
   * Only the plugin that opened it may close it, and a resource that is
   * already gone does nothing, so two closes may meet without either failing.
   * The host closes what a plugin still has open when it unloads that plugin.
   */
  closeCanvas(resource: string): void;
  /** Set `HostOptions.terminals`, or take the daemon's over with `'replace'`. */
  registerTerminals(store: PortOf<'terminals'>, when?: 'replace'): void;
  /** Set `HostOptions.changes`, or take the daemon's over with `'replace'`. */
  registerChanges(source: PortOf<'changes'>, when?: 'replace'): void;
  /** Set `HostOptions.directories`, or take the daemon's over with `'replace'`. */
  registerDirectories(facts: PortOf<'directories'>, when?: 'replace'): void;
  /** Set `HostOptions.worktrees`, or take the daemon's over with `'replace'`. */
  registerWorktrees(worktrees: PortOf<'worktrees'>, when?: 'replace'): void;
  /** Set `HostOptions.github`, or take the daemon's over with `'replace'`. */
  registerGithub(pullRequests: PortOf<'github'>, when?: 'replace'): void;
  /** Set `HostOptions.automations`, or take the daemon's over with `'replace'`. */
  registerAutomations(store: PortOf<'automations'>, when?: 'replace'): void;
  /** Set `HostOptions.sessions`, or take the daemon's over with `'replace'`. */
  registerSessions(store: PortOf<'sessions'>, when?: 'replace'): void;
  /** Set `HostOptions.diagnostics`, or take the daemon's over with `'replace'`. */
  registerDiagnostics(diagnostics: PortOf<'diagnostics'>, when?: 'replace'): void;
  /**
   * Set `HostOptions.computers`, or take the daemon's over with `'replace'`.
   *
   * The port a backend asks how to run its process in a named machine. One per
   * host, because a host serves one `computer:` provider.
   */
  registerComputers(computers: PortOf<'computers'>, when?: 'replace'): void;
  /**
   * Set `HostOptions.containers`, or take the daemon's over with `'replace'`.
   *
   * One host carries one container launcher: what a client asks for is a
   * folder, and a second launcher would be two answers to the same question.
   */
  registerContainers(containers: PortOf<'containers'>, when?: 'replace'): void;
  /**
   * Set `HostOptions.usage`, or take the daemon's over with `'replace'`.
   *
   * The store the meters write to and a policy reads. A store that is not this
   * machine's file is the expected replacement - sqlite, then a postgres several
   * daemons share - so the port, and not the folder, is what a plugin takes.
   */
  registerUsage(usage: PortOf<'usage'>, when?: 'replace'): void;
  /**
   * Set `HostOptions.policies`, or take the daemon's over with `'replace'`.
   *
   * The store a client writes policies through and a check reads, so a host
   * that keeps them in a database takes this port rather than the file - the
   * same shape `registerUsage` is offered.
   */
  registerPolicies(policies: PortOf<'policies'>, when?: 'replace'): void;
  /**
   * Set `HostOptions.vault`, or take the daemon's over with `'replace'`.
   *
   * The store a plugin option's `{ "$secret": "<name>" }` is read through, and
   * what a secret manager or a database several daemons share takes over, whose own
   * vault is a plain file beside the configuration.
   */
  registerVault(vault: PortOf<'vault'>, when?: 'replace'): void;
  /**
   * Set `HostOptions.records`, or take the daemon's over with `'replace'`.
   *
   * The store every plugin's collections are in, so a plugin over sqlite or a
   * database several daemons share moves every plugin's records with one call.
   */
  registerRecords(store: PortOf<'records'>, when?: 'replace'): void;
  /**
   * Set `HostOptions.commandParser`, or take the daemon's over with `'replace'`.
   *
   * The reader `getAutoApproval` uses to split a command line before the
   * terminal rules match it. A host with no plugin and no configuration entry
   * reads with the sdk's own splitter, so a plugin that registers one is
   * saying it reads a command line better. The value is one function, `(line,
   * shell) => CommandSplit | undefined`; `undefined` says the line could not
   * be read, and the call asks.
   */
  registerCommandParser(split: PortOf<'commandParser'>, when?: 'replace'): void;
  /**
   * Serve one HTTP route, on this host's own listener, under this plugin's name.
   *
   * A webhook, a platform callback or a facade a client reaches: `/plugins/<name>/`
   * and whatever path is below it reaches `handler` as a `Request`, and its
   * `Response` goes back as it is. On the host's own port rather than one of its
   * own, so a tunnel forwards it like everything else here and no second port is
   * opened for it.
   *
   * One per plugin. The prefix is the plugin's name, so a route cannot answer at
   * another's path, and a second one would be two handlers with one answer.
   *
   * There is no credential in front of this. The request's `Host` is checked
   * against the names this host answers to, and the route authenticates its own
   * caller - a signature, a token in the path or a header it checks itself. What
   * it does on the host goes through its plugin's connection, so the grants its
   * operator wrote for it are the gate; see plan
   * `plugin/20-a-plugin-is-a-client-of-its-own-host`.
   */
  registerRoute(handler: Route): void;
  /**
   * Register what this plugin runs when the host closes.
   *
   * The host calls every registered function once its sessions have closed and
   * before its stores do, so a plugin stops the work it owns: a timer it armed,
   * a removal it started, a process it spawned. Nothing else knows about that
   * work, so a plugin that leaves it running leaves it running for the rest of
   * the process's life.
   *
   * Called more than once, each function is kept and each runs, in the order
   * they were registered. A failure is logged against this plugin and does not
   * stop the next plugin's. A plugin that registered none is not asked for one:
   * having nothing to stop is the ordinary case.
   */
  registerClose(close: () => void | Promise<void>): void;
  /**
   * Offer one kind of trigger, for an automation to wake on.
   *
   * The type is the name a saved trigger carries, so it is the key everything
   * else is looked up by: this host will fire it, a client will offer it, and an
   * automation that names it will run when it does. `session` and `watch` are
   * the host's own and are refused, as is a name this plugin has already used.
   *
   * A type is registered once and not patched: an edit is a removal and a
   * re-registration, which is what this host does not have.
   */
  registerTriggerType(definition: TriggerTypeDefinition): void;
  /**
   * Say that one of this type's events has happened.
   *
   * Every enabled automation whose trigger names this type and this event
   * starts a run, which is what makes a plugin's own knowledge - a webhook that
   * arrived, a machine that went away - something an automation can wake on.
   * `data` is the plugin's own account of it: it is recorded on the run's origin
   * and read by nobody else here, so it must carry nothing secret.
   *
   * `owner` is the owner of the connector the event came from, where it came
   * from one. A fire that names it wakes only an automation that may read that
   * connector; a fire that leaves it out is the host's own event and wakes
   * every watcher the host lets past its other gates.
   *
   * Nothing is awaited. A run starts asynchronously and the plugin is not told
   * whether one did, because an event has no answer - what a client watching an
   * automation reads is the run it started.
   */
  fireTrigger(type: string, event: string, data: Record<string, unknown>, owner?: ConnectorOwner): void;
  /**
   * Start one automation, by its id, with the plugin's own data on its origin.
   *
   * The id is an automation's own id or its whole `ahp-automation:/` URI. A
   * fire reaches every automation watching a type; this is for a plugin that
   * knows which one it means - a webhook connector naming the automation it
   * starts. `owner` is the connector's, and an automation that is off, gone or
   * not readable by that owner is not run: the host says so in its log rather
   * than answering, for the same reason a fire is not answered.
   */
  runAutomation(id: string, data: Record<string, unknown>, owner?: ConnectorOwner): void;
  /**
   * Offer one adapter a person can make connectors from.
   *
   * The name is a slug and is what a stored connector carries, so an adapter
   * is registered once: a name this plugin already used is refused here, and
   * one another plugin took is reported by the fold. The schema is the form a
   * client draws, and `open` runs each time a connector of the adapter is made
   * or the daemon starts with one stored.
   */
  registerAdapter(adapter: Adapter): void;
  /**
   * Offer one engine a person can make agents from.
   *
   * The name is a slug and is what a stored record carries, so an engine is
   * registered once: a name this plugin already used is refused here, and one
   * another plugin took is reported by the fold. The schema is the form a
   * client draws for a record's own fields, and `open` builds a backend each
   * time a record of the engine is made or the daemon starts with one stored.
   */
  registerEngine(engine: Engine): void;
  /**
   * Subscribe to one of the host's own moments.
   *
   * The one method not named `register*`, because it contributes nothing to
   * `HostOptions`: it attaches a listener to something the host already does.
   * The handler's return value is ignored and it cannot refuse or rewrite what
   * it observes, and it is awaited before the next listener runs.
   */
  on<K extends EventName>(event: K, handler: EventHandler<K>): void;
}

/** One place a person can read more about a plugin. */
export interface PluginLink {
  /** What a client prints for the link. */
  title: string;
  /** Where the link goes. */
  url: string;
}

/**
 * The registrations a plugin declares, by kind.
 *
 * A key is the plural of the register method of that kind - `agents`, `tools`,
 * `channels`, `methods`, `routes`, `triggerTypes`, `adapters`, `engines` -
 * and its entries are the names the method may be called with. `ports` holds
 * the singleton ports a plugin sets, such as `vault`. A registration its
 * contracts do not list is refused.
 */
export type PluginContracts = Record<string, string[]>;

/**
 * What a plugin says about itself before a person uses it.
 *
 * The fields a client draws: a description, the categories it files the plugin
 * under, the links a person can follow, the contracts that say what the plugin
 * registers, and the icons drawn beside its name. An npm plugin writes them in
 * the `ahpd` field of its package.json, where its `name` and `version` are the
 * package's own; a standalone plugin writes them in a `plugin.json` or in its
 * configuration entry, with `id`, `name` and `version` beside them.
 */
export interface PluginManifest {
  /**
   * The plugin's id, which a standalone plugin declares.
   *
   * A package's id is its `name`, so a package.json carries none. A standalone
   * plugin's id is this, and a module whose `name` export differs is refused.
   */
  id?: string;
  /**
   * What a listing prints instead of the id, when a standalone plugin says so.
   *
   * A package.json spells the same display name as `ahpd.title`.
   */
  name?: string;
  /** The plugin's version, which a package.json carries at its top level. */
  version?: string;
  /** One sentence on what the plugin does. */
  description?: string;
  /** The groups a client files the plugin under. */
  categories?: string[];
  /** Where a person reads more about it. */
  links?: PluginLink[];
  /** The names each kind of registration may use. */
  contracts?: PluginContracts;
  /**
   * What a client draws beside the plugin's name.
   *
   * An `src` that is a path is relative to the plugin's package, and the host
   * reads the file and sends it as a `data:` URI, at most 32 KB. An `https:`
   * URL or a `data:` URI is sent as it is.
   */
  icons?: Icon[];
  /**
   * A JSON Schema for the options `apply` receives.
   *
   * An object schema whose `properties` are the option keys, written in
   * `ahpd.optionsSchema` of a package.json or as `optionsSchema` in a
   * standalone manifest. The daemon reads it without importing the module, so
   * a plugin switched off still has a form a client draws, and it checks the
   * configured options, with `defaults` merged under them, before `apply`
   * runs: options that fail it are reported and the plugin is not applied, and
   * a key it does not name is reported and passed through. Absent, the options
   * reach `apply` unchecked.
   */
  optionsSchema?: Record<string, unknown>;
}

/**
 * One plugin module, as `apply` makes it.
 *
 * `name` is required because it is the identity every message and every
 * conflict names. `title` is the fallback a listing prints where the module
 * does not export one, and `defaults` are this plugin's own option defaults
 * rather than the host's.
 *
 * A default export is deliberately not consulted. A package that exports one
 * and no `apply` is a package that does not load, because which named export
 * is the plugin cannot be guessed at and a silent one is worse than a refusal.
 */
export interface Plugin {
  /**
   * The plugin's id, unique among the plugins a daemon loads: lowercase
   * letters, digits and dashes, one to forty of them, starting with a letter.
   * A module that exports no `name` takes the manifest's name, its file name
   * or its spec, with a scope joined by a dash: `@acme/y` is `acme-y`. The
   * daemon skips a plugin whose id is not a slug.
   */
  name: string;
  /** What a listing prints instead of the id. */
  title?: string;
  /** This plugin's own option defaults, under whatever the configuration said. */
  defaults?: Record<string, unknown>;
  /** Contribute to the host. Whatever it registers on `host` is folded in. */
  apply(host: PluginHost, options: Record<string, unknown>): void | Promise<void>;
}

/** One value a plugin set for a singleton port. */
export interface PortContribution {
  /** What the registration was given. Checked before it was recorded. */
  value: unknown;
  /** Whether the plugin asked to take an existing value over. */
  replace: boolean;
}

/** A chat that a person or a tool opened, as a chat preamble is told it. */
export interface OpenedChat {
  /** The session the chat is in. */
  session: string;
  /** The new chat. */
  chat: string;
  /** What the chat was made from, when it was made from another chat. */
  origin?: ChatOrigin;
  /** The session's other chats, as its catalogue lists them. */
  chats: readonly ChatSummary[];
}

/** Text for the hidden context of a chat's first turn, or `undefined` for none. */
export type ChatPreamble = (opened: OpenedChat) => Promise<string | undefined>;

/**
 * What one `apply` produced, kept apart from the host until every plugin has run.
 *
 * Contributions are collected rather than applied straight to the base so
 * every conflict can be reported at once, and so a plugin that throws loses
 * its whole contribution rather than the half it registered first.
 */
export interface Contribution {
  /** The `name` of the plugin that produced this. */
  by: string;
  /**
   * What configuration named the plugin by, a package or a path, when a loader
   * named it: the spec a nested host is asked to load for this plugin's agents.
   * Absent, the plugin's `name` stands for it.
   */
  spec?: string;
  /** The catalogs the plugin ships in `ahpd.i18n`, by locale, when it ships any. */
  i18n?: Catalogs;
  /** Backends to append, in registration order. */
  agents: Agent[];
  /** Tools to append, in registration order. */
  tools: HostTool[];
  /**
   * The session settings this plugin contributes, keyed by name.
   *
   * An open key rather than a written union, like `providers`, because the
   * name is the plugin's invention and the collision rule is the fold's.
   */
  sessionConfig: Record<string, Record<string, unknown>>;
  /** Who answers the picker for a contributed key, by key. */
  sessionCompletions: Record<string, SessionConfigAnswerer>;
  /** The singleton ports this plugin set, and whether each took one over. */
  ports: Partial<Record<PortKey, PortContribution>>;
  /**
   * The URI schemes this plugin serves, keyed by scheme.
   *
   * An open key rather than a `PortKey`, because the scheme is a name the
   * plugin invents and cannot be a written union. The operation is the
   * `register, open key` one the domain reference describes, which is why the
   * conflict rule is the fold's and not `setPort`'s.
   */
  providers: Record<string, unknown>;
  /**
   * The channels this plugin serves, keyed by scheme in lowercase.
   *
   * The entries are the objects the handles close over, so the fold carries
   * them into `HostOptions.channels` as they are.
   */
  channels: Record<string, ServedChannel>;
  /**
   * The adapters this plugin offers, keyed by name.
   *
   * Each entry carries the plugin that registered it, as a channel does, so
   * the fold can report a name two plugins both took without looking the
   * plugin up again.
   */
  adapters: Record<string, ServedAdapter>;
  /**
   * The engines this plugin offers, keyed by name.
   *
   * Each entry carries the plugin that registered it, as an adapter does, so
   * the fold can report a name two plugins both took. Absent when the plugin
   * registered none.
   */
  engines?: Record<string, ServedEngine>;
  /** The commands this plugin serves, keyed by name. */
  methods: Record<string, ServedMethod>;
  /**
   * The listeners this plugin attached, by event.
   *
   * Empty when it subscribed to nothing, so the fold can add it without a
   * case, and never merged with another plugin's except in configuration
   * order.
   */
  events: HostHandlers;
  /**
   * What this plugin asked to run when the host closes, in registration order.
   *
   * Empty when it registered none, so the fold can carry it into
   * `HostOptions.closers` without a case.
   */
  closers: (() => void | Promise<void>)[];
  /**
   * The trigger types this plugin registered, and where its fires go.
   *
   * Here as `pluginHost` built it, always, empty when the plugin offered no
   * type, so the fold can read it without a case - and the fold replaces it
   * with its own entry for the types this plugin kept, which is what a fire
   * reads. A plugin that wrote to the object it registered in therefore changes
   * nothing the host holds.
   */
  triggers: PluginTriggers;
  /**
   * Where this plugin's `startSession` goes.
   *
   * Carried through rather than copied, so the object `pluginHost` built is the
   * one the host fills in. Always here, whether or not the plugin ever asks for
   * a session, so the fold can read it without a case.
   */
  starts: PluginStarts;
  /**
   * Where this plugin's connections to the host come from.
   *
   * Carried through rather than copied, exactly as `starts` is, so the object
   * `pluginHost` built is the one the daemon fills in. Always here, whether or
   * not the plugin ever connects, so the fold can read it without a case.
   */
  connects: PluginConnects;
  /**
   * Where this plugin's canvases go.
   *
   * Carried through rather than copied, exactly as `starts` is, so the object
   * `pluginHost` built is the one the host fills in. Always here, whether or
   * not the plugin ever opens a canvas, so the fold can read it without a case.
   */
  canvases: ServedCanvases;
  /**
   * The one route this plugin registered, when it registered one.
   *
   * Absent rather than a handler that answers nothing, because "no route" and
   * "a route that answers 404" are different things: the first is a plugin that
   * serves nothing, and the second is one that would answer a path wrongly. The
   * key in the fold is the plugin's own name, which is the prefix it is served
   * under, so a route and the path that reaches it cannot drift apart.
   */
  routes?: Route;
  /** The chat preambles this plugin registered, in registration order. */
  preambles: ChatPreamble[];
  /**
   * The Plan call this plugin draws, when it draws one.
   *
   * Carried through rather than copied, so the object `pluginHost` built is the
   * one the host fills in. Absent, the backend draws its own call.
   */
  plan?: ServedPlan;
  /**
   * The keys this plugin adds to a session's `_meta`, when it adds any.
   *
   * Carried through rather than copied, for the same reason `plan` is: the
   * object `pluginHost` built is the one the host fills in.
   */
  sessionMeta?: ServedSessionMeta;
  /**
   * The connectors this plugin says a session may use, when it says any.
   *
   * Carried through rather than copied, for the same reason `plan` is: the
   * object `pluginHost` built is the one the fold keeps, and the host reads it
   * on every tool list and every call.
   */
  bindings?: ServedBindings;
}

/** One plugin that was resolved and imported, before or after it was applied. */
export interface Loaded {
  /** What was named in configuration or on the command line. */
  spec: PluginSpec;
  /** The URL `import()` was given. */
  url: string;
  /** The absolute path that URL names, for the log. */
  path: string;
  /** The id the module and the manifest agreed on; the module wins. */
  name: string;
  /** What a listing prints, from the module or its manifest. */
  title?: string;
  /** What the plugin declares about itself, from its package.json or its module. */
  manifest?: PluginManifest;
  /** The catalogs `ahpd.i18n` names, by locale. */
  i18n?: Catalogs;
  /** The options `apply` is given. */
  options: Record<string, unknown>;
  /** The module's plugin object. */
  plugin: Plugin;
}
