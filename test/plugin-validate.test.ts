import { describe, expect, it } from 'vitest';
import { foldHostOptions, pluginHost } from '../packages/sdk/src/plugins.js';
import { sdkVersion } from '../packages/sdk/src/version.js';
import { echo } from '../examples/echo/agent.js';
import type { Agent } from '../packages/sdk/src/types/agent.js';
import type { HostOptions, HostTool } from '../packages/sdk/src/types/host.js';
import type { PluginContext } from '../packages/sdk/src/types/plugin.js';

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

const context = (): PluginContext => ({
  path: '/tmp/validate',
  paths: ['/tmp/validate'],
  version: sdkVersion(),
  log: () => {},
});

const base = (): HostOptions => ({ path: '/tmp/validate', agents: [echo({ path: '/tmp/validate' })] });

const agent = (provider: string): Agent => ({ ...echo({ path: '/tmp/validate' }), provider });

const tool = (name: string): HostTool => ({
  definition: { name, description: `${name} tool`, inputSchema: { type: 'object', properties: {} } },
  run: () => name,
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
    artifacts: () => {}, setArtifacts: () => {}, pullRequests: () => {}, setPullRequests: () => {},
    chatTitle: () => {}, setChatTitle: () => {}, forget: () => {},
  },
  diagnostics: {},
};

const sessionsWithoutChatTitle = (): Record<string, unknown> => {
  const { chatTitle: _chatTitle, setChatTitle: _setChatTitle, ...rest } = ports.sessions;
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
    expect(options.resourceProviders?.computer).toBe(provider);
  });

  it('refuses an agent with no provider, naming the plugin, the method and the member', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerAgent({} as never)).toThrow(/alpha.*registerAgent.*provider/);
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

  it('refuses a resources store with no list, and terminals with no create', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerResources({} as never)).toThrow(/list/);
    expect(() => host.registerTerminals({} as never)).toThrow(/create/);
  });

  it('refuses a sessions store missing chatTitle, which a later interface change added', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerSessions(sessionsWithoutChatTitle() as never)).toThrow(/chatTitle/);
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
  });

  it('refuses a scheme that is not one, and the schemes the host already owns', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerResourceProvider('9bad', provider as never)).toThrow(/URI scheme/);
    expect(() => host.registerResourceProvider('', provider as never)).toThrow(/URI scheme/);
    expect(() => host.registerResourceProvider('file', provider as never)).toThrow(/its own/);
    expect(() => host.registerResourceProvider('ahp-root', provider as never)).toThrow(/its own/);
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
});
