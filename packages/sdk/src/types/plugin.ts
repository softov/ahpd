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

import type { Agent } from './agent.js';
import type { EventHandler, EventName, HostHandlers } from './events.js';
import type { HostOptions, HostTool } from './host.js';
import type { ResourceProvider } from './resources.js';

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
  | 'computers';

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
 * Read-only: a plugin is told where it is running and may log there, and every
 * method that contributes a value is named `register*` so a registration is
 * told apart at the call site from what a plugin only reads.
 */
export interface PluginContext {
  /** The directory whose sessions the host serves, and the catalogue's scope. */
  readonly path: string;
  /** Every directory the host serves; the first is the default one. */
  readonly paths: string[];
  /** The version of `@ahpd/sdk` actually in use, which is what a peer range is checked against. */
  readonly version: string;
  /** One line to the daemon's log. */
  log(message: string): void;
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
 * `registerMcpServer`, `registerConfig`, `registerMethod`, and the `on` that
 * subscribes to the host's own events.
 */
export interface PluginHost extends PluginContext {
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
  registerSessionConfig(key: string, schema: Record<string, unknown>): void;
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
