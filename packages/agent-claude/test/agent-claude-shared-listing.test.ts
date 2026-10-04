import { expect, it, vi } from 'vitest';
import { join } from 'node:path';

/*
 * One listing for the variants of one load.
 *
 * Every preset this plugin registers is an agent of its own, and every one of
 * them reads the same projects directory for the same sessions - three presets
 * is three `listSessions` over the same files for one answer, and on dev-01 one
 * of those took fifty seconds. The sharing is inside the plugin, because the
 * host has no way to know that two agents read one store: `registerAgent`
 * records no plugin and `Agent` has no key for a store.
 */

const sdk = vi.hoisted(() => ({
  listed: 0,
  sessions: [] as Record<string, unknown>[],
  options: [] as Record<string, unknown>[],
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  listSessions: async () => {
    sdk.listed += 1;
    // A tick, so callers meant to share a listing really do overlap: without
    // it a listing is finished before the second caller asks for one, and two
    // listings are indistinguishable from one.
    await new Promise((done) => { setTimeout(done, 0); });
    return sdk.sessions;
  },
  query: ({ options }: { options: Record<string, unknown> }) => {
    sdk.options.push(options);
    return {
      async *[Symbol.asyncIterator]() { /* nothing streamed */ },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      setMcpServers: async () => {},
      initializationResult: async () => ({}),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [] }),
      reloadPlugins: async () => ({ plugins: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => {},
    };
  },
}));

const { loadPlugins } = await import('../../server/src/plugins.js');
const { echo } = await import('../../../examples/echo/agent.js');

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-claude/src/index.ts';
const PATH = '/tmp/ahpd-shared-listing';

const listed = (sessionId: string, summary: string): Record<string, unknown> => ({
  sessionId, summary, lastModified: 1_800_000_000_000, cwd: PATH,
});

/** The agents one load of the plugin registered, beside the echo in the base. */
const variants = async (options: Record<string, unknown>) => {
  const { problems, options: served } = await loadPlugins([{ name: SOURCE, options }], {
    base: { path: PATH, agents: [echo({ path: PATH })] },
    configDir: REPO,
    cwd: REPO,
    log: () => {},
  });
  expect(problems).toEqual([]);
  return (served.agents ?? []).slice(1);
};

const presets = {
  'claude-openrouter': { name: 'Claude OpenRouter' },
  'claude-openrouter-build': { name: 'Claude OpenRouter Build' },
};

it('reads the projects directory once for three variants of one load', async () => {
  sdk.listed = 0;
  sdk.sessions = [listed('one', 'One')];
  const agents = await variants({ presets });
  expect(agents).toHaveLength(3);

  // What the host does with a listing, once the change to ask every agent at
  // the same time: three `list` calls, three variants, one directory read.
  const answered = await Promise.all(agents.map((agent) => agent.list?.()));
  expect(sdk.listed).toBe(1);
  for (const rows of answered) {
    expect(rows?.map((one) => one.id)).toEqual(['one']);
  }
});

it('gives each variant its own array of the rows', async () => {
  sdk.listed = 0;
  sdk.sessions = [listed('one', 'One')];
  const agents = await variants({ presets });
  const [first, second] = await Promise.all([agents[0]?.list?.(), agents[1]?.list?.()]) as [{ id: string }[], { id: string }[]];
  // One listing is shared; a variant handing out another's array would be one
  // caller's rows turning into another's.
  expect(sdk.listed).toBe(1);
  expect(first).not.toBe(second);
  expect(first).toEqual(second);
});

it('lists again for the next listing, once the first has settled', async () => {
  sdk.listed = 0;
  sdk.sessions = [listed('one', 'One')];
  const agents = await variants({ presets });
  await Promise.all(agents.map((agent) => agent.list?.()));
  expect(sdk.listed).toBe(1);
  // The host holds the catalogue, so nothing here is a cache: a second
  // listing is a second read, or a session written since would never appear.
  await Promise.all(agents.map((agent) => agent.list?.()));
  expect(sdk.listed).toBe(2);
});

it('lists on its own when a variant is registered outside a plugin load', async () => {
  sdk.listed = 0;
  sdk.sessions = [listed('one', 'One')];
  // The built-in agent, built directly rather than through `apply`: nothing
  // hands it a listing, so it reads the directory itself.
  const { claude } = await import('../src/claude.js');
  const agent = claude({ paths: [PATH] });
  expect((await agent.list?.())?.map((one) => one.id)).toEqual(['one']);
  expect(sdk.listed).toBe(1);
});

it('hands the same listing to every variant of one load and no other', async () => {
  sdk.listed = 0;
  sdk.sessions = [listed('one', 'One')];
  // Two loads of the plugin, so two listings: the sharing is within a load,
  // and a preset that read a different `paths` would have to get its own.
  const first = await variants({ presets });
  const second = await variants({ presets: { 'claude-other': { name: 'Claude Other' } } });
  expect(first).toHaveLength(3);
  // The built-in is always registered, so this load is it and the one named.
  expect(second).toHaveLength(2);
  await Promise.all([...first, ...second].map((agent) => agent.list?.()));
  expect(sdk.listed).toBe(2);
});