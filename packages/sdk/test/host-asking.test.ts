import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, claude, resetSdk, running, sessionQueries, settle } from './support/host.js';
import type { Agent } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { AskedQuestion, HostTool } from '../src/types/host.js';
import type { Session } from '../src/types/session.js';

/*
 * A host tool asking the person.
 *
 * The tool here is the smallest one that calls `at.ask`, because what is under
 * test is the road from a tool's question to the person's answer and back:
 * `chat/inputRequested` on the tool's chat, `chat/inputCompleted` settled by
 * the host rather than handed to a backend, and a turn that ends taking the
 * question with it.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/** A tool whose whole answer is what `at.ask` said. */
const asking: HostTool = {
  definition: {
    name: 'inquire',
    description: 'Ask the person something',
    inputSchema: { type: 'object', properties: { questions: { type: 'array' } }, required: ['questions'] },
  },
  run: async (input, at) => JSON.stringify(await at.ask(input.questions as AskedQuestion[])),
};

const two: AskedQuestion[] = [
  {
    id: 'pick',
    question: 'Which colour?',
    header: 'Colour',
    options: [{ label: 'red' }, { label: 'blue', description: 'The cool one' }],
  },
  { id: 'why', question: 'Why?' },
];

interface Tool {
  name: string;
  handler: (input: unknown) => Promise<{ content: { text: string }[] }>;
}

/** What a host tool answered, read out of the text the backend was given. */
const said = (answer: { content: { text: string }[] }): Bag =>
  JSON.parse(answer.content[0]?.text ?? '{}') as Bag;

/**
 * A host whose one tool asks, and the backend it runs.
 *
 * The backend is the Claude one with `answer` watched, because the case that
 * matters is that a request this host asked never reaches it.
 */
async function serving() {
  const base = claude({ paths: ['/home/softov'] });
  const answered: string[] = [];
  const watched: Agent = {
    ...base,
    create: (start) => {
      const session = base.create(start) as Session;
      return {
        ...session,
        answer: (requestId, accepted, answers, response) => {
          answered.push(requestId);
          return session.answer(requestId, accepted, answers, response);
        },
      };
    },
  };
  const { client, peer: p, uri, chatUri } = await running({ agents: [watched], tools: [asking] });

  /** The tool as the backend was handed it. */
  const tool = (): Tool => {
    const servers = sessionQueries().at(-1)?.options.mcpServers as Record<string, { tools: Tool[] }> | undefined;
    const found = servers?.ahp?.tools.find((one) => one.name === 'inquire');
    if (found === undefined) throw new Error('the backend was handed no inquire tool');
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

  /** The last question this host put on the chat. */
  const lastRequest = (): Bag =>
    (actions(p, chatUri).filter((one) => one.action.type === 'chat/inputRequested').at(-1)?.action
      .request ?? {}) as Bag;

  const completing = async (requestId: string, action: Bag): Promise<void> => {
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/inputCompleted', requestId, ...action } },
    });
    await settle();
  };

  return { client, p, uri, chatUri, answered, tool, begin, lastRequest, completing };
}

describe('a host tool asks the person', () => {
  /*
   * The session lists it as it lists any chat's question, so a client watching
   * only the session sees the session waits on a person, as VS Code's host
   * mirrors every chat's question whoever asked it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L85-L103
   */
  it('lists its question in the session under VS Code\'s id, and takes it down once answered', async () => {
    const { p, uri, chatUri, tool, begin, lastRequest, completing } = await serving();
    await begin();
    const pending = tool().handler({ questions: two });
    await settle();

    const request = lastRequest();
    const raised = actions(p, uri).filter((one) => one.action.type === 'session/inputNeededSet');
    expect(raised.map((one) => one.action.request)).toMatchObject([
      { id: `chatInput:${chatUri}:${String(request.id)}`, kind: 'chatInput', chat: chatUri, request: { id: request.id } },
    ]);

    await completing(String(request.id), { response: 'cancel' });
    await pending;
    const removed = actions(p, uri).filter((one) => one.action.type === 'session/inputNeededRemoved');
    expect(removed.map((one) => one.action.id)).toEqual([`chatInput:${chatUri}:${String(request.id)}`]);
  });

  it('puts one request on the chat and returns the answers, in order', async () => {
    const { client, p, chatUri, answered, tool, begin, lastRequest, completing } = await serving();
    await begin();
    const pending = tool().handler({ questions: two });
    await settle();

    const request = lastRequest();
    // The host's own id, which no backend can have minted.
    expect(String(request.id)).toMatch(/^host-ask:/);
    const questions = request.questions as Bag[];
    expect(questions.map((one) => one.id)).toEqual(['pick', 'why']);
    expect(questions[0]).toMatchObject({
      kind: 'single-select',
      message: 'Which colour?',
      title: 'Colour',
      required: true,
      options: [{ id: 'red', label: 'red' }, { id: 'blue', label: 'blue', description: 'The cool one' }],
    });
    expect(questions[1]).toMatchObject({ kind: 'text', message: 'Why?' });

    await completing(String(request.id), {
      response: 'accept',
      answers: {
        pick: { state: 'submitted', value: { kind: 'selected', value: 'blue' } },
        why: { state: 'submitted', value: { kind: 'text', value: 'because' } },
      },
    });

    expect(said(await pending)).toEqual({ response: 'accept', answers: { pick: 'blue', why: 'because' } });
    // The backend did not ask it, so the backend was never told the answer.
    expect(answered).toEqual([]);
    // The client sees the completion, which is what draws the answer.
    expect(actions(p, chatUri).map((one) => one.action.type)).toContain('chat/inputCompleted');
    expect((await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { activeTurn?: { responseParts?: Bag[] } } };
    }).snapshot.state.activeTurn?.responseParts?.find((one) => one.kind === 'inputRequest'))
      .toMatchObject({ response: 'accept' });
  });

  it('returns a decline as an answer, not an error', async () => {
    const { answered, tool, begin, lastRequest, completing } = await serving();
    await begin();
    const pending = tool().handler({ questions: [{ id: 'go', question: 'Go on?' }] });
    await settle();
    await completing(String(lastRequest().id), { response: 'decline' });
    expect(said(await pending)).toEqual({ response: 'decline', answers: {} });
    expect(answered).toEqual([]);
  });

  it('returns a cancel as an answer, not an error', async () => {
    const { answered, tool, begin, lastRequest, completing } = await serving();
    await begin();
    const pending = tool().handler({ questions: [{ id: 'go', question: 'Go on?' }] });
    await settle();
    await completing(String(lastRequest().id), { response: 'cancel' });
    expect(said(await pending)).toEqual({ response: 'cancel', answers: {} });
    expect(answered).toEqual([]);
  });

  it('refuses an answer sent on another chat, and leaves the question waiting', async () => {
    const { client, uri, tool, begin, lastRequest, completing } = await serving();
    await begin();
    const pending = tool().handler({ questions: [{ id: 'go', question: 'Go on?' }] });
    await settle();
    const id = String(lastRequest().id);

    // A second chat of the same session, where the question was never asked.
    const other = 'ahp-chat:/other';
    await client.handle({ method: 'createChat', params: { channel: uri, chat: other } });
    await settle();
    await client.handle({
      method: 'dispatchAction',
      params: {
        channel: other,
        action: { type: 'chat/inputCompleted', requestId: id, response: 'accept', answers: { go: { state: 'submitted', value: { kind: 'text', value: 'yes' } } } },
      },
    });
    await settle();

    let done = false;
    void pending.then(() => { done = true; });
    await settle();
    expect(done).toBe(false);

    // The chat it was asked on still settles it.
    await completing(id, { response: 'decline' });
    expect(said(await pending)).toEqual({ response: 'decline', answers: {} });
  });

  it('cancels a waiting question when the turn is stopped', async () => {
    const { client, chatUri, answered, tool, begin } = await serving();
    await begin();
    const pending = tool().handler({ questions: [{ id: 'go', question: 'Go on?' }] });
    await settle();

    await client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
    });
    await settle();

    expect(said(await pending)).toEqual({ response: 'cancel', answers: {} });
    expect(answered).toEqual([]);
  });
});
