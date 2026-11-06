import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { foldHostOptions, pluginHost, routeOf, routePrefix, ROUTE_ROOT } from '../src/plugins/plugins.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
import type { HostOptions, HostTool } from '../src/types/host.js';
import type { ResourceStore } from '../src/types/resources.js';
import type { AutomationStore } from '../src/types/automations.js';
import type { Usage } from '../src/types/usage.js';
import type { Policies } from '../src/types/policies.js';
import type { Vault } from '../src/types/vault.js';
import type { Adapter } from '../src/types/connectors.js';
import type { TunnelKind } from '../src/types/tunnels.js';
import type { Contribution, LoaderContext, PortContribution, PortKey, Route } from '../src/types/plugin.js';

/*
 * The fold, on its own.
 *
 * `foldHostOptions` is pure, so every rule can
 * be checked without a loader, a filesystem or a plugin package: what appends,
 * what a collision is, what `'replace'` buys, and that the base a caller
 * passed in comes back untouched.
 */

/** A backend like the example's, renamed so a collision has two names to print. */
const agent = (provider: string): Agent => ({ ...echo({ path: '/tmp/fold' }), provider });

const tool = (name: string): HostTool => ({
  definition: { name, description: `${name} tool`, inputSchema: { type: 'object', properties: {} } },
  run: () => name,
});

/** A base like the daemon builds, with `resources` already the daemon's. */
const base = (): HostOptions => ({
  path: '/tmp/fold',
  agents: [agent('echo')],
  resources: { claimed: 'the daemon' } as unknown as ResourceStore,
});

const contribution = (
  by: string,
  parts: {
    agents?: Agent[];
    tools?: HostTool[];
    ports?: Partial<Record<PortKey, PortContribution>>;
    providers?: Record<string, unknown>;
    channels?: Contribution['channels'];
    adapters?: Contribution['adapters'];
    methods?: Contribution['methods'];
    sessionConfig?: Record<string, Record<string, unknown>>;
    sessionCompletions?: Contribution['sessionCompletions'];
    providerConfigurations?: Contribution['providerConfigurations'];
    changesetOperations?: Contribution['changesetOperations'];
    routes?: Route;
    closers?: (() => void | Promise<void>)[];
    preambles?: Contribution['preambles'];
  } = {},
): Contribution => ({
  by,
  agents: parts.agents ?? [],
  tools: parts.tools ?? [],
  sessionConfig: parts.sessionConfig ?? {},
  sessionCompletions: parts.sessionCompletions ?? {},
  providerConfigurations: parts.providerConfigurations ?? [],
  changesetOperations: parts.changesetOperations ?? [],
  ports: parts.ports ?? {},
  providers: parts.providers ?? {},
  channels: parts.channels ?? {},
  adapters: parts.adapters ?? {},
  methods: parts.methods ?? {},
  events: {},
  triggers: { by, types: {} },
  starts: { by },
  connects: { by, close: () => {} },
  canvases: { by },
  closers: parts.closers ?? [],
  preambles: parts.preambles ?? [],
  ...(parts.routes === undefined ? {} : { routes: parts.routes }),
});

/** A handler like a webhook's: the path it was called on, as JSON. */
const route = (answer: string): Route => async () => new Response(answer);

const port = (value: unknown, replace = false): PortContribution => ({ value, replace });

describe('foldHostOptions', () => {
  it('appends agents and tools in contribution order, and leaves the base alone', () => {
    const options = base();
    const before = options.agents;
    const { options: folded, problems } = foldHostOptions(options, [
      contribution('alpha', { agents: [agent('alpha')], tools: [tool('alpha')] }),
      contribution('beta', { agents: [agent('beta')], tools: [tool('beta')] }),
    ]);

    expect(problems).toEqual([]);
    expect(folded.agents.map((one) => one.provider)).toEqual(['echo', 'alpha', 'beta']);
    expect(folded.tools?.map((one) => one.definition.name)).toEqual(['alpha', 'beta']);
    // The base is a value a caller still holds, so a fold that mutated it
    // would change what the daemon built before any plugin ran.
    expect(options.agents).toBe(before);
    expect(options.agents.map((one) => one.provider)).toEqual(['echo']);
    expect(options.tools).toBeUndefined();
  });

  it('drops an agent whose provider the base already has, naming both', () => {
    const { options, problems } = foldHostOptions(base(), [
      contribution('alpha', { agents: [agent('echo')] }),
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('alpha');
    expect(problems[0]).toContain('echo');
    expect(problems[0]).toContain('the daemon');
    // The daemon's own keeps the id, so a client asking for it is answered by
    // the backend that has always answered for it.
    expect(options.agents.map((one) => one.provider)).toEqual(['echo']);
  });

  it('tells a plugin that sets a port the daemon already set, and keeps the daemon\'s value', () => {
    const options = base();
    const { options: folded, problems } = foldHostOptions(options, [
      contribution('alpha', { ports: { resources: port({ claimed: 'alpha' }) } }),
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('alpha');
    expect(problems[0]).toContain('resources');
    expect(problems[0]).toContain("'replace'");
    expect(folded.resources).toBe(options.resources);
  });

  it('lets a plugin take a daemon port over with replace, without a problem', () => {
    const mine = { claimed: 'alpha' } as unknown as ResourceStore;
    const { options, problems } = foldHostOptions(base(), [
      contribution('alpha', { ports: { resources: port(mine, true) } }),
    ]);

    expect(problems).toEqual([]);
    expect(options.resources).toBe(mine);
  });

  it('reports two plugins claiming one free port once, naming both, and keeps the first', () => {
    const first = { claimed: 'alpha' } as unknown as AutomationStore;
    const { options, problems } = foldHostOptions(base(), [
      contribution('alpha', { ports: { automations: port(first) } }),
      contribution('beta', { ports: { automations: port({ claimed: 'beta' }) } }),
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('alpha');
    expect(problems[0]).toContain('beta');
    expect(problems[0]).toContain('automations');
    expect(options.automations).toBe(first);
  });

  it('lets the second plugin take the first one\'s port over with replace', () => {
    const second = { claimed: 'beta' } as unknown as AutomationStore;
    const { options, problems } = foldHostOptions(base(), [
      contribution('alpha', { ports: { automations: port({ claimed: 'alpha' }) } }),
      contribution('beta', { ports: { automations: port(second, true) } }),
    ]);

    expect(problems).toEqual([]);
    expect(options.automations).toBe(second);
  });

  it('sets a port the base does not have with no replace needed', () => {
    const store = { claimed: 'alpha' } as unknown as AutomationStore;
    const { options, problems } = foldHostOptions(base(), [
      contribution('alpha', { ports: { automations: port(store) } }),
    ]);

    expect(problems).toEqual([]);
    expect(options.automations).toBe(store);
  });

  it('keeps one scheme per plugin, and names both when two claim one', () => {
    const alpha = { read: () => 'alpha' };
    const beta = { read: () => 'beta' };
    const { options, problems } = foldHostOptions(base(), [
      contribution('alpha', { providers: { computer: alpha } }),
      contribution('beta', { providers: { notes: beta } }),
    ]);

    expect(problems).toEqual([]);
    // Two schemes, two plugins, and neither had to take `resources` over.
    expect(Object.keys(options.resourceProviders ?? {})).toEqual(['computer', 'notes']);
    expect(options.resourceProviders?.computer).toBe(alpha);
    expect(options.resourceProviders?.notes).toBe(beta);

    const clash = foldHostOptions(base(), [
      contribution('alpha', { providers: { computer: alpha } }),
      contribution('beta', { providers: { computer: beta } }),
    ]);
    expect(clash.problems).toHaveLength(1);
    expect(clash.problems[0]).toContain('alpha');
    expect(clash.problems[0]).toContain('beta');
    expect(clash.problems[0]).toContain('computer');
    expect(clash.options.resourceProviders?.computer).toBe(alpha);
  });

  it('reports a scheme the daemon already serves rather than letting a plugin shadow it', () => {
    type Providers = NonNullable<HostOptions['resourceProviders']>;
    const held = { read: () => 'the daemon' } as unknown as Providers[string];
    const mine = { read: () => 'alpha' } as unknown as Providers[string];
    const options = { ...base(), resourceProviders: { computer: held } };
    const { options: folded, problems } = foldHostOptions(options, [
      contribution('alpha', { providers: { computer: mine } }),
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('alpha');
    expect(problems[0]).toContain('the daemon');
    expect(folded.resourceProviders?.computer).toBe(held);
  });

  it('sets a plugin\'s usage store like any other port, and reports the daemon\'s', () => {
    const usage = (pool: string): Usage => ({
      record: async () => {},
      total: async () => ({ calls: pool === 'a' ? 1 : 0 }),
      pools: async () => [],
      records: async () => [],
      groups: async () => [],
    });
    const options = { ...base(), usage: usage('the daemon') };

    const mine = usage('alpha');
    const taken = foldHostOptions(base(), [contribution('alpha', { ports: { usage: port(mine) } })]);
    expect(taken.problems).toEqual([]);
    expect(taken.options.usage).toBe(mine);

    const held = foldHostOptions(options, [contribution('alpha', { ports: { usage: port(usage('alpha')) } })]);
    expect(held.problems).toHaveLength(1);
    expect(held.problems[0]).toContain('usage');
    expect(held.problems[0]).toContain('the daemon');
    expect(held.options.usage).toBe(options.usage);

    const over = foldHostOptions(options, [contribution('alpha', { ports: { usage: port(mine, true) } })]);
    expect(over.problems).toEqual([]);
    expect(over.options.usage).toBe(mine);
  });

  it('sets a plugin\'s policies store like any other port, and reports the daemon\'s', () => {
    const policies = (id: string): Policies => ({
      list: async () => [{ id, scope: 'all', kind: 'model', effect: 'allow', match: { model: ['*'] } }],
      get: async () => undefined,
      put: async (policy) => policy,
      remove: async () => false,
    });
    const options = { ...base(), policies: policies('the daemon') };

    const mine = policies('alpha');
    const taken = foldHostOptions(base(), [contribution('alpha', { ports: { policies: port(mine) } })]);
    expect(taken.problems).toEqual([]);
    expect(taken.options.policies).toBe(mine);

    const held = foldHostOptions(options, [contribution('alpha', { ports: { policies: port(policies('alpha')) } })]);
    expect(held.problems).toHaveLength(1);
    expect(held.problems[0]).toContain('policies');
    expect(held.problems[0]).toContain('the daemon');
    expect(held.options.policies).toBe(options.policies);

    const over = foldHostOptions(options, [contribution('alpha', { ports: { policies: port(mine, true) } })]);
    expect(over.problems).toEqual([]);
    expect(over.options.policies).toBe(mine);
  });

  it('sets a plugin\'s vault like any other port, and reports the daemon\'s', () => {
    const vault = (owner: string): Vault => ({
      get: async (name) => (name === 'host:x' ? `${owner}-value` : undefined),
      set: async () => {},
      delete: async () => false,
      list: async () => [],
    });
    const options = { ...base(), vault: vault('the daemon') };

    const mine = vault('alpha');
    const taken = foldHostOptions(base(), [contribution('alpha', { ports: { vault: port(mine) } })]);
    expect(taken.problems).toEqual([]);
    expect(taken.options.vault).toBe(mine);

    const held = foldHostOptions(options, [contribution('alpha', { ports: { vault: port(vault('alpha')) } })]);
    expect(held.problems).toHaveLength(1);
    expect(held.problems[0]).toContain('vault');
    expect(held.problems[0]).toContain('the daemon');
    expect(held.options.vault).toBe(options.vault);

    const over = foldHostOptions(options, [contribution('alpha', { ports: { vault: port(mine, true) } })]);
    expect(over.problems).toEqual([]);
    expect(over.options.vault).toBe(mine);
  });
});

describe('sdkVersion', () => {
  it('answers the version in this package\'s manifest', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as { version: string };
    expect(sdkVersion()).toBe(manifest.version);
    expect(sdkVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

it('takes a session setting from a plugin, and reports a second one with the same name', () => {
  const one = contribution('one', { sessionConfig: { computer: { type: 'string', title: 'Computer' } } });
  const two = contribution('two', { sessionConfig: { computer: { type: 'string' } } });
  const folded = foldHostOptions(base(), [one, two]);

  expect(folded.options.sessionConfig).toEqual({ computer: { type: 'string', title: 'Computer' } });
  expect(folded.problems).toHaveLength(1);
  expect(folded.problems[0]).toContain('session setting computer');
  expect(folded.problems[0]).toContain('plugin one');
});

it('takes a provider configuration from a plugin, and reports a second one declaring the same root setting', () => {
  const sandbox = {
    provider: 'sandbox', title: 'Sandbox', description: 'Where commands run.',
    settings: [{ key: 'sandbox.enabled', group: 'Sandbox' }],
    properties: { 'sandbox.enabled': { type: 'boolean', default: false } },
  };
  const other = { ...sandbox, provider: 'other' };
  const folded = foldHostOptions(base(), [
    contribution('one', { providerConfigurations: [sandbox] }),
    contribution('two', { providerConfigurations: [other] }),
  ]);
  expect(folded.options.providerConfigurations).toEqual([sandbox]);
  expect(folded.problems).toEqual(['plugin two registers root setting sandbox.enabled, which the configuration of sandbox already declares']);
});

it('registers a provider configuration through a plugin host, named in its contracts', () => {
  const ADAPTER = pluginHost('sandboxes', ADAPTER_CONTEXT, { contracts: { providerConfigurations: ['sandbox'] } });
  ADAPTER.host.registerProviderConfiguration({
    provider: 'sandbox', title: 'Sandbox', description: 'Where commands run.',
    settings: [{ key: 'sandbox.enabled', group: 'Sandbox' }],
    properties: { 'sandbox.enabled': { type: 'boolean', default: false } },
  });
  expect(() => ADAPTER.host.registerProviderConfiguration({
    provider: 'firewall', title: 'Firewall', description: 'What may be reached.', settings: [], properties: {},
  })).toThrow('contracts.providerConfigurations');
  ADAPTER.seal();
  expect(ADAPTER.contribution.providerConfigurations.map((one) => one.provider)).toEqual(['sandbox']);
});

it('takes a changeset operation contribution from a plugin, and reports a second handler for the same operation', () => {
  const open = { operations: () => [], handlers: { 'merge-request': async () => ({}) } };
  const again = { operations: () => [], handlers: { 'merge-request': async () => ({ message: 'again' }) } };
  const folded = foldHostOptions(base(), [
    contribution('one', { changesetOperations: [open] }),
    contribution('two', { changesetOperations: [again] }),
  ]);
  expect(folded.options.changesetOperations).toEqual([open]);
  expect(folded.problems).toEqual(['plugin two handles changeset operation merge-request, which another contribution already handles']);
});

it('refuses a session setting a backend already declares', () => {
  // The example backend declares `voice`, so a plugin may not move it.
  const folded = foldHostOptions(base(), [contribution('one', { sessionConfig: { voice: { type: 'string' } } })]);
  expect(folded.options.sessionConfig?.voice).toBeUndefined();
  expect(folded.problems[0]).toContain("a backend's own schema already declares");
});

it('folds every plugin\'s chat preambles in plugin order, and sets none when there are none', () => {
  const one = async (): Promise<string> => 'one';
  const two = async (): Promise<string> => 'two';
  const three = async (): Promise<string> => 'three';
  const folded = foldHostOptions(base(), [
    contribution('alpha', { preambles: [one, two] }),
    contribution('beta'),
    contribution('gamma', { preambles: [three] }),
  ]);
  expect(folded.problems).toEqual([]);
  expect(folded.options.chatPreambles).toEqual([one, two, three]);
  expect(foldHostOptions(base(), [contribution('alpha')]).options.chatPreambles).toBeUndefined();
});

describe('the routes a fold carries', () => {
  it('keeps each plugin\'s route under its own name, and an empty record when none registered one', async () => {
    const none = foldHostOptions(base(), [contribution('alpha', { agents: [agent('alpha')] })]);
    expect(none.routes).toEqual({});

    const { routes, problems } = foldHostOptions(base(), [
      contribution('alpha', { routes: route('alpha') }),
      contribution('@ahpd/x', { routes: route('scoped') }),
    ]);
    // Nothing to collide on, so nothing to report: the prefix is the name.
    expect(problems).toEqual([]);
    expect(Object.keys(routes)).toEqual(['alpha', '@ahpd/x']);
    expect(await routes['@ahpd/x']?.(new Request('http://h/'))).toBeInstanceOf(Response);
  });

  it('serves a scoped name under its encoded prefix, and keeps the plugin\'s other registrations', async () => {
    const folded = foldHostOptions(base(), [
      contribution('@ahpd/x', { routes: route('scoped'), agents: [agent('scoped')], tools: [tool('scoped')] }),
    ]);

    expect(routePrefix('@ahpd/x')).toBe('/plugins/%40ahpd/x/');
    expect(folded.options.agents.map((one) => one.provider)).toEqual(['echo', 'scoped']);
    expect(folded.options.tools?.map((one) => one.definition.name)).toEqual(['scoped']);
    // A name holding `@` and `/` is served rather than refused: the encoding is
    // the prefix, not a rule the plugin has to satisfy.
    const found = routeOf(folded.routes, '/plugins/%40ahpd/x/hook');
    expect(found?.by).toBe('@ahpd/x');
    expect(await found?.handler(new Request('http://h/plugins/%40ahpd/x/hook'))).toBeInstanceOf(Response);
  });

  it('matches a route by whole segments, and nobody else\'s', () => {
    const routes: Record<string, Route> = { '@ahpd/x': route('scoped'), alpha: route('alpha') };

    expect(routeOf(routes, '/plugins/alpha/hook')?.by).toBe('alpha');
    // The prefix as it is written and without its trailing `/`: both are the
    // root of the route rather than a path under nothing.
    expect(routeOf(routes, '/plugins/alpha/')?.by).toBe('alpha');
    expect(routeOf(routes, '/plugins/alpha')?.by).toBe('alpha');
    // A longer name is not reachable by the start of a shorter one, which is
    // what the `/` before each segment is for.
    expect(routeOf(routes, '/plugins/alphabet')).toBeUndefined();
    expect(routeOf(routes, '/plugins/%40ahpd/xy')).toBeUndefined();
    // Somebody else's prefix, and a path that is not ours at all.
    expect(routeOf(routes, '/plugins/%40ahpd/y/hook')).toBeUndefined();
    expect(routeOf(routes, '/api/status')).toBeUndefined();
    expect(routeOf(routes, '/plugins')).toBeUndefined();
  });

  it('owns the whole /plugins space, so a path nobody serves is told there is nothing', () => {
    expect(ROUTE_ROOT).toBe('/plugins');
    expect(routeOf({}, '/plugins/alpha/hook')).toBeUndefined();
    expect(routeOf({}, '/api/status')).toBeUndefined();
  });
});

/*
 * The adapters a plugin offers.
 *
 * An adapter is registered through `pluginHost`, which checks its shape and its
 * contract, and the fold keeps it by name. A capability is declared and listed;
 * nothing here, and nothing in this plan, runs one.
 */

const ADAPTER_CONTEXT: LoaderContext = {
  path: '/tmp/fold',
  paths: ['/tmp/fold'],
  version: '0.0.0',
  hostName: 'host',
  configDir: '/tmp/fold',
  log: () => {},
  say: () => {},
};

/** An adapter that opens nothing, which is all a registration check reads. */
const adapter = (name: string, parts: Partial<Adapter> = {}): Adapter => ({
  name,
  title: `${name} connector`,
  description: `A connector of the ${name} adapter.`,
  schema: { type: 'object', properties: {} },
  capabilities: [
    { type: 'receive', name: 'call', title: 'Receives calls', description: 'Answers a call on the connector.' },
  ],
  open: () => {},
  ...parts,
});

describe('the adapters a fold carries', () => {
  it('collects two adapters one plugin registers, by name', () => {
    const alpha = pluginHost('alpha', ADAPTER_CONTEXT);
    alpha.host.registerAdapter(adapter('webhook'));
    alpha.host.registerAdapter(adapter('mail'));

    const { options, problems } = foldHostOptions(base(), [alpha.contribution]);
    expect(problems).toEqual([]);
    expect(Object.keys(options.adapters ?? {})).toEqual(['webhook', 'mail']);
    expect(options.adapters?.webhook?.by).toBe('alpha');
    expect(options.adapters?.webhook?.capabilities.map((one) => one.name)).toEqual(['call']);
  });

  it('refuses an adapter name two plugins register, and names both', () => {
    const alpha = pluginHost('alpha', ADAPTER_CONTEXT);
    alpha.host.registerAdapter(adapter('webhook'));
    const beta = pluginHost('beta', ADAPTER_CONTEXT);
    beta.host.registerAdapter(adapter('webhook'));

    const { options, problems } = foldHostOptions(base(), [alpha.contribution, beta.contribution]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('alpha');
    expect(problems[0]).toContain('beta');
    expect(problems[0]).toContain('webhook');
    // The first keeps the name, and the second keeps everything else it
    // contributed rather than failing its whole load.
    expect(options.adapters?.webhook?.by).toBe('alpha');
  });

  it('refuses an adapter with no schema', () => {
    const { host } = pluginHost('alpha', ADAPTER_CONTEXT);
    expect(() => host.registerAdapter({ ...adapter('webhook'), schema: undefined } as unknown as Adapter)).toThrow('schema');
  });

  it('refuses an adapter whose run is not a function', () => {
    const { host } = pluginHost('alpha', ADAPTER_CONTEXT);
    expect(() => host.registerAdapter({ ...adapter('webhook'), run: 'send' } as unknown as Adapter)).toThrow('run');
  });

  it('refuses an adapter its contracts do not list, naming the adapter', () => {
    const listed = pluginHost('alpha', ADAPTER_CONTEXT, { contracts: { adapters: ['webhook'] } }).host;
    expect(() => listed.registerAdapter(adapter('webhook'))).not.toThrow();

    const other = pluginHost('beta', ADAPTER_CONTEXT, { contracts: { adapters: ['webhook'] } }).host;
    expect(() => other.registerAdapter(adapter('mail'))).toThrow('mail');
  });

  it('refuses an adapter a plugin whose contracts say connectors registers, naming adapters', () => {
    const old = pluginHost('alpha', ADAPTER_CONTEXT, { contracts: { connectors: ['webhook'] } }).host;

    expect(() => old.registerAdapter(adapter('webhook'))).toThrow('adapters');
  });

  it('refuses an engine a plugin whose contracts say agentKinds registers, naming engines', () => {
    const old = pluginHost('alpha', ADAPTER_CONTEXT, { contracts: { agentKinds: ['claude'] } }).host;
    const engine = { name: 'claude', title: 'Claude', description: 'An agent.', schema: { type: 'object' }, open: () => agent('claude') };

    expect(() => old.registerEngine(engine)).toThrow('engines');
  });
});

/*
 * The kinds of tunnel a plugin offers.
 *
 * A kind is registered through `pluginHost`, which checks its shape and its
 * contract, and the fold keeps it by name. Its handlers are the kind's own;
 * nothing here, and nothing in this task, calls one.
 */

/** A tunnel kind whose handlers do nothing, which is all a registration check reads. */
const tunnelKind = (name: string, parts: Partial<TunnelKind> = {}): TunnelKind => ({
  name,
  title: `${name} tunnel`,
  description: `A tunnel of the ${name} kind.`,
  schema: { type: 'object', properties: {} },
  create: () => {},
  remove: () => {},
  invoke: () => {},
  ...parts,
});

describe('the tunnel kinds a fold carries', () => {
  it('collects two kinds of two plugins, by name', () => {
    const alpha = pluginHost('alpha', ADAPTER_CONTEXT);
    alpha.host.registerTunnelKind(tunnelKind('devtunnel'));
    const beta = pluginHost('beta', ADAPTER_CONTEXT);
    beta.host.registerTunnelKind(tunnelKind('ngrok'));

    const { options, problems } = foldHostOptions(base(), [alpha.contribution, beta.contribution]);
    expect(problems).toEqual([]);
    expect(Object.keys(options.tunnelKinds ?? {})).toEqual(['devtunnel', 'ngrok']);
    expect(options.tunnelKinds?.devtunnel?.by).toBe('alpha');
    expect(options.tunnelKinds?.ngrok?.by).toBe('beta');
  });

  it('refuses a kind name two plugins register, and names both', () => {
    const alpha = pluginHost('alpha', ADAPTER_CONTEXT);
    alpha.host.registerTunnelKind(tunnelKind('devtunnel'));
    const beta = pluginHost('beta', ADAPTER_CONTEXT);
    beta.host.registerTunnelKind(tunnelKind('devtunnel'));

    const { options, problems } = foldHostOptions(base(), [alpha.contribution, beta.contribution]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('alpha');
    expect(problems[0]).toContain('beta');
    expect(problems[0]).toContain('devtunnel');
    // The first keeps the name, and the second keeps everything else it
    // contributed rather than failing its whole load.
    expect(options.tunnelKinds?.devtunnel?.by).toBe('alpha');
  });

  it('refuses a kind its contracts do not list, naming the kind', () => {
    const listed = pluginHost('alpha', ADAPTER_CONTEXT, { contracts: { tunnelKinds: ['devtunnel'] } }).host;
    expect(() => listed.registerTunnelKind(tunnelKind('devtunnel'))).not.toThrow();

    const other = pluginHost('beta', ADAPTER_CONTEXT, { contracts: { tunnelKinds: ['devtunnel'] } }).host;
    expect(() => other.registerTunnelKind(tunnelKind('ngrok'))).toThrow('ngrok');
  });

  it('refuses a kind a plugin whose contracts say tunnels registers, naming tunnelKinds', () => {
    const old = pluginHost('alpha', ADAPTER_CONTEXT, { contracts: { tunnels: ['devtunnel'] } }).host;

    expect(() => old.registerTunnelKind(tunnelKind('devtunnel'))).toThrow('tunnelKinds');
  });
});

/*
 * The bindings a plugin answers for a session.
 *
 * One reader per plugin, kept by the fold. Two plugins may answer, because a
 * binding is about a session, and the alias they share is the session's own to
 * settle rather than the fold's.
 */
describe('the bindings a fold carries', () => {
  it('keeps one reader per plugin, and carries each', () => {
    const alpha = pluginHost('alpha', ADAPTER_CONTEXT);
    alpha.host.registerBindings(() => ({ work: 'connectors://webhook/a' }));
    const beta = pluginHost('beta', ADAPTER_CONTEXT);
    beta.host.registerBindings(() => undefined);

    const { options, problems } = foldHostOptions(base(), [alpha.contribution, beta.contribution]);
    expect(problems).toEqual([]);
    expect(options.bindings?.map((one) => one.by)).toEqual(['alpha', 'beta']);
    // The reader is asked when the host asks, not when it was registered.
    expect(options.bindings?.[0]?.read('ahp-session:/x')).toEqual({ work: 'connectors://webhook/a' });
  });

  it('refuses a second reader from one plugin', () => {
    const { host } = pluginHost('alpha', ADAPTER_CONTEXT);
    host.registerBindings(() => undefined);
    expect(() => host.registerBindings(() => undefined)).toThrow('once');
  });

  it('refuses a reader its contracts do not list', () => {
    const { host } = pluginHost('alpha', ADAPTER_CONTEXT, { contracts: {} });
    expect(() => host.registerBindings(() => undefined)).toThrow('bindings');
  });
});
