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
import type { HostOptions } from './types/host.js';
import type { Contribution, PortContribution, PortKey } from './types/plugin.js';

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

/** What `foldHostOptions` answers: the composed options, and everything that could not be composed. */
export interface FoldedOptions {
  /** The base, copied, with every contribution that was accepted folded in. */
  options: HostOptions;
  /** One message per conflict, in the order the contributions arrived. Empty when nothing collided. */
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
        problems.push(`plugin ${contribution.by} registers agent ${agent.provider}, which ${held === 'the daemon' ? 'the daemon' : `plugin ${held}`} already registered`);
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

  for (const [key, value] of set) {
    (options as unknown as Record<string, unknown>)[key] = value;
  }

  return { options, problems };
}
