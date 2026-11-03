import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { grantEntries } from '../src/host/root.js';
import { holds, OPERATIONS } from '../src/access/users.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostOptions } from '../src/types/host.js';
import type { LoaderContext, PluginHost } from '../src/types/plugin.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * The grants a plugin registers, on their own.
 *
 * A registration puts a subject on `ahpd.grants` and gives it to nobody. The
 * groups are the host's answer from `operationsOf`, so what is here can only
 * say which operations exist, never change what one of them means at the gate.
 */

const peer = (): Peer => ({
  send: () => {},
  notify: () => {},
  request: async () => ({}),
  answered: () => {},
  close: () => {},
});

const base = (): HostOptions => ({ path: '/tmp/plugin-grants', agents: [echo({ path: '/tmp/plugin-grants' })] });

const context = (): LoaderContext => ({
  path: '/tmp/plugin-grants',
  paths: ['/tmp/plugin-grants'],
  version: '0.0.0',
  hostName: 'host',
  configDir: '/tmp/plugin-grants',
  log: () => {},
  say: () => {},
});

/** A plugin's host, with its contribution sealed as the loader seals it. */
const registered = (by: string, register: (host: PluginHost) => void) => {
  const recording = pluginHost(by, context());
  register(recording.host);
  recording.seal();
  return recording.contribution;
};

/** Every entry `ahpd.grants` carries, as a client reads it off the handshake. */
const advertised = async (options: HostOptions): Promise<Record<string, { title: string; description: string; operations: string[]; groups: { read: string[]; write: string[] } }>> => {
  const client = createHost(options).accept(peer());
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'] },
  }) as { _meta?: Record<string, unknown> };
  return ready._meta?.['ahpd.grants'] as never;
};

it('lists a registered subject with its operations, and the resource groups give one a meaning', async () => {
  const { options, problems } = foldHostOptions(base(), [
    registered('notes-plugin', (host) => {
      host.registerGrants('notes', { title: 'Notes', description: 'The notes this plugin keeps.', operations: ['pin', 'put'] });
    }),
  ]);

  expect(problems).toEqual([]);
  const grants = await advertised(options);
  expect(grants['notes']).toEqual({
    title: 'Notes',
    description: 'The notes this plugin keeps.',
    operations: ['pin', 'put'],
    // `put` is a resource operation and falls in `write`; `pin` is the
    // plugin's own and is in neither group, so only a grant naming it holds it.
    groups: { read: [], write: ['put'] },
  });

  expect(holds(new Set(['notes:write']), 'notes:put')).toBe(true);
  expect(holds(new Set(['notes:write']), 'notes:pin')).toBe(false);
  expect(holds(new Set(['notes:pin']), 'notes:pin')).toBe(true);
});

it('joins two plugins\' registrations of one subject into one entry, keeping the first title', () => {
  const { options, problems } = foldHostOptions(base(), [
    registered('alpha', (host) => { host.registerGrants('notes', { title: 'Alpha notes', operations: ['pin'] }); }),
    registered('beta', (host) => { host.registerGrants('notes', { title: 'Beta notes', description: 'The second one.', operations: ['put'] }); }),
  ]);

  expect(problems).toEqual([]);
  // One entry per subject, with the operations of both and the first title
  // and description that were written: alpha named it, beta described it.
  expect(grantEntries(options.resourceProviders, options.grants)['notes']).toEqual({
    title: 'Alpha notes',
    description: 'The second one.',
    operations: ['pin', 'put'],
    groups: { read: [], write: ['put'] },
  });
});

it('reports an operation the table lacks on a subject the table decides, and keeps the table\'s operations', () => {
  const { options, problems } = foldHostOptions(base(), [
    registered('greedy', (host) => { host.registerGrants('session', { operations: ['export'] }); }),
  ]);

  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('greedy');
  expect(problems[0]).toContain('session:export');
  // The registration does not widen what a role may hold: `session` still has
  // the table's operations and no `export`.
  const session = grantEntries(options.resourceProviders, options.grants)['session'];
  expect(session?.operations).toEqual([...(OPERATIONS['session']?.operations ?? [])]);
  expect(session?.operations).not.toContain('export');
});

it('refuses an operation that is a group or the wildcard, and a subject a grant cannot name', () => {
  const recording = pluginHost('strict', context());
  const host = recording.host;

  for (const one of ['read', 'write', '*']) {
    expect(() => host.registerGrants('notes', { operations: [one] }), one).toThrow(/registerGrants/);
  }
  expect(() => host.registerGrants('no tes', { operations: ['pin'] })).toThrow(/registerGrants/);
  expect(() => host.registerGrants('notes:extra', { operations: ['pin'] })).toThrow(/registerGrants/);
  expect(() => host.registerGrants('notes', { operations: [] })).toThrow(/registerGrants/);
  expect(() => host.registerGrants('notes', { operations: ['not-a-word'] })).toThrow(/registerGrants/);
});
