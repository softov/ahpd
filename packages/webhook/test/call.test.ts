import { beforeEach, expect, it } from 'vitest';
import { webhookAdapter } from '../src/adapter.js';
import { webhookRoute } from '../src/route.js';
import type { Adapter, ConnectorOwner } from '../../sdk/src/types/connectors.js';
import type { Endpoint } from '../src/record.js';

/*
 * A call, as the route reads it and hands it to a target.
 *
 * The route and the real adapter are wired together, so a connector opened the
 * way the host opens one is the endpoint a call reaches. What is checked is the
 * event data a fire or a run reads, and the answer a caller gets.
 */

const PREFIX = 'http://127.0.0.1:1/plugins/webhook';

/** An answer with a body as JSON. */
const json = async (answer: Response): Promise<Record<string, unknown>> => await answer.json() as Record<string, unknown>;

let endpoints: Map<string, Endpoint>;
let adapter: Adapter;
let fired: { data: Record<string, unknown>; owner?: ConnectorOwner }[];
let ran: { automation: string; data: Record<string, unknown>; owner?: ConnectorOwner }[];

beforeEach(() => {
  endpoints = new Map();
  adapter = webhookAdapter(endpoints);
  fired = [];
  ran = [];
});

/** A connector opened as the host opens it: its secret, and its own owner. */
const opens = (id: string, config: Record<string, unknown> = {}): void => {
  adapter.open({ id, adapter: 'webhook', owner: 'user:alice', config: { secret: 'right-token', ...config } });
};

/** The route over the connectors opened above, with the plugin's two targets. */
const makes = (maxBodyBytes?: number) => webhookRoute({
  endpoint: (id) => endpoints.get(id),
  fire: (data, owner) => { fired.push({ data, ...(owner === undefined ? {} : { owner }) }); },
  run: (automation, data, owner) => { ran.push({ automation, data, ...(owner === undefined ? {} : { owner }) }); },
  ...(maxBodyBytes === undefined ? {} : { maxBodyBytes }),
});

/** One call to an endpoint. No body at all is `undefined`, and so is the content type. */
const post = (id: string, body?: string, headers: Record<string, string> = {}): Request => new Request(`${PREFIX}/${id}`, {
  method: 'POST',
  headers: { authorization: 'Bearer right-token', ...headers },
  ...(body === undefined ? {} : { body }),
});

it('fires a form-encoded body, with its fields as the event body', async () => {
  opens('forms');
  const answer = await makes()(post('forms', 'repo=ahpd&ref=main', { 'content-type': 'application/x-www-form-urlencoded' }));
  expect(answer.status).toBe(202);
  expect(fired).toHaveLength(1);
  expect(fired[0]?.data['body']).toEqual({ repo: 'ahpd', ref: 'main' });
});

it('fires a text body, an empty body and a JSON array', async () => {
  opens('any');
  const route = makes();
  expect((await route(post('any', 'the build broke', { 'content-type': 'text/plain' }))).status).toBe(202);
  expect((await route(post('any'))).status).toBe(202);
  expect((await route(post('any', '[1,2]', { 'content-type': 'application/json' }))).status).toBe(202);
  expect(fired.map((one) => one.data['body'])).toEqual(['the build broke', null, [1, 2]]);
});

it('gives a run the call headers, without authorization', async () => {
  opens('gh');
  await makes()(post('gh', '{}', { 'content-type': 'application/json', 'x-github-event': 'push' }));
  const headers = fired[0]?.data['headers'] as Record<string, string>;
  expect(headers['x-github-event']).toBe('push');
  expect(headers).not.toHaveProperty('authorization');
});

it('answers 413 for a body over the limit, and fires nothing', async () => {
  opens('big');
  const answer = await makes(64)(post('big', 'x'.repeat(65)));
  expect(answer.status).toBe(413);
  expect(fired).toEqual([]);
});

it('reads a body as large as GitHub delivers by default, and answers 413 past 25 MiB', async () => {
  opens('github-sized');
  const route = makes();
  // Over the 5 MiB a smaller cap would refuse, under GitHub's 25 MB.
  expect((await route(post('github-sized', 'x'.repeat(6 * 1024 * 1024), { 'content-type': 'text/plain' }))).status).toBe(202);
  expect(fired).toHaveLength(1);
  expect((await route(post('github-sized', 'x'.repeat(25 * 1024 * 1024 + 1), { 'content-type': 'text/plain' }))).status).toBe(413);
  expect(fired).toHaveLength(1);
});

it('skips the calls its match does not take, and fires the ones it does', async () => {
  opens('push-only', { match: { 'headers.x-github-event': 'push' } });
  const route = makes();

  const pulled = await route(post('push-only', '{}', { 'x-github-event': 'pull_request' }));
  expect(pulled.status).toBe(202);
  expect(await json(pulled)).toEqual({ skipped: true });
  // A call with no such header cannot be told a push, so it is skipped too.
  expect(await json(await route(post('push-only', '{}')))).toEqual({ skipped: true });
  expect(fired).toEqual([]);

  expect((await route(post('push-only', '{}', { 'x-github-event': 'push' }))).status).toBe(202);
  expect(fired).toHaveLength(1);
});

it('runs the automation a connector names, and fires no trigger', async () => {
  opens('deploys', { automation: 'ahpd-automation:/deploys' });
  const answer = await makes()(post('deploys', '{"ref":"main"}', { 'content-type': 'application/json' }));
  expect(answer.status).toBe(202);
  expect(await json(answer)).toEqual({ endpoint: 'deploys', automation: 'ahpd-automation:/deploys' });
  expect(ran).toEqual([{
    automation: 'ahpd-automation:/deploys',
    data: { connector: 'deploys', method: 'POST', body: { ref: 'main' }, headers: { 'content-type': 'application/json' }, query: {} },
    owner: 'user:alice',
  }]);
  expect(fired).toEqual([]);
});

it('fires the trigger with the connector owner when the connector names neither target', async () => {
  opens('hooks');
  await makes()(post('hooks', '{}', { 'content-type': 'application/json' }));
  expect(fired).toEqual([{
    data: { connector: 'hooks', method: 'POST', body: {}, headers: { 'content-type': 'application/json' }, query: {} },
    owner: 'user:alice',
  }]);
});
