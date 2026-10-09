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

import type { AutomationTriggerDefinition } from '@microsoft/agent-host-protocol';

import type { Agent } from './agent.js';
import type { StartSession } from './automations.js';
import type { SessionConfigAnswerer } from './completions.js';
import type { EventHandler, EventName, HostHandlers } from './events.js';
import type { HostOptions, HostTool } from './host.js';
import type { MachineNeed } from './machine.js';
import type { ResourceProvider } from './resources.js';
import type { Owner, UsageEntry } from './usage.js';
import type { SecretWork } from './vault.js';

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
 * Built by the plugin host and carried through the fold rather than copied: a
 * plugin fires from a route or a timer long after `apply` returned, so the
 * object its closure holds has to be the object the host fills in. `deliver` is
 * that place, and it is set once the host is built over these types.
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
  deliver?: (type: string, event: string, data: Record<string, unknown>) => void;
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
   * the session is started under - decision
   * `work-is-owned-by-a-typed-reference`.
   */
  owner: Owner;
  /** The backend it runs on, or the host's own default. */
  provider?: string;
  /** Where it works, or wherever a session with nothing said usually works. */
  workingDirectory?: string;
  /** Config values for the new session, as a client's `createSession` gives. */
  config?: Record<string, unknown>;
  /** The model it asks for, as the protocol's `ModelSelection`, or the backend's own. */
  model?: unknown;
  /** What it is called, where the plugin already has a name for it. */
  title?: string;
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
 * One plugin's way of starting a session, and what reaches the host.
 *
 * Built by the plugin host and carried through the fold rather than copied, for
 * the same reason `PluginTriggers` is: a plugin starts a session from a route or
 * a timer long after `apply` returned, so the object its closure holds has to be
 * the object the host fills in. `start` is that place.
 */
export interface PluginStarts {
  /** The plugin that asked. */
  by: string;
  /**
   * Where the ask goes, set by the host once it exists.
   *
   * Absent until then, which is a plugin asking while `apply` runs or from its
   * own unit test with no host built over it. Unlike a fire, which is about
   * what is happening now, this is a call that owes an answer - so a plugin
   * that asks too early is told rather than dropped.
   */
  start?: (wanted: StartSession) => Promise<string>;
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
  | 'vault';

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
 * handler on every runtime - decision
 * `cofold-serve-is-fetch-style-with-a-node-adapter`. The request reaches it
 * whole, so a plugin reads `new URL(request.url).pathname` and finds its own
 * prefix on the path rather than being handed a remainder it has to trust.
 */
export type Route = (request: globalThis.Request) => Promise<globalThis.Response>;

/**
 * One plugin, as configuration or the command line names it.
 *
 * A bare string is the module specifier and carries no options. The object form
 * adds what only the person naming it knows: the options `apply` receives, and
 * whether it is switched on at all - which is what lets one configuration keep
 * a plugin installed and turned off.
 */
export type PluginSpec = string | {
  /** The module specifier, or a path to a directory or a file. */
  name: string;
  /** Passed to `apply` as its second argument. */
  options?: Record<string, unknown>;
  /** `false` drops the spec before it is resolved. Absent means on. */
  enabled?: boolean;
};

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
}

/**
 * The contribution surface, which is `HostOptions` named back.
 *
 * Every method that contributes a value is named `register*` (decision
 * `plugin-contributes-host-options`), and the set of kinds is closed, one
 * method each (decision `plugin-registration-kinds`). Every registration is
 * checked against the contract it satisfies before it is recorded, so a value
 * the daemon did not write is refused at this boundary; the check and the
 * implementation of this interface are the loader's, not this file's.
 *
 * Not here yet, and named in the domain reference so an author is not left
 * looking for a method that should not exist: `registerCustomization`,
 * `registerMcpServer`, `registerConfig` and `registerMethod`.
 */
export interface PluginHost extends PluginContext {
  /**
   * One item of this plugin's own was skipped, and why.
   *
   * Where `log` is a line for a person reading the daemon's log, this is one
   * the person who ran `ahpd start` or `ahpd restart` is shown before the
   * success line, because it is a thing the daemon started without rather than
   * a thing that went wrong in it: the preset a plugin dropped, the variant it
   * could not read, the machine profile nothing holds.
   *
   * It costs the item and not the plugin - saying one is never a failure, and
   * a plugin that said one keeps everything else it registered. One line,
   * without a newline, naming the item.
   */
  problem(line: string): void;
  /**
   * One agent's machine needs, read when called rather than at load.
   *
   * The plugin that makes machines is the one that asks: a machine whose
   * profile lists `agents` is made at create time, and the plugin that
   * registers an agent may load before or after this one, so nothing can be
   * read while `apply` runs. The host is the one thing that knows every agent,
   * and it answers the agent's `machine()` here - decision
   * `the-host-hands-an-agents-machine-needs-to-the-machine-maker`.
   *
   * `undefined` when no agent has that provider, which is a profile naming an
   * agent this host does not have. An agent that declares nothing answers an
   * empty record, which is a machine with nothing added to it.
   */
  machineNeeds(provider: string): Record<string, MachineNeed> | undefined;
  /**
   * Keep one usage record, in the host's `usage` port.
   *
   * The way a plugin says what it cost: a computer records the time it spent
   * up, and a backend that meters itself records what its turns used - decision
   * `usage-and-computer-time-are-two-records-behind-one-port`. The record is
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
   * charged to that team and `user:<id>/<name>` only for that person's own work
   * - decision `a-secret-is-named-in-a-host-team-or-user-scope`. The value is
   * read when it is asked for rather than at load, and a host with no `vault`
   * port refuses the name rather than answering it with nothing.
   */
  secret(name: string, work?: SecretWork): Promise<string>;
  /**
   * Whether this daemon keeps one session, read when called.
   *
   * The computer plugin asks at startup about a disposable machine it found,
   * to know whether that leftover is one of its own to adopt - decision
   * `a-daemon-adopts-only-the-disposable-machines-whose-session-it-keeps`. The
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
   * Read the way `sessionKept` is, and for the same reason: the store is named
   * by the fold that runs after every plugin has applied, so a plugin asking
   * while the later ones are still loading waits rather than being told there
   * is nobody. A host that keeps no sessions answers nothing for all of them.
   */
  sessionOwner(uri: string): Promise<Owner | undefined>;
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
   */
  startSession(wanted: SessionRequest): Promise<string>;
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
   * duplicate scheme is - decision `a-plugin-may-contribute-a-session-key`.
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
   * host, because a host serves one `computer:` provider -
   * decision `one-computer-provider-with-runtimes-as-options`.
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
   * what a secret manager or a database several daemons share takes over -
   * decision `the-local-vault-is-a-plain-file-until-it-is-encrypted`, whose own
   * vault is a plain file beside the configuration.
   */
  registerVault(vault: PortOf<'vault'>, when?: 'replace'): void;
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
   * the process's life - decision `a-plugin-is-told-when-the-host-closes`.
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
   * Nothing is awaited. A run starts asynchronously and the plugin is not told
   * whether one did, because an event has no answer - what a client watching an
   * automation reads is the run it started.
   */
  fireTrigger(type: string, event: string, data: Record<string, unknown>): void;
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
  /** The plugin's id, unique among the plugins a daemon loads. */
  name: string;
  /** What a listing prints instead of the id. */
  title?: string;
  /** This plugin's own option defaults, under whatever the configuration said. */
  defaults?: Record<string, unknown>;
  /**
   * A JSON Schema for the options `apply` receives.
   *
   * An object schema whose `properties` are the option keys. The daemon checks
   * the configured options, with `defaults` merged under them, against it
   * before `apply` runs: options that fail it are reported and the plugin is
   * not applied, and a key it does not name is reported and passed through.
   * Absent, the options reach `apply` unchecked.
   */
  optionsSchema?: Record<string, unknown>;
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
   * Carried through rather than copied, so the object the plugin's own
   * `fireTrigger` holds is the one the host fills in. Always here, empty when
   * the plugin offered no type, so the fold can read it without a case.
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
   * The one route this plugin registered, when it registered one.
   *
   * Absent rather than a handler that answers nothing, because "no route" and
   * "a route that answers 404" are different things: the first is a plugin that
   * serves nothing, and the second is one that would answer a path wrongly. The
   * key in the fold is the plugin's own name, which is the prefix it is served
   * under, so a route and the path that reaches it cannot drift apart.
   */
  routes?: Route;
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
  /** The options `apply` is given. */
  options: Record<string, unknown>;
  /** The module's plugin object. */
  plugin: Plugin;
}
