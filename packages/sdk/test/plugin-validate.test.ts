import { loggerOf } from '../src/log.js';
import { describe, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
import type { HostOptions, HostTool } from '../src/types/host.js';
import type { LoaderContext } from '../src/types/plugin.js';

/*
 * The check at the plugin boundary.
 *
 * Every case is a plain JavaScript value on purpose: the whole point of the
 * check is that the type is gone by the time a plugin runs, so a test that
 * leaned on the type would be checking the compiler instead of the daemon.
 * The complete implementations are here to prove the check accepts what the
 * contracts actually allow, and the empty ones to prove it refuses what they
 * do not.
 */

const context = (): LoaderContext => ({
  path: '/tmp/validate',
  paths: ['/tmp/validate'],
  version: sdkVersion(),
  hostName: 'test',
  configDir: '/tmp/validate',
  log: loggerOf(() => {}),
  say: () => {},
});

const base = (): HostOptions => ({ path: '/tmp/validate', agents: [echo({ path: '/tmp/validate' })] });

const agent = (provider: string): Agent => ({ ...echo({ path: '/tmp/validate' }), provider });

/** A view capability: a record of the adapter or engine shows a view on `main`. */
const viewCapability = (parts: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'view',
  name: 'main',
  title: 'Plan',
  description: 'The plan usage of the account.',
  ...parts,
});

/** An adapter that declares the capabilities it is handed. */
const adapterWith = (capabilities: unknown[]): Record<string, unknown> => ({
  name: 'probe',
  title: 'Probe',
  description: 'An account that shows its plan.',
  schema: { type: 'object', properties: {} },
  capabilities,
  open: () => {},
});

/** An engine that declares the capabilities it is handed. */
const engineWith = (capabilities: unknown[]): Record<string, unknown> => ({
  name: 'claude',
  title: 'Claude',
  description: 'An agent on Claude Code.',
  schema: { type: 'object', properties: {} },
  capabilities,
  open: () => agent('claude'),
});

const tool = (name: string): HostTool => ({
  definition: { name, description: `${name} tool`, inputSchema: { type: 'object', properties: {} } },
  run: () => name,
});

/** A tunnel kind with the handlers every kind has, which each case changes. */
const tunnelKind = (parts: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'devtunnel',
  title: 'Dev Tunnel',
  description: 'A tunnel through the Dev Tunnels service.',
  schema: { type: 'object', properties: {} },
  create: () => {},
  remove: () => {},
  invoke: () => {},
  ...parts,
});

/** A provider with the one member the contract requires. */
const provider = { read: (): void => {} };

/** Every required member of every port, as the interfaces name them today. */
const ports = {
  resources: { list: () => {}, read: () => {}, resolve: () => {}, complete: () => {} },
  terminals: { create: () => {} },
  changes: { scopes: () => {}, state: () => {}, summary: () => {} },
  directories: { meta: () => {} },
  worktrees: { repository: () => {}, branches: () => {}, create: () => {}, dirty: () => {}, remove: () => {} },
  github: { resource: {}, forBranch: () => {}, create: () => {} },
  automations: {
    list: () => {}, get: () => {}, triggers: () => {}, create: () => {}, update: () => {},
    remove: () => {}, run: () => {}, runOf: () => {}, runs: () => {},
  },
  sessions: {
    flags: () => {}, setFlags: () => {}, config: () => {}, setConfig: () => {},
    scope: () => {}, setScope: () => {}, owner: () => {}, setOwner: () => {},
    sender: () => {}, setSender: () => {}, provider: () => {}, setProvider: () => {},
    changes: () => {}, setChanges: () => {},
    artifacts: () => {}, setArtifacts: () => {}, pullRequests: () => {}, setPullRequests: () => {},
    chatTitle: () => {}, setChatTitle: () => {}, chats: () => {}, setChats: () => {}, forget: () => {},
    chatFlags: () => {}, setChatFlags: () => {}, moveChat: () => {},
    sessions: () => {},
  },
  diagnostics: {},
  usage: { record: () => {}, total: () => {}, pools: () => {}, records: () => {}, groups: () => {} },
};

const sessionsWithoutChatTitle = (): Record<string, unknown> => {
  const { chatTitle: _chatTitle, setChatTitle: _setChatTitle, ...rest } = ports.sessions;
  return rest;
};

const sessionsWithoutASessionList = (): Record<string, unknown> => {
  const { sessions: _sessions, ...rest } = ports.sessions;
  return rest;
};

describe('pluginHost', () => {
  it('accepts a complete Agent, HostTool and every port, and the fold sees them', () => {
    const { host, contribution } = pluginHost('alpha', context());
    host.registerAgent(agent('alpha'));
    host.registerTool(tool('alpha'));
    host.registerResources(ports.resources as never);
    host.registerTerminals(ports.terminals as never);
    host.registerChanges(ports.changes as never);
    host.registerDirectories(ports.directories as never);
    host.registerWorktrees(ports.worktrees as never);
    host.registerGithub(ports.github as never);
    host.registerAutomations(ports.automations as never);
    host.registerSessions(ports.sessions as never);
    host.registerDiagnostics(ports.diagnostics as never);
    host.registerUsage(ports.usage as never);
    host.registerResourceProvider('computer', provider as never);

    const { options, problems } = foldHostOptions(base(), [contribution]);
    expect(problems).toEqual([]);
    expect(options.agents.map((one) => one.provider)).toEqual(['echo', 'alpha']);
    expect(options.tools?.map((one) => one.definition.name)).toEqual(['alpha']);
    expect(options.resources).toBe(ports.resources);
    expect(options.terminals).toBe(ports.terminals);
    expect(options.changes).toBe(ports.changes);
    expect(options.directories).toBe(ports.directories);
    expect(options.worktrees).toBe(ports.worktrees);
    expect(options.github).toBe(ports.github);
    expect(options.automations).toBe(ports.automations);
    expect(options.sessions).toBe(ports.sessions);
    expect(options.diagnostics).toBe(ports.diagnostics);
    expect(options.usage).toBe(ports.usage);
    expect(options.resourceProviders?.computer).toBe(provider);
  });

  it('refuses an agent with no provider, naming the plugin, the method and the member', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerAgent({} as never)).toThrow(/alpha.*registerAgent.*provider/);
  });

  it('refuses an agent whose variant is not a boolean, and takes one that is', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerAgent({ ...agent('x'), variant: 'yes' } as never)).toThrow(/alpha.*registerAgent.*variant/);
    expect(() => host.registerAgent({ ...agent('y'), variant: true })).not.toThrow();
  });

  it('refuses an agent with a provider but no create, naming create', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerAgent({ provider: 'x', displayName: 'X', schema: () => ({}), defaults: () => ({}) } as never))
      .toThrow(/create/);
  });

  it('refuses a tool whose definition has no name, and one with no run', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerTool({ definition: {}, run: () => '' } as never)).toThrow(/name/);
    expect(() => host.registerTool({ definition: { name: 'x' } } as never)).toThrow(/run/);
  });

  it('takes a tool still carrying the compact wording a plugin copied, and reads nothing of it', () => {
    // `compact` left `HostTool` with the member it fed, and `checkTool` checks
    // the members its table lists and no others, so an older plugin's copy
    // registers unchanged.
    const { host, contribution } = pluginHost('alpha', context());
    expect(() => host.registerTool({ ...tool('legacy'), compact: { instruction: 'short' } } as never)).not.toThrow();
    const { options, problems } = foldHostOptions(base(), [contribution]);
    expect(problems).toEqual([]);
    expect(options.tools?.map((one) => one.definition.name)).toEqual(['legacy']);
  });

  it('refuses a session _meta reader that is not a function, naming the reader', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerSessionMeta('ahpd.tasks', {} as never)).toThrow(/alpha.*registerSessionMeta.*reader/);
  });

  it('refuses a resources store with no list, and terminals with no create', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerResources({} as never)).toThrow(/list/);
    expect(() => host.registerTerminals({} as never)).toThrow(/create/);
  });

  it('refuses a usage store that can append but cannot answer a total', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerUsage({ record: () => {} } as never)).toThrow(/alpha.*registerUsage.*total/);
  });

  it('refuses a sessions store missing chatTitle, which a later interface change added', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerSessions(sessionsWithoutChatTitle() as never)).toThrow(/chatTitle/);
  });

  it('refuses a sessions store that cannot list the ids it holds', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerSessions(sessionsWithoutASessionList() as never)).toThrow(/registerSessions.*sessions/);
  });

  /*
   * Every member a port's type requires is checked, so a store lacking one is
   * refused naming it rather than accepted and failing at its first use.
   */
  it('refuses a sessions or usage store lacking any member its type requires, naming it', () => {
    const lacking = (store: Record<string, unknown>, member: string): Record<string, unknown> =>
      Object.fromEntries(Object.entries(store).filter(([key]) => key !== member));
    for (const member of ['scope', 'setScope', 'owner', 'setOwner', 'sender', 'setSender', 'provider', 'setProvider', 'changes', 'setChanges', 'moveChat']) {
      const { host } = pluginHost('alpha', context());
      expect(() => host.registerSessions(lacking(ports.sessions, member) as never)).toThrow(new RegExp(`alpha.*registerSessions.*\\b${member}\\b`));
    }
    for (const member of ['pools', 'records', 'groups']) {
      const { host } = pluginHost('alpha', context());
      expect(() => host.registerUsage(lacking(ports.usage, member) as never)).toThrow(new RegExp(`alpha.*registerUsage.*\\b${member}\\b`));
    }
  });

  it('accepts empty diagnostics and an agent with no probe, because both are optional', () => {
    const { host } = pluginHost('alpha', context());
    host.registerDiagnostics({} as never);
    const bare: Record<string, unknown> = {
      provider: 'bare', displayName: 'Bare', schema: () => ({}), defaults: () => ({}), create: () => ({}),
    };
    expect(() => host.registerAgent(bare as never)).not.toThrow();
  });

  it('refuses the same plugin registering one port twice, naming the port', () => {
    const { host } = pluginHost('alpha', context());
    host.registerResources(ports.resources as never);
    expect(() => host.registerResources(ports.resources as never)).toThrow(/alpha.*resources/);
  });

  it('accepts a provider with only read, and refuses what is not a function', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerResourceProvider('computer', { read: () => {} } as never)).not.toThrow();
    // `read` is the one required member, and a provider that cannot answer
    // bytes serves nothing.
    expect(() => host.registerResourceProvider('notes', {} as never)).toThrow(/alpha.*registerResourceProvider.*read/);
    // Everything else is optional, which says it may be left out and not that
    // it may be anything.
    expect(() => host.registerResourceProvider('notes', { read: () => {}, list: 'nope' } as never)).toThrow(/list/);
    // `describe` is optional and is a function when it is there, so a provider
    // that says what its scheme is for is accepted and a value that is not a
    // method is not.
    expect(() => host.registerResourceProvider('notes', { read: () => {}, describe: () => ({ title: 'Notes' }) } as never)).not.toThrow();
    expect(() => host.registerResourceProvider('notes', { read: () => {}, describe: 'Notes' } as never)).toThrow(/describe/);
  });

  it('accepts a complete channel, and refuses an empty one or a grant that is not one', () => {
    const { host, contribution } = pluginHost('alpha', context());
    const channel = { grant: 'session:read', snapshot: () => ({}), authorize: async () => true, left: () => {}, describe: () => ({ title: 'Bots' }) };
    expect(() => host.registerChannel('x-bots', channel as never)).not.toThrow();
    expect(() => host.registerChannel('x-notes', {} as never)).toThrow(/alpha.*registerChannel.*grant/);
    expect(() => host.registerChannel('x-notes', { grant: 'nothing', snapshot: () => ({}) } as never)).toThrow(/grant like bot:read/);
    expect(() => host.registerChannel('x-notes', { grant: 'bot:read' } as never)).toThrow(/snapshot/);
    // The optional members may be left out, and are functions when they are there.
    expect(() => host.registerChannel('x-notes', { grant: 'bot:read', snapshot: () => ({}), left: 'no' } as never)).toThrow(/left/);
    expect(() => host.registerChannel('x-notes', { grant: 'bot:read', snapshot: () => ({}), describe: 'Notes' } as never)).toThrow(/describe/);
    expect(() => host.registerChannel('9bad', channel as never)).toThrow(/alpha.*registerChannel.*URI scheme/);
    const { options, problems } = foldHostOptions(base(), [contribution]);
    expect(problems).toEqual([]);
    expect(options.channels?.['x-bots']?.channel).toBe(channel);
  });

  it('accepts a complete method, and refuses an empty one or a grant that is not one', () => {
    const { host, contribution } = pluginHost('alpha', context());
    const method = { grant: 'session:list', handle: () => ({}), authorize: async () => true, describe: () => ({ title: 'Echo' }) };
    expect(() => host.registerMethod('x-alpha/echo', method as never)).not.toThrow();
    expect(() => host.registerMethod('x-alpha/notes', {} as never)).toThrow(/alpha.*registerMethod.*grant/);
    expect(() => host.registerMethod('x-alpha/notes', { grant: 'nothing', handle: () => ({}) } as never)).toThrow(/grant like bot:read/);
    expect(() => host.registerMethod('x-alpha/notes', { grant: 'bot:read' } as never)).toThrow(/handle/);
    // The optional members may be left out, and are functions when they are there.
    expect(() => host.registerMethod('x-alpha/notes', { grant: 'bot:read', handle: () => ({}), authorize: 'no' } as never)).toThrow(/authorize/);
    expect(() => host.registerMethod('x-alpha/notes', { grant: 'bot:read', handle: () => ({}), describe: 'Notes' } as never)).toThrow(/describe/);
    expect(() => host.registerMethod(7 as never, method as never)).toThrow(/alpha.*registerMethod.*starts with x-/);
    const { options, problems } = foldHostOptions(base(), [contribution]);
    expect(problems).toEqual([]);
    expect(options.methods?.['x-alpha/echo']?.method).toBe(method);
  });

  it('accepts a complete provider configuration, and refuses an empty one or one missing a member', () => {
    const { host, contribution } = pluginHost('alpha', context());
    const named = { provider: 'notes', title: 'Notes', description: 'Notes the agent keeps.' };
    const registration = {
      ...named,
      settings: [{ key: 'notes.enabled', group: 'Notes' }],
      properties: { 'notes.enabled': { type: 'boolean', title: 'Notes', default: false } },
    };
    expect(() => host.registerProviderConfiguration(registration as never)).not.toThrow();
    expect(() => host.registerProviderConfiguration({} as never)).toThrow(/alpha.*registerProviderConfiguration.*a non-empty provider/);
    expect(() => host.registerProviderConfiguration({ provider: 'other' } as never)).toThrow(/a title and a description/);
    expect(() => host.registerProviderConfiguration({ ...named, provider: 'other', settings: [{ key: 'other.enabled' }], properties: {} } as never))
      .toThrow(/settings, each with a key and a group/);
    expect(() => host.registerProviderConfiguration({ ...named, provider: 'other', settings: [], properties: { 'other.enabled': true } } as never))
      .toThrow(/properties, each a JSON Schema property object/);
    expect(() => host.registerProviderConfiguration(registration as never)).toThrow(/alpha.*registerProviderConfiguration.*notes/);
    const { options, problems } = foldHostOptions(base(), [contribution]);
    expect(problems).toEqual([]);
    expect(options.providerConfigurations?.map((one) => one.provider)).toEqual(['notes']);
  });

  it('accepts a complete changeset operation contribution, and refuses an empty one or a handler that is not a function', () => {
    const { host, contribution } = pluginHost('alpha', context());
    const offered = { operations: () => [], handlers: { 'merge-request': async () => ({}) } };
    expect(() => host.registerChangesetOperations(offered as never)).not.toThrow();
    expect(() => host.registerChangesetOperations({} as never)).toThrow(/alpha.*registerChangesetOperations.*an operations function/);
    expect(() => host.registerChangesetOperations({ operations: () => [], handlers: { 'merge-request': 'merge' } } as never))
      .toThrow(/handlers, each a function by operation id/);
    expect(() => host.registerChangesetOperations(offered as never)).toThrow(/alpha.*registerChangesetOperations.*merge-request/);
    const { options, problems } = foldHostOptions(base(), [contribution]);
    expect(problems).toEqual([]);
    expect(options.changesetOperations?.map((one) => one.operations)).toEqual([offered.operations]);
  });

  it('refuses a scheme that is not one, and the schemes the host already owns', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerResourceProvider('9bad', provider as never)).toThrow(/URI scheme/);
    expect(() => host.registerResourceProvider('', provider as never)).toThrow(/URI scheme/);
    expect(() => host.registerResourceProvider('file', provider as never)).toThrow(/has not reserved; file is the host's own store/);
    expect(() => host.registerResourceProvider('ahp-root', provider as never)).toThrow(/has not reserved; ahp-/);
  });

  it('refuses a reserved name as a scheme, in any case', () => {
    const { host } = pluginHost('alpha', context());
    for (const scheme of ['ahp-root', 'ahpd-bots', 'x-thing', 'session', 'automations', 'HTTPS', 'User']) {
      expect(() => host.registerResourceProvider(scheme, provider as never), scheme).toThrow(/alpha.*registerResourceProvider.*has not reserved/);
    }
  });

  it('refuses a reserved name as a harness', () => {
    const { host } = pluginHost('alpha', context());
    for (const name of ['ahp-chat', 'ahp-session', 'ahpd-bot', 'file', 'automations', 'user', 'X-Agent']) {
      expect(() => host.registerAgent(agent(name)), name).toThrow(/alpha.*registerAgent.*has not reserved/);
    }
  });

  it('loads the first-party harnesses and schemes', () => {
    const { host } = pluginHost('alpha', context());
    for (const name of ['claude', 'pi', 'acp', 'cofold']) expect(() => host.registerAgent(agent(name)), name).not.toThrow();
    for (const scheme of ['bot', 'computer', 'push']) expect(() => host.registerResourceProvider(scheme, provider as never), scheme).not.toThrow();
  });

  it('refuses a daemon agent with a reserved name when the host is built', () => {
    const named = { ...echo({ path: '/tmp/validate' }), provider: 'ahp-root' };
    expect(() => createHost({ path: '/tmp/validate', agents: [named] })).toThrow(/may not call itself ahp-root: ahp- names/);
  });

  it('drops a harness and a scheme that share a name, whichever comes first', () => {
    const schemes = pluginHost('bots', context());
    schemes.host.registerResourceProvider('bot', provider as never);
    const agents = pluginHost('agents', context());
    agents.host.registerAgent(agent('Bot'));
    agents.host.registerAgent(agent('kept'));

    const first = foldHostOptions(base(), [schemes.contribution, agents.contribution]);
    expect(first.problems).toEqual([expect.stringMatching(/^plugin agents registers agent Bot, which plugin bots already registered as a scheme$/u)]);
    expect(first.options.agents?.map((one) => one.provider)).toContain('kept');
    expect(first.options.agents?.map((one) => one.provider)).not.toContain('Bot');

    const later = pluginHost('claude', context());
    later.host.registerAgent(agent('claude'));
    const scheme = pluginHost('late', context());
    scheme.host.registerResourceProvider('claude', provider as never);
    const second = foldHostOptions(base(), [later.contribution, scheme.contribution]);
    expect(second.problems).toEqual([expect.stringMatching(/^plugin late registers scheme claude, which plugin claude already registered as an agent$/u)]);
    expect(second.options.resourceProviders?.['claude']).toBeUndefined();
  });

  it('refuses one plugin registering one scheme twice, and leaves two plugins to the fold', () => {
    const one = pluginHost('alpha', context());
    one.host.registerResourceProvider('computer', provider as never);
    expect(() => one.host.registerResourceProvider('computer', provider as never)).toThrow(/computer/);
  });

  it('refuses two agents with one provider inside a plugin, and leaves two plugins to the fold', () => {
    const one = pluginHost('alpha', context());
    one.host.registerAgent(agent('same'));
    expect(() => one.host.registerAgent(agent('same'))).toThrow(/same/);

    const other = pluginHost('beta', context());
    other.host.registerAgent(agent('same'));
    const { problems } = foldHostOptions(base(), [one.contribution, other.contribution]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('same');
  });

  it('accepts a route handler and folds it under the plugin\'s own name', async () => {
    const { host, contribution } = pluginHost('alpha', context());
    const handler = async (): Promise<Response> => new Response('alpha');
    host.registerRoute(handler);

    // The recorded handler is the one given, not a copy: a route holds whatever
    // its plugin's closure holds.
    expect(contribution.routes).toBe(handler);
    const { routes, problems } = foldHostOptions(base(), [contribution]);
    expect(problems).toEqual([]);
    expect(routes['alpha']).toBe(handler);
    expect(await routes['alpha']?.(new Request('http://h/plugins/alpha/hook'))).toBeInstanceOf(Response);
  });

  it('records no route for a plugin that registered none', () => {
    const { contribution } = pluginHost('alpha', context());
    expect(contribution.routes).toBeUndefined();
    expect(foldHostOptions(base(), [contribution]).routes).toEqual({});
  });

  it('refuses a handler that is not a function, naming the plugin and the method', () => {
    const { host } = pluginHost('alpha', context());
    // A JavaScript plugin has no type to stop it registering an object, and
    // the object is only found out when a webhook arrives, which is late.
    expect(() => host.registerRoute({} as never)).toThrow(/alpha.*registerRoute.*handler/);
    expect(() => host.registerRoute('nope' as never)).toThrow(/alpha.*registerRoute.*handler/);
  });

  it('refuses one plugin registering two routes, and leaves two plugins to the fold', () => {
    const one = pluginHost('alpha', context());
    one.host.registerRoute(async () => new Response('first'));
    expect(() => one.host.registerRoute(async () => new Response('second')))
      .toThrow(/alpha.*registerRoute.*handler.*only once/);

    const other = pluginHost('beta', context());
    other.host.registerRoute(async () => new Response('beta'));
    const { routes, problems } = foldHostOptions(base(), [one.contribution, other.contribution]);
    expect(problems).toEqual([]);
    expect(Object.keys(routes)).toEqual(['alpha', 'beta']);
  });

  it('refuses a device sign-in with no poll, naming the plugin, the method and the member', () => {
    const { host } = pluginHost('alpha', context());
    const adapter = {
      name: 'device',
      title: 'Device',
      description: 'An account that signs in on another device.',
      schema: { type: 'object', properties: { token: { type: 'string', secret: true } } },
      capabilities: [],
      open: () => {},
      signIn: {
        flow: 'device',
        title: 'Sign in with Device',
        field: 'token',
        start: async () => ({ code: 'the-code', url: 'https://vendor.test/device', expires: 900, interval: 5, handle: 'h' }),
      },
    };

    expect(() => host.registerAdapter(adapter as never)).toThrow(/alpha.*registerAdapter.*signIn\.poll/);
  });

  it('refuses an account field the schema marks secret, so the account stays in the record', () => {
    const { host } = pluginHost('alpha', context());
    const adapter = {
      name: 'device',
      title: 'Device',
      description: 'An account that signs in on another device.',
      schema: {
        type: 'object',
        properties: {
          token: { type: 'string', secret: true },
          account: { type: 'string', secret: true },
        },
      },
      capabilities: [],
      open: () => {},
      signIn: {
        flow: 'device',
        title: 'Sign in with Device',
        field: 'token',
        account: 'account',
        start: async () => ({ code: 'the-code', url: 'https://vendor.test/device', expires: 900, interval: 5, handle: 'h' }),
        poll: async () => ({ wait: 5 }),
      },
    };

    expect(() => host.registerAdapter(adapter as never)).toThrow(/alpha.*registerAdapter.*does not mark secret/);
  });

  it('registers an adapter and an engine with a view capability named main', () => {
    const one = pluginHost('alpha', context());
    one.host.registerAdapter(adapterWith([viewCapability()]) as never);
    expect(one.contribution.adapters?.['probe']?.capabilities).toEqual([viewCapability()]);

    const other = pluginHost('alpha', context());
    other.host.registerEngine(engineWith([viewCapability()]) as never);
    expect(other.contribution.engines?.['claude']?.capabilities).toEqual([viewCapability()]);
  });

  it('refuses a view capability named for a surface the host does not know', () => {
    const side = viewCapability({ name: 'side' });
    const one = pluginHost('alpha', context());
    expect(() => one.host.registerAdapter(adapterWith([side]) as never))
      .toThrow(/alpha.*registerAdapter.*name.*a view capability named for a surface, one of main, and side is not one/);

    const other = pluginHost('alpha', context());
    expect(() => other.host.registerEngine(engineWith([side]) as never))
      .toThrow(/alpha.*registerEngine.*name.*a view capability named for a surface, one of main, and side is not one/);
  });

  it('keeps the plugin\'s methods on the adapter and the engine, for a Button in a record\'s view', () => {
    const one = pluginHost('alpha', context());
    one.host.registerAdapter(adapterWith([viewCapability()]) as never);
    one.host.registerEngine(engineWith([viewCapability()]) as never);
    one.host.registerMethod('x-alpha/go', { grant: 'demo:read', handle: () => ({}) });
    expect(Object.keys(one.contribution.adapters?.['probe']?.methods ?? {})).toEqual(['x-alpha/go']);
    expect(Object.keys(one.contribution.engines?.['claude']?.methods ?? {})).toEqual(['x-alpha/go']);
  });

  it('refuses a tunnel kind with no invoke, naming the plugin, the method and the member', () => {
    const { host } = pluginHost('alpha', context());
    const kind = tunnelKind();
    delete kind.invoke;

    expect(() => host.registerTunnelKind(kind as never)).toThrow(/alpha.*registerTunnelKind.*invoke/);
  });

  it('refuses a tunnel operation the host already serves, naming it', () => {
    const { host } = pluginHost('alpha', context());
    const kind = tunnelKind({ operations: [{ id: 'create', label: 'Make a tunnel' }] });

    expect(() => host.registerTunnelKind(kind as never)).toThrow(/alpha.*registerTunnelKind.*operation create/);
  });

  it('refuses two tunnel operations with one id', () => {
    const { host } = pluginHost('alpha', context());
    const kind = tunnelKind({ operations: [{ id: 'restart' }, { id: 'restart' }] });

    expect(() => host.registerTunnelKind(kind as never)).toThrow(/alpha.*registerTunnelKind.*operation restart/);
  });

  it('refuses a tunnel operation whose input is not an object schema', () => {
    const { host } = pluginHost('alpha', context());
    const kind = tunnelKind({ operations: [{ id: 'restart', input: 'a port' }] });

    expect(() => host.registerTunnelKind(kind as never)).toThrow(/alpha.*registerTunnelKind.*restart input/);
  });

  it('refuses a tunnel operation whose grant is not <subject>:<operation>', () => {
    const { host } = pluginHost('alpha', context());
    const kind = tunnelKind({ operations: [{ id: 'restart', grant: 'restart' }] });

    expect(() => host.registerTunnelKind(kind as never)).toThrow(/alpha.*registerTunnelKind.*restart grant/);
  });
});
