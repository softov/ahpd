import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { fileResources } from '../src/resources/resources.js';
import { RpcError } from '../src/rpc.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import { call, directory, hello, peer, root, signIn } from './users-gate-helpers.js';
import type { Bag } from './users-gate-helpers.js';
import type { HostOptions } from '../src/types/host.js';
import type { LoaderContext, PluginMethod } from '../src/types/plugin.js';
import type { Grant } from '../src/types/users.js';

/*
 * A served `x-` command: the host answers it with the method's `handle`, gates
 * it by the method's grant and `authorize`, and lists it in
 * `_meta['ahpd.methods']`.
 *
 * One plugin, `test`, serves `x-test/echo`, which answers with what it was
 * asked and who asked it.
 */

const context = (): LoaderContext => ({ path: root, paths: [root], version: sdkVersion(), hostName: 'test', configDir: root, log: () => {}, say: () => {} });

/** What `authorize` was asked, by caller id. */
interface Heard { authorized: string[] }

/** A host with the test plugin's `x-test/echo`. */
function served(extra: Partial<PluginMethod> = {}, options: Partial<HostOptions> = {}) {
  const heard: Heard = { authorized: [] };
  const { host: plugin, contribution } = pluginHost('test', context());
  plugin.registerMethod('x-test/echo', {
    grant: 'session:list',
    handle: (params, reader, client) => ({ params, reader: reader?.id ?? null, client }),
    ...extra,
  });
  const folded = foldHostOptions({
    path: root,
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
    ...options,
  }, [contribution]);
  expect(folded.problems).toEqual([]);
  return { heard, made: createHost(folded.options) };
}

/** A client of `made`, introduced as `id`, signed in with `token` when one is given. */
const client = async (made: ReturnType<typeof createHost>, id: string, token?: string) => {
  const one = made.accept(peer());
  const ready = await hello(one, id) as Bag;
  if (token !== undefined) await signIn(one, token);
  return { one, ready };
};

it('answers x-test/echo with what handle gave, naming the caller', async () => {
  const { made } = served();
  const ana = await client(made, 'ana');
  expect(await call(ana.one, 'x-test/echo', { say: 'hi' }))
    .toEqual({ result: { params: { say: 'hi' }, reader: null, client: 'ana' } });
});

it('passes on the RpcError handle throws', async () => {
  const { made } = served({ handle: () => { throw new RpcError(-32602, 'say is required'); } });
  const ana = await client(made, 'ana');
  expect(await call(ana.one, 'x-test/echo', {})).toMatchObject({ code: -32602, message: 'say is required' });
});

it('answers -32601 before initialize, and for a method nobody serves', async () => {
  const { made } = served();
  const early = made.accept(peer());
  expect(await call(early, 'x-test/echo', {}))
    .toMatchObject({ code: -32601, message: 'This host does not serve x-test/echo before initialize' });
  const ana = await client(made, 'ana');
  expect(await call(ana.one, 'x-test/other', {}))
    .toMatchObject({ code: -32601, message: 'This host does not serve x-test/other yet' });
});

it('answers -32601 for a method named like an Object built-in, signed in or not', async () => {
  const BUILT_INS = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'];
  const { made } = served();
  const ana = await client(made, 'ana');
  for (const method of BUILT_INS) {
    expect(await call(ana.one, method, {})).toMatchObject({ code: -32601, message: `This host does not serve ${method} yet` });
  }
  const users = directory({ ana: ['session:list' as Grant] });
  const gated = served({}, { users });
  const signed = await client(gated.made, 'ana', 'ana');
  for (const method of BUILT_INS) {
    expect(await call(signed.one, method, {})).toMatchObject({ code: -32601, message: `This host does not serve ${method} yet` });
  }
});

it('needs the method grant, unless authorize lets the caller in', async () => {
  const users = directory({ ana: ['session:list' as Grant], bo: [], cy: [] });
  const { heard, made } = served({
    authorize: async (params, reader) => { heard.authorized.push(reader.id); return reader.id === 'cy' && params.say === 'hi'; },
  }, { users });
  const ana = await client(made, 'ana', 'ana');
  const bo = await client(made, 'bo', 'bo');
  const cy = await client(made, 'cy', 'cy');
  expect(await call(ana.one, 'x-test/echo', { say: 'hi' })).toMatchObject({ result: { reader: 'ana', client: 'ana' } });
  expect(await call(bo.one, 'x-test/echo', { say: 'hi' })).toMatchObject({ code: -32009 });
  expect(await call(cy.one, 'x-test/echo', { say: 'hi' })).toMatchObject({ result: { reader: 'cy', client: 'cy' } });
  expect(await call(cy.one, 'x-test/echo', { say: 'no' })).toMatchObject({ code: -32009 });
  // Asked only of the callers the grant refused.
  expect(heard.authorized).toEqual(['bo', 'cy', 'cy']);
});

it('asks a caller who has not signed in to sign in', async () => {
  const { made } = served({}, { users: directory({ ana: ['session:list' as Grant] }) });
  const nobody = await client(made, 'nobody');
  expect(await call(nobody.one, 'x-test/echo', {})).toMatchObject({ code: -32007 });
});

it('serves the daemon\'s own methods from HostOptions.methods', async () => {
  const made = createHost({
    path: root,
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
    methods: {
      'x-ahpd/usage/totals': { by: 'ahpd', name: 'x-ahpd/usage/totals', method: { grant: 'usage:get', handle: () => ({ total: 3 }) } },
    },
  });
  const ana = await client(made, 'ana');
  expect(await call(ana.one, 'x-ahpd/usage/totals', {})).toEqual({ result: { total: 3 } });
});

it('advertises each served method on initialize and in root state', async () => {
  const { made } = served({ describe: () => ({ title: 'Echo', description: 'Says it back.' }) });
  const ana = await client(made, 'ana');
  const entry = [{ method: 'x-test/echo', title: 'Echo', description: 'Says it back.', grant: 'session:list' }];
  expect(ana.ready._meta?.['ahpd.methods']).toEqual(entry);
  expect(ana.ready.snapshots[0]?.state._meta?.['ahpd.methods']).toEqual(entry);

  const plain = served();
  const bo = await client(plain.made, 'bo');
  expect(bo.ready._meta?.['ahpd.methods']).toEqual([{ method: 'x-test/echo', title: 'x-test/echo', grant: 'session:list' }]);
});

it('advertises no methods on a host that serves none', async () => {
  const made = createHost({ path: root, agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }] });
  const ana = await client(made, 'ana');
  expect(ana.ready._meta).not.toHaveProperty('ahpd.methods');
  expect(ana.ready.snapshots[0]?.state._meta ?? {}).not.toHaveProperty('ahpd.methods');
});
