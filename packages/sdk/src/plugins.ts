/**
 * Composing what several plugins contributed into one option object.
 *
 * The whole of the plugin mechanism that touches nothing: no filesystem, no
 * module loader, no clock. Resolving a spec and importing a module is the
 * daemon's half; deciding what a contribution means to `HostOptions` is this.
 *
 * Nothing here throws. Every conflict is pushed onto `problems` so the loader
 * can report all of them at once rather than the daemon dying on the first,
 * and the returned object is fresh - the base a caller passed in is not
 * mutated.
 */

import type { Agent } from './types/agent.js';
import type { SessionConfigAnswerer } from './types/completions.js';
import type { EventHandler, EventListener, EventName, HostEvent, HostEventOf, HostHandlers } from './types/events.js';
import type { HostOptions } from './types/host.js';
import type { Contribution, PluginContext, PluginHost, PortContribution, PortKey, PortOf, Route } from './types/plugin.js';
import type { SessionStore } from './types/sessions.js';
import type { Usage } from './types/usage.js';
import type { Vault } from './types/vault.js';
import { idOf, schemeOf } from './catalog.js';
import { readSecret } from './vault.js';
import { checkAgent, checkPort, checkResourceProvider, checkRoute, checkScheme, checkTool, miss } from './validate.js';

/**
 * Every key a `set` registration may name.
 *
 * The runtime half of `PortKey`: TypeScript does not survive to runtime and a
 * plugin may be JavaScript, so the union is written down once more where the
 * fold can read it. `types/plugin.ts` is the contract, this is the check that
 * the contract and this list agree.
 */
const PORT_KEYS = [
  'resources', 'terminals', 'changes', 'directories', 'worktrees',
  'github', 'automations', 'sessions', 'diagnostics', 'computers', 'containers', 'usage', 'policies', 'vault',
] as const satisfies readonly PortKey[];

/*
 * A compile-time check, not a runtime one: a key added to `PortKey` and not to
 * the list above leaves `Unlisted` something other than `never`, and the
 * assignment below stops compiling. The runtime list can then be trusted to be
 * the whole union.
 */
type Unlisted = Exclude<PortKey, (typeof PORT_KEYS)[number]>;
const everyPortIsListed: Unlisted extends never ? true : never = true;
void everyPortIsListed;

/** What every agent `provider` collision problem starts with. */
export const AGENT_CLASH = 'agent provider clash:';

/**
 * Whether a scheme is the host's own rather than a plugin's to take.
 *
 * `file` is the store in `HostOptions.resources`, and every `ahp-` scheme is a
 * channel the protocol or this host already names. A plugin that registered
 * one would be answered before it, or would shadow a channel, so it is refused
 * where it is registered rather than quietly losing.
 */
export const reservedScheme = (scheme: string): boolean => {
  const lower = scheme.toLowerCase();
  return lower === 'file' || lower.startsWith('ahp-');
};

/**
 * Where every plugin's route is served, on the host's own listener.
 *
 * A segment of its own rather than a part of a plugin's name, so the space a
 * route may occupy is one string and a listener can tell a path of ours nobody
 * serves from one it never looks at.
 */
export const ROUTE_ROOT = '/plugins';

/**
 * The path prefix one plugin's route is served under.
 *
 * `ROUTE_ROOT`, then the plugin's own `name`, with each `/`-separated segment
 * percent-encoded: `@ahpd/x` is `/plugins/%40ahpd/x/`, and `x` keeps the `/`
 * before it as the boundary a longer name is not matched inside.
 *
 * No name is refused for its shape. `@` and `/` are both ordinary in a plugin's
 * name - a scoped package, or a spec that is a path - and a throw here would
 * cost the plugin everything else it registered, the ports it set and the
 * backend it brought, over a route that would have served. So the name is
 * encoded rather than checked, and {@link routeOf} builds the prefix the same
 * way, which is what keeps the two halves of the pair from drifting apart.
 */
export const routePrefix = (name: string): string =>
  `${ROUTE_ROOT}/${name.split('/').map((segment) => encodeURIComponent(segment)).join('/')}/`;

/** One plugin's route and the name it is served under. */
export interface ServedRoute {
  /** The plugin's `name`, which is both the key and the prefix. */
  readonly by: string;
  /** What answers a request below that prefix. */
  readonly handler: Route;
}

/**
 * Which plugin's route a path reaches, or nothing.
 *
 * Whole segments only, which the prefix's trailing `/` makes exact:
 * `/plugins/x/hook` reaches `x`, and `/plugins/xy` reaches nothing rather than
 * being the beginning of some other plugin's name. A path outside
 * {@link ROUTE_ROOT} is nobody's, so the caller answers it as it always did.
 */
export function routeOf(routes: Readonly<Record<string, Route>>, path: string): ServedRoute | undefined {
  if (path !== ROUTE_ROOT && !path.startsWith(`${ROUTE_ROOT}/`)) return undefined;
  for (const [by, handler] of Object.entries(routes)) {
    const prefix = routePrefix(by);
    // The prefix as it is written, with its `/`, and without it: both reach the
    // plugin, because a client that was handed the root of its route should not
    // have to append a slash to be answered.
    if (path === prefix || path === prefix.slice(0, -1) || path.startsWith(prefix)) return { by, handler };
  }
  return undefined;
}

/** What `foldHostOptions` answers: the composed options, and everything that could not be composed. */
export interface FoldedOptions {
  /** The base, copied, with every contribution that was accepted folded in. */
  options: HostOptions;
  /**
   * One message per conflict, in the order the contributions arrived. Empty
   * when nothing collided.
   *
   * Every conflict here is one line and nothing more: the clashing agent, the
   * port and the scheme are each dropped, and the rest of the host is built.
   * An agent `provider` clash starts with `AGENT_CLASH` so it can be told from
   * a port or a scheme without reading prose.
   */
  problems: string[];
  /**
   * Every plugin that registered a route, by plugin name.
   *
   * Not a `HostOptions` key: a route is not an option the host is built over
   * but a handler something else mounts, so it is answered beside the options
   * rather than among them. Empty when no plugin registered one, and keyed by
   * the plugin's own name, which is the prefix {@link routePrefix} serves it
   * under - so there is one name and it cannot be the two things at once.
   */
  routes: Record<string, Route>;
}

/**
 * Fold contributions into a base `HostOptions`.
 *
 * The rules, which are decision `plugin-contributes-host-options` and
 * `plugin-registration-kinds` made literal:
 *
 * - `agents` and `tools` append, in contribution order. A `provider` already
 *   registered - by the base or by an earlier plugin - is a problem naming
 *   both, and the agent that lost it is dropped: the first registration keeps
 *   the id, and a client that asks for it gets the backend that has always
 *   answered for it rather than whichever loaded last.
 * - A port is set once. A later contribution that lands on a value already
 *   there - the daemon's or another plugin's - is a problem naming both and
 *   the value does not move, unless the later one carries `'replace'`, which
 *   takes it over silently.
 * - A port the base does not have is set by the first plugin that offers one,
 *   with no `'replace'` needed.
 * - A route is kept under the plugin's own name and is never moved: one handler
 *   per plugin, under that plugin's own prefix, so there is nothing for two of
 *   them to collide on.
 */
export function foldHostOptions(base: HostOptions, contributions: Contribution[]): FoldedOptions {
  const problems: string[] = [];
  const options: HostOptions = { ...base, agents: [...base.agents] };

  /*
   * Who holds each port now: `the daemon` for a value the base was given, a
   * plugin's name for one a contribution set. Seeded from the base so a plugin
   * that supplies its own store is told rather than winning by order.
   */
  const owner = new Map<PortKey, string>();
  for (const key of PORT_KEYS) {
    if (base[key] !== undefined) owner.set(key, 'the daemon');
  }
  const set = new Map<PortKey, unknown>();

  const providers = new Map<string, string>();
  for (const agent of base.agents) providers.set(agent.provider, 'the daemon');
  const added: Agent[] = [];
  /*
   * The plugin each added agent came from, by provider - decision
   * `the-host-records-which-plugin-registered-each-agent`. Seeded from the
   * base's record, and an agent the base was handed directly has none.
   */
  const plugins: Record<string, string> = { ...base.agentPlugins };

  /*
   * The URI schemes, and who holds each. Seeded from the base for the same
   * reason the ports are: a plugin that registers a scheme the host was
   * already given is told, rather than winning by order.
   */
  type Schemes = NonNullable<HostOptions['resourceProviders']>;
  const schemes = new Map<string, string>();
  for (const scheme of Object.keys(base.resourceProviders ?? {})) schemes.set(scheme, 'the daemon');
  const resourceProviders: Schemes = { ...base.resourceProviders };

  for (const contribution of contributions) {
    for (const agent of contribution.agents) {
      const held = providers.get(agent.provider);
      /*
       * The first registration keeps the id, and the second one is dropped.
       *
       * A clash is one agent among many rather than a broken host: the plugin
       * that wrote it still contributes everything else it registered, and the
       * sessions recorded against the id it lost keep waiting for it. It is
       * reported like every other collision here, so whoever configured the
       * two plugins is told which id and which two parties.
       */
      if (held !== undefined) {
        problems.push(`${AGENT_CLASH} plugin ${contribution.by} registers agent ${agent.provider}, which ${held === 'the daemon' ? 'the daemon' : `plugin ${held}`} already registered`);
        continue;
      }
      providers.set(agent.provider, contribution.by);
      added.push(agent);
      plugins[agent.provider] = contribution.spec ?? contribution.by;
    }

    for (const [key, entry] of Object.entries(contribution.ports) as [PortKey, PortContribution | undefined][]) {
      // `Object.entries` cannot produce an absent key, but a JavaScript
      // contribution can carry an explicit `undefined` where the type says a
      // value, and one of those is not a registration.
      if (entry === undefined) continue;
      const held = owner.get(key);
      if (held !== undefined && !entry.replace) {
        problems.push(`plugin ${contribution.by} sets ${key}, which ${held === 'the daemon' ? 'the daemon' : `plugin ${held}`} already set; pass 'replace' to take it over`);
        continue;
      }
      owner.set(key, contribution.by);
      set.set(key, entry.value);
    }

    for (const [scheme, provider] of Object.entries(contribution.providers)) {
      const held = schemes.get(scheme);
      if (held !== undefined) {
        problems.push(`plugin ${contribution.by} registers scheme ${scheme}, which ${held === 'the daemon' ? 'the daemon' : `plugin ${held}`} already registered`);
        continue;
      }
      schemes.set(scheme, contribution.by);
      resourceProviders[scheme] = provider as Schemes[string];
    }
  }

  if (added.length > 0) options.agents = [...options.agents, ...added];
  if (Object.keys(plugins).length > 0) options.agentPlugins = plugins;

  const tools = [...(base.tools ?? []), ...contributions.flatMap((contribution) => contribution.tools)];
  if (tools.length > 0 || base.tools !== undefined) options.tools = tools;

  /*
   * The event listeners, the base's first and then each plugin's, in the order
   * the plugins were configured. A plugin that subscribed to nothing adds no
   * key, and a host with no listeners at all keeps `events` absent rather than
   * carrying an empty record.
   */
  const events: Record<string, EventListener[]> = {};
  for (const [name, list] of Object.entries(base.events ?? {})) {
    if (list !== undefined && list.length > 0) events[name] = [...list] as unknown as EventListener[];
  }
  for (const contribution of contributions) {
    for (const [name, list] of Object.entries(contribution.events)) {
      if (list === undefined || list.length === 0) continue;
      // A listener typed for one event is a listener for that event: the
      // mapped type gives each name its own handler signature, and the record
      // is what a name is looked up in at fire time.
      const held = list as unknown as EventListener[];
      events[name] = [...(events[name] ?? []), ...held];
    }
  }
  if (Object.keys(events).length > 0) options.events = events as unknown as HostHandlers;

  for (const [key, value] of set) {
    (options as unknown as Record<string, unknown>)[key] = value;
  }

  /*
   * The session settings, keyed by name and never merged over one another.
   *
   * A key the host already declares, or a backend's own schema declares, is a
   * collision: two controls for one name. It is reported and the base's own
   * property wins where it exists, because a plugin may not quietly move a
   * setting a backend already owns - decision
   * `a-plugin-may-contribute-a-session-key`.
   */
  const sessionConfig: Record<string, Record<string, unknown>> = { ...base.sessionConfig };
  const sessionCompletions: Record<string, SessionConfigAnswerer> = { ...base.sessionConfigCompletions };
  const holders = new Map<string, string>();
  for (const key of Object.keys(sessionConfig)) holders.set(key, 'the host');
  const backendKeys = new Set<string>();
  for (const agent of options.agents) {
    const schema = agent.schema();
    const properties = (typeof schema.properties === 'object' && schema.properties !== null
      ? schema.properties
      : {}) as Record<string, unknown>;
    for (const key of Object.keys(properties)) backendKeys.add(key);
  }
  for (const contribution of contributions) {
    for (const [key, schema] of Object.entries(contribution.sessionConfig)) {
      const held = holders.get(key);
      if (held !== undefined) {
        problems.push(`plugin ${contribution.by} registers session setting ${key}, which ${held === 'the host' ? 'the host' : `plugin ${held}`} already declares`);
        continue;
      }
      if (backendKeys.has(key)) {
        problems.push(`plugin ${contribution.by} registers session setting ${key}, which a backend's own schema already declares`);
        continue;
      }
      holders.set(key, contribution.by);
      /*
       * A key with an answerer says so in its own schema.
       *
       * `enumDynamic` is the protocol's word for "ask me", and it is set here
       * rather than left to the plugin because the two have to agree: a schema
       * claiming it with nobody registered draws a picker that is answered
       * with nothing, and an answerer nobody is told about is never asked.
       * Setting it where the pair is known makes the two impossible to
       * separate.
       */
      const answerer = contribution.sessionCompletions[key];
      sessionConfig[key] = answerer === undefined ? schema : { ...schema, enumDynamic: true };
      if (answerer !== undefined) sessionCompletions[key] = answerer;
    }
  }
  if (Object.keys(sessionConfig).length > 0) options.sessionConfig = sessionConfig;
  if (Object.keys(sessionCompletions).length > 0) options.sessionConfigCompletions = sessionCompletions;

  if (Object.keys(resourceProviders).length > 0) options.resourceProviders = resourceProviders;

  /*
   * The routes, by plugin name.
   *
   * Taken as they are rather than composed: a route is one handler per plugin
   * under that plugin's own prefix, so no two of them can land on one path and
   * there is nothing to collide. The name is the key because it is the prefix,
   * which is what makes a route and the path that reaches it the same string.
   */
  const routes: Record<string, Route> = {};
  for (const contribution of contributions) {
    if (contribution.routes !== undefined) routes[contribution.by] = contribution.routes;
  }

  return { options, problems, routes };
}

/** What one `apply` is handed, and what it recorded. */
export interface HostRecording {
  /** The surface a plugin calls `register*` on. */
  host: PluginHost;
  /** Everything it registered, kept apart until the fold sees it. */
  contribution: Contribution;
}

/** What a plugin host is given besides its context. */
export interface HostRecordingOptions {
  /**
   * What configuration named this plugin by, a package or a path, kept on the
   * contribution so the host can record it against each agent it registers.
   */
  spec?: string;
  /**
   * Every agent this host knows, read when `machineNeeds` is called.
   *
   * A function rather than a list because the list is not complete while
   * plugins are being applied: the plugin that registers an agent may load
   * after the one that makes machines, and a machine is made long after both.
   */
  agents?: () => Agent[];
  /**
   * Where a plugin's usage records go, read when `recordUsage` is called.
   *
   * A function, and `undefined` for the store, for the same reason `agents` is
   * a function: the port belongs to the host and not to this plugin, so the
   * plugin that registers one may load after this one, and a daemon may have
   * none at all.
   */
  usage?: () => Usage | undefined;
  /**
   * Where a plugin's secrets are, read when `secret` is called.
   *
   * A function, and `undefined` for the store, for the same reason `usage` is:
   * the port belongs to the host and not to this plugin, so a plugin that
   * registers a vault may load after this one, and a host may have none.
   */
  vault?: () => Vault | undefined;
  /**
   * Where a `problem` line goes, for the loader to carry beside its own.
   *
   * Collected rather than written, because the person who ran the start is the
   * one who has to read them and the loader is what that person reads from.
   */
  problem?: (line: string) => void;
  /**
   * The sessions this host keeps, read when `sessionKept` is called.
   *
   * A function, and `undefined` for the store, for the same reason `usage` is:
   * the store belongs to the host and not to this plugin, so a plugin that
   * registers one may load after this one, and a host in a test may have none.
   *
   * It may answer late, because the fold that names the store has not run yet
   * while any one plugin is applying - and a plugin asking before the fold has
   * run waits rather than being told there are no sessions.
   */
  sessions?: () => SessionStore | undefined | Promise<SessionStore | undefined>;
}

/**
 * The `PluginHost` one plugin's `apply` is handed.
 *
 * Every method that contributes checks what it is given before it records it,
 * so a bad registration throws out of `apply` and the loader discards that
 * plugin's whole contribution rather than keeping the part registered before
 * the bad one. A registration made twice by the same plugin is refused here,
 * because that is one `apply` making a mistake; the same port claimed by two
 * plugins is the fold's problem, because only the fold can see both.
 *
 * `machineNeeds` is the one method that reads rather than registers: it answers
 * an agent's `machine()` from the live list, so a plugin that makes machines
 * needs nothing of this package and no agent has to be loaded yet. `problem`
 * is the one that neither registers nor reads: it records a line and returns,
 * so a plugin can say which of its own items it dropped without that costing
 * the plugin anything else it registered.
 */
export function pluginHost(by: string, context: PluginContext, options: HostRecordingOptions = {}): HostRecording {
  /*
   * The listeners, keyed by event. Held as a loose record and narrowed to
   * `HostHandlers` through the contribution, because the mapped type gives
   * each event its own listener type and a generic `on` writes one key at a
   * time.
   */
  const events: Record<string, EventListener[]> = {};
  const contribution: Contribution = {
    by,
    ...(options.spec === undefined ? {} : { spec: options.spec }),
    agents: [],
    tools: [],
    sessionConfig: {},
    sessionCompletions: {},
    ports: {},
    providers: {},
    events: events as unknown as HostHandlers,
  };
  const providers = new Set<string>();
  const tools = new Set<string>();
  const sessionKeys = new Set<string>();

  const setPort = <K extends PortKey>(key: K, method: string, value: PortOf<K>, when?: 'replace'): void => {
    checkPort(key, value, by);
    if (contribution.ports[key] !== undefined) {
      throw new Error(miss(by, method, key, 'registered only once'));
    }
    contribution.ports[key] = { value, replace: when === 'replace' };
  };

  const host: PluginHost = {
    ...context,
    problem: (line) => { options.problem?.(line); },
    // Read from the live list, not a snapshot: the agents this host will have
    // are not all known while any one plugin is applying. An agent that
    // declares nothing answers an empty record, which is a machine with
    // nothing added to it rather than a provider nobody has.
    machineNeeds: (provider) => {
      const agent = options.agents?.().find((one) => one.provider === provider);
      return agent === undefined ? undefined : agent.machine?.() ?? {};
    },
    /*
     * Read from the live port rather than a snapshot, and dropped rather than
     * thrown when there is none: a host nobody asked to keep usage on is not a
     * plugin that got it wrong, and a meter that failed a machine's shutdown
     * over a missing store would lose the machine too.
     */
    recordUsage: async (entry) => {
      const usage = options.usage?.();
      if (usage === undefined) return;
      await usage.record(entry);
    },
    /*
     * Thrown rather than dropped when there is no vault, the other way round
     * from `recordUsage`: a plugin asking for a credential is asking for a value
     * it cannot do without, so a host nobody gave one to is a host that cannot
     * run it.
     */
    secret: async (name, work) => {
      const vault = options.vault?.();
      if (vault === undefined) throw new Error(`${name} cannot be read: this host has no vault`);
      return readSecret(vault, name, work);
    },
    /*
     * The store is keyed by id and a machine records the session URI, so the
     * name is asked of the URI. `false` rather than a throw when there is no
     * store, the way `recordUsage` drops: a host that keeps no sessions has no
     * leftovers of its own to adopt, which is an answer and not a failure.
     *
     * Awaited because a plugin can ask before the host it is being applied to
     * has named its store, and the answer has to be the same whatever else is
     * still loading.
     */
    sessionKept: async (uri) => {
      const sessions = await options.sessions?.();
      if (sessions === undefined || sessions.config(idOf(uri)) === undefined) return false;
      /*
       * The provider has to be the URI's own scheme.
       *
       * A session id comes from the client's channel, so a client that opens
       * `echo:/one` after a session named `acp:/one` has gone writes the same
       * row, and a leftover labelled for that id would be adopted as though it
       * were a session of this kind - a machine with another backend's needs
       * charged to a session that cannot run in it.
       */
      return sessions.provider(idOf(uri)) === schemeOf(uri);
    },
    registerAgent(agent) {
      checkAgent(agent, by);
      if (providers.has(agent.provider)) {
        throw new Error(miss(by, 'registerAgent', agent.provider, 'a provider no other agent in this plugin uses'));
      }
      providers.add(agent.provider);
      contribution.agents.push(agent);
    },
    registerTool(tool) {
      checkTool(tool, by);
      const name = tool.definition.name;
      if (tools.has(name)) {
        throw new Error(miss(by, 'registerTool', name, 'a name no other tool in this plugin uses'));
      }
      tools.add(name);
      contribution.tools.push(tool);
    },
    registerSessionConfig(key, schema, completions) {
      const named = typeof key === 'string' ? key.trim() : '';
      if (named === '') throw new Error(miss(by, 'registerSessionConfig', String(key), 'a non-empty key'));
      if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
        throw new Error(miss(by, 'registerSessionConfig', named, 'a JSON Schema property object'));
      }
      if (completions !== undefined && typeof completions !== 'function') {
        throw new Error(miss(by, 'registerSessionConfig', named, 'a function to answer its picker, or nothing'));
      }
      if (sessionKeys.has(named)) {
        throw new Error(miss(by, 'registerSessionConfig', named, 'a key no other setting in this plugin uses'));
      }
      sessionKeys.add(named);
      contribution.sessionConfig[named] = schema as Record<string, unknown>;
      if (completions !== undefined) contribution.sessionCompletions[named] = completions;
    },
    registerResources: (store, when) => { setPort('resources', 'registerResources', store, when); },
    registerResourceProvider(scheme, provider) {
      const named = checkScheme(scheme, by);
      if (reservedScheme(named)) {
        throw new Error(miss(by, 'registerResourceProvider', named, 'a scheme the host does not already own; file and ahp- are its own'));
      }
      checkResourceProvider(named, provider, by);
      if (contribution.providers[named] !== undefined) {
        throw new Error(miss(by, 'registerResourceProvider', named, 'a scheme no other provider in this plugin uses'));
      }
      contribution.providers[named] = provider;
    },
    registerTerminals: (store, when) => { setPort('terminals', 'registerTerminals', store, when); },
    registerChanges: (source, when) => { setPort('changes', 'registerChanges', source, when); },
    registerDirectories: (facts, when) => { setPort('directories', 'registerDirectories', facts, when); },
    registerWorktrees: (worktrees, when) => { setPort('worktrees', 'registerWorktrees', worktrees, when); },
    registerGithub: (pullRequests, when) => { setPort('github', 'registerGithub', pullRequests, when); },
    registerAutomations: (store, when) => { setPort('automations', 'registerAutomations', store, when); },
    registerSessions: (store, when) => { setPort('sessions', 'registerSessions', store, when); },
    registerDiagnostics: (diagnostics, when) => { setPort('diagnostics', 'registerDiagnostics', diagnostics, when); },
    registerComputers: (computers, when) => { setPort('computers', 'registerComputers', computers, when); },
    registerContainers: (containers, when) => { setPort('containers', 'registerContainers', containers, when); },
    registerUsage: (usage, when) => { setPort('usage', 'registerUsage', usage, when); },
    registerPolicies: (policies, when) => { setPort('policies', 'registerPolicies', policies, when); },
    registerVault: (vault, when) => { setPort('vault', 'registerVault', vault, when); },
    registerRoute(handler) {
      checkRoute(handler, by);
      // A second one is refused here rather than in the fold, because only one
      // plugin is in this call and the prefix is its own: there is no collision
      // for the fold to see, there is one plugin registering two answers to the
      // same path. The message is the ports' second-registration one, because it
      // is the same mistake.
      if (contribution.routes !== undefined) {
        throw new Error(miss(by, 'registerRoute', 'handler', 'registered only once'));
      }
      contribution.routes = handler;
    },
    on(event, handle) {
      // The context is captured, not rebuilt when the event fires: it is the
      // same read-only one `apply` was handed, and the host does not otherwise
      // know every directory the daemon was told to serve.
      (events[event] ??= []).push({ by, context, handle: handle as unknown as EventHandler });
    },
  };

  return { host, contribution };
}

/**
 * Call everyone subscribed to one event, in order, and let none of them fail it.
 *
 * The one implementation of what `on` promises - registration order, each
 * handler awaited, a handler that throws reported against its plugin and the
 * rest carrying on - so the host and the daemon raise an event the same way.
 * Two copies would be two sets of semantics, and only one of them would be the
 * one `plugin-events-are-observed-not-answered` describes.
 *
 * The key is `event.type` rather than a name beside it: they were always the
 * same string, and a caller that could pass a different one is a caller that
 * can deliver a `turn_end` to whoever subscribed to `turn_start`.
 *
 * Whatever a handler returns is dropped, which is the decision and not an
 * oversight: a plugin that wants to change what happens contributes a tool, a
 * port or an agent.
 */
export async function raise<K extends EventName>(
  handlers: HostHandlers | undefined,
  event: HostEventOf<K>,
  onProblem?: (line: string) => void,
): Promise<void> {
  const listeners = handlers?.[event.type as K];
  if (listeners === undefined || listeners.length === 0) return;
  for (const listener of listeners) {
    try {
      await (listener.handle as (one: HostEvent, context: PluginContext) => void | Promise<void>)(
        event,
        listener.context,
      );
    }
    catch (error) {
      onProblem?.(`${listener.by} failed at ${event.type}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
