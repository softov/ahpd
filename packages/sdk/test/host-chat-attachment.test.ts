import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { call, directory, withRole } from './users-gate-helpers.js';
import {
  resetSdk, actions, claude, createHost, emit, hello, machine, peer, sdk, settle,
} from './support/host.js';
import type { Bag } from '../src/types/common.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

/**
 * This checkout, as an absolute path.
 *
 * The session below is started in it and the case reads real files, so the
 * path is found rather than written down - a literal one passes on the machine
 * it was written on and fails on every other.
 */
const REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');

beforeEach(resetSdk);

describe('a chat attached to a message', () => {
  type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

  const until = async (ready: () => boolean, tries = 400): Promise<void> => {
    for (let i = 0; i < tries && !ready(); i++) await settle(1);
  };

  /**
   * A host with one session, and a second chat in it.
   *
   * The session's own first chat comes back as `live`, read from the snapshot
   * rather than written down: what a session calls its chat is the host's
   * answer, and a case that hard-codes it is testing a spelling. The second
   * chat is created after the session, so its CLI is the one `emit` speaks to.
   */
  const opened = async () => {
    const host = createHost({ path: REPO, agents: [claude({ paths: [REPO] })], ...machine() });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    const before = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/live' } }) as {
      snapshot: { state: { defaultChat: string } };
    };
    // Watched, as a client showing a chat watches it: a refusal answers on the
    // channel it was asked about, and a client that dispatches on a chat is one
    // that has the chat open under this name.
    await client.handle({ method: 'subscribe', params: { channel: before.snapshot.state.defaultChat } });
    // No initial message: the turns of this chat are the ones a case speaks
    // itself, each under an id it names, which is what an `endTurn` pins.
    await client.handle({
      method: 'createChat',
      params: { channel: 'ahp-session:/live', chat: 'ahp-chat:/review' },
    });
    await settle();
    return { client, p, live: before.snapshot.state.defaultChat };
  };

  /** A `chat` attachment on `ahp-chat:/review`, with what a case adds to it. */
  const attached = (over: Bag = {}): Bag => ({
    type: 'chat',
    resource: 'ahp-chat:/review',
    label: 'Review the diff',
    ...over,
  });

  /** A turn in a chat, left running - what a client pins while it is answering. */
  const started = async (client: Client, chat: string, turnId: string, text: string): Promise<void> => {
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
    });
    await settle();
  };

  /** One turn of a chat, finished, under an id this case names. */
  const spoken = async (client: Client, chat: string, turnId: string, text: string): Promise<void> => {
    await started(client, chat, turnId, text);
    // The CLI naming its conversation, and then the end of the turn: this is
    // what leaves the chat a completed turn for an attachment to be pinned to.
    await emit({ type: 'system', subtype: 'init', session_id: 'sdk-1' });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
  };

  /**
   * A message sent into a chat, and the blocks the backend was handed.
   *
   * The turn is left running: what a case reads is what the message carried,
   * and the answer to it is not this file's business.
   */
  const sent = async (client: Client, chat: string, turnId: string, message: Bag): Promise<Bag[]> => {
    const before = sdk.blocks.length;
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, ...message } } },
    });
    await until(() => sdk.blocks.length > before);
    return (sdk.blocks.at(-1) ?? []) as Bag[];
  };

  /** What a message handed the backend besides its own text. */
  const pointerOf = (blocks: Bag[]): string => String(blocks[1]?.text ?? '');

  it('hands the backend a pointer with the title, the link and the transcript', async () => {
    const { client, live } = await opened();
    await spoken(client, 'ahp-chat:/review', 'r1', 'What changed in the diff?');

    const blocks = await sent(client, live, 't1', {
      text: 'look at that',
      attachments: [attached({ endTurn: 'r1' })],
    });

    // The message's own text first, as every message is sent, and the pointer
    // as a second text block - which is what a `simple` attachment becomes.
    expect(blocks[0]).toEqual({ type: 'text', text: 'look at that' });
    const pointer = pointerOf(blocks);
    expect(pointer).toContain('The user referenced another chat, "Review the diff".');
    expect(pointer).toContain('That chat is identified by the link agent-host-session://claude/live?chat=review.');
    expect(pointer).toContain('call the get_session_context server tool with its "session" argument set to that link.');
    expect(pointer).toContain("The excerpt below is that chat's full transcript up to the selected turn:");
    // Both what the person said and what the agent answered, which is the
    // whole of what a transcript is read for.
    expect(pointer).toContain('User: What changed in the diff?');
  });

  it('carries the tail of a transcript over the cap, and not the rest', async () => {
    const { client, live } = await opened();
    // Ending in a word rather than a space: a turn's text is read trimmed, and
    // a trailing space would make the tail below a character out.
    const long = `${'lorem ipsum '.repeat(140)}end`;
    await spoken(client, 'ahp-chat:/review', 'r1', long);

    const pointer = pointerOf(await sent(client, live, 't1', { text: 'look', attachments: [attached()] }));

    expect(pointer).toContain('(about the last 1000 characters; the earlier part was omitted to keep the most recent content):');
    expect(pointer.endsWith(`User: ${long}`.slice(-1000))).toBe(true);
    // The tail alone: the whole of what was said is not there.
    expect(pointer).not.toContain(long);
  });

  it('cuts the transcript at the turn the client pinned, and only there', async () => {
    const pinned = await opened();
    await spoken(pinned.client, 'ahp-chat:/review', 'r1', 'first question');
    await spoken(pinned.client, 'ahp-chat:/review', 'r2', 'second question');
    const cut = pointerOf(await sent(pinned.client, pinned.live, 't1', {
      text: 'see this',
      attachments: [attached({ endTurn: 'r1' })],
    }));
    expect(cut).toContain('User: first question');
    // Later turns do not change what was attached: the pin is the end of it.
    expect(cut).not.toContain('second question');

    // And with no pin at all the whole transcript is there - which is the
    // other half of the same rule, and what says the cut is the pin's.
    const whole = await opened();
    await spoken(whole.client, 'ahp-chat:/review', 'r1', 'first question');
    await spoken(whole.client, 'ahp-chat:/review', 'r2', 'second question');
    const all = pointerOf(await sent(whole.client, whole.live, 't1', { text: 'see this', attachments: [attached()] }));
    expect(all).toContain('User: first question');
    expect(all).toContain('User: second question');
  });

  it('names an unknown chat and runs the turn anyway', async () => {
    const { client, p, live } = await opened();

    const blocks = await sent(client, live, 't1', {
      text: 'look at that',
      attachments: [{ type: 'chat', resource: 'ahp-chat:/gone', label: 'Gone', endTurn: 'r1' }],
    });

    // Named by its raw resource rather than by a link, because there is no
    // chat of this host behind it to link to - and the pin goes with the
    // transcript, since a turn nobody looked at is one this host cannot say
    // it found. A chat is not refused for having no turns.
    const pointer = pointerOf(blocks);
    expect(pointer).toContain('The user referenced another chat, "Gone", identified by ahp-chat:/gone.');
    expect(pointer).toContain('The referenced chat has no transcript content up to the selected turn.');
    expect(blocks[0]).toEqual({ type: 'text', text: 'look at that' });
    // The turn ran: an attachment nothing can read is not a message to lose.
    expect(actions(p, live).some((one) => one.rejectionReason !== undefined)).toBe(false);
  });

  it('leaves the excerpt off a chat the sender may not read', async () => {
    /*
     * Two people and one session, which is what a read grant is asked about.
     *
     * `ana` is the session's own: she may read sessions, so the chat she
     * attached is read out for her. `gus` may use chats and may not read
     * sessions, so the same attachment reaches the model as a pointer and
     * nothing of the conversation behind it.
     */
    const made = createHost({
      path: REPO,
      agents: [claude({ paths: [REPO] })],
      ...machine(),
      users: directory({
        ana: ['session:write', 'session:read', 'session:create', 'chat:create', 'chat:send', 'chat:turns'],
        gus: ['chat:send', 'chat:turns'],
      }),
    });
    const ana = await withRole(made, 'ana');
    await call(ana.client, 'createSession', { channel: 'ahp-session:/live', provider: 'claude' });
    const opened_ = await call(ana.client, 'subscribe', { channel: 'ahp-session:/live' }) as {
      result: { snapshot: { state: { defaultChat: string } } };
    };
    const live = opened_.result.snapshot.state.defaultChat;
    await call(ana.client, 'createChat', { channel: 'ahp-session:/live', chat: 'ahp-chat:/review' });
    await settle();
    await spoken(ana.client, 'ahp-chat:/review', 'r1', 'a question only ana may read');

    const gus = await withRole(made, 'gus');
    await gus.send(live, {
      type: 'chat/turnStarted',
      turnId: 't1',
      startedAt: new Date().toISOString(),
      message: { text: 'see this', origin: { kind: 'user' }, attachments: [attached({ endTurn: 'r1' })] },
    });
    await until(() => sdk.blocks.length > 0);

    const pointer = pointerOf((sdk.blocks.at(-1) ?? []) as Bag[]);
    // The reference is still named, and the link is the same one ana's own
    // message carries - what the read grant withholds is the transcript.
    expect(pointer).toContain('The user referenced another chat, "Review the diff".');
    expect(pointer).toContain('That chat is identified by the link agent-host-session://claude/live?chat=review.');
    expect(pointer).toContain('The referenced chat has no transcript content up to the selected turn.');
    expect(pointer).not.toContain('a question only ana may read');
    // And the turn ran rather than being refused: the person said something,
    // and what their agent cannot see is the other conversation.
    expect(gus.refused()).toEqual([]);
  });

  /**
   * What the client was told of turn `t1` on `live`: each action's type and
   * refusal, and the words of the error it ended in.
   */
  const told = (p: ReturnType<typeof peer>, live: string) => {
    const said = actions(p, live).filter((one) => one.action.turnId === 't1');
    return {
      said: said.map((one) => [one.action.type, one.rejectionReason]),
      error: (said.find((one) => one.action.type === 'chat/error')?.action.part as Bag | undefined)?.error,
    };
  };

  /*
   * A pin nobody can honour fails the turn's send before the backend is handed
   * it, as VS Code's host fails a send whose chat attachments it cannot resolve.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2380-L2409
   */
  it('ends a turn pinned to the turn that is still running in an error', async () => {
    const { client, p, live } = await opened();
    await started(client, 'ahp-chat:/review', 'r1', 'a question being answered');

    await client.handle({
      method: 'dispatchAction',
      params: {
        channel: live,
        action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'see this', attachments: [attached({ endTurn: 'r1' })] } },
      },
    });
    await settle();

    expect(told(p, live)).toEqual({
      said: [['chat/turnStarted', undefined], ['chat/error', undefined]],
      error: { errorType: 'sendFailed', message: 'Chat attachment endTurn must reference a completed turn: ahp-chat:/review#r1' },
    });
    // Nothing of the message reached the backend: an agent that ran the turn
    // would have read a transcript that ends at a turn with no answer in it yet.
    expect(sdk.blocks).toEqual([]);
  });

  it('ends a turn pinned to a turn this host cannot find in an error', async () => {
    const { client, p, live } = await opened();
    await spoken(client, 'ahp-chat:/review', 'r1', 'the only question');

    await client.handle({
      method: 'dispatchAction',
      params: {
        channel: live,
        action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'see this', attachments: [attached({ endTurn: 'r9' })] } },
      },
    });
    await settle();

    // The chat is here and the turn is not, so what was attached is not what
    // would be read - the same answer as a turn that is still running.
    expect(told(p, live)).toEqual({
      said: [['chat/turnStarted', undefined], ['chat/error', undefined]],
      error: { errorType: 'sendFailed', message: 'Chat attachment endTurn r9 was not found in the retained transcript.' },
    });
  });

  it('keeps the chat attachment in the turn the client sees', async () => {
    const { client, live } = await opened();
    await spoken(client, 'ahp-chat:/review', 'r1', 'What changed in the diff?');
    const attachment = attached({ endTurn: 'r1' });

    await sent(client, live, 't1', { text: 'look at that', attachments: [attachment] });

    // Resolving is for the backend alone. A client draws the label of the
    // chat it attached, and what the model was told is text - so the turn the
    // host serves still carries the `chat` attachment as it arrived, and the
    // pointer exists only in the blocks the backend was handed.
    const read = await client.handle({ method: 'subscribe', params: { channel: live } }) as {
      snapshot: { state: { activeTurn: { message: { attachments: Bag[] } } } };
    };
    const kept = read.snapshot.state.activeTurn.message.attachments;
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject(attachment);
    expect(kept[0]?.type).toBe('chat');
  });
});
