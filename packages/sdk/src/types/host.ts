/** The protocol server: channels, subscriptions and requests. */

import type { ToolDefinition } from '@microsoft/agent-host-protocol';
import type { Agent, McpServer, ToolEffects } from './agent.js';
import type { ToolsServers } from '../tools/server.js';
import type { HostHandlers } from './events.js';
import type { ResourceProvider, ResourceStore } from './resources.js';
import type { Grant, Principal, Users } from './users.js';
import type { TerminalStore } from './terminals.js';
import type { ChangesetSource } from './changes.js';
import type { Worktrees } from './worktrees.js';
import type { PullRequests } from './github.js';
import type { AutomationStore } from './automations.js';
import type { EnablementStore } from '../plugins/enablement.js';
import type { ChatPreamble, PluginConnects, PluginStarts, PluginTriggers, ServedBindings, ServedCanvases, ServedChannel, ServedMethod, ServedPlan, ServedSessionMeta } from './plugin.js';
import type { ConnectorRef, ServedAdapter } from './connectors.js';
import type { AgentOwner, ServedEngine } from './agents.js';
import type { ConnectorsChannel } from '../connectors/channel.js';
import type { SessionStore } from './sessions.js';
import type { ComputerPort, HandedAgent, NestedStart, NestedStarted } from './computers.js';
import type { ContainerPort } from './containers.js';
import type { ClientPlugins } from './clientplugins.js';
import type { Usage } from './usage.js';
import type { MinuteMeter } from '../usage/minute.js';
import type { Policies } from './policies.js';
import type { PayOrder } from '../usage/charge.js';
import type { RecordStore } from './records.js';
import type { Vault } from './vault.js';
import type { Peer, Request } from './rpc.js';
import type { Summary } from './catalog.js';
import type { Bag } from './common.js';
import type { SessionConfigAnswerer } from './completions.js';
import type { ShellEnv } from '../machines/shellenv.js';
import type { CommandSplitter } from '../access/commandautoapprover.js';
import type { Catalogs } from '../i18n.js';

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

/** A host that joined this one, as the registry of joins holds it. */
export interface JoinedNode {
  /** The node's name, as `ahpd node add` minted its token. */
  id: string;
  /**
   * The folder the node said its sessions start in.
   *
   * A path on the node, which is not a path here: it is handed over as the
   * folder the host inside works in, so this host's own folder never reaches it.
   */
  workdir: string;
}

/** A node that dialled this host, or one that stopped being connected. */
export type NodeChange =
  | { id: string; joined: true; workdir: string }
  | { id: string; joined: false };

/**
 * The hosts that joined this one, and how a session reaches one.
 *
 * Read-only for a plugin: adding, verifying and removing a node is the node
 * commands' work, since a token is shown once and a node's name is not a
 * plugin's to choose. What a plugin does here is list the nodes as machines
 * and start a session in one.
 */
export interface NodeRegistry {
  /** The nodes connected now, in the order they dialled. */
  joined(): JoinedNode[];
  /**
   * The socket a session in a named node runs on, or `undefined` for an id
   * this registry does not serve.
   *
   * An id it does serve that has not dialled is a session that cannot start,
   * so the answer is a refusal rather than `undefined`.
   */
  connect(id: string, asked: NestedStart): Promise<NestedStarted | undefined>;
  /** Called on each join and each departure, until the handle is closed. */
  watch(onChange: (change: NodeChange) => void): { close(): void };
}

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
   * What this host is called, for the work nobody started as themselves.
   *
   * A root connection is the host rather than a person, and the owner such a
   * session records is `root:<hostName>` - which is only a name a reader can
   * act on if the host part is one somebody knows this box by. The daemon
   * passes the machine's hostname; left out, the owner reads `root:host`.
   */
  hostName?: string;
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
   * The spec of the plugin that registered each agent, by provider.
   *
   * What a host inside a machine is asked to load for a session of that agent
   * that runs nested. `foldHostOptions`
   * writes it; an agent handed over directly, not through a plugin, has no
   * entry, and a session of it cannot run nested.
   */
  agentPlugins?: Record<string, string>;
  /**
   * The plugin and the record of an agent made from a record, by provider.
   *
   * What a host inside a machine is started with for a session of that agent
   * that runs nested, since no plugin registered the agent itself. Read at each
   * start, so the record is the one the host serves then. Answers nothing for
   * an id no record holds.
   */
  handedAgent?(provider: string): Promise<HandedAgent | undefined>;
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
   * The channels plugins serve, by `x-` scheme in lowercase.
   *
   * The fold fills this from `registerChannel`. A subscribe to a URI on one of
   * these schemes is answered by its channel, and the host sets each entry's
   * `publish` and `subscribers` when it is created.
   */
  channels?: Record<string, ServedChannel>;
  /**
   * The adapters the plugins offer, by name.
   *
   * The fold fills this from `registerAdapter`, and one name is one adapter: a
   * second plugin registering it is reported and loses that adapter alone. A
   * client draws a form from each adapter's `schema`, and a connector whose
   * adapter is not here cannot be opened.
   */
  adapters?: Record<string, ServedAdapter>;
  /**
   * The engines the plugins offer, by name.
   *
   * The fold fills this from `registerEngine`, and one name is one engine: a
   * second plugin registering it is reported and loses that engine alone. A
   * stored record whose `engine` is not here is served as `unavailable`.
   */
  engines?: Record<string, ServedEngine>;
  /**
   * Whose each agent is, by its id, as the last read of its record found it.
   *
   * An id with no entry is not a record: the daemon's own agent, or one a
   * plugin registered, and so a host agent. Read through a function because
   * the records are listed while the host runs, and through the daemon's
   * channel because it is the one that reads them.
   *
   * A caller is told only the agents it may use, decided from this - a host
   * agent takes `session:write`, a team's agent a membership of that team, and
   * a person's agent that person. Left out, every agent is the daemon's own.
   */
  agentOwners?: () => ReadonlyMap<string, AgentOwner | undefined>;
  /**
   * The connectors this host serves, as a session's bindings are checked.
   *
   * `refs` answers every stored connector's id, adapter and owner as of the
   * last read of the store - the same listing an automation's save is checked
   * against. A start whose `connectors` key names one that is not there, or
   * one its owner may not read, is refused.
   *
   * `run` is what an action tool calls, under the live checks the channel
   * makes: the connector is open, the action is one its adapter declares, and
   * the session's owner may read it.
   *
   * Left out, this host serves no connector: a start is checked against none
   * and no action tool is built, which is the answer for an embedder with no
   * connectors store.
   */
  connectors?: {
    /** Every stored connector, as a binding is checked against it. */
    refs: () => readonly ConnectorRef[];
    /** Run one action on one open connector for one reader. */
    run: ConnectorsChannel['run'];
  };
  /**
   * The plugin that draws a session's Plan call, if one does.
   *
   * The fold fills this from `registerPlan`, and one plugin holds it: a turn
   * shows one Plan call. The host sets `changed` on it when it is created, and
   * without one each backend draws the call from its own list.
   */
  plan?: ServedPlan;
  /**
   * The keys plugins add to a session's `_meta`, one entry per plugin.
   *
   * The fold fills this from `registerSessionMeta`, and `metaOf` composes every
   * key into the map a snapshot and `session/metaChanged` carry. The host sets
   * each entry's `changed` when it is created.
   */
  sessionMeta?: ServedSessionMeta[];
  /**
   * The bindings plugins answer for a session, one entry per plugin.
   *
   * The fold fills this from `registerBindings`, and the host asks each reader
   * when it builds a session's tool list and when it runs a call. The session's
   * own `connectors` key goes over them, so a key the session was started with
   * wins a shared alias.
   */
  bindings?: ServedBindings[];
  /**
   * The `x-` commands the daemon and plugins serve, by name.
   *
   * The daemon passes its own here, and the fold adds each plugin's from
   * `registerMethod`. A request no protocol handler holds is answered by the
   * one its name keys, after the gate asks for its grant.
   */
  methods?: Record<string, ServedMethod>;
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
   * An absolute folder every session tree goes under.
   *
   * With one, a session's worktree is `<root>/<repo>/<name>` rather than
   * `<repo>.worktrees/<name>` beside its repository. It is what a machine with many
   * repositories under one folder wants, and it is this host's own departure
   * from the reference, which fixes the location and offers no setting.
   *
   * Meaningless without `worktrees`: with no port there is no tree at all.
   */
  worktreesRoot?: string;
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
   * Whether a customization is on, for every session or for one folder.
   *
   * Left out, only the session's own decision is kept, so a plugin a client
   * switches off for all sessions or in one folder comes back on at the next
   * session there - which is what every host had before this option and is
   * still the right answer for one embedded in a single session.
   * `memoryEnablement()` is the one that ships with this package: it holds the
   * decisions for the life of the process, and the daemon keeps the same
   * store over a file.
   */
  enablement?: EnablementStore;
  /**
   * What an automation that names no owner sees, `every` by default.
   *
   * An automation nobody made is nobody's work, so nothing there is a person's
   * to keep from it - which is every automation on a host with no people
   * directory, and the case this host was asked to be useful in. A deployment
   * that would rather they woke on nothing at all says `none`.
   */
  unownedAutomations?: 'every' | 'none';
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
   * How a backend runs its process inside a named machine.
   *
   * Contributed by the plugin that owns the `computer:` scheme and handed to
   * every backend through `Start`, so a backend reaches a machine without
   * depending on the package that made it.
   */
  computers?: ComputerPort;
  /**
   * The hosts that joined this one, and the socket a session in one runs on.
   *
   * Taken from the registry the daemon keeps, so a plugin lists the nodes as
   * machines without knowing which hub it is on. Left out, this host is one no
   * node joined, and no plugin can offer one.
   */
  nodes?: NodeRegistry;
  /**
   * What a session does when the node it runs on restarts its `ahpd join`.
   *
   * `end`, the default, ends the session where it ran, with a sentence naming
   * the node, and the next turn resumes it by the inner host's id. `reconnect`
   * keeps the session and opens it again on the socket the node dials when it
   * comes back.
   */
  nodeRestart?: 'end' | 'reconnect';
  /**
   * How this host runs another host inside a container, and carries its frames.
   *
   * Contributed by the plugin that can reach Docker and the Dev Container CLI.
   * Present, this host serves `vscode/devContainers/*` and advertises
   * `_meta['vscode.devContainers']`, so a client offers its dev container flow
   * only where one can actually be made.
   */
  containers?: ContainerPort;
  /**
   * Where this host keeps what its work cost, and what a pool has been charged.
   *
   * Left out, nothing is kept and no total can be read. `fileUsage()` ships
   * with this package and the daemon uses it.
   */
  usage?: Usage;
  /**
   * What each key used in this minute, which a `minute` limit reads.
   *
   * The same meter the usage store is given, made by the daemon, so the figures
   * a turn is checked against are the ones its records fill. Absent, a `minute`
   * limit reads zero and no turn is counted. It says nothing without a `usage`
   * port.
   */
  meter?: MinuteMeter;
  /**
   * Whether a turn leaves one record, or each of its reports leaves one.
   *
   * `turn`, the default, holds each running turn's last report and writes it
   * when the turn ends; `report` writes what each report added as it arrives, so
   * a turn that is still running is already billed for what it has spent - the
   * mode chose between.
   * It says nothing without a `usage` port.
   */
  usagePer?: 'turn' | 'report';
  /**
   * The zone a day, a week and a month start in, as `Intl` names one.
   *
   * It is the zone the usage store cuts its days in, so the charge walk reads
   * its periods over the same days the store keeps. Absent is the system's own.
   */
  usageTimezone?: string;
  /**
   * Where this host keeps the policies that say who may use what.
   *
   * Left out, there is nothing to check and nothing a client may write.
   * `filePolicies()` ships with this package and the daemon uses it.
   */
  policies?: Policies;
  /**
   * Where this host keeps the secrets its work needs, by scoped name.
   *
   * Left out, a plugin that reads a secret is told the host has no vault rather
   * than handed nothing, whose own vault is
   * one plain JSON file in the configuration directory.
   */
  vault?: Vault;
  /**
   * Where each plugin keeps its own records, as named collections.
   *
   * Left out, a plugin that opens a collection is told the host has no record
   * store on its first call. `memoryRecords()` ships with this package.
   */
  records?: RecordStore;
  /**
   * Whether what the policies say is enforced.
   *
   * Off whatever the port holds, so a host that is handed a store still behaves
   * as it did before policies existed until somebody says otherwise. It says nothing without
   * a `policies` port, and it is never about a root connection, an automation or
   * a host with no users directory: those have no person to check.
   */
  policiesCheck?: boolean;
  /**
   * Which row of one scope pays first when several can, while the check runs.
   *
   * `ending` uses the row that ends soonest first, `regular` the rows with no
   * `until`, and `extra` the rows with one, the newest `from` first. Defaults
   * to `ending`.
   */
  policiesPayOrder?: PayOrder;
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
   * Whether the session tools are offered at all.
   *
   * `true`, the default, offers them; `false` offers none. The session tools
   * are the nine `sessionTools()` contributes - the ones that read and move the
   * sessions running beside this one - and nothing else the host contributes is
   * affected: the artifact tools, `ahp_resource`, `ahp_terminals` and
   * `schedule_wakeup` are offered whatever this says.
   *
   * A tool left out is absent from `SessionState.serverTools` and is not bound
   * for a call, so a model is never offered it rather than being refused at
   * call time - the same shape as `advancedTools`. A daemon's `sessionTools`
   * key is this option, and it takes hold while the daemon runs.
   */
  sessionTools?: boolean;
  /**
   * The providers whose sessions are offered the session tools.
   *
   * Empty, the default, is every provider; a list of provider ids is those
   * providers' sessions alone. It narrows `sessionTools` rather than replacing
   * it, so with `sessionTools` false no session is offered them whatever this
   * names - and a session whose provider is not known here, a row this host is
   * only browsing, is one a list does not name.
   *
   * A daemon's `sessionToolsProviders` key is this option, and it takes hold
   * while the daemon runs.
   */
  sessionToolsProviders?: string[];
  /**
   * The MCP servers every session is offered, by the name a person gave them.
   *
   * The host's own, from whatever configures it: a daemon reads the
   * `mcpServers` key of its `config.json`, which is VS Code's shape and its
   * setting. Each session is handed these merged with the servers its own
   * enabled client plugins contribute, a client plugin winning a name clash.
   *
   * Left out, no session is offered one, and a backend that speaks ACP opens
   * with an empty list rather than a list nobody configured.
   */
  mcpServers?: Record<string, McpServer>;
  /**
   * Where a client's plugins are copied to, so a backend here can open them.
   *
   * A client announces the plugins it contributes to a session as URIs it
   * serves - `virtual://…`, an editor's unsaved buffers, a filesystem provider
   * - and the backend that has to run them is a process on this machine, which
   * can open a directory here and no URI there. `clientPluginsIn(dir, clients)`
   * is the port that copies them and answers where each landed.
   *
   * Left out, no plugin a client announces is copied, and each is reported to
   * its session as the error that it could not be: a host with nowhere to put
   * one says so rather than quietly offering the session nothing.
   */
  clientPlugins?: ClientPlugins;
  /**
   * Where the host serves its own tools as an MCP server, when something is
   * there to serve them on.
   *
   * A `ToolsServers`, which is the registry a session's endpoint is opened in
   * and the request handler a listener mounts to answer it - the same object
   * on both sides, so what a backend is handed is what the listener serves.
   *
   * Left out, no session is offered a tools server: a host embedded somewhere
   * with a listener of its own builds one and mounts it, and a host with no
   * listener cannot.
   */
  toolsServers?: ToolsServers;
  /**
   * Session settings a plugin contributed, merged into every session's schema.
   *
   * The fold fills this from `registerSessionConfig`, so a client draws the
   * key and a backend receives its value in `Start.settings`. A host that
   * sets this itself is contributing settings without a plugin, which is what
   * an embedder with its own control wants.
   */
  sessionConfig?: Record<string, Record<string, unknown>>;
  /**
   * Who answers `sessionConfigCompletions` for a contributed key.
   *
   * A key with no answerer is a fact a client fills in by hand, which is how
   * a property with no `enum` reads. A key with one is a question: the host
   * marks its property `enumDynamic` on the way out and routes the command to
   * whoever registered it, so a picker appears in every client rather than in
   * the one that wrote code for that key by name.
   *
   * The fold fills this from `registerSessionConfig`'s third argument, and a
   * host may set it directly for a control of its own.
   */
  sessionConfigCompletions?: Record<string, SessionConfigAnswerer>;
  /**
   * The catalogs a plugin ships, by what it put on the form.
   *
   * The fold fills this from each plugin's `ahpd.i18n`, so a key's text is
   * looked up in the catalogs of the plugin that declared it before the
   * host's own.
   */
  catalogs?: {
    /** By session setting, the catalogs of the plugin that registered the key. */
    sessionConfig?: Record<string, Catalogs>;
    /** By provider, the catalogs of the plugin that registered the agent. */
    agents?: Record<string, Catalogs>;
  };
  /**
   * Whether the tools that declare they need advanced permission are offered.
   *
   * False, so a tool that marks itself `advancedPermission` is absent from
   * every session until the host says otherwise: it is not reported in
   * `serverTools` and it is not bound, so a model is never offered it. A tool
   * that declares nothing is unaffected by this and by the flag.
   */
  advancedTools?: boolean;
  /**
   * What closing one chat of a session does to that chat's conversation.
   *
   * `hidden`, which is the default, leaves the conversation where the backend
   * keeps it and keeps the host's claim on its id, so it is never listed as a
   * session of its own - by this process or by the next, since the store's
   * record carries the claim. `delete` asks the backend to remove the
   * conversation instead, through the same `Agent.delete` a disposed session
   * goes through, and only a backend that has one can.
   */
  closedChats?: 'hidden' | 'delete';
  /**
   * What archiving a session does with a working tree that has changes
   * nobody committed.
   *
   * `keep`, which is the default, leaves the tree where it is. `commit`
   * commits every change on the session's branch, then removes the tree as
   * it would a clean one, keeping the branch so an unarchive can put the tree
   * back. A commit that fails keeps the tree.
   */
  archiveDirtyWorktree?: 'keep' | 'commit';
  /**
   * How the pass that archives and deletes merged sessions learns the state
   * of a pull request.
   *
   * `url`, which is the default, asks `PullRequests.byUrl` for each pull
   * request related to the session, and asks by branch when the port has no
   * `byUrl`. `branch` asks `PullRequests.forBranch` for the session's branch.
   */
  pullRequestLookup?: 'url' | 'branch';
  /**
   * How long a call a client runs may wait before the host calls it failed.
   *
   * A client's tool call blocks the turn that made it, and a client that has
   * gone quiet without going away would block it for ever, so there is a limit
   * and this is where a deployment sets it. Unset is ten minutes; zero is no
   * limit at all, for a deployment that would rather wait than cut a slow
   * client off. Handed to each backend on `Start`, because the backend is what
   * holds the call.
   */
  clientToolTimeoutMs?: number;
  /**
   * The environment the operator names for the shells this host starts.
   *
   * A daemon that runs with an environment of its own - a service unit with a
   * private `XDG_CONFIG_HOME` - has no other way to say which of it an agent's
   * shells should have, and the operator is the one who knows. Each name is
   * set to its value, and a name set to `null` is removed from what the daemon
   * itself runs with.
   *
   * Handed to each backend on `Start`, because only a backend knows what it
   * does with a shell, and given to the terminal store, so every terminal this
   * host opens starts from it. A client that needs a variable in one session
   * uses `shellInitScripts` instead, which is that session's own.
   */
  shellEnv?: ShellEnv;
  /**
   * The rules a session's shell commands are matched against when its owner's
   * window pushed none.
   *
   * `vscode`, the default, is VS Code's terminal auto-approve table, so a
   * session whose window has not pushed a table runs the commands the
   * reference client approves. `none` approves no command, for a deployment
   * that would rather ask about each one. A window that pushed an empty table
   * is not folded into this: it said what it approves, and it approves
   * nothing.
   */
  terminalAutoApproveDefaults?: 'vscode' | 'none';
  /**
   * How a session's shell commands are read before their rules are matched.
   *
   * The port the sdk's own splitter fills by default: `getAutoApproval` reads
   * every line with it, and a plugin takes it over with
   * `registerCommandParser`. A parser that throws, or answers something that is
   * not a `CommandSplit`, is read as a line that nobody could read, so the call
   * asks rather than being approved on a reading it did not give.
   */
  commandParser?: CommandSplitter;
  /**
   * How long a turn asked for a commit message or a pull request's words is
   * waited for, in milliseconds.
   *
   * With `changeWords` in `model` or `agent` mode, a commit and a pull request
   * ask for words the person gave none of, and a turn that never ends would
   * leave the operation waiting with it. Past this the turn is cancelled and
   * the words fall back to the session title, which is what a failure does.
   * Unset is two minutes; zero is no limit at all, for a deployment that would
   * rather wait than cut a model off.
   */
  changeWordsTimeoutMs?: number;
  /**
   * How long a streamed delta waits for the next one before it is sent, in
   * milliseconds.
   *
   * A turn sends one delta per token and every one of them is an envelope: a
   * sequence number, a broadcast and a copy kept for a client that comes
   * back. Within this window the deltas naming one part are merged into one
   * action, which is the same text in fewer envelopes. Unset is 75; zero
   * sends every delta as it arrives.
   */
  deltaWindowMs?: number;
  /**
   * How long a live session stays quiet before its agent is let go, in
   * minutes.
   *
   * A sleeping session keeps its row, its chats, its terminals, its rule state
   * and its automations, and wakes when something needs it. A session with work
   * in hand, or one a client is subscribed to, does not sleep. Unset is 30;
   * zero never sleeps a session for being quiet.
   */
  sleepAfterMinutes?: number;
  /**
   * How many sessions are loaded at most.
   *
   * Over this, the least recently used quiet session sleeps first, checked on
   * each turn start. Unset is 10; zero is no limit.
   */
  sessionResidencyLimit?: number;
  /** The clock sleep and wakes read. A test supplies its own so a timeout can be reached without waiting for it. */
  now?(): Date;
  /** How a timer is armed for sleep and wakes. Handed in for the same reason the clock is. */
  timer?(fire: () => void, ms: number): { cancel(): void };
  /**
   * The daemon's own settings, as the keys root config carries beside the host's.
   *
   * The host has no business in a daemon's `config.json`: it does not read it,
   * does not know where it is and does not know which of its keys can apply
   * while the process runs. So a daemon that wants a client to edit them hands
   * one over here instead, and the host only shows it and hands writes back.
   *
   * Left out, root config is the host's own three keys and nothing else.
   */
  rootConfig?: RootConfigPort;
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
  /**
   * What plugins asked to run when this host closes, in load order.
   *
   * The fold fills this from `registerClose`, one entry per registration, and
   * `close` runs them after the sessions have closed and before the stores do.
   * Each entry carries its plugin's name, so one that fails is logged against
   * the plugin that owns the work.
   */
  closers?: { by: string; close: () => void | Promise<void> }[];
  /**
   * The trigger types the plugins offer, one entry per plugin that offered one.
   *
   * The fold fills this from `registerTriggerType`, and the host does two
   * things with it: it lists the types beside its own `session` and `watch`, so
   * a client draws them in the automation form, and it sets each entry's
   * `deliver` so that plugin's `fireTrigger` reaches an automation. Kept by
   * plugin, so dropping one plugin's types is one entry to remove.
   */
  pluginTriggers?: PluginTriggers[];
  /**
   * Every plugin that may start a session for somebody, one entry each.
   *
   * The fold fills this from every contribution, and the host sets each entry's
   * `start` and `opens`, so a plugin's `startSession` reaches the live host
   * from wherever it is called and `sessionOwner` can tell a session the host
   * still has from a row a restart left behind. Kept by plugin, so a plugin's
   * own entry is the whole of what removing it would take.
   */
  pluginStarts?: PluginStarts[];
  /**
   * Every plugin that may connect to this host, one entry each.
   *
   * The fold fills this from every contribution, and the daemon does two things
   * with it: it sets each entry's `host` once `createHost` has answered, so a
   * plugin's `connect` reaches the live host from wherever it is called, and it
   * closes every one of them when it raises `stopping`. Kept by plugin, so a
   * plugin's own entry is the whole of what removing it would take.
   */
  pluginConnects?: PluginConnects[];
  /**
   * Every plugin that may open a canvas, one entry each.
   *
   * The fold fills this from every contribution, and the host sets each entry's
   * `open`, `update` and `close`, so a plugin's call reaches the live store
   * from wherever it is made. Kept by plugin, so a plugin's own entry is the
   * whole of what removing it would take.
   */
  pluginCanvases?: ServedCanvases[];
  /**
   * What the plugins give a chat a person or a tool opens, in plugin order.
   *
   * The fold fills this from every `registerChatPreamble`, and leaves it unset
   * when no plugin registered one.
   */
  chatPreambles?: ChatPreamble[];
}

/**
 * The daemon's settings, as the host shows them and hands changes back.
 *
 * The schema is `state.config.schema` in all but name: its `properties` are the
 * keys a client draws a form from, and one key may say `writeOnly`, or `secret`
 * as a plugin's form does, on a property for a value that must never be
 * answered. What `values` holds is the file as it is now, not the host's copy
 * of what was last pushed.
 */
export interface RootConfigPort {
  /** The keys this daemon carries, as a `ConfigSchema`'s `properties`. */
  schema(): Record<string, unknown>;
  /** What each key holds now. */
  values(): Record<string, unknown> | Promise<Record<string, unknown>>;
  /**
   * Change the keys named, and say whether the daemon must restart for them.
   *
   * Only ever called with keys the schema above names. A value that is `null`
   * is a key taken back, which is how JSON says it. Throws to refuse, and the
   * message reaches the client that pushed the change as `rejectionReason`, so
   * it names the key that was refused.
   */
  write(values: Record<string, unknown>): RootConfigAnswer | Promise<RootConfigAnswer>;
}

/** What a write to the daemon's own keys came to. */
export interface RootConfigAnswer {
  /**
   * Whether the change cannot apply while this process runs.
   *
   * True marks the host until the daemon restarts, which is what a client
   * reads to know a setting it just wrote is not in force yet: see
   * `markRestartNeeded`.
   */
  restartNeeded?: boolean;
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
   * Whether a person is asked before this tool runs.
   *
   * `false` says the tool is the session's own ordinary work and a backend runs
   * it without a confirmation; absent says nothing, and the backend's own policy
   * decides as it always has. It is the tool's claim about itself, and a deny
   * list still wins over it: a tool somebody has forbidden stays refused,
   * whatever the tool says. `post_message` is what it is for - a bot's reply to
   * the message that woke the session, where a question would ask a person to
   * confirm the answer they are waiting on.
   */
  confirm?: boolean;
  /**
   * Whether this tool does more than a session's ordinary work.
   *
   * The tool's own claim, and the host's permission decides: a tool that sets
   * this is absent from every session unless `HostOptions.advancedTools` is
   * true, so it is never reported and never bound. A tool that says nothing is
   * unaffected, whoever contributed it. This is a different
   * question from `effects`: one says what running the tool does, which a
   * backend's policy reads, and this says whether the host offers it at all.
   */
  advancedPermission?: boolean;
  /**
   * Whether the tool is offered only to a session that asks for it by name.
   *
   * Where `advancedPermission` is one switch over every session, this is a
   * question about one session: a tool that sets it is absent from every
   * session whose request does not name it in `tools`, and offered to the ones
   * that do. The names are kept with the session, so a restart offers the same
   * tools without the request being repeated. It is what a tool whose answer
   * only means something in one kind of session asks for - `post_message` is
   * offered to a bot's back session and to nothing else.
   */
  optIn?: boolean;
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
   * The shape one session's title strategy asks for, and what that session
   * brings to it.
   *
   * `undefined` leaves the tool as it is, `{ offered: false }` takes it out
   * of the list for that session, and `definition` is merged over the tool's
   * own. It is how a strategy that does not rename chats withholds the tool
   * rather than offering one it would refuse, and how a tool offered only to
   * a session that binds a connector withholds itself from the rest.
   *
   * `config` is the session's config as it was kept, and `bindings` is the
   * aliases it may name a connector by - the plugin readers' maps with the
   * session's own key over them. Both are read live, so a binding that moved
   * reaches the next list the host builds.
   */
  forSession?: (session: {
    titleStrategy: TitleStrategy;
    /** The session's config, or nothing where it has none. */
    config?: Record<string, unknown> | undefined;
    /** The connectors this session may use, by alias. */
    bindings?: Record<string, string> | undefined;
  }) => { offered: boolean; definition?: Partial<ToolDefinition> } | undefined;
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
  /** The agent the calling session runs, by its provider id, when the host holds the session. */
  provider?: string;
  /** The turn the call is running in, when the chat has one running. */
  turn(): string | undefined;
  /**
   * Who is behind this call: a person's id, a session's owner, or `host`.
   *
   * Read from the sender of the turn the call is running in, which is the only
   * thing that carries a person: a window outlives the turn it sent, and a
   * tool reached after that turn ended has nobody to name. Where no turn is
   * running, or the one that is was sent by nobody this host knows, the
   * session's owner answers, and where the session has no owner the host
   * itself is the name. A stamp written from a call always names something,
   * and never the model that asked for it.
   */
  person(): string | undefined;
  /**
   * Whether this call may do that here.
   *
   * Always true on a host with no users directory, where there is nobody to
   * ask and the tools act as they always did, and for a turn this host's own
   * root connection sent - which `admit` refuses nothing either. Under a users
   * directory it is the answer of the person who sent the turn the call runs
   * in.
   *
   * A call nobody is behind holds the read half and nothing else, so an agent
   * in a turn a host began for itself, one a rule nobody owns started, and one
   * reached with no turn running at all still read the sessions and may not
   * write one. That last is why no turn is not a hole: a window outlives the
   * turn it sent and can reach a tool after that turn ended, and a turn is the
   * only thing that carries a person.
   */
  may(grant: Grant): boolean;
  /**
   * The words a call that may not `grant` is refused with.
   *
   * The host's own refusal - `refusalReason`, the sentence a client is told on
   * the wire - said about the person the turn belongs to, and about the turn
   * itself where nobody is behind the call, since there is no id to name there.
   * Asked only where `may` answered false, which under a users directory is the
   * whole of a tool's refusal: a host with no users directory refuses nothing
   * and so never says this.
   */
  refusal(grant: Grant): string;
  /**
   * Every session this host knows, running or on disk, the calling one included.
   *
   * The catalogue's own rows, as `listSessions` answers them, so a tool says
   * about a session exactly what a client sees of it: status bits, activity,
   * directories, project, changes, and the `git` and `github` facts in `_meta`.
   *
   * Under a users directory only the rows the turn's person may read: the
   * listing a tool answers is the listing its own session's person is shown.
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
  /**
   * A second chat in a running session, started with its first message.
   *
   * `provider` names the backend that serves this chat, where it is not the
   * session's own: a chat of another backend runs on that one, with that
   * backend's config, while the session keeps its own provider and its own
   * chats. The session's keys that no backend owns - its `computer` and what a
   * plugin contributed - reach the chat from the session either way.
   *
   * `config` is that backend's settings for this chat, checked against its
   * schema. Absent, the chat runs on what the session was given, less what its
   * backend does not own.
   */
  createChat(session: string, options: {
    title?: string;
    model?: string;
    provider?: string;
    config?: Record<string, unknown>;
    prompt: string;
    from: Bag;
  }): Promise<{ chat: string }>;
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
   * Wake the calling chat once `delaySeconds` have passed, with a turn that
   * carries `prompt`.
   *
   * One per chat: a new one replaces the one held. Kept on the chat's record,
   * so it survives the session sleeping and the daemon restarting. Answers
   * when it falls due.
   */
  scheduleWake(delaySeconds: number, prompt: string): Date;
  /** Cancel the calling chat's wake. Answers whether it held one. */
  cancelWake(): boolean;
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
   * The protocol version this connection agreed on at `initialize`.
   *
   * Set from what the negotiation answered, so a later delivery can hold back
   * an action the client's version does not know - the specification says a
   * host MUST NOT behave as a newer version to an older connection. Absent on
   * a connection no handshake has named, such as one a test built by hand, and
   * such a connection is sent everything.
   */
  protocolVersion?: string;
  /**
   * The BCP 47 tag the client sent as `locale` at `initialize` or `reconnect`.
   *
   * What text answered for this client alone is translated into. Absent when
   * the client sent none, and that client reads English.
   */
  locale?: string;
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
   * are one setting for everybody, like `globalAutoApproveEnabled`.
   * `defaultShell` is not one of those: the host's own note calls these "the
   * preferences a *client* holds about how the host should behave for it", and
   * VS Code pushes the shell out of a per-person setting the moment it
   * connects. Kept in one shared record, the last client to connect decided
   * everybody's shell - so the person's half is kept here instead, and each
   * connection reads its own back in root state.
   */
  config?: Record<string, unknown>;
  /**
   * The folders this window said yes to when the host asked it about one.
   *
   * A move into a folder the window never pushed asks it then and there, and
   * the answer is the whole of what it said about that folder - so it is kept
   * here rather than thrown away when the backend starts in it: the move
   * starts the backend again, and the process that starts has never heard the
   * question. It stands until the
   * window pushes a `workspaceTrust` value, which answers for every folder at
   * once and so puts the folder-by-folder answers behind it.
   *
   * Per connection for the same reason `config` is: it is what one window
   * said, and it dies with the socket.
   */
  trustedFolders?: string[];
  /**
   * Tokens this client pushed, by protected resource identifier.
   *
   * A token the client aimed at one MCP server, with `authenticate`'s
   * `target`, is kept under its resource and that server together, so a
   * lookup by the resource alone never finds it: the protocol has such a token
   * reach that server and never a backend's own resource.
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
    /**
     * The names of the handlers this connection is served from.
     *
     * The table is built per connection, so this is where a caller outside the
     * host can see what it holds. The suite reads it to assert that every one
     * of them is classified in `GATE`: a handler added and classified nowhere
     * is a method nobody decided about, and a test that fails on the next run
     * is how that is caught rather than the method being served to anybody.
     */
    methods: readonly string[];
  };
  /** How many clients are currently connected. */
  connections(): number;
  /** The last locale a client sent, by client id, or `undefined` when it sent none. */
  localeOf(clientId: string): string | undefined;
  /**
   * The sessions with a turn running or waiting on a person, by URI.
   *
   * What an embedder asks before it takes the host down, since every session's
   * process goes with it.
   */
  turning(): string[];
  /**
   * Take no new turn from now on, saying why, or take them again.
   *
   * What an embedder about to go asks for, and it asks before it reads
   * `turning`: a turn that starts between that read and the close which
   * follows is a turn the close ends, and a check a turn can slip past is no
   * check. The words are the embedder's, since only it knows what it is doing,
   * and they are what the client that asked for the turn is told.
   *
   * A turn already running is untouched and still named by `turning`.
   * `undefined` takes turns again, which is what an embedder that decided to
   * stay asks for.
   */
  refuseTurns(why: string | undefined): void;
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
  /**
   * Take a new fold of the options, keeping every open session.
   *
   * The options a host is built over are what a daemon folds its plugins into,
   * and a plugin that loads, unloads or changes its options while the daemon
   * runs is a new fold of the same base. This is how that fold reaches a
   * running host: the options are changed in place, so every area that read
   * one reads the new value, every open session is retooled, and one
   * `root/agentsChanged` says the agent list moved.
   *
   * A port or a resource scheme is not swapped live. A store is one the host
   * was built over, and a scheme names URIs a client has already been handed,
   * so a fold that differs in either is refused whole and the host keeps the
   * options it has. The answer is why the fold was refused, or `undefined` when
   * it was taken.
   *
   * An agent the fold drops but that still has an open session is kept, so no
   * session is left running on nothing. Ending those sessions first is the
   * caller's to do, with `endSessionsOf`.
   */
  replace(folded: HostOptions): string | undefined;
  /**
   * End every session running on one agent, as a disposal ends one.
   *
   * What an embedder does before it unloads the plugin that brought the agent:
   * a backend gone from the host with sessions still on it is a session that
   * can never turn again. Each one is removed the way `session/disposeSession`
   * removes it - its chats closed, its directory told, every client sent
   * `root/sessionRemoved` - and one that could not be removed is logged rather
   * than stopping the rest.
   */
  endSessionsOf(agent: Agent | string): Promise<void>;
  /**
   * Say that a restart is what puts the configuration in force.
   *
   * A connection watching the root is sent `x-ahpd/restartNeeded` with
   * `{ channel: "ahp-root://" }` as it is set, and so is one that subscribes to
   * the root or comes back to it afterwards. A connection that arrives
   * afterwards reads `_meta["ahpd.restartNeeded"]` on its `initialize`
   * answer. No root action carries `_meta`, so the mark is no part of the
   * root's state. It lives only in memory, so a restarted daemon starts
   * without it, and a second call sends nothing: the mark is the same fact
   * said once.
   */
  markRestartNeeded(): void;
  /**
   * Stop what this host runs, once, while the process stays up.
   *
   * From the first call no automation fires and no session, terminal or
   * automation run starts. Every session's chats end, with their agents and any
   * turn still running, and every terminal; once those have exited or
   * `HOST_CLOSE_WAIT_MS` has passed, the automation store and then the session
   * store close, writing what is waiting and nothing after. A step that throws
   * is logged and the rest still run. What a process does before it hands the
   * stores to another. Every call answers the one close, which settles when
   * the stores are closed.
   */
  close(): Promise<void>;
}
