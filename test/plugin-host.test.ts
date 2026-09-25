import { expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { AGENT_CLASH, foldHostOptions } from '../packages/sdk/src/plugins.js';
import { echo } from '../examples/echo/agent.js';
import type { Agent } from '../packages/sdk/src/types/agent.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';
import type { Contribution } from '../packages/sdk/src/types/plugin.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

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

it('serves a backend a plugin contributed, beside the daemon\'s own', async () => {
  const { options, problems } = foldHostOptions(base(), [contribution]);
  expect(problems).toEqual([]);

  const host = createHost(options);
  const client = host.accept(peer());
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
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
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.8.0'] } });
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
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.8.0'] } });

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
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.8.0'] } });

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
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.8.0'] } });

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
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.8.0'] } });
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
    params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
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
      operations: ['read', 'list', 'write', 'delete'],
    },
  });
  // The same statement on the root snapshot, so a client that subscribes later
  // reads what the handshake said.
  expect(ready.snapshots[0]?.state._meta?.['ahpd.resourceProviders'])
    .toEqual(ready._meta?.['ahpd.resourceProviders']);

  // The `vscode.*` flags the reference client reads are still there beside it.
  expect(ready._meta?.['vscode.removeSessionArtifact']).toBe(true);
});

it('advertises nothing when it serves no scheme beside file:', async () => {
  const host = createHost(base());
  const client = host.accept(peer());
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
  }) as { _meta?: Record<string, unknown>; snapshots: { state: { _meta?: unknown } }[] };

  // Absent rather than empty: presence is how a client knows the key means
  // anything at all.
  expect(ready._meta?.['ahpd.resourceProviders']).toBeUndefined();
  expect(ready.snapshots[0]?.state._meta).toBeUndefined();
});

it('marks a provider clash so a caller can refuse over one without reading prose', () => {
  const twice = foldHostOptions(base(), [
    { by: 'one', agents: [{ ...echo({ path: '/x' }), provider: 'echo' }], tools: [], sessionConfig: {}, sessionCompletions: {}, ports: {}, providers: {}, events: {} },
  ]);
  expect(twice.problems).toHaveLength(1);
  expect(twice.problems[0]?.startsWith(AGENT_CLASH)).toBe(true);
});
