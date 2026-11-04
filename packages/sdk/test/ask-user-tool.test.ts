import { describe, expect, it, vi } from 'vitest';
import { actions, createHost, echo, hello, hostTools, peer, settle } from './support/host.js';
import type { Agent, BoundTool } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Session } from '../src/types/session.js';

/*
 * The `ask_user` tool, through the host.
 *
 * The tool's input and its answer checks are cofold's, and what is checked
 * here is the road the host gives them: one request on the chat for every
 * question of one call, the answers back in the order the model asked, and a
 * call the tool refuses before anything reaches the person.
 *
 * The backend is the echo one with its turn left open, so the case says when
 * a question's turn ends. Echo itself would answer and end the turn before a
 * question could be drawn in it.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

/** What each chat was handed, by the chat URI. */
const handed = new Map<string, BoundTool[]>();

/** The echo backend, keeping the tools of each session, and never ending a turn by itself. */
const quiet = (): Agent => {
  const base = echo({ path: '/home/softov', pace: 0 });
  return {
    ...base,
    create: (start) => {
      handed.set(start.chatUri, [...(start.tools ?? [])]);
      const session = base.create(start) as Session;
      return {
        ...session,
        // Say the turn began and stop there. Echo would answer and complete
        // it before the case could ask, and a question needs a turn to be
        // drawn in.
        sendMessage: (turnId, text) => {
          start.emit('chat', {
            type: 'chat/turnStarted',
            turnId,
            startedAt: new Date().toISOString(),
            message: { text, origin: { kind: 'user' } },
          });
        },
      };
    },
  };
};

/** A host that contributes its own tools, and the session it serves. */
async function serving() {
  const host = createHost({ path: '/home/softov', agents: [quiet()], tools: hostTools() });
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello(['0.9.0']));
  const uri = 'ahp-session:/asking';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  const chatUri = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });

  /** The `ask_user` this session was handed, as the model calls it. */
  const tool = (): BoundTool => {
    const found = handed.get(chatUri)?.find((one) => one.definition.name === 'ask_user');
    if (found?.run === undefined) throw new Error('the session was handed no ask_user');
    return found;
  };

  /** A turn running in the chat, which is what a question needs to be drawn. */
  const begin = async (turnId = 't1'): Promise<void> => {
    await client.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
        action: {
          type: 'chat/turnStarted',
          turnId,
          startedAt: new Date().toISOString(),
          message: { text: 'a turn', origin: { kind: 'user' } },
        },
      },
    });
    await settle();
  };

  /** The questions this host put on the chat. */
  const requests = (): Bag[] => actions(p, chatUri)
    .filter((one) => one.action.type === 'chat/inputRequested')
    .map((one) => one.action.request as Bag);

  const completing = async (requestId: string, action: Bag): Promise<void> => {
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/inputCompleted', requestId, ...action } },
    });
    await settle();
  };

  return { client, p, uri, chatUri, tool, begin, requests, completing };
}

describe('ask_user', () => {
  it('asks every question of one call in one request, and answers in order', async () => {
    const { tool, begin, requests, completing } = await serving();
    await begin();
    const pending = Promise.resolve(tool().run?.({
      questions: [
        { id: 'one', question: 'Which one?', header: 'First', options: [{ label: 'a' }, { label: 'b' }] },
        { id: 'two', question: 'And then?' },
      ],
    }));
    await settle();

    const sent = requests();
    expect(sent).toHaveLength(1);
    const questions = sent[0]?.questions as Bag[];
    expect(questions.map((one) => one.id)).toEqual(['one', 'two']);
    expect(questions[0]).toMatchObject({ kind: 'single-select', message: 'Which one?', title: 'First' });
    expect(questions[1]).toMatchObject({ kind: 'text', message: 'And then?' });

    await completing(String(sent[0]?.id), {
      response: 'accept',
      answers: {
        one: { state: 'submitted', value: { kind: 'selected', value: 'a' } },
        two: { state: 'submitted', value: { kind: 'text', value: 'yes' } },
      },
    });

    expect(await pending).toBe('Which one? (one): a\nAnd then? (two): yes');
  });

  it('refuses a duplicate question id before asking anybody', async () => {
    const { tool, begin, requests } = await serving();
    await begin();
    const refused = async (): Promise<unknown> => await tool().run?.({
      questions: [{ id: 'same', question: 'One?' }, { id: 'same', question: 'Two?' }],
    });
    await expect(refused()).rejects.toThrow('duplicate question id "same"');
    expect(requests()).toEqual([]);
  });

  it('refuses multiSelect with no options', async () => {
    const { tool, begin, requests } = await serving();
    await begin();
    const refused = async (): Promise<unknown> => await tool().run?.({
      questions: [{ id: 'many', question: 'Which ones?', multiSelect: true }],
    });
    await expect(refused()).rejects.toThrow('multiSelect needs options');
    expect(requests()).toEqual([]);
  });
});
