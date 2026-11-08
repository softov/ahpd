import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { chatReducer } from '@microsoft/agent-host-protocol';
import { createHost } from '../src/host.js';
import { memoryAutomations } from '../src/automations/automations.js';
import { demo } from '../../../examples/demo/agent.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * The demo example, driven as a client drives it.
 *
 * What it adds to `notes` is what a client draws: models and customizations
 * before any session, automations, a turn that runs and a turn that fails.
 */

type Client = { handle(r: { method: string; params: unknown }): Promise<unknown> };

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Settle until something is true, rather than a fixed number of times. */
const until = async (ready: () => boolean | Promise<boolean>, tries = 200): Promise<void> => {
  for (let i = 0; i < tries; i++) {
    if (await ready()) return;
    await settle(2);
  }
  throw new Error(`still waiting after ${tries} tries`);
};

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A connected client on a demo host. `every` is how fast `slow` streams. */
async function connected(every = 5) {
  const dir = await mkdtemp(join(tmpdir(), 'ahpd-demo-'));
  dirs.push(dir);
  const host = createHost({
    path: dir,
    agents: [demo({ path: dir, pace: 0, every })],
    automations: memoryAutomations(),
  });
  const p = peer();
  const client = host.accept(p) as Client;
  await client.handle({
    method: 'initialize',
    params: { clientId: 'demo', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  return { dir, client, peer: p };
}

/** A connected client with one demo session, watching its chat. */
async function talking(every = 5) {
  const held = await connected(every);
  const uri = 'ahp-session:/one';
  await held.client.handle({ method: 'createSession', params: { channel: uri, provider: 'demo' } });
  const opened = await held.client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string; provider: string } };
  };
  const chatUri = opened.snapshot.state.defaultChat;
  await held.client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { ...held, uri, chatUri, provider: opened.snapshot.state.provider };
}

const actions = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown>; rejectionReason?: string })
  .filter((e) => e.channel === channel && e.rejectionReason === undefined)
  .map((e) => e.action);

const say = (client: Client, chatUri: string, text: string, turnId = `t${String(Date.now())}`): string => {
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, message: { text } } },
  });
  return turnId;
};

/** The chat a client ends up with, built the way a client builds it. */
const reduced = (p: ReturnType<typeof peer>, chatUri: string) => {
  let chat: Record<string, unknown> = {
    resource: chatUri, title: '', status: 1, modifiedAt: '', turns: [], queuedMessages: [],
  };
  for (const action of actions(p, chatUri)) chat = chatReducer(chat as never, action as never) as never;
  return chat as {
    turns: { state?: string; responseParts: Record<string, unknown>[] }[];
    activeTurn?: { id: string; responseParts: Record<string, unknown>[] };
  };
};

/** The session's status, as the catalogue reports it, with its read and archived bits. */
const statusOf = async (client: Client, uri: string): Promise<number> => {
  const listed = await client.handle({ method: 'listSessions', params: {} }) as { items: { resource: string; status: number }[] };
  return listed.items.find((one) => one.resource === uri)?.status ?? -1;
};

it('lists the demo agent with its models before any session', async () => {
  const { client } = await connected();
  await until(async () => {
    const root = await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { agents: { provider: string; models: { id: string }[] }[] } };
    };
    const one = root.snapshot.state.agents.find((agent) => agent.provider === 'demo');
    return (one?.models.length ?? 0) > 0;
  });
  const root = await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
    snapshot: { state: { agents: { provider: string; displayName: string; models: { id: string }[] }[] } };
  };
  const one = root.snapshot.state.agents.find((agent) => agent.provider === 'demo');
  expect(one?.displayName).toBe('Agent Demo');
  expect(one?.models.map((model) => model.id)).toEqual(['demo-fast', 'demo-large', 'demo-small']);
});

it('reports its session as demo, with the customizations', async () => {
  const { provider, client, uri } = await talking();
  expect(provider).toBe('demo');
  await until(async () => {
    const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { customizations: { name: string }[] } };
    };
    return opened.snapshot.state.customizations.some((one) => one.name === 'summarize');
  });
});

it('offers a mode beside the notes fields, as a real host does', async () => {
  const { client, uri } = await talking();
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { config?: { schema: { properties: Record<string, { title: string }> }; values: Record<string, unknown> } } };
  };
  const config = opened.snapshot.state.config;
  expect(Object.keys(config?.schema.properties ?? {})).toEqual(expect.arrayContaining(['mode', 'autoApprove', 'tone']));
  expect(config?.schema.properties.mode?.title).toBe('Agent Mode');
  expect(config?.values.mode).toBe('interactive');
});

it('lists an automation a client creates', async () => {
  const { client, dir } = await connected();
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: 'ahp-automations://',
      action: {
        type: 'automation/createRequested',
        resource: 'ahp-automation:/tidy',
        definition: {
          title: 'Tidy the notes',
          enabled: true,
          message: { text: 'read' },
          session: { provider: 'demo', workingDirectories: [`file://${dir}`] },
          triggers: [],
        },
      },
    },
  });
  const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-automations://' } }) as {
    snapshot: { state: { entries: { resource: string }[] } };
  };
  expect(opened.snapshot.state.entries.map((one) => one.resource)).toContain('ahp-automation:/tidy');
});

it('keeps a slow turn running, and finishes it after the last line', async () => {
  const { client, peer: p, uri, chatUri } = await talking(5);
  say(client, chatUri, 'slow');
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/delta'));
  expect((await statusOf(client, uri)) & 8).toBe(8);
  expect(reduced(p, chatUri).activeTurn).toBeDefined();

  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/turnComplete'), 2000);
  const chat = reduced(p, chatUri);
  expect(chat.activeTurn).toBeUndefined();
  expect(String(chat.turns[0]?.responseParts[0]?.content)).toContain('Line 60 of 60.');
  expect((await statusOf(client, uri)) & (8 | 2)).toBe(0);
});

it('stops a slow turn on cancel, and streams nothing after it', async () => {
  const { client, peer: p, chatUri } = await talking(5);
  const turnId = say(client, chatUri, 'slow');
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/delta'));
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId } },
  });
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/turnCancelled'));
  const seen = actions(p, chatUri).length;
  await new Promise((r) => { setTimeout(r, 40); });
  expect(actions(p, chatUri).length).toBe(seen);
  expect(reduced(p, chatUri).turns[0]?.state).toBe('cancelled');
});

it('titles a session from its first slow or fail, as notes titles one', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  say(client, chatUri, 'fail');
  await until(() => actions(p, uri).some((a) => a.type === 'session/titleChanged'));
  expect(actions(p, uri).find((a) => a.type === 'session/titleChanged')?.title).toBe('fail');
});

it('ends a fail turn with an error, and the session shows it', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  say(client, chatUri, 'fail');
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/error'));
  const chat = reduced(p, chatUri);
  expect(chat.turns[0]?.state).toBe('error');
  await until(async () => ((await statusOf(client, uri)) & 2) === 2);
});

it('still asks which note on read, as notes does', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  say(client, chatUri, 'read');
  await until(() => actions(p, uri).some((a) => a.type === 'session/inputNeededSet'));
  expect(actions(p, chatUri).map((a) => a.type)).toContain('chat/inputRequested');
});
