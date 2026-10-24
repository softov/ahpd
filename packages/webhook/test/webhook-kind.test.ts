import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { connectorsChannel } from '../../sdk/src/connectors/channel.js';
import { pluginHost } from '../../sdk/src/plugins/plugins.js';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { webhookAdapter } from '../src/adapter.js';
import { botTarget } from '../src/bot.js';
import { apply } from '../src/plugin.js';
import { webhookRoute } from '../src/route.js';
import type { Connector, ServedAdapter } from '../../sdk/src/types/connectors.js';
import type { LoaderContext, PluginMethod } from '../../sdk/src/types/plugin.js';
import type { Vault } from '../../sdk/src/types/vault.js';
import type { BotSeams } from '../src/bot.js';
import type { Endpoint } from '../src/record.js';

/*
 * The `webhook` adapter, over the route the plugin answers.
 *
 * A connector is opened the way the host opens one, and the route is called as
 * the daemon's listener calls it: what is checked is which URL answers, what a
 * removed connector answers, and that an old `webhooks` record answers nothing.
 */

const PREFIX = 'http://127.0.0.1:1/plugins/webhook';

let loose: string[] = [];
afterEach(() => {
  for (const dir of loose) rmSync(dir, { recursive: true, force: true });
  loose = [];
});

/** A plugin context over one directory. */
const context = (dir: string): LoaderContext => ({
  path: dir,
  paths: [dir],
  version: '0.0.0',
  hostName: 'host',
  configDir: dir,
  log: () => {},
  say: () => {},
});

/** A connector of the `webhook` adapter, whose config is the form a person filled in. */
const made = (id: string, config: Record<string, unknown>): Connector => ({ id, adapter: 'webhook', owner: 'host', config });

/** One call to the route, with a bearer. */
const call = (path: string, bearer: string): Request => new Request(`${PREFIX}${path}`, {
  method: 'POST',
  headers: { authorization: `Bearer ${bearer}` },
  body: '{}',
});

/** The plugin applied, with the adapter it registered and the route it serves. */
async function started() {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-webhook-kind-'));
  loose.push(dir);
  const records = memoryRecords();
  const collections = new Map<string, string>();
  const { host, contribution } = pluginHost('webhook', context(dir), {
    contracts: {
      routes: ['post /plugins/webhook/:endpoint'],
      triggerTypes: ['webhook'],
      adapters: ['webhook'],
    },
    records: () => records,
    collections,
  });
  apply(host, {});
  const adapter = contribution.adapters['webhook'];
  const route = contribution.routes;
  if (adapter === undefined || route === undefined) throw new Error('the plugin registered no adapter or no route');
  return { adapter, route, records, collections };
}

it('marks the secret writeOnly, so the host keeps it in the vault and not in the record', async () => {
  const { adapter } = await started();
  const properties = adapter.schema['properties'] as Record<string, Record<string, unknown>>;
  expect(properties['secret']?.['writeOnly']).toBe(true);
  expect(adapter.capabilities.map((one) => [one.type, one.title])).toEqual([['receive', 'Receives calls']]);
  // The URL a client builds from the capability, on the daemon's HTTP root.
  expect(adapter.capabilities[0]?.path).toBe('/plugins/webhook/{id}');
});

it('answers two connectors at their own URLs, and answers 404 once one is removed', async () => {
  const { adapter, route } = await started();
  const stopCi = adapter.open(made('ci', { automation: 'ahpd-automation:/ci', secret: 'ci-token' }));
  adapter.open(made('deploys', { automation: 'ahpd-automation:/deploys', secret: 'deploys-token' }));

  const ci = await route(call('/ci', 'ci-token'));
  expect(ci.status).toBe(202);
  expect(await ci.json()).toEqual({ endpoint: 'ci', automation: 'ahpd-automation:/ci' });
  const deploys = await route(call('/deploys', 'deploys-token'));
  expect(deploys.status).toBe(202);
  expect(await deploys.json()).toEqual({ endpoint: 'deploys', automation: 'ahpd-automation:/deploys' });

  if (typeof stopCi !== 'function') throw new Error('open answered no close');
  await stopCi();
  expect((await route(call('/ci', 'ci-token'))).status).toBe(404);
  expect((await route(call('/deploys', 'deploys-token'))).status).toBe(202);
});

it('refuses a call with the wrong bearer, and keeps the endpoint open', async () => {
  const { adapter, route } = await started();
  adapter.open(made('ci', { bot: 'bot://motion', secret: 'ci-token' }));
  expect((await route(call('/ci', 'not-ci-token'))).status).toBe(401);
  expect((await route(call('/ci', 'ci-token-and-more'))).status).toBe(401);
});

it('makes no endpoint of a webhooks record left behind', async () => {
  const { adapter, route, records, collections } = await started();
  // What a hand-written `webhooks/ci.md` used to be read as: the host opens no
  // collection of that name any more, so the record reaches no route.
  const webhooks = await records.collection('webhooks');
  await webhooks.put({ id: 'ci', automation: 'ahpd-automation:/ci', secret: 'ci-token' });
  adapter.open(made('live', { automation: 'ahpd-automation:/live', secret: 'live-token' }));

  expect((await route(call('/ci', 'ci-token'))).status).toBe(404);
  expect((await route(call('/live', 'live-token'))).status).toBe(202);
  expect([...collections.keys()]).toEqual(['webhook-threads']);
});

it('refuses a config that names both a bot and an automation', async () => {
  const { adapter } = await started();
  expect(() => adapter.open(made('both', { bot: 'bot://motion', automation: 'ahpd-automation:/x', secret: 'x' }))).toThrow('both');
});

/**
 * The subset of JSON Schema the daemon's checker reads for these forms: the
 * type and enum of each field, the required fields, the `oneOf` alternatives,
 * and no field a schema leaves out.
 */
const check = (value: unknown, schema: Record<string, unknown>, label: string): void => {
  const alternatives = schema['oneOf'] as Record<string, unknown>[] | undefined;
  if (alternatives !== undefined) {
    const hits = alternatives.filter((one) => {
      try {
        check(value, one, label);
        return true;
      }
      catch {
        return false;
      }
    }).length;
    if (hits !== 1) throw new Error(`${label} matches ${hits} of oneOf, expected 1`);
    return;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} is a record of fields`);
  const given = value as Record<string, unknown>;
  const properties = (schema['properties'] ?? {}) as Record<string, Record<string, unknown>>;
  for (const name of (schema['required'] ?? []) as string[]) {
    if (given[name] === undefined && properties[name]?.['default'] === undefined) throw new Error(`${label}.${name} is required`);
  }
  for (const [name, one] of Object.entries(properties)) {
    if (given[name] === undefined) continue;
    if (one['type'] === 'string' && typeof given[name] !== 'string') throw new Error(`${label}.${name} is text`);
    if (one['type'] === 'number' && typeof given[name] !== 'number') throw new Error(`${label}.${name} is a number`);
    const values = one['enum'] as unknown[] | undefined;
    if (values !== undefined && !values.includes(given[name])) throw new Error(`${label}.${name} is one of ${values.join(', ')}`);
  }
  if (schema['additionalProperties'] === false) {
    for (const name of Object.keys(given)) {
      if (!(name in properties)) throw new Error(`${label}.${name} is not a field`);
    }
  }
};

/** A host's connectors channel over a store in memory, with a vault a secret is kept in. */
async function served(adapter: ServedAdapter) {
  const collection = await memoryRecords().collection('connectors', { format: 'json' });
  const held = new Map<string, string>();
  const vault: Vault = {
    get: async (field) => held.get(field),
    set: async (field, value) => { held.set(field, value); },
    delete: async (field) => held.delete(field),
    list: async () => [...held.keys()].sort(),
  };
  const connectors = connectorsChannel({
    collection,
    adapters: () => ({ webhook: adapter }),
    vault: () => vault,
    check,
  });
  const put = connectors.methods['x-ahpd/connectors/put'];
  if (put === undefined) throw new Error('the connectors channel has no put');
  return { collection, connectors, held, put };
}

/** What a put answered: its error code and message, or nothing when it took the config. */
const refused = async (
  put: PluginMethod,
  config: Record<string, unknown>,
): Promise<{ code?: number; message?: string } | undefined> => {
  try {
    await put.handle({ id: 'ci', adapter: 'webhook', owner: 'host', config }, undefined, 'test');
    return undefined;
  }
  catch (error) {
    return error as { code?: number; message?: string };
  }
};

it('answers a call to a connector naming only a bot and a secret with 202', async () => {
  const endpoints = new Map<string, Endpoint>();
  webhookAdapter(endpoints).open(made('ci', { bot: 'bot://motion', secret: 'ci-token' }));
  const threads = await memoryRecords().collection('webhook-threads', { format: 'json' });
  const seams: BotSeams = {
    threads,
    chat: async () => ({ session: 'session://motion', chat: 'chat://motion' }),
    send: async () => undefined,
    ended: async () => ({ status: 'complete', text: 'done' }),
    forget: () => {},
    post: async () => {},
    syncTimeoutSeconds: 60,
    problem: () => {},
  };
  const route = webhookRoute({ endpoint: (id) => endpoints.get(id), bot: botTarget(seams) });
  const answer = await route(new Request(`${PREFIX}/ci`, {
    method: 'POST',
    headers: { authorization: 'Bearer ci-token', 'content-type': 'application/json' },
    body: JSON.stringify({ thread: 'pr-12', text: 'hello' }),
  }));
  expect(answer.status).toBe(202);
  expect(await answer.json()).toMatchObject({ thread: 'pr-12' });
});

it('answers -32602 to a put naming the callback reply with no callbackPrefix', async () => {
  const { adapter } = await started();
  const { put } = await served({ ...adapter, by: 'webhook' });
  expect(await refused(put, { bot: 'bot://motion', reply: 'callback', secret: 'ci-token' })).toMatchObject({ code: -32602 });
});

it('refuses a put naming an automation and a reply', async () => {
  const { adapter } = await started();
  const { put } = await served({ ...adapter, by: 'webhook' });
  const error = await refused(put, { automation: 'ahpd-automation:/one', reply: 'none', secret: 'ci-token' });
  expect(error?.code).toBe(-32602);
  expect(error?.message).toContain('oneOf');
});

it('reads a stored connector with automation: true as invalid, and a connector naming an id as ready', async () => {
  const { adapter } = await started();
  const name = 'host:connector/ok/secret';
  const { collection, connectors, held } = await served({ ...adapter, by: 'webhook' });
  held.set(name, 'ok-token');
  // What the record holds: the secret is a reference to the vault.
  await collection.put({ id: 'ok', adapter: 'webhook', owner: 'host', config: { automation: 'ahpd-automation:/one', secret: { $secret: name } } });
  await collection.put({ id: 'old', adapter: 'webhook', owner: 'host', config: { automation: true, secret: { $secret: name } } });

  await connectors.openAll();
  const snapshot = await connectors.channel.channel.snapshot('x-ahpd-connectors://', undefined, 'test') as {
    records: { id: string; record: Record<string, unknown> }[];
  };
  const rows = Object.fromEntries(snapshot.records.map((one) => [one.id, one.record]));
  expect(rows['ok']?.['state']).toBe('ready');
  expect(rows['old']?.['state']).toBe('invalid');
});
