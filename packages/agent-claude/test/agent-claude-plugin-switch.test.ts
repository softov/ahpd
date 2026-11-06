import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AgentView, Bag, BoundTool, Start } from '@ahpd/sdk';
import { echo } from '../../../examples/echo/agent.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { startedNow } from '../../sdk/test/support/started.js';

/*
 * A switch on a plugin the CLI loaded, the CLI's own built-ins included.
 *
 * The CLI has no call for it. What it takes is an `enabledPlugins` setting,
 * read when it loads its plugins, and a reload to make it now - so the switch
 * is those two, in that order, and the answer is what the reload listed: a
 * plugin gone from that list is one that stopped being loaded, and one still
 * in it is a switch the CLI did not take, which is a refusal rather than a
 * row that flips back on the next report.
 */

const sdk = vi.hoisted(() => {
  /** What the CLI ships, as its reload describes them. */
  const ALL = [
    { name: 'cc-plugin-agents-md', path: 'builtin', source: 'cc-plugin-agents-md@builtin' },
    { name: 'cc-plugin-telemetry', path: 'builtin', source: 'cc-plugin-telemetry@builtin' },
  ];
  const held = {
    ALL,
    /** Which of them the flag settings have left being loaded, by name. */
    loading: new Set<string>(ALL.map((one) => one.name)),
    /** A CLI that will not take the setting, which is one that does not have it. */
    deaf: false,
    /** Every call the CLI was asked to make, in the order it was asked. */
    order: [] as string[],
    /** What each `applyFlagSettings` was given. */
    settings: [] as Bag[],
    /** The options each query was built with, in the order one was built. */
    options: [] as Record<string, unknown>[],
    reset() {
      held.loading = new Set(ALL.map((one) => one.name));
      held.deaf = false;
      held.order = [];
      held.settings = [];
      held.options = [];
    },
  };
  return held;
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: (given: { options: Record<string, unknown> }) => {
    sdk.options.push(given.options);
    return {
      // A stream that never says anything and never ends: the session is opened
      // and switched, not run.
      async *[Symbol.asyncIterator]() { await new Promise(() => {}); },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async (settings: Bag) => {
        sdk.order.push('applyFlagSettings');
        sdk.settings.push(settings);
        if (sdk.deaf) return;
        for (const [source, on] of Object.entries((settings.enabledPlugins ?? {}) as Record<string, boolean>)) {
          const one = sdk.ALL.find((plugin) => (plugin.source ?? `${plugin.name}@${plugin.path}`) === source);
          if (one === undefined) continue;
          if (on) sdk.loading.add(one.name);
          else sdk.loading.delete(one.name);
        }
      },
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      setMcpServers: async () => {},
      // The style the preset names, already what the CLI answers in, so the
      // handshake applies nothing and the only settings here are a switch's.
      initializationResult: async () => ({
        output_style: 'Concise',
        models: [],
        commands: [{ name: 'review', description: 'Look at this' }],
        agents: [],
      }),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [{ name: 'review', description: 'Look at this' }] }),
      reloadPlugins: async () => {
        sdk.order.push('reloadPlugins');
        return { plugins: sdk.ALL.filter((one) => sdk.loading.has(one.name)) };
      },
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => {},
    };
  },
}));

const { createSession } = await import('../src/session.js');

/** One session over a CLI with the two built-ins, once its handshake is in. */
const opened = async (): Promise<{ session: ReturnType<typeof createSession>; said: Bag[] }> => {
  const said: Bag[] = [];
  let handshook = (): void => {};
  const shook = new Promise<void>((done) => { handshook = done; });
  const session = createSession({
    uri: 'ahp-session:/plugin-switch',
    chatUri: 'ahp-chat:/plugin-switch',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-switch-')),
    emit: (_channel: string, action: Bag) => { said.push(action); },
    // A style, so what a switch sends is the whole flag set rather than the
    // one key it is moving.
    preset: { outputStyle: 'Concise' },
    onHandshake: () => { handshook(); },
  } as never);
  await shook;
  // The handshake reloads the plugins to find out what there is, which is not
  // a switch: what a case reads here is what a switch asked for.
  sdk.order = [];
  return { session, said };
};

/** What a session published as its list, the last time it published one. */
const lastList = (said: Bag[]): Bag[] => {
  const changes = said.filter((one) => one.type === 'session/customizationsChanged');
  return (changes.at(-1)?.customizations ?? []) as Bag[];
};

const containerOf = (list: Bag[], name: string): Bag | undefined =>
  list.find((one) => one.id === `plugin:${name}`);

beforeEach(() => { sdk.reset(); });

it('sends the plugin as a flag setting and reloads, in that order, and answers true', async () => {
  const { session, said } = await opened();
  expect(containerOf(session.customizations(), 'cc-plugin-agents-md')).toBeDefined();
  expect(said.filter((one) => one.type === 'session/customizationsChanged')).toHaveLength(1);

  expect(await session.setCustomizationEnabled('plugin:cc-plugin-agents-md', false)).toBe(true);

  expect(sdk.order).toEqual(['applyFlagSettings', 'reloadPlugins']);
  expect(sdk.settings[0]).toEqual({
    outputStyle: 'Concise',
    enabledPlugins: { 'cc-plugin-agents-md@builtin': false },
  });
  await session.close();
});

it('keeps the plugin in the list with the session switched off, and says the list again', async () => {
  const { session, said } = await opened();
  expect(await session.setCustomizationEnabled('plugin:cc-plugin-agents-md', false)).toBe(true);

  // The CLI stopped reporting it - `loading` is what its reload lists - and
  // the row is still there, because a switch is the session's own answer.
  expect(sdk.loading.has('cc-plugin-agents-md')).toBe(false);
  expect(containerOf(lastList(said), 'cc-plugin-agents-md')).toMatchObject({
    type: 'plugin',
    uri: 'cc-plugin-agents-md@builtin',
    enablement: [{ kind: 'session', enabled: false }],
  });
  // And only that one: the other built-in is a plugin nobody decided about.
  expect(containerOf(lastList(said), 'cc-plugin-telemetry')).not.toHaveProperty('enablement');
  await session.close();
});

it('answers true for switching it back on, and the row carries no decision again', async () => {
  const { session, said } = await opened();
  await session.setCustomizationEnabled('plugin:cc-plugin-agents-md', false);

  expect(await session.setCustomizationEnabled('plugin:cc-plugin-agents-md', true)).toBe(true);
  expect(sdk.settings.at(-1)).toEqual({
    outputStyle: 'Concise',
    enabledPlugins: { 'cc-plugin-agents-md@builtin': true },
  });
  expect(containerOf(lastList(said), 'cc-plugin-agents-md')).not.toHaveProperty('enablement');
  await session.close();
});

it('sends what the session decided before beside the plugin it is moving', async () => {
  const { session } = await opened();
  await session.setCustomizationEnabled('plugin:cc-plugin-agents-md', false);
  await session.setCustomizationEnabled('plugin:cc-plugin-telemetry', false);

  // `applyFlagSettings` merges at the top level, so the second switch replaces
  // the whole `enabledPlugins` key: the first plugin's decision has to be in it
  // or the CLI loads it again.
  expect(sdk.settings.at(-1)).toEqual({
    outputStyle: 'Concise',
    enabledPlugins: {
      'cc-plugin-agents-md@builtin': false,
      'cc-plugin-telemetry@builtin': false,
    },
  });
  await session.close();
});

it('answers false when the CLI did not take the switch', async () => {
  const { session, said } = await opened();
  const before = said.filter((one) => one.type === 'session/customizationsChanged').length;
  sdk.deaf = true;

  expect(await session.setCustomizationEnabled('plugin:cc-plugin-agents-md', false)).toBe(false);
  // Nothing is published again: the list says what the CLI says, and the CLI
  // says it is still loading the plugin.
  expect(containerOf(lastList(said), 'cc-plugin-agents-md')).not.toHaveProperty('enablement');
  expect(said.filter((one) => one.type === 'session/customizationsChanged')).toHaveLength(before);
  await session.close();
});

it('answers false for a skill and for a plugin nobody reported, and asks the CLI nothing', async () => {
  const { session } = await opened();

  expect(await session.setCustomizationEnabled('skill:review', false)).toBe(false);
  expect(await session.setCustomizationEnabled('plugin:not-a-plugin', false)).toBe(false);
  expect(sdk.order).toEqual([]);
  await session.close();
});

/*
 * The host tools switch, resolved by a load.
 *
 * `hostTools` is a plugin option and a record field, and a record's value wins.
 * The engine lays the plugin's answer under the record's, so these cases load
 * the plugin and hand its engine one record that reads its config each time.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-claude/src/index.ts';
const ROOT = mkdtempSync(join(tmpdir(), 'ahpd-host-tools-'));

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/** The host's own tool and a client's, as every session here is handed both. */
const HOST_TOOL: BoundTool = {
  definition: { name: 'bash', description: 'Run a shell command.' },
};
const CLIENT_TOOL: BoundTool = {
  definition: { name: 'review', description: 'Review a change.' },
  owner: 'a-client',
};

/** One record of the loaded engine, its config read each time `open` asks. */
const recordOf = (id: string, config: () => Bag): AgentView => ({
  id,
  engine: 'claude',
  owner: 'host',
  name: id,
  description: undefined,
  icon: undefined,
  model: undefined,
  get config() { return config(); },
});

/**
 * The in-process servers one session of a record is declared, by name.
 *
 * `plugin` is the load's options and `config` is the record's, so a case can
 * set one, the other, or both.
 */
const serversOf = async (plugin: Record<string, unknown>, config: () => Bag): Promise<Bag> => {
  sdk.reset();
  const { problems, options: served } = await loadPlugins([{ name: SOURCE, options: plugin }], {
    base: { path: ROOT, agents: [echo({ path: ROOT })] },
    configDir: REPO,
    cwd: REPO,
    log: () => {},
  });
  expect(problems).toEqual([]);
  const engine = served.engines?.['claude'];
  if (engine === undefined) throw new Error('no claude engine was registered');
  const session = startedNow(engine.open(recordOf('claude-host-tools', config)).create({
    uri: 'ahp-session:/host-tools',
    chatUri: 'ahp-chat:/host-tools',
    settings: {},
    workingDirectory: ROOT,
    clientToolTimeoutMs: 0,
    schema: () => ({ type: 'object', properties: {} }),
    emit: () => {},
    tools: [HOST_TOOL, CLIENT_TOOL],
  } as Start));
  await settle();
  const built = sdk.options.at(0);
  if (built === undefined) throw new Error('no query was built');
  await session.close();
  return (built['mcpServers'] ?? {}) as Bag;
};

it('offers the host\'s tools on their server, and a client\'s on its own, by default', async () => {
  const servers = await serversOf({}, () => ({}));

  expect(Object.keys(servers)).toEqual(expect.arrayContaining(['client', 'host']));
});

it('drops the host server when the plugin turns host tools off, and keeps the client server', async () => {
  const servers = await serversOf({ hostTools: false }, () => ({}));

  expect(Object.keys(servers)).toContain('client');
  expect(Object.keys(servers)).not.toContain('host');
});

it('lets a record turn host tools off over a plugin that turns them on', async () => {
  const servers = await serversOf({ hostTools: true }, () => ({ hostTools: false }));

  expect(Object.keys(servers)).toContain('client');
  expect(Object.keys(servers)).not.toContain('host');
});
