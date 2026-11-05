import { expect, it } from 'vitest';
import type { Agent, Listed, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Session } from '../src/types/session.js';
import type { Peer } from '../src/types/rpc.js';
import { createCallLinks } from '../src/automations/calllinks.js';
import { Status } from '../src/sessions/catalog.js';
import { undeclaredIn } from './support/wire.js';

/*
 * A spawning call's link, when the chat it names is in another session.
 *
 * A worker's chat is opened by the host, so its URI is the host's to mint: the
 * call carries `_meta.toolKind: 'subagent'` and the host stamps a worker chat
 * of the session the call is in. A bot's main turn is the other kind - the
 * chat it waits on belongs to a back session, which this host already holds as
 * a session of its own, and a worker chat derived for the call would name a
 * chat nobody opened. The link is the `subagent` content, and it names a chat
 * a client can subscribe to.
 */

const { createHost } = await import('../src/host.js');

/** Every frame the host put on the wire, in order. */
const wire: { method: string; params: Record<string, unknown> }[] = [];

function peer(): Peer {
  return {
    send: () => {},
    notify: (method, params) => { wire.push({ method, params: params as Record<string, unknown> }); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Every action dispatched on one channel, in order. */
const on = (channel: string): Bag[] => wire
  .filter((one) => one.method === 'action' && one.params.channel === channel)
  .map((one) => one.params.action as Bag);

/** The chat each session was started with, by the URI the host holds it under. */
const chats = new Map<string, string>();

/**
 * A backend with two sessions, one of which links the other's chat.
 *
 * The turn in the `main` session opens a call of kind `subagent` the way a
 * bot's main turn does, and its content names the `back` session's default
 * chat. No worker is asked for: the chat is already there, as a session of its
 * own, and the point of the call is to point at it.
 */
function linking(): Agent {
  const agent: Agent = {
    provider: 'fake',
    displayName: 'Fake',
    schema: () => ({ type: 'object', properties: {} }),
    defaults: () => ({}),
    list: async (): Promise<Listed[]> => [],
    create: (start: Start): Session => {
      chats.set(start.uri, start.chatUri);
      const title = start.uri === 'ahp-session:/main' ? 'Main' : 'Back';
      const turns: Bag[] = [];
      let active: Bag | undefined;
      return {
        uri: start.uri,
        chatUri: start.chatUri,
        models: () => [],
        agentId: () => start.uri,
        customizations: () => [],
        allTurns: () => turns,
        activity: () => (active ? 'Thinking' : undefined),
        status: () => (active ? Status.InProgress : Status.Idle),
        title: () => title,
        modifiedAt: () => new Date().toISOString(),
        workingDirectories: () => ['file:///tmp'],
        settings: () => ({}),
        sessionState: () => ({
          resource: start.uri, provider: 'fake', title, status: active ? Status.InProgress : Status.Idle,
          lifecycle: 'ready', defaultChat: start.chatUri, chats: [{ resource: start.chatUri, title }],
          workingDirectories: ['file:///tmp'], customizations: [], config: { schema: start.schema(), values: {} },
        }),
        chatState: () => ({
          resource: start.chatUri, title, status: active ? Status.InProgress : Status.Idle,
          modifiedAt: new Date().toISOString(), turns,
          ...(active ? { activeTurn: active } : {}), queuedMessages: [], interactivity: 'full',
        }),
        changeModel: () => {},
        changeAgent: () => {},
        sendMessage: (turnId, text) => {
          const startedAt = new Date().toISOString();
          active = {
            id: turnId, startedAt, message: { text, origin: { kind: 'user' } },
            responseParts: [], usage: undefined,
          };
          start.emit('chat', { type: 'chat/turnStarted', turnId, startedAt, message: active.message });
          // Not the main session: nothing happens here but an empty turn.
          if (start.uri !== 'ahp-session:/main') return;
          const toolCallId = 'toolu_work';
          const back = chats.get('ahp-session:/back') ?? '';
          start.emit('chat', {
            type: 'chat/toolCallStart', turnId, toolCallId, toolName: 'subagent', displayName: 'Back',
            _meta: { toolKind: 'subagent' },
          });
          start.emit('chat', {
            type: 'chat/toolCallReady', turnId, toolCallId, invocationMessage: 'Back', confirmed: 'not-needed',
            _meta: { toolKind: 'subagent' },
          });
          const content = [{ type: 'subagent', resource: back, title: 'Back' }];
          // As the reducer leaves it after the three actions above: the part
          // a client holds, and the one a snapshot is served from.
          (active.responseParts as Bag[]).push({
            kind: 'toolCall',
            toolCall: {
              toolCallId, toolName: 'subagent', displayName: 'Back', status: 'running',
              confirmed: 'not-needed', invocationMessage: 'Back', content, _meta: { toolKind: 'subagent' },
            },
          });
          start.emit('chat', {
            type: 'chat/toolCallContentChanged', turnId, toolCallId, content,
            _meta: { toolKind: 'subagent' },
          });
        },
        abort: () => {},
        setDraft: () => {},
        confirm: () => false,
        answer: () => false,
        setCustomizationEnabled: async () => false,
        startMcpServer: async () => false,
        stopMcpServer: async () => false,
        close: () => {},
      };
    },
  };
  return agent;
}

const asking = (client: { handle(r: { method: string; params: unknown }): Promise<unknown> }) =>
  async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => await client.handle({ method, params });

/**
 * A host with two sessions, and a turn in the main one whose call links the
 * other's chat.
 *
 * Both sessions are subscribed before the turn is sent, so the actions the
 * call travels on are on the wire when the test reads them.
 */
async function linked() {
  wire.length = 0;
  chats.clear();
  const host = createHost({ path: '/tmp', agents: [linking()] });
  const client = host.accept(peer());
  const ask = asking(client);
  await ask('initialize', {
    channel: 'ahp-root://', clientId: 'link', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'],
  });
  await ask('createSession', { channel: 'ahp-session:/back', provider: 'fake' });
  await ask('createSession', { channel: 'ahp-session:/main', provider: 'fake' });
  await settle();
  const backChat = chats.get('ahp-session:/back') as string;
  const mainChat = chats.get('ahp-session:/main') as string;
  await ask('subscribe', { channel: mainChat });
  await ask('subscribe', { channel: backChat });
  void client.handle({
    method: 'dispatchAction',
    params: { channel: mainChat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'work on it' } } },
  });
  await settle();
  return { ask, mainChat, backChat };
}

it('keeps the chat a call links in another session', async () => {
  const { ask, mainChat, backChat } = await linked();

  const linkedOn = on(mainChat).filter((one) => one.type === 'chat/toolCallContentChanged');
  expect(linkedOn).toHaveLength(1);
  expect(linkedOn[0]?.content).toEqual([{ type: 'subagent', resource: backChat, title: 'Back' }]);
  /*
   * The link kept where the host stamps spawning calls: the action said
   * `toolKind: 'subagent'` and named no chat, so without the content the host
   * would have derived a worker chat of the main session - a chat nothing
   * opened. What it stamped instead is the chat the call works with.
   */
  expect((linkedOn[0]?._meta as Bag).subagentChatUri).toBe(backChat);

  // And the state a client subscribing late reads says the same, from the
  // part's own content rather than from what the index happened to see.
  const opened = await ask('subscribe', { channel: mainChat }) as { snapshot: { state: Bag } };
  const active = opened.snapshot.state.activeTurn as Bag | undefined;
  expect(active).toBeDefined();
  const part = ((active?.responseParts ?? []) as Bag[]).find((one) => one.kind === 'toolCall') as Bag;
  expect(part.toolCall).toMatchObject({
    status: 'running',
    content: [{ type: 'subagent', resource: backChat, title: 'Back' }],
    _meta: { toolKind: 'subagent', subagentChatUri: backChat },
  });
});

it('answers a subscribe to the chat the call links', async () => {
  const { ask, backChat } = await linked();

  /*
   * The chat is a session's own, not a worker of the main one, so it is served
   * like any other chat: its state, from the session that holds it. A link to
   * a worker chat the host derived would answer `No worker chat at ...` here.
   */
  const opened = await ask('subscribe', { channel: backChat }) as { snapshot: { resource: string; state: Bag } };
  expect(opened.snapshot.resource).toBe(backChat);
  expect(opened.snapshot.state.resource).toBe(backChat);
  // Nothing is running in it: the chat is the back session's own, idle until a
  // message reaches it.
  expect(Number(opened.snapshot.state.status) & Status.InProgress).toBe(0);
  expect(opened.snapshot.state.turns).toEqual([]);
});

it('keeps the link a spawning call names in the index', () => {
  const links = createCallLinks();
  const main = 'ahp-chat://default/bWFpbg';
  const back = 'ahp-chat://default/YmFjaw';
  links.observe(main, { type: 'chat/turnStarted', turnId: 't1' });
  links.observe(main, {
    type: 'chat/toolCallStart', turnId: 't1', toolCallId: 'toolu_work', toolName: 'subagent', displayName: 'Back',
    _meta: { toolKind: 'subagent' },
  });
  links.observe(main, {
    type: 'chat/toolCallContentChanged', turnId: 't1', toolCallId: 'toolu_work',
    content: [{ type: 'subagent', resource: back, title: 'Back' }],
  });
  expect(links.linkOf(main, 'toolu_work')).toBe(back);
  expect(links.contentOf(main, 'toolu_work')).toEqual([{ type: 'subagent', resource: back, title: 'Back' }]);
});

it('sends nothing the protocol does not declare', async () => {
  await linked();
  expect(undeclaredIn(wire)).toEqual([]);
});
