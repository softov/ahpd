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

import type { Agent } from '../types/agent.js';
import type { AgentOwner, ServedEngine } from '../types/agents.js';
import type { SessionConfigAnswerer } from '../types/completions.js';
import type { ServedAdapter } from '../types/connectors.js';
import type { EventHandler, EventListener, EventName, HostEvent, HostEventOf, HostHandlers } from '../types/events.js';
import type { HostOptions, HostTool, NodeRegistry } from '../types/host.js';
import type { ChannelHandle, Contribution, LoaderContext, Alert, InstallAnswer, PluginConnects, PluginContext, PluginContracts, PluginHost, PluginStarts, PluginView, SessionMetaKey, ServedBindings, ServedCanvases, ServedChannel, ServedMethod, ServedPlan, ServedSessionMeta, PluginTriggers, PortContribution, PortKey, PortOf, Route, TriggerTypeDefinition, ViewSurface } from '../types/plugin.js';
import type { CollectionOptions, RecordCollection, RecordStore } from '../types/records.js';
import type { SessionStore } from '../types/sessions.js';
import type { Usage } from '../types/usage.js';
import type { Grant, Principal } from '../types/users.js';
import type { Vault } from '../types/vault.js';
import type { Catalogs } from '../i18n.js';
import { idOf, schemeOf } from '../sessions/catalog.js';
import { frozenCopy } from '../utils/frozen.js';
import { holds } from '../access/users.js';
import { createPair } from '../utils/pair.js';
import { isRecordPath, isRecordSlug, RECORD_PATH, RECORD_SLUG } from '../resources/records.js';
import type { Pair } from '../utils/pair.js';
import { reason } from '../utils/values.js';
import { readSecret } from '../access/vault.js';
import { checkAdapter, checkAgent, checkEngine, checkChannel, checkChatRequest, checkMethod, checkPort, checkResourceProvider, checkRoute, checkScheme, checkSessionRequest, checkTool, checkTriggerType, declared, miss, reservedName, type CheckedSchema } from './validate.js';
import { checkView } from './view.js';
import { gapLine, schemaGaps } from './schemagaps.js';

/**
 * One contributed backend, as the host keeps it: the plugin's own agent with a
 * `provider` that cannot move.
 *
 * The `provider` is the id a session records, meters against and asks
 * `agentPlugins` about, and it is read from the agent at every one of those
 * points - so a plugin that renamed its agent after `apply` would have its
 * sessions metered as another backend without the fold ever seeing it. It is
 * the one property this object holds; it shadows the agent's own, and it is
 * neither writable nor configurable, which is the whole of the promise.
 *
 * A view rather than a copy, because a backend is not only its properties: an
 * agent written as a class keeps `schema`, `defaults`, `create` and the rest
 * on its prototype, and an object built from the own property descriptors
 * alone would answer `provider` and nothing else. Frozen it is not, either:
 * freezing the view freezes shadows of the plugin's own fields, and a method
 * that keeps state in `this` would then throw. The agent the plugin holds is
 * the plugin's own; what the host reads from here on is this.
 *
 * A `provider` already held by the base or another plugin never reaches here:
 * the agent that lost the id is dropped and the host keeps the backend that has
 * always answered for it.
 */
function keptAgent(agent: Agent): Agent {
  return Object.create(agent, { provider: { value: agent.provider, enumerable: true } }) as Agent;
}

/**
 * One contributed tool, as the host keeps it: a frozen copy of its definition.
 *
 * The definition is what a client is drawn and what the model is offered, and
 * `serverTools` reads it every time a session snapshot is made - so a plugin
 * that rewrote its own definition after `apply` would be changing the tools
 * every session offers. `run`, `forSession` and the rest are carried as they
 * are: a function is behaviour, and the shell it closes over is the plugin's
 * own business.
 */
function keptTool(tool: HostTool): HostTool {
  return {
    ...tool,
    definition: frozenCopy(tool.definition),
    ...(tool.effects === undefined ? {} : { effects: frozenCopy(tool.effects) }),
  };
}

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
  'github', 'automations', 'sessions', 'diagnostics', 'computers', 'containers', 'usage', 'policies', 'vault', 'records',
  'commandParser',
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
 * The trigger type names the host answers for itself.
 *
 * `session` and `watch` are listed by every host that wakes on anything, so a
 * plugin offering one would be a second definition of a name a saved automation
 * already means something by - and which of the two fired would depend on the
 * order they were registered in.
 */
export const RESERVED_TRIGGER_TYPES: readonly string[] = ['session', 'watch'];

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

/** What one plugin's preset loop is told about the entries it is reading. */
export interface EachPresetOptions {
  /** What this plugin calls one of its entries: `preset`, `variant`. */
  noun: string;
  /**
   * Whether each dropped entry is logged as well as said.
   *
   * A plugin whose load a person watches - one that a start prints as it
   * applies - has each line in the log; one whose lines are read from the
   * refusal alone does not, and would only be saying the same thing twice.
   */
  log?: boolean;
}

/**
 * One entry per preset that resolved, out of a plugin's own option values.
 *
 * `presets` is the one option whose contents a JSON Schema cannot check per
 * key: `additionalProperties` there is a yes or a no and never carries a
 * schema, so what one preset holds is checked inside `build`, which is the
 * plugin's own `presetOf`. A failure belongs to the entry it came from, so one
 * that is wrongly written, whose variable the daemon does not have or whose
 * `$secret` cannot be read is left out with one line naming it and the rest
 * register. The load fails only when nothing is left, because a daemon with no
 * agent of this kind at all is not a daemon somebody configured.
 *
 * `noun` is the plugin's own word for an entry and `log` says whether the line
 * goes to the log as well; every sentence this says is the same otherwise, so
 * two plugins cannot describe the same load two ways.
 */
export async function eachPreset<T>(
  host: PluginHost,
  name: string,
  entries: Iterable<readonly [string, unknown]>,
  build: (id: string, given: unknown) => Promise<T>,
  { noun, log }: EachPresetOptions,
): Promise<T[]> {
  const held: T[] = [];
  const dropped: string[] = [];
  for (const [id, given] of entries) {
    try {
      held.push(await build(id, given));
    }
    catch (error) {
      // Said twice where a person is watching, once where the refusal is what
      // they read: the line says why one entry went, the throw below names the
      // entries, and neither repeats the other's message.
      const line = `${name}: ${reason(error)}`;
      if (log === true) host.log(line);
      host.problem(line);
      dropped.push(id);
    }
  }
  if (held.length === 0) {
    throw new Error(dropped.length === 0
      ? `presets names no ${noun} left to register an agent for`
      : `presets names no ${noun} left to register an agent for: ${dropped.join(', ')}`);
  }
  return held;
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
   * The ids of the records this fold served, in the order they were given.
   *
   * A record whose id the daemon or a plugin already serves is dropped and is
   * not here, so a channel can tell a record the host runs from one it holds
   * and cannot. Empty when no record was given.
   */
  records: string[];
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
 * The host's own trigger entry for each contribution, kept across folds.
 *
 * The host writes `deliver` and `run` on that entry, and the plugin's own
 * `fireTrigger` reads it back through the contribution for as long as the
 * plugin is loaded. An entry built again at the next fold would be one nothing
 * has set those on, so a fire would reach nothing - and a fold is made more
 * than once: a live change folds, and the daemon reads the fold again to report
 * what it holds. Keyed by the contribution, so a plugin loaded again starts
 * with an entry of its own.
 */
const triggerEntries = new WeakMap<Contribution, PluginTriggers>();

/**
 * Fold contributions into a base `HostOptions`.
 *
 * The rules, made literal:
 *
 * - `agents` and `tools` append, in contribution order, and the agents made
 *   from stored records append after them. A `provider` already registered -
 *   by the base, by an earlier plugin or by an earlier record - is a problem
 *   naming both, and the agent that lost it is dropped: the first registration
 *   keeps the id, and a client that asks for it gets the backend that has
 *   always answered for it rather than whichever loaded last.
 * - A port is set once. A later contribution that lands on a value already
 *   there - the daemon's or another plugin's - is a problem naming both and
 *   the value does not move, unless the later one carries `'replace'`, which
 *   takes it over silently.
 * - A port the base does not have is set by the first plugin that offers one,
 *   with no `'replace'` needed.
 * - A route is kept under the plugin's own name and is never moved: one handler
 *   per plugin, under that plugin's own prefix, so there is nothing for two of
 *   them to collide on.
 * - A close function is kept, never composed: every registration runs, in load
 *   order, and there is nothing for two of them to collide on.
 * - A plugin's own connections to the host are carried through whole, one entry
 *   per plugin: the daemon binds the host onto each and closes them when it
 *   stops, so the fold neither composes them nor reads them.
 */
export function foldHostOptions(base: HostOptions, contributions: Contribution[], records: readonly Agent[] = []): FoldedOptions {
  const problems: string[] = [];
  /*
   * From the base's own property descriptors, rather than a spread.
   *
   * `{ ...base }` reads each getter once and keeps the value it answered, so a
   * base that holds one - the daemon's `mcpServers`, which root config
   * replaces while the daemon runs - would be fixed at whatever it held when
   * the fold ran, and a later edit would never reach a session. The
   * descriptors keep a getter a getter.
   */
  const options: HostOptions = Object.defineProperties({}, Object.getOwnPropertyDescriptors(base)) as HostOptions;
  options.agents = [...base.agents];

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
  /*
   * The same harnesses in lowercase, because a harness names its session
   * channels and a channel scheme is compared in lowercase. A scheme and a
   * harness cannot share a name: one would answer for the other's URIs.
   */
  const harnesses = new Map<string, string>();
  for (const agent of base.agents) harnesses.set(agent.provider.toLowerCase(), 'the daemon');
  const added: Agent[] = [];
  /** The ids of the record agents this fold took, in the order they were given. */
  const served: string[] = [];
  /*
   * The plugin each added agent came from, by provider. Seeded from the
   * base's record, and an agent the base was handed directly has none.
   */
  const plugins: Record<string, string> = { ...base.agentPlugins };
  /** The catalogs of the plugin each added agent came from, by provider. */
  const agentCatalogs: Record<string, Catalogs> = { ...base.catalogs?.agents };

  /*
   * The URI schemes, and who holds each. Seeded from the base for the same
   * reason the ports are: a plugin that registers a scheme the host was
   * already given is told, rather than winning by order.
   */
  type Schemes = NonNullable<HostOptions['resourceProviders']>;
  const schemes = new Map<string, string>();
  for (const scheme of Object.keys(base.resourceProviders ?? {})) schemes.set(scheme.toLowerCase(), 'the daemon');
  const resourceProviders: Schemes = { ...base.resourceProviders };
  /*
   * The plugin channels, by scheme. Seeded from the base, as the resource
   * schemes are, so a plugin is told when the host already serves one.
   */
  const channels: Record<string, ServedChannel> = { ...base.channels };
  /*
   * The adapters, by name, and the plugin each belongs to. Seeded from the
   * base for the same reason the channels are: a plugin that offers a name the
   * daemon already does is told, rather than winning by load order.
   */
  const adapters: Record<string, ServedAdapter> = { ...base.adapters };
  const adapterHolders = new Map<string, string>();
  for (const [name, adapter] of Object.entries(base.adapters ?? {})) adapterHolders.set(name, adapter.by);
  /*
   * The one Plan call a turn shows, and who draws it.
   *
   * A turn holds one call, so a second registration is a collision and is
   * reported: the first keeps the call and the second draws nothing.
   */
  let plan: ServedPlan | undefined = base.plan;
  let planBy = base.plan === undefined ? undefined : 'the daemon';
  /*
   * The keys plugins add to a session's `_meta`, and who adds each.
   *
   * Seeded from the base for the same reason the ports are, and one key has one
   * producer: a second one is a collision and is reported, because
   * `session/metaChanged` carries the map whole and two producers of one key
   * would overwrite each other.
   */
  const sessionMeta: ServedSessionMeta[] = [...(base.sessionMeta ?? [])];
  const metaKeys = new Map<string, string>();
  for (const served of base.sessionMeta ?? []) {
    for (const one of served.keys) metaKeys.set(one.key, 'the daemon');
  }
  /*
   * The bindings each plugin answers, one reader per plugin.
   *
   * Seeded from the base for the same reason the ports are. Two plugins may
   * both answer, because a binding is about a session and two plugins may
   * answer for different ones; an alias they both name is the session's to
   * settle, and the session key wins it.
   */
  const bindings: ServedBindings[] = [...(base.bindings ?? [])];
  /*
   * The served commands, by name, and who holds each. Seeded from the base, so
   * a plugin is told when the daemon already serves one.
   */
  const methods: Record<string, ServedMethod> = { ...base.methods };
  const commands = new Map<string, string>();
  for (const name of Object.keys(base.methods ?? {})) commands.set(name, 'the daemon');

  for (const contribution of contributions) {
    for (const agent of contribution.agents) {
      const held = providers.get(agent.provider);
      const scheme = schemes.get(agent.provider.toLowerCase());
      if (held === undefined && scheme !== undefined) {
        problems.push(`plugin ${contribution.by} registers agent ${agent.provider}, which ${scheme === 'the daemon' ? 'the daemon' : `plugin ${scheme}`} already registered as a scheme`);
        continue;
      }
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
        problems.push(`${AGENT_CLASH} plugin ${contribution.by} registers agent ${agent.provider}, which ${held === 'the daemon' ? 'the daemon' : `plugin ${held}`} already registered; run ahpd configure to keep one`);
        continue;
      }
      providers.set(agent.provider, contribution.by);
      harnesses.set(agent.provider.toLowerCase(), contribution.by);
      added.push(keptAgent(agent));
      plugins[agent.provider] = contribution.spec ?? contribution.by;
      if (contribution.i18n !== undefined) agentCatalogs[agent.provider] = contribution.i18n;
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
      const held = schemes.get(scheme.toLowerCase());
      const harness = harnesses.get(scheme.toLowerCase());
      if (held === undefined && harness !== undefined) {
        problems.push(`plugin ${contribution.by} registers scheme ${scheme}, which ${harness === 'the daemon' ? 'the daemon' : `plugin ${harness}`} already registered as an agent`);
        continue;
      }
      if (held !== undefined) {
        problems.push(`plugin ${contribution.by} registers scheme ${scheme}, which ${held === 'the daemon' ? 'the daemon' : `plugin ${held}`} already registered`);
        continue;
      }
      schemes.set(scheme.toLowerCase(), contribution.by);
      resourceProviders[scheme] = provider as Schemes[string];
    }

    for (const [scheme, served] of Object.entries(contribution.channels)) {
      const held = channels[scheme];
      if (held !== undefined) {
        problems.push(`plugin ${contribution.by} registers channel ${scheme}, which plugin ${held.by} already registered`);
        continue;
      }
      channels[scheme] = served;
    }

    for (const [name, adapter] of Object.entries(contribution.adapters)) {
      const held = adapterHolders.get(name);
      if (held !== undefined) {
        problems.push(`plugin ${contribution.by} registers adapter ${name}, which ${held === 'the daemon' ? 'the daemon' : `plugin ${held}`} already registered`);
        continue;
      }
      adapterHolders.set(name, contribution.by);
      adapters[name] = adapter;
    }

    for (const [name, served] of Object.entries(contribution.methods)) {
      const held = commands.get(name);
      if (held !== undefined) {
        problems.push(`plugin ${contribution.by} registers method ${name}, which ${held === 'the daemon' ? 'the daemon' : `plugin ${held}`} already serves`);
        continue;
      }
      commands.set(name, contribution.by);
      methods[name] = served;
    }

    if (contribution.plan !== undefined) {
      if (plan !== undefined) {
        problems.push(`plugin ${contribution.by} registers a plan, which ${planBy === 'the daemon' ? 'the daemon' : `plugin ${planBy}`} already draws`);
        continue;
      }
      plan = contribution.plan;
      planBy = contribution.by;
    }

    if (contribution.sessionMeta !== undefined) {
      const held: SessionMetaKey[] = [];
      for (const one of contribution.sessionMeta.keys) {
        const ownerOfKey = metaKeys.get(one.key);
        if (ownerOfKey !== undefined) {
          problems.push(`plugin ${contribution.by} adds _meta key ${one.key}, which ${ownerOfKey === 'the daemon' ? 'the daemon' : `plugin ${ownerOfKey}`} already adds`);
          continue;
        }
        metaKeys.set(one.key, contribution.by);
        held.push(one);
      }
      if (held.length > 0) {
        /*
         * The same object the plugin holds, with the keys that collided taken
         * out of it: the host sets `changed` on this object when it is built,
         * and the plugin announces through it, so a copy would leave the
         * announcement with nowhere to go.
         */
        contribution.sessionMeta.keys = held;
        sessionMeta.push(contribution.sessionMeta);
      }
    }

    // One reader per plugin, and every plugin's is kept: the plugin host
    // refuses a second one from the same plugin, so there is nothing to
    // arbitrate here.
    if (contribution.bindings !== undefined) bindings.push(contribution.bindings);
  }

  /*
   * The engines, keyed by name and never merged over one another.
   *
   * A kind names one form and one `open`, so two plugins offering one name is a
   * collision: it is reported, and the first registration keeps it. Seeded from
   * the base for the same reason the adapters are.
   */
  const engines: Record<string, ServedEngine> = { ...base.engines };
  for (const contribution of contributions) {
    for (const [name, engine] of Object.entries(contribution.engines ?? {})) {
      const held = engines[name];
      if (held !== undefined) {
        problems.push(`plugin ${contribution.by} registers engine ${name}, which ${held.by === 'the daemon' ? 'the daemon' : `plugin ${held.by}`} already registered`);
        continue;
      }
      engines[name] = engine;
    }
  }
  if (Object.keys(engines).length > 0) options.engines = engines;

  /*
   * The agents made from records, after the plugins' own.
   *
   * A record is one person's agent, so an id the daemon or a plugin already
   * serves is reported and the record is not served: a provider names one
   * backend, and a record may not take the id of one written in code. The
   * record stays on disk and is listed as `invalid`, the way a connector of a
   * missing adapter stays and is listed `unavailable`.
   */
  for (const agent of records) {
    const held = providers.get(agent.provider);
    const scheme = schemes.get(agent.provider.toLowerCase());
    if (held === undefined && scheme !== undefined) {
      problems.push(`the agent record ${agent.provider} is not served: ${scheme === 'the daemon' ? 'the daemon' : `plugin ${scheme}`} already registered that id as a scheme`);
      continue;
    }
    if (held !== undefined) {
      problems.push(`the agent record ${agent.provider} is not served: ${held === 'the daemon' ? 'the daemon' : `plugin ${held}`} already serves that id`);
      continue;
    }
    providers.set(agent.provider, 'a record');
    harnesses.set(agent.provider.toLowerCase(), 'a record');
    added.push(keptAgent(agent));
    served.push(agent.provider);
  }

  if (added.length > 0) options.agents = [...options.agents, ...added];
  if (Object.keys(plugins).length > 0) options.agentPlugins = plugins;

  const tools = [
    ...(base.tools ?? []),
    ...contributions.flatMap((contribution) => contribution.tools.map(keptTool)),
  ];
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
   * setting a backend already owns.
   */
  const sessionConfig: Record<string, Record<string, unknown>> = { ...base.sessionConfig };
  const sessionCompletions: Record<string, SessionConfigAnswerer> = { ...base.sessionConfigCompletions };
  const holders = new Map<string, string>();
  for (const key of Object.keys(sessionConfig)) holders.set(key, 'the host');
  /** The catalogs of the plugin that registered each session setting, by key. */
  const keyCatalogs: Record<string, Catalogs> = { ...base.catalogs?.sessionConfig };
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
      if (contribution.i18n !== undefined) keyCatalogs[key] = contribution.i18n;
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
      /*
       * A frozen copy, because this is what a client draws the control from and
       * what a backend is handed on `Start`: a plugin that rewrote its own
       * property schema after `apply` would be redrawing every session's form.
       */
      sessionConfig[key] = frozenCopy(answerer === undefined ? schema : { ...schema, enumDynamic: true });
      if (answerer !== undefined) sessionCompletions[key] = answerer;
    }
  }
  if (Object.keys(sessionConfig).length > 0) options.sessionConfig = sessionConfig;
  if (Object.keys(sessionCompletions).length > 0) options.sessionConfigCompletions = sessionCompletions;
  if (Object.keys(keyCatalogs).length > 0 || Object.keys(agentCatalogs).length > 0) {
    options.catalogs = {
      ...(Object.keys(keyCatalogs).length === 0 ? {} : { sessionConfig: keyCatalogs }),
      ...(Object.keys(agentCatalogs).length === 0 ? {} : { agents: agentCatalogs }),
    };
  }

  if (Object.keys(resourceProviders).length > 0) options.resourceProviders = resourceProviders;
  if (Object.keys(channels).length > 0) options.channels = channels;
  if (Object.keys(adapters).length > 0) options.adapters = adapters;
  if (Object.keys(methods).length > 0) options.methods = methods;
  if (plan !== undefined) options.plan = plan;
  if (sessionMeta.length > 0) options.sessionMeta = sessionMeta;
  if (bindings.length > 0) options.bindings = bindings;

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

  /*
   * The close functions, the base's first and then each plugin's, in the order
   * the plugins were configured.
   *
   * A registration of one plugin runs after the one before it, and the plugin
   * that registered each is carried beside it, so a closer that fails is
   * logged against the plugin that owns the work it was stopping. A host with
   * none keeps `closers` absent rather than carrying an empty list.
   */
  const closers = [
    ...(base.closers ?? []),
    ...contributions.flatMap((contribution) => contribution.closers.map((close) => ({ by: contribution.by, close }))),
  ];
  if (closers.length > 0) options.closers = closers;

  /*
   * The trigger types the plugins offer, one entry per plugin that offered one.
   *
   * A name is held by whoever registered it first, and a second plugin offering
   * the same one is reported and loses that type alone: a saved trigger names
   * its type by string, so two definitions of one name would be a trigger
   * nothing could choose between, and the plugin that lost keeps everything
   * else it contributed - the rule a duplicate agent `provider` follows.
   *
   * The entry is the host's own object and not the `PluginTriggers` a plugin
   * registered in: it holds a frozen copy of every definition that plugin may
   * still fire, and it is the one place `deliver` is written. The contribution
   * is pointed at it, which is what the plugin's own `fireTrigger` reads, so a
   * plugin that adds a name to the record it registered in fires something the
   * host never arbitrated and nothing the host holds moves. It is the same
   * object at every fold, because the host writes on it once.
   */
  const typeHolders = new Map<string, string>();
  /**
   * This contribution's entry, with the types this fold arbitrated.
   *
   * The object is the one an earlier fold made, so `deliver` and `run` set on
   * it by the host survive a second fold. Only the types move, which is what a
   * contribution loaded or unloaded changes.
   */
  const keptEntry = (contribution: Contribution, types: Record<string, TriggerTypeDefinition>): PluginTriggers => {
    const entry = triggerEntries.get(contribution) ?? { by: contribution.by, types };
    entry.types = types;
    triggerEntries.set(contribution, entry);
    return entry;
  };
  const pluginTriggers: PluginTriggers[] = [];
  for (const contribution of contributions) {
    if (Object.keys(contribution.triggers.types).length === 0) continue;
    const kept: Record<string, TriggerTypeDefinition> = {};
    for (const [name, definition] of Object.entries(contribution.triggers.types)) {
      const owner = typeHolders.get(name);
      if (owner !== undefined) {
        problems.push(`plugin ${contribution.by} registers trigger type ${name}, which plugin ${owner} already registered`);
        continue;
      }
      typeHolders.set(name, contribution.by);
      kept[name] = frozenCopy(definition);
    }
    if (Object.keys(kept).length === 0) {
      /*
       * Every name this plugin offered is held by another. It is pointed at an
       * empty entry of the host's own all the same, and not left holding the
       * record it registered in: `fireTrigger` reads the type from here, so a
       * plugin left with its own record would still find the name it lost and
       * fire an event nothing is listening for - where this host's answer, to
       * this plugin, is that it holds no such type.
       *
       * Empty entries are not offered: `pluginTriggers` is the host's list of
       * the types it will arbitrate, and this plugin arbitrates none.
       */
      contribution.triggers = keptEntry(contribution, Object.freeze({}));
      continue;
    }
    contribution.triggers = keptEntry(contribution, Object.freeze(kept));
    pluginTriggers.push(contribution.triggers);
  }
  if (pluginTriggers.length > 0) options.pluginTriggers = pluginTriggers;

  /*
   * Every plugin's way of starting a session, one entry each.
   *
   * Unconditional and unnamed, unlike the trigger types: asking for a session
   * is not a claim on a name two plugins could disagree about, so there is
   * nothing to arbitrate and no entry to drop. The objects are the ones
   * `pluginHost` built and not copies, because the host sets `start` on them and
   * each plugin's own `startSession` holds the same one.
   */
  const pluginStarts = contributions.map((one) => one.starts);
  if (pluginStarts.length > 0) options.pluginStarts = pluginStarts;

  /*
   * Every plugin's own way into this host, one entry each.
   *
   * Unconditional and unnamed, exactly as `pluginStarts` is: connecting is not
   * a claim on a name two plugins could disagree about, so there is nothing to
   * arbitrate and no entry to drop. The objects are the ones `pluginHost` built
   * and not copies, because the daemon sets `host` on them and each plugin's own
   * `connect` reads the same one - and the same entries are what it closes when
   * it stops.
   */
  const pluginConnects = contributions.map((one) => one.connects);
  if (pluginConnects.length > 0) options.pluginConnects = pluginConnects;

  /*
   * Every plugin's canvases, one entry each, for the reason `pluginConnects` is
   * one entry each: a canvas is the plugin's own, and two plugins may draw
   * different ones on the same chat. The objects are the ones `pluginHost`
   * built and not copies, because the host sets the calls on them and each
   * plugin's own `openCanvas` reaches the same store.
   */
  const pluginCanvases = contributions.map((one) => one.canvases);
  if (pluginCanvases.length > 0) options.pluginCanvases = pluginCanvases;

  /*
   * Every plugin's chat preambles, in plugin order and then registration order.
   *
   * Unnamed like `pluginConnects`: two plugins may both give a new chat text,
   * and the host joins the answers rather than choosing one.
   */
  const chatPreambles = contributions.flatMap((one) => one.preambles);
  if (chatPreambles.length > 0) options.chatPreambles = chatPreambles;

  return { options, problems, routes, records: served };
}

/** What one `apply` is handed, and what it recorded. */
export interface HostRecording {
  /** The surface a plugin calls `register*` on. */
  host: PluginHost;
  /** Everything it registered, kept apart until the fold sees it. */
  contribution: Contribution;
  /**
   * Close registration, once `apply` has returned.
   *
   * A plugin's registrations are read by the fold, so one made afterwards
   * changes what the host holds without the fold having seen it - a trigger type
   * arbitrated against nobody, a scheme served under a name another plugin also
   * took. The loader calls this the moment `apply` settles, and every
   * `register*` after it throws the same sentence.
   */
  seal(): void;
}

/** What a plugin calls for YAML on a host whose loader gave none. */
const noYaml = (): never => {
  throw new Error('no YAML on this host');
};

/** What a plugin host is given besides its context. */
export interface HostRecordingOptions {
  /**
   * What configuration named this plugin by, a package or a path, kept on the
   * contribution so the host can record it against each agent it registers.
   */
  spec?: string;
  /** The catalogs the plugin ships, kept on the contribution for the fold. */
  i18n?: Catalogs;
  /**
   * Every agent this host knows, read when `machineNeeds` is called.
   *
   * A function rather than a list because the list is not complete while
   * plugins are being applied: the plugin that registers an agent may load
   * after the one that makes machines, and a machine is made long after both.
   */
  agents?: () => Agent[];
  /**
   * Whose each stored agent is, read when `agentOwners` is called.
   *
   * A function for the same reason `agents` is: the records are folded while
   * the daemon runs, and a plugin keeping a record that names an agent asks at
   * each use rather than once at load.
   */
  agentOwners?: () => ReadonlyMap<string, AgentOwner | undefined>;
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
   * Where an `alert` goes, for the daemon to serve on the plugin's row.
   *
   * Collected rather than written, because the person who has to read it is the
   * one looking at the plugin's page and the daemon is what that page reads
   * from. A loader in a test may give none, and the alert is then dropped.
   */
  alert?: (alert: Alert) => void;
  /**
   * Where a `clearAlert` goes, for the daemon to work on the same alerts.
   *
   * Beside `alert` and for the same reason; a host with no sink drops it too.
   */
  clearAlert?: (ref: string) => void;
  /**
   * Where a `showView` goes, for the daemon to serve on the plugin's row.
   *
   * Collected rather than written, for the reason `alert` is: the person who
   * reads a view is looking at the plugin's page, and the daemon is what that
   * page reads from. A loader in a test may give none, and the view is then
   * checked and dropped.
   */
  showView?: (surface: ViewSurface, view: PluginView) => void;
  /**
   * Where a `clearView` goes, for the daemon to serve the row without one.
   *
   * Beside `showView` and for the same reason; a host with no sink drops it.
   */
  clearView?: (surface: ViewSurface) => void;
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
  /**
   * Where this plugin's collections are, read when a collection is first used.
   *
   * A function that may answer late, for the reason `sessions` may: the fold
   * that names the port runs after every plugin has applied, so a collection
   * opened while `apply` runs waits for it rather than being told there is no
   * store.
   */
  records?: () => RecordStore | undefined | Promise<RecordStore | undefined>;
  /**
   * Which plugin opened each collection, by name.
   *
   * One map shared by every plugin a loader applies, so a name that another
   * plugin opened is refused. Absent, this plugin gets a map of its own.
   */
  collections?: Map<string, string>;
  /**
   * What this plugin's own connection may do, from its configuration entry.
   *
   * Already checked by whoever read the entry, which is the loader: what it
   * drops is reported in its `problems` naming the key it was written under,
   * so nothing here has a second place to say the same thing. Absent, the
   * connection holds nothing and every gated command it sends is refused.
   */
  grants?: readonly Grant[];
  /**
   * What the plugin's manifest declares it registers, by kind.
   *
   * Absent for a plugin that declares none, which is every plugin written
   * before manifests had contracts: nothing is checked and it registers what
   * it always could. A list here is closed - a register method refuses a name
   * that is not in its kind's list - so a plugin says what a client will see
   * it add.
   */
  contracts?: PluginContracts;
  /**
   * Where a package a plugin installs is kept, handed to `host.installed`.
   *
   * The absolute path of `installed/` inside the plugin's own folder. Absent
   * for a plugin with no folder, which is a plugin `install` cannot serve.
   */
  installed?: string;
  /**
   * How one package is installed, read when `install` is called.
   *
   * A function rather than a value because the install runs in the daemon and
   * a plugin is handed none: a loader in a test gives a fake, and a host with
   * no folder gives nothing at all.
   */
  install?: (spec: string) => Promise<InstallAnswer>;
  /**
   * The hosts that joined this one, handed through as `host.nodes`.
   *
   * A value rather than a function because the registry belongs to the daemon
   * and is one object for its whole life: a node joining or leaving is the
   * registry's own event, not a port another plugin may register.
   */
  nodes?: NodeRegistry;
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
export function pluginHost(by: string, given: LoaderContext, options: HostRecordingOptions = {}): HostRecording {
  /*
   * The context as the plugin sees it. A loader that gives no YAML functions
   * gives two that throw, so a plugin that reads YAML on that host is told why.
   */
  const context: PluginContext = given.parseYaml !== undefined && given.stringifyYaml !== undefined
    ? given as PluginContext
    : { ...given, parseYaml: given.parseYaml ?? noYaml, stringifyYaml: given.stringifyYaml ?? noYaml };
  /*
   * The listeners, keyed by event. Held as a loose record and narrowed to
   * `HostHandlers` through the contribution, because the mapped type gives
   * each event its own listener type and a generic `on` writes one key at a
   * time.
   */
  const events: Record<string, EventListener[]> = {};
  const triggers: PluginTriggers = { by, types: {} };
  const starts: PluginStarts = { by };
  /*
   * The connections this plugin has open, in the order it opened them.
   *
   * Held here rather than on the picked-up `PluginConnects`, which is what the
   * daemon binds and closes: this is the plain list of what is open, and the
   * close is a closure over it rather than a field any reader could rewrite.
   */
  const opened: Pair[] = [];
  const connects: PluginConnects = {
    by,
    close: () => { for (const pair of opened.splice(0)) pair.close(); },
  };
  /*
   * The canvases this plugin opens, and the closer that takes them away.
   *
   * The host fills `open`, `update`, `close` and `closeAll` in once it is built
   * over this plugin. The closer is pushed the first time the plugin opens a
   * canvas rather than registered by the plugin, because it is the host's own
   * road: a canvas belongs to the plugin that opened it, and one left open when
   * that plugin unloads names a URL nothing answers any more. A plugin that
   * opens none contributes no closer, as a plugin with nothing to stop
   * registers none.
   */
  const canvases: ServedCanvases = { by };
  /** Whether the unload closer is already on the list, so one plugin has one. */
  let closerPushed = false;
  /*
   * Who this plugin is when it connects, which is what every command on that
   * connection is gated against.
   *
   * `plugin:<name>` and not a person: a plugin is nobody's account, so it has
   * no roles, no memberships and no primary, and the work it starts is charged
   * to no team. What it may do is the `grants` its configuration entry names,
   * matched the way a role's are - so a wildcard means what it means everywhere
   * else and a grant naming nothing else's scheme reaches nothing else.
   *
   * Frozen where it is built, as every principal this host serves is: it
   * reaches the gate, a policy and a scheme's own methods, and one of them
   * rewriting `can` would decide what the next question is answered with.
   */
  const principal: Principal = Object.freeze({
    id: `plugin:${by}`,
    plugin: by,
    roles: Object.freeze([]),
    grants: Object.freeze([...(options.grants ?? [])]),
    can: (grant: Grant) => holds(new Set(options.grants ?? []), grant),
  });
  /*
   * The same question, reachable from the session request a plugin makes.
   *
   * A request does not arrive on the plugin's connection, so nothing there
   * gates it; `can` is the one answer to what the entry grants, put where the
   * host's session road reads it - which is where `session:trust` is asked
   * about.
   */
  starts.can = principal.can;
  const contribution: Contribution = {
    by,
    ...(options.spec === undefined ? {} : { spec: options.spec }),
    ...(options.i18n === undefined ? {} : { i18n: options.i18n }),
    agents: [],
    tools: [],
    sessionConfig: {},
    sessionCompletions: {},
    ports: {},
    providers: {},
    channels: {},
    adapters: {},
    engines: {},
    methods: {},
    events: events as unknown as HostHandlers,
    closers: [],
    triggers,
    starts,
    connects,
    canvases,
    preambles: [],
  };
  const providers = new Set<string>();
  const tools = new Set<string>();
  const sessionKeys = new Set<string>();

  /*
   * Whether `apply` has returned.
   *
   * Everything a plugin registers is read once, by the fold, so a registration
   * made after that reads as one nothing arbitrated: two plugins could both
   * claim a trigger type name and the second would simply be there, or a scheme
   * could be served under a name another plugin already holds. The sentence is
   * the same for every method, because the mistake is the same one.
   */
  let sealed = false;
  const open = (): void => {
    if (sealed) {
      throw new Error(`plugin ${by}: nothing may be registered after apply returned; the host has already taken its copy of what this plugin contributed`);
    }
  };

  /**
   * Each schema gap a registration found, as the problem line it is.
   *
   * A problem and never a refusal: a plugin whose form has a hole still loads,
   * and names the path a client could not draw so its author can fill it in.
   * The line reaches the same alert sink a plugin's own `problem` does.
   */
  const reportGaps = (checked: CheckedSchema[]): void => {
    for (const one of checked) {
      for (const gap of one.gaps) options.alert?.({ level: 'warning', text: gapLine(by, one.where, gap) });
    }
  };

  const setPort = <K extends PortKey>(key: K, method: string, value: PortOf<K>, when?: 'replace'): void => {
    open();
    declared(by, options.contracts, 'ports', key);
    checkPort(key, value, by);
    if (contribution.ports[key] !== undefined) {
      throw new Error(miss(by, method, key, 'registered only once'));
    }
    contribution.ports[key] = { value, replace: when === 'replace' };
  };

  const claims = options.collections ?? new Map<string, string>();

  /*
   * One collection whose calls wait for the fold to name the port.
   *
   * The store's own collection is opened on the first call and kept. A call
   * that finds no port throws, and the next call asks again.
   */
  const collection = (name: string, wanted: CollectionOptions): RecordCollection => {
    let ready: Promise<RecordCollection> | undefined;
    const opened = (): Promise<RecordCollection> => {
      if (ready !== undefined) return ready;
      const pending = (async () => {
        const store = await options.records?.();
        if (store === undefined) throw new Error(`records ${name} cannot be read: this host has no record store`);
        return store.collection(name, wanted);
      })();
      ready = pending;
      pending.then(undefined, () => { if (ready === pending) ready = undefined; });
      return pending;
    };
    return {
      get: async (id) => (await opened()).get(id),
      list: async () => (await opened()).list(),
      find: async (match) => (await opened()).find(match),
      put: async (record) => (await opened()).put(record),
      remove: async (id) => (await opened()).remove(id),
      /*
       * Answers its stop at once, and starts the store's own watch when the
       * collection opens. A collection that cannot open is logged, because
       * there is no call to throw from.
       */
      watch: (onChange) => {
        let stop: (() => void) | undefined;
        let stopped = false;
        opened().then(
          (one) => { if (!stopped) stop = one.watch(onChange); },
          (error: unknown) => { context.log(`plugin ${by}: records ${name} cannot be watched: ${reason(error)}`); },
        );
        return () => {
          stopped = true;
          stop?.();
          stop = undefined;
        };
      },
    };
  };

  const host: PluginHost = {
    ...context,
    alert: (alert) => { options.alert?.(alert); },
    clearAlert: (ref) => { options.clearAlert?.(ref); },
    /*
     * A view is checked before it is kept, and the check is the sdk's: a plugin
     * may be JavaScript, and a view is the one thing a client draws from it.
     * The surface is the call's own default, and the check refuses a name no
     * client has a place for.
     */
    showView: (view, surface = 'main') => {
      // A copy, so the view kept is the one checked: the plugin may change its
      // own object later, and the row would follow it unchecked and unsaid.
      let kept: PluginView;
      try {
        kept = structuredClone(view);
      }
      catch {
        throw new Error(`plugin ${by}: showView needs the view to be JSON`);
      }
      checkView(kept, surface, by, contribution.methods);
      options.showView?.(surface, kept);
    },
    clearView: (surface = 'main') => {
      if (surface !== 'main') {
        throw new Error(`plugin ${by}: clearView needs the surface to be main, the one surface a client draws`);
      }
      options.clearView?.(surface);
    },
    // A problem is one kind of alert - a warning about an item the plugin went
    // without - so a plugin that says one today needs no change to say it.
    problem: (line) => { options.alert?.({ level: 'warning', text: line }); },
    /*
     * A host with no folder of its own answers an error rather than throwing:
     * a plugin that installs a missing package is asking for something this
     * host cannot do, and the answer is where the plugin says why. The plugin
     * name is in the line, because the plugin did not write the folder and the
     * reader of the alert did not write the name.
     */
    ...(options.installed === undefined ? {} : { installed: options.installed }),
    install: async (spec) => {
      if (typeof spec !== 'string' || spec.trim() === '') {
        return { error: `plugin ${by} cannot install: install needs a package name` };
      }
      if (options.install === undefined) {
        return { error: `plugin ${by} has no folder of its own to install into` };
      }
      return await options.install(spec);
    },
    // Read from the live list, not a snapshot: the agents this host will have
    // are not all known while any one plugin is applying. An agent that
    // declares nothing answers an empty record, which is a machine with
    // nothing added to it rather than a provider nobody has.
    machineNeeds: (provider) => {
      const agent = options.agents?.().find((one) => one.provider === provider);
      return agent === undefined ? undefined : agent.machine?.() ?? {};
    },
    // Empty rather than absent on a host with no agents channel: every agent
    // there is the daemon's own, which is what a map with no entry says.
    agentOwners: () => options.agentOwners?.() ?? new Map(),
    // Absent rather than empty on a host no node joined: a plugin asks whether
    // there is a registry before it offers a machine from one.
    ...(options.nodes === undefined ? {} : { nodes: options.nodes }),
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
     * The store is keyed by id and keeps the name the host holds the session
     * under, so a machine's recorded URI is compared with that name. `false`
     * rather than a throw when there is no store, the way `recordUsage` drops:
     * a host that keeps no sessions has no leftovers of its own to adopt, which
     * is an answer and not a failure.
     *
     * Awaited because a plugin can ask before the host it is being applied to
     * has named its store, and the answer has to be the same whatever else is
     * still loading.
     */
    sessionKept: async (uri) => {
      const sessions = await options.sessions?.();
      if (sessions === undefined || sessions.config(idOf(uri)) === undefined) return false;
      /*
       * The URI has to be the name this host holds the session under.
       *
       * A session id comes from the client's channel, so a client that opens
       * `echo:/one` after a session named `acp:/one` has gone writes the same
       * row, and a leftover labelled for that id would be adopted as though it
       * were a session of this kind - a machine with another backend's needs
       * charged to a session that cannot run in it.
       *
       * A row written before names were kept has no name, and is compared with
       * the provider as it was: the scheme was the name then, and a machine
       * made for that session records it.
       */
      const held = sessions.uri?.(idOf(uri));
      return held === undefined
        ? sessions.provider(idOf(uri)) === schemeOf(uri)
        : held === uri;
    },
    /*
     * Whose a session is, asked of the same store `sessionKept` reads and
     * awaited for the same reason. Nothing where this host keeps no sessions
     * and nothing where it has never opened this one, which are the two
     * answers a plugin linking somebody else's session has to tell apart.
     *
     * A row is not a session, though, and the store keeps one for longer than
     * the session lasts: a process that ran no turn leaves nothing on a
     * backend's disk, so after a restart the row is all there is and the host
     * answers `No agent for session` to a subscribe. The owner is therefore
     * answered only where the host can still open the session, which is the
     * question `opens` asks of the live catalogue - so a plugin reusing a
     * session starts a new one instead of sending to the one that is gone.
     *
     * With no host built over this plugin there is no catalogue to ask, and
     * the store's answer is the whole of what is known: a host handed to a
     * test rather than folded into one behaves as it always did.
     */
    sessionOwner: async (uri) => {
      const sessions = await options.sessions?.();
      const owner = sessions?.owner(idOf(uri));
      if (owner === undefined || starts.opens === undefined) return owner;
      return await starts.opens(uri) ? owner : undefined;
    },
    /*
     * Not a registration, so it is not refused after `apply` returned. The
     * claim is made here rather than in the fold, because a plugin may open a
     * collection after the fold has run.
     */
    records(name, wanted) {
      if (typeof name !== 'string' || !isRecordPath(name)) {
        throw new Error(miss(by, 'records', String(name), `one to three slugs joined by /, ${RECORD_PATH}`));
      }
      if (wanted !== undefined && (typeof wanted !== 'object' || wanted === null || Array.isArray(wanted))) {
        throw new Error(miss(by, 'records', name, 'opened with an options object, or with nothing'));
      }
      if (wanted?.body !== undefined && typeof wanted.body !== 'string') {
        throw new Error(miss(by, 'records', 'body', 'a field name, or nothing'));
      }
      if (wanted?.file !== undefined && (typeof wanted.file !== 'string' || !isRecordSlug(wanted.file))) {
        throw new Error(miss(by, 'records', String(wanted.file), `a file name, ${RECORD_SLUG}, or nothing`));
      }
      /*
       * The claim is on the first slug: a plugin that opens `bots` owns every
       * path under it, so the collections one bot's data is kept in are the
       * folder owner's to open and nobody else's.
       */
      const first = name.split('/')[0] ?? name;
      const held = claims.get(first);
      if (held !== undefined && held !== by) {
        throw new Error(miss(by, 'records', name, `a collection no other plugin opened; plugin ${held} opened it`));
      }
      claims.set(first, by);
      return collection(name, {
        ...(wanted?.body === undefined ? {} : { body: wanted.body }),
        ...(wanted?.file === undefined ? {} : { file: wanted.file }),
      });
    },
    /*
     * Checked here and started there.
     *
     * A plugin's request is the one value on this road that has not been
     * through a type, so it is checked at this boundary the way every
     * registration is - and then handed to the host's own road, which is the
     * same one a run takes. Asked while `apply` runs there is no host yet, and
     * a call that owes an answer is told rather than dropped.
     *
     * `named` is passed through rather than called here: the host calls it with
     * the URI once it has named the session, which is before anything is made.
     */
    startSession(wanted, named) {
      const asked = checkSessionRequest(wanted, by);
      const start = starts.start;
      if (start === undefined) {
        throw new Error(miss(by, 'startSession', 'the session', 'asked for once a host is built over this plugin'));
      }
      if (named !== undefined && typeof named !== 'function') {
        throw new Error(miss(by, 'startSession', 'the door', 'a function to call with the session\'s URI, or nothing'));
      }
      return start(asked, named);
    },
    /*
     * A chat inside a session this plugin already has, checked here and
     * started there.
     *
     * The same boundary as `startSession`, and the same answer for a request
     * made while `apply` runs: there is no host yet to start anything in, and a
     * call that owes an answer is told rather than dropped.
     */
    startChat(session, wanted) {
      const asked = checkChatRequest(wanted, by);
      const start = starts.startChat;
      if (start === undefined) {
        throw new Error(miss(by, 'startChat', 'the chat', 'asked for once a host is built over this plugin'));
      }
      return start(session, asked);
    },
    /*
     * The plugin's own connection, over a pair with this host on the other end.
     *
     * `connect` is not a registration, so it is not refused after `apply`
     * returned: a plugin connects from a route or a timer, which is long after
     * the fold took its copies. What it does need is a host, and the daemon sets
     * that once `createHost` has answered - so a plugin asking while `apply`
     * runs, or one asking a host that was never bound to it, is told rather
     * than handed a connection to nothing.
     *
     * The connection is served as this plugin's own principal rather than as
     * nobody, and never as root: a plugin is a client of this host with what its
     * entry grants it, which is the whole of what it may do here.
     */
    connect() {
      const host = connects.host;
      if (host === undefined) {
        throw new Error(miss(by, 'connect', 'a connection', 'asked for once a host is built over this plugin; connect from `listening` or later'));
      }
      const pair = createPair(() => {
        const at = opened.indexOf(pair);
        if (at !== -1) opened.splice(at, 1);
      });
      opened.push(pair);
      pair.served(host.accept(pair.host, principal));
      return pair.plugin;
    },
    registerAgent(agent) {
      open();
      const checked = checkAgent(agent, by);
      declared(by, options.contracts, 'agents', agent.provider);
      const reserved = reservedName(agent.provider);
      if (reserved !== undefined) throw new Error(miss(by, 'registerAgent', agent.provider, `a name the host has not reserved; ${reserved}`));
      if (providers.has(agent.provider)) {
        throw new Error(miss(by, 'registerAgent', agent.provider, 'a provider no other agent in this plugin uses'));
      }
      reportGaps(checked);
      providers.add(agent.provider);
      contribution.agents.push(agent);
    },
    registerTool(tool) {
      open();
      checkTool(tool, by);
      const name = tool.definition.name;
      declared(by, options.contracts, 'tools', name);
      if (tools.has(name)) {
        throw new Error(miss(by, 'registerTool', name, 'a name no other tool in this plugin uses'));
      }
      tools.add(name);
      contribution.tools.push(tool);
    },
    registerSessionConfig(key, schema, completions) {
      open();
      const named = typeof key === 'string' ? key.trim() : '';
      if (named === '') throw new Error(miss(by, 'registerSessionConfig', String(key), 'a non-empty key'));
      if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
        throw new Error(miss(by, 'registerSessionConfig', named, 'a JSON Schema property object'));
      }
      if (completions !== undefined && typeof completions !== 'function') {
        throw new Error(miss(by, 'registerSessionConfig', named, 'a function to answer its picker, or nothing'));
      }
      declared(by, options.contracts, 'sessionConfigs', named);
      if (sessionKeys.has(named)) {
        throw new Error(miss(by, 'registerSessionConfig', named, 'a key no other setting in this plugin uses'));
      }
      sessionKeys.add(named);
      reportGaps([{ where: `session config ${named}`, gaps: schemaGaps(schema) }]);
      contribution.sessionConfig[named] = schema as Record<string, unknown>;
      if (completions !== undefined) contribution.sessionCompletions[named] = completions;
    },
    registerResources: (store, when) => { setPort('resources', 'registerResources', store, when); },
    registerResourceProvider(scheme, provider) {
      open();
      const named = checkScheme(scheme, by);
      const reserved = reservedName(named);
      if (reserved !== undefined) throw new Error(miss(by, 'registerResourceProvider', named, `a name the host has not reserved; ${reserved}`));
      checkResourceProvider(named, provider, by);
      declared(by, options.contracts, 'resourceProviders', named);
      if (contribution.providers[named] !== undefined) {
        throw new Error(miss(by, 'registerResourceProvider', named, 'a scheme no other provider in this plugin uses'));
      }
      contribution.providers[named] = provider;
    },
    /*
     * The handle is a closure over the entry the fold carries, so a publish
     * reaches whatever host sets `publish` on it, and a publish made before
     * any host did is told rather than dropped.
     */
    registerChannel(scheme, channel): ChannelHandle {
      open();
      const named = checkScheme(scheme, by, 'registerChannel').toLowerCase();
      if (!named.startsWith('x-')) {
        throw new Error(miss(by, 'registerChannel', named, 'a scheme that starts with x-, the protocol\'s extension prefix'));
      }
      checkChannel(named, channel, by);
      declared(by, options.contracts, 'channels', named);
      if (contribution.channels[named] !== undefined) {
        throw new Error(miss(by, 'registerChannel', named, 'a scheme no other channel in this plugin uses'));
      }
      const served: ServedChannel = { by, scheme: named, channel };
      contribution.channels[named] = served;
      return {
        publish: (uri, action, options = {}) => {
          if (typeof action?.type !== 'string' || !action.type.startsWith(`${named}/`)) {
            throw new Error(miss(by, 'publish', 'the action type', `a type that starts with ${named}/`));
          }
          if (schemeOf(uri) !== named) throw new Error(miss(by, 'publish', uri, `a URI on ${named}:`));
          const publish = served.publish;
          if (publish === undefined) {
            throw new Error(miss(by, 'publish', 'the action', 'sent once a host is built over this plugin'));
          }
          publish(uri, action, options);
        },
        subscribers: (uri) => served.subscribers?.(uri) ?? [],
        localeOf: (client) => served.localeOf?.(client),
      };
    },
    registerMethod(name, method) {
      open();
      const named = checkMethod(name, method, by);
      declared(by, options.contracts, 'methods', named);
      if (contribution.methods[named] !== undefined) {
        throw new Error(miss(by, 'registerMethod', named, 'a name no other method in this plugin uses'));
      }
      contribution.methods[named] = { by, name: named, method };
    },
    registerChatPreamble(preamble) {
      open();
      if (typeof preamble !== 'function') {
        throw new Error(miss(by, 'registerChatPreamble', 'the preamble', 'a function'));
      }
      declared(by, options.contracts, 'chatPreambles');
      // The host logs a preamble that throws, so the error names the plugin.
      contribution.preambles.push(async (opened) => {
        try {
          return await preamble(opened);
        }
        catch (error) {
          throw new Error(`plugin ${by}: ${reason(error)}`);
        }
      });
    },
    /*
     * One plan per plugin, and the fold arbitrates between plugins. The object
     * is carried through, so the host fills `changed` in and a change the
     * plugin announces reaches it.
     */
    registerPlan(read) {
      open();
      if (typeof read !== 'function') {
        throw new Error(miss(by, 'registerPlan', 'the reader', 'a function answering the lines of one session\'s plan'));
      }
      declared(by, options.contracts, 'plans');
      if (contribution.plan !== undefined) {
        throw new Error(miss(by, 'registerPlan', 'a plan', 'registered only once'));
      }
      contribution.plan = { by, read };
    },
    planChanged(uri) {
      const served = contribution.plan;
      if (served === undefined) {
        throw new Error(miss(by, 'planChanged', uri, 'a session whose plan this plugin draws; call registerPlan first'));
      }
      const changed = served.changed;
      if (changed === undefined) {
        throw new Error(miss(by, 'planChanged', 'the change', 'announced once a host is built over this plugin'));
      }
      return changed(uri);
    },
    /*
     * One plugin's keys, many of them, and the fold arbitrates between plugins.
     * The object is carried through, so the host fills `changed` in and a value
     * the plugin says moved reaches it.
     */
    registerSessionMeta(key, read) {
      open();
      if (typeof key !== 'string' || key.trim() === '') {
        throw new Error(miss(by, 'registerSessionMeta', 'the key', 'a non-empty string'));
      }
      if (typeof read !== 'function') {
        throw new Error(miss(by, 'registerSessionMeta', 'the reader', 'a function answering the value of that key for one session'));
      }
      declared(by, options.contracts, 'sessionMeta', key);
      if (contribution.sessionMeta === undefined) contribution.sessionMeta = { by, keys: [] };
      const held = contribution.sessionMeta;
      if (held.keys.some((one) => one.key === key)) {
        throw new Error(miss(by, 'registerSessionMeta', key, 'registered only once'));
      }
      held.keys.push({ key, read });
    },
    sessionMetaChanged(uri) {
      const served = contribution.sessionMeta;
      if (served === undefined) {
        throw new Error(miss(by, 'sessionMetaChanged', uri, 'a session whose _meta this plugin adds to; call registerSessionMeta first'));
      }
      const changed = served.changed;
      if (changed === undefined) {
        throw new Error(miss(by, 'sessionMetaChanged', 'the change', 'announced once a host is built over this plugin'));
      }
      changed(uri);
    },
    /*
     * The host's store, reached through the entry the fold carries to it.
     *
     * No registration and no ownership record here: the store keeps what each
     * canvas is, which chat lists it and which plugin opened it, so a call
     * either reaches it or is refused by it. What this side adds is the name of
     * the plugin and the sentence a plugin reads before a host exists.
     */
    openCanvas(chat, state) {
      const open = contribution.canvases.open;
      if (open === undefined) {
        throw new Error(miss(by, 'openCanvas', 'the canvas', 'opened once a host is built over this plugin'));
      }
      const resource = open(chat, state);
      // The unload road, put on the list once there is something to take away:
      // `HostOptions.closers` carries one entry per registration and none for a
      // plugin that registered nothing.
      if (!closerPushed) {
        closerPushed = true;
        contribution.closers.push(() => { canvases.closeAll?.(); });
      }
      return resource;
    },
    updateCanvas(resource, state) {
      const update = contribution.canvases.update;
      if (update === undefined) {
        throw new Error(miss(by, 'updateCanvas', 'the canvas', 'drawn once a host is built over this plugin'));
      }
      update(resource, state);
    },
    closeCanvas(resource) {
      const close = contribution.canvases.close;
      if (close === undefined) {
        throw new Error(miss(by, 'closeCanvas', resource, 'closed once a host is built over this plugin'));
      }
      close(resource);
    },
    /*
     * One reader per plugin, and every plugin's is kept: a binding is about a
     * session, so two plugins may answer for different ones. A second reader
     * from one plugin is refused rather than merged, because one plugin's two
     * maps would need a rule for a shared alias that nothing has.
     */
    registerBindings(read) {
      open();
      if (typeof read !== 'function') {
        throw new Error(miss(by, 'registerBindings', 'the reader', 'a function answering a session\'s connectors, by alias'));
      }
      declared(by, options.contracts, 'bindings');
      if (contribution.bindings !== undefined) {
        throw new Error(miss(by, 'registerBindings', 'a reader', 'registered only once'));
      }
      contribution.bindings = { by, read };
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
    registerRecords: (store, when) => { setPort('records', 'registerRecords', store, when); },
    registerCommandParser: (split, when) => { setPort('commandParser', 'registerCommandParser', split, when); },
    registerRoute(handler) {
      open();
      checkRoute(handler, by);
      declared(by, options.contracts, 'routes');
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
    registerClose(close) {
      open();
      /*
       * Callable is the whole of what can be checked here: the host calls this
       * when the daemon stops, and what it does then is the plugin's own. A
       * JavaScript plugin that registered a value rather than a function is
       * refused at the call site rather than at the close, where the daemon is
       * going and nobody is left to report it.
       */
      if (typeof close !== 'function') {
        throw new Error(miss(by, 'registerClose', 'close', 'a function'));
      }
      declared(by, options.contracts, 'closers');
      contribution.closers.push(close);
    },
    registerTriggerType(definition) {
      open();
      const checked = checkTriggerType(definition, by);
      const named = definition.type;
      declared(by, options.contracts, 'triggerTypes', named);
      /*
       * The host's own two names are refused here rather than in the fold,
       * because a name this host already answers for is not a collision with
       * another plugin: whatever a plugin wrote under `session` would never be
       * what fired. The same refusal `registerResourceProvider` makes for a
       * scheme the host owns.
       */
      if (RESERVED_TRIGGER_TYPES.includes(named)) {
        throw new Error(miss(by, 'registerTriggerType', named, 'a name the host does not already use; session and watch are its own'));
      }
      if (contribution.triggers.types[named] !== undefined) {
        throw new Error(miss(by, 'registerTriggerType', named, 'a type name no other type in this plugin uses'));
      }
      reportGaps(checked);
      contribution.triggers.types[named] = definition;
    },
    fireTrigger(type, event, data, owner) {
      /*
       * Read from the contribution rather than from the object `pluginHost`
       * built, because the fold replaces it with the host's own entry: what a
       * plugin may fire, and where the fire goes, are the host's record of the
       * plugin rather than the plugin's own.
       */
      const held = contribution.triggers;
      const named = typeof type === 'string' ? type.trim() : '';
      const offered = held.types[named];
      // Both halves are this plugin's own mistake rather than a host's: the
      // type is what it registered, and the event is what that type offers.
      if (offered === undefined) throw new Error(miss(by, 'fireTrigger', named, 'a type this plugin registered'));
      if (!offered.events.some((one) => one.id === event)) {
        throw new Error(miss(by, 'fireTrigger', String(event), `an event ${named} offers`));
      }
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error(miss(by, 'fireTrigger', 'data', 'an object'));
      }
      /*
       * Dropped before a host is built over this plugin, which is a plugin
       * firing from its own test rather than a fire that went missing: nothing
       * keeps it for later, because an event is about what is happening now.
       */
      held.deliver?.(named, String(event), data as Record<string, unknown>, owner);
    },
    /*
     * One automation by its id, rather than every watcher of a type.
     *
     * Checked at this boundary the same way a fire is - the id is a string and
     * the data is an object - and dropped before a host is built, which is a
     * plugin asking from its own test. What it means (a run that is off, one
     * the owner may not read) is the host's to decide, so nothing here reads
     * the automation.
     */
    runAutomation(id, data, owner) {
      const held = contribution.triggers;
      const named = typeof id === 'string' ? id.trim() : '';
      if (named === '') throw new Error(miss(by, 'runAutomation', 'id', 'the id of an automation'));
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error(miss(by, 'runAutomation', 'data', 'an object'));
      }
      held.run?.(named, data as Record<string, unknown>, owner);
    },
    registerAdapter(adapter) {
      open();
      const { name: named, checked } = checkAdapter(adapter, by);
      declared(by, options.contracts, 'adapters', named);
      if (contribution.adapters[named] !== undefined) {
        throw new Error(miss(by, 'registerAdapter', named, 'a name no other adapter in this plugin uses'));
      }
      reportGaps(checked);
      contribution.adapters[named] = { ...adapter, by };
    },
    registerEngine(engine) {
      open();
      const { name: named, checked } = checkEngine(engine, by);
      declared(by, options.contracts, 'engines', named);
      const held = contribution.engines ??= {};
      if (held[named] !== undefined) {
        throw new Error(miss(by, 'registerEngine', named, 'a name no other engine in this plugin uses'));
      }
      reportGaps(checked);
      held[named] = { ...engine, by, ...(options.spec === undefined ? {} : { spec: options.spec }) };
    },
    on(event, handle) {
      // The context is captured, not rebuilt when the event fires: it is the
      // same read-only one `apply` was handed, and the host does not otherwise
      // know every directory the daemon was told to serve.
      (events[event] ??= []).push({ by, context, handle: handle as unknown as EventHandler });
    },
  };

  /*
   * Frozen, because this object is the context the plugin was handed.
   *
   * Every plugin's `host` is a fresh object with that plugin's registrations on
   * it, and it is also what `PluginContext` says it is: the directories the
   * host serves, where its configuration is, one line to its log. A plugin that
   * rewrote one of those would be changing what it, and the listeners it
   * registered, read about the host.
   */
  return { host: Object.freeze(host), contribution, seal: () => { sealed = true; } };
}

/**
 * Call everyone subscribed to one event, in order, and let none of them fail it.
 *
 * The one implementation of what `on` promises - registration order, each
 * handler awaited, a handler that throws reported against its plugin and the
 * rest carrying on - so the host and the daemon raise an event the same way.
 * Two copies would be two sets of semantics, which is why there is one.
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
  /*
   * One frozen copy, and the same one to every listener.
   *
   * A listener is handed the event to read, and reading is the whole of what it
   * may do: an event that is the host's own object would let the first listener
   * change what the second one - or the host, for a value it kept - reads next.
   * So the event is copied and frozen here, once, rather than trusted to be
   * left alone by everyone who sees it.
   */
  const held = frozenCopy(event);
  for (const listener of listeners) {
    try {
      await (listener.handle as (one: HostEvent, context: PluginContext) => void | Promise<void>)(
        held,
        listener.context,
      );
    }
    catch (error) {
      onProblem?.(`${listener.by} failed at ${event.type}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
