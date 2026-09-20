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
import type { EventHandler, EventListener, EventName, HostHandlers } from './types/events.js';
import type { HostOptions } from './types/host.js';
import type { Contribution, PluginContext, PluginHost, PortContribution, PortKey, PortOf } from './types/plugin.js';
import { checkAgent, checkPort, checkTool, miss } from './validate.js';

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
  'github', 'automations', 'sessions', 'diagnostics',
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

/** What `foldHostOptions` answers: the composed options, and everything that could not be composed. */
export interface FoldedOptions {
  /** The base, copied, with every contribution that was accepted folded in. */
  options: HostOptions;
  /**
   * One message per conflict, in the order the contributions arrived. Empty
   * when nothing collided.
   *
   * An agent `provider` clash starts with `AGENT_CLASH`, because the daemon
   * refuses to start over one and needs to tell it from the problems it only
   * reports - and reading prose is not how a program should decide that.
   */
  problems: string[];
}

/**
 * Fold contributions into a base `HostOptions`.
 *
 * The rules, which are decision `plugin-contributes-host-options` and
 * `plugin-registration-kinds` made literal:
 *
 * - `agents` and `tools` append, in contribution order. A `provider` already
 *   registered - by the base or by an earlier plugin - is a problem naming
 *   both, because two backends a client cannot tell apart is a daemon that
 *   answers the wrong one.
 * - A port is set once. A later contribution that lands on a value already
 *   there - the daemon's or another plugin's - is a problem naming both and
 *   the value does not move, unless the later one carries `'replace'`, which
 *   takes it over silently.
 * - A port the base does not have is set by the first plugin that offers one,
 *   with no `'replace'` needed.
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

  for (const contribution of contributions) {
    for (const agent of contribution.agents) {
      const held = providers.get(agent.provider);
      if (held !== undefined) {
        problems.push(`${AGENT_CLASH} plugin ${contribution.by} registers agent ${agent.provider}, which ${held === 'the daemon' ? 'the daemon' : `plugin ${held}`} already registered`);
      }
      else {
        providers.set(agent.provider, contribution.by);
      }
      added.push(agent);
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
  }

  if (added.length > 0) options.agents = [...options.agents, ...added];

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

  return { options, problems };
}

/** What one `apply` is handed, and what it recorded. */
export interface HostRecording {
  /** The surface a plugin calls `register*` on. */
  host: PluginHost;
  /** Everything it registered, kept apart until the fold sees it. */
  contribution: Contribution;
}

/**
 * The `PluginHost` one plugin's `apply` is handed.
 *
 * Every method checks what it is given before it records it, so a bad
 * registration throws out of `apply` and the loader discards that plugin's
 * whole contribution rather than keeping the part registered before the bad
 * one. A registration made twice by the same plugin is refused here, because
 * that is one `apply` making a mistake; the same port claimed by two plugins
 * is the fold's problem, because only the fold can see both.
 */
export function pluginHost(by: string, context: PluginContext): HostRecording {
  /*
   * The listeners, keyed by event. Held as a loose record and narrowed to
   * `HostHandlers` through the contribution, because the mapped type gives
   * each event its own listener type and a generic `on` writes one key at a
   * time.
   */
  const events: Record<string, EventListener[]> = {};
  const contribution: Contribution = {
    by,
    agents: [],
    tools: [],
    ports: {},
    events: events as unknown as HostHandlers,
  };
  const providers = new Set<string>();
  const tools = new Set<string>();

  const setPort = <K extends PortKey>(key: K, method: string, value: PortOf<K>, when?: 'replace'): void => {
    checkPort(key, value, by);
    if (contribution.ports[key] !== undefined) {
      throw new Error(miss(by, method, key, 'registered only once'));
    }
    contribution.ports[key] = { value, replace: when === 'replace' };
  };

  const host: PluginHost = {
    ...context,
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
    registerResources: (store, when) => { setPort('resources', 'registerResources', store, when); },
    registerTerminals: (store, when) => { setPort('terminals', 'registerTerminals', store, when); },
    registerChanges: (source, when) => { setPort('changes', 'registerChanges', source, when); },
    registerDirectories: (facts, when) => { setPort('directories', 'registerDirectories', facts, when); },
    registerWorktrees: (worktrees, when) => { setPort('worktrees', 'registerWorktrees', worktrees, when); },
    registerGithub: (pullRequests, when) => { setPort('github', 'registerGithub', pullRequests, when); },
    registerAutomations: (store, when) => { setPort('automations', 'registerAutomations', store, when); },
    registerSessions: (store, when) => { setPort('sessions', 'registerSessions', store, when); },
    registerDiagnostics: (diagnostics, when) => { setPort('diagnostics', 'registerDiagnostics', diagnostics, when); },
    on(event, handle) {
      // The context is captured, not rebuilt when the event fires: it is the
      // same read-only one `apply` was handed, and the host does not otherwise
      // know every directory the daemon was told to serve.
      (events[event] ??= []).push({ by, context, handle: handle as unknown as EventHandler });
    },
  };

  return { host, contribution };
}
