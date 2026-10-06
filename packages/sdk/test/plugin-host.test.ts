import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { AGENT_CLASH, foldHostOptions, pluginHost } from '../src/plugins.js';
import { memorySessions } from '../src/sessions.js';
import { echo } from '../../../examples/echo/agent.js';
import { usageProvider } from '../src/usage.js';
import type { Agent } from '../src/types/agent.js';
import type { HostOptions } from '../src/types/host.js';
import type { Contribution, PluginContext } from '../src/types/plugin.js';
import type { Peer } from '../src/types/rpc.js';
import type { Usage } from '../src/types/usage.js';

/*
 * What the fold is for: a host that serves a plugin's backend.
 *
 * `main.ts` is not started here - the daemon domain records why - so this
 * checks the part that matters and can be checked: the object `foldHostOptions`
 * answers is a `HostOptions` in every way `createHost` cares about, and a
 * client that initializes against it sees the contributed backend beside the
 * daemon's own.
 */

const peer = (): Peer => ({
  send: () => {},
  notify: () => {},
  request: async () => ({}),
  answered: () => {},
  close: () => {},
});

const base = (): HostOptions => ({ path: '/tmp/plugin-host', agents: [echo({ path: '/tmp/plugin-host' })] });

const contributed: Agent = {
  ...echo({ path: '/tmp/plugin-host' }),
  provider: 'contributed',
  displayName: 'Contributed backend',
};

const contribution: Contribution = { by: 'fixture', agents: [contributed], tools: [], sessionConfig: {}, sessionCompletions: {}, ports: {}, providers: {}, events: {} };

it('answers whether it keeps a session, from the store and by the id in the URI', async () => {
  const store = memorySessions();
  store.setConfig('one', { computer: 'computer://box' });
  store.setProvider('one', 'echo');
  const context: PluginContext = {
    path: '/tmp/plugin-host',
    paths: ['/tmp/plugin-host'],
    version: '0.0.0',
    hostName: 'host',
    configDir: '/tmp/plugin-host',
    log: () => {},
    say: () => {},
  };

  // The URI's scheme is the backend's own, so a session kept under another
  // provider's id is not this one: the store is keyed by the id inside the
  // URI, and a client that opens `echo:/one` after a session named `acp:/one`
  // has gone writes the same row.
  expect(await pluginHost('fixture', context, { sessions: () => store }).host.sessionKept('echo:/one')).toBe(true);
  expect(await pluginHost('fixture', context, { sessions: () => store }).host.sessionKept('acp:/one')).toBe(false);
  expect(await pluginHost('fixture', context, { sessions: () => store }).host.sessionKept('echo:/two')).toBe(false);
  // A host that keeps no sessions has no leftovers of its own to adopt, which
  // is an answer rather than a failure.
  expect(await pluginHost('fixture', context).host.sessionKept('echo:/one')).toBe(false);
});

it('records the plugin that registered each agent, by the spec it was named with', async () => {
  const context: PluginContext = {
    path: '/tmp/plugin-host',
    paths: ['/tmp/plugin-host'],
    version: '0.0.0',
    hostName: 'host',
    configDir: '/tmp/plugin-host',
    log: () => {},
    say: () => {},
  };
  const scoped = pluginHost('agents', context, { spec: 'some-scope/agents' });
  scoped.host.registerAgent({ ...contributed, provider: 'first' });
  scoped.host.registerAgent({ ...contributed, provider: 'second' });
  const local = pluginHost('local', context, { spec: './plugins/local' });
  local.host.registerAgent({ ...contributed, provider: 'third' });

  const folded = foldHostOptions(base(), [scoped.contribution, local.contribution]);
  expect(folded.options.agentPlugins).toEqual({
    first: 'some-scope/agents',
    second: 'some-scope/agents',
    third: './plugins/local',
  });
  // The daemon's own agent came through no plugin, so nothing is recorded for it.
  expect(folded.options.agentPlugins?.echo).toBeUndefined();
});

it('records the spec a loaded plugin was named by, a path included', async () => {
  const { loadPlugins } = await import('../../server/src/plugins.js');
  const repo = join(import.meta.dirname, '../../..');
  const spec = './packages/sdk/test/fixtures/plugin-nested-echo';
  const { options, problems } = await loadPlugins([spec], { base: base(), configDir: repo, cwd: repo, log: () => {} });
  expect(problems).toEqual([]);
  expect(options.agentPlugins).toEqual({ cofold: spec });
});

it('waits for the store rather than answering before the fold has named it', async () => {
  const store = memorySessions();
  store.setConfig('one', { computer: 'computer://box' });
  store.setProvider('one', 'echo');
  const context: PluginContext = {
    path: '/tmp/plugin-host',
    paths: ['/tmp/plugin-host'],
    version: '0.0.0',
    hostName: 'host',
    configDir: '/tmp/plugin-host',
    log: () => {},
    say: () => {},
  };

  /*
   * What the daemon hands over: a store that is not named yet, because the fold
   * runs after every plugin has applied. A plugin that adopts a leftover asks
   * while the plugins after it are still loading, and an answer of `false`
   * until the fold ran would make a slow plugin decide what this daemon keeps.
   */
  let named: (held: ReturnType<typeof memorySessions> | undefined) => void = () => {};
  const later = new Promise<typeof store | undefined>((resolve) => { named = resolve; });
  const host = pluginHost('fixture', context, { sessions: () => later }).host;
  const asked = host.sessionKept('echo:/one');
  named(store);
  expect(await asked).toBe(true);
});

it('serves a backend a plugin contributed, beside the daemon\'s own', async () => {
  const { options, problems } = foldHostOptions(base(), [contribution]);
  expect(problems).toEqual([]);

  const host = createHost(options);
  const client = host.accept(peer());
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  }) as { snapshots: { state: { agents: { provider: string; displayName: string }[] } }[] };

  expect(ready.snapshots[0]?.state.agents.map((one) => one.provider)).toEqual(['echo', 'contributed']);
  expect(ready.snapshots[0]?.state.agents[1]?.displayName).toBe('Contributed backend');

  // A host built from folded options is a host in every other way too: the
  // catalogue answers, which is what a client asks next.
  const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
  expect(listed).toMatchObject({ items: [] });
});

/*
 * A key with an answerer says so, and a key without one does not.
 *
 * `enumDynamic` is the protocol's word for "ask me", and the two halves have
 * to agree: a schema claiming it with nobody registered draws a picker that is
 * answered with nothing, and an answerer nobody is told about is never asked.
 * The fold is where the pair is known, so the fold is what sets it.
 */
it('marks a contributed key dynamic only where something answers for it', () => {
  const { options } = foldHostOptions(base(), [{
    by: 'fixture',
    agents: [],
    tools: [],
    sessionConfig: {
      computer: { type: 'string', title: 'Computer' },
      mood: { type: 'string', title: 'Mood' },
    },
    sessionCompletions: {
      computer: () => [{ value: 'computer://box', label: 'box' }],
    },
    ports: {},
    providers: {},
    events: {},
  }]);

  expect(options.sessionConfig?.computer).toMatchObject({ enumDynamic: true });
  // Untouched: a key nobody answers for is a fact somebody types, which is
  // what a property with no `enum` already means.
  expect(options.sessionConfig?.mood).toEqual({ type: 'string', title: 'Mood' });
  expect(Object.keys(options.sessionConfigCompletions ?? {})).toEqual(['computer']);
});

it('publishes a session setting a plugin contributed, with its value on the session', async () => {
  const { options, problems } = foldHostOptions(base(), [{
    by: 'fixture',
    agents: [],
    tools: [],
    sessionConfig: { computer: { type: 'string', title: 'Computer', default: 'computer://box' } },
    sessionCompletions: {},
    ports: {},
    providers: {},
    events: {},
  }]);
  expect(problems).toEqual([]);

  const host = createHost(options);
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  const shown = async (channel: string) => {
    const state = (await client.handle({ method: 'subscribe', params: { channel } }) as {
      snapshot: { state: { config?: { schema?: { properties?: Record<string, unknown> }; values?: Record<string, unknown> } } };
    }).snapshot.state;
    return state.config;
  };

  // The default is the plugin's, under the backend's own settings.
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/default', provider: 'echo' } });
  const ordinary = await shown('ahp-session:/default');
  expect(Object.keys(ordinary?.schema?.properties ?? {})).toContain('computer');
  expect(ordinary?.values?.computer).toBe('computer://box');

  // A client that names one gets its own, and the backend's key is still there.
  await client.handle({
    method: 'createSession',
    params: { channel: 'ahp-session:/named', provider: 'echo', config: { computer: 'computer://other', voice: 'shouty' } },
  });
  const named = await shown('ahp-session:/named');
  expect(named?.values?.computer).toBe('computer://other');
  expect(named?.values?.voice).toBe('shouty');
});

/*
 * And the command a client actually sends reaches the answerer.
 *
 * The schema saying `enumDynamic` is half of it: a client that is told to ask
 * and is then answered by the worktree branch path, or by an empty list, is a
 * client that draws an empty picker. This is the other half, driven the way a
 * client drives it.
 */
it('routes a completions request to whoever registered the key', async () => {
  let asked: Record<string, unknown> | undefined;
  const { options } = foldHostOptions(base(), [{
    by: 'fixture',
    agents: [],
    tools: [],
    sessionConfig: { computer: { type: 'string', title: 'Computer' } },
    sessionCompletions: {
      computer: (ask) => {
        asked = { ...ask };
        return [{ value: 'computer://box', label: 'box', description: 'debian · Up' }];
      },
    },
    ports: {},
    providers: {},
    events: {},
  }]);
  const host = createHost(options);
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });

  const said = await client.handle({
    method: 'sessionConfigCompletions',
    params: { channel: 'ahp-root://', property: 'computer', query: 'bo', workingDirectory: 'file:///w' },
  }) as { items: { value: string }[] };
  expect(said.items).toEqual([{ value: 'computer://box', label: 'box', description: 'debian · Up' }]);
  // What was asked reaches the answerer, so a picker that depends on the
  // folder or on another answer can be written.
  expect(asked).toMatchObject({ property: 'computer', query: 'bo', workingDirectory: 'file:///w' });

  // A key nobody registered is the empty list it always was, rather than an
  // error: a client may ask about anything in the schema.
  expect(await client.handle({
    method: 'sessionConfigCompletions',
    params: { channel: 'ahp-root://', property: 'nothing-here', query: '' },
  })).toEqual({ items: [] });
});

/*
 * And the picker is seeded before anybody opens it.
 *
 * `enumDynamic` tells a client to ask, but a client still has to draw the
 * value it already holds, and the reference client labels a chip by looking
 * that value up in `enum`. With no seed a machine draws as `computer://box`
 * and the empty value - "on this host" - draws as an empty chip. So the
 * answerer is asked once, with an empty query, where a composer asks.
 */
it('seeds a contributed key from its own answerer when a config is resolved', async () => {
  const asked: string[] = [];
  const { options } = foldHostOptions(base(), [{
    by: 'fixture',
    agents: [],
    tools: [],
    sessionConfig: { computer: { type: 'string', title: 'Computer' } },
    sessionCompletions: {
      computer: (ask) => {
        asked.push(ask.query);
        return [
          { value: '', label: 'This host', description: 'Run the session here.' },
          { value: 'computer://box', label: 'box', description: 'debian · Up' },
        ];
      },
    },
    ports: {},
    providers: {},
    events: {},
  }]);
  const client = createHost(options).accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });

  const resolved = await client.handle({
    method: 'resolveSessionConfig',
    params: { channel: 'ahp-root://', provider: 'echo' },
  }) as { schema: { properties: Record<string, Record<string, unknown>> } };

  expect(resolved.schema.properties.computer).toMatchObject({
    enum: ['', 'computer://box'],
    enumLabels: ['This host', 'box'],
    enumDescriptions: ['Run the session here.', 'debian · Up'],
    // Still dynamic: the seed is the first page, not the list.
    enumDynamic: true,
  });
  // The empty query is the one a picker sends when it opens, and it is asked
  // once rather than per property.
  expect(asked).toEqual(['']);
});

/*
 * A seed that cannot be read costs its own key and nothing else.
 *
 * Resolving a config is somebody drawing a form. A machine listing that fails
 * is a picker they have to open, not a form they cannot fill in.
 */
it('answers the rest of the form when a seed fails', async () => {
  const { options } = foldHostOptions(base(), [{
    by: 'fixture',
    agents: [],
    tools: [],
    sessionConfig: {
      computer: { type: 'string', title: 'Computer' },
      // Seeded by the plugin itself, so the host leaves it alone.
      region: { type: 'string', enum: ['eu'], enumLabels: ['Europe'] },
    },
    sessionCompletions: {
      computer: () => { throw new Error('docker is not running'); },
      region: () => [{ value: 'us', label: 'Nowhere near' }],
    },
    ports: {},
    providers: {},
    events: {},
  }]);
  const client = createHost(options).accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });

  const resolved = await client.handle({
    method: 'resolveSessionConfig',
    params: { channel: 'ahp-root://', provider: 'echo' },
  }) as { schema: { properties: Record<string, Record<string, unknown>> } };

  // No seed, and no `enum` invented for it: the picker still answers live.
  expect(resolved.schema.properties.computer?.enum).toBeUndefined();
  expect(resolved.schema.properties.computer?.enumDynamic).toBe(true);
  // A plugin that seeded its own key keeps what it wrote.
  expect(resolved.schema.properties.region?.enum).toEqual(['eu']);
  expect(resolved.schema.properties.region?.enumLabels).toEqual(['Europe']);
  // And the backend's own properties are all still there.
  expect(resolved.schema.properties.voice).toBeDefined();
});

/*
 * An answerer that throws is an empty picker, not a failed form.
 *
 * The person is filling in a session's settings, and a machine listing that
 * cannot be read is not a reason to refuse them the rest of it.
 */
it('answers with nothing when the answerer fails', async () => {
  const { options } = foldHostOptions(base(), [{
    by: 'fixture',
    agents: [],
    tools: [],
    sessionConfig: { computer: { type: 'string' } },
    sessionCompletions: { computer: () => { throw new Error('docker is not running'); } },
    ports: {},
    providers: {},
    events: {},
  }]);
  const client = createHost(options).accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  expect(await client.handle({
    method: 'sessionConfigCompletions',
    params: { channel: 'ahp-root://', property: 'computer', query: '' },
  })).toEqual({ items: [] });
});

it('advertises every scheme it serves on the handshake and on the root state', async () => {
  const notes = {
    read: async () => ({ data: 'x', encoding: 'utf-8' as const }),
    list: async () => [],
    write: async () => {},
    remove: async () => {},
    describe: () => ({ title: 'Notes', description: 'Files a session keeps.', manifest: { type: 'object', properties: {} } }),
  };
  const { options } = foldHostOptions(base(), [{
    by: 'fixture',
    agents: [],
    tools: [],
    sessionConfig: {},
    sessionCompletions: {},
    ports: {},
    providers: { notes },
    events: {},
  }]);

  const host = createHost(options);
  const client = host.accept(peer());
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  }) as {
    _meta?: Record<string, unknown>;
    snapshots: { resource: string; state: { _meta?: Record<string, unknown> } }[];
  };

  // The provider's claim, plus the root and the operations the host can see.
  expect(ready._meta?.['ahpd.resourceProviders']).toEqual({
    notes: {
      title: 'Notes',
      description: 'Files a session keeps.',
      manifest: { type: 'object', properties: {} },
      root: 'notes://',
      operations: ['get', 'list', 'put', 'delete'],
    },
  });
  // The same statement on the root snapshot, so a client that subscribes later
  // reads what the handshake said.
  expect(ready.snapshots[0]?.state._meta?.['ahpd.resourceProviders'])
    .toEqual(ready._meta?.['ahpd.resourceProviders']);

  // And the scheme is a subject in `ahpd.grants` beside the built-ins, under
  // its own name: a client drawing a role editor reads one key, not two. Its
  // operations are the ones the provider implements, and the groups are the
  // resource ones kept to them, which is what the gate answers `notes:put`
  // from.
  const grants = ready._meta?.['ahpd.grants'] as Grants;
  expect(grants['notes']).toEqual({
    title: 'Notes',
    description: 'Files a session keeps.',
    operations: ['get', 'list', 'put', 'delete'],
    groups: { read: ['get', 'list'], write: ['put', 'delete'] },
  });
  // The eight the host decides are still there ahead of it, untouched.
  expect(Object.keys(grants).slice(0, 8)).toEqual([
    'session', 'chat', 'terminal', 'automation', 'file', 'config', 'diagnostics', 'container',
  ]);
  // And the root snapshot says so, as it does for the key beside it.
  expect(ready.snapshots[0]?.state._meta?.['ahpd.grants']).toEqual(grants);

  // The `vscode.*` flags the reference client reads are still there beside it.
  expect(ready._meta?.['vscode.removeSessionArtifact']).toBe(true);

  // No entry anywhere advertises `read` or `write`: those are groups, and the
  // gate asks for an operation - decision
  // `a-grant-names-an-operation-and-read-and-write-are-its-groups`.
  for (const [scheme, entry] of Object.entries(ready._meta?.['ahpd.resourceProviders'] as Record<string, { operations: string[] }>)) {
    for (const word of ['read', 'write']) expect(entry.operations, scheme).not.toContain(word);
  }
});

/** One entry of `ahpd.grants`, as this file reads it. */
interface Grants {
  [scheme: string]: {
    title: string;
    description: string;
    operations: string[];
    groups: { read: string[]; write: string[] };
  };
}

it('names a scheme that says nothing of itself, and keeps one built-in subject once', async () => {
  const { options } = foldHostOptions(base(), [{
    by: 'fixture',
    agents: [],
    tools: [],
    sessionConfig: {},
    sessionCompletions: {},
    ports: {},
    // No `describe`, so the entry falls back to the scheme's own name; and one
    // registered under a subject the host decides, which must not be listed
    // twice.
    providers: {
      bare: { read: async () => ({ data: 'x', encoding: 'utf-8' as const }), remove: async () => {} },
      file: { read: async () => ({ data: 'x', encoding: 'utf-8' as const }) },
    },
    events: {},
  }]);

  const client = createHost(options).accept(peer());
  const ready = await client.handle({
    method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] },
  }) as { _meta?: Record<string, unknown> };

  const grants = ready._meta?.['ahpd.grants'] as Grants;
  expect(grants['bare']).toEqual({
    title: 'bare',
    description: 'bare',
    operations: ['get', 'delete'],
    groups: { read: ['get'], write: ['delete'] },
  });
  // `file` is the host's own scheme: the table's entry stands, with the ten
  // operations the gate gives it rather than the one this provider implements.
  expect(Object.keys(grants).filter((one) => one === 'file')).toHaveLength(1);
  expect(grants['file']?.operations).toContain('request');
});

it('advertises only what a read-only provider implements', async () => {
  /*
   * A scheme that can be listed and read and nothing else, which is the case
   * that shows the advertised word is the grant's and not the method's: the
   * provider says `read` and `list`, and neither `put` nor `delete` appears.
   */
  const quiet = {
    list: async () => [],
    read: async () => ({ data: '', encoding: 'utf-8' as const }),
    describe: () => ({ title: 'Quiet' }),
  };
  const { options } = foldHostOptions(base(), [{
    by: 'fixture', agents: [], tools: [], sessionConfig: {}, sessionCompletions: {},
    ports: {}, providers: { quiet }, events: {},
  }]);
  const client = createHost(options).accept(peer());
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  }) as { _meta?: { 'ahpd.resourceProviders'?: Record<string, { operations: string[] }> } };

  expect(ready._meta?.['ahpd.resourceProviders']?.['quiet']?.operations).toEqual(['get', 'list']);
});

it('advertises usage as a scheme a host serves itself, beside file:', async () => {
  /*
   * No manifest, because nothing under `usage:` is made, and the operations are
   * the read half only - a usage pool is read and nothing is written to it.
   */
  const usage: Usage = {
    record: async () => {},
    total: async () => ({}),
    pools: async () => ['user:ana'],
    records: async () => [],
  };
  const host = createHost({ ...base(), usage, resourceProviders: { usage: usageProvider({ usage }) } });
  const client = host.accept(peer());
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  }) as { _meta?: Record<string, Record<string, unknown>> };

  expect(ready._meta?.['ahpd.resourceProviders']?.['usage']).toEqual({
    title: 'Usage',
    description: 'What this host has been charged, per pool.',
    root: 'usage://',
    operations: ['get', 'list', 'resolve'],
  });
});

it('advertises nothing when it serves no scheme beside file:', async () => {
  const host = createHost(base());
  const client = host.accept(peer());
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  }) as { _meta?: Record<string, unknown>; snapshots: { state: { _meta?: Record<string, unknown> } }[] };

  // Absent rather than empty: presence is how a client knows the key means
  // anything at all. `ahpd.grants` is beside it and is not: it says what a role
  // could hold, which is a question this host answers with or without a scheme
  // registered.
  expect(ready._meta?.['ahpd.resourceProviders']).toBeUndefined();
  expect(ready.snapshots[0]?.state._meta?.['ahpd.resourceProviders']).toBeUndefined();
  expect(ready._meta?.['ahpd.grants']).toBeDefined();
});

it('drops a clashing agent alone, and says which plugin lost the id', () => {
  const asAgents = (by: string, ...providers: string[]): Contribution => ({
    by,
    agents: providers.map((provider) => ({ ...echo({ path: '/x' }), provider })),
    tools: [], sessionConfig: {}, sessionCompletions: {}, ports: {}, providers: {}, events: {},
  });
  const folded = foldHostOptions({ ...base(), agents: [] }, [asAgents('a', 'x', 'y'), asAgents('b', 'y', 'z')]);
  expect(folded.options.agents?.map((one) => one.provider)).toEqual(['x', 'y', 'z']);
  expect(folded.problems).toHaveLength(1);
  expect(folded.problems[0]).toMatch(
    new RegExp(`^${AGENT_CLASH} plugin b registers agent y, which plugin a already registered$`, 'u'),
  );
});
