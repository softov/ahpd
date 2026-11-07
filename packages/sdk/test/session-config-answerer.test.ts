import { expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Peer } from '../src/types/rpc.js';
import { memorySessions } from '../src/sessions/sessions.js';

/*
 * A backend answering a key of its own schema.
 *
 * A key a backend names in `completions` is one it has the answers to, and the
 * host marks it `enumDynamic` so a client draws a picker rather than a text
 * box. The ask names the provider, so the answerer reached is the one for the
 * backend the session would run on, and never another backend's.
 */

const DIR = '/tmp/ahpd-answerer';

const peer = (): Peer => ({
  send: () => {},
  notify: () => {},
  request: async () => ({}),
  answered: () => {},
  close: () => {},
});

const settle = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/**
 * A backend with one key of its own, answered by `answer`.
 *
 * Everything else is the example's: what is under test is the schema the host
 * publishes and the lookup behind the picker, not a session.
 */
function pickerBackend(
  answer: (query: string) => { value: string; label: string }[],
  extra: Partial<Agent> = {},
): Agent & { asked: string[] } {
  const base = echo({ path: DIR, pace: 0 });
  const asked: string[] = [];
  return {
    ...base,
    provider: 'picker',
    displayName: 'Picker',
    schema: () => ({ properties: { bot: { type: 'string', title: 'Bot' } } }),
    defaults: () => ({}),
    completions: {
      bot: (ask) => {
        asked.push(ask.query);
        return answer(ask.query);
      },
    },
    ...extra,
    // The counter travels with the agent rather than on it, so a test can see
    // what a lookup reached without the host knowing the shape.
    asked,
  } as Agent & { asked: string[] };
}

/** A host with one or two backends, and a client that has said hello. */
async function serving(agents: Agent[]) {
  const host = createHost({ path: DIR, agents, sessions: memorySessions() });
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await settle();
  return client;
}

type Client = Awaited<ReturnType<typeof serving>>;

/** What a client was offered for the new session form. */
const offered = async (client: Client, provider: string): Promise<Bag> => (await client.handle({
  method: 'resolveSessionConfig',
  params: { channel: ROOT, provider },
}) as { schema: { properties: Bag } }).schema.properties;

const BOTS = [
  { value: 'ana', label: 'Ana' },
  { value: 'bo', label: 'Bo' },
];

it('marks an answered key of the backend and seeds it from the answerer', async () => {
  const agent = pickerBackend(() => BOTS);
  const client = await serving([agent]);

  // The key is marked before the first client opens its picker, and carrying
  // the first page so a chip is labelled rather than drawn as a raw value.
  expect((await offered(client, 'picker')).bot).toMatchObject({
    type: 'string',
    enumDynamic: true,
    enum: ['ana', 'bo'],
    enumLabels: ['Ana', 'Bo'],
  });
  expect(agent.asked).toEqual(['']);
});

it('answers the picker only for the provider the ask names', async () => {
  const picker = pickerBackend(() => BOTS);
  const other = echo({ path: DIR, pace: 0 });
  const client = await serving([picker, other]);

  const mine = await client.handle({
    method: 'sessionConfigCompletions',
    params: { channel: ROOT, provider: 'picker', property: 'bot', query: '' },
  }) as { items: unknown };
  expect(mine.items).toEqual(BOTS);

  picker.asked.length = 0;
  const theirs = await client.handle({
    method: 'sessionConfigCompletions',
    params: { channel: ROOT, provider: 'echo', property: 'bot', query: '' },
  }) as { items: unknown };
  expect(theirs.items).toEqual([]);
  // Not asked at all: another backend's key is not this one's to answer.
  expect(picker.asked).toEqual([]);
});

/*
 * The answerer's failure is the request's, as VS Code's host lets a
 * provider's completions fail the request.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L11070-L11081
 */
it('fails the request when the answerer throws', async () => {
  const agent = pickerBackend(() => { throw new Error('no bot list today'); });
  const client = await serving([agent]);

  await expect(client.handle({
    method: 'sessionConfigCompletions',
    params: { channel: ROOT, provider: 'picker', property: 'bot', query: '' },
  })).rejects.toThrow('no bot list today');
});

/*
 * `branch` is the host's for every agent, as VS Code's host answers it from
 * its own list before asking a provider anything.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L11070-L11075
 */
it('answers branch from the host\'s own list, whatever the backend would say', async () => {
  const agent = pickerBackend(() => [], {
    completions: { branch: () => [{ value: 'the-backends', label: 'the-backends' }] },
  });
  const host = createHost({
    path: DIR, agents: [agent], sessions: memorySessions(),
    worktrees: {
      repository: async (where) => where,
      branches: async () => ['main', 'feature'],
      create: async () => {},
      dirty: async () => false,
      remove: async () => {},
    },
  });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });

  const answer = await client.handle({
    method: 'sessionConfigCompletions',
    params: { channel: ROOT, provider: 'picker', property: 'branch', query: '' },
  }) as { items: { value: string }[] };
  expect(answer.items.map((one) => one.value)).toEqual(['main', 'feature']);
});

it('leaves a key the schema does not declare alone', async () => {
  const base = echo({ path: DIR, pace: 0 });
  const agent: Agent = {
    ...base,
    provider: 'ghosted',
    displayName: 'Ghosted',
    completions: { ghost: () => BOTS },
  };
  const client = await serving([agent]);

  const properties = await offered(client, 'ghosted');
  expect(properties.ghost).toBeUndefined();
  expect(properties.voice).not.toHaveProperty('enumDynamic');
});
