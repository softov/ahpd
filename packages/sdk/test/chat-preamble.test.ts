import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { idOf } from '../src/sessions/catalog.js';
import { createHost, ROOT } from '../src/host.js';
import { pluginHost } from '../src/plugins/plugins.js';
import { fileResources } from '../src/resources/resources.js';
import { hostTools } from '../src/tools/index.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, BoundTool } from '../src/types/agent.js';
import type { ChatPreamble, LoaderContext, OpenedChat } from '../src/types/plugin.js';
import type { Peer } from '../src/types/rpc.js';
import type { Session } from '../src/types/session.js';

/*
 * The text a plugin gives a new chat, asked by the host.
 *
 * The backend is the example one, wrapped to keep what each chat was started
 * with and every turn it was given. A preamble reaches a chat as the hidden
 * `context` of its start, which a backend carries on the chat's first prompt.
 */

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

/** The example backend, keeping each chat's start and turns, and able to fork and open a side chat. */
function recording(dir: string) {
  const base = echo({ path: dir, pace: 0 });
  const started = new Map<string, { context?: string; tools: BoundTool[] }>();
  const begun: { chat: string; text: string }[] = [];
  const workers: string[] = [];
  const agent: Agent = {
    ...base,
    chats: { fork: true, sideChat: true },
    create: (start) => {
      started.set(start.chatUri, {
        ...(start.context === undefined ? {} : { context: start.context }),
        tools: start.tools ?? [],
      });
      const chat = base.create(start);
      const kept: Session = {
        ...chat,
        forkPoint: () => 'point',
        begin: (...args: Parameters<Session['begin']>) => {
          begun.push({ chat: start.chatUri, text: args[1] });
          // A turn that asks for a worker opens one, as a backend's own subagent call does.
          if (args[1] === 'spawn a worker') {
            const worker = start.subagent?.('toolu_task', { title: 'Explore', prompt: 'list the files' });
            if (worker !== undefined) workers.push(worker.uri);
          }
          chat.begin(...args);
        },
      };
      return kept;
    },
  };
  return { agent, started, begun, workers };
}

/** A client on one session of a host with these preambles, and what the host asked them. */
async function opened(preambles: ChatPreamble[]) {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-preamble-'));
  made.push(dir);
  const { agent, started, begun, workers } = recording(dir);
  const asked: OpenedChat[] = [];
  const chatPreambles = preambles.map((preamble): ChatPreamble => async (one) => {
    asked.push(one);
    return await preamble(one);
  });
  const host = createHost({ path: dir, agents: [agent], resources: fileResources(), tools: hostTools(), chatPreambles });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  const uri = 'ahp-session:/bot';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: agent.provider } });
  const state = await client.handle({ method: 'subscribe', params: { channel: uri } }) as { snapshot: { state: { defaultChat: string } } };
  const lead = state.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: lead } });
  await settle();
  const say = async (chat: string, text: string, turnId: string = crypto.randomUUID()): Promise<void> => {
    await client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } } });
    await settle();
  };
  const createChat = async (params: Record<string, unknown>): Promise<void> => {
    await client.handle({ method: 'createChat', params: { channel: uri, ...params } });
    await settle();
  };
  // The lead chat by the name the host holds it under, which is what the host tells a plugin.
  const held = [...started.keys()][0] as string;
  return { client, uri, lead, held, started, begun, workers, asked, say, createChat };
}

const said = (text: string): ChatPreamble => async () => text;

describe('a chat a client opens', () => {
  it('runs no turn until a message arrives, and that turn carries the preamble', async () => {
    const { started, begun, createChat, say } = await opened([said('You are Motion.')]);
    await createChat({ chat: 'ahp-chat:/plain' });
    expect(begun.filter((one) => one.chat === 'ahp-chat:/plain')).toEqual([]);
    expect(started.get('ahp-chat:/plain')?.context).toBe('You are Motion.');

    await say('ahp-chat:/plain', 'hello');
    expect(begun.filter((one) => one.chat === 'ahp-chat:/plain').map((one) => one.text)).toEqual(['hello']);
  });

  it('puts the preamble before an initial message', async () => {
    const { started, begun, createChat } = await opened([said('You are Motion.')]);
    await createChat({ chat: 'ahp-chat:/first', initialMessage: { text: 'hello' } });
    expect(started.get('ahp-chat:/first')?.context).toBe('You are Motion.');
    expect(begun.filter((one) => one.chat === 'ahp-chat:/first').map((one) => one.text)).toEqual(['hello']);
  });

  it('tells the preamble the session, the chat and the session\'s other chats', async () => {
    const { held, asked, createChat } = await opened([said('You are Motion.')]);
    await createChat({ chat: 'ahp-chat:/plain' });
    expect(asked).toHaveLength(1);
    // The session by the name the host holds it under, whose id is the one the client chose.
    expect(idOf(asked[0]?.session ?? '')).toBe('bot');
    expect(asked[0]?.chat).toBe('ahp-chat:/plain');
    expect(asked[0]?.origin).toBeUndefined();
    expect(asked[0]?.chats.map((one) => one.resource)).toEqual([held]);
  });

  it('tells the preamble the origin of a side chat', async () => {
    const { lead, held, asked, say, createChat } = await opened([said('You are Motion.')]);
    await say(lead, 'the weather', 't1');
    await createChat({ chat: 'ahp-chat:/side', source: { kind: 'sideChat', chat: lead, turnId: 't1' } });
    expect(asked.map((one) => one.origin)).toEqual([{ kind: 'sideChat', chat: held, turnId: 't1' }]);
  });

  it('gives a fork no preamble, because its conversation already began with one', async () => {
    const { lead, asked, started, say, createChat } = await opened([said('You are Motion.')]);
    await say(lead, 'the weather', 't1');
    await createChat({ chat: 'ahp-chat:/fork', source: { kind: 'fork', chat: lead, turnId: 't1' } });
    expect(asked).toEqual([]);
    expect(started.get('ahp-chat:/fork')?.context).toBeUndefined();
  });

  it('gives a side chat the preamble first, then the turn it was made from', async () => {
    const { lead, started, say, createChat } = await opened([said('You are Motion.')]);
    await say(lead, 'the weather', 't1');
    await createChat({ chat: 'ahp-chat:/side', source: { kind: 'sideChat', chat: lead, turnId: 't1' } });
    expect(started.get('ahp-chat:/side')?.context).toBe('You are Motion.\n\nthe weather');
  });

  it('joins two preambles in plugin order', async () => {
    const { started, createChat } = await opened([said('One.'), said('Two.')]);
    await createChat({ chat: 'ahp-chat:/plain' });
    expect(started.get('ahp-chat:/plain')?.context).toBe('One.\n\nTwo.');
  });

  it('opens the chat with the other text when a preamble throws', async () => {
    const broken: ChatPreamble = async () => { throw new Error('the template store is down'); };
    const { started, createChat } = await opened([broken, said('Two.')]);
    await createChat({ chat: 'ahp-chat:/plain' });
    expect(started.has('ahp-chat:/plain')).toBe(true);
    expect(started.get('ahp-chat:/plain')?.context).toBe('Two.');
  });

  it('opens the chat as before when a preamble gives nothing', async () => {
    const { started, createChat } = await opened([async () => undefined]);
    await createChat({ chat: 'ahp-chat:/plain' });
    expect(started.has('ahp-chat:/plain')).toBe(true);
    expect(started.get('ahp-chat:/plain')?.context).toBeUndefined();
  });
});

describe('a chat a tool opens', () => {
  it('carries the preamble before the tool\'s prompt', async () => {
    const { held, started, begun, asked } = await opened([said('You are Motion.')]);
    const tool = started.get(held)?.tools.find((one) => one.definition.name === 'create_chat');
    await tool?.run?.({ prompt: 'look at the tests', title: 'Tests' });
    await settle();
    const chat = [...started.keys()].find((one) => one !== held) as string;
    expect(asked.map((one) => one.chat)).toEqual([chat]);
    expect(started.get(chat)?.context).toBe('You are Motion.');
    expect(begun.filter((one) => one.chat === chat).map((one) => one.text)).toEqual(['look at the tests']);
  });
});

describe('a chat the host opens for itself', () => {
  it('does not ask for a subagent worker chat', async () => {
    const { lead, workers, asked, say } = await opened([said('You are Motion.')]);
    await say(lead, 'spawn a worker');
    expect(workers).toHaveLength(1);
    expect(asked).toEqual([]);
  });
});

describe('registerChatPreamble', () => {
  const context = (): LoaderContext => ({ path: '/tmp', paths: ['/tmp'], version: sdkVersion(), hostName: 'test', configDir: '/tmp', log: () => {}, say: () => {} });

  it('keeps a preamble in the plugin\'s contribution', async () => {
    const { host, contribution } = pluginHost('@ahpd/bot', context());
    host.registerChatPreamble(said('You are Motion.'));
    expect(contribution.preambles).toHaveLength(1);
    expect(await contribution.preambles[0]?.({ session: 's', chat: 'c', chats: [] })).toBe('You are Motion.');
  });

  it('refuses a preamble that is not a function', () => {
    const { host } = pluginHost('@ahpd/bot', context());
    expect(() => { host.registerChatPreamble('You are Motion.' as unknown as ChatPreamble); }).toThrow(/@ahpd\/bot/);
  });

  it('names the plugin when its preamble throws', async () => {
    const { host, contribution } = pluginHost('@ahpd/bot', context());
    host.registerChatPreamble(async () => { throw new Error('the store is down'); });
    await expect(contribution.preambles[0]?.({ session: 's', chat: 'c', chats: [] })).rejects.toThrow('plugin @ahpd/bot: the store is down');
  });
});
